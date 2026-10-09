import {
  stable,
  checksum,
  fail,
  assertObject,
  noSecrets,
  normalizeDraft,
  revisionChecksum,
  SCHEMA_VERSION,
  LIMITS,
} from "./draft-schema.js";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export async function writeZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [path, data] of entries) {
    const name = encoder.encode(path);
    const blob =
      data instanceof Blob
        ? data
        : new Blob([typeof data === "string" ? data : JSON.stringify(data)]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const crc = crc32(bytes);
    const header = new Uint8Array(30 + name.length);
    const v = new DataView(header.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x800, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, blob.size, true);
    v.setUint32(22, blob.size, true);
    v.setUint16(26, name.length, true);
    header.set(name, 30);
    parts.push(header, blob);
    const directory = new Uint8Array(46 + name.length);
    const d = new DataView(directory.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0x800, true);
    d.setUint32(16, crc, true);
    d.setUint32(20, blob.size, true);
    d.setUint32(24, blob.size, true);
    d.setUint16(28, name.length, true);
    d.setUint32(42, offset, true);
    directory.set(name, 46);
    central.push(directory);
    offset += header.length + blob.size;
  }
  const centralBytes = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, central.length, true);
  v.setUint16(10, central.length, true);
  v.setUint32(12, centralBytes, true);
  v.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
export async function readZip(blob) {
  if (blob.size > LIMITS.packageBytes) fail("TOO_LARGE", "内容包超过 1 GiB");
  const entries = new Map();
  const localRecords = new Map();
  let offset = 0;
  while (offset + 4 <= blob.size) {
    const sig = new DataView(
      await blob.slice(offset, offset + 4).arrayBuffer(),
    ).getUint32(0, true);
    if (sig === 0x02014b50) break;
    if (sig !== 0x04034b50) fail("INVALID_PACKAGE", "ZIP 结构无效");
    const v = new DataView(await blob.slice(offset, offset + 30).arrayBuffer());
    const flags = v.getUint16(6, true);
    const size = v.getUint32(18, true);
    const nameLength = v.getUint16(26, true);
    const extra = v.getUint16(28, true);
    if (
      v.getUint16(8, true) !== 0 ||
      flags & 9 ||
      v.getUint32(22, true) !== size
    )
      fail("INVALID_PACKAGE", "仅支持 sfpack 的 ZIP STORE 格式");
    const path = decoder.decode(
      await blob.slice(offset + 30, offset + 30 + nameLength).arrayBuffer(),
    );
    if (
      !/^[a-zA-Z0-9_./-]+$/.test(path) ||
      path.startsWith("/") ||
      path.split("/").includes("..") ||
      entries.has(path)
    )
      fail("INVALID_PACKAGE", "重复或不安全的 ZIP 路径");
    const start = offset + 30 + nameLength + extra;
    if (start + size > blob.size) fail("INVALID_PACKAGE", "内容包已截断");
    const data = blob.slice(start, start + size);
    if (
      crc32(new Uint8Array(await data.arrayBuffer())) !== v.getUint32(14, true)
    )
      fail("INVALID_PACKAGE", `CRC 不匹配：${path}`);
    entries.set(path, data);
    localRecords.set(path, { offset, size, crc: v.getUint32(14, true) });
    offset = start + size;
    if (entries.size > 30000) fail("TOO_LARGE", "内容包条目过多");
  }
  const directoryStart = offset;
  const seen = new Set();
  while (offset + 46 <= blob.size) {
    const v = new DataView(await blob.slice(offset, offset + 46).arrayBuffer());
    if (v.getUint32(0, true) !== 0x02014b50) break;
    const n = v.getUint16(28, true),
      extra = v.getUint16(30, true),
      comment = v.getUint16(32, true);
    const name = decoder.decode(
      await blob.slice(offset + 46, offset + 46 + n).arrayBuffer(),
    );
    const local = localRecords.get(name);
    if (
      !local ||
      seen.has(name) ||
      v.getUint16(10, true) !== 0 ||
      v.getUint16(8, true) & 9 ||
      v.getUint32(20, true) !== local.size ||
      v.getUint32(24, true) !== local.size ||
      v.getUint32(16, true) !== local.crc ||
      v.getUint32(42, true) !== local.offset
    )
      fail("INVALID_PACKAGE", "ZIP 中央目录与内容不一致");
    seen.add(name);
    offset += 46 + n + extra + comment;
  }
  const directorySize = offset - directoryStart;
  if (offset + 22 > blob.size) fail("INVALID_PACKAGE", "ZIP 结尾已截断");
  const end = new DataView(await blob.slice(offset, offset + 22).arrayBuffer());
  if (
    end.getUint32(0, true) !== 0x06054b50 ||
    end.getUint16(4, true) !== 0 ||
    end.getUint16(6, true) !== 0 ||
    end.getUint16(8, true) !== entries.size ||
    end.getUint16(10, true) !== entries.size ||
    seen.size !== entries.size ||
    end.getUint32(12, true) !== directorySize ||
    end.getUint32(16, true) !== directoryStart ||
    offset + 22 + end.getUint16(20, true) !== blob.size
  )
    fail("INVALID_PACKAGE", "ZIP 结尾或条目数量无效");
  if (!entries.has("manifest.json"))
    fail("INVALID_PACKAGE", "缺少 manifest.json");
  return entries;
}
export async function preflight(blob) {
  const entries = await readZip(blob);
  const manifestBlob = entries.get("manifest.json");
  if (manifestBlob.size > 4 * 1024 * 1024) fail("TOO_LARGE", "manifest 过大");
  const manifest = JSON.parse(await manifestBlob.text());
  assertObject(manifest);
  noSecrets(manifest);
  if (
    manifest.schemaVersion !== SCHEMA_VERSION ||
    !["content", "backup"].includes(manifest.kind) ||
    typeof manifest.packageId !== "string" ||
    !Array.isArray(manifest.articles) ||
    !Array.isArray(manifest.assets) ||
    !Array.isArray(manifest.collections) ||
    manifest.articles.length > LIMITS.articles ||
    manifest.expectedCount !== manifest.articles.length
  )
    fail("INVALID_PACKAGE", "manifest 格式或 schema 版本无效");
  const { packageChecksum, ...body } = manifest;
  if ((await checksum(stable(body))) !== packageChecksum)
    fail("INVALID_PACKAGE", "manifest checksum 不匹配");
  const paths = new Set(["manifest.json"]);
  const identities = new Set();
  for (const entry of [
    ...manifest.articles,
    ...manifest.assets,
    ...(manifest.records || []),
  ]) {
    assertObject(entry);
    if (paths.has(entry.path)) fail("INVALID_PACKAGE", "重复的 manifest 路径");
    paths.add(entry.path);
    const data = entries.get(entry.path);
    if (
      !data ||
      data.size !== entry.bytes ||
      (await checksum(data)) !== entry.checksum
    )
      fail("INVALID_PACKAGE", `文件校验失败：${entry.path}`);
  }
  for (const a of manifest.assets)
    if (
      !/^[a-f0-9]{64}$/.test(a.sha256) ||
      a.checksum !== a.sha256 ||
      a.bytes > LIMITS.assetBytes ||
      !entries.has(a.path)
    )
      fail("INVALID_PACKAGE", "资源索引无效");
  for (const a of manifest.assets)
    if (
      !/^(image\/(png|jpeg|gif|webp)|application\/(pdf|octet-stream)|text\/plain)$/.test(
        a.mimeType,
      )
    )
      fail("INVALID_PACKAGE", "资源 MIME 无效");
  if (entries.size !== paths.size)
    fail("INVALID_PACKAGE", "ZIP 含未声明的文件");
  for (const c of manifest.collections) {
    assertObject(c);
    noSecrets(c);
    if (
      typeof c.id !== "string" ||
      typeof c.name !== "string" ||
      !c.name.trim()
    )
      fail("INVALID_PACKAGE", "合集格式无效");
    if (
      c.expectedRange &&
      (!Array.isArray(c.expectedRange) ||
        c.expectedRange.length !== 2 ||
        !c.expectedRange.every(Number.isInteger) ||
        c.expectedRange[0] < 1 ||
        c.expectedRange[1] < c.expectedRange[0] ||
        c.expectedRange[1] - c.expectedRange[0] > LIMITS.articles)
    )
      fail("INVALID_PACKAGE", "合集审计范围无效");
  }
  const declaredAssets = new Set(manifest.assets.map((a) => a.sha256));
  const articles = [];
  for (const item of manifest.articles) {
    if (identities.has(item.identity) || typeof item.identity !== "string")
      fail("INVALID_PACKAGE", "稿件身份重复");
    identities.add(item.identity);
    const file = entries.get(item.path);
    if (file.size > LIMITS.draftBytes) fail("TOO_LARGE", "单篇过大");
    const raw = JSON.parse(await file.text());
    const normalized = await normalizeDraft(raw);
    for (const hash of normalized.assetIds)
      if (!declaredAssets.has(hash))
        fail("INVALID_PACKAGE", "稿件引用未声明的资源");
    articles.push({ index: item, raw, normalized });
  }
  const records = {};
  for (const record of manifest.records || []) {
    if (
      !["revisions", "exportReceipts", "aiRuns", "imports"].includes(
        record.store,
      )
    )
      fail("INVALID_PACKAGE", "未知备份记录");
    records[record.store] = JSON.parse(await entries.get(record.path).text());
    noSecrets(records[record.store]);
    if (!Array.isArray(records[record.store]))
      fail("INVALID_PACKAGE", "备份记录必须是数组");
  }
  if (manifest.kind === "backup") {
    const validateVariant = async (v) => {
      if (
        !v ||
        !["wechat-official-account", "html", "markdown"].includes(
          v.platformId,
        ) ||
        !v.content
      )
        fail("INVALID_PACKAGE", "平台适配版本无效");
      const clean = await normalizeDraft(v.content);
      if (
        clean.checksum !== v.checksum ||
        clean.title !== v.title ||
        clean.contentHtml !== v.contentHtml ||
        clean.contentMarkdown !== v.contentMarkdown ||
        clean.assetIds.some((hash) => !declaredAssets.has(hash))
      )
        fail("INVALID_PACKAGE", "平台适配版本校验失败");
    };
    const drafts = new Map(articles.map(({ raw }) => [raw.id, raw]));
    if (drafts.size !== articles.length || drafts.has(undefined))
      fail("INVALID_PACKAGE", "备份稿件身份无效");
    const revisions = new Map();
    for (const r of records.revisions || []) {
      if (
        !r.id ||
        revisions.has(r.id) ||
        !drafts.has(r.draftId) ||
        (await revisionChecksum(r)) !== r.checksum
      )
        fail("INVALID_PACKAGE", "备份历史版本无效");
      const clean = await normalizeDraft(r);
      if (clean.checksum !== r.checksum)
        fail("INVALID_PACKAGE", "备份历史版本 HTML 校验失败");
      for (const hash of r.assetIds)
        if (!declaredAssets.has(hash))
          fail("INVALID_PACKAGE", "历史版本缺少资源");
      if (r.platformVariant) await validateVariant(r.platformVariant);
      revisions.set(r.id, r);
    }
    for (const { raw, normalized } of articles) {
      for (const v of Object.values(raw.targetVariants || {}))
        await validateVariant(v);
      const r = revisions.get(raw.currentRevisionId);
      if (
        !r ||
        r.draftId !== raw.id ||
        r.checksum !== normalized.checksum ||
        !["draft", "archived"].includes(raw.status)
      )
        fail("INVALID_PACKAGE", "备份缺少有效当前版本");
    }
  }
  return { manifest, entries, articles, records };
}
const idb = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
async function restoreBackup(store, pack, report) {
  const { manifest, articles, records } = pack;
  await store.transaction(
    [
      "drafts",
      "revisions",
      "collections",
      "assets",
      "aiRuns",
      "imports",
      "exportReceipts",
    ],
    "readwrite",
    async (tx) => {
      const ds = tx.objectStore("drafts");
      const accepted = new Set();
      for (const { raw, normalized, index } of articles) {
        const old = await idb(ds.get(raw.id));
        const other = await idb(ds.index("importIdentity").get(index.identity));
        if (
          (other && other.id !== raw.id) ||
          (old && old.checksum !== normalized.checksum)
        ) {
          report.conflicts++;
          continue;
        }
        accepted.add(raw.id);
        if (old) {
          report.skipped++;
        } else {
          await idb(
            ds.add({ ...raw, ...normalized, importIdentity: index.identity }),
          );
          report.created++;
        }
      }
      for (const c of manifest.collections)
        if (!(await idb(tx.objectStore("collections").get(c.id))))
          await idb(tx.objectStore("collections").add(c));
      for (const [name, items] of Object.entries(records))
        for (const item of items) {
          if (item.draftId && !accepted.has(item.draftId)) continue;
          const s = tx.objectStore(name);
          const old = await idb(s.get(item.id));
          if (old) {
            if (
              name === "revisions" &&
              (old.checksum !== item.checksum ||
                stable(old.platformVariant) !== stable(item.platformVariant))
            )
              fail("BACKUP_CONFLICT", "不可变历史版本身份冲突");
            continue;
          }
          await idb(s.add(item));
        }
      const refs = new Map();
      for (const r of await idb(tx.objectStore("revisions").getAll()))
        for (const hash of r.assetIds) {
          if (!refs.has(hash)) refs.set(hash, new Set());
          refs.get(hash).add(r.draftId);
        }
      const assets = tx.objectStore("assets");
      for (const a of await idb(assets.getAll())) {
        a.refCount = refs.get(a.sha256)?.size || 0;
        const metadata = manifest.assets.find(
          (m) => m.sha256 === a.sha256,
        )?.metadata;
        if (metadata?.platformMappings)
          a.platformMappings = {
            ...metadata.platformMappings,
            ...a.platformMappings,
          };
        await idb(assets.put(a));
      }
      report.status = report.conflicts ? "partial" : "complete";
      await idb(tx.objectStore("imports").put(report));
    },
  );
  return {
    ok: true,
    report,
    audits: await Promise.all(
      manifest.collections.map(async (c) => ({
        collectionId: c.id,
        ...(await store.audit(c.id)),
      })),
    ),
  };
}
export async function importPack(store, blob, { preview = false } = {}) {
  const pack = await preflight(blob);
  const { manifest, entries, articles, records } = pack;
  if (preview)
    return {
      ok: true,
      manifest,
      count: articles.length,
      assetBytes: manifest.assets.reduce((n, a) => n + a.bytes, 0),
    };
  const report = {
    id: `import_${manifest.packageChecksum}`,
    packageId: manifest.packageId,
    schemaVersion: manifest.schemaVersion,
    checksum: manifest.packageChecksum,
    importedAt: Date.now(),
    created: 0,
    updated: 0,
    skipped: 0,
    conflicts: 0,
    errors: [],
    status: "running",
  };
  await store.put("imports", report);
  for (const a of manifest.assets) {
    const hash = await store.asset(
      new Blob([entries.get(a.path)], { type: a.mimeType }),
    );
    if (hash !== a.sha256) fail("INVALID_PACKAGE", "资源 hash 不匹配");
  }
  if (manifest.kind === "backup") return restoreBackup(store, pack, report);
  for (const c of manifest.collections) {
    assertObject(c);
    noSecrets(c);
    if (typeof c.id !== "string" || typeof c.name !== "string")
      fail("INVALID_PACKAGE", "合集格式错误");
    const existing = await store.get("collections", c.id);
    if (!existing) await store.put("collections", c);
  }
  for (const { index, raw, normalized } of articles) {
    try {
      const existing = (await store.all("drafts")).find(
        (d) =>
          d.importIdentity === index.identity ||
          (manifest.kind === "backup" && d.id === raw.id),
      );
      if (existing?.checksum === normalized.checksum) {
        report.skipped++;
        continue;
      }
      if (existing && existing.checksum !== existing.lastImportedChecksum) {
        report.conflicts++;
        continue;
      }
      if (manifest.kind === "backup" && !existing) {
        if (!raw.id || !raw.currentRevisionId)
          fail("INVALID_PACKAGE", "备份身份缺失");
        await store.put("drafts", {
          ...raw,
          ...normalized,
          importIdentity: index.identity,
        });
        report.created++;
      } else {
        const result = await store.mutate(normalized, {
          draftId: existing?.id,
          baseRevisionId: existing?.currentRevisionId,
          expectedChecksum: existing?.checksum,
          importIdentity: index.identity,
          source: "import",
          requestId: `${manifest.packageChecksum}:${index.identity}`,
        });
        const d = await store.get("drafts", result.draftId);
        d.lastImportedChecksum = d.checksum;
        await store.put("drafts", d);
        existing ? report.updated++ : report.created++;
      }
    } catch (e) {
      report.errors.push({ identity: index.identity, error: e.message });
    }
    await store.put("imports", report);
  }
  // Recompute references including immutable historical revisions.
  const refs = new Map();
  for (const r of await store.all("revisions"))
    for (const hash of r.assetIds) {
      if (!refs.has(hash)) refs.set(hash, new Set());
      refs.get(hash).add(r.draftId);
    }
  for (const a of await store.all("assets")) {
    a.refCount = refs.get(a.sha256)?.size || 0;
    await store.put("assets", a);
  }
  report.status =
    report.errors.length || report.conflicts ? "partial" : "complete";
  await store.put("imports", report);
  return {
    ok: true,
    report,
    audits: await Promise.all(
      manifest.collections.map(async (c) => ({
        collectionId: c.id,
        ...(await store.audit(c.id)),
      })),
    ),
  };
}
export async function backupPack(store, filter = {}) {
  const snapshot = await store.snapshot();
  const drafts = snapshot.drafts.filter(
    (d) =>
      (!filter.draftId || d.id === filter.draftId) &&
      (!filter.collectionId || d.collectionId === filter.collectionId),
  );
  const ids = new Set(drafts.map((d) => d.id));
  const revisions = snapshot.revisions.filter((r) => ids.has(r.draftId));
  const hashes = new Set(revisions.flatMap((r) => r.assetIds));
  const assets = snapshot.assets.filter((a) => hashes.has(a.sha256));
  const collections = snapshot.collections.filter((c) =>
    drafts.some((d) => d.collectionId === c.id),
  );
  const entries = [];
  const articles = [];
  const assetIndex = [];
  const records = [];
  for (const draft of drafts) {
    const path = `articles/${draft.id}.json`;
    const data = stable(draft);
    noSecrets(draft);
    entries.push([path, data]);
    articles.push({
      identity: draft.importIdentity || draft.id,
      path,
      bytes: encoder.encode(data).length,
      checksum: await checksum(data),
    });
  }
  for (const a of assets) {
    const path = `assets/${a.sha256}`;
    entries.push([path, a.blob]);
    assetIndex.push({
      sha256: a.sha256,
      path,
      bytes: a.bytes,
      mimeType: a.mimeType,
      checksum: a.sha256,
      metadata: { platformMappings: a.platformMappings },
    });
  }
  for (const [name, data] of [
    ["revisions", revisions],
    [
      "exportReceipts",
      snapshot.exportReceipts.filter((r) => ids.has(r.draftId)),
    ],
    ["aiRuns", snapshot.aiRuns.filter((r) => !r.draftId || ids.has(r.draftId))],
    ["imports", snapshot.imports],
  ]) {
    noSecrets(data);
    const path = `records/${name}.json`;
    const text = stable(data);
    entries.push([path, text]);
    records.push({
      store: name,
      path,
      bytes: encoder.encode(text).length,
      checksum: await checksum(text),
    });
  }
  const body = {
    schemaVersion: SCHEMA_VERSION,
    kind: "backup",
    packageId: `backup_${Date.now()}`,
    packageVersion: 1,
    generatedAt: new Date().toISOString(),
    expectedCount: drafts.length,
    collections,
    articles,
    assets: assetIndex,
    records,
  };
  entries.unshift([
    "manifest.json",
    { ...body, packageChecksum: await checksum(stable(body)) },
  ]);
  return writeZip(entries);
}
