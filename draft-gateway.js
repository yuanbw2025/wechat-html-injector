import {
  assertObject,
  assertSize,
  fail,
  noSecrets,
  normalizeDraft,
} from "./draft-schema.js";
import { importPack, backupPack } from "./content-pack.js";
export const METHODS = new Set([
  "drafts.create",
  "drafts.update",
  "drafts.get",
  "drafts.list",
  "drafts.search",
  "drafts.createRevision",
  "drafts.restoreRevision",
  "drafts.archive",
  "drafts.validate",
  "drafts.import",
  "drafts.export",
  "drafts.createTargetVariant",
  "drafts.revisions",
  "drafts.receipts",
  "drafts.confirmSaved",
  "drafts.stats",
  "drafts.collections",
  "drafts.saveCollection",
  "drafts.deleteCollection",
  "drafts.asset",
  "drafts.assetPreview",
  "drafts.mapAsset",
  "drafts.assetList",
  "drafts.recordExport",
  "drafts.readback",
  "drafts.aiRun",
  "drafts.aiRuns",
  "drafts.beginAIRun",
]);
export const AGENT_METHODS = new Set([
  "drafts.create",
  "drafts.update",
  "drafts.createRevision",
  "drafts.createTargetVariant",
  "drafts.get",
  "drafts.list",
  "drafts.search",
  "drafts.validate",
]);
for (const method of [
  "drafts.workingCopy",
  "drafts.workingCopies",
  "drafts.clearWorkingCopy",
  "drafts.markAssetsExported",
  "drafts.confirmReopened",
])
  METHODS.add(method);
export function validateMessage(
  message,
  { source = "user", allowAI = false } = {},
) {
  assertObject(message);
  if (!METHODS.has(message.type)) fail("UNKNOWN_MESSAGE", "未声明的 Draft API");
  if (Object.keys(message).some((k) => !["type", "payload"].includes(k)))
    fail("INVALID_SCHEMA", "消息包含未声明字段");
  const p = message.payload || {};
  assertObject(p);
  assertSize(p);
  noSecrets(p);
  if (source === "ai" || source === "agent") {
    if (!allowAI) fail("AI_WRITE_DISABLED", "请先启用“允许 AI 写入本地稿件库”");
    if (!AGENT_METHODS.has(message.type))
      fail("FORBIDDEN", "外部 Agent 和 AI 只能读取、创建或修改稿件");
  }
  if (
    [
      "drafts.update",
      "drafts.createRevision",
      "drafts.restoreRevision",
      "drafts.createTargetVariant",
      "drafts.archive",
      "drafts.readback",
    ].includes(message.type) &&
    (!p.draftId || !p.baseRevisionId || !p.expectedChecksum)
  )
    fail(
      "INVALID_SCHEMA",
      "更新必须指定 draftId、baseRevisionId 和 expectedChecksum",
    );
  if (
    p.requestId !== undefined &&
    (typeof p.requestId !== "string" || p.requestId.length > 200)
  )
    fail("INVALID_SCHEMA", "requestId 格式错误");
  for (const reserved of [
    "source",
    "aiRunId",
    "variant",
    "allowAI",
    "confirmedExport",
  ])
    if (reserved in p) fail("INVALID_SCHEMA", `请求不得指定 ${reserved}`);
  if (p.changes) {
    assertObject(p.changes);
    const fields = new Set([
      "title",
      "contentMarkdown",
      "contentHtml",
      "summary",
      "tags",
      "assetIds",
      "collectionId",
      "slug",
      "sourceReferences",
      "provenance",
      "metadata",
    ]);
    if (Object.keys(p.changes).some((k) => !fields.has(k)))
      fail("INVALID_SCHEMA", "稿件修改包含未声明字段");
  }
  return p;
}
export async function executeDraftAPI(store, message, context = {}) {
  const p = validateMessage(message, context);
  const source = context.source === "agent" ? "ai" : context.source || "user";
  const options = { source, aiRunId: context.aiRunId, requestId: p.requestId };
  switch (message.type) {
    case "drafts.create":
      return store.mutate(p.draft || p, options);
    case "drafts.update":
    case "drafts.createRevision":
    case "drafts.readback":
      return store.update(p, {
        ...options,
        source:
          message.type === "drafts.readback" ? "platform-readback" : source,
      });
    case "drafts.restoreRevision":
      return store.restore(p, options);
    case "drafts.get": {
      const draft = await store.get("drafts", p.draftId);
      if (!draft) fail("NOT_FOUND", "稿件不存在");
      return { ok: true, draft };
    }
    case "drafts.list":
    case "drafts.search": {
      const [drafts, receipts, assets] = await Promise.all([
        store.list(p),
        store.all("exportReceipts"),
        store.all("assets"),
      ]);
      const images = new Map(
        assets.map((a) => [
          a.sha256,
          a.platformMappings["wechat-official-account"]?.status ||
            "needs-platform-upload",
        ]),
      );
      return {
        ok: true,
        drafts: drafts.map((d) => ({
          ...d,
          latestExportReceipt: receipts
            .filter((r) => r.draftId === d.id)
            .sort((a, b) => b.updatedAt - a.updatedAt)[0],
          imageStatus: [
            ...new Set(d.assetIds.map((hash) => images.get(hash) || "missing")),
          ],
        })),
      };
    }
    case "drafts.revisions":
      return {
        ok: true,
        revisions: (await store.all("revisions"))
          .filter((r) => r.draftId === p.draftId)
          .sort((a, b) => b.createdAt - a.createdAt),
      };
    case "drafts.receipts":
      return {
        ok: true,
        receipts: (await store.all("exportReceipts"))
          .filter((r) => r.draftId === p.draftId)
          .sort((a, b) => b.createdAt - a.createdAt),
      };
    case "drafts.aiRuns":
      return { ok: true, runs: await store.all("aiRuns") };
    case "drafts.validate":
      if (p.request)
        validateMessage(p.request, { source: "ai", allowAI: true });
      return {
        ok: true,
        audit: p.collectionId
          ? await store.audit(p.collectionId)
          : await normalizeDraft(p.draft),
      };
    case "drafts.stats":
      return { ok: true, stats: await store.stats() };
    case "drafts.collections":
      return { ok: true, collections: await store.all("collections") };
    case "drafts.saveCollection": {
      noSecrets(p);
      if (
        typeof p.id !== "string" ||
        typeof p.name !== "string" ||
        !p.name.trim()
      )
        fail("INVALID_SCHEMA", "合集身份和名称不能为空");
      await store.put("collections", p);
      return { ok: true };
    }
    case "drafts.deleteCollection":
      return store.removeCollection(p.collectionId, p.confirmed);
    case "drafts.archive": {
      return store.archive(p);
    }
    case "drafts.createTargetVariant": {
      const d = await store.get("drafts", p.draftId);
      if (!d) fail("NOT_FOUND", "稿件不存在");
      if (
        !["wechat-official-account", "html", "markdown"].includes(p.platformId)
      )
        fail("INVALID_PLATFORM", "未声明的平台");
      const normalized = await normalizeDraft({
        ...d,
        ...p.changes,
        ...(p.changes?.contentMarkdown !== undefined &&
        p.changes?.contentHtml === undefined
          ? { contentHtml: undefined }
          : {}),
      });
      if (normalized.assetIds.some((hash) => !d.assetIds.includes(hash)))
        fail("MISSING_ASSET", "请先把适配版本使用的资源加入主稿");
      return store.mutate(d, {
        ...options,
        ...p,
        variant: {
          platformId: p.platformId,
          title: normalized.title,
          contentHtml: normalized.contentHtml,
          contentMarkdown: normalized.contentMarkdown,
          checksum: normalized.checksum,
          content: normalized,
          createdAt: Date.now(),
        },
      });
    }
    case "drafts.confirmSaved": {
      if (p.confirmed !== true) fail("CONFIRM_REQUIRED", "需要用户确认已保存");
      const r = await store.get("exportReceipts", p.receiptId);
      if (!r || r.status !== "verified")
        fail("INVALID_RECEIPT", "只能确认已回读验证的导出");
      return {
        ok: true,
        receipt: await store.receipt({ ...r, status: "user-confirmed-saved" }),
      };
    }
    case "drafts.recordExport": {
      if (
        !["prepared", "exported", "verified", "failed"].includes(p.status) ||
        p.platformId !== "wechat-official-account"
      )
        fail("INVALID_RECEIPT", "导出回执无效");
      const revision = await store.get("revisions", p.revisionId);
      if (!revision || revision.draftId !== p.draftId)
        fail("INVALID_RECEIPT", "回执缺少正式稿件版本");
      if (p.id) {
        const old = await store.get("exportReceipts", p.id);
        if (
          !old ||
          old.draftId !== p.draftId ||
          old.revisionId !== p.revisionId ||
          old.platformId !== p.platformId
        )
          fail("INVALID_RECEIPT", "回执身份不匹配");
      }
      return { ok: true, receipt: await store.receipt(p) };
    }
    case "drafts.aiRun":
      await store.put("aiRuns", p);
      return { ok: true };
    case "drafts.beginAIRun":
      return store.transaction(["aiRuns"], "readwrite", async (tx) => {
        const read = (req) =>
          new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
        const s = tx.objectStore("aiRuns");
        const old = await read(s.get(p.id));
        if (old) return { ok: true, created: false, run: old };
        await read(s.add(p));
        return { ok: true, created: true, run: p };
      });
    case "drafts.workingCopy": {
      if (
        !p.id ||
        !p.draftId ||
        !p.baseRevisionId ||
        !p.expectedChecksum ||
        !p.changes
      )
        fail("INVALID_SCHEMA", "恢复记录格式无效");
      await store.put("workingCopies", { ...p, updatedAt: Date.now() });
      return { ok: true };
    }
    case "drafts.workingCopies":
      return { ok: true, copies: await store.all("workingCopies") };
    case "drafts.clearWorkingCopy":
      await store.transaction(
        ["workingCopies"],
        "readwrite",
        (tx) =>
          new Promise((resolve, reject) => {
            const r = tx.objectStore("workingCopies").delete(p.id);
            r.onsuccess = resolve;
            r.onerror = () => reject(r.error);
          }),
      );
      return { ok: true };
    case "drafts.markAssetsExported":
    case "drafts.confirmReopened": {
      const draft = await store.get("drafts", p.draftId);
      const receipt = await store.get("exportReceipts", p.receiptId);
      if (
        !draft ||
        !receipt ||
        receipt.draftId !== draft.id ||
        !["verified", "user-confirmed-saved"].includes(receipt.status)
      )
        fail("INVALID_RECEIPT", "缺少已验证的导出回执");
      if (
        message.type === "drafts.confirmReopened" &&
        (p.confirmed !== true || receipt.status !== "user-confirmed-saved")
      )
        fail("CONFIRM_REQUIRED", "请先确认保存和重新打开");
      if (
        message.type === "drafts.confirmReopened" &&
        (!receipt.exportedTitle || receipt.exportedTitle !== p.title)
      )
        fail("INVALID_RECEIPT", "重新打开的文章标题与导出回执不匹配");
      const revision = await store.get("revisions", receipt.revisionId);
      if (!revision || revision.draftId !== draft.id)
        fail("INVALID_RECEIPT", "回执版本不存在");
      for (const hash of revision.assetIds) {
        const asset = await store.get("assets", hash);
        if (!asset?.mimeType.startsWith("image/")) continue;
        const m = asset.platformMappings["wechat-official-account"];
        if (!m?.url) fail("INVALID_ASSET", "图片未映射");
        if (
          message.type === "drafts.confirmReopened" &&
          !p.images?.includes(m.url)
        )
          fail("IMAGE_NOT_PRESERVED", "重新打开后的图片 URL 不匹配");
      }
      for (const hash of revision.assetIds) {
        const asset = await store.get("assets", hash);
        const m = asset?.platformMappings["wechat-official-account"];
        if (m) {
          m.status =
            message.type === "drafts.confirmReopened"
              ? "verified-after-reopen"
              : "exported";
          m.updatedAt = Date.now();
          await store.put("assets", asset);
        }
      }
      return { ok: true };
    }
    case "drafts.assetList": {
      const assets = await store.all("assets");
      return {
        ok: true,
        assets: assets
          .filter((a) => !p.hashes || p.hashes.includes(a.sha256))
          .map(({ blob, ...a }) => a),
      };
    }
    case "drafts.mapAsset": {
      const a = await store.get("assets", p.sha256);
      if (!a) fail("NOT_FOUND", "资源不存在");
      let url;
      try {
        url = new URL(p.url);
      } catch {
        fail("INVALID_ASSET", "图片 URL 无效");
      }
      if (
        url.protocol !== "https:" ||
        !/(^|\.)mmbiz\.qpic\.cn$/.test(url.hostname)
      )
        fail("INVALID_ASSET", "仅接受微信图片库中的 HTTPS CDN 链接");
      a.platformMappings = {
        ...a.platformMappings,
        "wechat-official-account": {
          url: url.href,
          status: "mapped-to-platform",
          updatedAt: Date.now(),
        },
      };
      await store.put("assets", a);
      return { ok: true };
    }
    // File operations reference a same-origin staged Blob, never large JSON in runtime messages.
    case "drafts.import":
    case "drafts.export":
    case "drafts.asset":
      fail("FILE_CHANNEL_REQUIRED", "文件操作必须通过扩展文件通道");
    default:
      fail("UNKNOWN_MESSAGE", "未知操作");
  }
}
