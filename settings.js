const $ = selector => document.querySelector(selector);
const extensionUrl = chrome.runtime.getURL('sinan.html');
const enabled = $('#enabled');
const status = $('#status');
const customStartUrl = $('#customStartUrl');
const customUrlStatus = $('#customUrlStatus');
const aiProvider = $('#aiProvider');
const aiEndpoint = $('#aiEndpoint');
const aiModel = $('#aiModel');
const aiApiKey = $('#aiApiKey');
const aiStatus = $('#aiStatus');
const aiPresets = {
  openai: { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4.1-mini' },
  doubao: { endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', model: '' },
  agnes: { endpoint: 'https://apihub.agnes-ai.com/v1/chat/completions', model: 'agnes-2.5-flash' },
  custom: { endpoint: '', model: '' },
};
$('#downloadMac').addEventListener('click', () => window.YunzhongshuInstaller.downloadInstaller('mac').then(() => { status.textContent = 'macOS 安装包已下载，请双击 .pkg 文件安装。'; status.className = 'status ok'; }).catch(error => { status.textContent = error.message; status.className = 'status error'; }));
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
async function deriveAiKeyCryptoKey() {
  const material = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(chrome.runtime.id));
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function encryptAiApiKey(plainText) {
  if (!plainText) return '';
  const key = await deriveAiKeyCryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plainText));
  return { iv: Array.from(iv), data: Array.from(new Uint8Array(cipher)) };
}
async function decryptAiApiKey(payload) {
  if (!payload || typeof payload !== 'object') return payload || '';
  try {
    const key = await deriveAiKeyCryptoKey();
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(payload.iv) }, key, new Uint8Array(payload.data));
    return new TextDecoder().decode(plain);
  } catch { return ''; }
}
chrome.storage.local.get({ aiProvider: 'openai', aiEndpoint: '', aiModel: '', aiApiKey: '' }).then(async config => {
  aiProvider.value = config.aiProvider || 'openai';
  aiEndpoint.value = config.aiEndpoint || aiPresets[aiProvider.value].endpoint;
  aiModel.value = config.aiModel || aiPresets[aiProvider.value].model;
  aiApiKey.value = await decryptAiApiKey(config.aiApiKey);
});
aiProvider.addEventListener('change', () => {
  const preset = aiPresets[aiProvider.value];
  if (!aiEndpoint.value.trim() || Object.values(aiPresets).some(item => item.endpoint === aiEndpoint.value.trim())) aiEndpoint.value = preset.endpoint;
  if (!aiModel.value.trim() || Object.values(aiPresets).some(item => item.model && item.model === aiModel.value.trim())) aiModel.value = preset.model;
});
$('#saveAi').addEventListener('click', async () => {
  const endpoint = aiEndpoint.value.trim();
  const model = aiModel.value.trim();
  const apiKey = aiApiKey.value.trim();
  if (!/^https?:\/\//i.test(endpoint) || !model || !apiKey) { aiStatus.textContent = '请填写完整的 Endpoint、模型和 API Key。'; aiStatus.className = 'status warn'; return; }
  await chrome.storage.local.set({ aiProvider: aiProvider.value, aiEndpoint: endpoint, aiModel: model, aiApiKey: await encryptAiApiKey(apiKey) });
  aiStatus.textContent = 'API 配置已保存到本机，网页总结可以使用。'; aiStatus.className = 'status ok';
});
$('#testAi').addEventListener('click', async () => {
  const endpoint = aiEndpoint.value.trim(); const model = aiModel.value.trim(); const apiKey = aiApiKey.value.trim();
  if (!/^https?:\/\//i.test(endpoint) || !model || !apiKey) { aiStatus.textContent = '请先填写完整的 Endpoint、模型和 API Key。'; aiStatus.className = 'status warn'; return; }
  aiStatus.textContent = '测试连接中…'; aiStatus.className = 'status';
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, messages: [{ role: 'user', content: '只回复 OK' }], max_tokens: 8, temperature: 0 }) });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 240)}`);
    aiStatus.textContent = 'API 连接成功。'; aiStatus.className = 'status ok';
  } catch (error) { aiStatus.textContent = `API 连接失败：${error.message || error}`; aiStatus.className = 'status warn'; }
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
$('#openExtensions').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/' }));
async function copyAddressAndOpenSettings(url) {
  await navigator.clipboard.writeText($('#newtabUrl').textContent);
  status.textContent = '当前地址已复制，请在打开的主页设置中粘贴。'; status.className = 'status ok';
  chrome.tabs.create({ url });
}
$('#openChromeHomeSettings').addEventListener('click', () => copyAddressAndOpenSettings('chrome://settings/appearance'));
$('#openChromeSettings').addEventListener('click', () => copyAddressAndOpenSettings('chrome://settings/onStartup'));
$('#openEdgeSettings').addEventListener('click', () => copyAddressAndOpenSettings('edge://settings/startHomeNTP'));
