const status = document.querySelector('#status');

async function sendToActiveTab(type) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('找不到当前网页');
    await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id, { type }, () => {
            const error = chrome.runtime.lastError;
            if (error) reject(new Error('当前页面暂不支持网页剪存，请切换到普通网页后重试。'));
            else resolve();
        });
    });
}

document.querySelectorAll('[data-message]').forEach(button => {
    button.addEventListener('click', async () => {
        button.disabled = true;
        try {
            await sendToActiveTab(button.dataset.message);
            window.close();
        } catch (error) {
            status.textContent = error.message || String(error);
            button.disabled = false;
        }
    });
});

document.querySelector('#settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
document.querySelector('#library').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.create({ url: chrome.runtime.getURL(`library.html${tab?.id ? `?targetTab=${tab.id}` : ''}`) });
    window.close();
});
