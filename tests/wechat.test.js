import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import fs from "node:fs";
const sanitizer = fs.readFileSync(
  new URL("../draft-sanitize.js", import.meta.url),
  "utf8",
);
const adapter = fs.readFileSync(
  new URL("../platform-adapters/wechat.js", import.meta.url),
  "utf8",
);
function fixture({
  title = "",
  html = "<p><br></p>",
  unknownTitle = false,
} = {}) {
  const dom = new JSDOM(
    `<input id="author" placeholder="作者"><textarea id="digest" placeholder="摘要"></textarea><input id="${unknownTitle ? "changed" : "title"}" placeholder="${unknownTitle ? "其它" : "标题"}"><div id="js_appmsg_editor"><div class="ProseMirror" contenteditable="true">${html}</div></div>`,
    {
      url: "https://mp.weixin.qq.com/cgi-bin/appmsg",
      runScripts: "outside-only",
    },
  );
  const w = dom.window;
  w.crypto.subtle = crypto.subtle;
  w.TextEncoder = TextEncoder;
  w.HTMLElement.prototype.getBoundingClientRect = () => ({
    width: 500,
    height: 200,
  });
  w.confirm = () => true;
  Object.defineProperty(w.HTMLElement.prototype, "isContentEditable", {
    get() {
      return this.getAttribute("contenteditable") === "true";
    },
  });
  w.eval(sanitizer);
  w.eval(adapter);
  const titleEl = w.document.querySelector("input:last-of-type");
  titleEl.value = title;
  const body = w.document.querySelector(".ProseMirror");
  const events = [];
  body.addEventListener("input", () => events.push("input"));
  body.addEventListener("change", () => events.push("change"));
  let failWrite = false;
  const api = {
    findEditor: () => ({ editor: body, doc: w.document }),
    cleanHTML: w.DraftHTML.sanitize,
    getArticleImages: () => [...body.querySelectorAll("img")].map((i) => i.src),
    applyWhole: (html) => {
      body.innerHTML = w.DraftHTML.sanitize(html);
      body.dispatchEvent(new w.Event("input"));
      body.dispatchEvent(new w.Event("change"));
      if (failWrite) {
        failWrite = false;
        body.innerHTML = "<p>unexpected</p>";
      }
      return true;
    },
  };
  return {
    w,
    body,
    titleEl,
    events,
    adapter: w.DraftPlatforms.createWechatAdapter(api),
    failNext: () => (failWrite = true),
  };
}
test("separate semantic title locator excludes author/digest; title+HTML event write/readback", async () => {
  const f = fixture();
  assert.equal(f.w.DraftPlatforms.findTitle().id, "title");
  const r = await f.adapter.exportToEditor(
    { title: "001｜示例", contentHtml: '<p style="color:red">完整正文</p>' },
    true,
  );
  assert.equal(r.ok, true);
  assert.equal(r.snapshot.title, "001｜示例");
  assert.match(r.snapshot.contentHtml, /完整正文/);
  assert.deepEqual(f.events, ["input", "change"]);
  assert.equal(r.verification.expectedChecksum, r.verification.actualChecksum);
  assert.equal(f.w.document.querySelector("#author").value, "");
});
test("requires user export confirmation and overwrite confirmation", async () => {
  const f = fixture({ title: "已有标题", html: "<p>已有正文</p>" });
  f.w.confirm = () => false;
  const r = await f.adapter.exportToEditor(
    { title: "新标题", contentHtml: "<p>新正文</p>" },
    true,
  );
  assert.equal(r.code, "CANCELLED");
  assert.equal(f.titleEl.value, "已有标题");
  assert.equal(f.body.textContent, "已有正文");
  await assert.rejects(
    f.adapter.exportToEditor({ title: "a", contentHtml: "<p>b</p>" }, false),
    /用户点击/,
  );
});
test("DOM changes fail closed and non-CDN assets cannot pass verified export", async () => {
  const f = fixture({ unknownTitle: true });
  assert.equal(
    (
      await f.adapter.exportToEditor(
        { title: "a", contentHtml: "<p>b</p>" },
        true,
      )
    ).ok,
    false,
  );
  assert.equal(f.titleEl.value, "");
  const g = fixture();
  assert.equal(
    (
      await g.adapter.exportToEditor(
        { title: "a", contentHtml: '<img src="data:image/png;base64,YQ==">' },
        true,
      )
    ).ok,
    false,
  );
  assert.equal(g.titleEl.value, "");
});
test("write mismatch restores snapshot; no save or publish interfaces", async () => {
  const f = fixture({ title: "原标题", html: "<p>原正文</p>" });
  f.failNext();
  const r = await f.adapter.exportToEditor(
    { title: "新标题", contentHtml: "<p>新正文</p>" },
    true,
  );
  assert.equal(r.ok, false);
  assert.equal(r.restored, true);
  assert.equal(f.titleEl.value, "原标题");
  assert.equal(f.body.textContent, "原正文");
  assert.equal(f.adapter.capabilities().save, false);
  assert.equal(f.adapter.capabilities().publish, false);
});
