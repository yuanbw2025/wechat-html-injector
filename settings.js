const $ = selector => document.querySelector(selector);
const extensionUrl = chrome.runtime.getURL('sinan.html');
const enabled = $('#enabled');
const status = $('#status');
$('#downloadMac').addEventListener('click', () => window.YunzhongshuInstaller.downloadInstaller('mac').then(() => { status.textContent = 'macOS 安装器已下载，请双击运行。'; status.className = 'status ok'; }).catch(error => { status.textContent = error.message; status.className = 'status error'; }));
$('#downloadWindows').addEventListener('click', () => window.YunzhongshuInstaller.downloadInstaller('windows').then(() => { status.textContent = 'Windows 安装器已下载，请右键用 PowerShell 运行。'; status.className = 'status ok'; }).catch(error => { status.textContent = error.message; status.className = 'status error'; }));
$('#downloadLinux').addEventListener('click', () => window.YunzhongshuInstaller.downloadInstaller('linux').then(() => { status.textContent = 'Linux 安装器已下载，请运行脚本。'; status.className = 'status ok'; }).catch(error => { status.textContent = error.message; status.className = 'status error'; }));
$('#newtabUrl').textContent = extensionUrl;
chrome.storage.local.get({ sinanEnabled: true }).then(config => { enabled.checked = config.sinanEnabled !== false; });
enabled.addEventListener('change', async () => {
  await chrome.storage.local.set({ sinanEnabled: enabled.checked });
  status.textContent = enabled.checked ? '司南首页已启用。' : '司南首页已关闭；新建标签页会显示关闭提示。';
  status.className = `status ${enabled.checked ? 'ok' : 'warn'}`;
});
$('#copyUrl').addEventListener('click', async () => { await navigator.clipboard.writeText(extensionUrl); status.textContent = '本地地址已复制。'; status.className = 'status ok'; });
$('#openPage').addEventListener('click', () => chrome.tabs.create({ url: extensionUrl }));
$('#openOnboarding').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') }));
$('#openChromeSettings').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://settings/onStartup' }));
$('#openEdgeSettings').addEventListener('click', () => chrome.tabs.create({ url: 'edge://settings/startHomeNTP' }));
