#!/usr/bin/env node
// Same-user authenticated mailbox; the extension must explicitly enable the gateway.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const dir = path.join(os.homedir(), ".yunzhongshu", "draft-gateway");
const allowed = new Set([
  "drafts.create",
  "drafts.update",
  "drafts.createRevision",
  "drafts.createTargetVariant",
  "drafts.get",
  "drafts.list",
  "drafts.search",
  "drafts.validate",
]);
async function main() {
  const [command, file] = process.argv.slice(2);
  if (command === "result") {
    if (!/^[a-f0-9-]{36}$/.test(file)) throw new Error("requestId 无效");
    const result = path.join(dir, "results", `${file}.json`);
    if (!fs.existsSync(result)) {
      process.stdout.write(
        JSON.stringify({ ok: false, status: "pending", requestId: file }) +
          "\n",
      );
      return;
    }
    process.stdout.write(fs.readFileSync(result, "utf8") + "\n");
    return;
  }
  if (command !== "submit" || !file)
    throw new Error(
      "用法：node scripts/draft-agent.cjs submit request.json | result requestId",
    );
  const bytes = fs.readFileSync(file);
  if (bytes.length > 700 * 1024) throw new Error("单次请求超过 700 KiB");
  const request = JSON.parse(bytes);
  if (!allowed.has(request.type)) throw new Error("不允许此 Draft API");
  if (!fs.existsSync(path.join(dir, "auth.key")))
    throw new Error("请在插件稿件库启用本地 Draft Gateway");
  if (
    fs.lstatSync(dir).isSymbolicLink() ||
    fs.lstatSync(path.join(dir, "auth.key")).isSymbolicLink()
  )
    throw new Error("网关路径无效");
  const requestId = request.payload?.requestId || crypto.randomUUID();
  if (!/^[a-f0-9-]{36}$/.test(requestId))
    throw new Error("requestId 必须是 UUID，重试请复用原 UUID");
  request.payload = { ...request.payload, requestId };
  const signature = crypto
    .createHmac("sha256", fs.readFileSync(path.join(dir, "auth.key"), "utf8"))
    .update(JSON.stringify(request))
    .digest("hex");
  const target = path.join(dir, "inbox", `${requestId}.json`);
  if (
    !fs.existsSync(target) &&
    !fs.existsSync(path.join(dir, "results", `${requestId}.json`))
  )
    fs.writeFileSync(target, JSON.stringify({ request, signature }), {
      mode: 0o600,
      flag: "wx",
    });
  process.stdout.write(
    JSON.stringify({ ok: true, status: "queued", requestId }) + "\n",
  );
}
main().catch((e) => {
  process.stderr.write(e.message + "\n");
  process.exitCode = 1;
});
