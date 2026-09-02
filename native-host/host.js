#!/usr/bin/env node
const { spawn } = require('child_process');
const { URL } = require('url');
const fs = require('fs');
const os = require('os');
const path = require('path');

const IDLE_MS = 5 * 60 * 1000;
const CLIP_FOLDER_NAME = '网页剪存';
const CLI_NAME = process.platform === 'win32' ? 'kdocs-cli.exe' : 'kdocs-cli';
const CLI_PATH = process.env.YUNZHONGSHU_KDOCS_CLI || path.join(os.homedir(), '.yunzhongshu', 'bin', CLI_NAME);
let idleTimer;
function armExit() { clearTimeout(idleTimer); idleTimer = setTimeout(() => process.exit(0), IDLE_MS); }
let input = Buffer.alloc(0); const queue = []; const waiters = [];
process.stdin.on('data', chunk => { input = Buffer.concat([input, chunk]); while (input.length >= 4) { const length = input.readUInt32LE(0); if (input.length < length + 4) break; const body = input.subarray(4, length + 4); input = input.subarray(length + 4); let value = null; try { value = JSON.parse(body.toString('utf8')); } catch {} const waiter = waiters.shift(); if (waiter) waiter(value); else queue.push(value); } });
function readMessage() { if (queue.length) return Promise.resolve(queue.shift()); return new Promise(resolve => waiters.push(resolve)); }
function send(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8'); const header = Buffer.alloc(4); header.writeUInt32LE(body.length, 0); process.stdout.write(Buffer.concat([header, body]));
}
function runCli(service, action, params, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yunzhongshu-')); const payload = path.join(dir, 'request.json');
    fs.writeFileSync(payload, JSON.stringify(params), { mode: 0o600 });
    const child = spawn(CLI_PATH, [service, action, '--file', payload, '--output', 'json', '--timeout', String(timeout)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('WPS CLI 请求超时')); }, timeout + 3000);
    const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
    child.on('error', error => { clearTimeout(timer); cleanup(); reject(error); });
    child.on('close', code => { clearTimeout(timer); cleanup(); if (code !== 0) return reject(new Error((stderr || stdout || `kdocs-cli 退出码 ${code}`).trim().slice(0, 500))); try { resolve(JSON.parse(stdout)); } catch { reject(new Error('WPS CLI 返回了无法解析的结果')); } });
  });
}
async function locateTarget(targetUrl) {
  let parsed; try { parsed = new URL(targetUrl); } catch { throw new Error('WPS 目标链接格式不正确'); }
  if (!/(^|\.)kdocs\.cn$/i.test(parsed.hostname)) throw new Error('目前只支持 kdocs.cn / WPS 云文档目录链接');
  const wikiMatch = parsed.pathname.match(/\/wiki\/l\/([^/?]+)/i);
  if (wikiMatch) return { kind: 'wiki', kuid: wikiMatch[1] };
  const info = await runCli('drive', 'get-file-info', { url: targetUrl });
  const data = info.data || {};
  const parentId = data.file_id || data.id;
  if (!data.drive_id || !parentId) throw new Error('无法从 WPS 链接解析目标目录，请填写可访问的文件夹链接');
  if (data.type && data.type !== 'folder') throw new Error('目标链接不是 WPS 文件夹');
  if (/source=kmwiki/i.test(parsed.search)) {
    if (data.kuid) return { kind: 'wiki', kuid: data.kuid };
    const root = await runCli('kwiki', 'list-items', { kuid: `0s_${data.drive_id}` });
    const found = (root.data?.list || []).find(item => item.file_id === parentId);
    if (found) return { kind: 'wiki', kuid: found.kuid };
    throw new Error('无法定位知识库文件夹，请填写知识库或其直接子文件夹链接');
  }
  return { drive_id: data.drive_id, parent_id: parentId };
}

async function ensureDriveClipFolder(target) {
  const list = async () => runCli('drive', 'list-files', {
    drive_id: target.drive_id,
    parent_id: target.parent_id,
    filter_type: 'folder',
    page_size: 500,
  });
  const find = result => (result.data?.items || []).find(item => item.type === 'folder' && item.name === CLIP_FOLDER_NAME);
  let found = find(await list());
  if (found) return { ...target, parent_id: found.id, folderName: CLIP_FOLDER_NAME, folderLink: found.link_url || '' };

  try {
    await runCli('drive', 'create-folder', {
      drive_id: target.drive_id,
      parent_id: target.parent_id,
      name: CLIP_FOLDER_NAME,
      on_name_conflict: 'fail',
    });
  } catch (error) {
    // Another clip may have created it between list and create; verify before failing.
    found = find(await list());
    if (!found) throw error;
  }
  found = find(await list());
  if (!found) throw new Error(`WPS 文件夹“${CLIP_FOLDER_NAME}”创建后无法验证`);
  return { ...target, parent_id: found.id, folderName: CLIP_FOLDER_NAME, folderLink: found.link_url || '' };
}

async function ensureWikiClipFolder(target) {
  const list = async () => runCli('kwiki', 'list-items', { kuid: target.kuid });
  const find = result => (result.data?.list || []).find(item => item.doc_type === 'folder' && item.title === CLIP_FOLDER_NAME);
  let found = find(await list());
  if (found) return { ...target, kuid: found.kuid, folderName: CLIP_FOLDER_NAME, folderLink: found.link_id ? `https://www.kdocs.cn/l/${found.link_id}` : '' };

  try {
    await runCli('kwiki', 'create-item', { doc_type: 'folder', kuid: target.kuid, title: CLIP_FOLDER_NAME });
  } catch (error) {
    found = find(await list());
    if (!found) throw error;
  }
  found = find(await list());
  if (!found) throw new Error(`WPS 知识库文件夹“${CLIP_FOLDER_NAME}”创建后无法验证`);
  return { ...target, kuid: found.kuid, folderName: CLIP_FOLDER_NAME, folderLink: found.link_id ? `https://www.kdocs.cn/l/${found.link_id}` : '' };
}

async function ensureClipFolder(target) {
  return target.kind === 'wiki' ? ensureWikiClipFolder(target) : ensureDriveClipFolder(target);
}
async function status() {
  return new Promise(resolve => {
    const child = spawn(CLI_PATH, ['auth', 'status'], { stdio: ['ignore', 'pipe', 'pipe'] }); let output = ''; let settled = false;
    child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
    child.on('error', error => { if (settled) return; settled = true; resolve({ ok: false, code: 'CLI_UNAVAILABLE', error: `找不到 WPS CLI：${CLI_PATH}\n${error.message}` }); });
    child.on('close', code => { if (settled) return; settled = true; resolve({ ok: true, authenticated: code === 0 && !/未登录|not authenticated|no token/i.test(output), message: '本地组件可用', detail: output.trim().slice(0, 500) }); });
  });
}
async function clip(payload) {
  if (!payload || payload.action !== 'clip') throw new Error('不支持的本地组件操作');
  if (typeof payload.markdown !== 'string' || !payload.markdown.trim()) throw new Error('没有采集到网页正文');
  const target = await ensureClipFolder(await locateTarget(payload.targetUrl));
  const safeTitle = String(payload.title || '网页剪存').replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 100) || '网页剪存';
  if (target.kind === 'wiki') {
    const created = await runCli('kwiki', 'create-item', { doc_type: 'o', kuid: target.kuid, title: safeTitle });
    const itemKuid = created.data?.kuid;
    if (!itemKuid) throw new Error(created.msg || '知识库文档创建失败');
    const listing = await runCli('kwiki', 'list-items', { kuid: target.kuid });
    const item = (listing.data?.list || []).find(entry => entry.kuid === itemKuid || entry.title === safeTitle);
    if (!item?.file_id) throw new Error('知识库文档已创建，但无法取得文档标识');
    const content = payload.markdown.replace(/^# [^\n]+\n*/, '').trim();
    await runCli('otl', 'insert-content', { file_id: item.file_id, title: safeTitle, content, format: 'markdown', mode: 'prepend' });
    const verify = await runCli('otl', 'block-query', { file_id: item.file_id, params: { blockIds: ['doc'] } });
    if (!(verify.data || verify)) throw new Error('知识库文档已创建，但回读验证失败');
    const url = created.data?.url ? `https://www.kdocs.cn${created.data.url}` : (item.link_id ? `https://www.kdocs.cn/l/${item.link_id}` : '');
    return { ok: true, link: url, folderLink: target.folderLink, message: `已创建并验证 WPS 知识库文档，位置：${CLIP_FOLDER_NAME}（${payload.images?.length || 0} 张图片）` };
  }
  const created = await runCli('drive', 'create-file-with-content', {
    drive_id: target.drive_id,
    parent_id: target.parent_id,
    name: `${safeTitle}.otl`,
    file_extension: 'otl',
    content: payload.markdown,
  });
  const file = created.data || {};
  if (!file.file_id && !file.id) throw new Error(created.msg || 'WPS 没有返回新文档标识');
  const fileId = file.file_id || file.id;
  const verify = await runCli('drive', 'get-file-info', { file_id: fileId });
  if (!(verify.data || verify).name) throw new Error('文档已创建，但回读验证失败');
  return { ok: true, link: file.link_url || file.url || '', folderLink: target.folderLink, message: `已创建并验证 WPS 文档，位置：${CLIP_FOLDER_NAME}（${payload.images?.length || 0} 张图片）` };
}
async function main() { armExit(); while (true) { const payload = await readMessage(); if (!payload) { send({ ok: false, code: 'INVALID_REQUEST', error: '请求格式无效' }); continue; } try { send(payload.action === 'status' ? await status() : await clip(payload)); } catch (error) { send({ ok: false, code: /auth|token|401|403|未登录/i.test(error.message) ? 'NOT_AUTHENTICATED' : 'CLIP_FAILED', error: error.message }); } armExit(); } }
main();
