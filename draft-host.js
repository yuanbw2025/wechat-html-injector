import { DraftStore } from "./draft-store.js";
import { executeDraftAPI, validateMessage } from "./draft-gateway.js";
import { importPack, backupPack } from "./content-pack.js";
import { stageFile, takeFile } from "./draft-files.js";
import { fail, LIMITS, normalizeDraft } from "./draft-schema.js";
const store = new DraftStore();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target !== "draft-host" || message.type !== "draft-host-request")
    return false;
  if (
    sender.id !== chrome.runtime.id ||
    (sender.url && sender.url !== chrome.runtime.getURL("background.js"))
  ) {
    respond({ ok: false, code: "FORBIDDEN", error: "只接受后台网关请求" });
    return false;
  }
  const run = async () => {
    const request = message.request;
    const context = message.context || {};
    const p = validateMessage(request, context);
    if (
      ["drafts.import", "drafts.export", "drafts.asset"].includes(request.type)
    ) {
      if (context.source !== "user") fail("FORBIDDEN", "AI 不允许访问文件通道");
      if (request.type === "drafts.export")
        return {
          ok: true,
          fileId: await stageFile(await backupPack(store, p.filter || {})),
        };
      const blob = await takeFile(p.fileId, !p.preview);
      if (request.type === "drafts.asset")
        return {
          ok: true,
          sha256: await store.asset(blob, p.mimeType || blob.type),
        };
      if (p.format === "sfpack")
        return importPack(store, blob, { preview: p.preview === true });
      if (blob.size > LIMITS.draftBytes)
        fail("TOO_LARGE", "单篇导入超过 4 MiB");
      const text = await blob.text();
      let draft;
      if (p.format === "json") draft = JSON.parse(text);
      else
        draft = {
          title: p.title || p.filename?.replace(/\.[^.]+$/, "") || "导入稿件",
          [p.format === "html" ? "contentHtml" : "contentMarkdown"]: text,
          provenance: { type: "import" },
        };
      if (p.preview) return { ok: true, draft: await normalizeDraft(draft) };
      return store.mutate(draft, { source: "import", requestId: p.requestId });
    }
    if (request.type === "drafts.assetPreview") {
      const a = await store.get("assets", p.sha256);
      if (!a) fail("NOT_FOUND", "资源不存在");
      return { ok: true, fileId: await stageFile(a.blob) };
    }
    return executeDraftAPI(store, request, context);
  };
  run()
    .then(respond)
    .catch((e) =>
      respond({
        ok: false,
        code: e.code || "DRAFT_ERROR",
        error: e.message,
        detail: e.detail,
      }),
    );
  return true;
});
