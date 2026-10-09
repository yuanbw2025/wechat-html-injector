import "./draft-sanitize.js";
export const SCHEMA_VERSION = 1;
export const LIMITS = Object.freeze({
  draftBytes: 4 * 1024 * 1024,
  assetBytes: 32 * 1024 * 1024,
  packageBytes: 1024 * 1024 * 1024,
  articles: 5000,
});
export class DraftError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}
export const fail = (code, message, detail) => {
  throw new DraftError(code, message, detail);
};
export const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export async function checksum(value) {
  const bytes =
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : value instanceof Blob
        ? await value.arrayBuffer()
        : value;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export function assertObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("INVALID_SCHEMA", "请求必须是对象");
}
export function assertSize(value, limit = LIMITS.draftBytes) {
  if (new TextEncoder().encode(JSON.stringify(value)).length > limit)
    fail("TOO_LARGE", "内容超过允许大小");
}
export function noSecrets(value) {
  if (typeof value === "string") {
    if (
      /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}/.test(
        value,
      )
    )
      fail("CREDENTIAL_DATA", "稿件及备份不得包含凭据");
  } else if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      if (/api.?key|token|password|cookie|authorization|credential/i.test(key))
        fail("CREDENTIAL_DATA", "稿件及备份不得包含凭据字段");
      noSecrets(v);
    }
  }
}
export function escapeHTML(text) {
  return String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
export function safeURL(value, image = false) {
  return globalThis.DraftHTML.safeURL(value, image);
}
export function sanitizeHTML(html) {
  return globalThis.DraftHTML.sanitize(html);
}
export function plainText(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("br").forEach((el) => el.replaceWith("\n"));
  template.content
    .querySelectorAll("p,div,section,li,h1,h2,h3,h4,pre,tr")
    .forEach((el) => el.append("\n"));
  return template.content.textContent.replace(/\n{3,}/g, "\n\n").trim();
}
export function markdownHTML(markdown) {
  let inCode = false;
  const out = [];
  const lines = String(markdown).split("\n");
  for (const line of lines) {
    if (/^```/.test(line)) {
      out.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(`${escapeHTML(line)}\n`);
      continue;
    }
    let text = escapeHTML(line)
      .replace(/!\[([^\]]*)\]\(([^\s)]+)\)/g, '<img alt="$1" src="$2">')
      .replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
    const heading = text.match(/^(#{1,6}) (.*)/);
    out.push(
      heading
        ? `<h${heading[1].length}>${heading[2]}</h${heading[1].length}>`
        : text
          ? `<p>${text.replace(/^[-*] /, "• ")}</p>`
          : "",
    );
  }
  if (inCode) out.push("</code></pre>");
  return sanitizeHTML(out.join("\n"));
}
export async function normalizeDraft(input) {
  assertObject(input);
  assertSize(input);
  noSecrets(input);
  if (
    typeof input.title !== "string" ||
    !input.title.trim() ||
    input.title.length > 300
  )
    fail("INVALID_TITLE", "标题不能为空且不能超过 300 字");
  for (const key of [
    "contentMarkdown",
    "contentHtml",
    "summary",
    "slug",
    "collectionId",
  ])
    if (input[key] !== undefined && typeof input[key] !== "string")
      fail("INVALID_SCHEMA", `${key} 必须是字符串`);
  for (const key of ["tags", "assetIds", "sourceReferences"])
    if (input[key] !== undefined && !Array.isArray(input[key]))
      fail("INVALID_SCHEMA", `${key} 必须是数组`);
  if (input.metadata) assertObject(input.metadata);
  if (input.provenance) assertObject(input.provenance);
  if (
    (input.tags || []).some((v) => typeof v !== "string" || v.length > 100) ||
    (input.tags || []).length > 50
  )
    fail("INVALID_SCHEMA", "标签格式无效");
  const html = sanitizeHTML(
    input.contentHtml !== undefined
      ? input.contentHtml
      : markdownHTML(input.contentMarkdown || ""),
  );
  if (!plainText(html) && !/<img\b/.test(html))
    fail("EMPTY_CONTENT", "不能保存空稿件");
  const assetIds = [
    ...new Set([
      ...(input.assetIds || []),
      ...[...html.matchAll(/asset:\/\/([a-f0-9]{64})/g)].map((m) => m[1]),
    ]),
  ];
  if (assetIds.some((v) => !/^[a-f0-9]{64}$/.test(v)))
    fail("INVALID_ASSET", "资源引用必须是 SHA-256");
  const draft = {
    title: input.title.trim(),
    contentMarkdown: input.contentMarkdown || "",
    contentHtml: html,
    contentPlainText: plainText(html),
    summary: input.summary || "",
    tags: [...new Set(input.tags || [])],
    assetIds,
    collectionId: input.collectionId || "",
    slug: input.slug || "",
    sourceReferences: input.sourceReferences || [],
    provenance: input.provenance || { type: "user" },
    metadata: input.metadata || {},
  };
  return { ...draft, checksum: await revisionChecksum(draft) };
}
export function revisionContent(d) {
  return {
    title: d.title,
    contentMarkdown: d.contentMarkdown,
    contentHtml: d.contentHtml,
    contentPlainText: d.contentPlainText,
    summary: d.summary,
    tags: d.tags,
    assetIds: d.assetIds,
    collectionId: d.collectionId,
    metadata: d.metadata,
    sourceReferences: d.sourceReferences,
  };
}
export const revisionChecksum = (d) => checksum(stable(revisionContent(d)));
export function auditCollection(drafts, range) {
  const counts = new Map();
  const errors = [];
  for (const d of drafts) {
    const n = String(d.metadata?.sequence || "");
    if (n) counts.set(n, (counts.get(n) || 0) + 1);
    if (!d.title || !d.contentHtml || !d.checksum)
      errors.push({ draftId: d.id, error: "标题、正文或 checksum 缺失" });
    if (
      range &&
      (!d.title.includes(n) ||
        !d.metadata?.sourceChecksum ||
        !d.sourceReferences?.some((r) => r.type === "wps" && r.url))
    )
      errors.push({
        draftId: d.id,
        error: "编号、source checksum 或 WPS 来源缺失",
      });
  }
  const expected = range
    ? Array.from({ length: range[1] - range[0] + 1 }, (_, i) =>
        String(i + range[0]).padStart(3, "0"),
      )
    : [];
  return {
    count: drafts.length,
    expectedCount: expected.length || undefined,
    missing: expected.filter((n) => !counts.has(n)),
    duplicates: [...counts].filter(([, v]) => v > 1).map(([n]) => n),
    unexpected: range
      ? [...counts.keys()].filter((n) => !expected.includes(n))
      : [],
    errors,
  };
}
