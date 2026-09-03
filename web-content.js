(function () {
    'use strict';

    if (window.top !== window) return;
    const HOST_ID = 'yunzhongshu-web-clip-host';
    if (document.getElementById(HOST_ID)) return;

    const state = { open: false, busy: false, mode: 'clip', last: null };
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:20px;bottom:20px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        *{box-sizing:border-box}button,input,textarea{font:inherit}.trigger{border:0;border-radius:999px;background:#1f6feb;color:#fff;padding:10px 16px;box-shadow:0 5px 22px #0003;cursor:pointer;font-size:13px}.trigger:hover{background:#185abd}.panel{display:none;width:360px;max-height:calc(100vh - 48px);overflow:auto;background:#fff;border:1px solid #d8dee9;border-radius:12px;box-shadow:0 10px 35px #0004;color:#1f2328}.panel.open{display:block}.head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #eaeef2;font-weight:600}.close{border:0;background:none;color:#57606a;font-size:20px;cursor:pointer}.body{padding:14px 16px}.hint{font-size:12px;line-height:1.6;color:#57606a;background:#f6f8fa;padding:9px 10px;border-radius:7px;margin-bottom:12px}.status{font-size:12px;line-height:1.5;white-space:pre-wrap;margin-top:10px}.status.ok{color:#1a7f37}.status.error{color:#cf222e}.field{margin:10px 0}.field label{display:block;font-size:12px;color:#57606a;margin-bottom:5px}.field input,.field textarea{width:100%;border:1px solid #d0d7de;border-radius:6px;padding:8px;font-size:12px}.field textarea{min-height:72px;resize:vertical}.actions{display:flex;gap:8px;margin-top:12px}.actions button{flex:1;border:1px solid #d0d7de;background:#fff;color:#24292f;border-radius:6px;padding:8px;cursor:pointer}.actions button.primary{background:#1f6feb;border-color:#1f6feb;color:#fff}.preview{font-size:12px;color:#57606a;border-top:1px solid #eaeef2;margin-top:12px;padding-top:10px}.preview strong{color:#24292f}.small{font-size:11px;color:#6e7781;margin-top:8px}
      </style>
      <button class="trigger" title="剪存当前网页到 WPS">剪存网页</button>
      <section class="panel" aria-label="网页剪存">
        <div class="head"><span>网页剪存到 WPS</span><button class="close" title="关闭">×</button></div>
        <div class="body">
          <div class="hint">首次使用需要配置 WPS 目标目录，并安装本地剪存组件。插件会在该目录下自动创建并复用“网页剪存”文件夹，组件只在剪存时启动，空闲后自动退出。</div>
          <div class="field"><label>WPS 文件夹/知识库目录链接</label><input class="target" type="url" placeholder="https://www.kdocs.cn/..." /></div>
          <div class="field"><label>本页备注（可选）</label><textarea class="note" placeholder="例如：重点看 API 设计和代码示例"></textarea></div>
          <div class="actions"><button class="primary clip">剪存当前网页</button><button class="summary">网页总结</button></div>
          <div class="actions"><button class="save">保存配置</button><button class="setup">打开插件设置</button></div>
          <div class="preview"></div><div class="status"></div>
          <div class="small">采集正文、图片和代码块；忽略视频与超链接。页面若为虚拟滚动，会先尝试加载可见内容。</div>
        </div>
      </section>`;
    document.documentElement.appendChild(host);

    const $ = selector => shadow.querySelector(selector);
    const panel = $('.panel');
    const status = $('.status');
    const target = $('.target');
    const note = $('.note');
    const preview = $('.preview');
    const cfgGet = async keys => (chrome.storage?.local ? chrome.storage.local.get(keys) : {});
    const cfgSet = async values => { if (chrome.storage?.local) await chrome.storage.local.set(values); };

    function setStatus(text, type = '') { status.textContent = text; status.className = `status ${type}`; }
    function open(mode = 'clip') {
        state.mode = mode; state.open = true; panel.classList.add('open');
        cfgGet(['wpsTargetUrl']).then(c => { target.value = c.wpsTargetUrl || ''; });
        updatePreview();
        if (mode === 'summary') runSummary();
    }
    function close() { state.open = false; panel.classList.remove('open'); }
    $('.trigger').addEventListener('click', () => open('clip'));
    $('.close').addEventListener('click', close);
    $('.save').addEventListener('click', async () => { const url = target.value.trim(); await cfgSet({ wpsTargetUrl: url }); setStatus(url ? 'WPS 目标已保存到本机。' : '已清除 WPS 目标。', 'ok'); });
    $('.setup').addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'open-settings' }, response => {
            if (chrome.runtime.lastError || !response?.ok) setStatus('无法打开插件设置，请点击浏览器工具栏中的插件图标。', 'error');
        });
    });
    $('.clip').addEventListener('click', () => runClip());
    $('.summary').addEventListener('click', () => runSummary());

    function visible(el) { const r = el.getBoundingClientRect(); return r.width > 20 && r.height > 20 && getComputedStyle(el).display !== 'none'; }
    function chooseRoot() {
        const selectors = [
            '#article_content', '.article-content', '.markdown_views',
            '.Post-RichTextContainer', '.RichContent-inner',
            '#js_content', '[data-testid="doc-content"]', '.docx-content',
            'article', 'main', '[role="main"]'
        ];
        const candidates = selectors.flatMap(s => [...document.querySelectorAll(s)]).filter(visible);
        candidates.sort((a, b) => ((b.innerText || '').length + b.querySelectorAll('img,pre,code').length * 300) - ((a.innerText || '').length + a.querySelectorAll('img,pre,code').length * 300));
        if (candidates[0]) return candidates[0];
        const all = [...document.querySelectorAll('div')].filter(el => visible(el) && (el.innerText || '').length > 800);
        all.sort((a, b) => (b.innerText || '').length - (a.innerText || '').length);
        return all[0] || document.body;
    }
    function cleanClone(root) {
        const clone = root.cloneNode(true);
        clone.querySelectorAll('script,style,noscript,nav,header,footer,aside,form,video,audio,iframe,button,[aria-hidden="true"]').forEach(el => el.remove());
        clone.querySelectorAll('*').forEach(el => {
            [...el.attributes].forEach(attr => { if (/^on/i.test(attr.name) || ['class','id','style','data-testid'].includes(attr.name)) el.removeAttribute(attr.name); });
        });
        clone.querySelectorAll('img').forEach(img => {
            const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy-src');
            if (src) img.setAttribute('src', new URL(src, location.href).href);
            [...img.attributes].forEach(attr => { if (attr.name !== 'src' && attr.name !== 'alt') img.removeAttribute(attr.name); });
        });
        clone.querySelectorAll('a').forEach(a => { const span = document.createElement('span'); span.innerHTML = a.innerHTML; a.replaceWith(...span.childNodes); });
        return clone;
    }
    function inlineText(node) {
        return (node.textContent || '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').trim();
    }
    function toMarkdown(root) {
        const out = [];
        const walk = node => {
            if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.replace(/\s+/g, ' ');
            if (node.nodeType !== Node.ELEMENT_NODE) return '';
            const tag = node.tagName.toLowerCase();
            if (tag === 'img') return `![${(node.getAttribute('alt') || '').replace(/[\[\]]/g, '')}](${node.getAttribute('src') || ''})`;
            if (tag === 'br') return '\n';
            if (tag === 'pre' || tag === 'code' && node.parentElement?.tagName.toLowerCase() === 'pre') {
                const code = node.textContent.replace(/\r\n/g, '\n').replace(/```/g, '``\\`');
                const lang = (node.className.match(/(?:language|lang)-([\w-]+)/) || [])[1] || '';
                return `\n\n\`\`\`${lang}\n${code.trimEnd()}\n\`\`\`\n\n`;
            }
            const content = [...node.childNodes].map(walk).join('').trim();
            if (!content) return '';
            if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${content}\n\n`;
            if (tag === 'li') return `\n- ${content}`;
            if (tag === 'blockquote') return `\n\n> ${content.replace(/\n+/g, '\n> ')}\n\n`;
            if (['p','div','section','article','tr','pre','figure'].includes(tag)) return `\n\n${content}\n\n`;
            return content;
        };
        const title = document.title.trim() || inlineText(root.querySelector('h1')) || '网页剪存';
        const body = walk(root).replace(/\n{3,}/g, '\n\n').trim();
        return `# ${title.replace(/\n/g, ' ')}\n\n来源：${location.href}\n\n${body}`.slice(0, 250000);
    }
    function collect() {
        const root = chooseRoot(); const clone = cleanClone(root); const markdown = toMarkdown(clone);
        const images = [...clone.querySelectorAll('img')].map(img => img.src).filter(Boolean);
        return { title: document.title.trim() || '网页剪存', url: location.href, markdown, images, selectedText: String(getSelection()?.toString() || '').trim() };
    }
    async function embedImages(data) {
        const urls = [...new Set(data.images)].slice(0, 40); let markdown = data.markdown; let embedded = 0;
        for (const url of urls) {
            if (url.startsWith('data:')) { embedded++; continue; }
            const packet = await new Promise(resolve => chrome.runtime.sendMessage({ type: 'wh-fetch-image', url }, response => resolve(response || {})));
            if (!packet.ok || !packet.dataUrl) continue;
            markdown = markdown.split(`](${url})`).join(`](${packet.dataUrl})`); embedded++;
            if (markdown.length > 24 * 1024 * 1024) break;
        }
        return { ...data, markdown, embeddedImages: embedded };
    }
    function updatePreview() { const data = collect(); preview.innerHTML = `<strong>${data.title}</strong><br>正文约 ${data.markdown.length.toLocaleString()} 字，图片 ${data.images.length} 张，代码块 ${data.markdown.match(/```/g)?.length / 2 || 0} 个`; }
    async function runClip() {
        if (state.busy) return; state.busy = true; setStatus('正在采集正文、图片和代码块…');
        try {
            const cfg = await cfgGet(['wpsTargetUrl']); const wpsTargetUrl = target.value.trim() || cfg.wpsTargetUrl || '';
            if (!wpsTargetUrl) throw new Error('请先填写并保存 WPS 文件夹/知识库目录链接。');
            const data = await embedImages(collect()); if (note.value.trim()) data.markdown += `\n\n## 剪存备注\n\n${note.value.trim()}`;
            const result = await native({ action: 'clip', targetUrl: wpsTargetUrl, ...data });
            if (!result.ok) throw new Error(formatNativeError(result));
            setStatus(`剪存成功：${result.link || 'WPS 已创建文档'}\n${result.message || ''}${result.folderLink ? `\n文件夹：${result.folderLink}` : ''}`, 'ok');
        } catch (error) { setStatus(error.message || String(error), 'error'); }
        finally { state.busy = false; }
    }
    async function runSummary() {
        if (state.busy) return; state.busy = true; setStatus('正在生成网页总结…');
        try {
            const data = collect(); const cfg = await cfgGet(['aiEndpoint','aiApiKey','aiModel']);
            if (!cfg.aiEndpoint || !cfg.aiApiKey || !cfg.aiModel) throw new Error('请先在公众号编辑器的 AI 配置中保存 Endpoint、模型和 API Key。');
            const response = await new Promise((resolve, reject) => chrome.runtime.sendMessage({ type: 'wh-ai-request', endpoint: cfg.aiEndpoint, init: { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.aiApiKey}` }, body: JSON.stringify({ model: cfg.aiModel, messages: [{ role: 'user', content: `请总结以下网页，给出要点、代码说明和可执行结论。\n\n${data.markdown.slice(0, 50000)}` }], temperature: 0.2 }) } }, r => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(r)));
            if (!response?.ok) throw new Error(`AI 请求失败（${response?.status || 0}）：${response?.text || response?.statusText || ''}`);
            const payload = JSON.parse(response.text); const text = payload.choices?.[0]?.message?.content || payload.output?.[0]?.content?.[0]?.text || 'AI 没有返回总结。';
            setStatus(text, 'ok');
        } catch (error) { setStatus(error.message || String(error), 'error'); }
        finally { state.busy = false; }
    }
    async function native(payload) {
        return new Promise((resolve, reject) => chrome.runtime.sendMessage({ type: 'wh-native-request', payload }, response => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve(response || {});
        }));
    }
    function formatNativeError(result) {
        if (result.code === 'NATIVE_PERMISSION_MISSING') return '当前扩展缺少本地组件权限，请重新加载最新版本。';
        if (result.code === 'NATIVE_UNAVAILABLE') return '本地剪存组件未安装或未注册。请点击“打开插件设置”，安装或修复组件后重试。';
        if (result.code === 'NOT_AUTHENTICATED') return 'WPS 尚未登录，请打开插件设置，在“WPS 剪存”中重新安装并完成登录。';
        return result.error || result.message || '本地剪存失败，请查看组件日志。';
    }
    chrome.runtime.onMessage.addListener(message => { if (message?.type === 'web-clip-trigger') open('clip'); if (message?.type === 'web-summary-trigger') open('summary'); });
    let previewTimer;
    const selectionObserver = new MutationObserver(() => { if (!state.open) return; clearTimeout(previewTimer); previewTimer = setTimeout(updatePreview, 300); });
    selectionObserver.observe(document.documentElement, { childList: true, subtree: true });
})();
