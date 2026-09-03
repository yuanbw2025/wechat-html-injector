const $ = selector => document.querySelector(selector);
const extensionApi = typeof chrome !== 'undefined' ? chrome : {};
const runtimeApi = extensionApi.runtime || {};
const storageApi = extensionApi.storage?.local || { get: async defaults => defaults, set: async () => {}, remove: async () => {} };
const tabsApi = extensionApi.tabs || { create: () => {} };
const extensionUrl = runtimeApi.getURL ? runtimeApi.getURL('sinan.html') : 'sinan.html';
const aiPresets = {
  openai: { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4.1-mini' },
  doubao: { endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', model: '' },
  agnes: { endpoint: 'https://apihub.agnes-ai.com/v1/chat/completions', model: 'agnes-2.5-flash' },
  custom: { endpoint: '', model: '' },
};

function setStatus(element, text, kind = '') {
  element.textContent = text;
  element.className = `status ${kind}`;
}
function validWebUrl(value) {
  if (!value) return true;
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}
function showTab(name) {
  document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === name));
  document.querySelectorAll('.pane').forEach(pane => pane.classList.toggle('active', pane.dataset.pane === name));
  if (name === 'wps') detectNative();
}
document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => showTab(tab.dataset.tab)));

const enabled = $('#enabled');
const customStartUrl = $('#customStartUrl');
const customUrlStatus = $('#customUrlStatus');
const customHomeUrl = $('#customHomeUrl');
const homeStatus = $('#homeStatus');
function renderNewTabUrl(value = '') { $('#newtabUrl').textContent = value || extensionUrl; }
function renderHomeUrl(value = '') { $('#homeUrl').textContent = value || extensionUrl; }
storageApi.get({ sinanEnabled: true, customStartUrl: '', customHomeUrl: '' }).then(config => {
  enabled.checked = config.sinanEnabled !== false;
  customStartUrl.value = config.customStartUrl || '';
  customHomeUrl.value = config.customHomeUrl || '';
  renderNewTabUrl(customStartUrl.value.trim());
  renderHomeUrl(customHomeUrl.value.trim());
});
enabled.addEventListener('change', async () => {
  await storageApi.set({ sinanEnabled: enabled.checked });
  setStatus(customUrlStatus, enabled.checked ? '司南新标签页已启用。' : '司南新标签页已关闭。', enabled.checked ? 'ok' : 'error');
});
$('#saveCustomUrl').addEventListener('click', async () => {
  const value = customStartUrl.value.trim();
  if (!validWebUrl(value)) { setStatus(customUrlStatus, '请输入完整的 http:// 或 https:// 地址。', 'error'); return; }
  await storageApi.set({ customStartUrl: value }); renderNewTabUrl(value);
  setStatus(customUrlStatus, value ? '自定义新标签页地址已保存。' : '已恢复司南新标签页。', 'ok');
});
$('#resetCustomUrl').addEventListener('click', async () => {
  customStartUrl.value = ''; await storageApi.remove('customStartUrl'); renderNewTabUrl('');
  setStatus(customUrlStatus, '已恢复司南新标签页。', 'ok');
});
$('#openPage').addEventListener('click', () => tabsApi.create({ url: $('#newtabUrl').textContent }));
$('#saveHomeUrl').addEventListener('click', async () => {
  const value = customHomeUrl.value.trim();
  if (!validWebUrl(value)) { setStatus(homeStatus, '请输入完整的 http:// 或 https:// 地址。', 'error'); return; }
  await storageApi.set({ customHomeUrl: value }); renderHomeUrl(value);
  setStatus(homeStatus, value ? '主页地址已保存。请点击下面的浏览器设置按钮确认。' : '主页地址已恢复为司南。', 'ok');
});
$('#openHomePage').addEventListener('click', () => tabsApi.create({ url: $('#homeUrl').textContent }));
async function configureHome(settingsUrl) {
  await navigator.clipboard.writeText($('#homeUrl').textContent);
  setStatus(homeStatus, '主页地址已复制，请在打开的浏览器设置页粘贴确认。', 'ok');
  tabsApi.create({ url: settingsUrl });
}
$('#setChromeHome').addEventListener('click', () => configureHome('chrome://settings/appearance'));
$('#setEdgeHome').addEventListener('click', () => configureHome('edge://settings/startHomeNTP'));
$('#openExtensions').addEventListener('click', () => tabsApi.create({ url: 'chrome://extensions/' }));

const wpsStatus = $('#wpsStatus');
const wpsTargetStatus = $('#wpsTargetStatus');
const wpsTargetUrl = $('#wpsTargetUrl');
$('#downloadMac').addEventListener('click', () => window.YunzhongshuInstaller.downloadInstaller('mac').then(() => setStatus(wpsStatus, 'macOS 安装包已下载。安装后回到这里点击“检测组件”。', 'ok')).catch(error => setStatus(wpsStatus, error.message, 'error')));
$('#downloadWindows').addEventListener('click', () => window.YunzhongshuInstaller.downloadInstaller('windows').then(() => setStatus(wpsStatus, 'Windows 安装器已下载。运行后回到这里检测。', 'ok')).catch(error => setStatus(wpsStatus, error.message, 'error')));
$('#downloadLinux').addEventListener('click', () => window.YunzhongshuInstaller.downloadInstaller('linux').then(() => setStatus(wpsStatus, 'Linux 安装器已下载。运行后回到这里检测。', 'ok')).catch(error => setStatus(wpsStatus, error.message, 'error')));
storageApi.get({ wpsTargetUrl: '' }).then(config => { wpsTargetUrl.value = config.wpsTargetUrl || ''; });
$('#saveWpsTarget').addEventListener('click', async () => {
  const value = wpsTargetUrl.value.trim(); await storageApi.set({ wpsTargetUrl: value });
  setStatus(wpsTargetStatus, value ? 'WPS 目标目录已保存。' : 'WPS 目标目录已清除。', 'ok');
});
function detectNative() {
  setStatus(wpsStatus, '正在检测组件…');
  if (!runtimeApi.sendMessage) { setStatus(wpsStatus, '组件检测仅在扩展中运行。'); return; }
  runtimeApi.sendMessage({ type: 'wh-native-request', payload: { action: 'status' } }, response => {
    const error = runtimeApi.lastError?.message || response?.error;
    if (error || !response?.ok) { setStatus(wpsStatus, `组件不可用：${error || '没有收到本地组件响应'}\n请覆盖安装最新组件后重试。`, 'error'); return; }
    if (response.authenticated === false) { setStatus(wpsStatus, '组件已安装，但 WPS 尚未登录。请重新运行安装器完成登录。', 'error'); return; }
    setStatus(wpsStatus, '组件和 WPS CLI 均可用。', 'ok');
  });
}
$('#testNative').addEventListener('click', detectNative);

const aiProvider = $('#aiProvider');
const aiEndpoint = $('#aiEndpoint');
const aiModel = $('#aiModel');
const aiApiKey = $('#aiApiKey');
const aiStatus = $('#aiStatus');
storageApi.get({ aiProvider: 'openai', aiEndpoint: '', aiModel: '', aiApiKey: '' }).then(config => {
  aiProvider.value = config.aiProvider || 'openai'; const preset = aiPresets[aiProvider.value];
  aiEndpoint.value = config.aiEndpoint || preset.endpoint; aiModel.value = config.aiModel || preset.model; aiApiKey.value = config.aiApiKey || '';
});
aiProvider.addEventListener('change', () => { const preset = aiPresets[aiProvider.value]; aiEndpoint.value = preset.endpoint; aiModel.value = preset.model; });
function readAi() { return { aiProvider: aiProvider.value, aiEndpoint: aiEndpoint.value.trim(), aiModel: aiModel.value.trim(), aiApiKey: aiApiKey.value.trim() }; }
function validateAi(config) { return /^https?:\/\//i.test(config.aiEndpoint) && config.aiModel && config.aiApiKey; }
$('#saveAi').addEventListener('click', async () => {
  const config = readAi(); if (!validateAi(config)) { setStatus(aiStatus, '请填写完整的 Endpoint、模型和 API Key。', 'error'); return; }
  await storageApi.set(config); setStatus(aiStatus, 'API 配置已保存，网页总结可以使用。', 'ok');
});
$('#testAi').addEventListener('click', async () => {
  const config = readAi(); if (!validateAi(config)) { setStatus(aiStatus, '请先填写完整配置。', 'error'); return; }
  setStatus(aiStatus, '正在测试连接…');
  if (!runtimeApi.sendMessage) { setStatus(aiStatus, 'API 测试仅在扩展中运行。'); return; }
  runtimeApi.sendMessage({ type: 'wh-ai-request', endpoint: config.aiEndpoint, init: { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.aiApiKey}` }, body: JSON.stringify({ model: config.aiModel, messages: [{ role: 'user', content: '只回复 OK' }], max_tokens: 8, temperature: 0 }) } }, async response => {
    if (runtimeApi.lastError || !response?.ok) { setStatus(aiStatus, `API 连接失败：${response?.status || 0} ${response?.text || response?.statusText || runtimeApi.lastError?.message || ''}`, 'error'); return; }
    await storageApi.set(config); setStatus(aiStatus, 'API 连接成功，配置已保存。', 'ok');
  });
});
