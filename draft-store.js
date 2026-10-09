import {
  id,
  fail,
  normalizeDraft,
  revisionContent,
  revisionChecksum,
  checksum,
  auditCollection,
  SCHEMA_VERSION,
  LIMITS,
} from "./draft-schema.js";
export const DB_NAME = "ai-draft-workspace-v1";
export const DB_VERSION = 3;
export const STORES = {
  drafts: "id",
  revisions: "id",
  assets: "sha256",
  collections: "id",
  aiRuns: "id",
  exportReceipts: "id",
  imports: "id",
  operations: "id",
  workingCopies: "id",
};
const request = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
export class DraftStore {
  constructor(factory = indexedDB, name = DB_NAME) {
    this.factory = factory;
    this.name = name;
    this.opening = null;
  }
  open() {
    if (this.opening) return this.opening;
    this.opening = new Promise((resolve, reject) => {
      const req = this.factory.open(this.name, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [name, keyPath] of Object.entries(STORES))
          if (!db.objectStoreNames.contains(name))
            db.createObjectStore(name, { keyPath });
        const drafts = req.transaction.objectStore("drafts");
        if (!drafts.indexNames.contains("importIdentity"))
          drafts.createIndex("importIdentity", "importIdentity", {
            unique: true,
          });
        for (const [store, key] of [
          ["revisions", "draftId"],
          ["drafts", "collectionId"],
          ["exportReceipts", "draftId"],
        ]) {
          const s = req.transaction.objectStore(store);
          if (!s.indexNames.contains(key)) s.createIndex(key, key);
        }
      };
      req.onerror = () => {
        this.opening = null;
        reject(req.error);
      };
      req.onblocked = () => {
        this.opening = null;
        reject(new Error("请关闭旧稿件库页面后重试升级"));
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          this.opening = null;
        };
        resolve(db);
      };
    });
    return this.opening;
  }
  async close() {
    if (this.opening) (await this.opening).close();
    this.opening = null;
  }
  async transaction(stores, mode, fn) {
    const db = await this.open();
    const tx = db.transaction(stores, mode);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error("事务已回滚"));
      tx.onerror = () => {};
    });
    try {
      const result = await fn(tx);
      await done;
      return result;
    } catch (e) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw e;
    }
  }
  get(store, key) {
    return this.transaction([store], "readonly", (tx) =>
      request(tx.objectStore(store).get(key)),
    );
  }
  all(store) {
    return this.transaction([store], "readonly", (tx) =>
      request(tx.objectStore(store).getAll()),
    );
  }
  put(store, value) {
    return this.transaction([store], "readwrite", (tx) =>
      request(tx.objectStore(store).put(value)),
    );
  }
  async mutate(
    input,
    {
      draftId,
      baseRevisionId,
      expectedChecksum,
      source = "user",
      aiRunId,
      requestId,
      importIdentity,
      variant,
    } = {},
  ) {
    const content = await normalizeDraft(input);
    const inputChecksum = await checksum(
      JSON.stringify([
        content.checksum,
        variant ? [variant.platformId, variant.checksum] : null,
      ]),
    );
    const now = Date.now();
    const revisionId = id("revision");
    return this.transaction(
      ["drafts", "revisions", "assets", "operations"],
      "readwrite",
      async (tx) => {
        const ops = tx.objectStore("operations");
        if (requestId) {
          const existing = await request(ops.get(requestId));
          if (existing) {
            if (
              existing.inputChecksum !== inputChecksum ||
              existing.inputDraftId !== draftId
            )
              fail("REQUEST_ID_REUSED", "同一个 requestId 不能提交不同内容");
            return existing.result;
          }
        }
        const ds = tx.objectStore("drafts");
        const old = draftId ? await request(ds.get(draftId)) : null;
        if (draftId && !old) fail("NOT_FOUND", "稿件不存在");
        if (
          old &&
          (old.currentRevisionId !== baseRevisionId ||
            old.checksum !== expectedChecksum)
        )
          fail("CONFLICT", "稿件已被其他操作修改，请重新读取后比较", {
            currentRevisionId: old.currentRevisionId,
            currentChecksum: old.checksum,
          });
        if (importIdentity) {
          const duplicate = await request(
            ds.index("importIdentity").get(importIdentity),
          );
          if (duplicate && duplicate.id !== draftId)
            fail("IMPORT_CONFLICT", "该导入身份已存在");
        }
        const historic = old
          ? await request(
              tx.objectStore("revisions").index("draftId").getAll(old.id),
            )
          : [];
        const used = new Set(historic.flatMap((r) => r.assetIds));
        for (const hash of content.assetIds) {
          const asset = await request(tx.objectStore("assets").get(hash));
          if (!asset) fail("MISSING_ASSET", `缺少资源 ${hash}`);
          if (!used.has(hash)) {
            asset.refCount++;
            asset.updatedAt = now;
            await request(tx.objectStore("assets").put(asset));
          }
        }
        // Historical versions retain resources. refCount counts drafts referencing an asset in any version.
        const revision = {
          id: revisionId,
          draftId: old?.id || id("draft"),
          parentRevisionId: old?.currentRevisionId,
          ...revisionContent(content),
          ...(variant ? { platformVariant: variant } : {}),
          source,
          aiRunId,
          checksum: content.checksum,
          createdAt: now,
        };
        const draft = {
          ...old,
          ...content,
          id: revision.draftId,
          currentRevisionId: revisionId,
          status: old?.status || "draft",
          targetVariants: old?.targetVariants || {},
          exportReceiptIds: old?.exportReceiptIds || [],
          createdAt: old?.createdAt || now,
          updatedAt: now,
          provenance:
            source === "ai"
              ? { ...content.provenance, type: "ai" }
              : content.provenance,
        };
        if (importIdentity) draft.importIdentity = importIdentity;
        if (variant)
          draft.targetVariants = {
            ...draft.targetVariants,
            [variant.platformId]: { ...variant, revisionId },
          };
        await request(tx.objectStore("revisions").add(revision));
        await request(ds.put(draft));
        const result = {
          ok: true,
          draftId: draft.id,
          revisionId,
          checksum: content.checksum,
          status: draft.status,
        };
        if (requestId)
          await request(
            ops.add({
              id: requestId,
              result,
              inputChecksum,
              inputDraftId: draftId,
              createdAt: now,
            }),
          );
        return result;
      },
    );
  }
  async update(payload, context = {}) {
    const old = await this.get("drafts", payload.draftId);
    if (!old) fail("NOT_FOUND", "稿件不存在");
    return this.mutate(
      {
        ...old,
        ...payload.changes,
        ...(payload.changes?.contentMarkdown !== undefined &&
        payload.changes?.contentHtml === undefined
          ? { contentHtml: undefined }
          : {}),
      },
      { ...payload, ...context },
    );
  }
  async restore(payload, context = {}) {
    const revision = await this.get("revisions", payload.revisionId);
    if (!revision || revision.draftId !== payload.draftId)
      fail("NOT_FOUND", "版本不存在");
    const old = await this.get("drafts", payload.draftId);
    return this.mutate(
      { ...old, ...revisionContent(revision) },
      { ...context, ...payload, variant: revision.platformVariant },
    );
  }
  archive(payload) {
    return this.transaction(["drafts"], "readwrite", async (tx) => {
      const s = tx.objectStore("drafts");
      const d = await request(s.get(payload.draftId));
      if (
        !d ||
        d.currentRevisionId !== payload.baseRevisionId ||
        d.checksum !== payload.expectedChecksum
      )
        fail("CONFLICT", "归档前请重新读取稿件");
      d.status = "archived";
      d.updatedAt = Date.now();
      await request(s.put(d));
      return { ok: true };
    });
  }
  async asset(blob, mimeType = blob.type) {
    if (
      !(blob instanceof Blob) ||
      blob.size > LIMITS.assetBytes ||
      !/^(image\/(png|jpeg|gif|webp)|application\/(pdf|octet-stream)|text\/plain)$/.test(
        mimeType,
      )
    )
      fail("INVALID_ASSET", "资源类型或体积不支持");
    const hash = await checksum(blob);
    const now = Date.now();
    await this.transaction(["assets"], "readwrite", async (tx) => {
      const s = tx.objectStore("assets");
      if (!(await request(s.get(hash))))
        await request(
          s.add({
            sha256: hash,
            blob,
            mimeType,
            bytes: blob.size,
            refCount: 0,
            platformMappings: {},
            createdAt: now,
            updatedAt: now,
          }),
        );
    });
    return hash;
  }
  async receipt(payload) {
    const now = Date.now();
    const receipt = {
      ...payload,
      id: payload.id || id("export"),
      createdAt: payload.createdAt || now,
      updatedAt: now,
    };
    await this.transaction(
      ["drafts", "exportReceipts"],
      "readwrite",
      async (tx) => {
        const ds = tx.objectStore("drafts");
        const d = await request(ds.get(payload.draftId));
        if (!d) fail("NOT_FOUND", "稿件不存在");
        d.exportReceiptIds = [...new Set([...d.exportReceiptIds, receipt.id])];
        await request(ds.put(d));
        await request(tx.objectStore("exportReceipts").put(receipt));
      },
    );
    return receipt;
  }
  async list(filter = {}) {
    let drafts = await this.all("drafts");
    const query = String(filter.query || "").toLowerCase();
    drafts = drafts.filter(
      (d) =>
        (!filter.draftId || d.id === filter.draftId) &&
        (!filter.collectionId || d.collectionId === filter.collectionId) &&
        (!filter.status || d.status === filter.status) &&
        (!filter.tag || d.tags.includes(filter.tag)) &&
        (!query ||
          `${d.title} ${d.tags.join(" ")} ${d.contentPlainText}`
            .toLowerCase()
            .includes(query)),
    );
    return drafts.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async audit(collectionId) {
    const c = await this.get("collections", collectionId);
    return auditCollection(await this.list({ collectionId }), c?.expectedRange);
  }
  async removeCollection(collectionId, confirmed) {
    if (confirmed !== true) fail("CONFIRM_REQUIRED", "删除合集需要明确确认");
    return this.transaction(
      [
        "drafts",
        "revisions",
        "assets",
        "exportReceipts",
        "collections",
        "operations",
        "workingCopies",
      ],
      "readwrite",
      async (tx) => {
        const drafts = await request(tx.objectStore("drafts").getAll());
        const removed = new Set(
          drafts
            .filter((d) => d.collectionId === collectionId)
            .map((d) => d.id),
        );
        for (const store of ["drafts", "revisions", "exportReceipts"]) {
          const s = tx.objectStore(store);
          for (const item of await request(s.getAll()))
            if (removed.has(store === "drafts" ? item.id : item.draftId))
              await request(s.delete(item.id));
        }
        for (const name of ["operations", "workingCopies"]) {
          const s = tx.objectStore(name);
          for (const record of await request(s.getAll()))
            if (removed.has(record.draftId || record.result?.draftId))
              await request(s.delete(record.id));
        }
        const references = new Map();
        for (const r of await request(tx.objectStore("revisions").getAll()))
          for (const hash of r.assetIds) {
            if (!references.has(hash)) references.set(hash, new Set());
            references.get(hash).add(r.draftId);
          }
        const assets = tx.objectStore("assets");
        let freedBytes = 0;
        for (const a of await request(assets.getAll())) {
          a.refCount = references.get(a.sha256)?.size || 0;
          if (!a.refCount) {
            freedBytes += a.bytes;
            await request(assets.delete(a.sha256));
          } else await request(assets.put(a));
        }
        await request(tx.objectStore("collections").delete(collectionId));
        return { ok: true, removed: removed.size, freedBytes };
      },
    );
  }
  async stats() {
    const drafts = await this.all("drafts");
    const assets = await this.all("assets");
    const receipts = await this.all("exportReceipts");
    return {
      drafts: drafts.length,
      assetCount: assets.length,
      assetBytes: assets.reduce((n, a) => n + a.bytes, 0),
      exported: receipts.filter((r) =>
        ["exported", "verified", "user-confirmed-saved"].includes(r.status),
      ).length,
      verified: receipts.filter((r) =>
        ["verified", "user-confirmed-saved"].includes(r.status),
      ).length,
      userConfirmedSaved: receipts.filter(
        (r) => r.status === "user-confirmed-saved",
      ).length,
      published: 0,
    };
  }
  async snapshot(names = Object.keys(STORES)) {
    return this.transaction(names, "readonly", async (tx) => {
      const values = await Promise.all(
        names.map((name) => request(tx.objectStore(name).getAll())),
      );
      return Object.fromEntries(names.map((name, i) => [name, values[i]]));
    });
  }
}
