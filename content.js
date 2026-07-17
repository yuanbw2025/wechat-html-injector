// ==UserScript==
// @name         微信公众号HTML编辑器-侧边源码版
// @namespace    https://mp.weixin.qq.com/
// @version      4.9.6
// @description  原生左栏工作台：单一HTML编辑区实时双向同步微信公众号原生编辑区，页面化AI配置、护眼背景与图片保护。
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
    log.info('脚本启动 v4.9.6 — 编辑页门禁 + 常驻左栏 + HTML 实时双向同步 + 护眼背景皮肤');

    // =========================================================
    //  全局状态
    // =========================================================
    const state = {
        open: true,
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
        nativeMounted: false,
        sideHost: null,
        sideList: null,
        previousSideWidth: '',
        previousSideMinWidth: '',
        previousSideFlex: '',
        previousSideOverflow: '',
        previousHostBackground: '',
        styleMode: 'blueprint',
        readingBg: 'default',
        htmlLiveTimer: null,
        initTimer: null,
        lifecycleObserver: null,
        entryObserver: null,
        missingEditorChecks: 0,
        keyHandlerBound: false,
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
    state.width = Math.min(Math.max(Config.get('width', 420), 360), 520);
    state.previewOn = Config.get('previewOn', true);
    state.styleMode = Config.get('styleMode', 'blueprint');
    state.readingBg = Config.get('readingBg', 'default');

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
    function svgTexture(svg) {
        return `url("data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22')}")`;
    }

    const TEX = {
        bamboo: svgTexture(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" viewBox="0 0 360 240"><g fill="none" stroke="#7aa66d" stroke-opacity=".20" stroke-width="2"><path d="M282 15c-20 45-24 89-12 136"/><path d="M303 8c-21 52-26 111-8 170"/><path d="M86 52c-18 36-19 76-4 121"/></g><g fill="#7aa66d" fill-opacity=".13"><ellipse cx="258" cy="56" rx="38" ry="8" transform="rotate(-34 258 56)"/><ellipse cx="292" cy="82" rx="35" ry="7" transform="rotate(24 292 82)"/><ellipse cx="302" cy="130" rx="42" ry="8" transform="rotate(-29 302 130)"/><ellipse cx="74" cy="91" rx="30" ry="7" transform="rotate(-38 74 91)"/><ellipse cx="98" cy="123" rx="34" ry="7" transform="rotate(28 98 123)"/></g></svg>`),
        landscape: svgTexture(`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="260" viewBox="0 0 420 260"><rect width="420" height="260" fill="none"/><g fill="none" stroke="#6f9f8f" stroke-opacity=".18" stroke-width="2"><path d="M0 173c48-30 79-31 119-4 43 29 72 23 113-19 49-50 92-53 188-4"/><path d="M0 198c57-20 97-16 149 1 63 20 116 7 168-32 37-28 64-32 103-18"/><path d="M28 222c63-15 107-8 151 2 58 13 91 5 137-22 33-20 64-23 104-11"/></g><g fill="#6f9f8f" fill-opacity=".10"><path d="M58 143l52-61 49 61z"/><path d="M152 151l83-92 86 92z"/><path d="M257 144l47-54 57 54z"/></g></svg>`),
        boat: svgTexture(`<svg xmlns="http://www.w3.org/2000/svg" width="380" height="230" viewBox="0 0 380 230"><g fill="none" stroke="#6ba9a1" stroke-opacity=".16" stroke-width="2"><path d="M0 157c42-14 78-14 120 0s78 14 120 0 78-14 140 0"/><path d="M0 184c42-14 78-14 120 0s78 14 120 0 78-14 140 0"/><path d="M0 211c42-14 78-14 120 0s78 14 120 0 78-14 140 0"/></g><g fill="#6ba9a1" fill-opacity=".14"><path d="M104 138h74l-18 13h-39z"/><path d="M150 71l3 65h-6z"/><path d="M154 82c31 20 42 39 49 55h-46z"/></g></svg>`),
        paper: svgTexture(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 0.62 0 0 0 0 0.54 0 0 0 0 0.42 0 0 0 .16 0"/></filter><rect width="160" height="160" filter="url(#n)" opacity=".55"/></svg>`),
        snow: svgTexture(`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="260" viewBox="0 0 420 260"><defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#b8d4ee" stop-opacity=".24"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="420" height="260" fill="url(#g)"/><g fill="none" stroke="#7fa5c7" stroke-opacity=".16" stroke-width="2"><path d="M42 178c46-60 96-71 152-16 44 44 99 36 184-37"/><path d="M0 214c70-30 125-28 183-9 82 27 132 18 237-30"/></g></svg>`),
        sunset: svgTexture(`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="260" viewBox="0 0 420 260"><defs><linearGradient id="s" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#f0a36d" stop-opacity=".22"/><stop offset=".46" stop-color="#f5cfba" stop-opacity=".18"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="420" height="260" fill="url(#s)"/><circle cx="288" cy="88" r="34" fill="#d88b54" fill-opacity=".12"/><g fill="none" stroke="#b97d5b" stroke-opacity=".13" stroke-width="2"><path d="M0 174c63-10 94-8 151 3 57 11 121 11 269-17"/><path d="M0 202c78-11 120-8 188 1 71 9 134 3 232-20"/></g></svg>`),
    };

    const READING_BACKGROUNDS = [
        { id: 'default', name: '默认白', desc: '恢复微信原本页面', color: '#ffffff', page: '', editor: '', code: '', text: '' },
        { id: 'minimal-white', name: '极简白色', desc: '轻微降亮的白底', color: '#f4f6f2', page: '#f4f6f2', editor: '#fbfcf9', code: '#fbfcf9', text: '#25302b' },
        { id: 'eye-green', name: '护眼绿', desc: '柔和低饱和绿色', color: '#dcebd3', page: '#dcebd3', editor: '#eef7e9', code: '#f2faee', text: '#253327' },
        { id: 'fresh-green', name: '清新绿底', desc: '小说阅读常用淡绿', color: '#d9f1dc', page: '#d9f1dc', editor: '#effaf0', code: '#f3fbf4', text: '#213526', texture: TEX.bamboo },
        { id: 'bamboo', name: '竹影清风', desc: '淡竹叶护眼底', color: '#dcefd6', page: '#dcefd6', editor: '#f0faec', code: '#f4fbf0', text: '#213526', texture: TEX.bamboo },
        { id: 'mint-wave', name: '一叶凌波', desc: '水感薄荷浅绿', color: '#d8f2e8', page: '#d8f2e8', editor: '#effbf7', code: '#f4fcfa', text: '#213431', texture: TEX.boat },
        { id: 'cyan', name: '浅青色', desc: '清爽偏冷阅读底', color: '#d7f0ee', page: '#d7f0ee', editor: '#edfafa', code: '#f0fbfb', text: '#233436' },
        { id: 'sky-blue', name: '素裹银妆', desc: '浅蓝雪感底色', color: '#dbe8f8', page: '#dbe8f8', editor: '#f1f6ff', code: '#f5f8ff', text: '#263142', texture: TEX.snow },
        { id: 'snow-blue', name: '星雪澄霄', desc: '清透冷蓝底', color: '#d6e7f4', page: '#d6e7f4', editor: '#eef7ff', code: '#f3f9ff', text: '#243241', texture: TEX.snow },
        { id: 'lavender', name: '空谷鹤影', desc: '淡紫偏蓝柔光', color: '#e2e3fb', page: '#e2e3fb', editor: '#f5f5ff', code: '#f8f8ff', text: '#303044' },
        { id: 'pink-haze', name: '芳菲侵殿', desc: '淡粉轻柔底色', color: '#f7dfe8', page: '#f7dfe8', editor: '#fff2f7', code: '#fff7fa', text: '#3e2931' },
        { id: 'pink-solid', name: '淡粉素底', desc: '更克制的粉白', color: '#f3e1df', page: '#f3e1df', editor: '#fff4f2', code: '#fff8f6', text: '#3d2e2b' },
        { id: 'apricot', name: '暖杏色', desc: '夜间灯光下舒服', color: '#f4dfcf', page: '#f4dfcf', editor: '#fff1e8', code: '#fff6ef', text: '#3b2e28' },
        { id: 'warm-yellow', name: '暖黄素底', desc: '温暖米黄色', color: '#f1e3c4', page: '#f1e3c4', editor: '#fff4d8', code: '#fff8e5', text: '#372f22' },
        { id: 'parchment', name: '羊皮纸', desc: '阅读器常用暖黄', color: '#f1e1bd', page: '#f1e1bd', editor: '#fff2cf', code: '#fff7df', text: '#382f21', texture: TEX.paper },
        { id: 'kraft-yellow', name: '牛皮纸黄', desc: '纸张颗粒感暖底', color: '#e9d1ad', page: '#e9d1ad', editor: '#f8e8cc', code: '#fbf0da', text: '#3b2d20', texture: TEX.paper },
        { id: 'retro-brown', name: '复古褐底', desc: '茶褐阅读底色', color: '#d9b779', page: '#d9b779', editor: '#efd39a', code: '#f5dfb0', text: '#382817' },
        { id: 'landscape', name: '青野孤舟', desc: '山水远影皮肤', color: '#d8eee4', page: '#d8eee4', editor: '#eef9f2', code: '#f4fbf6', text: '#24352f', texture: TEX.landscape },
        { id: 'sunset', name: '长河落日', desc: '低饱和霞光橙', color: '#efd6bf', page: '#efd6bf', editor: '#fff0df', code: '#fff5ea', text: '#3c2b20', texture: TEX.sunset },
        { id: 'paper-xuan', name: '素纸生宣', desc: '宣纸灰白底', color: '#ecebe4', page: '#ecebe4', editor: '#faf9f2', code: '#fbfaf5', text: '#30312b', texture: TEX.paper },
        { id: 'soft-gray', name: '柔灰色', desc: '降低白屏刺激', color: '#e7e7df', page: '#e7e7df', editor: '#f5f5ed', code: '#f8f8f1', text: '#30312d', texture: TEX.paper },
        { id: 'sand', name: '浅沙素底', desc: '温和低亮沙色', color: '#e4d2bd', page: '#e4d2bd', editor: '#f6eadc', code: '#faf1e7', text: '#3b2d22', texture: TEX.paper },
    ];
    const getUserTemplates = () => Config.get('templates', []);
    const getUserStyleTemplates = () => Config.get('styleTemplates', []);
    const getAllReadingBackgrounds = () => READING_BACKGROUNDS;
    function saveUserTemplate(name, code) {
        const list = getUserTemplates();
        list.push({ name, icon: '📄', code, user: true });
        Config.set('templates', list);
    }
    function deleteUserTemplate(name) {
        Config.set('templates', getUserTemplates().filter(t => t.name !== name));
    }
    function saveStyleTemplate(name, ids) {
        const tpl = {
            id: 'style-' + Date.now().toString(36),
            name: name || '我的排版模板',
            ids: { ...ids },
        };
        Config.set('styleTemplates', [...getUserStyleTemplates(), tpl]);
        return tpl;
    }
    function deleteStyleTemplate(id) {
        Config.set('styleTemplates', getUserStyleTemplates().filter(t => t.id !== id));
    }

    // =========================================================
    //  编辑器探测
    // =========================================================
    function isTitleLikeEditor(el) {
        const text = [
            el.id, el.className, el.getAttribute?.('placeholder'), el.getAttribute?.('aria-label'),
            el.getAttribute?.('data-placeholder'), el.getAttribute?.('title'),
            el.closest?.('[id*="title"],[class*="title"],[id*="author"],[class*="author"],[id*="digest"],[class*="digest"]')?.className,
        ].filter(Boolean).join(' ').toLowerCase();
        return /title|标题|author|作者|digest|摘要|封面|cover/.test(text);
    }

    function isBodyEditorCandidate(el) {
        if (!el || !el.isContentEditable || isTitleLikeEditor(el)) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 220 || r.height < 80) return false;
        if (el.closest('#wh-panel')) return false;
        if (el.closest('#js_appmsg_editor,#editor_pannel,.appmsg_edit_box,.edui-editor,.ProseMirror')) return true;
        const text = (el.textContent || '').trim();
        return r.height > 180 && text.length > 20;
    }

    function findEditor() {
        const bodyScoped = document.querySelector([
            '#js_appmsg_editor .ProseMirror',
            '#editor_pannel .ProseMirror',
            '.appmsg_edit_box .ProseMirror',
            '#js_appmsg_editor [contenteditable="true"]',
            '#editor_pannel [contenteditable="true"]',
            '.appmsg_edit_box [contenteditable="true"]'
        ].join(','));
        if (isBodyEditorCandidate(bodyScoped)) return { editor: bodyScoped, doc: document };

        const pm = [...document.querySelectorAll('.ProseMirror')].find(isBodyEditorCandidate);
        if (pm) {
            const r = pm.getBoundingClientRect();
            if (r.width > 100 && r.height > 30) return { editor: pm, doc: document };
        }
        for (const f of document.querySelectorAll('iframe')) {
            try {
                const d = f.contentDocument;
                if (!d) continue;
                const ipm = [...d.querySelectorAll('.ProseMirror,[contenteditable="true"]')].find(isBodyEditorCandidate);
                if (ipm && ipm.isContentEditable) return { editor: ipm, doc: d };
            } catch { }
        }
        let best = null, bestArea = 0;
        document.querySelectorAll('[contenteditable="true"]').forEach(el => {
            if (!isBodyEditorCandidate(el)) return;
            const r = el.getBoundingClientRect();
            const a = r.width * r.height;
            if (r.width > 200 && r.height > 50 && a > bestArea) {
                bestArea = a; best = { editor: el, doc: document };
            }
        });
        return best;
    }

    function hasRealArticleEditor() {
        return Boolean(findEditor());
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

    function formatHTMLForCode(html) {
        const input = String(html || '').trim();
        if (!input) return '';
        try { return beautify(input); }
        catch { return input.replace(/>\s*</g, '>\n<'); }
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
        const formatted = formatHTMLForCode(html);
        const editingCode = document.activeElement === elCode;
        const hasUnsavedCode = elCode.value !== state.synced;
        state.synced = formatted;
        state.lastEditorHTML = html;
        if (editingCode && hasUnsavedCode) {
            checkBanner();
            return;
        }
        state.syncingCode = true;
        elCode.value = formatted;
        updatePreview();
        saveDraft();
        state.syncingCode = false;
        elBanner?.classList.add('wh-hidden');
        if (reason === 'native') setSyncState('已从原生编辑区读取', 'ok');
        if (reason === 'apply') setSyncState('已同步到原生编辑区', 'ok');
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
            const activeTab = elPanel?.querySelector('.wh-rail-btn.wh-on[data-tab]');
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
    function applyWhole(code, opts = {}) {
        const r = ensureEditorObserved();
        if (!r) { if (!opts.silent) toast('未找到编辑器，请先点一下正文区域', 'error'); return false; }
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
            if (!opts.silent) toast('已应用到文章 ✓');
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
                if (!opts.silent) toast('已应用到文章 ✓（兜底）');
                return true;
            }
            if (!opts.silent) toast('应用失败：' + e.message, 'error');
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

    function getReadingBackground(id = state.readingBg) {
        return getAllReadingBackgrounds().find(item => item.id === id) || READING_BACKGROUNDS[0];
    }

    function applyReadingBackground(id = state.readingBg, opts = {}) {
        state.readingBg = getReadingBackground(id).id;
        Config.set('readingBg', state.readingBg);
        const bg = getReadingBackground();
        const root = document.documentElement;
        root.style.setProperty('--wh-reader-page', bg.page || '#ffffff');
        root.style.setProperty('--wh-reader-editor', bg.editor || '#ffffff');
        root.style.setProperty('--wh-reader-code', bg.code || '#fbfcfe');
        root.style.setProperty('--wh-reader-texture', bg.texture || 'none');
        document.body.classList.toggle('wh-reading-bg-on', state.readingBg !== 'default');
        document.body.dataset.whReadingBg = state.readingBg;
        markWechatReadingBars();
        updateReadingBackgroundUI();
        if (!opts.silent) toast(state.readingBg === 'default' ? '已恢复默认白色背景' : `已切换为${bg.name}`);
    }

    function updateReadingBackgroundUI() {
        if (!elPanel) return;
        elPanel.querySelectorAll('[data-reading-bg]').forEach(el => {
            el.classList.toggle('wh-on', el.dataset.readingBg === state.readingBg);
        });
        const label = elPanel.querySelector('#wh-reading-current');
        if (label) label.textContent = getReadingBackground().name;
    }

    const markWechatReadingBars = debounce(() => {
        document.querySelectorAll('.wh-reader-wechat-bar').forEach(el => el.classList.remove('wh-reader-wechat-bar'));
        if (state.readingBg === 'default') return;
        document.querySelectorAll('div,section,header,footer,ul').forEach(el => {
            if (el.closest('#wh-panel,.wh-toast,.wh-menu,.wh-pop')) return;
            const r = el.getBoundingClientRect();
            if (r.width < Math.min(640, window.innerWidth * 0.45) || r.height < 34 || r.height > 120) return;
            const text = (el.textContent || '').replace(/\s+/g, '');
            const isTopInsertBar = r.top < 90 && /(图片|视频|音频|超链接|小程序|模板|投票|搜索|地理位置|视频号|账号名片)/.test(text);
            const isFormatBar = r.top < 180 && /(px|正文|B|AI|HTML)/i.test(text) && el.querySelectorAll('button,a,span,i,svg').length >= 8;
            if (isTopInsertBar || isFormatBar) el.classList.add('wh-reader-wechat-bar');
        });
    }, 80);

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
        .wh-gal-actions{ display:flex; gap:6px; padding:7px 8px; border-bottom:1px solid var(--wh-border); background:var(--wh-bg2); }
        .wh-gal-btn{ flex:1; min-width:0; height:28px; padding:0 4px; border-radius:7px; border:1px solid var(--wh-border); background:#fff; color:var(--wh-text); font-size:11px; cursor:pointer; font-family:var(--wh-font); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .wh-gal-btn:hover{ border-color:#07c160; color:#07c160; }
        .wh-gal-body{ flex:1; overflow:auto; padding:8px; }
        .wh-gal-tip{ font-size:11px; color:var(--wh-dim); line-height:1.45; margin-bottom:8px; }
        .wh-gal-tip b{ color:#07c160; }
        .wh-gal-sec{ font-size:10.5px; font-weight:700; color:var(--wh-dim); text-transform:uppercase; letter-spacing:.35px; margin:11px 0 6px; }
        .wh-cards{ display:grid; grid-template-columns:repeat(auto-fit,minmax(126px,1fr)); gap:6px; }
        .wh-card{ display:flex; gap:6px; align-items:center; min-height:48px; padding:7px 8px; border:1px solid var(--wh-border); border-radius:8px; cursor:pointer; transition:all .12s; background:#fff; }
        .wh-card:hover{ border-color:#10b981; transform:translateY(-1px); box-shadow:0 3px 10px rgba(16,185,129,.18); }
        .wh-card.wh-on{ border-color:#07c160; background:#f0fdf4; }
        .wh-card-ico{ font-size:16px; line-height:1; flex:0 0 auto; }
        .wh-card-tx{ min-width:0; }
        .wh-card-name{ font-size:12px; font-weight:700; color:var(--wh-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .wh-card-desc{ font-size:10px; color:var(--wh-dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .wh-chips{ display:flex; flex-wrap:wrap; gap:6px; }
        .wh-chip{ display:flex; align-items:center; gap:5px; height:26px; padding:0 8px 0 5px; border:1px solid var(--wh-border); border-radius:16px; cursor:pointer; font-size:11.5px; color:var(--wh-text); transition:all .12s; }
        .wh-chip:hover{ border-color:#10b981; }
        .wh-chip.wh-on{ border-color:#07c160; background:#f0fdf4; }
        .wh-chip-dot{ width:14px; height:14px; border-radius:50%; flex:0 0 auto; box-shadow:inset 0 0 0 1px rgba(0,0,0,.08); }
        .wh-pills{ display:flex; flex-wrap:wrap; gap:6px; }
        .wh-pill{ height:27px; padding:0 11px; display:inline-flex; align-items:center; border:1px solid var(--wh-border); border-radius:16px; cursor:pointer; font-size:11.5px; color:var(--wh-text); transition:all .12s; }
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
        #wh-panel.wh-native{
            position:relative; top:auto; left:auto; width:100% !important; height:100% !important; min-height:0; z-index:auto;
            max-width:none; transform:none !important; transition:none;
            box-shadow:none; border-right:1px solid var(--wh-border);
            flex:0 0 auto; overflow:hidden;
        }
        #wh-panel.wh-native:not(.wh-open){ display:none; }
        #wh-panel.wh-native .wh-head{ padding-top:0; }
        #wh-panel.wh-native .wh-resizer{ right:0; }
        body.wh-native-side-mounted #wh-handle{ display:none !important; }
        body.wh-native-side-mounted #js_side_article_list{
            transition:width .18s ease;
            display:block !important;
            height:100% !important;
            overflow:visible !important;
        }
        body.wh-native-side-mounted #js_side_article_list > :not(#wh-panel){
            display:none !important;
        }
        body.wh-native-side-mounted #js_side_article_list.is-collapsed{
            width:0 !important;
            min-width:0 !important;
        }

        .wh-resizer{
            position:absolute; right:-3px; top:0; width:6px; height:100%;
            cursor:ew-resize; z-index:2;
        }
        .wh-resizer:hover{ background:rgba(7,193,96,.3); }

        .wh-head{
            min-height:44px; padding:0 12px; display:flex; align-items:center; justify-content:space-between;
            background:linear-gradient(135deg,#07c160,#10b981); color:#fff;
        }
        .wh-head h2{ margin:0; font-size:14px; font-weight:700; letter-spacing:-.2px; display:flex; align-items:center; gap:6px; }
        .wh-head h2 small{ font-weight:400; font-size:10px; opacity:.75; }

        /* 标签栏 */
        .wh-tabs{ display:flex; height:36px; border-bottom:1px solid var(--wh-border); background:var(--wh-bg2); }
        .wh-tab{
            flex:1; padding:0 8px; border:none; background:transparent; cursor:pointer;
            font-family:var(--wh-font); font-size:12px; color:var(--wh-dim); font-weight:700;
            border-bottom:2px solid transparent; transition:all .15s;
        }
        .wh-tab:hover{ color:#07c160; }
        .wh-tab.wh-on{ color:#07c160; border-bottom-color:#07c160; background:#fff; }

        .wh-quickbar{
            display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:6px;
            padding:7px 8px; border-bottom:1px solid var(--wh-border); background:#fff;
        }
        .wh-quick{
            height:30px; border-radius:8px; border:1px solid var(--wh-border);
            background:#fff; color:var(--wh-text); font-family:var(--wh-font);
            font-size:11.5px; font-weight:700; cursor:pointer; white-space:nowrap;
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
            width:26px; height:26px; border-radius:8px; border:1px solid rgba(255,255,255,.25);
            background:rgba(255,255,255,.14); color:#fff; cursor:pointer; font-size:14px;
            display:inline-flex; align-items:center; justify-content:center; transition:background .15s;
        }
        .wh-icon-btn:hover{ background:rgba(255,255,255,.3); }

        .wh-toolbar{
            padding:7px 8px; border-bottom:1px solid var(--wh-border);
            display:flex; gap:5px; flex-wrap:wrap; background:var(--wh-bg2);
        }
        .wh-tool{
            padding:5px 8px; border-radius:7px; border:1px solid var(--wh-border);
            background:#fff; color:var(--wh-text); font-size:11.5px; cursor:pointer;
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
            color:var(--wh-text); background:#fbfcfe; white-space:pre-wrap; tab-size:2;
            overflow-x:hidden; overflow-y:auto; overflow-wrap:anywhere; word-break:break-word;
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

        /* ---- v4.9 compact rail layout ---- */
        #wh-panel.wh-rail-mode{
            flex-direction:row;
            background:#fff;
        }
        #wh-panel.wh-rail-mode .wh-head,
        #wh-panel.wh-rail-mode .wh-tabs,
        #wh-panel.wh-rail-mode .wh-quickbar{
            display:none !important;
        }
        .wh-rail{
            width:44px; flex:0 0 44px; height:100%; min-height:100vh;
            display:flex; flex-direction:column; align-items:center;
            background:#f8fafc; border-right:1px solid var(--wh-border);
        }
        .wh-rail-logo{
            width:44px; height:28px; display:flex; align-items:center; justify-content:center;
            color:#07c160; font-size:15px; font-weight:800; border-bottom:1px solid var(--wh-border);
        }
        .wh-rail-nav{ display:flex; flex-direction:column; gap:3px; padding:5px 0; width:100%; align-items:center; }
        .wh-rail-spacer{ flex:1; }
        .wh-rail-btn{
            width:36px; height:34px; border:0; border-radius:8px; background:transparent;
            display:flex; flex-direction:column; align-items:center; justify-content:center;
            gap:0; color:#64748b; font:700 9px/1 var(--wh-font); cursor:pointer;
        }
        .wh-rail-btn b{ font-size:14px; line-height:14px; font-weight:700; }
        .wh-rail-btn:hover{ background:#eefdf3; color:#07a855; }
        .wh-rail-btn.wh-on{ background:#07c160; color:#fff; }
        .wh-rail-close{ margin:0 0 8px; }
        #wh-panel.wh-native .wh-rail-close{ display:none; }
        #wh-panel.wh-native .wh-rail,
        #wh-panel.wh-native .wh-main{ min-height:0; }
        .wh-main{ flex:1; min-width:0; height:100%; min-height:100vh; display:flex; flex-direction:column; overflow:hidden; }
        .wh-pane-title{
            height:30px; flex:0 0 30px; display:flex; align-items:center; justify-content:space-between;
            padding:0 8px; border-bottom:1px solid var(--wh-border); background:#fff;
            font:800 12px/1 var(--wh-font); color:var(--wh-text);
        }
        .wh-pane-title small{ font-size:10px; font-weight:600; color:var(--wh-dim); }
        .wh-style-tabs{
            height:30px; flex:0 0 30px; display:grid; grid-template-columns:repeat(3,1fr);
            gap:5px; padding:4px 7px; border-bottom:1px solid var(--wh-border); background:#f8fafc;
        }
        .wh-style-tab{
            border:1px solid transparent; background:transparent; border-radius:8px;
            font:800 12px/1 var(--wh-font); color:#64748b; cursor:pointer;
        }
        .wh-style-tab.wh-on{ background:#fff; color:#07a855; border-color:#bbf7d0; box-shadow:0 1px 2px rgba(15,23,42,.05); }
        .wh-style-panel{ display:none; }
        .wh-style-panel.wh-on{ display:block; }
        .wh-code-wrap.wh-live{
            flex:1 1 auto; min-height:0;
        }
        .wh-code-wrap.wh-live .wh-code{
            font-size:12px; line-height:1.5; padding:8px 10px;
        }
        .wh-syncbar{
            min-height:26px; display:flex; align-items:center; justify-content:space-between;
            gap:6px; padding:4px 6px; border-top:1px solid var(--wh-border); background:#f8fafc;
            font:600 10.5px/1.3 var(--wh-font); color:#64748b;
        }
        .wh-mini-btn{
            height:22px; padding:0 7px; border-radius:7px; border:1px solid var(--wh-border);
            background:#fff; color:#334155; font:700 10.5px/1 var(--wh-font); cursor:pointer;
        }
        .wh-mini-btn:hover{ border-color:#07c160; color:#07a855; }
        .wh-settings{ padding:10px; overflow:auto; display:flex; flex-direction:column; gap:10px; }
        .wh-field{ display:flex; flex-direction:column; gap:5px; }
        .wh-field label{ font:800 11px/1 var(--wh-font); color:#475569; }
        .wh-input,.wh-textarea{
            width:100%; box-sizing:border-box; border:1px solid var(--wh-border); border-radius:8px;
            padding:8px 9px; outline:none; font:12px/1.45 var(--wh-font); color:var(--wh-text); background:#fff;
        }
        .wh-textarea{ min-height:84px; resize:vertical; }
        .wh-input:focus,.wh-textarea:focus{ border-color:#07c160; box-shadow:0 0 0 2px rgba(7,193,96,.12); }
        .wh-settings-actions{ display:flex; gap:8px; }
        .wh-settings-actions .wh-mini-btn{ flex:1; height:30px; }

        /* ---- 阅读护眼背景：只影响编辑时的页面观感，不写入文章 HTML ---- */
        body.wh-reading-bg-on{
            background:var(--wh-reader-page) !important;
            background-image:var(--wh-reader-texture) !important;
            background-size:360px 240px !important;
            background-attachment:fixed !important;
        }
        body.wh-reading-bg-on #app,
        body.wh-reading-bg-on .weui-desktop-layout,
        body.wh-reading-bg-on .weui-desktop-layout__main,
        body.wh-reading-bg-on .weui-desktop-layout__content,
        body.wh-reading-bg-on .weui-desktop-page,
        body.wh-reading-bg-on .weui-desktop-page__bd,
        body.wh-reading-bg-on .weui-desktop-layout__hd,
        body.wh-reading-bg-on .weui-desktop-layout__ft,
        body.wh-reading-bg-on .weui-desktop-topbar,
        body.wh-reading-bg-on .weui-desktop-toolbar,
        body.wh-reading-bg-on .appmsg_edit_container,
        body.wh-reading-bg-on .appmsg_edit_area,
        body.wh-reading-bg-on .appmsg_edit_box,
        body.wh-reading-bg-on .appmsg_editor,
        body.wh-reading-bg-on .appmsg_input_area,
        body.wh-reading-bg-on #js_appmsg_editor,
        body.wh-reading-bg-on #editor_pannel{
            background:var(--wh-reader-page) !important;
            background-image:var(--wh-reader-texture) !important;
            background-size:360px 240px !important;
        }
        body.wh-reading-bg-on .edui-editor,
        body.wh-reading-bg-on .edui-editor-iframeholder,
        body.wh-reading-bg-on .ProseMirror,
        body.wh-reading-bg-on #js_appmsg_editor [contenteditable="true"],
        body.wh-reading-bg-on #editor_pannel [contenteditable="true"],
        body.wh-reading-bg-on .appmsg_edit_box [contenteditable="true"]{
            background:var(--wh-reader-editor) !important;
            background-image:var(--wh-reader-texture) !important;
            background-size:360px 240px !important;
        }
        body.wh-reading-bg-on .edui-toolbar,
        body.wh-reading-bg-on .tool_area,
        body.wh-reading-bg-on .appmsg_edit_toolbar,
        body.wh-reading-bg-on .appmsg_toolbar,
        body.wh-reading-bg-on .editor_toolbar,
        body.wh-reading-bg-on .rich_media_tool,
        body.wh-reading-bg-on .rich_media_area_extra,
        body.wh-reading-bg-on .js_toolbar,
        body.wh-reading-bg-on .js_tool_bar,
        body.wh-reading-bg-on .js_editor_toolbar,
        body.wh-reading-bg-on .wh-reader-wechat-bar{
            background:color-mix(in srgb, var(--wh-reader-page) 72%, #fff) !important;
        }
        body.wh-reading-bg-on .wh-reader-wechat-bar *,
        body.wh-reading-bg-on .edui-toolbar *,
        body.wh-reading-bg-on .tool_area *,
        body.wh-reading-bg-on .appmsg_edit_toolbar *,
        body.wh-reading-bg-on .editor_toolbar *{
            background-color:transparent;
        }
        body.wh-reading-bg-on .wh-code{
            background:var(--wh-reader-code);
            background-image:var(--wh-reader-texture);
            background-size:360px 240px;
        }
        body.wh-reading-bg-on .wh-preview-frame{
            background:var(--wh-reader-code);
        }
        body.wh-reading-bg-on .appmsg_edit_bottom,
        body.wh-reading-bg-on .appmsg_edit_footer,
        body.wh-reading-bg-on .appmsg_edit_fixed,
        body.wh-reading-bg-on .appmsg_edit_action,
        body.wh-reading-bg-on .js_article_setting_area,
        body.wh-reading-bg-on .weui-desktop-panel,
        body.wh-reading-bg-on .weui-desktop-card{
            background:#fff !important;
        }
        .wh-reader-grid{ padding:10px; overflow:auto; display:flex; flex-direction:column; gap:8px; }
        .wh-reader-actions{ display:grid; grid-template-columns:1fr; gap:8px; }
        .wh-reader-tip{ font-size:11.5px; line-height:1.6; color:var(--wh-dim); margin:0; }
        .wh-reader-current{ color:#07a855; font-weight:800; }
        .wh-reader-swatches{ display:grid; grid-template-columns:repeat(auto-fit,minmax(108px,1fr)); gap:7px; }
        .wh-reader-card{
            min-height:52px; padding:7px; border:1px solid var(--wh-border); border-radius:8px;
            background:#fff; display:flex; align-items:center; gap:8px; cursor:pointer;
            transition:border-color .12s, box-shadow .12s, transform .12s;
            text-align:left; font-family:var(--wh-font); color:var(--wh-text);
        }
        .wh-reader-card:hover{ border-color:#07c160; transform:translateY(-1px); box-shadow:0 3px 10px rgba(16,185,129,.16); }
        .wh-reader-card.wh-on{ border-color:#07c160; background:#f0fdf4; box-shadow:0 0 0 2px rgba(7,193,96,.12); }
        .wh-reader-swatch{
            width:26px; height:26px; border-radius:50%; flex:0 0 auto;
            box-shadow:inset 0 0 0 1px rgba(15,23,42,.12),0 1px 2px rgba(15,23,42,.08);
        }
        .wh-reader-meta{ min-width:0; display:flex; flex-direction:column; gap:3px; }
        .wh-reader-name{ font-size:12px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .wh-reader-desc{ font-size:10.5px; color:var(--wh-dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .wh-reader-card .wh-del{ font-size:10.5px; color:var(--wh-err); font-weight:700; width:max-content; }
        .wh-reader-card .wh-del:hover{ text-decoration:underline; }
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
        elPanel.className = 'wh-rail-mode';
        elPanel.style.width = state.width + 'px';
        elPanel.innerHTML = `
            <div class="wh-resizer" id="wh-resizer"></div>
            <nav class="wh-rail">
                <div class="wh-rail-logo" title="云中书">☁</div>
                <div class="wh-rail-nav">
                    <button class="wh-rail-btn wh-on" data-tab="style" title="样式"><b>🎨</b><span>样式</span></button>
                    <button class="wh-rail-btn" data-tab="reader" title="护眼背景"><b>◐</b><span>护眼</span></button>
                    <button class="wh-rail-btn" data-tab="code" title="HTML"><b>&lt;/&gt;</b><span>HTML</span></button>
                    <button class="wh-rail-btn" data-tab="image" title="图片"><b>▧</b><span>图片</span></button>
                    <button class="wh-rail-btn" data-tab="ai" title="AI"><b>AI</b><span>配置</span></button>
                </div>
                <div class="wh-rail-spacer"></div>
                <button class="wh-rail-btn wh-rail-close" id="wh-collapse" title="收起"><b>×</b><span>收起</span></button>
            </nav>
            <section class="wh-main">
                <div class="wh-pane wh-on" data-pane="style">
                    <div class="wh-pane-title"><span>样式排版</span><small>点击即写入原生编辑区</small></div>
                    <div class="wh-style-tabs">
                        <button class="wh-style-tab wh-on" data-style-mode="blueprint">骨架</button>
                        <button class="wh-style-tab" data-style-mode="color">配色</button>
                        <button class="wh-style-tab" data-style-mode="font">字体</button>
                    </div>
                    <div class="wh-gal-actions">
                        <button class="wh-gal-btn" id="wh-gal-random">换一版</button>
                        <button class="wh-gal-btn" id="wh-gal-recommend">智能推荐</button>
                        <button class="wh-gal-btn" id="wh-gal-save">保存样式</button>
                        <button class="wh-gal-btn" id="wh-gal-restore">还原</button>
                    </div>
                    <div class="wh-gal-body" id="wh-style-body"></div>
                </div>

                <div class="wh-pane" data-pane="reader">
                    <div class="wh-pane-title"><span>阅读背景</span><small id="wh-reading-current">默认白</small></div>
                    <div class="wh-reader-grid">
                        <p class="wh-reader-tip">切换公众号编辑页的整体底色，只改变你编辑时看到的页面，不会写进正文 HTML。</p>
                        <div class="wh-reader-actions">
                            <button class="wh-mini-btn" id="wh-reading-default">恢复默认</button>
                        </div>
                        <div class="wh-reader-swatches" id="wh-reading-swatches"></div>
                    </div>
                </div>

                <div class="wh-pane" data-pane="code">
                    <div class="wh-pane-title"><span>HTML 实时编辑</span><small id="wh-sync-state">双向同步</small></div>
                    <div class="wh-banner wh-hidden" id="wh-banner">
                        <span>原生编辑区已变化，HTML 已同步</span>
                        <button id="wh-banner-read">确认</button>
                    </div>
                    <div class="wh-code-wrap wh-live">
                        <textarea class="wh-code" id="wh-code" spellcheck="false" placeholder="粘贴 HTML 后会自动渲染到公众号原生编辑区；你在原生编辑区直接修改后，这里也会自动读取最新 HTML。"></textarea>
                    </div>
                    <div class="wh-syncbar">
                        <span>自动同步：HTML ↔ 原生编辑区</span>
                        <span>
                            <button class="wh-mini-btn" id="wh-tpl">模板</button>
                            <button class="wh-mini-btn" id="wh-beautify">美化</button>
                            <button class="wh-mini-btn" id="wh-ai">AI调整</button>
                            <button class="wh-mini-btn" id="wh-clear">清空</button>
                        </span>
                    </div>
                </div>

                <div class="wh-pane" data-pane="image">
                    <div class="wh-pane-title"><span>图片</span><small>来自原生编辑区</small></div>
                    <div class="wh-imgbar-inner">
                        <p class="wh-imgbar-tip">先用公众号原生图片能力上传或粘贴图片，这里会读取编辑区里的最终微信图片链接。</p>
                        <div class="wh-imggrid" id="wh-imggrid"></div>
                    </div>
                </div>

                <div class="wh-pane" data-pane="ai">
                    <div class="wh-pane-title"><span>AI 与 API</span><small>本机保存</small></div>
                    <div class="wh-settings">
                        <div class="wh-field">
                            <label for="wh-ai-endpoint">API Endpoint</label>
                            <input class="wh-input" id="wh-ai-endpoint" placeholder="https://api.openai.com/v1/chat/completions">
                        </div>
                        <div class="wh-field">
                            <label for="wh-ai-model">模型</label>
                            <input class="wh-input" id="wh-ai-model" placeholder="gpt-4.1-mini">
                        </div>
                        <div class="wh-field">
                            <label for="wh-ai-key">API Key</label>
                            <input class="wh-input" id="wh-ai-key" type="password" placeholder="sk-...">
                        </div>
                        <div class="wh-field">
                            <label for="wh-ai-instruction">默认调整要求</label>
                            <textarea class="wh-textarea" id="wh-ai-instruction">优化公众号图文排版，保留原文含义、图片和链接，输出可直接粘贴到微信公众号编辑器的内联 HTML。</textarea>
                        </div>
                        <div class="wh-settings-actions">
                            <button class="wh-mini-btn" id="wh-ai-save">保存配置</button>
                            <button class="wh-mini-btn" id="wh-ai-run">用 AI 调整当前正文</button>
                        </div>
                    </div>
                </div>
            </section>
        `;
        document.body.appendChild(elPanel);

        // 引用
        elCode = elPanel.querySelector('#wh-code');
        elPreviewWrap = elPanel.querySelector('#wh-previewwrap');
        elPreviewFrame = elPanel.querySelector('#wh-previewframe');
        elImgGrid = elPanel.querySelector('#wh-imggrid');
        elBanner = elPanel.querySelector('#wh-banner');
        elPreviewBtn = elPanel.querySelector('#wh-previewtoggle');
        populateAISettings();

        // 恢复草稿
        const draft = Config.get('draft', '');
        if (draft) elCode.value = draft;
        if (!state.previewOn && elPreviewWrap && elPreviewBtn) { elPreviewWrap.classList.add('wh-hidden'); elPreviewBtn.classList.remove('wh-active'); }

        buildStylePane();
        buildReadingBackgroundPane();
        applyReadingBackground(state.readingBg, { silent: true });
        bindEvents();
        updatePreview();
        mountNativeSidePanel();
        mountEntry();
        if (state.open) setTimeout(() => openPanel(), 0);
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

    function findNativeSideContainers() {
        const sideList = document.querySelector('#js_side_article_list');
        const sideHost = document.querySelector('#js_mp_sidemenu');
        if (sideList && sideHost) return { sideList, sideHost };
        return null;
    }

    function mountNativeSidePanel() {
        if (!elPanel) return false;
        const found = findNativeSideContainers();
        if (!found) return false;
        const { sideHost, sideList } = found;
        if (!state.nativeMounted) {
            state.previousSideWidth = sideList.style.width || '';
            state.previousSideMinWidth = sideList.style.minWidth || '';
            state.previousSideFlex = sideList.style.flex || '';
            state.previousSideOverflow = sideList.style.overflow || '';
            state.previousHostBackground = sideHost.style.background || '';
        }
        state.nativeMounted = true;
        state.sideHost = sideHost;
        state.sideList = sideList;
        document.body.classList.add('wh-native-side-mounted');
        elPanel.classList.add('wh-native');
        if (elPanel.parentElement !== sideList) sideList.prepend(elPanel);
        sideList.classList.remove('is-collapsed');
        sideHost.style.background = 'rgba(0,0,0,0)';
        syncNativeSideWidth();
        log.ok('已挂载到微信公众号原生左侧栏');
        return true;
    }

    function syncNativeSideWidth() {
        if (!state.nativeMounted || !state.sideList) return;
        const w = `${Math.round(state.width)}px`;
        state.sideList.style.width = w;
        state.sideList.style.minWidth = w;
        state.sideList.style.flex = `0 0 ${w}`;
        state.sideList.style.overflow = 'visible';
        elPanel.style.width = w;
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
        if (state.nativeMounted) {
            document.getElementById('wh-toolbtn-group')?.remove();
            state.entry = 'native';
            return;
        }
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
            if (!state.nativeMounted) mountNativeSidePanel();
            if (state.nativeMounted) {
                document.getElementById('wh-toolbtn-group')?.remove();
                return;
            }
            if (state.entry === 'toolbar' && !document.getElementById('wh-toolbtn-group')) ensureToolbarBtn();
        }, 350);
        state.entryObserver?.disconnect();
        state.entryObserver = new MutationObserver(reinject);
        state.entryObserver.observe(document.body, { childList: true, subtree: true });
    }

    function restoreNativeSidePanel() {
        if (!state.nativeMounted) return;
        const sideList = state.sideList;
        const sideHost = state.sideHost;
        if (sideList) {
            sideList.style.width = state.previousSideWidth;
            sideList.style.minWidth = state.previousSideMinWidth;
            sideList.style.flex = state.previousSideFlex;
            sideList.style.overflow = state.previousSideOverflow;
            sideList.classList.remove('is-collapsed');
        }
        if (sideHost) sideHost.style.background = state.previousHostBackground;
        document.body.classList.remove('wh-native-side-mounted');
        state.nativeMounted = false;
        state.sideHost = null;
        state.sideList = null;
    }

    function destroyUI() {
        clearTimeout(state.htmlLiveTimer);
        state.editorObserver?.disconnect();
        state.entryObserver?.disconnect();
        state.editorObserver = null;
        state.entryObserver = null;
        state.observedEditor = null;
        restoreNativeSidePanel();
        document.body.classList.remove('wh-reading-bg-on');
        delete document.body.dataset.whReadingBg;
        document.querySelectorAll('.wh-reader-wechat-bar').forEach(el => el.classList.remove('wh-reader-wechat-bar'));
        document.querySelector('#wh-panel')?.remove();
        document.querySelector('#wh-handle')?.remove();
        document.querySelector('#wh-toolbtn-group')?.remove();
        document.querySelector('#wh-toolbtn-li')?.remove();
        document.querySelectorAll('.wh-menu,.wh-pop,.wh-toast').forEach(el => el.remove());
        elPanel = null;
        elHandle = null;
        elCode = null;
        elPreviewWrap = null;
        elPreviewFrame = null;
        elImgGrid = null;
        elBanner = null;
        elPreviewBtn = null;
        state.open = true;
        state.entry = null;
        state.synced = '';
        state.lastEditorHTML = '';
        state.missingEditorChecks = 0;
        log.info('已离开文章编辑页，云中书工作台已卸载');
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

    function setSyncState(text, type = '') {
        const el = elPanel?.querySelector('#wh-sync-state');
        if (!el) return;
        el.textContent = text;
        el.style.color = type === 'error' ? '#ef4444' : type === 'ok' ? '#07a855' : '#64748b';
    }

    function scheduleLiveApplyHTML() {
        clearTimeout(state.htmlLiveTimer);
        setSyncState('等待同步');
        state.htmlLiveTimer = setTimeout(() => {
            const html = elCode.value;
            const trimmed = html.trim();
            if (!trimmed) {
                applyWhole('', { silent: true });
                setSyncState('已清空', 'ok');
                return;
            }
            if (!/<[a-z][\s\S]*>/i.test(trimmed)) {
                setSyncState('等待完整 HTML');
                return;
            }
            const ok = applyWhole(trimmed, { silent: true });
            setSyncState(ok ? '已同步到原生编辑区' : '同步失败', ok ? 'ok' : 'error');
        }, 450);
    }

    function bindEvents() {
        elPanel.querySelector('#wh-collapse').onclick = closePanel;

        elCode.addEventListener('input', () => {
            if (state.syncingCode) return;
            updatePreview();
            saveDraftDebounced();
            checkBanner();
            scheduleLiveApplyHTML();
        });
        // Tab 缩进
        elCode.addEventListener('keydown', e => {
            if (e.key === 'Tab') { e.preventDefault(); insertAtCursor(elCode, '  '); }
        });

        elPanel.querySelector('#wh-banner-read').onclick = () => elBanner.classList.add('wh-hidden');

        // AI
        elPanel.querySelector('#wh-ai').onclick = () => runAIAdjust();
        elPanel.querySelector('#wh-ai-save').onclick = () => saveAISettings();
        elPanel.querySelector('#wh-ai-run').onclick = () => runAIAdjust();

        // 美化
        elPanel.querySelector('#wh-beautify').onclick = () => {
            elCode.value = beautify(elCode.value);
            updatePreview(); saveDraft();
            scheduleLiveApplyHTML();
            toast('已美化并自动同步');
        };

        // 清空
        elPanel.querySelector('#wh-clear').onclick = () => {
            if (!elCode.value || confirm('清空 HTML 和公众号正文内容？')) {
                elCode.value = ''; updatePreview(); saveDraft(); checkBanner(); scheduleLiveApplyHTML();
            }
        };

        // 预览开关
        if (elPreviewBtn) elPreviewBtn.onclick = () => {
            state.previewOn = !state.previewOn;
            Config.set('previewOn', state.previewOn);
            elPreviewWrap.classList.toggle('wh-hidden', !state.previewOn);
            elPreviewBtn.classList.toggle('wh-active', state.previewOn);
            if (state.previewOn) updatePreview();
        };

        // 左侧竖栏与样式二级标签
        elPanel.querySelectorAll('.wh-rail-btn[data-tab]').forEach(tab => tab.onclick = () => switchTab(tab.dataset.tab));
        elPanel.querySelectorAll('.wh-style-tab').forEach(tab => tab.onclick = () => switchStyleMode(tab.dataset.styleMode));
        elPanel.querySelector('#wh-reading-default').onclick = () => applyReadingBackground('default');

        // 模板菜单
        elPanel.querySelector('#wh-tpl').onclick = (e) => showTemplateMenu(e.currentTarget);

        // 拖拽改宽
        initResizer();
    }

    function switchTab(name) {
        elPanel.querySelectorAll('.wh-rail-btn[data-tab]').forEach(t => t.classList.toggle('wh-on', t.dataset.tab === name));
        elPanel.querySelectorAll('.wh-pane').forEach(p => p.classList.toggle('wh-on', p.dataset.pane === name));
        if (name === 'image') renderImageLibrary();
        if (name === 'code') { readFromArticle(false); updatePreview(); }
        if (name === 'ai') populateAISettings();
        if (name === 'reader') updateReadingBackgroundUI();
        Config.set('tab', name);
    }

    function switchStyleMode(mode) {
        state.styleMode = mode || 'blueprint';
        Config.set('styleMode', state.styleMode);
        elPanel.querySelectorAll('.wh-style-tab').forEach(t => t.classList.toggle('wh-on', t.dataset.styleMode === state.styleMode));
        elPanel.querySelectorAll('.wh-style-panel').forEach(p => p.classList.toggle('wh-on', p.dataset.stylePanel === state.styleMode));
    }

    // =========================================================
    //  AI API：兼容 OpenAI Chat Completions / OpenAI-compatible endpoint
    // =========================================================
    function getAIConfig() {
        return {
            endpoint: Config.get('aiEndpoint', 'https://api.openai.com/v1/chat/completions'),
            model: Config.get('aiModel', 'gpt-4.1-mini'),
            apiKey: Config.get('aiApiKey', ''),
            instruction: Config.get('aiInstruction', '优化公众号图文排版，保留原文含义、图片和链接，输出可直接粘贴到微信公众号编辑器的内联 HTML。'),
        };
    }

    function showAIConfig() {
        switchTab('ai');
        populateAISettings();
    }

    function populateAISettings() {
        const cfg = getAIConfig();
        const endpoint = elPanel?.querySelector('#wh-ai-endpoint');
        const model = elPanel?.querySelector('#wh-ai-model');
        const key = elPanel?.querySelector('#wh-ai-key');
        const instruction = elPanel?.querySelector('#wh-ai-instruction');
        if (endpoint) endpoint.value = cfg.endpoint;
        if (model) model.value = cfg.model;
        if (key) key.value = cfg.apiKey;
        if (instruction) instruction.value = cfg.instruction;
    }

    function saveAISettings() {
        const endpoint = elPanel.querySelector('#wh-ai-endpoint').value.trim();
        const model = elPanel.querySelector('#wh-ai-model').value.trim();
        const apiKey = elPanel.querySelector('#wh-ai-key').value.trim();
        const instruction = elPanel.querySelector('#wh-ai-instruction').value.trim();
        Config.set('aiEndpoint', endpoint || 'https://api.openai.com/v1/chat/completions');
        Config.set('aiModel', model || 'gpt-4.1-mini');
        Config.set('aiApiKey', apiKey);
        Config.set('aiInstruction', instruction || getAIConfig().instruction);
        toast('API 配置已保存');
    }

    function stripCodeFence(text) {
        return String(text || '')
            .replace(/^```(?:html)?\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();
    }

    async function runAIAdjust() {
        const r = ensureEditorObserved();
        if (!r) { toast('未找到编辑器，请先点一下正文区域', 'error'); return; }
        let cfg = getAIConfig();
        if (!cfg.apiKey) {
            showAIConfig();
            toast('请先在 AI 配置页填写 API Key', 'warning');
            return;
        }
        const sourceHtml = r.editor.innerHTML.trim();
        if (!sourceHtml) { toast('正文为空，先写内容再让 AI 调整', 'warning'); return; }
        const panelInstruction = elPanel?.querySelector('#wh-ai-instruction')?.value.trim();
        const instruction = panelInstruction || cfg.instruction;
        const btn = elPanel.querySelector('#wh-ai');
        const quick = elPanel.querySelector('#wh-ai-run');
        const oldBtn = btn.textContent;
        const oldQuick = quick?.textContent;
        btn.textContent = 'AI 调整中...';
        if (quick) quick.textContent = '调整中';
        btn.disabled = true;
        if (quick) quick.disabled = true;
        try {
            saveAISettings();
            cfg = getAIConfig();
            const improved = await callAIForHTML(sourceHtml, instruction || '优化公众号图文排版。', cfg);
            const html = stripCodeFence(improved);
            if (!html || !/<[a-z][\s\S]*>/i.test(html)) throw new Error('AI 没有返回有效 HTML');
            switchTab('code');
            elCode.value = html;
            updatePreview();
            saveDraft();
            if (applyWhole(html)) toast('AI 已调整并写回原生编辑区');
        } catch (e) {
            log.error('AI 调整失败', e);
            toast('AI 调整失败：' + e.message, 'error');
        } finally {
            btn.textContent = oldBtn;
            if (quick) quick.textContent = oldQuick;
            btn.disabled = false;
            if (quick) quick.disabled = false;
        }
    }

    async function callAIForHTML(sourceHtml, instruction, cfg) {
        const res = await fetch(cfg.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${cfg.apiKey}`,
            },
            body: JSON.stringify({
                model: cfg.model,
                temperature: 0.2,
                messages: [
                    {
                        role: 'system',
                        content: [
                            '你是微信公众号原生编辑器 HTML 排版助手。',
                            '只返回完整 HTML 片段，不要解释，不要 Markdown 代码围栏。',
                            '必须保留原文含义、已有图片 img 的 src/data-src、链接 href、可见文字。',
                            '不要输出 script、iframe、form、object、embed 或外链 CSS。',
                            '样式尽量使用内联 style，适配微信公众号编辑器。'
                        ].join('\n')
                    },
                    {
                        role: 'user',
                        content: `调整要求：${instruction}\n\n当前公众号原生编辑区 HTML：\n${sourceHtml}`
                    }
                ]
            }),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`${res.status} ${res.statusText}${text ? `：${text.slice(0, 180)}` : ''}`);
        }
        const data = await res.json();
        return data?.choices?.[0]?.message?.content || '';
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
        const articleDiffers = formatHTMLForCode(getArticleHTML()) !== state.synced;
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
        mountNativeSidePanel();
        state.open = true;
        elPanel.classList.add('wh-open');
        if (state.nativeMounted && state.sideList) {
            state.sideList.classList.remove('is-collapsed');
            syncNativeSideWidth();
        }
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
        const activeTab = elPanel.querySelector('.wh-rail-btn.wh-on[data-tab]');
        if (activeTab && activeTab.dataset.tab === 'image') renderImageLibrary();
        markActive();
    }

    function closePanel() {
        state.open = false;
        elPanel.classList.remove('wh-open');
        if (state.nativeMounted && state.sideList) {
            state.sideList.classList.add('is-collapsed');
        } else {
            showEntry();
        }
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
        const aSave = elPanel.querySelector('#wh-gal-save');
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
            <div class="wh-style-panel wh-on" data-style-panel="blueprint">
                <div class="wh-gal-sec">骨架 · ${yt.blueprints.length} 套蓝图</div>
                <div class="wh-cards">${bpCards}</div>
            </div>
            <div class="wh-style-panel" data-style-panel="color">
                <div class="wh-gal-sec">配色 · ${yt.colorSchemes.length}</div>
                <div class="wh-chips">${colorChips}</div>
            </div>
            <div class="wh-style-panel" data-style-panel="font">
                <div class="wh-gal-sec">字体 · ${yt.typographySets.length}</div>
                <div class="wh-pills">${fontPills}</div>
            </div>
            <div class="wh-gal-sec">我的模板</div>
            <div class="wh-pills" id="wh-style-templates"></div>
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
        aSave.onclick = () => saveCurrentStyleTemplate();
        aRes.onclick = () => restorePlain();
        body.querySelectorAll('[data-bp]').forEach(el => el.onclick = () => { ensureLayIds(); layIds.blueprintId = el.dataset.bp; applyLayout(layIds); markActive(); });
        body.querySelectorAll('[data-color]').forEach(el => el.onclick = () => { ensureLayIds(); layIds.colorId = el.dataset.color; applyLayout(layIds); markActive(); });
        body.querySelectorAll('[data-font]').forEach(el => el.onclick = () => { ensureLayIds(); layIds.typographyId = el.dataset.font; applyLayout(layIds); markActive(); });
        switchStyleMode(state.styleMode);
        renderStyleTemplates();
        markActive();
    }

    function renderStyleTemplates() {
        const wrap = elPanel?.querySelector('#wh-style-templates');
        if (!wrap) return;
        const templates = getUserStyleTemplates();
        wrap.innerHTML = '';
        if (!templates.length) {
            const empty = document.createElement('div');
            empty.className = 'wh-empty';
            empty.textContent = '还没有保存的样式模板。';
            wrap.appendChild(empty);
            return;
        }
        templates.forEach(tpl => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'wh-pill';
            item.textContent = tpl.name;
            item.title = '点击应用，右键删除';
            item.onclick = () => {
                layIds = { ...tpl.ids };
                applyLayout(layIds);
                markActive();
                toast(`已应用样式模板：${tpl.name}`);
            };
            item.oncontextmenu = (e) => {
                e.preventDefault();
                if (confirm(`删除样式模板「${tpl.name}」？`)) {
                    deleteStyleTemplate(tpl.id);
                    renderStyleTemplates();
                }
            };
            wrap.appendChild(item);
        });
    }

    function saveCurrentStyleTemplate() {
        const ids = ensureLayIds();
        if (!ids) {
            toast('排版引擎未加载，暂时不能保存样式', 'warning');
            return;
        }
        const name = prompt('样式模板名称：', '我的公众号样式');
        if (!name) return;
        saveStyleTemplate(name.trim(), ids);
        renderStyleTemplates();
        toast('样式模板已保存');
    }

    function buildReadingBackgroundPane() {
        const wrap = elPanel?.querySelector('#wh-reading-swatches');
        if (!wrap) return;
        wrap.innerHTML = '';
        getAllReadingBackgrounds().forEach(bg => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'wh-reader-card';
            card.dataset.readingBg = bg.id;
            card.title = bg.desc;

            const swatch = document.createElement('span');
            swatch.className = 'wh-reader-swatch';
            swatch.style.background = bg.color;
            if (bg.texture) {
                swatch.style.backgroundImage = bg.texture;
                swatch.style.backgroundSize = '72px 48px';
            }
            card.appendChild(swatch);

            const meta = document.createElement('span');
            meta.className = 'wh-reader-meta';
            const name = document.createElement('span');
            name.className = 'wh-reader-name';
            name.textContent = bg.name;
            const desc = document.createElement('span');
            desc.className = 'wh-reader-desc';
            desc.textContent = bg.desc;
            meta.appendChild(name);
            meta.appendChild(desc);
            card.appendChild(meta);

            card.onclick = () => applyReadingBackground(bg.id);
            wrap.appendChild(card);
        });
        updateReadingBackgroundUI();
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
            let w = Math.min(Math.max(startW + dx, 360), Math.min(520, window.innerWidth - 120));
            elPanel.style.width = w + 'px';
            state.width = w;
            syncNativeSideWidth();
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
    function evaluatePageLifecycle() {
        const editing = hasRealArticleEditor();
        if (editing) {
            state.missingEditorChecks = 0;
            if (!elPanel || !document.getElementById('wh-panel')) {
                buildUI();
                ensureEditorObserved();
                log.ok('检测到公众号正文编辑器，云中书工作台已挂载');
            } else {
                ensureEditorObserved();
                if (!state.nativeMounted) mountNativeSidePanel();
            }
            return;
        }

        if (!elPanel && !document.getElementById('wh-panel')) return;
        state.missingEditorChecks++;
        if (state.missingEditorChecks >= 2) destroyUI();
    }

    function init() {
        evaluatePageLifecycle();
        clearInterval(state.initTimer);
        state.initTimer = setInterval(evaluatePageLifecycle, 700);

        state.lifecycleObserver?.disconnect();
        state.lifecycleObserver = new MutationObserver(debounce(evaluatePageLifecycle, 180));
        state.lifecycleObserver.observe(document.documentElement, { childList: true, subtree: true });
        window.addEventListener('resize', markWechatReadingBars, { passive: true });
        window.addEventListener('scroll', markWechatReadingBars, { passive: true });

        // 快捷键 Alt+H
        if (!state.keyHandlerBound) {
            state.keyHandlerBound = true;
            document.addEventListener('keydown', (e) => {
                if (!e.altKey || (e.key !== 'h' && e.key !== 'H')) return;
                if (!hasRealArticleEditor()) return;
                e.preventDefault();
                togglePanel();
            });
        }
    }

    document.readyState === 'loading'
        ? document.addEventListener('DOMContentLoaded', init)
        : init();

    log.info('加载完毕');
})();
