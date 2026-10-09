globalThis.DraftPlatforms = (() => {
  const PLATFORM_ID = "wechat-official-account";
  function titleCandidate(el) {
    if (
      !el ||
      el.disabled ||
      el.readOnly ||
      (!["INPUT", "TEXTAREA"].includes(el.tagName) && !el.isContentEditable)
    )
      return false;
    const rect = el.getBoundingClientRect();
    if (
      rect.width < 80 ||
      rect.height < 15 ||
      getComputedStyle(el).visibility === "hidden" ||
      getComputedStyle(el).display === "none"
    )
      return false;
    const context = [
      el.id,
      el.name,
      el.className,
      el.getAttribute("aria-label"),
      el.getAttribute("placeholder"),
    ].join(" ");
    if (/author|作者|digest|摘要|cover|封面/i.test(context)) return false;
    return (
      /(^|[^a-z])(?:title)([^a-z]|$)|标题/i.test(context) &&
      !el.closest(".ProseMirror,#wh-panel")
    );
  }
  function findTitle() {
    const candidates = [
      ...document.querySelectorAll(
        '#title,#js_title,input[name="title"],textarea[name="title"],input[placeholder*="标题"],textarea[placeholder*="标题"],[contenteditable="true"][data-placeholder*="标题"]',
      ),
    ].filter(titleCandidate);
    if (candidates.length !== 1)
      throw new Error("无法唯一确认标题字段，导出已停止");
    return candidates[0];
  }
  const readTitle = (el) => ("value" in el ? el.value : el.textContent);
  function writeTitle(el, value) {
    if ("value" in el) {
      const setter = Object.getOwnPropertyDescriptor(
        el.tagName === "TEXTAREA"
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
        "value",
      )?.set;
      if (!setter) throw new Error("标题字段不可写");
      setter.call(el, value);
    } else el.textContent = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const tick = () => new Promise((resolve) => setTimeout(resolve, 180));
  function createWechatAdapter(body) {
    let busy = false;
    let recovery;
    const capabilities = () => ({
      title: true,
      html: true,
      markdown: false,
      assets: "wechat-cdn-mapping",
      save: false,
      publish: false,
      maxTitleLength: 64,
    });
    function editor() {
      const result = body.findEditor();
      if (
        !result ||
        (!result.editor.matches(".ProseMirror") &&
          !result.editor.closest(
            "#js_appmsg_editor,#editor_pannel,.appmsg_edit_box",
          ))
      )
        throw new Error("当前页面没有已支持的公众号正文编辑器");
      return result;
    }
    async function detect() {
      return (
        location.hostname === "mp.weixin.qq.com" &&
        /^\/(cgi-bin\/appmsg|appmsg\/)/.test(location.pathname) &&
        Boolean(body.findEditor())
      );
    }
    async function readBack() {
      if (!(await detect())) throw new Error("请打开微信公众号图文编辑页");
      const title = findTitle();
      const r = editor();
      return {
        title: readTitle(title),
        contentHtml: body.cleanHTML(r.editor.innerHTML),
        images: body.getArticleImages(),
      };
    }
    async function validateDraft(variant) {
      const warnings = [];
      if (
        typeof variant.title !== "string" ||
        !variant.title.trim() ||
        [...variant.title].length > 64
      )
        throw new Error("微信标题必须为 1—64 字，请先生成平台适配版本");
      if (
        typeof variant.contentHtml !== "string" ||
        !variant.contentHtml.trim() ||
        variant.contentHtml.length > 4 * 1024 * 1024
      )
        throw new Error("微信正文为空或体积过大");
      const t = document.createElement("template");
      t.innerHTML = body.cleanHTML(variant.contentHtml);
      const unsupported = [];
      for (const img of t.content.querySelectorAll("img")) {
        let url;
        try {
          url = new URL(img.getAttribute("src") || "");
        } catch {}
        if (
          !url ||
          url.protocol !== "https:" ||
          !/(^|\.)mmbiz\.qpic\.cn$/.test(url.hostname)
        )
          unsupported.push(
            img.getAttribute("src")?.slice(0, 80) || "未映射图片",
          );
      }
      if (unsupported.length)
        throw new Error(
          `有 ${unsupported.length} 张图片尚未映射到微信 CDN。请先原生上传图片，再在稿件库映射。`,
        );
      return { ok: true, warnings };
    }
    async function transformDraft(draft, revision, variant) {
      const value = variant || revision || draft;
      return {
        platformId: PLATFORM_ID,
        title: value.title,
        contentHtml: body.cleanHTML(value.contentHtml),
      };
    }
    async function verifyExport(expected, actual) {
      const expectedChecksum = await DraftHTML.hash(
        DraftHTML.canonical(expected.contentHtml),
      );
      const actualChecksum = await DraftHTML.hash(
        DraftHTML.canonical(actual.contentHtml),
      );
      return {
        ok:
          expected.title === actual.title &&
          expectedChecksum === actualChecksum,
        expectedChecksum,
        actualChecksum,
      };
    }
    async function restore() {
      if (!recovery) throw new Error("没有待恢复的编辑器快照");
      const { titleElement, bodyElement, snapshot } = recovery;
      if (
        !titleElement.isConnected ||
        body.findEditor()?.editor !== bodyElement
      )
        throw new Error("编辑器已切换，请回到原文章后恢复");
      writeTitle(titleElement, snapshot.title);
      if (
        !body.applyWhole(snapshot.contentHtml, {
          silent: true,
          snapshot: false,
        })
      )
        throw new Error("正文恢复失败");
      await tick();
      const actual = await readBack();
      const verified = await verifyExport(snapshot, actual);
      if (!verified.ok) throw new Error("恢复回读未通过，请检查原文章");
      recovery = null;
      return { ok: true, snapshot: actual };
    }
    async function exportToEditor(variant, confirmed = false) {
      if (confirmed !== true) throw new Error("导出必须由用户点击");
      if (busy) throw new Error("已有导出正在执行");
      busy = true;
      try {
        if (!(await detect())) throw new Error("请打开微信公众号图文编辑页");
        await validateDraft(variant);
        const title = findTitle();
        const r = editor();
        const snapshot = await readBack();
        const t = document.createElement("template");
        t.innerHTML = snapshot.contentHtml;
        if (
          (snapshot.title.trim() ||
            t.content.textContent.trim() ||
            t.content.querySelector("img")) &&
          !window.confirm(
            "当前微信编辑器已有内容。是否用所选稿件覆盖标题和正文？不会自动保存或发布。",
          )
        )
          return { ok: false, code: "CANCELLED", error: "用户取消覆盖" };
        recovery = { titleElement: title, bodyElement: r.editor, snapshot };
        writeTitle(title, variant.title);
        if (!body.applyWhole(variant.contentHtml, { silent: true }))
          throw new Error("正文写入失败");
        await tick();
        if (!title.isConnected || body.findEditor()?.editor !== r.editor)
          throw new Error("导出期间编辑器发生切换");
        const actual = await readBack();
        const verification = await verifyExport(variant, actual);
        if (!verification.ok)
          throw new Error("标题或正文回读不一致，已停止导出");
        return {
          ok: true,
          platformId: PLATFORM_ID,
          status: "verified",
          snapshot: actual,
          verification,
          warnings: [
            "已写入微信编辑器，等待用户自行保存。图片尚未做保存后重开验证。",
          ],
        };
      } catch (e) {
        let restored = false;
        let restoreError;
        try {
          if (recovery) {
            await restore();
            restored = true;
          }
        } catch (r) {
          restoreError = r.message;
        }
        return {
          ok: false,
          status: "failed",
          error: e.message,
          restored,
          restoreError,
        };
      } finally {
        busy = false;
      }
    }
    return {
      id: PLATFORM_ID,
      name: "微信公众号",
      capabilities,
      detect,
      validateDraft,
      transformDraft,
      exportToEditor,
      readBack,
      verifyExport,
      restore,
    };
  }
  return { createWechatAdapter, findTitle, titleCandidate };
})();
