import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import { DraftStore, STORES } from "../draft-store.js";
import {
  sanitizeHTML,
  normalizeDraft,
  checksum,
  auditCollection,
  stable,
} from "../draft-schema.js";
import { executeDraftAPI, validateMessage } from "../draft-gateway.js";
import {
  writeZip,
  preflight,
  importPack,
  backupPack,
} from "../content-pack.js";
globalThis.document = new JSDOM("").window.document;
const fresh = () =>
  new DraftStore(new IDBFactory(), `test_${crypto.randomUUID()}`);
const input = {
  title: "通用稿件",
  contentMarkdown: "# 正文\n\n保持内容",
  tags: ["内容"],
};
const base = (d) => ({
  draftId: d.id,
  baseRevisionId: d.currentRevisionId,
  expectedChecksum: d.checksum,
});
test("schema rejects empty, wrong shapes, credentials and unsafe HTML; checksum has known result", async () => {
  await assert.rejects(
    normalizeDraft({ title: "空稿", contentHtml: "<script>evil()</script>" }),
    { code: "EMPTY_CONTENT" },
  );
  await assert.rejects(normalizeDraft({ ...input, tags: "wrong" }), {
    code: "INVALID_SCHEMA",
  });
  await assert.rejects(
    normalizeDraft({ ...input, metadata: { apiKey: "secret" } }),
    { code: "CREDENTIAL_DATA" },
  );
  const html = sanitizeHTML(
    '<p style="color:red;background:url(https://evil.test);position:fixed" onclick="evil()">正文</p><svg><script>alert(1)</script></svg><iframe src="https://evil.test"></iframe><a href="java&#x0a;script:evil()">文字</a><img src="data:text/html;base64,abc"><form>危险表单</form>',
  );
  assert.doesNotMatch(
    html,
    /onclick|javascript|iframe|svg|form|url\(|position|data:text/,
  );
  assert.match(html, /color:red/);
  assert.equal(
    await checksum("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
test("atomic CRUD, immutable revisions, restore, archive, concurrency and retry identity", async () => {
  const s = fresh();
  const created = await executeDraftAPI(s, {
    type: "drafts.create",
    payload: { draft: input, requestId: "req1" },
  });
  assert.ok(created.draftId && created.revisionId);
  const retry = await executeDraftAPI(s, {
    type: "drafts.create",
    payload: { draft: input, requestId: "req1" },
  });
  assert.equal(retry.draftId, created.draftId);
  const d = await s.get("drafts", created.draftId);
  const results = await Promise.allSettled([
    s.update({ ...base(d), changes: { title: "更新一" } }),
    s.update({ ...base(d), changes: { title: "更新二" } }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    results.find((r) => r.status === "rejected").reason.code,
    "CONFLICT",
  );
  const updated = await s.get("drafts", d.id);
  await s.restore({ ...base(updated), revisionId: created.revisionId });
  const restored = await s.get("drafts", d.id);
  assert.equal(restored.title, input.title);
  assert.notEqual(restored.currentRevisionId, created.revisionId);
  assert.equal((await s.all("revisions")).length, 3);
  await s.close();
  assert.equal((await s.get("drafts", d.id)).title, input.title);
});
test("AI gate, agent permissions and unknown messages fail closed", () => {
  assert.throws(
    () =>
      validateMessage(
        { type: "drafts.create", payload: input },
        { source: "ai" },
      ),
    { code: "AI_WRITE_DISABLED" },
  );
  assert.throws(
    () =>
      validateMessage(
        { type: "drafts.recordExport", payload: {} },
        { source: "agent", allowAI: true },
      ),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () => validateMessage({ type: "drafts.publish", payload: {} }),
    { code: "UNKNOWN_MESSAGE" },
  );
  assert.throws(
    () => validateMessage({ type: "drafts.update", payload: { draftId: "x" } }),
    { code: "INVALID_SCHEMA" },
  );
});
test("AI run identity is atomically reserved and cannot trigger duplicate generation", async () => {
  const s = fresh(),
    message = {
      type: "drafts.beginAIRun",
      payload: {
        id: "ai_same",
        status: "running",
        startedAt: Date.now(),
        instruction: "测试",
      },
    };
  const results = await Promise.all([
    executeDraftAPI(s, message),
    executeDraftAPI(s, message),
  ]);
  assert.equal(results.filter((r) => r.created).length, 1);
  assert.equal((await s.all("aiRuns")).length, 1);
});
test("Markdown updates, immutable platform variants and interrupted edits roundtrip safely", async () => {
  const s = fresh();
  const created = await s.mutate(input);
  let d = await s.get("drafts", created.draftId);
  await s.update({
    ...base(d),
    changes: { contentMarkdown: "# 新正文\n\n无需旧 HTML" },
  });
  d = await s.get("drafts", d.id);
  assert.match(d.contentHtml, /新正文/);
  assert.doesNotMatch(d.contentHtml, /保持内容/);
  const request = {
    type: "drafts.createTargetVariant",
    payload: {
      ...base(d),
      platformId: "wechat-official-account",
      changes: { title: "微信版", contentMarkdown: "微信适配正文" },
      requestId: "variant-1",
    },
  };
  const result = await executeDraftAPI(s, request);
  assert.equal(
    (await executeDraftAPI(s, request)).revisionId,
    result.revisionId,
  );
  const revised = await s.get("revisions", result.revisionId);
  assert.match(revised.platformVariant.contentHtml, /微信适配正文/);
  d = await s.get("drafts", d.id);
  await s.update({ ...base(d), changes: { title: "之后修改" } });
  d = await s.get("drafts", d.id);
  await s.restore({ ...base(d), revisionId: result.revisionId });
  d = await s.get("drafts", d.id);
  assert.equal(
    d.targetVariants["wechat-official-account"].revisionId,
    d.currentRevisionId,
  );
  assert.equal(d.targetVariants["wechat-official-account"].title, "微信版");
  const pack = await backupPack(s),
    restored = fresh();
  await importPack(restored, pack);
  assert.equal(
    (await restored.get("drafts", d.id)).targetVariants[
      "wechat-official-account"
    ].title,
    "微信版",
  );
  await assert.rejects(preflight(pack.slice(0, pack.size - 22)), {
    code: "INVALID_PACKAGE",
  });
  await executeDraftAPI(s, { type: "drafts.archive", payload: base(d) });
  assert.equal((await s.get("drafts", d.id)).status, "archived");
  await assert.rejects(
    s.update({
      ...base({ ...d, currentRevisionId: "stale" }),
      changes: { title: "冲突" },
    }),
    { code: "CONFLICT" },
  );
});
test("assets hash deduplicates, shared assets survive collection deletion and retain revision references", async () => {
  const s = fresh();
  const image = new Blob(["image"], { type: "image/png" });
  const hash = await s.asset(image);
  assert.equal(hash, await s.asset(image));
  await s.put("collections", { id: "one", name: "一" });
  await s.put("collections", { id: "two", name: "二" });
  const one = await s.mutate({
    ...input,
    contentHtml: `<p><img src="asset://${hash}">正文</p>`,
    collectionId: "one",
  });
  await s.mutate({ ...input, assetIds: [hash], collectionId: "two" });
  const old = await s.get("drafts", one.draftId);
  await s.update({
    ...base(old),
    changes: { assetIds: [], contentHtml: "<p>去掉图片</p>" },
  });
  assert.equal((await s.get("assets", hash)).refCount, 2);
  await assert.rejects(s.removeCollection("one", false), {
    code: "CONFIRM_REQUIRED",
  });
  await s.removeCollection("one", true);
  assert.equal((await s.get("assets", hash)).refCount, 1);
  await s.removeCollection("two", true);
  assert.equal(await s.get("assets", hash), undefined);
});
async function contentPack(changes = {}) {
  const data = stable({ ...input, collectionId: "collection", ...changes });
  const body = {
    schemaVersion: 1,
    kind: "content",
    packageId: "generic",
    packageVersion: 1,
    expectedCount: 1,
    collections: [{ id: "collection", name: "普通合集" }],
    articles: [
      {
        identity: "article-one",
        path: "articles/one.json",
        bytes: new TextEncoder().encode(data).length,
        checksum: await checksum(data),
      },
    ],
    assets: [],
  };
  return writeZip([
    [
      "manifest.json",
      { ...body, packageChecksum: await checksum(stable(body)) },
    ],
    ["articles/one.json", data],
  ]);
}
test("preflight, idempotent import, import updates, user conflicts and interruption recovery", async () => {
  const s = fresh();
  const pack = await contentPack();
  assert.equal((await preflight(pack)).articles.length, 1);
  assert.equal((await importPack(s, pack)).report.created, 1);
  assert.equal((await importPack(s, pack)).report.skipped, 1);
  assert.equal((await s.all("drafts")).length, 1);
  assert.equal(
    (await importPack(s, await contentPack({ title: "新版" }))).report.updated,
    1,
  );
  const old = (await s.all("drafts"))[0];
  await s.update({ ...base(old), changes: { title: "用户修改" } });
  assert.equal(
    (await importPack(s, await contentPack({ title: "再导入" }))).report
      .conflicts,
    1,
  );
  assert.equal((await s.all("drafts"))[0].title, "用户修改");
  const broken = new Blob([new Uint8Array([1, 2, 3])]);
  await assert.rejects(importPack(s, broken), { code: "INVALID_PACKAGE" });
  assert.equal((await s.all("drafts")).length, 1);
});
test("full backup restores revision identities and assets, reimport has no duplicates", async () => {
  const s = fresh();
  const a = await s.asset(new Blob(["resource"], { type: "image/png" }));
  const r = await s.mutate({ ...input, assetIds: [a] });
  const d = await s.get("drafts", r.draftId);
  await s.update({ ...base(d), changes: { title: "备份新版" } });
  const pack = await backupPack(s);
  const target = fresh();
  const report = await importPack(target, pack);
  assert.equal(report.report.created, 1);
  assert.deepEqual(
    (await target.all("revisions")).map((r) => r.id).sort(),
    (await s.all("revisions")).map((r) => r.id).sort(),
  );
  assert.equal((await target.all("assets")).length, 1);
  assert.equal((await importPack(target, pack)).report.skipped, 1);
  assert.equal((await target.all("drafts")).length, 1);
});
test("range auditing is collection-specific and catches missing and duplicate identities", async () => {
  const d = await normalizeDraft({
    ...input,
    title: "001｜一",
    metadata: { sequence: "001", sourceChecksum: "sha" },
    sourceReferences: [{ type: "wps", url: "https://www.kdocs.cn/l/test" }],
  });
  const report = auditCollection([d, d], [1, 3]);
  assert.deepEqual(report.missing, ["002", "003"]);
  assert.deepEqual(report.duplicates, ["001"]);
  assert.equal(
    auditCollection([await normalizeDraft(input)]).missing.length,
    0,
  );
});
test("database upgrade adds stores without destroying existing records; higher version never clears data", async () => {
  const factory = new IDBFactory();
  const name = "legacy";
  const legacy = await new Promise((resolve, reject) => {
    const r = factory.open(name, 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("drafts", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const tx = legacy.transaction("drafts", "readwrite");
  tx.objectStore("drafts").put({ id: "old", title: "旧数据" });
  await new Promise((resolve) => (tx.oncomplete = resolve));
  legacy.close();
  const s = new DraftStore(factory, name);
  const db = await s.open();
  assert.equal((await s.get("drafts", "old")).title, "旧数据");
  assert.deepEqual([...db.objectStoreNames].sort(), Object.keys(STORES).sort());
  await s.close();
  const upgraded = await new Promise((resolve, reject) => {
    const r = factory.open(name, 4);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("new-store", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  upgraded.close();
  await assert.rejects(new DraftStore(factory, name).open(), {
    name: "VersionError",
  });
});
