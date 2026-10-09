import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { JSDOM } from "jsdom";

test("clip entry is menu-only; opening the panel preserves existing config and makes no remote write", async () => {
  const dom = new JSDOM("<article><h1>普通网页</h1><p>剪存正文</p></article>", {
    url: "https://example.test/article",
    runScripts: "outside-only",
  });
  const win = dom.window,
    listeners = [],
    messages = [];
  let panelRoot;
  const attach = win.Element.prototype.attachShadow;
  win.Element.prototype.attachShadow = function (options) {
    panelRoot = attach.call(this, options);
    return panelRoot;
  };
  const config = {
    wpsTargetUrl: "https://www.kdocs.cn/l/fixture",
    aiModel: "existing",
    aiEndpoint: "https://example.test/api",
  };
  win.chrome = {
    storage: {
      local: {
        get: async (keys) =>
          Object.fromEntries(keys.map((k) => [k, config[k]])),
        set: async (value) => Object.assign(config, value),
      },
    },
    runtime: {
      onMessage: { addListener: (l) => listeners.push(l) },
      sendMessage: (value, callback) => {
        messages.push(value);
        callback?.({ ok: true });
      },
    },
  };
  win.eval(
    await fs.readFile(new URL("../web-content.js", import.meta.url), "utf8"),
  );
  assert.equal(panelRoot.querySelector(".trigger"), null);
  assert.equal(
    panelRoot.querySelector(".panel").classList.contains("open"),
    false,
  );
  listeners[0]({ type: "web-clip-trigger" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    panelRoot.querySelector(".panel").classList.contains("open"),
    true,
  );
  assert.equal(panelRoot.querySelector(".target").value, config.wpsTargetUrl);
  assert.equal(messages.length, 0);
  panelRoot.querySelector(".setup").click();
  assert.equal(messages[0].type, "open-settings");
  assert.equal(config.aiModel, "existing");
  dom.window.close();
});

test("manifest keeps legacy entries, same identity, independent Draft UI and no external web gateway", async () => {
  const manifest = JSON.parse(
    await fs.readFile(new URL("../manifest.json", import.meta.url), "utf8"),
  );
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.equal(manifest.options_page, "settings.html");
  assert.equal(manifest.chrome_url_overrides.newtab, "sinan.html");
  assert.ok(manifest.key);
  assert.equal(manifest.externally_connectable, undefined);
  assert.ok(manifest.commands.webClip && manifest.commands.webSummary);
  assert.ok(
    manifest.content_scripts.some((s) => s.js.includes("web-content.js")),
  );
  const wechat = manifest.content_scripts.find((s) =>
    s.js.includes("content.js"),
  );
  assert.deepEqual(wechat.js, [
    "engine.js",
    "draft-sanitize.js",
    "platform-adapters/wechat.js",
    "content.js",
  ]);
  const popup = await fs.readFile(
    new URL("../popup.html", import.meta.url),
    "utf8",
  );
  for (const feature of [
    "AI 稿件库",
    "web-clip-trigger",
    "web-summary-trigger",
    "插件设置",
  ])
    assert.ok(popup.includes(feature));
});
