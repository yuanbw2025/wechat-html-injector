import fs from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";
import { createHash } from "node:crypto";
import {
  stable,
  normalizeDraft,
  auditCollection,
  checksum,
} from "../draft-schema.js";
import { writeZip } from "../content-pack.js";
const args = Object.fromEntries(
  process.argv.slice(2).reduce((out, v, i, a) => {
    if (v.startsWith("--")) out.push([v.slice(2), a[i + 1]]);
    return out;
  }, []),
);
if (!args.source || !args.head || !args.out)
  throw new Error(
    "用法：node scripts/build-storyforge-pack.js --source <diagram-edition> --head <wps-source> --out <content-packs/...sfpack>",
  );
globalThis.document = new JSDOM("").window.document;
const source = JSON.parse(
  await fs.readFile(path.join(args.source, "edition-manifest.json"), "utf8"),
);
const heads = JSON.parse(
  await fs.readFile(path.join(args.head, "index.json"), "utf8"),
);
const assets = new Map();
const articles = [];
const entries = [];
let rawBytes = 0;
let imageReferences = 0;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
for (const item of [...heads, ...source].sort((a, b) =>
  a.number.localeCompare(b.number),
)) {
  const n = item.number;
  let html;
  let markdown = "";
  let readAt;
  let warnings = [];
  if (Number(n) < 5) {
    const data = JSON.parse(
      await fs.readFile(path.join(args.head, `${n}.json`), "utf8"),
    );
    markdown = data.content;
    readAt = data.readAt;
    warnings = data.warnings || [];
    const blocks = [
      ...markdown.matchAll(
        /```(?:html|HTML|plaintext|text)?\s*\n([\s\S]*?)```/g,
      ),
    ]
      .map((m) => m[1])
      .filter((s) => /^\s*<(?:section|div|html|!doctype)/i.test(s));
    html = blocks.sort((a, b) => b.length - a.length)[0];
    if (!html) throw new Error(`${n} 未找到完整内联 HTML，禁止用占位补齐`);
  } else {
    const folder = path.join(args.source, n);
    html = await fs.readFile(path.join(folder, "html-code.txt"), "utf8");
  }
  rawBytes += Buffer.byteLength(html);
  const sourceChecksum = sha(html);
  if (item.sha256 && sourceChecksum !== item.sha256)
    throw new Error(`${n} 源 checksum 不匹配`);
  html = html.replace(
    /data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=\r\n]+)/gi,
    (url, format, base64) => {
      const bytes = Buffer.from(base64.replace(/\s/g, ""), "base64");
      const hash = sha(bytes);
      imageReferences++;
      if (!assets.has(hash))
        assets.set(hash, {
          bytes,
          mimeType: `image/${format.toLowerCase()}`,
          path: `assets/${hash}.${format.toLowerCase() === "jpeg" ? "jpg" : format.toLowerCase()}`,
        });
      return `asset://${hash}`;
    },
  );
  const title = `${n}｜${item.title.replace(/^\d{3}[_｜|\s-]*/, "")}`;
  const draft = await normalizeDraft({
    title,
    contentHtml: html,
    contentMarkdown: "",
    tags: ["宣传稿"],
    collectionId: "storyforge-promo",
    sourceReferences: [
      {
        type: "wps",
        url: item.url,
        readAt: readAt || "historical-local-artifact",
        warnings,
      },
    ],
    provenance: { type: "import", source: "wps" },
    metadata: {
      sequence: n,
      source: "wps",
      sourceChecksum,
      sourceSnapshot: readAt || "diagram-edition historical local snapshot",
      imageStatus: "needs-platform-upload",
      wechatExportStatus: "not-exported",
      userConfirmedSaved: false,
    },
  });
  const file = `articles/${n}.json`;
  const data = stable(draft);
  entries.push([file, data]);
  articles.push({
    identity: `storyforge-promo:${n}`,
    path: file,
    sequence: n,
    title: draft.title,
    bytes: Buffer.byteLength(data),
    checksum: await checksum(data),
    sourceChecksum,
  });
}
const collection = {
  id: "storyforge-promo",
  name: "StoryForge 宣传文章",
  expectedRange: [1, 151],
  source: "wps",
};
const assetIndex = [];
for (const [hash, a] of assets) {
  entries.push([a.path, new Blob([a.bytes])]);
  assetIndex.push({
    sha256: hash,
    path: a.path,
    mimeType: a.mimeType,
    bytes: a.bytes.length,
    checksum: hash,
  });
}
const normalized = [];
for (const [, data] of entries.filter(([p]) => p.startsWith("articles/")))
  normalized.push(JSON.parse(data));
const audit = auditCollection(normalized, [1, 151]);
if (
  audit.count !== 151 ||
  audit.missing.length ||
  audit.duplicates.length ||
  audit.errors.length ||
  audit.unexpected.length
)
  throw new Error(`完整性校验失败 ${JSON.stringify(audit)}`);
const body = {
  schemaVersion: 1,
  kind: "content",
  packageId: "storyforge-promo",
  packageVersion: 1,
  generatedAt: new Date().toISOString(),
  expectedCount: 151,
  expectedRange: [1, 151],
  collections: [collection],
  articles,
  assets: assetIndex,
};
const manifest = { ...body, packageChecksum: await checksum(stable(body)) };
entries.unshift(["manifest.json", manifest]);
const blob = await writeZip(entries);
await fs.mkdir(path.dirname(args.out), { recursive: true });
await fs.writeFile(args.out, new Uint8Array(await blob.arrayBuffer()));
const report = {
  ...audit,
  rawHtmlBytes: rawBytes,
  packageBytes: blob.size,
  imageReferences,
  uniqueImages: assets.size,
  uniqueImageBytes: [...assets.values()].reduce(
    (n, a) => n + a.bytes.length,
    0,
  ),
  removedDuplicateImages: imageReferences - assets.size,
  sourceSnapshotWarning:
    "001—004 freshly read from WPS; 005—151 provided historical diagram-edition artifacts, not claimed as current WPS contents.",
  wechatCDNMappings: 0,
  exportedToWechat: 0,
  userConfirmedSaved: 0,
  published: 0,
};
await fs.writeFile(`${args.out}.audit.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
