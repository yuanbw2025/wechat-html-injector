// ==UserScript==
// @name         微信公众号HTML编辑器-侧边源码版
// @namespace    https://mp.weixin.qq.com/
// @version      4.7.0
// @description  常驻侧边面板：读取文章真实HTML → 编辑 → 实时预览 → 应用回文章。内置图片库（引用文章内已上传的微信CDN图片），解决HTML内插图难题。
// @author       AI Assistant
// @match        https://mp.weixin.qq.com/cgi-bin/appmsg*
// @match        https://mp.weixin.qq.com/appmsg/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================
    //  日志
    // =========================================================
    const TAG = '[微信HTML编辑器]';
    const log = {
        info: (m, ...a) => console.log(`${TAG} ℹ️ ${m}`, ...a),
        ok: (m, ...a) => console.log(`${TAG} ✅ ${m}`, ...a),
        warn: (m, ...a) => console.warn(`${TAG} ⚠️ ${m}`, ...a),
        error: (m, ...a) => console.error(`${TAG} ❌ ${m}`, ...a),
    };
    log.info('脚本启动 v4.7.0 — 原生编辑区双向同步 + 页面内工作台');

    // =========================================================
    //  全局状态
    // =========================================================
    const state = {
        open: false,
        previewOn: true,
        synced: '',          // 上一次"读取/应用"时的代码，用于判断有无未应用的手改
        width: 480,
        entry: null,         // 'toolbar' | 'handle'
        layoutRaw: '',       // 排版的原始 Markdown 草稿
        layoutHTML: '',      // 上次排版写入正文后的 HTML
        styled: false,       // 当前正文是否处于"已排版"状态（true 时换版复用原始草稿）
        applying: false,     // 插件主动写入时置 true，避免 MutationObserver 误判为用户编辑
        syncingCode: false,  // 原生编辑区同步到源码框时置 true，避免触发草稿状态
        editorObserver: null,
        observedEditor: null,
        lastEditorHTML: '',
        lastImageCount: 0,
    };

    // =========================================================
    //  配置持久化
    // =========================================================
    const STORAGE_KEY = 'wechat-html-editor-v4';
    const Config = {
        _cache: null,
        _read() {
            if (!this._cache) {
                try { this._cache = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
                catch { this._cache = {}; }
            }
            return this._cache;
        },
        get(k, d) { const v = this._read()[k]; return v === undefined ? d : v; },
        set(k, v) { const c = this._read(); c[k] = v; localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); },
    };
    state.width = Config.get('width', 560);
    state.previewOn = Config.get('previewOn', true);

    // =========================================================
    //  模板片段
    // =========================================================
    const PRESETS = [
        {
            name: '信息卡片', icon: '🃏',
            code: `<div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);border-radius:16px;padding:32px;margin:20px 0;color:#fff;">
  <h3 style="margin:0 0 12px;font-size:22px;">📌 标题</h3>
  <p style="margin:0;font-size:16px;line-height:1.8;opacity:.95;">在这里写内容</p>
</div>`
        },
        {
            name: '引用块', icon: '💬',
            code: `<blockquote style="border-left:4px solid #667eea;margin:20px 0;padding:16px 24px;background:#f8f9ff;border-radius:0 12px 12px 0;">
  <p style="margin:0;font-size:16px;line-height:1.8;color:#2d3748;">引用内容写在这里</p>
  <footer style="margin-top:8px;font-size:14px;color:#718096;text-align:right;">— 来源</footer>
</blockquote>`
        },
        {
            name: 'CTA按钮', icon: '🚀',
            code: `<div style="text-align:center;margin:30px 0;">
  <a style="display:inline-block;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;padding:14px 36px;border-radius:50px;font-size:17px;font-weight:bold;text-decoration:none;">🚀 立即行动</a>
</div>`
        },
        {
            name: '分割线', icon: '✂️',
            code: `<div style="text-align:center;margin:32px 0;color:#a0aec0;font-size:20px;letter-spacing:12px;">· · ·</div>`
        },
        {
            name: '图片(占位)', icon: '🖼',
            code: `<img src="REPLACE_WITH_CDN_URL" style="max-width:100%;display:block;margin:16px auto;border-radius:6px;" alt="">`
        },
    ];
    const getUserTemplates = () => Config.get('templates', []);
    function saveUserTemplate(name, code) {
        const list = getUserTemplates();
        list.push({ name, icon: '📄', code, user: true });
        Config.set('templates', list);
    }
    function deleteUserTemplate(name) {
        Config.set('templates', getUserTemplates().filter(t => t.name !== name));
    }

    // =========================================================
    //  编辑器探测
    // =========================================================
    function findEditor() {
        const pm = document.querySelector('.ProseMirror');
        if (pm && pm.isContentEditable) {
            const r = pm.getBoundingClientRect();
            if (r.width > 100 && r.height > 30) return { editor: pm, doc: document };
        }
        for (const f of document.querySelectorAll('iframe')) {
            try {
                const d = f.contentDocument;
                if (!d) continue;
                const ipm = d.querySelector('.ProseMirror');
                if (ipm && ipm.isContentEditable) return { editor: ipm, doc: d };
            } catch { }
        }
        let best = null, bestArea = 0;
        document.querySelectorAll('[contenteditable="true"]').forEach(el => {
            const r = el.getBoundingClientRect();
            const a = r.width * r.height;
            if (r.width > 200 && r.height > 50 && a > bestArea) {
                bestArea = a; best = { editor: el, doc: document };
            }
        });
        return best;
    }

    // =========================================================
    //  读 / 写 文章
    // =========================================================
    function getArticleHTML() {
        const r = findEditor();
        return r ? r.editor.innerHTML : '';
    }

    function dispatchEditorInput(editor) {
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function getArticleImages() {
        const r = findEditor();
        if (!r) return [];
        const seen = new Set();
        const out = [];
        r.editor.querySelectorAll('img').forEach(img => {
            const src = img.getAttribute('src') || img.src;
            if (src && !seen.has(src)) { seen.add(src); out.push(src); }
        });
        return out;
    }

    function cleanHTML(html) {
        return html
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
            .replace(/<object[\s\S]*?<\/object>/gi, '')
            .replace(/<embed[^>]*>/gi, '')
            .replace(/<form[\s\S]*?<\/form>/gi, '')
            .replace(/\s(on\w+)\s*=\s*["'][^"']*["']/gi, '');
    }

    // 清理 ProseMirror 规范化后可能在首部插入的空 <p>
    function cleanupLeadingEmptyP(editor) {
        const first = editor.firstElementChild;
        if (first && first.tagName === 'P' &&
            (first.innerHTML === '' || first.innerHTML === '<br>' || !first.textContent.trim())) {
            first.remove();
            dispatchEditorInput(editor);
        }
    }

    function setCodeFromEditorHTML(html, reason = 'native') {
        if (!elCode) return;
        const editingCode = document.activeElement === elCode;
        const hasUnsavedCode = elCode.value !== state.synced;
        state.synced = html;
        state.lastEditorHTML = html;
        if (editingCode && hasUnsavedCode) {
            checkBanner();
            return;
        }
        state.syncingCode = true;
        elCode.value = html;
        updatePreview();
        saveDraft();
        state.syncingCode = false;
        elBanner?.classList.add('wh-hidden');
        if (reason === 'native') state.styled = false;
    }

    const syncFromNativeEditor = debounce((reason = 'native') => {
        const r = findEditor();
        if (!r) return;
        observeEditor(r.editor);
        const html = r.editor.innerHTML;
        if (html === state.lastEditorHTML && reason !== 'force') return;
        setCodeFromEditorHTML(html, reason);
        const imageCount = getArticleImages().length;
        if (imageCount !== state.lastImageCount) {
            state.lastImageCount = imageCount;
            const activeTab = elPanel?.querySelector('.wh-tab.wh-on');
            if (activeTab?.dataset.tab === 'image') renderImageLibrary();
        }
    }, 180);

    function observeEditor(editor) {
        if (!editor || state.observedEditor === editor) return;
        state.editorObserver?.disconnect();
        state.observedEditor = editor;
        state.lastEditorHTML = editor.innerHTML;
        state.lastImageCount = getArticleImages().length;
        state.editorObserver = new MutationObserver(() => {
            if (state.applying) return;
            syncFromNativeEditor('native');
        });
        state.editorObserver.observe(editor, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
            attributeFilter: ['style', 'src', 'href', 'class', 'data-src', 'alt'],
        });
    }

    function ensureEditorObserved() {
        const r = findEditor();
        if (r) observeEditor(r.editor);
        return r;
    }

    // 保样式兜底：把 HTML 渲染进屏幕外暂存区 → 写真实剪贴板 → 在编辑器执行 paste。
    // 这条路经过 ProseMirror 的粘贴管线，最能保住 grid/flex 等内联样式。
    // selectAll=true 时先全选编辑器内容，相当于"整篇替换"。
    function insertViaClipboard(editor, doc, html, selectAll) {
        try {
            const staging = doc.createElement('div');
            staging.contentEditable = 'true';
            staging.style.cssText = 'position:fixed;left:-9999px;top:100px;width:680px;min-height:10px;opacity:.01;pointer-events:none;z-index:-9999;';
            staging.innerHTML = html;
            doc.body.appendChild(staging);

            staging.focus();
            const sr = doc.createRange();
            sr.selectNodeContents(staging);
            const ssel = doc.getSelection();
            ssel.removeAllRanges(); ssel.addRange(sr);
            const copied = doc.execCommand('copy');
            doc.body.removeChild(staging);
            if (!copied) return false;

            editor.focus();
            const esel = doc.getSelection();
            const er = doc.createRange();
            if (selectAll) { er.selectNodeContents(editor); }
            else { er.selectNodeContents(editor); er.collapse(false); }
            esel.removeAllRanges(); esel.addRange(er);
            return doc.execCommand('paste');
        } catch (e) { log.warn('剪贴板兜底失败', e.message); return false; }
    }

    // 全文替换：把整篇文章替换为给定 HTML
    function applyWhole(code) {
        const r = ensureEditorObserved();
        if (!r) { toast('未找到编辑器，请先点一下正文区域', 'error'); return false; }
        const html = cleanHTML(code);
        try {
            state.applying = true;
            r.editor.innerHTML = html;
            dispatchEditorInput(r.editor);
            setTimeout(() => {
                cleanupLeadingEmptyP(r.editor);
                state.applying = false;
                setCodeFromEditorHTML(r.editor.innerHTML, 'apply');
            }, 80);
            toast('已应用到文章 ✓');
            return true;
        } catch (e) {
            state.applying = false;
            log.warn('innerHTML 替换失败，尝试剪贴板兜底', e.message);
            if (insertViaClipboard(r.editor, r.doc, html, true)) {
                state.applying = true;
                setTimeout(() => {
                    state.applying = false;
                    setCodeFromEditorHTML(r.editor.innerHTML, 'apply');
                }, 120);
                toast('已应用到文章 ✓（兜底）');
                return true;
            }
            toast('应用失败：' + e.message, 'error');
            return false;
        }
    }

    // 追加到文章末尾（保留原内容，尽量保住样式 → 优先走剪贴板粘贴管线）
    function appendToArticle(code) {
        const r = ensureEditorObserved();
        if (!r) { toast('未找到编辑器', 'error'); return false; }
        const html = cleanHTML(code);
        if (insertViaClipboard(r.editor, r.doc, html, false)) {
            state.applying = true;
            setTimeout(() => {
                state.applying = false;
                setCodeFromEditorHTML(r.editor.innerHTML, 'apply');
            }, 120);
            toast('已追加到文章末尾 ✓');
            return true;
        }
        try {
            state.applying = true;
            r.editor.innerHTML = r.editor.innerHTML + html;
            dispatchEditorInput(r.editor);
            state.applying = false;
            setCodeFromEditorHTML(r.editor.innerHTML, 'apply');
            toast('已追加到文章末尾 ✓');
            return true;
        } catch (e) {
            state.applying = false;
            toast('追加失败：' + e.message, 'error');
            return false;
        }
    }

    // =========================================================
    //  工具：光标处插入 / 防抖 / HTML 美化
    // =========================================================
    function insertAtCursor(ta, text) {
        const s = ta.selectionStart ?? ta.value.length;
        const e = ta.selectionEnd ?? ta.value.length;
        ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
        const pos = s + text.length;
        ta.selectionStart = ta.selectionEnd = pos;
        ta.focus();
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function debounce(fn, ms) {
        let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    }

    // 轻量美化：仅做换行 + 缩进，便于阅读（应用前请看预览确认）
    function beautify(html) {
        let s = html.replace(/>\s*</g, '>\n<').trim();
        let indent = 0;
        const VOID = /^<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b/i;
        return s.split('\n').map(raw => {
            const line = raw.trim();
            if (!line) return '';
            const isClose = /^<\//.test(line);
            const isSelfContained = /^<[^>]+>.*<\/[^>]+>$/.test(line); // 同行有开有闭
            const isVoid = VOID.test(line) || /\/>$/.test(line);
            const isOpen = /^<[^/!][^>]*>$/.test(line) && !isVoid && !isSelfContained;
            if (isClose) indent = Math.max(0, indent - 1);
            const out = '  '.repeat(indent) + line;
            if (isOpen) indent++;
            return out;
        }).join('\n');
    }

    // =========================================================
    //  样式
    // =========================================================
    const STYLE_ID = 'wh-editor-styles';
    if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
        :root{
            --wh-primary:#6366f1; --wh-accent:#8b5cf6;
            --wh-text:#1e293b; --wh-dim:#64748b; --wh-border:#e2e8f0;
            --wh-bg:#ffffff; --wh-bg2:#f8fafc;
            --wh-ok:#22c55e; --wh-err:#ef4444; --wh-warn:#f59e0b;
            --wh-font:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
            --wh-mono:'Cascadia Code','Fira Code','JetBrains Mono',Consolas,monospace;
        }

        /* ---- 关闭时的边缘标记 ---- */
        #wh-handle{
            position:fixed; right:0; top:42%; z-index:999970;
            display:flex; align-items:center; gap:6px;
            padding:10px 12px 10px 14px;
            background:linear-gradient(135deg,var(--wh-primary),var(--wh-accent));
            color:#fff; cursor:pointer; user-select:none;
            border-radius:12px 0 0 12px;
            box-shadow:-2px 4px 16px rgba(99,102,241,.4);
            font-family:var(--wh-font); font-size:13px; font-weight:600;
            transition:transform .2s, box-shadow .2s;
        }
        #wh-handle:hover{ transform:translateX(-3px); box-shadow:-4px 6px 22px rgba(99,102,241,.55); }
        #wh-handle svg{ width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:2.2; stroke-linecap:round; stroke-linejoin:round; }
        #wh-handle.wh-hidden{ display:none; }

        /* ---- 注入工具栏的按钮（首选入口） ---- */
        .wh-toolbtn{
            display:inline-flex; align-items:center; gap:4px;
            height:28px; padding:0 11px; border-radius:7px;
            background:linear-gradient(135deg,var(--wh-primary),var(--wh-accent));
            color:#fff; cursor:pointer; user-select:none; vertical-align:middle;
            font-family:var(--wh-font); font-size:12.5px; font-weight:600;
            white-space:nowrap; flex:0 0 auto; box-sizing:border-box;
            box-shadow:0 1px 4px rgba(99,102,241,.35);
        }
        .wh-toolbtn:hover{ filter:brightness(1.07); }
        .wh-toolbtn svg{ width:15px; height:15px; fill:none; stroke:currentColor; stroke-width:2.2; stroke-linecap:round; stroke-linejoin:round; }
        .wh-toolbtn.wh-active{ outline:2px solid rgba(99,102,241,.45); outline-offset:1px; }
        .wh-toolbtn-pink{ background:linear-gradient(135deg,#ec4899,#f43f5e); box-shadow:0 1px 4px rgba(236,72,153,.35); }
        .wh-toolbtn-green{ background:linear-gradient(135deg,#07c160,#10b981); box-shadow:0 1px 4px rgba(7,193,96,.35); }
        .wh-toolbtn-light{
            background:#fff; color:#334155; border:1px solid #dbe3eb; box-shadow:none;
        }
        .wh-toolbtn-light:hover{ border-color:#07c160; color:#07c160; filter:none; }
        #wh-toolbtn-group{
            display:inline-flex; align-items:center; gap:6px; margin-left:8px; vertical-align:middle;
            max-width:120px; flex:0 0 auto; overflow:visible;
        }
        #wh-toolbtn-li{ display:inline-flex; list-style:none; margin:0; padding:0; }

        /* ---- 云中书样式库（左侧原生 DOM，仿壹伴） ---- */
        #wh-gallery{
            position:fixed; top:0; left:0; height:100vh; z-index:999975;
            background:#fff; box-shadow:8px 0 40px rgba(15,23,42,.18);
            display:flex; flex-direction:column; font-family:var(--wh-font);
            transform:translateX(-100%); transition:transform .28s cubic-bezier(.16,1,.3,1);
        }
        #wh-gallery.wh-open{ transform:translateX(0); }
        .wh-gal-resizer{ position:absolute; right:-3px; top:0; width:6px; height:100%; cursor:ew-resize; z-index:2; }
        .wh-gal-resizer:hover{ background:rgba(7,193,96,.25); }
        .wh-gal-head{
            display:flex; align-items:center; justify-content:space-between;
            padding:12px 14px; background:linear-gradient(135deg,#07c160,#10b981); color:#fff; font-size:14px; font-weight:700;
        }
        .wh-gal-x{ width:26px; height:26px; border-radius:7px; border:1px solid rgba(255,255,255,.3); background:rgba(255,255,255,.16); color:#fff; cursor:pointer; font-size:13px; }
        .wh-gal-x:hover{ background:rgba(255,255,255,.3); }
        .wh-gal-actions{ display:flex; gap:7px; padding:10px 12px; border-bottom:1px solid var(--wh-border); background:var(--wh-bg2); }
        .wh-gal-btn{ flex:1; padding:7px 6px; border-radius:8px; border:1px solid var(--wh-border); background:#fff; color:var(--wh-text); font-size:12.5px; cursor:pointer; font-family:var(--wh-font); }
        .wh-gal-btn:hover{ border-color:#07c160; color:#07c160; }
        .wh-gal-body{ flex:1; overflow:auto; padding:12px 14px; }
        .wh-gal-tip{ font-size:11.5px; color:var(--wh-dim); line-height:1.6; margin-bottom:10px; }
        .wh-gal-tip b{ color:#07c160; }
        .wh-gal-sec{ font-size:11px; font-weight:700; color:var(--wh-dim); text-transform:uppercase; letter-spacing:.4px; margin:16px 0 8px; }
        .wh-cards{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
        .wh-card{ display:flex; gap:8px; align-items:center; padding:9px 10px; border:1.5px solid var(--wh-border); border-radius:10px; cursor:pointer; transition:all .12s; background:#fff; }
        .wh-card:hover{ border-color:#10b981; transform:translateY(-1px); box-shadow:0 3px 10px rgba(16,185,129,.18); }
        .wh-card.wh-on{ border-color:#07c160; background:#f0fdf4; }
        .wh-card-ico{ font-size:19px; line-height:1; flex:0 0 auto; }
        .wh-card-tx{ min-width:0; }
        .wh-card-name{ font-size:12.5px; font-weight:600; color:var(--wh-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .wh-card-desc{ font-size:10.5px; color:var(--wh-dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .wh-chips{ display:flex; flex-wrap:wrap; gap:7px; }
        .wh-chip{ display:flex; align-items:center; gap:6px; padding:5px 10px 5px 6px; border:1.5px solid var(--wh-border); border-radius:20px; cursor:pointer; font-size:12px; color:var(--wh-text); transition:all .12s; }
        .wh-chip:hover{ border-color:#10b981; }
        .wh-chip.wh-on{ border-color:#07c160; background:#f0fdf4; }
        .wh-chip-dot{ width:16px; height:16px; border-radius:50%; flex:0 0 auto; box-shadow:inset 0 0 0 1px rgba(0,0,0,.08); }
        .wh-pills{ display:flex; flex-wrap:wrap; gap:7px; }
        .wh-pill{ padding:6px 14px; border:1.5px solid var(--wh-border); border-radius:20px; cursor:pointer; font-size:12.5px; color:var(--wh-text); transition:all .12s; }
        .wh-pill:hover{ border-color:#10b981; }
        .wh-pill.wh-on{ border-color:#07c160; background:#f0fdf4; color:#07c160; }

        /* ---- 一键排版浮层（直接作用于正文） ---- */
        .wh-pop{
            position:fixed; z-index:1000000; background:#fff; border:1px solid var(--wh-border);
            border-radius:12px; box-shadow:0 16px 44px rgba(0,0,0,.18); padding:12px;
            width:330px; font-family:var(--wh-font); display:flex; flex-direction:column; gap:9px;
            animation:wh-slideDown .18s ease;
        }
        .wh-pop-tip{ font-size:11.5px; color:var(--wh-dim); line-height:1.6; margin:0; }
        .wh-pop-tip b{ color:#ec4899; }
        .wh-pop-row{ display:flex; gap:7px; align-items:center; }

        /* ---- 侧边面板 ---- */
        #wh-panel{
            position:fixed; top:0; left:0; height:100vh; z-index:999971;
            background:var(--wh-bg); font-family:var(--wh-font);
            box-shadow:8px 0 40px rgba(15,23,42,.18);
            display:flex; flex-direction:column;
            max-width:calc(100vw - 24px);
            transform:translateX(-100%); transition:transform .28s cubic-bezier(.16,1,.3,1);
        }
        #wh-panel.wh-open{ transform:translateX(0); }

        .wh-resizer{
            position:absolute; right:-3px; top:0; width:6px; height:100%;
            cursor:ew-resize; z-index:2;
        }
        .wh-resizer:hover{ background:rgba(7,193,96,.3); }

        .wh-head{
            padding:13px 16px; display:flex; align-items:center; justify-content:space-between;
            background:linear-gradient(135deg,#07c160,#10b981); color:#fff;
        }
        .wh-head h2{ margin:0; font-size:15px; font-weight:700; letter-spacing:-.2px; display:flex; align-items:center; gap:7px; }
        .wh-head h2 small{ font-weight:400; font-size:11px; opacity:.75; }

        /* 标签栏 */
        .wh-tabs{ display:flex; border-bottom:1px solid var(--wh-border); background:var(--wh-bg2); }
        .wh-tab{
            flex:1; padding:11px 8px; border:none; background:transparent; cursor:pointer;
            font-family:var(--wh-font); font-size:13px; color:var(--wh-dim); font-weight:600;
            border-bottom:2px solid transparent; transition:all .15s;
        }
        .wh-tab:hover{ color:#07c160; }
        .wh-tab.wh-on{ color:#07c160; border-bottom-color:#07c160; background:#fff; }

        .wh-quickbar{
            display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:7px;
            padding:10px 12px; border-bottom:1px solid var(--wh-border); background:#fff;
        }
        .wh-quick{
            height:34px; border-radius:9px; border:1px solid var(--wh-border);
            background:#fff; color:var(--wh-text); font-family:var(--wh-font);
            font-size:12px; font-weight:700; cursor:pointer; white-space:nowrap;
        }
        .wh-quick:hover{ border-color:#07c160; color:#07c160; background:#f0fdf4; }
        .wh-quick-primary{ background:#07c160; border-color:#07c160; color:#fff; }
        .wh-quick-primary:hover{ background:#05a854; color:#fff; }

        /* 内容窗格（同一面板内切换，不弹框） */
        .wh-pane{ flex:1; min-height:0; display:none; flex-direction:column; overflow:hidden; }
        .wh-pane.wh-on{ display:flex; }
        .wh-pane[data-pane="style"]{ overflow:hidden; }
        .wh-pane[data-pane="image"]{ overflow:auto; }
        .wh-icon-btn{
            width:30px; height:30px; border-radius:9px; border:1px solid rgba(255,255,255,.25);
            background:rgba(255,255,255,.14); color:#fff; cursor:pointer; font-size:14px;
            display:inline-flex; align-items:center; justify-content:center; transition:background .15s;
        }
        .wh-icon-btn:hover{ background:rgba(255,255,255,.3); }

        .wh-toolbar{
            padding:9px 12px; border-bottom:1px solid var(--wh-border);
            display:flex; gap:6px; flex-wrap:wrap; background:var(--wh-bg2);
        }
        .wh-tool{
            padding:6px 11px; border-radius:8px; border:1px solid var(--wh-border);
            background:#fff; color:var(--wh-text); font-size:12.5px; cursor:pointer;
            font-family:var(--wh-font); display:inline-flex; align-items:center; gap:5px;
            transition:all .15s; white-space:nowrap;
        }
        .wh-tool:hover{ border-color:var(--wh-primary); color:var(--wh-primary); background:#fff; }
        .wh-tool.wh-active{ background:var(--wh-primary); color:#fff; border-color:var(--wh-primary); }

        .wh-body{ flex:1; display:flex; flex-direction:column; overflow:hidden; }

        .wh-code-wrap{ flex:1 1 55%; display:flex; min-height:120px; position:relative; }
        .wh-code{
            flex:1; width:100%; border:none; outline:none; resize:none;
            padding:14px 16px; box-sizing:border-box;
            font-family:var(--wh-mono); font-size:13px; line-height:1.7;
            color:var(--wh-text); background:#fbfcfe; white-space:pre; tab-size:2;
        }

        /* 预览区 */
        .wh-preview-wrap{
            flex:1 1 45%; border-top:1px solid var(--wh-border);
            display:flex; flex-direction:column; min-height:100px; background:#fff;
        }
        .wh-preview-wrap.wh-hidden{ display:none; }
        .wh-preview-label{
            padding:5px 14px; font-size:11px; color:var(--wh-dim); background:var(--wh-bg2);
            border-bottom:1px solid var(--wh-border); display:flex; justify-content:space-between; align-items:center;
        }
        .wh-preview-frame{ flex:1; width:100%; border:none; background:#fff; }

        /* 排版浮层里的下拉选择 */
        .wh-sel{
            flex:1 1 30%; min-width:80px; padding:7px 8px; border-radius:8px; border:1px solid var(--wh-border);
            background:#fff; color:var(--wh-text); font-size:12.5px; font-family:var(--wh-font); cursor:pointer; outline:none;
        }
        .wh-sel:focus{ border-color:var(--wh-primary); }

        /* 图片抽屉 */
        .wh-imgbar{
            border-top:1px solid var(--wh-border); background:var(--wh-bg2);
            max-height:0; overflow:hidden; transition:max-height .25s ease;
        }
        .wh-imgbar.wh-open{ max-height:230px; overflow:auto; }
        .wh-imgbar-inner{ padding:12px 14px; }
        .wh-imgbar-tip{ font-size:11.5px; color:var(--wh-dim); line-height:1.6; margin:0 0 10px; }
        .wh-imgbar-tip b{ color:var(--wh-primary); }
        .wh-imggrid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(72px,1fr)); gap:8px; }
        .wh-thumb{
            position:relative; aspect-ratio:1; border-radius:8px; overflow:hidden;
            border:1px solid var(--wh-border); cursor:pointer; background:#fff;
            transition:transform .12s, box-shadow .12s;
        }
        .wh-thumb:hover{ transform:translateY(-2px); box-shadow:0 4px 12px rgba(99,102,241,.3); border-color:var(--wh-primary); }
        .wh-thumb img{ width:100%; height:100%; object-fit:cover; display:block; }
        .wh-thumb-add{ display:flex; align-items:center; justify-content:center; font-size:11px; color:var(--wh-dim); text-align:center; padding:4px; }
        .wh-empty{ font-size:12px; color:var(--wh-dim); padding:6px 0; }

        .wh-foot{
            padding:11px 14px; border-top:1px solid var(--wh-border);
            display:flex; gap:8px; align-items:center; background:var(--wh-bg2);
        }
        .wh-foot .wh-spacer{ flex:1; }
        .wh-btn{
            padding:9px 18px; border-radius:9px; font-size:13px; font-weight:600;
            cursor:pointer; border:1px solid transparent; font-family:var(--wh-font);
            display:inline-flex; align-items:center; gap:6px; transition:all .15s;
        }
        .wh-btn-primary{ background:linear-gradient(135deg,var(--wh-primary),var(--wh-accent)); color:#fff; box-shadow:0 2px 8px rgba(99,102,241,.3); }
        .wh-btn-primary:hover{ box-shadow:0 4px 16px rgba(99,102,241,.45); transform:translateY(-1px); }
        .wh-btn-ghost{ background:#fff; border-color:var(--wh-border); color:var(--wh-dim); }
        .wh-btn-ghost:hover{ border-color:var(--wh-primary); color:var(--wh-primary); }

        /* 文章已更新提示条 */
        .wh-banner{
            padding:8px 14px; font-size:12px; background:#fffbeb; color:#b45309;
            border-bottom:1px solid #fde68a; display:flex; justify-content:space-between; align-items:center;
        }
        .wh-banner.wh-hidden{ display:none; }
        .wh-banner button{ border:none; background:#f59e0b; color:#fff; border-radius:6px; padding:3px 10px; font-size:12px; cursor:pointer; }

        /* 下拉菜单 */
        .wh-menu{
            position:fixed; z-index:999999; background:#fff; border:1px solid var(--wh-border);
            border-radius:10px; box-shadow:0 12px 32px rgba(0,0,0,.16); padding:6px; min-width:170px;
            font-family:var(--wh-font);
        }
        .wh-menu-item{
            padding:8px 10px; border-radius:7px; font-size:13px; color:var(--wh-text);
            cursor:pointer; display:flex; align-items:center; gap:8px; justify-content:space-between;
        }
        .wh-menu-item:hover{ background:var(--wh-bg2); }
        .wh-menu-item .wh-del{ color:var(--wh-err); opacity:.55; font-size:12px; }
        .wh-menu-item .wh-del:hover{ opacity:1; }
        .wh-menu-sep{ height:1px; background:var(--wh-border); margin:5px 4px; }

        /* Toast */
        .wh-toast{
            position:fixed; top:22px; left:50%; transform:translateX(-50%);
            padding:11px 22px; border-radius:11px; font-size:13.5px; font-weight:600;
            z-index:1000000; box-shadow:0 8px 32px rgba(0,0,0,.18); color:#fff;
            font-family:var(--wh-font); display:flex; align-items:center; gap:8px; cursor:pointer;
            animation:wh-slideDown .3s cubic-bezier(.16,1,.3,1);
        }
        .wh-toast-success{ background:var(--wh-ok); } .wh-toast-error{ background:var(--wh-err); } .wh-toast-warning{ background:var(--wh-warn); }
        @keyframes wh-slideDown{ from{opacity:0;transform:translate(-50%,-12px);} to{opacity:1;transform:translate(-50%,0);} }
        @keyframes wh-fadeOut{ to{opacity:0;transform:translate(-50%,-8px);} }
        `;
        document.head.appendChild(style);
    }

    // =========================================================
    //  Toast
    // =========================================================
    function toast(msg, type = 'success') {
        document.querySelectorAll('.wh-toast').forEach(el => el.remove());
        const el = document.createElement('div');
        el.className = `wh-toast wh-toast-${type}`;
        const icons = { success: '✓', error: '✕', warning: '!' };
        el.textContent = `${icons[type] || '✓'}  ${msg}`;
        el.onclick = () => el.remove();
        document.body.appendChild(el);
        setTimeout(() => { el.style.animation = 'wh-fadeOut .3s forwards'; setTimeout(() => el.remove(), 300); }, 3200);
    }

    // =========================================================
    //  DOM 引用
    // =========================================================
    let elPanel, elHandle, elCode, elPreviewWrap, elPreviewFrame, elImgGrid, elBanner, elPreviewBtn;

    function buildUI() {
        if (document.getElementById('wh-panel')) return;

        // 边缘标记（仅当工具栏注入失败时作为兜底；先建好不挂载）
        elHandle = document.createElement('div');
        elHandle.id = 'wh-handle';
        elHandle.className = 'wh-hidden';
        elHandle.title = 'HTML 源码编辑 (Alt+H)';
        elHandle.innerHTML = `<svg viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg><span>HTML</span>`;
        elHandle.onclick = openPanel;

        // 单一左侧常驻面板（标签：样式 / 源码 / 图片）—— 仿壹伴，不弹框
        elPanel = document.createElement('div');
        elPanel.id = 'wh-panel';
        elPanel.style.width = state.width + 'px';
        elPanel.innerHTML = `
            <div class="wh-resizer" id="wh-resizer"></div>
            <div class="wh-head">
                <h2>☁️ 云中书排版 <small>v4.7</small></h2>
                <button class="wh-icon-btn" id="wh-collapse" title="收起">✕</button>
            </div>
            <div class="wh-tabs">
                <button class="wh-tab wh-on" data-tab="style">🎨 样式</button>
                <button class="wh-tab" data-tab="code">&lt;/&gt; 源码</button>
                <button class="wh-tab" data-tab="image">🖼 图片</button>
            </div>
            <div class="wh-quickbar">
                <button class="wh-quick wh-quick-primary" id="wh-q-layout">一键排版</button>
                <button class="wh-quick" id="wh-q-read">读取</button>
                <button class="wh-quick" id="wh-q-apply">应用HTML</button>
                <button class="wh-quick" id="wh-q-code">源码</button>
                <button class="wh-quick" id="wh-q-image">图片库</button>
            </div>

            <div class="wh-pane wh-on" data-pane="style">
                <div class="wh-gal-actions">
                    <button class="wh-gal-btn" id="wh-gal-random">🎲 换一版</button>
                    <button class="wh-gal-btn" id="wh-gal-recommend">🤖 智能推荐</button>
                    <button class="wh-gal-btn" id="wh-gal-restore">↩️ 还原</button>
                </div>
                <div class="wh-gal-body" id="wh-style-body"></div>
            </div>

            <div class="wh-pane" data-pane="code">
                <div class="wh-banner wh-hidden" id="wh-banner">
                    <span>📄 文章内容已变化（有未应用的手改）</span>
                    <button id="wh-banner-read">读取最新</button>
                </div>
                <div class="wh-toolbar">
                    <button class="wh-tool" id="wh-read">⟳ 读取文章</button>
                    <button class="wh-tool" id="wh-tpl">🧩 模板</button>
                    <button class="wh-tool" id="wh-beautify">✨ 美化</button>
                    <button class="wh-tool wh-active" id="wh-previewtoggle">👁 预览</button>
                    <button class="wh-tool" id="wh-clear">🗑 清空</button>
                </div>
                <div class="wh-code-wrap">
                    <textarea class="wh-code" id="wh-code" spellcheck="false" placeholder="点「读取文章」载入当前正文 HTML，或直接粘贴排版代码…"></textarea>
                </div>
                <div class="wh-preview-wrap" id="wh-previewwrap">
                    <div class="wh-preview-label"><span>实时预览（仅供参考，发布以公众号为准）</span></div>
                    <iframe class="wh-preview-frame" id="wh-previewframe" sandbox="allow-same-origin"></iframe>
                </div>
                <div class="wh-foot">
                    <button class="wh-btn wh-btn-ghost" id="wh-append" title="保留原内容，把代码加到文章末尾">追加</button>
                    <div class="wh-spacer"></div>
                    <button class="wh-btn wh-btn-primary" id="wh-apply">应用到文章</button>
                </div>
            </div>

            <div class="wh-pane" data-pane="image">
                <div class="wh-imgbar-inner">
                    <p class="wh-imgbar-tip">用公众号顶部「<b>图片</b>」按钮把图传进文章 → 点「刷新」→ <b>点缩略图</b>把该图的微信链接插入「源码」光标处。</p>
                    <div class="wh-imggrid" id="wh-imggrid"></div>
                </div>
            </div>
        `;
        document.body.appendChild(elPanel);

        // 引用
        elCode = elPanel.querySelector('#wh-code');
        elPreviewWrap = elPanel.querySelector('#wh-previewwrap');
        elPreviewFrame = elPanel.querySelector('#wh-previewframe');
        elImgGrid = elPanel.querySelector('#wh-imggrid');
        elBanner = elPanel.querySelector('#wh-banner');
        elPreviewBtn = elPanel.querySelector('#wh-previewtoggle');

        // 恢复草稿
        const draft = Config.get('draft', '');
        if (draft) elCode.value = draft;
        if (!state.previewOn) { elPreviewWrap.classList.add('wh-hidden'); elPreviewBtn.classList.remove('wh-active'); }

        buildStylePane();
        bindEvents();
        updatePreview();
        mountEntry();
    }

    // =========================================================
    //  入口：优先注入微信工具栏，失败兜底为右侧边缘标记
    // =========================================================
    function findToolbar() {
        let best = null, bestScore = 0;
        document.querySelectorAll('div,ul').forEach(el => {
            if (el.closest('#wh-panel')) return;            // 排除我们自己的面板
            const r = el.getBoundingClientRect();
            if (r.width < 480 || r.height < 22 || r.height > 76) return;
            if (r.top < 40 || r.top > 320) return;          // 顶部工具栏纵向区间
            const kids = [...el.children].filter(k => {
                const kr = k.getBoundingClientRect();
                return kr.width > 0 && kr.height > 0;
            });
            if (kids.length < 5) return;                    // 工具栏应有多个图标按钮
            const inRow = kids.filter(k => Math.abs(k.getBoundingClientRect().top - r.top) < r.height).length;
            if (inRow < 5) return;                          // 子元素需大致同一横排
            const score = inRow + r.width / 200;
            if (score > bestScore) { bestScore = score; best = el; }
        });
        return best;
    }

    function ensureToolbarBtn() {
        if (document.getElementById('wh-toolbtn-group')) return true;
        const bar = findToolbar();
        if (!bar) return false;
        const group = document.createElement('span');
        group.id = 'wh-toolbtn-group';
        const btn = createToolbarButton({
            id: 'wh-toolbtn',
            className: 'wh-toolbtn-green',
            label: '云中书',
            title: '打开云中书页面内工作台',
            onClick: () => { openPanel(); switchTab('style'); },
        });
        group.appendChild(btn);
        if (bar.tagName === 'UL') {
            const li = document.createElement('li');
            li.id = 'wh-toolbtn-li';
            li.appendChild(group);
            bar.appendChild(li);
        } else {
            bar.appendChild(group);
        }
        if (state.open) btn.classList.add('wh-active');
        log.ok('已注入工具栏按钮');
        return true;
    }

    function createToolbarButton({ id, className = '', label, title, onClick }) {
        const btn = document.createElement('div');
        if (id) btn.id = id;
        btn.className = `wh-toolbtn ${className}`.trim();
        btn.title = title || label;
        btn.innerHTML = `<span>${label}</span>`;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            onClick();
        });
        return btn;
    }

    function mountEntry() {
        if (ensureToolbarBtn()) { state.entry = 'toolbar'; }
        else {
            let tries = 0;
            const t = setInterval(() => {
                tries++;
                if (ensureToolbarBtn()) { state.entry = 'toolbar'; clearInterval(t); }
                else if (tries >= 12) {                     // ~6s 仍找不到 → 兜底边缘标记
                    clearInterval(t);
                    state.entry = 'handle';
                    elHandle.classList.remove('wh-hidden');
                    if (!elHandle.isConnected) document.body.appendChild(elHandle);
                    log.warn('未找到工具栏，使用右侧边缘标记兜底');
                }
            }, 500);
        }
        // 微信是 React/Vue 重渲染，按钮可能被抹掉 → 监听补回
        const reinject = debounce(() => {
            if (state.entry === 'toolbar' && !document.getElementById('wh-toolbtn-group')) ensureToolbarBtn();
        }, 350);
        new MutationObserver(reinject).observe(document.body, { childList: true, subtree: true });
    }

    function hideEntry() {
        elHandle?.classList.add('wh-hidden');
        document.getElementById('wh-toolbtn')?.classList.add('wh-active');
    }
    function showEntry() {
        if (state.entry === 'handle') elHandle?.classList.remove('wh-hidden');
        document.getElementById('wh-toolbtn')?.classList.remove('wh-active');
    }

    // =========================================================
    //  事件
    // =========================================================
    const updatePreview = debounce(() => {
        if (!state.previewOn || !elPreviewFrame) return;
        const html = cleanHTML(elCode.value);
        elPreviewFrame.srcdoc =
            `<!doctype html><html><head><meta charset="utf-8">
            <style>body{margin:0;padding:16px;background:#fff;color:#1a1a1a;
            font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Helvetica Neue',Arial,sans-serif;
            font-size:15px;line-height:1.75;word-break:break-word;} img{max-width:100%;height:auto;}
            *{box-sizing:border-box;}</style></head>
            <body><div style="max-width:677px;margin:0 auto;">${html}</div></body></html>`;
    }, 250);

    function saveDraft() { Config.set('draft', elCode.value); }
    const saveDraftDebounced = debounce(saveDraft, 400);

    function bindEvents() {
        elPanel.querySelector('#wh-collapse').onclick = closePanel;

        elCode.addEventListener('input', () => {
            if (state.syncingCode) return;
            updatePreview();
            saveDraftDebounced();
            checkBanner();
        });
        // Tab 缩进
        elCode.addEventListener('keydown', e => {
            if (e.key === 'Tab') { e.preventDefault(); insertAtCursor(elCode, '  '); }
        });

        // 读取文章
        elPanel.querySelector('#wh-read').onclick = () => readFromArticle(true);
        elPanel.querySelector('#wh-banner-read').onclick = () => readFromArticle(true);
        elPanel.querySelector('#wh-q-read').onclick = () => { switchTab('code'); readFromArticle(true); };
        elPanel.querySelector('#wh-q-code').onclick = () => switchTab('code');
        elPanel.querySelector('#wh-q-image').onclick = () => { switchTab('image'); renderImageLibrary(); };
        elPanel.querySelector('#wh-q-layout').onclick = () => {
            switchTab('style');
            ensureLayIds();
            if (layIds) { applyLayout(layIds); markActive(); }
        };
        elPanel.querySelector('#wh-q-apply').onclick = () => {
            switchTab('code');
            const v = elCode.value.trim();
            if (!v) { toast('源码框为空，先读取或粘贴 HTML', 'warning'); return; }
            applyWhole(v);
        };

        // 应用 / 追加
        elPanel.querySelector('#wh-apply').onclick = () => {
            const v = elCode.value.trim();
            if (!v) { toast('代码为空', 'warning'); return; }
            if (applyWhole(v)) checkBanner();
        };
        elPanel.querySelector('#wh-append').onclick = () => {
            const v = elCode.value.trim();
            if (!v) { toast('代码为空', 'warning'); return; }
            appendToArticle(v);
        };

        // 美化
        elPanel.querySelector('#wh-beautify').onclick = () => {
            elCode.value = beautify(elCode.value);
            updatePreview(); saveDraft();
            toast('已美化（请看预览确认无误再应用）');
        };

        // 清空
        elPanel.querySelector('#wh-clear').onclick = () => {
            if (!elCode.value || confirm('清空编辑框内容？（不影响文章本身）')) {
                elCode.value = ''; updatePreview(); saveDraft(); checkBanner();
            }
        };

        // 预览开关
        elPreviewBtn.onclick = () => {
            state.previewOn = !state.previewOn;
            Config.set('previewOn', state.previewOn);
            elPreviewWrap.classList.toggle('wh-hidden', !state.previewOn);
            elPreviewBtn.classList.toggle('wh-active', state.previewOn);
            if (state.previewOn) updatePreview();
        };

        // 标签切换（面板内，不弹框）
        elPanel.querySelectorAll('.wh-tab').forEach(tab => tab.onclick = () => switchTab(tab.dataset.tab));

        // 模板菜单
        elPanel.querySelector('#wh-tpl').onclick = (e) => showTemplateMenu(e.currentTarget);

        // 拖拽改宽
        initResizer();
    }

    function switchTab(name) {
        elPanel.querySelectorAll('.wh-tab').forEach(t => t.classList.toggle('wh-on', t.dataset.tab === name));
        elPanel.querySelectorAll('.wh-pane').forEach(p => p.classList.toggle('wh-on', p.dataset.pane === name));
        if (name === 'image') renderImageLibrary();
        if (name === 'code') { readFromArticle(false); updatePreview(); }
        Config.set('tab', name);
    }

    // =========================================================
    //  一键排版（云中书引擎）— 直接作用于原生正文
    // =========================================================
    const YT = () => (typeof window !== 'undefined' && window.YunType) || null;
    let layIds = null;  // 当前选中的 {blueprintId,colorId,typographyId}

    function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    function pushTextAsMarkdown(lines, text) {
        const normalized = String(text || '').replace(/\s+/g, ' ').trim();
        if (!normalized) return;
        const blocks = structureDenseText(normalized);
        blocks.forEach((block, index) => {
            if (block) {
                lines.push(block);
                const next = blocks[index + 1];
                if (!(isMarkdownListLine(block) && isMarkdownListLine(next))) lines.push('');
            }
        });
    }

    function isMarkdownListLine(text) {
        return /^(\d{1,2}[.]|[-*+]\s|[一二三四五六七八九十]{1,3}、)/.test(String(text || '').trim());
    }

    function structureDenseText(text) {
        const s = text.trim();
        if (!s) return [];
        const hasNumberedItems = /(?:^|[。；;!！?？\s])(?:\d{1,2}|[一二三四五六七八九十]{1,3})[.、]/.test(s);
        const startsWithStep = /^Step\s*\d*/i.test(s);
        if (!hasNumberedItems && !startsWithStep && s.length < 140) return [s];

        const blocks = [];
        let rest = s;
        const firstItemIndex = rest.search(/(?:\d{1,2}|[一二三四五六七八九十]{1,3})[.、]/);
        if (startsWithStep && firstItemIndex > 8) {
            const title = rest.slice(0, firstItemIndex).replace(/[。；;，,\s]+$/, '').trim();
            if (title) blocks.push(`## ${title}`);
            rest = rest.slice(firstItemIndex).trim();
        }

        const itemParts = splitNumberedItems(rest);
        if (itemParts.length >= 2) {
            itemParts.forEach(part => {
                const normalized = part
                    .replace(/^(\d{1,2})[.、]\s*/, '$1. ')
                    .replace(/^([一二三四五六七八九十]{1,3})[.、]\s*/, '$1、')
                    .trim();
                if (normalized) blocks.push(normalized);
            });
            return blocks;
        }

        return splitLongParagraph(rest).map(part => part.trim()).filter(Boolean);
    }

    function splitNumberedItems(text) {
        const marked = text
            .replace(/([。；;!！?？])\s*((?:\d{1,2}|[一二三四五六七八九十]{1,3})[.、])/g, '$1\n$2')
            .replace(/([^\n])((?:\d{1,2}|[一二三四五六七八九十]{1,3})[.、])(?=[^\d])/g, '$1\n$2');
        return marked.split(/\n+/).map(x => x.trim()).filter(Boolean);
    }

    function splitLongParagraph(text) {
        if (text.length < 180) return [text];
        return text
            .replace(/([。！？!?])\s*/g, '$1\n')
            .split(/\n+/)
            .map(x => x.trim())
            .filter(Boolean);
    }

    // 把原生正文 DOM 转成 Markdown，保留标题/列表/引用/图片结构，供排版引擎用
    function htmlToMarkdown(root) {
        const inline = (el) => {
            let out = '';
            el.childNodes.forEach(n => {
                if (n.nodeType === 3) { out += n.textContent; return; }
                if (n.nodeType !== 1) return;
                const t = n.tagName.toLowerCase();
                if (t === 'br') out += '\n';
                else if (t === 'strong' || t === 'b') out += '**' + inline(n) + '**';
                else if (t === 'em' || t === 'i') out += '*' + inline(n) + '*';
                else if (t === 'a') out += '[' + inline(n) + '](' + (n.getAttribute('href') || '') + ')';
                else if (t === 'img') out += '![](' + (n.getAttribute('src') || n.src || '') + ')';
                else out += inline(n);
            });
            return out;
        };
        const lines = [];
        const blockImgs = (el) => el.querySelectorAll('img').forEach(im => lines.push('![](' + (im.getAttribute('src') || im.src || '') + ')'));
        const walk = (parent) => {
            parent.childNodes.forEach(node => {
                if (node.nodeType === 3) { pushTextAsMarkdown(lines, node.textContent); return; }
                if (node.nodeType !== 1) return;
                const tag = node.tagName.toLowerCase();
                if (/^h[1-6]$/.test(tag)) { lines.push('#'.repeat(+tag[1]) + ' ' + inline(node).trim()); lines.push(''); }
                else if (tag === 'p' || tag === 'section' || tag === 'div') {
                    const imgs = node.querySelectorAll('img');
                    const txt = inline(node).trim();
                    if (txt) { pushTextAsMarkdown(lines, txt); }
                    else if (imgs.length) { blockImgs(node); lines.push(''); }
                    else if (!txt && node.children.length && !imgs.length) { walk(node); }
                }
                else if (tag === 'ul') { node.querySelectorAll(':scope > li').forEach(li => lines.push('- ' + inline(li).trim())); lines.push(''); }
                else if (tag === 'ol') { let i = 1; node.querySelectorAll(':scope > li').forEach(li => lines.push((i++) + '. ' + inline(li).trim())); lines.push(''); }
                else if (tag === 'blockquote') { inline(node).split('\n').forEach(l => { if (l.trim()) lines.push('> ' + l.trim()); }); lines.push(''); }
                else if (tag === 'hr') { lines.push('---'); lines.push(''); }
                else if (tag === 'img') { lines.push('![](' + (node.getAttribute('src') || node.src || '') + ')'); lines.push(''); }
                else if (node.children.length) walk(node);
                else { const t = inline(node).trim(); if (t) pushTextAsMarkdown(lines, t); }
            });
        };
        walk(root);
        return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    }

    function normalizeLayoutMarkdown(md) {
        const lines = [];
        String(md || '').split(/\n{2,}/).forEach(block => pushTextAsMarkdown(lines, block));
        return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    }

    // 取排版原始 Markdown：已排版且未手改 → 复用原始草稿，避免反复套样式
    function captureLayoutSource() {
        const r = findEditor();
        if (!r) return '';
        if (state.styled && state.layoutRaw) return normalizeLayoutMarkdown(state.layoutRaw);
        const md = normalizeLayoutMarkdown(htmlToMarkdown(r.editor));
        state.layoutRaw = md;
        return md;
    }

    // 把排版结果直接写进原生正文
    function applyLayout(ids) {
        const yt = YT();
        if (!yt) { toast('排版引擎未加载', 'error'); return; }
        const r = findEditor();
        if (!r) { toast('未找到编辑器，请先点一下正文区域', 'error'); return; }
        const src = captureLayoutSource();
        if (!src) { toast('请先在公众号正文里写点内容', 'warning'); return; }
        try {
            const bp = yt.blueprints.find(b => b.id === ids.blueprintId) || yt.blueprints[0];
            const style = yt.getStyleComboV2({ blueprintId: ids.blueprintId, colorId: ids.colorId, typographyId: ids.typographyId, slots: { ...bp.defaultSlots } });
            const html = cleanHTML(yt.renderWechatV2(src, style));
            state.applying = true;
            r.editor.innerHTML = html;
            dispatchEditorInput(r.editor);
            cleanupLeadingEmptyP(r.editor);
            state.applying = false;
            state.layoutHTML = r.editor.innerHTML;
            setCodeFromEditorHTML(r.editor.innerHTML, 'apply');
            state.styled = true;
            layIds = ids;
        } catch (e) {
            state.applying = false;
            log.error('排版失败', e);
            toast('排版失败：' + e.message, 'error');
        }
    }

    // 还原为纯文本（撤销排版）
    function restorePlain() {
        const r = findEditor();
        if (!r) return;
        if (!state.layoutRaw) { toast('没有可还原的草稿', 'warning'); return; }
        r.editor.innerHTML = state.layoutRaw.split('\n')
            .filter(l => l.trim()).map(l => `<p>${escapeHtml(l)}</p>`).join('') || '<p><br></p>';
        state.applying = true;
        dispatchEditorInput(r.editor);
        state.applying = false;
        state.layoutHTML = '';
        state.styled = false;
        setCodeFromEditorHTML(r.editor.innerHTML, 'apply');
        toast('已还原为纯文本');
    }


    function checkBanner() {
        if (!elBanner || !elCode) return;
        // 有未应用的手改，且文章和当前 synced 不同步时提示
        const hasDraft = elCode.value !== state.synced;
        const articleDiffers = getArticleHTML() !== state.synced;
        elBanner.classList.toggle('wh-hidden', !(hasDraft && articleDiffers));
    }

    function readFromArticle(force) {
        const r = ensureEditorObserved();
        const cur = r ? r.editor.innerHTML : '';
        if (!cur) { toast('文章是空的，或未找到编辑器', 'warning'); return; }
        setCodeFromEditorHTML(cur, 'force');
        if (force) toast('已读取文章当前 HTML');
    }

    // 打开面板：自动同步文章当前 HTML（除非有未应用的手改）
    function openPanel() {
        if (!elPanel) buildUI();
        state.open = true;
        elPanel.classList.add('wh-open');
        hideEntry();

        const cur = getArticleHTML();
        ensureEditorObserved();
        const hasDraft = elCode.value.trim() !== '' && elCode.value !== state.synced;
        if (!hasDraft) {
            // 无未应用手改 → 显示文章实时代码（满足"重开即看到当前状态"）
            if (cur) setCodeFromEditorHTML(cur, 'force');
            elBanner.classList.add('wh-hidden');
        } else {
            // 有草稿 → 保留草稿，若文章也变了则提示
            checkBanner();
        }
        updatePreview();
        const activeTab = elPanel.querySelector('.wh-tab.wh-on');
        if (activeTab && activeTab.dataset.tab === 'image') renderImageLibrary();
        markActive();
    }

    function closePanel() {
        state.open = false;
        elPanel.classList.remove('wh-open');
        showEntry();
    }

    function togglePanel() { state.open ? closePanel() : openPanel(); }

    // =========================================================
    //  云中书样式库（纯原生 DOM，仿壹伴，直接作用于原生正文）
    // =========================================================
    function hexesOf(scheme) {
        const out = [];
        try {
            Object.values(scheme.colors || {}).forEach(v => {
                if (typeof v === 'string' && /^#([0-9a-fA-F]{3,8})$/.test(v.trim())) out.push(v.trim());
            });
        } catch { }
        return out.length ? out : ['#94a3b8'];
    }

    function ensureLayIds() {
        const yt = YT();
        if (!layIds && yt) {
            const d = yt.defaultAtomIdsV2();
            layIds = { blueprintId: d.blueprintId, colorId: d.colorId, typographyId: d.typographyId };
        }
        return layIds;
    }

    function markActive() {
        const p = elPanel && elPanel.querySelector('[data-pane="style"]');
        if (!p || !layIds) return;
        p.querySelectorAll('[data-bp]').forEach(el => el.classList.toggle('wh-on', el.dataset.bp === layIds.blueprintId));
        p.querySelectorAll('[data-color]').forEach(el => el.classList.toggle('wh-on', el.dataset.color === layIds.colorId));
        p.querySelectorAll('[data-font]').forEach(el => el.classList.toggle('wh-on', el.dataset.font === layIds.typographyId));
    }

    // 填充面板「样式」标签：蓝图卡 / 配色 / 字体（纯原生 DOM）
    function buildStylePane() {
        const yt = YT();
        const body = elPanel.querySelector('#wh-style-body');
        const aRand = elPanel.querySelector('#wh-gal-random');
        const aRec = elPanel.querySelector('#wh-gal-recommend');
        const aRes = elPanel.querySelector('#wh-gal-restore');
        if (!yt) {
            body.innerHTML = `<div style="padding:20px;color:#dc2626;font-size:13px;line-height:1.7;">排版引擎未加载（engine.js 缺失），请到 chrome://extensions 重新加载本扩展。</div>`;
            return;
        }
        ensureLayIds();
        const bpCards = yt.blueprints.map(b =>
            `<div class="wh-card" data-bp="${b.id}"><div class="wh-card-ico">${b.icon || '📐'}</div>
             <div class="wh-card-tx"><div class="wh-card-name">${b.name}</div><div class="wh-card-desc">${b.desc || ''}</div></div></div>`).join('');
        const colorChips = yt.colorSchemes.map(c => {
            const hx = hexesOf(c);
            const grad = hx.length > 1 ? `linear-gradient(135deg,${hx.slice(0, 3).join(',')})` : hx[0];
            return `<div class="wh-chip" data-color="${c.id}" title="${c.name}"><span class="wh-chip-dot" style="background:${grad}"></span><span class="wh-chip-name">${c.name}</span></div>`;
        }).join('');
        const fontPills = yt.typographySets.map(f => `<div class="wh-pill" data-font="${f.id}">${f.name}</div>`).join('');

        body.innerHTML = `
            <div class="wh-gal-tip">在公众号正文里写好草稿（<b>#</b>标题 / <b>-</b>列表 / <b>&gt;</b>引用 更佳），点下面任意风格 → 整篇排版直接作用到正文。</div>
            <div class="wh-gal-sec">骨架 · ${yt.blueprints.length} 套蓝图</div>
            <div class="wh-cards">${bpCards}</div>
            <div class="wh-gal-sec">配色 · ${yt.colorSchemes.length}</div>
            <div class="wh-chips">${colorChips}</div>
            <div class="wh-gal-sec">字体 · ${yt.typographySets.length}</div>
            <div class="wh-pills">${fontPills}</div>
        `;
        aRand.onclick = () => { const ids = yt.randomAtomIdsV2(); layIds = { blueprintId: ids.blueprintId, colorId: ids.colorId, typographyId: ids.typographyId }; applyLayout(layIds); markActive(); };
        aRec.onclick = () => {
            const src = captureLayoutSource();
            const recs = src ? yt.recommendPresets(src) : [];
            if (recs && recs.length && recs[0].ids) {
                const i = recs[0].ids;
                layIds = { blueprintId: i.blueprintId, colorId: i.colorId, typographyId: i.typographyId };
                applyLayout(layIds); markActive();
                toast(`推荐：${recs[0].emoji || ''}${recs[0].name || ''}`);
            } else toast('正文内容太少，先写点东西', 'warning');
        };
        aRes.onclick = () => restorePlain();
        body.querySelectorAll('[data-bp]').forEach(el => el.onclick = () => { ensureLayIds(); layIds.blueprintId = el.dataset.bp; applyLayout(layIds); markActive(); });
        body.querySelectorAll('[data-color]').forEach(el => el.onclick = () => { ensureLayIds(); layIds.colorId = el.dataset.color; applyLayout(layIds); markActive(); });
        body.querySelectorAll('[data-font]').forEach(el => el.onclick = () => { ensureLayIds(); layIds.typographyId = el.dataset.font; applyLayout(layIds); markActive(); });
        markActive();
    }

    // =========================================================
    //  图片库
    // =========================================================
    function renderImageLibrary() {
        const imgs = getArticleImages();
        elImgGrid.innerHTML = '';
        if (!imgs.length) {
            elImgGrid.innerHTML = `<div class="wh-empty">文章里还没有图片。先用顶部「图片」按钮上传，再点这里的「刷新」。</div>`;
        } else {
            imgs.forEach(src => {
                const t = document.createElement('div');
                t.className = 'wh-thumb';
                t.title = '点击插入到光标处';
                const im = document.createElement('img');
                im.src = src; im.loading = 'lazy';
                t.appendChild(im);
                t.onclick = () => {
                    insertAtCursor(elCode, `<img src="${src}" style="max-width:100%;display:block;margin:16px auto;border-radius:6px;" alt="">`);
                    updatePreview(); saveDraft();
                    toast('已插入图片标签');
                };
                elImgGrid.appendChild(t);
            });
        }
        // 刷新 + 打开上传 两个操作块
        const refresh = document.createElement('div');
        refresh.className = 'wh-thumb wh-thumb-add';
        refresh.innerHTML = '⟳<br>刷新';
        refresh.title = '重新扫描文章图片';
        refresh.onclick = renderImageLibrary;
        elImgGrid.appendChild(refresh);

        const upload = document.createElement('div');
        upload.className = 'wh-thumb wh-thumb-add';
        upload.innerHTML = '➕<br>传图';
        upload.title = '打开公众号图片上传';
        upload.onclick = openNativeUpload;
        elImgGrid.appendChild(upload);
    }

    // 尝试触发微信原生「图片」上传入口；找不到则提示
    function openNativeUpload() {
        closePanel(); // 收起面板，避免遮挡微信弹窗
        const candidates = [...document.querySelectorAll('a,div,span,button,li')];
        const hit = candidates.find(el => {
            const txt = (el.textContent || '').trim();
            const t = (el.getAttribute && (el.getAttribute('title') || '')) || '';
            return (txt === '图片' || t.includes('图片')) &&
                el.getBoundingClientRect().top < 160 && el.offsetParent !== null;
        });
        if (hit) {
            hit.click();
            toast('已为你打开图片上传，传完回到「HTML」面板点图片库刷新', 'success');
        } else {
            toast('请点公众号顶部菜单的「图片」上传，完成后回来点刷新', 'warning');
        }
    }

    // =========================================================
    //  模板菜单
    // =========================================================
    function showTemplateMenu(anchor) {
        document.querySelector('.wh-menu')?.remove();
        const all = [...PRESETS, ...getUserTemplates()];
        const menu = document.createElement('div');
        menu.className = 'wh-menu';
        all.forEach(t => {
            const item = document.createElement('div');
            item.className = 'wh-menu-item';
            const left = document.createElement('span');
            left.textContent = `${t.icon || '📄'}  ${t.name}`;
            left.style.flex = '1';
            item.appendChild(left);
            left.onclick = () => {
                insertAtCursor(elCode, t.code);
                updatePreview(); saveDraft(); menu.remove();
            };
            if (t.user) {
                const del = document.createElement('span');
                del.className = 'wh-del'; del.textContent = '删除';
                del.onclick = (e) => { e.stopPropagation(); deleteUserTemplate(t.name); menu.remove(); showTemplateMenu(anchor); };
                item.appendChild(del);
            }
            menu.appendChild(item);
        });
        const sep = document.createElement('div'); sep.className = 'wh-menu-sep'; menu.appendChild(sep);
        const save = document.createElement('div');
        save.className = 'wh-menu-item';
        save.innerHTML = '<span>💾 把当前代码存为模板</span>';
        save.onclick = () => {
            const v = elCode.value.trim();
            if (!v) { toast('编辑框为空', 'warning'); return; }
            const name = prompt('模板名称：');
            if (name) { saveUserTemplate(name.trim(), v); toast('已保存模板'); }
            menu.remove();
        };
        menu.appendChild(save);

        document.body.appendChild(menu);
        const r = anchor.getBoundingClientRect();
        menu.style.top = (r.bottom + 6) + 'px';
        let left = r.left;
        if (left + menu.offsetWidth > window.innerWidth - 8) left = window.innerWidth - menu.offsetWidth - 8;
        menu.style.left = left + 'px';

        const close = (e) => { if (!menu.contains(e.target) && e.target !== anchor) { menu.remove(); document.removeEventListener('mousedown', close); } };
        setTimeout(() => document.addEventListener('mousedown', close), 0);
    }

    // =========================================================
    //  拖拽改宽
    // =========================================================
    function initResizer() {
        const handle = elPanel.querySelector('#wh-resizer');
        let startX, startW;
        const onMove = (e) => {
            const dx = e.clientX - startX;   // 左侧面板：右边缘往右拖 → 变宽
            let w = Math.min(Math.max(startW + dx, 320), Math.min(680, window.innerWidth - 80));
            elPanel.style.width = w + 'px';
            state.width = w;
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.userSelect = '';
            Config.set('width', state.width);
        };
        handle.addEventListener('mousedown', (e) => {
            startX = e.clientX; startW = elPanel.offsetWidth;
            document.body.style.userSelect = 'none';
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    // =========================================================
    //  初始化
    // =========================================================
    function init() {
        let n = 0;
        const timer = setInterval(() => {
            n++;
            if (document.querySelector('.ProseMirror') || document.querySelectorAll('[contenteditable="true"]').length) {
                clearInterval(timer);
                buildUI();
                ensureEditorObserved();
                log.ok(`就绪 (${n} 次轮询)`);
                return;
            }
            if (n >= 60) { clearInterval(timer); buildUI(); ensureEditorObserved(); log.warn('超时，仍创建面板'); }
        }, 500);

        // 快捷键 Alt+H
        document.addEventListener('keydown', (e) => {
            if (e.altKey && (e.key === 'h' || e.key === 'H')) { e.preventDefault(); togglePanel(); }
        });
    }

    document.readyState === 'loading'
        ? document.addEventListener('DOMContentLoaded', init)
        : init();

    log.info('加载完毕');
})();
