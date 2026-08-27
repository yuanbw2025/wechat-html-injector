const target = document.querySelector('#target');
const status = document.querySelector('#status');
const saveStatus = document.querySelector('#saveStatus');
document.querySelector('#downloadMac').addEventListener('click', () => window.YunzhongshuInstaller.downloadInstaller('mac').catch(error => { status.textContent = error.message; status.className = 'status error'; }));
document.querySelector('#downloadWindows').addEventListener('click', () => window.YunzhongshuInstaller.downloadInstaller('windows').catch(error => { status.textContent = error.message; status.className = 'status error'; }));
document.querySelector('#downloadLinux').addEventListener('click', () => window.YunzhongshuInstaller.downloadInstaller('linux').catch(error => { status.textContent = error.message; status.className = 'status error'; }));
chrome.storage.local.get(['wpsTargetUrl']).then(data => { target.value = data.wpsTargetUrl || ''; });
document.querySelector('#save').addEventListener('click', async () => { await chrome.storage.local.set({ wpsTargetUrl: target.value.trim() }); saveStatus.textContent = target.value.trim() ? '已保存到本机。' : '已清除。'; saveStatus.className = 'status ok'; });
document.querySelector('#test').addEventListener('click', () => {
  status.textContent = '检测中…'; status.className = 'status';
  chrome.runtime.sendMessage({ type: 'wh-native-request', payload: { action: 'status' } }, response => {
    if (chrome.runtime.lastError || !response?.ok) { status.textContent = '未检测到组件：请确认已安装并注册 Native Messaging host。'; status.className = 'status error'; return; }
    status.textContent = response.authenticated === false ? '组件已安装，但 WPS CLI 尚未登录。' : '组件和 WPS CLI 可用。'; status.className = response.authenticated === false ? 'status error' : 'status ok';
  });
});
