const $ = selector => document.querySelector(selector);
const extensionUrl = chrome.runtime.getURL('sinan.html');
const enabled = $('#enabled');
const status = $('#status');
const customStartUrl = $('#customStartUrl');
const customUrlStatus = $('#customUrlStatus');
$('#downloadMac').addEventListener('click', () => window.YunzhongshuInstaller.downloadInstaller('mac').then(() => { status.textContent = 'macOS 安装包已下载，请双击 ZIP 解压后运行安装文件。'; status.className = 'status ok'; }).catch(error => { status.textContent = error.message; status.className = 'status error'; }));
$('#downloadWindows').addEventListener('click', () => window.YunzhongshuInstaller.downloadInstaller('windows').then(() => { status.textContent = 'Windows 安装器已下载，请右键用 PowerShell 运行。'; status.className = 'status ok'; }).catch(error => { status.textContent = error.message; status.className = 'status error'; }));
$('#downloadLinux').addEventListener('click', () => window.YunzhongshuInstaller.downloadInstaller('linux').then(() => { status.textContent = 'Linux 安装器已下载，请运行脚本。'; status.className = 'status ok'; }).catch(error => { status.textContent = error.message; status.className = 'status error'; }));
function validStartUrl(value) {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch { return false; }
}
function renderStartUrl(customUrl = '') {
  const effectiveUrl = customUrl || extensionUrl;
  $('#newtabUrl').textContent = effectiveUrl;
  $('#openPage').textContent = customUrl ? '打开自定义地址' : '打开司南';
}
chrome.storage.local.get({ sinanEnabled: true, customStartUrl: '' }).then(config => {
  enabled.checked = config.sinanEnabled !== false;
  customStartUrl.value = config.customStartUrl || '';
  renderStartUrl(customStartUrl.value.trim());
});
enabled.addEventListener('change', async () => {
  await chrome.storage.local.set({ sinanEnabled: enabled.checked });
  status.textContent = enabled.checked ? '司南首页已启用。' : '司南首页已关闭；新建标签页会显示关闭提示。';
  status.className = `status ${enabled.checked ? 'ok' : 'warn'}`;
});
$('#saveCustomUrl').addEventListener('click', async () => {
  const value = customStartUrl.value.trim();
  if (!validStartUrl(value)) {
    customUrlStatus.textContent = '请输入完整的 http:// 或 https:// 地址。';
    customUrlStatus.className = 'status warn';
    return;
  }
  await chrome.storage.local.set({ customStartUrl: value });
  renderStartUrl(value);
  customUrlStatus.textContent = value ? '自定义地址已保存，新建标签页下次打开时生效。' : '已恢复使用司南默认地址。';
  customUrlStatus.className = 'status ok';
});
$('#copyUrl').addEventListener('click', async () => { await navigator.clipboard.writeText($('#newtabUrl').textContent); status.textContent = '当前地址已复制。'; status.className = 'status ok'; });
$('#openPage').addEventListener('click', () => chrome.tabs.create({ url: $('#newtabUrl').textContent }));
$('#openOnboarding').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') }));
$('#openChromeSettings').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://settings/onStartup' }));
$('#openEdgeSettings').addEventListener('click', () => chrome.tabs.create({ url: 'edge://settings/startHomeNTP' }));
