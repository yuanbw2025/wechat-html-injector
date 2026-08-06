/* MV3 请求代理：只处理当前请求，不保存 API Key、文章或附件。 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'wh-ai-request') return false;
    const endpoint = String(message.endpoint || '');
    if (!/^https?:\/\//i.test(endpoint)) {
        sendResponse({ handled: true, ok: false, status: 0, statusText: 'Endpoint 必须使用 HTTP 或 HTTPS' });
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
