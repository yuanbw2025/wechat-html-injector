import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
const root = path.resolve(new URL("..", import.meta.url).pathname);
const output = path.join(root, "test-results");
await fs.mkdir(output, { recursive: true });
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/mock-ai") {
      let data = "";
      for await (const chunk of req) data += chunk;
      const body = JSON.parse(data);
      const current = JSON.parse(body.messages[1].content).currentDraft;
      const action = current
        ? {
            type: "drafts.update",
            payload: {
              draftId: current.id,
              baseRevisionId: current.currentRevisionId,
              expectedChecksum: current.checksum,
              changes: {
                title: "AI 修改测试稿",
                contentHtml: "<p>AI 修改后的完整正文。</p>",
              },
            },
          }
        : {
            type: "drafts.create",
            payload: {
              draft: {
                title: "AI 新建测试稿",
                contentMarkdown: "# AI 正文\n\n已自动保存，无需复制。",
                provenance: {
                  type: "ai",
                  provider: "local-test",
                  model: "fixture",
                },
              },
            },
          };
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  reply: "测试输出已保存",
                  actions: [action],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
      );
      return;
    }
    if (req.url === "/pack") {
      res.setHeader("Content-Type", "application/zip");
      const { createReadStream } = await import("node:fs");
      createReadStream(
        path.join(root, "content-packs/storyforge-wechat-drafts.sfpack"),
      ).pipe(res);
      return;
    }
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root + path.sep)) throw new Error("invalid path");
    const content = await fs.readFile(file);
    res.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    res.end(content);
  } catch (e) {
    res.statusCode = 500;
    res.end(e.message);
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const report = [];
try {
  for (const channel of ["chrome", "msedge"]) {
    const profile = await fs.mkdtemp(path.join(output, `profile-${channel}-`));
    let context;
    let page;
    const errors = [];
    const launch = async () => {
      context = await chromium.launchPersistentContext(profile, {
        channel,
        headless: true,
        ignoreDefaultArgs: ["--disable-extensions"],
        args: ["--enable-unsafe-extension-debugging"],
        viewport: { width: 1500, height: 1000 },
      });
      const debug = await context.browser().newBrowserCDPSession();
      const loaded = await debug.send("Extensions.loadUnpacked", {
        path: root,
      });
      const extensionId = loaded.id;
      page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`chrome-extension://${extensionId}/library.html`);
      await page.waitForFunction(
        () =>
          document.querySelector("#status").textContent === "稿件库已就绪。",
        {},
        { timeout: 20000 },
      );
      return extensionId;
    };
    try {
      const extensionId = await launch();
      await page.evaluate(async (endpoint) => {
        await chrome.storage.local.set({
          allowAIDraftWrites: true,
          aiEndpoint: endpoint,
          aiModel: "fixture",
          aiProvider: "custom",
          aiApiKey: "local-test-placeholder",
        });
      }, `${origin}/mock-ai`);
      const create = await page.evaluate(async () =>
        chrome.runtime.sendMessage({
          type: "draft-ai",
          payload: {
            instruction: "创建测试稿",
            requestId: crypto.randomUUID(),
          },
        }),
      );
      assert.equal(create.ok, true, JSON.stringify(create));
      const draftId = create.run.results[0].draftId;
      const update = await page.evaluate(
        async (draftId) =>
          chrome.runtime.sendMessage({
            type: "draft-ai",
            payload: {
              draftId,
              instruction: "修改测试稿",
              requestId: crypto.randomUUID(),
            },
          }),
        draftId,
      );
      assert.equal(update.ok, true, JSON.stringify(update));
      assert.notEqual(
        update.run.results[0].revisionId,
        create.run.results[0].revisionId,
      );
      const restored = await page.evaluate(
        async ({ draftId, revisionId }) => {
          const { draft } = await chrome.runtime.sendMessage({
            type: "draft-api",
            request: { type: "drafts.get", payload: { draftId } },
          });
          return chrome.runtime.sendMessage({
            type: "draft-api",
            request: {
              type: "drafts.restoreRevision",
              payload: {
                draftId,
                revisionId,
                baseRevisionId: draft.currentRevisionId,
                expectedChecksum: draft.checksum,
                requestId: crypto.randomUUID(),
              },
            },
          });
        },
        { draftId, revisionId: create.run.results[0].revisionId },
      );
      assert.equal(restored.ok, true);
      await page.reload();
      await page.waitForFunction(
        () =>
          document.querySelector("#status").textContent === "稿件库已就绪。",
      );
      assert.equal(await page.locator(".draft-row").count(), 1);
      await page.locator(".draft-row").click();
      await page.locator('[data-pane="preview"]').click();
      await page
        .frameLocator("#preview")
        .locator("body")
        .getByText("已自动保存，无需复制。", { exact: false })
        .waitFor();
      await page.screenshot({
        path: path.join(output, `${channel}-library.png`),
        fullPage: true,
      });
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      assert.equal(await popup.locator("#library").textContent(), "▤AI 稿件库");
      await popup.close();
      // A staged uncommitted edit is recovered after a page interruption.
      await page.evaluate(async (draftId) => {
        const { draft } = await chrome.runtime.sendMessage({
          type: "draft-api",
          request: { type: "drafts.get", payload: { draftId } },
        });
        await chrome.runtime.sendMessage({
          type: "draft-api",
          request: {
            type: "drafts.workingCopy",
            payload: {
              id: "browser-recovery",
              draftId,
              baseRevisionId: draft.currentRevisionId,
              expectedChecksum: draft.checksum,
              changes: { title: "中断恢复测试稿" },
            },
          },
        });
      }, draftId);
      page.on("dialog", (d) => d.accept());
      await page.reload();
      await page.waitForFunction(
        () =>
          document.querySelector("#status").textContent === "稿件库已就绪。",
      );
      await page
        .locator(".draft-row strong")
        .getByText("中断恢复测试稿", { exact: true })
        .waitFor();
      const recovery = await page.evaluate(
        async (draftId) =>
          chrome.runtime.sendMessage({
            type: "draft-api",
            request: { type: "drafts.get", payload: { draftId } },
          }),
        draftId,
      );
      assert.equal(recovery.draft.title, "中断恢复测试稿");
      const backup = await page.evaluate(async (draftId) => {
        const result = await chrome.runtime.sendMessage({
          type: "draft-api",
          request: { type: "drafts.export", payload: { filter: { draftId } } },
        });
        if (!result.ok) throw new Error(result.error);
        return chrome.runtime.sendMessage({
          type: "draft-api",
          request: {
            type: "drafts.import",
            payload: { fileId: result.fileId, format: "sfpack" },
          },
        });
      }, draftId);
      assert.equal(backup.ok, true, JSON.stringify(backup));
      assert.equal(backup.report.skipped, 1);
      const conflictDraft = await page.evaluate(async () => {
        const api = (type, payload) =>
          chrome.runtime.sendMessage({
            type: "draft-api",
            request: { type, payload },
          });
        await api("drafts.saveCollection", {
          id: "recovery-fixture",
          name: "恢复冲突测试",
        });
        const made = await api("drafts.create", {
          draft: {
            title: "恢复原稿",
            contentHtml: "<p>未完成编辑</p>",
            collectionId: "recovery-fixture",
          },
        });
        const { draft } = await api("drafts.get", { draftId: made.draftId });
        const base = {
          draftId: draft.id,
          baseRevisionId: draft.currentRevisionId,
          expectedChecksum: draft.checksum,
        };
        await api("drafts.workingCopy", {
          id: "recovery-conflict",
          ...base,
          changes: { title: "待恢复", contentHtml: "<p>恢复内容不丢失</p>" },
        });
        await api("drafts.update", {
          ...base,
          changes: { title: "其他窗口的更新" },
        });
        return draft.id;
      });
      await page.reload();
      await page
        .locator(".draft-row strong")
        .getByText("待恢复（恢复副本）", { exact: true })
        .waitFor();
      const conflictOriginal = await page.evaluate(
        async (draftId) =>
          chrome.runtime.sendMessage({
            type: "draft-api",
            request: { type: "drafts.get", payload: { draftId } },
          }),
        conflictDraft,
      );
      assert.equal(conflictOriginal.draft.title, "其他窗口的更新");
      const removed = await page.evaluate(() =>
        chrome.runtime.sendMessage({
          type: "draft-api",
          request: {
            type: "drafts.deleteCollection",
            payload: { collectionId: "recovery-fixture", confirmed: true },
          },
        }),
      );
      assert.equal(removed.removed, 2);
      await page.reload();
      await page.waitForFunction(
        () =>
          document.querySelector("#status").textContent === "稿件库已就绪。",
      );
      assert.equal(await page.locator(".draft-row").count(), 1);
      const manager = await context.newPage();
      await manager.goto(
        channel === "chrome" ? "chrome://extensions/" : "edge://extensions/",
      );
      if (channel === "chrome") {
        const developerMode = manager.locator("#devMode");
        if ((await developerMode.getAttribute("aria-checked")) === "false")
          await developerMode.click();
        await manager
          .locator(`extensions-item[id="${extensionId}"]`)
          .getByRole("button", { name: "重新加载", exact: true })
          .click();
      } else {
        const developerMode = manager.locator("#dev-switch:visible").first();
        if ((await developerMode.getAttribute("checked")) === "false")
          await developerMode.click();
        await manager
          .locator("fluent-button")
          .filter({ hasText: /^\s*重新加载\s*$/ })
          .click();
      }
      await manager.waitForTimeout(500);
      page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`chrome-extension://${extensionId}/library.html`);
      await page.waitForFunction(
        () =>
          document.querySelector("#status").textContent === "稿件库已就绪。",
      );
      assert.equal(await page.locator(".draft-row").count(), 1);
      await context.close();
      await launch();
      assert.equal(await page.locator(".draft-row").count(), 1);
      // Browser-origin IndexedDB import of the real 151-item package. No user-profile or platform writes.
      const packResult = await page.evaluate(async (origin) => {
        const { stageFile } = await import("./draft-files.js");
        const blob = await (await fetch(`${origin}/pack`)).blob();
        const fileId = await stageFile(blob);
        return chrome.runtime.sendMessage({
          type: "draft-api",
          request: {
            type: "drafts.import",
            payload: { fileId, format: "sfpack" },
          },
        });
      }, origin);
      assert.equal(packResult.ok, true, JSON.stringify(packResult));
      assert.equal(packResult.report.created, 151);
      assert.deepEqual(packResult.audits[0].missing, []);
      assert.deepEqual(packResult.audits[0].duplicates, []);
      const retry = await page.evaluate(async (origin) => {
        const { stageFile } = await import("./draft-files.js");
        const fileId = await stageFile(
          await (await fetch(`${origin}/pack`)).blob(),
        );
        return chrome.runtime.sendMessage({
          type: "draft-api",
          request: {
            type: "drafts.import",
            payload: { fileId, format: "sfpack" },
          },
        });
      }, origin);
      assert.equal(retry.report.skipped, 151);
      assert.equal(retry.report.created, 0);
      await page.reload();
      await page.waitForFunction(
        () =>
          document.querySelector("#status").textContent === "稿件库已就绪。",
      );
      assert.equal(await page.locator(".draft-row").count(), 152);
      await page.selectOption("#collection", "storyforge-promo");
      await page.waitForFunction(
        () => document.querySelectorAll(".draft-row").length === 151,
      );
      await page.screenshot({
        path: path.join(output, `${channel}-storyforge.png`),
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      const stats = await page.evaluate(() =>
        chrome.runtime.sendMessage({
          type: "draft-api",
          request: { type: "drafts.stats", payload: {} },
        }),
      );
      report.push({
        browser: channel,
        aiCreate: true,
        aiUpdate: true,
        revisionRestore: true,
        refresh: true,
        restart: true,
        extensionReload: true,
        interruptedEditRecovery: true,
        recoveryConflictCopy: true,
        backupRoundtrip: true,
        preview: true,
        popup: true,
        realPackage: packResult.report,
        repeatImport: retry.report,
        stats: stats.stats,
        errors,
      });
      console.log(
        `${channel} passed: AI create/update/restore, refresh/restart, 151 import + repeat`,
      );
    } finally {
      await context?.close();
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  await fs.writeFile(
    path.join(output, "browser-report.json"),
    JSON.stringify(report, null, 2),
  );
}
