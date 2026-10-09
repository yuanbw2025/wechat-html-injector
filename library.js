import { markdownHTML, sanitizeHTML, escapeHTML } from "./draft-schema.js";
import { stageFile, takeFile } from "./draft-files.js";
const $ = (selector) => document.querySelector(selector);
let current = null;
let drafts = [];
let collections = [];
let revisions = [];
let dirty = false;
let savePromise;
let autosave;
let recoveryTimer;
const sessionId = crypto.randomUUID();
const urls = [];
const labels = {
  prepared: "已准备",
  exported: "已写入编辑器",
  verified: "导出回读通过，等待用户保存",
  failed: "导出失败",
  "user-confirmed-saved": "用户确认已保存",
};
function status(text, kind = "") {
  $("#status").textContent = text;
  $("#status").className = kind;
}
async function message(value) {
  const r = await chrome.runtime.sendMessage(value);
  if (!r?.ok)
    throw Object.assign(new Error(r?.error || "服务未返回结果"), {
      code: r?.code,
    });
  return r;
}
const api = (type, payload = {}) =>
  message({ type: "draft-api", request: { type, payload } });
const base = () => ({
  draftId: current.id,
  baseRevisionId: current.currentRevisionId,
  expectedChecksum: current.checksum,
});
function action(selector, fn) {
  $(selector).addEventListener("click", async () => {
    const el = $(selector);
    el.disabled = true;
    try {
      await fn();
    } catch (e) {
      status(e.message, "error");
    } finally {
      el.disabled = false;
    }
  });
}
function options(el, items, empty) {
  const selected = el.value;
  el.replaceChildren();
  if (empty !== undefined) el.add(new Option(empty, ""));
  for (const item of items)
    el.add(new Option(item.name || item.title, item.id));
  el.value = selected;
}
async function refresh() {
  const [list, cs, stats, runs] = await Promise.all([
    api("drafts.list", {
      query: $("#search").value,
      collectionId: $("#collection").value,
      status: $("#state").value,
      tag: $("#tag").value,
    }),
    api("drafts.collections"),
    api("drafts.stats"),
    api("drafts.aiRuns"),
  ]);
  drafts = list.drafts;
  collections = cs.collections;
  options($("#collection"), collections, "全部合集");
  options($("#draftCollection"), collections, "不加入合集");
  if (current) $("#draftCollection").value = current.collectionId;
  $("#draftList").replaceChildren();
  for (const d of drafts) {
    const row = document.createElement("button");
    row.className = `draft-row${current?.id === d.id ? " selected" : ""}`;
    const title = document.createElement("strong");
    title.textContent = d.title;
    const info = document.createElement("span");
    info.textContent = `${collections.find((c) => c.id === d.collectionId)?.name || "未分类"} · ${d.tags.join(" / ") || "无标签"}\n${d.provenance.type} · ${d.currentRevisionId.slice(-8)} · ${new Date(d.updatedAt).toLocaleString()}\n资源 ${d.assetIds.length} · ${d.imageStatus.join(" / ") || "无资源"}\n${d.latestExportReceipt ? `${d.latestExportReceipt.platformId} · ${labels[d.latestExportReceipt.status] || d.latestExportReceipt.status}` : "尚未导出"}`;
    row.append(title, info);
    row.addEventListener("click", () =>
      select(d.id).catch((e) => status(e.message, "error")),
    );
    $("#draftList").append(row);
  }
  const estimate = await navigator.storage.estimate();
  $("#storage").textContent =
    `稿件 ${stats.stats.drafts} 篇 · 独立资源 ${stats.stats.assetCount} 份 / ${(stats.stats.assetBytes / 1024 / 1024).toFixed(1)} MiB\n已验证导出 ${stats.stats.verified} 次 · 用户确认保存 ${stats.stats.userConfirmedSaved} 次 · 实际发布 0\n本机存储 ${(estimate.usage / 1024 / 1024).toFixed(1)} MiB / ${(estimate.quota / 1024 / 1024 / 1024).toFixed(1)} GiB`;
  $("#aiRuns").replaceChildren();
  for (const run of runs.runs
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 15)) {
    const row = document.createElement("div");
    row.className = "record";
    row.textContent = `${run.model} · ${run.status}\n${run.instruction}\n${run.error || run.reply || "未确认完成，请检查稿件和任务记录"}`;
    $("#aiRuns").append(row);
  }
  if ($("#collection").value) {
    const r = await api("drafts.validate", {
      collectionId: $("#collection").value,
    });
    $("#audit").textContent =
      `${r.audit.count} 篇 · 缺失 ${r.audit.missing.join(", ") || "无"} · 重复 ${r.audit.duplicates.join(", ") || "无"}\n校验问题 ${r.audit.errors.length}`;
  } else $("#audit").textContent = `按最近更新时间排序 · ${drafts.length} 篇`;
}
async function select(draftId) {
  if (dirty) await save();
  const r = await api("drafts.get", { draftId });
  current = r.draft;
  dirty = false;
  $("#empty").hidden = true;
  $("#editor").hidden = false;
  fill();
  await details();
  await refresh();
}
function fill() {
  $("#title").value = current.title;
  $("#tags").value = current.tags.join(", ");
  $("#summary").value = current.summary;
  $("#draftCollection").value = current.collectionId;
  $("#markdown").value = current.contentMarkdown;
  $("#html").value = current.contentHtml;
  $("#plain").textContent = current.contentPlainText;
  $("#identity").textContent =
    `${current.id} · 当前版本 ${current.currentRevisionId} · ${current.checksum} · 来源 ${current.provenance.type}`;
}
function changes() {
  return {
    title: $("#title").value,
    summary: $("#summary").value,
    tags: $("#tags")
      .value.split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean),
    collectionId: $("#draftCollection").value,
    contentMarkdown: $("#markdown").value,
    contentHtml: $("#html").value,
  };
}
async function save() {
  if (savePromise) {
    await savePromise;
    if (dirty) return save();
    return;
  }
  savePromise = performSave().finally(() => {
    savePromise = null;
  });
  await savePromise;
}
async function performSave() {
  clearTimeout(autosave);
  if (!current || !dirty) return;
  const selectedId = current.id;
  const values = changes();
  let completed = false;
  try {
    const r = await api("drafts.update", {
      ...base(),
      changes: values,
      requestId: crypto.randomUUID(),
    });
    const next = await api("drafts.get", { draftId: r.draftId });
    if (current?.id === selectedId) {
      current = next.draft;
      dirty = JSON.stringify(values) !== JSON.stringify(changes());
      $("#identity").textContent =
        `${current.id} · ${current.currentRevisionId} · 已保存新版本`;
      $("#plain").textContent = current.contentPlainText;
    }
    status("已保存到本地稿件库。", "ok");
    completed = true;
    if (!dirty)
      await api("drafts.clearWorkingCopy", {
        id: `${selectedId}:${sessionId}`,
      });
    await details();
    await refresh();
  } finally {
    if (dirty && completed)
      autosave = setTimeout(
        () => save().catch((e) => status(e.message, "error")),
        1600,
      );
  }
}
for (const field of [
  "title",
  "tags",
  "summary",
  "draftCollection",
  "markdown",
  "html",
])
  $("#" + field).addEventListener("input", () => {
    if (!current) return;
    if (field === "markdown")
      $("#html").value = markdownHTML($("#markdown").value);
    dirty = true;
    clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(() => {
      if (current && dirty)
        api("drafts.workingCopy", {
          id: `${current.id}:${sessionId}`,
          ...base(),
          changes: changes(),
        }).catch((e) => status(`恢复记录未保存：${e.message}`, "error"));
    }, 200);
    clearTimeout(autosave);
    autosave = setTimeout(
      () =>
        save().catch((e) =>
          status(
            `${e.message}。编辑内容保留在当前页面，请比较最新版本。`,
            "error",
          ),
        ),
      1600,
    );
  });
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
async function details() {
  if (!current) return;
  const [vs, receipts] = await Promise.all([
    api("drafts.revisions", { draftId: current.id }),
    api("drafts.receipts", { draftId: current.id }),
  ]);
  revisions = vs.revisions;
  options(
    $("#version"),
    revisions.map((r) => ({
      id: r.id,
      name: `${new Date(r.createdAt).toLocaleString()} · ${r.source} · ${r.id.slice(-8)}`,
    })),
  );
  if (!$("#version").value) $("#version").value = revisions[0]?.id || "";
  compare();
  $("#receipts").replaceChildren();
  for (const r of receipts.receipts) {
    const row = document.createElement("div");
    row.className = "record";
    row.textContent = `${labels[r.status]} · ${new Date(r.createdAt).toLocaleString()}\n${r.error || ""}\n${(r.warnings || []).join("\n")}\n写入 checksum：${r.exportedHtmlChecksum || "—"}\n回读 checksum：${r.readBackHtmlChecksum || "—"}`;
    if (r.status === "verified") {
      const button = document.createElement("button");
      button.textContent = "我已在微信中保存";
      button.addEventListener("click", async () => {
        try {
          if (
            !confirm(
              "请确认你已亲自在微信中保存此稿件。该状态仅是你的确认，不是平台接口证明。",
            )
          )
            return;
          await api("drafts.confirmSaved", {
            receiptId: r.id,
            confirmed: true,
          });
          await details();
          await refresh();
        } catch (e) {
          status(e.message, "error");
        }
      });
      row.append(button);
    }
    if (r.status === "user-confirmed-saved") {
      const check = document.createElement("button");
      check.textContent = "保存后重新打开：检查图片";
      check.addEventListener("click", async () => {
        try {
          if (
            !confirm(
              "确认你已保存草稿并重新打开同一篇文章？插件将回读并检查映射图片 URL。",
            )
          )
            return;
          const tabId = Number($("#targetTab").value);
          if (!tabId) throw new Error("请选择重新打开的微信编辑器");
          await message({
            type: "draft-confirm-reopened",
            tabId,
            draftId: current.id,
            receiptId: r.id,
            confirmed: true,
          });
          await renderAssets();
          status("重新打开后的微信 CDN 图片回读通过。", "ok");
        } catch (e) {
          status(e.message, "error");
        }
      });
      row.append(check);
    }
    $("#receipts").append(row);
  }
}
function compare() {
  const r = revisions.find((r) => r.id === $("#version").value);
  $("#versionText").textContent = r
    ? `历史：${r.title}\n来源 ${r.source} · ${r.checksum}\n\n${r.contentPlainText}\n\nHTML:\n${r.contentHtml}${r.platformVariant ? `\n\n平台适配 ${r.platformVariant.platformId}：${r.platformVariant.title}\n${r.platformVariant.contentHtml}` : ""}`
    : "";
  $("#currentText").textContent = current
    ? `当前：${current.title}\n${current.checksum}\n\n${current.contentPlainText}\n\nHTML:\n${current.contentHtml}`
    : "";
}
$("#version").addEventListener("change", compare);
async function renderAssets(preview = false) {
  if (!current) return;
  for (const url of urls) URL.revokeObjectURL(url);
  urls.length = 0;
  const r = await api("drafts.assetList", { hashes: current.assetIds });
  let html = sanitizeHTML($("#html").value);
  $("#assets").replaceChildren();
  for (const a of r.assets) {
    const file = await api("drafts.assetPreview", { sha256: a.sha256 });
    const blob = await takeFile(file.fileId);
    const url = URL.createObjectURL(blob);
    urls.push(url);
    html = html.replaceAll(`asset://${a.sha256}`, url);
    const row = document.createElement("div");
    row.className = "record";
    if (a.mimeType.startsWith("image/")) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = a.sha256.slice(0, 8);
      row.append(img);
    }
    const text = document.createElement("span");
    text.textContent = `${a.sha256} · ${(a.bytes / 1024).toFixed(1)} KiB · ${a.platformMappings["wechat-official-account"]?.status || "needs-platform-upload"}`;
    row.append(text);
    const downloadAsset = document.createElement("button");
    downloadAsset.textContent = "下载原始资源";
    downloadAsset.addEventListener("click", () =>
      download(
        blob,
        `${a.sha256}.${{ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf" }[a.mimeType] || "bin"}`,
      ),
    );
    row.append(downloadAsset);
    if (a.mimeType.startsWith("image/")) {
      const button = document.createElement("button");
      button.textContent = "映射微信 CDN 图片";
      button.addEventListener("click", async () => {
        try {
          const value = prompt(
            "粘贴微信原生图片库中的 HTTPS mmbiz.qpic.cn 图片 URL",
          );
          if (value) {
            await api("drafts.mapAsset", { sha256: a.sha256, url: value });
            await renderAssets();
          }
        } catch (e) {
          status(e.message, "error");
        }
      });
      row.append(button);
    }
    $("#assets").append(row);
  }
  if (preview)
    $("#preview").srcdoc =
      `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob: data:; style-src 'unsafe-inline'"><style>body{max-width:720px;margin:20px auto;padding:0 20px;line-height:1.7}img{max-width:100%}</style>${html}`;
}
document.querySelectorAll("[data-pane]").forEach((button) =>
  button.addEventListener("click", async () => {
    document
      .querySelectorAll("[data-pane]")
      .forEach((b) => b.classList.toggle("active", b === button));
    document
      .querySelectorAll("[data-view]")
      .forEach((v) => (v.hidden = v.dataset.view !== button.dataset.pane));
    try {
      if (["preview", "assets"].includes(button.dataset.pane))
        await renderAssets(button.dataset.pane === "preview");
      if (button.dataset.pane === "versions") compare();
    } catch (e) {
      status(e.message, "error");
    }
  }),
);
for (const field of ["search", "collection", "state", "tag"])
  $("#" + field).addEventListener("input", () =>
    refresh().catch((e) => status(e.message, "error")),
  );
action("#save", save);
action("#new", async () => {
  if (dirty) await save();
  const title = prompt("稿件标题");
  if (!title) return;
  const r = await api("drafts.create", {
    title,
    contentMarkdown: "在这里开始写作。",
    collectionId: $("#collection").value,
    requestId: crypto.randomUUID(),
  });
  await select(r.draftId);
  status("新稿件已创建。", "ok");
});
action("#archive", async () => {
  await save();
  await api("drafts.archive", base());
  await select(current.id);
});
action("#renderMarkdown", async () => {
  if (!current) return;
  $("#html").value = markdownHTML($("#markdown").value);
  dirty = true;
  await save();
  fill();
});
action("#restore", async () => {
  if (!current) return;
  await save();
  if (!confirm("恢复所选历史版本？当前版本也会保留。")) return;
  await api("drafts.restoreRevision", {
    ...base(),
    revisionId: $("#version").value,
    requestId: crypto.randomUUID(),
  });
  await select(current.id);
});
action("#addCollection", async () => {
  const name = prompt("合集名称");
  if (!name) return;
  await api("drafts.saveCollection", {
    id: `collection_${crypto.randomUUID()}`,
    name,
  });
  await refresh();
});
action("#deleteCollection", async () => {
  const collectionId = $("#collection").value;
  if (!collectionId) throw new Error("请先选择一个合集");
  if (
    !confirm(
      "删除此合集及其全部稿件、历史版本与回执？先导出备份可以恢复。共享图片将保留。",
    )
  )
    return;
  const r = await api("drafts.deleteCollection", {
    collectionId,
    confirmed: true,
  });
  current = null;
  dirty = false;
  $("#editor").hidden = true;
  $("#empty").hidden = false;
  $("#collection").value = "";
  await refresh();
  status(
    `已删除 ${r.removed} 篇稿件，释放 ${(r.freedBytes / 1024 / 1024).toFixed(1)} MiB。可从事先导出的备份恢复。`,
    "ok",
  );
});
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
action("#backup", async () => {
  await save();
  const scope = $("#backupScope").value;
  const filter =
    scope === "draft"
      ? { draftId: current?.id }
      : scope === "collection"
        ? { collectionId: $("#collection").value }
        : {};
  if (
    (scope === "draft" && !filter.draftId) ||
    (scope === "collection" && !filter.collectionId)
  )
    throw new Error("请先选择备份范围");
  status("正在生成含历史版本和资源的完整备份…");
  const r = await api("drafts.export", { filter });
  download(await takeFile(r.fileId), `draft-backup-${Date.now()}.sfpack`);
  status("备份已生成，不含 API 配置或登录凭据。", "ok");
});
action("#import", async () => $("#importFile").click());
$("#importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const ext = file.name.split(".").at(-1).toLowerCase();
    const format = ["sfpack", "zip"].includes(ext)
      ? "sfpack"
      : ext === "md"
        ? "markdown"
        : ext;
    const fileId = await stageFile(file);
    const payload = {
      fileId,
      format,
      filename: file.name,
      requestId: crypto.randomUUID(),
    };
    status("正在预检文件、身份和 checksum…");
    const preview = await api("drafts.import", { ...payload, preview: true });
    if (
      !confirm(
        format === "sfpack"
          ? `预检通过：${preview.count} 篇，资源 ${(preview.assetBytes / 1024 / 1024).toFixed(1)} MiB。导入到本地稿件库？相同内容跳过，冲突不会覆盖。`
          : `导入“${preview.draft.title}”到本地稿件库？`,
      )
    ) {
      await takeFile(fileId);
      return;
    }
    status("正在导入，关闭后可重复导入同一包恢复…");
    const result = await api("drafts.import", payload);
    if (result.draftId) await select(result.draftId);
    else await refresh();
    status(
      result.report
        ? JSON.stringify(
            { report: result.report, audits: result.audits },
            null,
            2,
          )
        : "稿件已导入。",
      "ok",
    );
  } catch (error) {
    status(error.message, "error");
  } finally {
    e.target.value = "";
  }
});
$("#assetFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || !current) return;
  try {
    await save();
    const r = await api("drafts.asset", {
      fileId: await stageFile(file),
      mimeType: file.type || "application/octet-stream",
    });
    const html =
      current.contentHtml +
      (file.type.startsWith("image/")
        ? `<p><img src="asset://${r.sha256}" alt="${escapeHTML(file.name)}"></p>`
        : "");
    await api("drafts.update", {
      ...base(),
      changes: {
        assetIds: [...new Set([...current.assetIds, r.sha256])],
        contentHtml: html,
      },
      requestId: crypto.randomUUID(),
    });
    await select(current.id);
    await renderAssets();
  } catch (error) {
    status(error.message, "error");
  } finally {
    e.target.value = "";
  }
});
async function tabs() {
  const ts = await chrome.tabs.query({});
  options(
    $("#targetTab"),
    ts
      .filter((t) => t.url?.startsWith("https://mp.weixin.qq.com/"))
      .map((t) => ({ id: String(t.id), name: t.title || "微信编辑器" })),
    "选择微信编辑器标签页",
  );
  const requested = new URLSearchParams(location.search).get("targetTab");
  if (
    requested &&
    [...$("#targetTab").options].some((o) => o.value === requested)
  )
    $("#targetTab").value = requested;
}
action("#export", async () => {
  if (!current) throw new Error("请选择稿件");
  await save();
  const platform = $("#platform").value;
  if (platform !== "wechat-official-account") {
    let content =
      platform === "html"
        ? sanitizeHTML(current.contentHtml)
        : platform === "markdown"
          ? current.contentMarkdown || current.contentPlainText
          : JSON.stringify(current, null, 2);
    if (platform === "html") {
      for (const hash of current.assetIds) {
        if (!content.includes(`asset://${hash}`)) continue;
        const r = await api("drafts.assetPreview", { sha256: hash });
        const blob = await takeFile(r.fileId);
        if (!blob.type.startsWith("image/")) continue;
        const encoded = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        content = content.replaceAll(`asset://${hash}`, encoded);
      }
    }
    download(
      new Blob([content], {
        type: platform === "html" ? "text/html" : "text/plain",
      }),
      `${current.title.replace(/[\\/:*?"<>|]/g, "_")}.${platform === "markdown" ? "md" : platform}`,
    );
    return;
  }
  await tabs();
  const tabId = Number($("#targetTab").value);
  if (!tabId) throw new Error("请选择已打开的微信图文编辑器");
  if (
    !confirm(
      `将“${current.title}”导出到所选微信编辑器？最终保存或发布需要你自己完成。`,
    )
  )
    return;
  status("正在写入并回读验证…");
  const r = await message({
    type: "draft-export-editor",
    tabId,
    draftId: current.id,
    revisionId: current.currentRevisionId,
    confirmed: true,
  });
  status(r.warnings?.join("\n") || "导出回读通过，等待用户保存。", "ok");
  await details();
  await refresh();
});
action("#readback", async () => {
  if (!current) throw new Error("请选择稿件");
  await save();
  const tabId = Number($("#targetTab").value);
  if (!tabId) throw new Error("请选择目标编辑器");
  const r = await message({ type: "draft-read-editor", tabId });
  if (!confirm("将微信当前标题和正文保存为稿件的新版本？历史版本会保留。"))
    return;
  await api("drafts.readback", {
    ...base(),
    changes: { title: r.snapshot.title, contentHtml: r.snapshot.contentHtml },
    requestId: crypto.randomUUID(),
  });
  await select(current.id);
});
action("#settings", async () => chrome.runtime.openOptionsPage());
$("#allowAI").addEventListener("change", async () => {
  await chrome.storage.local.set({ allowAIDraftWrites: $("#allowAI").checked });
  if (!$("#allowAI").checked) {
    await message({ type: "draft-gateway-enable", enabled: false });
    $("#allowGateway").checked = false;
  }
  status(
    $("#allowAI").checked ? "AI 可创建和修改本地稿件。" : "AI 写入权限已关闭。",
    "ok",
  );
});
$("#allowGateway").addEventListener("change", async () => {
  try {
    const r = await message({
      type: "draft-gateway-enable",
      enabled: $("#allowGateway").checked,
    });
    $("#gatewayStatus").textContent = r.directory
      ? `私有队列：${r.directory}`
      : "本地网关已关闭";
  } catch (e) {
    $("#allowGateway").checked = false;
    status(e.message, "error");
  }
});
action("#pollGateway", async () => {
  await message({ type: "draft-poll-native" });
  await refresh();
  status("已读取本地队列。", "ok");
});
action("#runAI", async () => {
  if (dirty) await save();
  const mode = $("#aiMode").value;
  const draftId = mode === "create" ? undefined : current?.id;
  if (mode !== "create" && !draftId) throw new Error("请先选择稿件");
  status("AI 正在生成；结果会通过 Draft API 保存，无需复制粘贴…");
  const r = await message({
    type: "draft-ai",
    payload: {
      mode,
      draftId,
      instruction: $("#instruction").value,
      requestId: crypto.randomUUID(),
    },
  });
  $("#aiResult").textContent =
    `${r.run.reply}\n${(r.run.results || []).map((a) => `${a.draftId}\n${a.revisionId}`).join("\n")}`;
  const created = r.run.results?.at(-1);
  if (created?.draftId) await select(created.draftId);
  else await refresh();
  status("AI 结果已保存到本地稿件库。", "ok");
});
async function init() {
  const config = await chrome.storage.local.get([
    "allowAIDraftWrites",
    "draftGatewayEnabled",
  ]);
  $("#allowAI").checked = config.allowAIDraftWrites === true;
  $("#allowGateway").checked = config.draftGatewayEnabled === true;
  await refresh();
  await tabs();
  status("稿件库已就绪。", "ok");
  const recovery = await api("drafts.workingCopies");
  for (const copy of recovery.copies.sort(
    (a, b) => b.updatedAt - a.updatedAt,
  )) {
    if (
      !confirm(
        "检测到未完成的本地编辑，是否恢复为新版本？若正式稿件已有更新，会报告冲突并保留恢复记录。",
      )
    )
      continue;
    try {
      await api("drafts.update", {
        draftId: copy.draftId,
        baseRevisionId: copy.baseRevisionId,
        expectedChecksum: copy.expectedChecksum,
        changes: copy.changes,
        requestId: `recovery:${copy.id}:${copy.updatedAt}`,
      });
      await api("drafts.clearWorkingCopy", { id: copy.id });
      await select(copy.draftId);
      status("异常退出前的编辑已恢复为新版本。", "ok");
    } catch (error) {
      status(
        `${error.message}。恢复记录仍保留，可在解决冲突后再次恢复。`,
        "error",
      );
      if (
        error.code === "CONFLICT" &&
        confirm(
          "正式稿件已有其他修改，不能直接恢复覆盖。是否将未完成编辑另存为“恢复副本”？原稿和原历史均保留。",
        )
      ) {
        try {
          const history = await api("drafts.revisions", {
            draftId: copy.draftId,
          });
          const original = history.revisions.find(
            (r) => r.id === copy.baseRevisionId,
          );
          if (!original) throw new Error("恢复所需的历史版本缺失，记录仍保留");
          const result = await api("drafts.create", {
            draft: {
              ...original,
              ...copy.changes,
              title: `${(copy.changes.title || original.title).slice(0, 280)}（恢复副本）`,
              provenance: { type: "user", recoveredFrom: copy.draftId },
            },
            requestId: `recovery-copy:${copy.id}:${copy.updatedAt}`,
          });
          await api("drafts.clearWorkingCopy", { id: copy.id });
          await select(result.draftId);
          status("已另存恢复副本，未覆盖现有稿件。", "ok");
        } catch (e) {
          status(`${e.message}。恢复记录仍保留。`, "error");
        }
      }
    }
  }
  chrome.tabs.onUpdated.addListener(() => tabs().catch(() => {}));
}
init().catch((e) => status(e.message, "error"));
