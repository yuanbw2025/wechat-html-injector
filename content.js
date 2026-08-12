// ==UserScript==
// @name         微信公众号HTML编辑器-侧边源码版
// @namespace    https://mp.weixin.qq.com/
// @version      5.0.1
// @description  原生左栏 AI 工作台：本地知识库、AI 对话、图片文件附件与可确认的 HTML 调整。
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
    log.info('脚本启动 v5.0.1 — 编辑页门禁 + 本地知识库 + AI 对话 + 附件调整');

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
        knowledgeDocs: [],
        knowledgeReady: false,
        chatHistory: [],
        chatAttachments: [],
        chatBusy: false,
        chatContextOn: true,
        articleSnapshots: [],
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
    state.chatContextOn = Config.get('chatContextOn', true);
    try { state.chatHistory = Config.get('chatHistory', []).slice(-40); }
    catch { state.chatHistory = []; }

    // =========================================================
    //  本地知识库：优先 IndexedDB，无法使用时回退到插件现有本地配置
    // =========================================================
    const KNOWLEDGE_DB = 'wechat-html-editor-knowledge-v1';
    let knowledgeDBPromise = null;
    function openKnowledgeDB() {
        if (knowledgeDBPromise) return knowledgeDBPromise;
        if (typeof indexedDB === 'undefined') return Promise.resolve(null);
        knowledgeDBPromise = new Promise(resolve => {
            try {
                const req = indexedDB.open(KNOWLEDGE_DB, 1);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains('documents')) {
                        const store = db.createObjectStore('documents', { keyPath: 'id' });
                        store.createIndex('updatedAt', 'updatedAt');
                    }
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
            } catch { resolve(null); }
        });
        return knowledgeDBPromise;
    }
    function idbRequest(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
        });
    }
    async function loadKnowledgeDocuments() {
        const db = await openKnowledgeDB();
        if (!db) return Config.get('knowledgeDocs', []);
        try {
            const tx = db.transaction('documents', 'readonly');
            const docs = await idbRequest(tx.objectStore('documents').getAll());
            return docs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        } catch { return Config.get('knowledgeDocs', []); }
    }
    async function saveKnowledgeDocument(doc) {
        const db = await openKnowledgeDB();
        if (!db) {
            const docs = getKnowledgeDocuments().filter(item => item.id !== doc.id);
            Config.set('knowledgeDocs', [doc, ...docs].slice(0, 200));
            return;
        }
        try {
            const tx = db.transaction('documents', 'readwrite');
            await idbRequest(tx.objectStore('documents').put(doc));
        } catch {
            const docs = getKnowledgeDocuments().filter(item => item.id !== doc.id);
            Config.set('knowledgeDocs', [doc, ...docs].slice(0, 200));
        }
    }
    async function removeKnowledgeDocument(id) {
        const db = await openKnowledgeDB();
        if (!db) {
            Config.set('knowledgeDocs', getKnowledgeDocuments().filter(item => item.id !== id));
            return;
        }
        try {
            const tx = db.transaction('documents', 'readwrite');
            await idbRequest(tx.objectStore('documents').delete(id));
        } catch {
            Config.set('knowledgeDocs', getKnowledgeDocuments().filter(item => item.id !== id));
        }
    }
    function getKnowledgeDocuments() { return Array.isArray(state.knowledgeDocs) ? state.knowledgeDocs : []; }
    function makeLocalId(prefix = 'item') { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`; }
    function persistChatHistory() {
        Config.set('chatHistory', state.chatHistory.slice(-40).map(item => ({
            role: item.role,
            content: String(item.content || '').slice(0, 12000),
            actions: Array.isArray(item.actions) ? item.actions.slice(0, 4).map(action => ({
                type: action.type,
                html: String(action.html || '').slice(0, 50000),
            })) : [],
            createdAt: item.createdAt || Date.now(),
        })));
    }

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
        const template = document.createElement('template');
        template.innerHTML = String(html || '');
        template.content.querySelectorAll('script,iframe,object,embed,form,link,meta,base').forEach(el => el.remove());
        template.content.querySelectorAll('*').forEach(el => {
            [...el.attributes].forEach(attr => {
                const name = attr.name.toLowerCase();
                const value = attr.value.trim();
                if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') el.removeAttribute(attr.name);
                else if (['href', 'src', 'data-src', 'xlink:href'].includes(name) && /^\s*(javascript|vbscript):/i.test(value)) el.removeAttribute(attr.name);
                else if (name === 'style' && /(expression\s*\(|javascript\s*:|vbscript\s*:)/i.test(value)) el.removeAttribute(attr.name);
            });
        });
        return template.innerHTML;
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
            if (opts.snapshot !== false) pushArticleSnapshot();
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
        pushArticleSnapshot();
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

    function fileToDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
            reader.readAsDataURL(file);
        });
    }
    function fileToText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('文本读取失败'));
            reader.readAsText(file);
        });
    }
    function decodePdfLiteral(value) {
        return value
            .replace(/\\([\\()])/g, '$1')
            .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
            .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
    }
    async function extractPdfText(file) {
        const buffer = await file.arrayBuffer();
        const source = new TextDecoder('latin1').decode(buffer);
        const blocks = source.match(/BT[\s\S]*?ET/g) || [];
        const lines = [];
        blocks.forEach(block => {
            const parts = [];
            block.replace(/\(((?:\\.|[^\\)])*)\)\s*Tj/g, (_, value) => { parts.push(decodePdfLiteral(value)); return _; });
            block.replace(/\[((?:[\s\S]*?))\]\s*TJ/g, (_, value) => {
                value.replace(/\(((?:\\.|[^\\)])*)\)/g, (__, text) => { parts.push(decodePdfLiteral(text)); return __; });
                return _;
            });
            if (parts.length) lines.push(parts.join(''));
        });
        const text = lines.join('\n').replace(/[ \t]{2,}/g, ' ').trim();
        if (!text) throw new Error('PDF 未提取到可读文本，可能是扫描版或字体压缩格式');
        return text;
    }
    function readUint16(bytes, offset) { return bytes[offset] | (bytes[offset + 1] << 8); }
    function readUint32(bytes, offset) { return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0; }
    async function extractDocxText(file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let eocd = -1;
        for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
            if (readUint32(bytes, i) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error('DOCX 压缩包结构无法读取');
        const centralOffset = readUint32(bytes, eocd + 16);
        const centralSize = readUint32(bytes, eocd + 12);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let offset = centralOffset;
        let target = null;
        while (offset < centralOffset + centralSize && readUint32(bytes, offset) === 0x02014b50) {
            const method = readUint16(bytes, offset + 10);
            const compressedSize = readUint32(bytes, offset + 20);
            const nameLength = readUint16(bytes, offset + 28);
            const extraLength = readUint16(bytes, offset + 30);
            const commentLength = readUint16(bytes, offset + 32);
            const localOffset = readUint32(bytes, offset + 42);
            const name = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + nameLength));
            if (name === 'word/document.xml') target = { method, compressedSize, localOffset };
            offset += 46 + nameLength + extraLength + commentLength;
        }
        if (!target) throw new Error('DOCX 中未找到正文');
        const local = target.localOffset;
        if (readUint32(bytes, local) !== 0x04034b50) throw new Error('DOCX 正文数据损坏');
        const nameLength = view.getUint16(local + 26, true);
        const extraLength = view.getUint16(local + 28, true);
        const compressed = bytes.slice(local + 30 + nameLength + extraLength, local + 30 + nameLength + extraLength + target.compressedSize);
        let xmlBytes = compressed;
        if (target.method === 8) {
            if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持 DOCX 解压');
            const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            xmlBytes = new Uint8Array(await new Response(stream).arrayBuffer());
        } else if (target.method !== 0) throw new Error('DOCX 使用了暂不支持的压缩方式');
        const xml = new TextDecoder().decode(xmlBytes);
        const text = xml
            .replace(/<w:tab\s*\/?\s*>/gi, '\t')
            .replace(/<w:br\s*\/?\s*>/gi, '\n')
            .replace(/<\/w:p\s*>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
            .trim();
        if (!text) throw new Error('DOCX 未提取到正文');
        return text;
    }
    function isTextAttachment(file) {
        return /^text\//i.test(file.type) || /\.(txt|md|markdown|json|csv|html|htm|xml|css|js|ts)$/i.test(file.name);
    }
    async function readAttachment(file) {
        const name = file.name || '未命名文件';
        if (file.size > 12 * 1024 * 1024) throw new Error('文件超过 12MB，请先压缩或截取需要的部分');
        if (/^image\//i.test(file.type) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(name)) {
            return { id: makeLocalId('attachment'), name, type: file.type || 'image/*', kind: 'image', dataUrl: await fileToDataURL(file), size: file.size };
        }
        let text;
        if (isTextAttachment(file)) text = await fileToText(file);
        else if (/\.pdf$/i.test(name) || file.type === 'application/pdf') text = await extractPdfText(file);
        else if (/\.docx$/i.test(name) || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') text = await extractDocxText(file);
        else throw new Error('暂不支持此文件格式，请使用图片、文本、PDF 或 DOCX');
        return { id: makeLocalId('attachment'), name, type: file.type || 'text/plain', kind: 'text', text: text.slice(0, 24000), size: file.size };
    }
    async function readAttachmentFiles(files) {
        const out = [];
        for (const file of [...files]) {
            try { out.push(await readAttachment(file)); }
            catch (error) { toast(`${file.name || '文件'}：${error.message}`, 'warning'); }
        }
        return out;
    }

    function knowledgeTypeLabel(type) {
        return type === 'style' ? '排版' : type === 'instruction' ? '指令' : '文档';
    }
    function splitSearchTerms(value) {
        const source = String(value || '').toLowerCase();
        const terms = source.match(/[\u4e00-\u9fff]|[a-z0-9_]{2,}/g) || [];
        return [...new Set(terms)].slice(0, 80);
    }
    function retrieveKnowledge(query, limit = 6) {
        const terms = splitSearchTerms(query);
        if (!terms.length) return [];
        return getKnowledgeDocuments().map(doc => {
            const haystack = `${doc.title || ''} ${doc.tags || ''} ${doc.text || ''}`.toLowerCase();
            let score = 0;
            terms.forEach(term => {
                let from = 0;
                let count = 0;
                while ((from = haystack.indexOf(term, from)) >= 0 && count < 8) { count++; from += term.length; }
                score += count * (String(doc.title || '').toLowerCase().includes(term) ? 4 : 1);
            });
            if (doc.type === 'instruction' && /调整|排版|样式|指令|格式/.test(query)) score += 1;
            return { doc, score };
        }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || (b.doc.updatedAt || 0) - (a.doc.updatedAt || 0)).slice(0, limit).map(item => item.doc);
    }
    function knowledgeContext(query) {
        return retrieveKnowledge(query).map((doc, index) => `【知识 ${index + 1}｜${doc.title}｜${knowledgeTypeLabel(doc.type)}】\n${String(doc.text || '').slice(0, 6000)}`).join('\n\n');
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
        .wh-field-help{ color:#64748b; font:10px/1.45 var(--wh-font); }
        .wh-input,.wh-textarea{
            width:100%; box-sizing:border-box; border:1px solid var(--wh-border); border-radius:8px;
            padding:8px 9px; outline:none; font:12px/1.45 var(--wh-font); color:var(--wh-text); background:#fff;
        }
        .wh-textarea{ min-height:84px; resize:vertical; }
        .wh-input:focus,.wh-textarea:focus{ border-color:#07c160; box-shadow:0 0 0 2px rgba(7,193,96,.12); }
        .wh-settings-actions{ display:flex; gap:8px; }
        .wh-settings-actions .wh-mini-btn{ flex:1; height:30px; }

        /* ---- 本地知识库与 AI 对话 ---- */
        .wh-kb-toolbar,.wh-chat-toolbar{ display:flex; gap:6px; align-items:center; padding:7px; border-bottom:1px solid var(--wh-border); background:#f8fafc; }
        .wh-kb-toolbar .wh-input{ flex:1; min-width:0; height:25px; padding:4px 7px; }
        .wh-kb-list{ flex:1 1 34%; min-height:70px; overflow:auto; padding:6px 7px; border-bottom:1px solid var(--wh-border); }
        .wh-kb-item{ display:flex; gap:6px; align-items:center; padding:7px 8px; border:1px solid transparent; border-radius:7px; cursor:pointer; }
        .wh-kb-item:hover,.wh-kb-item.wh-on{ background:#f0fdf4; border-color:#bbf7d0; }
        .wh-kb-item-main{ min-width:0; flex:1; }
        .wh-kb-item-title{ display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:800 11px/1.4 var(--wh-font); color:#334155; }
        .wh-kb-item-meta{ display:block; color:#94a3b8; font:10px/1.4 var(--wh-font); }
        .wh-kb-item-del{ border:0; background:transparent; color:#94a3b8; cursor:pointer; padding:2px 4px; }
        .wh-kb-item-del:hover{ color:#ef4444; }
        .wh-kb-editor{ padding:8px; display:flex; flex-direction:column; gap:6px; overflow:auto; }
        .wh-kb-editor .wh-input{ height:27px; padding:5px 7px; }
        .wh-kb-row{ display:grid; grid-template-columns:1fr 1.4fr; gap:6px; }
        .wh-kb-content{ min-height:120px; max-height:240px; }
        .wh-kb-save{ align-self:flex-end; height:27px; }
        .wh-check{ display:inline-flex; align-items:center; gap:4px; font:600 10.5px/1 var(--wh-font); color:#64748b; white-space:nowrap; }
        .wh-check input{ accent-color:#07c160; }
        .wh-chat-toolbar{ justify-content:space-between; }
        .wh-chat-messages{ flex:1 1 auto; min-height:0; overflow:auto; padding:8px; background:#f8fafc; overscroll-behavior:contain; }
        .wh-chat-empty{ color:#94a3b8; font:11px/1.6 var(--wh-font); text-align:center; padding:22px 10px; }
        .wh-chat-message{ max-width:94%; margin:0 0 8px; display:flex; flex-direction:column; gap:4px; }
        .wh-chat-message.wh-user{ margin-left:auto; align-items:flex-end; }
        .wh-chat-message.wh-assistant{ align-items:flex-start; }
        .wh-chat-bubble{ white-space:pre-wrap; overflow-wrap:anywhere; padding:8px 10px; border-radius:9px; font:12px/1.55 var(--wh-font); }
        .wh-user .wh-chat-bubble{ background:#07c160; color:#fff; border-bottom-right-radius:3px; }
        .wh-assistant .wh-chat-bubble{ background:#fff; color:#334155; border:1px solid var(--wh-border); border-bottom-left-radius:3px; }
        .wh-chat-time{ color:#94a3b8; font:9px/1 var(--wh-font); }
        .wh-chat-action{ margin-top:3px; display:flex; gap:5px; flex-wrap:wrap; }
        .wh-chat-attachments{ display:flex; gap:5px; flex-wrap:wrap; min-height:0; padding:0 8px; background:#f8fafc; }
        .wh-chat-attachment{ display:inline-flex; align-items:center; gap:4px; max-width:180px; padding:4px 6px; border:1px solid #bbf7d0; border-radius:6px; background:#f0fdf4; color:#166534; font:10px/1.2 var(--wh-font); }
        .wh-chat-attachment img{ width:26px; height:26px; object-fit:cover; border-radius:4px; }
        .wh-chat-attachment span{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .wh-chat-attachment button{ border:0; background:transparent; color:#64748b; cursor:pointer; }
        .wh-chat-compose{ flex:0 0 auto; position:sticky; bottom:0; z-index:3; padding:7px 7px calc(12px + env(safe-area-inset-bottom, 0px)); border-top:1px solid var(--wh-border); background:#fff; box-shadow:0 -3px 10px rgba(15,23,42,.06); }
        #wh-panel.wh-native .wh-chat-compose{ padding-bottom:calc(64px + env(safe-area-inset-bottom, 0px)); }
        .wh-chat-input{ min-height:54px; max-height:130px; }
        .wh-chat-actions{ display:flex; align-items:center; gap:6px; margin-top:5px; }
        .wh-chat-hint{ flex:1; color:#94a3b8; font:10px/1.2 var(--wh-font); }
        .wh-chat-send{ background:#07c160; border-color:#07c160; color:#fff; min-width:48px; }
        .wh-chat-send:hover{ color:#fff; background:#05a854; }
        .wh-chat-send:disabled{ opacity:.55; cursor:wait; }

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
    let elKbList, elKbSearch, elKbTitle, elKbType, elKbTags, elKbContent;
    let elChatMessages, elChatInput, elChatAttachments, elChatFileInput, elChatContext;

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
                    <button class="wh-rail-btn" data-tab="knowledge" title="知识库"><b>知</b><span>知识</span></button>
                    <button class="wh-rail-btn" data-tab="chat" title="AI 对话"><b>AI</b><span>对话</span></button>
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

                <div class="wh-pane" data-pane="knowledge">
                    <div class="wh-pane-title"><span>本地知识库</span><small>只保存在本机</small></div>
                    <div class="wh-kb-toolbar">
                        <input class="wh-input" id="wh-kb-search" placeholder="搜索知识条目">
                        <button class="wh-mini-btn" id="wh-kb-new">新建</button>
                        <button class="wh-mini-btn" id="wh-kb-import">导入文件</button>
                        <input id="wh-kb-file" type="file" hidden accept=".txt,.md,.markdown,.json,.csv,.html,.htm,.pdf,.docx,text/*,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document">
                    </div>
                    <div class="wh-kb-list" id="wh-kb-list"></div>
                    <div class="wh-kb-editor">
                        <input class="wh-input" id="wh-kb-title" placeholder="标题，例如：常用蓝灰样式">
                        <div class="wh-kb-row">
                            <select class="wh-input" id="wh-kb-type">
                                <option value="instruction">常用指令</option>
                                <option value="style">排版格式</option>
                                <option value="document">参考文档</option>
                            </select>
                            <input class="wh-input" id="wh-kb-tags" placeholder="标签，用逗号分隔">
                        </div>
                        <textarea class="wh-textarea wh-kb-content" id="wh-kb-content" placeholder="写下排版规范、常用指令或参考文档内容"></textarea>
                        <button class="wh-mini-btn wh-kb-save" id="wh-kb-save">保存条目</button>
                    </div>
                </div>

                <div class="wh-pane" data-pane="chat">
                    <div class="wh-pane-title"><span>AI 对话</span><small id="wh-chat-state">就绪</small></div>
                    <div class="wh-chat-toolbar">
                        <label class="wh-check"><input type="checkbox" id="wh-chat-context"> 带上当前正文</label>
                        <button class="wh-mini-btn" id="wh-chat-undo" title="撤销 AI 上次修改">撤销</button>
                        <button class="wh-mini-btn" id="wh-chat-clear">清空对话</button>
                    </div>
                    <div class="wh-chat-messages" id="wh-chat-messages"></div>
                    <div class="wh-chat-attachments" id="wh-chat-attachments"></div>
                    <div class="wh-chat-compose">
                        <textarea class="wh-textarea wh-chat-input" id="wh-chat-input" placeholder="告诉 AI 要如何调整文章、HTML 或排版"></textarea>
                        <div class="wh-chat-actions">
                            <button class="wh-mini-btn" id="wh-chat-attach" title="添加图片、截图或文件">📎 附件</button>
                            <input id="wh-chat-file" type="file" hidden multiple accept="image/*,.txt,.md,.markdown,.json,.csv,.html,.htm,.pdf,.docx,text/*,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document">
                            <button class="wh-mini-btn wh-chat-send" id="wh-chat-send">发送</button>
                            <span class="wh-chat-hint">粘贴截图也可以</span>
                        </div>
                    </div>
                </div>

                <div class="wh-pane" data-pane="ai">
                    <div class="wh-pane-title"><span>AI 与 API</span><small>本机保存</small></div>
                    <div class="wh-settings">
                        <div class="wh-field">
                            <label for="wh-ai-provider">服务商</label>
                            <select class="wh-input" id="wh-ai-provider">
                                <option value="openai">OpenAI</option>
                                <option value="doubao">豆包（火山方舟）</option>
                                <option value="agnes">Agnes</option>
                                <option value="custom">自定义 OpenAI 兼容</option>
                            </select>
                        </div>
                        <div class="wh-field">
                            <label for="wh-ai-endpoint">API Endpoint</label>
                            <input class="wh-input" id="wh-ai-endpoint" placeholder="https://api.openai.com/v1/chat/completions">
                        </div>
                        <div class="wh-field">
                            <label for="wh-ai-model">模型</label>
                            <select class="wh-input" id="wh-ai-model-choice" hidden>
                                <option value="agnes-2.5-flash">Agnes 2.5 Flash（推荐）</option>
                                <option value="agnes-2.5-pro">Agnes 2.5 Pro</option>
                                <option value="agnes-2.5-pro-alpha">Agnes 2.5 Pro Alpha</option>
                                <option value="agnes-2.0-flash">Agnes 2.0 Flash</option>
                            </select>
                            <input class="wh-input" id="wh-ai-model" placeholder="gpt-4.1-mini">
                            <small class="wh-field-help" id="wh-ai-model-help"></small>
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
                            <button class="wh-mini-btn" id="wh-ai-test">测试连接</button>
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
        elKbList = elPanel.querySelector('#wh-kb-list');
        elKbSearch = elPanel.querySelector('#wh-kb-search');
        elKbTitle = elPanel.querySelector('#wh-kb-title');
        elKbType = elPanel.querySelector('#wh-kb-type');
        elKbTags = elPanel.querySelector('#wh-kb-tags');
        elKbContent = elPanel.querySelector('#wh-kb-content');
        elChatMessages = elPanel.querySelector('#wh-chat-messages');
        elChatInput = elPanel.querySelector('#wh-chat-input');
        elChatAttachments = elPanel.querySelector('#wh-chat-attachments');
        elChatFileInput = elPanel.querySelector('#wh-chat-file');
        elChatContext = elPanel.querySelector('#wh-chat-context');
        populateAISettings();

        // 恢复草稿
        const draft = Config.get('draft', '');
        if (draft) elCode.value = draft;
        if (!state.previewOn && elPreviewWrap && elPreviewBtn) { elPreviewWrap.classList.add('wh-hidden'); elPreviewBtn.classList.remove('wh-active'); }

        buildStylePane();
        buildReadingBackgroundPane();
        applyReadingBackground(state.readingBg, { silent: true });
        bindEvents();
        renderChatMessages();
        renderChatAttachments();
        elChatContext.checked = state.chatContextOn;
        loadKnowledgeDocuments().then(docs => {
            state.knowledgeDocs = Array.isArray(docs) ? docs : [];
            state.knowledgeReady = true;
            renderKnowledgeList();
        });
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
    //  知识库界面
    // =========================================================
    function resetKnowledgeEditor() {
        state.knowledgeEditingId = null;
        if (elKbTitle) elKbTitle.value = '';
        if (elKbType) elKbType.value = 'instruction';
        if (elKbTags) elKbTags.value = '';
        if (elKbContent) elKbContent.value = '';
        elKbList?.querySelectorAll('.wh-kb-item').forEach(el => el.classList.remove('wh-on'));
    }
    function editKnowledgeDocument(doc) {
        state.knowledgeEditingId = doc.id;
        if (elKbTitle) elKbTitle.value = doc.title || '';
        if (elKbType) elKbType.value = doc.type || 'document';
        if (elKbTags) elKbTags.value = Array.isArray(doc.tags) ? doc.tags.join(', ') : (doc.tags || '');
        if (elKbContent) elKbContent.value = doc.text || '';
        elKbList?.querySelectorAll('.wh-kb-item').forEach(el => el.classList.toggle('wh-on', el.dataset.id === doc.id));
    }
    function renderKnowledgeList() {
        if (!elKbList) return;
        const query = String(elKbSearch?.value || '').trim().toLowerCase();
        const docs = getKnowledgeDocuments().filter(doc => !query || `${doc.title} ${doc.tags || ''} ${doc.text || ''}`.toLowerCase().includes(query));
        elKbList.innerHTML = '';
        if (!docs.length) {
            const empty = document.createElement('div');
            empty.className = 'wh-empty';
            empty.textContent = query ? '没有匹配的知识条目' : '还没有本地知识条目';
            elKbList.appendChild(empty);
            return;
        }
        docs.forEach(doc => {
            const item = document.createElement('div');
            item.className = 'wh-kb-item';
            item.dataset.id = doc.id;
            if (doc.id === state.knowledgeEditingId) item.classList.add('wh-on');
            const main = document.createElement('div');
            main.className = 'wh-kb-item-main';
            const title = document.createElement('span');
            title.className = 'wh-kb-item-title';
            title.textContent = doc.title || '未命名条目';
            const meta = document.createElement('span');
            meta.className = 'wh-kb-item-meta';
            meta.textContent = `${knowledgeTypeLabel(doc.type)} · ${(doc.text || '').length} 字`;
            main.append(title, meta);
            const del = document.createElement('button');
            del.className = 'wh-kb-item-del';
            del.type = 'button';
            del.title = '删除';
            del.textContent = '×';
            del.onclick = async event => {
                event.stopPropagation();
                if (!confirm(`删除知识条目「${doc.title || '未命名条目'}」？`)) return;
                await removeKnowledgeDocument(doc.id);
                state.knowledgeDocs = getKnowledgeDocuments().filter(item => item.id !== doc.id);
                if (state.knowledgeEditingId === doc.id) resetKnowledgeEditor();
                renderKnowledgeList();
            };
            item.onclick = () => editKnowledgeDocument(doc);
            item.append(main, del);
            elKbList.appendChild(item);
        });
    }
    async function saveKnowledgeFromEditor() {
        const title = String(elKbTitle?.value || '').trim();
        const text = String(elKbContent?.value || '').trim();
        if (!title || !text) { toast('请填写知识条目的标题和内容', 'warning'); return; }
        const now = Date.now();
        const existing = getKnowledgeDocuments().find(doc => doc.id === state.knowledgeEditingId);
        const doc = {
            id: existing?.id || makeLocalId('knowledge'),
            title,
            type: elKbType?.value || 'document',
            tags: String(elKbTags?.value || '').split(/[,，]/).map(item => item.trim()).filter(Boolean).slice(0, 12),
            text: text.slice(0, 30000),
            createdAt: existing?.createdAt || now,
            updatedAt: now,
        };
        await saveKnowledgeDocument(doc);
        state.knowledgeDocs = [doc, ...getKnowledgeDocuments().filter(item => item.id !== doc.id)];
        resetKnowledgeEditor();
        renderKnowledgeList();
        toast('知识条目已保存');
    }
    async function importKnowledgeFile(file) {
        const attachment = await readAttachment(file);
        if (attachment.kind !== 'text') throw new Error('知识库只导入文本内容，图片请放入 AI 对话附件');
        const now = Date.now();
        const doc = {
            id: makeLocalId('knowledge'),
            title: file.name.replace(/\.[^.]+$/, '') || '导入文档',
            type: 'document', tags: [], text: attachment.text.slice(0, 30000), createdAt: now, updatedAt: now,
        };
        await saveKnowledgeDocument(doc);
        state.knowledgeDocs = [doc, ...getKnowledgeDocuments()];
        renderKnowledgeList();
        toast(`已导入知识条目：${doc.title}`);
    }

    // =========================================================
    //  对话界面与结构化操作
    // =========================================================
    function setChatState(text, type = '') {
        if (!elPanel) return;
        const el = elPanel.querySelector('#wh-chat-state');
        if (!el) return;
        el.textContent = text;
        el.style.color = type === 'error' ? '#ef4444' : type === 'ok' ? '#07a855' : '#64748b';
    }
    function renderChatAttachments() {
        if (!elChatAttachments) return;
        elChatAttachments.innerHTML = '';
        state.chatAttachments.forEach((attachment, index) => {
            const item = document.createElement('span');
            item.className = 'wh-chat-attachment';
            if (attachment.kind === 'image') {
                const img = document.createElement('img');
                img.src = attachment.dataUrl;
                img.alt = attachment.name;
                item.appendChild(img);
            }
            const name = document.createElement('span');
            name.textContent = attachment.name;
            const remove = document.createElement('button');
            remove.type = 'button'; remove.textContent = '×'; remove.title = '移除附件';
            remove.onclick = () => { state.chatAttachments.splice(index, 1); renderChatAttachments(); };
            item.append(name, remove);
            elChatAttachments.appendChild(item);
        });
    }
    function renderChatMessages() {
        if (!elChatMessages) return;
        elChatMessages.innerHTML = '';
        if (!state.chatHistory.length) {
            const empty = document.createElement('div');
            empty.className = 'wh-chat-empty';
            empty.textContent = '从当前正文、知识库或图片附件开始对话';
            elChatMessages.appendChild(empty);
            return;
        }
        state.chatHistory.forEach(message => {
            const wrap = document.createElement('div');
            wrap.className = `wh-chat-message wh-${message.role === 'user' ? 'user' : 'assistant'}`;
            const bubble = document.createElement('div');
            bubble.className = 'wh-chat-bubble';
            bubble.textContent = message.content || '';
            const time = document.createElement('span');
            time.className = 'wh-chat-time';
            time.textContent = message.createdAt ? new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            wrap.append(bubble, time);
            if (message.role === 'assistant' && Array.isArray(message.actions) && message.actions.length) {
                const actions = document.createElement('div');
                actions.className = 'wh-chat-action';
                message.actions.forEach((action, index) => {
                    const button = document.createElement('button');
                    button.type = 'button'; button.className = 'wh-mini-btn';
                    button.textContent = action.type === 'insert_html' ? '插入到正文' : '应用到正文';
                    button.onclick = () => applyChatAction(message, index);
                    actions.appendChild(button);
                });
                wrap.appendChild(actions);
            }
            elChatMessages.appendChild(wrap);
        });
        elChatMessages.scrollTop = elChatMessages.scrollHeight;
    }
    function getArticleSnapshot() {
        const r = findEditor();
        return r ? r.editor.innerHTML : '';
    }
    function pushArticleSnapshot() {
        const html = getArticleSnapshot();
        if (!html && !state.articleSnapshots.length) return;
        state.articleSnapshots.push({ html, createdAt: Date.now() });
        if (state.articleSnapshots.length > 20) state.articleSnapshots.shift();
    }
    function undoLastArticleChange() {
        const snapshot = state.articleSnapshots.pop();
        if (!snapshot) { toast('没有可撤销的 AI 修改', 'warning'); return false; }
        const ok = applyWhole(snapshot.html, { silent: true, snapshot: false });
        if (ok) toast('已撤销上次修改');
        return ok;
    }
    function normalizeChatResponse(raw) {
        let text = String(raw || '').trim();
        text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        let parsed = null;
        try { parsed = JSON.parse(text); }
        catch {
            const start = text.indexOf('{');
            const end = text.lastIndexOf('}');
            if (start >= 0 && end > start) {
                try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { parsed = null; }
            }
        }
        if (!parsed || typeof parsed !== 'object') return { reply: String(raw || '').trim(), actions: [] };
        const actions = Array.isArray(parsed.actions) ? parsed.actions.filter(action => {
            return action && ['replace_html', 'set_html', 'insert_html'].includes(action.type) && typeof action.html === 'string' && action.html.trim();
        }).slice(0, 4).map(action => ({ type: action.type, html: action.html.slice(0, 50000) })) : [];
        return { reply: String(parsed.reply || parsed.message || 'AI 已返回结果').trim(), actions };
    }
    function getChatArticleContext() {
        const r = findEditor();
        if (!r) return '';
        const html = r.editor.innerHTML.trim();
        const text = (r.editor.textContent || '').trim();
        return `当前正文 HTML：\n${html.slice(0, 36000)}\n\n当前正文纯文本：\n${text.slice(0, 9000)}`;
    }
    function buildChatPrompt(text, attachments = state.chatAttachments) {
        const pieces = [`用户请求：\n${text}`];
        if (state.chatContextOn) {
            const article = getChatArticleContext();
            if (article) pieces.push(article);
        }
        const knowledge = knowledgeContext(text);
        if (knowledge) pieces.push(`本地知识库检索结果（仅作参考）：\n${knowledge}`);
        if (attachments.some(item => item.kind === 'text')) {
            pieces.push(attachments.filter(item => item.kind === 'text').map(item => `附件《${item.name}》：\n${item.text}`).join('\n\n'));
        }
        return pieces.join('\n\n---\n\n');
    }
    async function sendChatMessage() {
        if (state.chatBusy) return;
        if (!state.knowledgeReady) {
            const docs = await loadKnowledgeDocuments();
            state.knowledgeDocs = Array.isArray(docs) ? docs : [];
            state.knowledgeReady = true;
        }
        const text = String(elChatInput?.value || '').trim();
        if (!text && !state.chatAttachments.length) { toast('请输入问题或添加附件', 'warning'); return; }
        const attachments = state.chatAttachments.slice();
        const displayText = `${text || '请分析附件'}${attachments.length ? `\n附件：${attachments.map(item => item.name).join('、')}` : ''}`;
        state.chatHistory.push({ role: 'user', content: displayText, createdAt: Date.now() });
        if (elChatInput) elChatInput.value = '';
        state.chatAttachments = [];
        renderChatAttachments(); renderChatMessages(); persistChatHistory();
        state.chatBusy = true;
        const sendButton = elPanel?.querySelector('#wh-chat-send');
        if (sendButton) sendButton.disabled = true;
        setChatState('思考中…');
        const requestText = text || '请分析这些附件，并结合当前正文给出可执行的调整建议。';
        try {
            const result = await callAIChat(requestText, attachments);
            state.chatHistory.push({ role: 'assistant', content: result.reply || 'AI 没有返回文字。', actions: result.actions, createdAt: Date.now() });
            persistChatHistory();
            renderChatMessages();
            setChatState(result.actions.length ? '待确认应用' : '就绪', result.actions.length ? '' : 'ok');
        } catch (error) {
            state.chatHistory.push({ role: 'assistant', content: `请求失败：${error.message}`, actions: [], createdAt: Date.now() });
            persistChatHistory(); renderChatMessages(); setChatState('请求失败', 'error');
        } finally {
            state.chatBusy = false;
            if (sendButton) sendButton.disabled = false;
        }
    }
    function applyChatAction(message, index) {
        const action = message?.actions?.[index];
        if (!action || !action.html) return;
        const type = action.type === 'insert_html' ? 'insert' : 'replace';
        if (type === 'replace') pushArticleSnapshot();
        const ok = type === 'insert' ? appendToArticle(action.html) : applyWhole(action.html, { snapshot: false });
        if (ok) {
            message.actions.splice(index, 1);
            persistChatHistory(); renderChatMessages(); setChatState('已应用', 'ok');
        }
    }
    function clearChatHistory() {
        if (state.chatBusy) return;
        state.chatHistory = [];
        persistChatHistory();
        renderChatMessages();
        setChatState('就绪', 'ok');
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
                applyWhole('', { silent: true, snapshot: false });
                setSyncState('已清空', 'ok');
                return;
            }
            if (!/<[a-z][\s\S]*>/i.test(trimmed)) {
                setSyncState('等待完整 HTML');
                return;
            }
            const ok = applyWhole(trimmed, { silent: true, snapshot: false });
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
        elPanel.querySelector('#wh-ai-test').onclick = () => testAIConnection();
        elPanel.querySelector('#wh-ai-run').onclick = () => runAIAdjust();
        elPanel.querySelector('#wh-ai-provider').addEventListener('change', event => applyAIProviderPreset(event.target.value));
        elPanel.querySelector('#wh-ai-model-choice').addEventListener('change', event => {
            elPanel.querySelector('#wh-ai-model').value = event.target.value;
        });

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

        // 本地知识库
        elKbSearch?.addEventListener('input', renderKnowledgeList);
        elPanel.querySelector('#wh-kb-new')?.addEventListener('click', resetKnowledgeEditor);
        elPanel.querySelector('#wh-kb-save')?.addEventListener('click', saveKnowledgeFromEditor);
        elPanel.querySelector('#wh-kb-import')?.addEventListener('click', () => elPanel.querySelector('#wh-kb-file')?.click());
        elPanel.querySelector('#wh-kb-file')?.addEventListener('change', async event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            try { await importKnowledgeFile(file); }
            catch (error) { toast(error.message, 'warning'); }
        });

        // AI 对话与附件
        elPanel.querySelector('#wh-chat-context')?.addEventListener('change', event => {
            state.chatContextOn = Boolean(event.target.checked);
            Config.set('chatContextOn', state.chatContextOn);
        });
        elPanel.querySelector('#wh-chat-send')?.addEventListener('click', sendChatMessage);
        elPanel.querySelector('#wh-chat-clear')?.addEventListener('click', clearChatHistory);
        elPanel.querySelector('#wh-chat-undo')?.addEventListener('click', undoLastArticleChange);
        elPanel.querySelector('#wh-chat-attach')?.addEventListener('click', () => elChatFileInput?.click());
        elChatFileInput?.addEventListener('change', async event => {
            const files = [...(event.target.files || [])];
            event.target.value = '';
            if (!files.length) return;
            state.chatAttachments.push(...await readAttachmentFiles(files));
            renderChatAttachments();
        });
        elChatInput?.addEventListener('paste', async event => {
            const clipboard = event.clipboardData;
            const itemFiles = [...(clipboard?.items || [])]
                .filter(item => item.kind === 'file')
                .map(item => item.getAsFile?.())
                .filter(Boolean);
            const files = [...new Map([...((clipboard?.files || [])), ...itemFiles]
                .filter(file => /^image\//i.test(file.type))
                .map(file => [`${file.name}:${file.size}:${file.lastModified}`, file])).values()];
            if (!files.length) return;
            event.preventDefault();
            state.chatAttachments.push(...await readAttachmentFiles(files));
            renderChatAttachments();
            toast('截图已添加到对话附件');
        });
        elChatInput?.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendChatMessage(); }
        });

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
        if (name === 'knowledge') renderKnowledgeList();
        if (name === 'chat') { renderChatMessages(); renderChatAttachments(); }
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
    const AI_PROVIDERS = {
        openai: {
            endpoint: 'https://api.openai.com/v1/chat/completions',
            model: 'gpt-4.1-mini',
            placeholder: 'gpt-4.1-mini',
            help: '填写 OpenAI 模型名称。',
        },
        doubao: {
            endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
            model: '',
            placeholder: 'ep-2026...',
            help: '填写火山方舟控制台中的推理接入点 ID（ep-...），不是展示模型名称。',
        },
        agnes: {
            endpoint: 'https://apihub.agnes-ai.com/v1/chat/completions',
            model: 'agnes-2.5-flash',
            placeholder: '选择 Agnes 模型',
            help: 'Agnes API 使用 Bearer Key，默认选择 Agnes 2.5 Flash；也可切换 Pro 或旧版模型。',
        },
        custom: {
            endpoint: '',
            model: '',
            placeholder: '模型名称',
            help: '填写完整的 OpenAI 兼容 Chat Completions 地址。',
        },
    };

    function normalizeAIEndpoint(endpoint, provider) {
        const value = String(endpoint || '').trim().replace(/\/+$/, '');
        if (provider === 'doubao' && /\/api\/v3$/i.test(value)) return `${value}/chat/completions`;
        return value;
    }

    function extractAIContent(data) {
        const candidates = [data?.choices?.[0]?.message?.content, data?.choices?.[0]?.text, data?.output_text, data?.response, data?.result];
        const value = candidates.find(item => typeof item === 'string' && item.trim()) || candidates.find(item => Array.isArray(item) && item.length);
        if (Array.isArray(value)) return value.map(item => typeof item === 'string' ? item : (item?.text || item?.content || '')).join('');
        return typeof value === 'string' ? value : '';
    }

    async function requestAI(endpoint, init) {
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            try {
                const packet = await new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage({ type: 'wh-ai-request', endpoint, init }, response => {
                        const runtimeError = chrome.runtime.lastError;
                        if (runtimeError) reject(new Error(runtimeError.message));
                        else resolve(response);
                    });
                });
                if (packet?.handled) {
                    return {
                        ok: Boolean(packet.ok),
                        status: packet.status || 0,
                        statusText: packet.statusText || '',
                        text: async () => String(packet.text || ''),
                        json: async () => JSON.parse(String(packet.text || '{}')),
                    };
                }
            } catch (error) { log.warn('后台请求通道不可用，回退页面请求', error.message); }
        }
        return fetch(endpoint, init);
    }
    function getAIConfig() {
        const savedEndpoint = Config.get('aiEndpoint', '');
        const provider = Config.get('aiProvider', '') || (/ark\.cn-beijing\.volces\.com/i.test(savedEndpoint) ? 'doubao' : 'openai');
        const preset = AI_PROVIDERS[provider] || AI_PROVIDERS.custom;
        return {
            provider,
            endpoint: normalizeAIEndpoint(savedEndpoint || preset.endpoint, provider),
            model: Config.get('aiModel', preset.model),
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
        const provider = elPanel?.querySelector('#wh-ai-provider');
        const endpoint = elPanel?.querySelector('#wh-ai-endpoint');
        const model = elPanel?.querySelector('#wh-ai-model');
        const modelChoice = elPanel?.querySelector('#wh-ai-model-choice');
        const key = elPanel?.querySelector('#wh-ai-key');
        const instruction = elPanel?.querySelector('#wh-ai-instruction');
        if (provider) provider.value = cfg.provider;
        if (endpoint) endpoint.value = cfg.endpoint;
        if (model) model.value = cfg.model;
        if (key) key.value = cfg.apiKey;
        if (instruction) instruction.value = cfg.instruction;
        updateAIProviderHelp(cfg.provider);
    }

    function updateAIProviderHelp(provider) {
        const preset = AI_PROVIDERS[provider] || AI_PROVIDERS.custom;
        const model = elPanel?.querySelector('#wh-ai-model');
        const help = elPanel?.querySelector('#wh-ai-model-help');
        if (model) model.placeholder = preset.placeholder;
        if (modelChoice) {
            modelChoice.hidden = provider !== 'agnes';
            model.hidden = provider === 'agnes';
            if (provider === 'agnes') modelChoice.value = model.value || preset.model;
        }
        if (help) help.textContent = preset.help;
    }

    function applyAIProviderPreset(provider) {
        const preset = AI_PROVIDERS[provider] || AI_PROVIDERS.custom;
        const endpoint = elPanel.querySelector('#wh-ai-endpoint');
        const model = elPanel.querySelector('#wh-ai-model');
        endpoint.value = preset.endpoint;
        model.value = preset.model;
        updateAIProviderHelp(provider);
    }

    function saveAISettings(options = {}) {
        const provider = elPanel.querySelector('#wh-ai-provider').value;
        const preset = AI_PROVIDERS[provider] || AI_PROVIDERS.custom;
        const endpoint = normalizeAIEndpoint(elPanel.querySelector('#wh-ai-endpoint').value, provider);
        const model = elPanel.querySelector('#wh-ai-model').value.trim();
        const apiKey = elPanel.querySelector('#wh-ai-key').value.trim();
        const instruction = elPanel.querySelector('#wh-ai-instruction').value.trim();
        Config.set('aiProvider', provider);
        Config.set('aiEndpoint', endpoint || preset.endpoint);
        Config.set('aiModel', model || preset.model);
        Config.set('aiApiKey', apiKey);
        Config.set('aiInstruction', instruction || getAIConfig().instruction);
        if (endpoint !== elPanel.querySelector('#wh-ai-endpoint').value.trim()) elPanel.querySelector('#wh-ai-endpoint').value = endpoint;
        if (!options.silent) toast('API 配置已保存');
        return getAIConfig();
    }

    async function testAIConnection() {
        const button = elPanel.querySelector('#wh-ai-test');
        const oldText = button.textContent;
        const cfg = saveAISettings({ silent: true });
        if (!cfg.endpoint || !cfg.model || !cfg.apiKey) {
            toast('请先填写完整的 Endpoint、模型和 API Key', 'warning');
            return;
        }
        button.disabled = true;
        button.textContent = '测试中...';
        try {
            const res = await requestAI(cfg.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
                body: JSON.stringify({
                    model: cfg.model,
                    temperature: 0,
                    max_tokens: 8,
                    messages: [{ role: 'user', content: '只回复 OK' }],
                }),
            });
            if (!res.ok) {
                const errorText = await res.text().catch(() => '');
                throw new Error(formatAIError(res.status, res.statusText, errorText));
            }
            const data = await res.json();
            if (!extractAIContent(data)) throw new Error('服务已响应，但没有返回可识别的内容');
            toast('API 连接成功');
        } catch (error) {
            toast(`连接失败：${error.message}`, 'error');
        } finally {
            button.disabled = false;
            button.textContent = oldText;
        }
    }

    function formatAIError(status, statusText, body) {
        let detail = String(body || '').trim();
        try {
            const parsed = JSON.parse(detail);
            detail = parsed?.error?.message || parsed?.message || detail;
        } catch {}
        detail = detail.replace(/\s+/g, ' ').slice(0, 180);
        return `${status || '网络错误'}${statusText ? ` ${statusText}` : ''}${detail ? `：${detail}` : ''}`;
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
        const res = await requestAI(cfg.endpoint, {
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
            throw new Error(formatAIError(res.status, res.statusText, text));
        }
        const data = await res.json();
        return extractAIContent(data);
    }
    async function callAIChat(text, attachments) {
        const cfg = getAIConfig();
        if (!cfg.apiKey) { showAIConfig(); throw new Error('请先在 AI 配置页填写 API Key'); }
        const prior = state.chatHistory.slice(0, -1).slice(-12).map(message => ({
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: String(message.content || '').slice(0, 12000),
        }));
        const parts = [{ type: 'text', text: buildChatPrompt(text, attachments) }];
        attachments.filter(item => item.kind === 'image').forEach(item => {
            parts.push({ type: 'image_url', image_url: { url: item.dataUrl, detail: 'auto' } });
        });
        const res = await requestAI(cfg.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
            body: JSON.stringify({
                model: cfg.model,
                temperature: 0.2,
                messages: [
                    {
                        role: 'system',
                        content: [
                            '你是微信公众号文章和 HTML 排版助手。',
                            '结合用户当前正文、本地知识库和附件回答问题。',
                            '必须只返回 JSON，不要 Markdown 代码围栏。',
                            '格式：{"reply":"给用户看的简短说明","actions":[{"type":"replace_html|insert_html","html":"可直接使用的 HTML"}]}。',
                            '没有需要写回正文的操作时 actions 返回空数组。',
                            'replace_html 用于整篇替换，insert_html 用于追加片段。',
                            'HTML 必须保留用户要求保留的文字、图片 src/data-src 和链接 href；禁止 script、iframe、form、object、embed。',
                        ].join('\n'),
                    },
                    ...prior,
                    { role: 'user', content: parts.length === 1 ? parts[0].text : parts },
                ],
            }),
        });
        if (!res.ok) {
            const errorText = await res.text().catch(() => '');
            throw new Error(formatAIError(res.status, res.statusText, errorText));
        }
        const data = await res.json();
        return normalizeChatResponse(extractAIContent(data));
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
