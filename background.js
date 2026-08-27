/* MV3 请求代理：只处理当前请求，不保存 API Key、文章或附件。 */
const NATIVE_HOST = 'com.yunzhongshu.clipbridge';

chrome.runtime.onInstalled.addListener(details => {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({ id: 'web-clip', title: '云中书：剪存当前网页到 WPS', contexts: ['page', 'selection', 'image'] });
        chrome.contextMenus.create({ id: 'web-summary', title: '云中书：总结当前网页', contexts: ['page', 'selection'] });
    });
    if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'open-onboarding') {
        chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
        sendResponse({ ok: true });
        return false;
    }
    if (!message || message.type !== 'wh-fetch-image') return false;
    const url = String(message.url || '');
    if (!/^https?:\/\//i.test(url)) { sendResponse({ ok: false, error: '图片地址无效' }); return false; }
    fetch(url).then(async response => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const blob = await response.blob();
        if (blob.size > 8 * 1024 * 1024) throw new Error('单张图片超过 8 MB');
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        sendResponse({ ok: true, dataUrl: `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}` });
    }).catch(error => sendResponse({ ok: false, error: error.message || '图片下载失败' }));
    return true;
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;
    const type = info.menuItemId === 'web-summary' ? 'web-summary-trigger' : 'web-clip-trigger';
    chrome.tabs.sendMessage(tab.id, { type }).catch(() => {});
});

chrome.commands.onCommand.addListener((command, tab) => {
    if (!tab?.id) return;
    const type = command === 'webSummary' ? 'web-summary-trigger' : 'web-clip-trigger';
    chrome.tabs.sendMessage(tab.id, { type }).catch(() => {});
});

// 仅允许向已知的 AI 服务商域名发起代理请求，避免恶意网页诱导扩展把 API Key/正文外泄到攻击者服务器。
const ALLOWED_AI_HOSTS = ['api.openai.com', 'ark.cn-beijing.volces.com', 'apihub.agnes-ai.com'];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'wh-ai-request') return false;
    const endpoint = String(message.endpoint || '');
    let endpointUrl;
    try { endpointUrl = new URL(endpoint); } catch { endpointUrl = null; }
    const hostAllowed = !!endpointUrl && /^https?:$/i.test(endpointUrl.protocol) && ALLOWED_AI_HOSTS.includes(endpointUrl.hostname.toLowerCase());
    if (!hostAllowed) {
        sendResponse({ handled: true, ok: false, status: 0, statusText: 'Endpoint 未在允许的服务商域名列表中' });
        return false;
    }
    const init = message.init && typeof message.init === 'object' ? message.init : {};
    fetch(endpoint, init).then(async response => {
        sendResponse({
            handled: true,
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            text: await response.text(),
        });
    }).catch(error => {
        sendResponse({ handled: true, ok: false, status: 0, statusText: error.message || '网络请求失败' });
    });
    return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'wh-native-request') return false;
    chrome.runtime.sendNativeMessage(NATIVE_HOST, message.payload || {}, response => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
            sendResponse({ ok: false, code: 'NATIVE_UNAVAILABLE', error: runtimeError.message });
            return;
        }
        sendResponse(response || { ok: false, code: 'EMPTY_RESPONSE', error: '本地组件没有返回结果' });
    });
    return true;
});
