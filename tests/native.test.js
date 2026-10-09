import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
test("native gateway authenticated private mailbox accepts declared draft requests and rejects invalid signatures", async () => {
  const queue = await fs.mkdtemp(path.join(os.tmpdir(), "draft-native-test-"));
  const child = spawn(
    process.execPath,
    [new URL("../native-host/host.js", import.meta.url).pathname],
    {
      env: { ...process.env, YUNZHONGSHU_DRAFT_QUEUE: queue },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let input = Buffer.alloc(0);
  const pending = [];
  child.stdout.on("data", (chunk) => {
    input = Buffer.concat([input, chunk]);
    while (input.length >= 4) {
      const n = input.readUInt32LE(0);
      if (input.length < 4 + n) break;
      const r = JSON.parse(input.subarray(4, 4 + n).toString());
      input = input.subarray(4 + n);
      pending.shift()(r);
    }
  });
  const call = (payload) =>
    new Promise((resolve) => {
      pending.push(resolve);
      const body = Buffer.from(JSON.stringify(payload));
      const header = Buffer.alloc(4);
      header.writeUInt32LE(body.length);
      child.stdin.write(Buffer.concat([header, body]));
    });
  try {
    assert.equal(
      (await call({ action: "run-shell", command: "forbidden" })).code,
      "INVALID_REQUEST",
    );
    const init = await call({ action: "draft-gateway-init" });
    assert.equal(init.ok, true);
    assert.equal(
      (await fs.stat(path.join(queue, "auth.key"))).mode & 0o777,
      0o600,
    );
    const requestId = crypto.randomUUID();
    const request = {
      type: "drafts.create",
      payload: {
        title: "外部 Agent 稿件",
        contentHtml: "<p>正文</p>",
        requestId,
      },
    };
    const key = await fs.readFile(path.join(queue, "auth.key"), "utf8");
    const signature = crypto
      .createHmac("sha256", key)
      .update(JSON.stringify(request))
      .digest("hex");
    await fs.writeFile(
      path.join(queue, "inbox", `${requestId}.json`),
      JSON.stringify({ request, signature }),
      { mode: 0o600 },
    );
    const packet = await call({ action: "draft-gateway-poll" });
    assert.equal(packet.ok, true);
    assert.equal(packet.requestId, requestId);
    assert.equal(packet.request.type, "drafts.create");
    await call({
      action: "draft-gateway-ack",
      requestId,
      result: {
        ok: true,
        draftId: "draft_example",
        revisionId: "revision_example",
      },
    });
    assert.equal(
      JSON.parse(
        await fs.readFile(
          path.join(queue, "results", `${requestId}.json`),
          "utf8",
        ),
      ).revisionId,
      "revision_example",
    );
    assert.equal(
      (await call({ action: "draft-gateway-poll" })).request,
      undefined,
    );
    const badId = crypto.randomUUID();
    await fs.writeFile(
      path.join(queue, "inbox", `${badId}.json`),
      JSON.stringify({
        request: { type: "drafts.publish", payload: { requestId: badId } },
        signature: "0".repeat(64),
      }),
    );
    assert.equal((await call({ action: "draft-gateway-poll" })).ok, false);
  } finally {
    child.kill();
    await fs.rm(queue, { recursive: true, force: true });
  }
});
