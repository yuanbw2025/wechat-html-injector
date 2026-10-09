import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
const out = process.argv[2];
if (!out)
  throw new Error(
    "指定输出目录：node scripts/fetch-storyforge-head.js artifacts/wps-source",
  );
const sources = [
  ["001", "https://www.kdocs.cn/l/cs7X8esn2E9r"],
  ["002", "https://www.kdocs.cn/l/cqQ8eCOAVgKG"],
  ["003", "https://www.kdocs.cn/l/cowHU4ZykeqB"],
  ["004", "https://www.kdocs.cn/l/ckhSAkQtXThv"],
];
async function call(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("kdocs-cli", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr.slice(0, 400)));
      else {
        try {
          const result = JSON.parse(stdout);
          if (result.code && result.code !== 0)
            throw new Error(result.message || result.msg);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      }
    });
  });
}
await fs.mkdir(out, { recursive: true });
const index = [];
for (const [sequence, url] of sources) {
  let result = await call([
    "drive",
    "read-file",
    `url=${url}`,
    "enable_upload_medias=true",
    "--compact",
    "--timeout",
    "120000",
  ]);
  if (result.data?.status === "pending")
    result = await call([
      "drive",
      "read-file",
      `url=${url}`,
      `task_id=${result.data.task_id}`,
      "enable_upload_medias=true",
      "--compact",
      "--timeout",
      "120000",
    ]);
  const data = result.data;
  if (data?.status !== "ok" || !data.content)
    throw new Error(`${sequence} 无完整读取结果`);
  const blocks = await call([
    "otl",
    "block-query",
    JSON.stringify({ url, params: { blockIds: ["doc"] } }),
    "--compact",
    "--timeout",
    "120000",
  ]);
  if (!blocks.data?.detail?.result?.blocks)
    throw new Error(`${sequence} 无完整块结构`);
  await fs.writeFile(
    path.join(out, `${sequence}-blocks.json`),
    JSON.stringify(blocks.data),
  );
  await fs.writeFile(
    path.join(out, `${sequence}.json`),
    JSON.stringify({
      ...data,
      sourceUrl: url,
      readAt: new Date().toISOString(),
      blocksVerified: true,
    }),
  );
  index.push({ number: sequence, title: data.name.replace(/\.otl$/, ""), url });
  process.stdout.write(
    `${sequence} 已读取并查询完整块结构，${Buffer.byteLength(data.content)} 字节\n`,
  );
}
await fs.writeFile(
  path.join(out, "index.json"),
  JSON.stringify(index, null, 2),
);
