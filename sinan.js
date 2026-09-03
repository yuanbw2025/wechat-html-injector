(function () {
  'use strict';
  const engines = [
    { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=' },
    { id: 'baidu', name: '百度', url: 'https://www.baidu.com/s?wd=' },
    { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=' },
    { id: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai/search?q=' },
    { id: 'github', name: 'GitHub', url: 'https://github.com/search?q=' },
    { id: 'bilibili', name: 'Bilibili', url: 'https://search.bilibili.com/all?keyword=' },
    { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com/results?search_query=' },
    { id: 'zhihu', name: '知乎', url: 'https://www.zhihu.com/search?type=content&q=' },
  ];
  const projects = [
    { name: '云中书 YunType', cat: '项目', url: 'https://yuanbw.vercel.app/yuntype/', icon: '云', desc: 'AI 排版工具，支持公众号富文本、小红书图片组和多种内容样式组合。', tags: '排版 公众号 图文' },
    { name: '故事熔炉 StoryForge', cat: '项目', url: 'https://yuanbw.vercel.app/storyforge/', icon: '故', desc: 'AI 小说创作工坊，覆盖世界观、大纲、章节、角色和素材导入。', tags: '小说 写作 创作' },
    { name: 'InfiniteSkill', cat: '项目', url: 'https://yuanbw.vercel.app/infiniteskill/', icon: '技', desc: '将专业书籍和文档编译为大模型可调用的结构化 Skill 技能包。', tags: '文档 skill 知识' },
    { name: 'AI 视觉场景库', cat: '项目', url: 'https://yuanbw.vercel.app/awesome-gpt-image-2/', icon: '图', desc: '中文 AI 生图案例、场景槽位、Prompt 生成器和废图诊断指南。', tags: '生图 prompt 案例 模板' },
    { name: 'AI 视觉探索书', cat: '项目', url: 'https://github.com/yuanbw2025/ai-visual-exploration-book', icon: '视', desc: '图片即 UI，点击区域生成下一层知识页面，并导出可交互单 HTML。', tags: '学习 页面 视觉' },
    { name: '项目推广视频生成器', cat: '项目', url: 'https://github.com/yuanbw2025/promo-video-maker', icon: '影', desc: '用截图和文稿生成配音、字幕和 MP4，面向项目推广视频。', tags: '视频 推广 配音' },
    { name: '飞剑弹珠', cat: '项目', url: 'https://yuanbw.vercel.app/game.html', icon: '剑', desc: '纯 Canvas HTML5 弹珠小游戏，打开即玩。', tags: '游戏 canvas' },
    { name: '赛博飞剑', cat: '项目', url: 'https://yuanbw.vercel.app/cyber-flying-sword/', icon: '锋', desc: '摄像头手势操控飞剑鞭子的 3D 动作游戏。', tags: '游戏 3D 手势' },
    { name: 'AI 演示稿生成器', cat: '项目', url: 'https://yuanbw.vercel.app/ai-presentation/', icon: '演', desc: '一句话描述主题，快速生成可放映的交互式演示稿。', tags: '演示 页面 AI' },
  ];
  const tools = Array.isArray(window.AI_TOOLS) ? window.AI_TOOLS : [];
  const state = { engine: localStorage.getItem('sinan-engine') || 'google', cat: '全部', q: '' };
  const engineRow = document.getElementById('engineRow');
  const webSearch = document.getElementById('webSearch');
  const localSearch = document.getElementById('localSearch');
  const catList = document.getElementById('catList');
  const toolGrid = document.getElementById('toolGrid');
  const empty = document.getElementById('empty');
  const summary = document.getElementById('summary');
  function textOf(tool) { return [tool.name, tool.cat, tool.desc, tool.tags].join(' ').toLowerCase(); }
  function cats() { return ['全部', ...Array.from(new Set(tools.map(tool => tool.cat)))]; }
  function renderEngines() {
    engineRow.innerHTML = engines.map(engine => `<button type="button" class="engine ${state.engine === engine.id ? 'on' : ''}" data-id="${engine.id}">${engine.name}</button>`).join('');
    engineRow.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
      state.engine = button.dataset.id; localStorage.setItem('sinan-engine', state.engine); renderEngines(); webSearch.focus();
    }));
  }
  function renderCats() {
    catList.innerHTML = cats().map(cat => {
      const count = cat === '全部' ? tools.length : tools.filter(tool => tool.cat === cat).length;
      return `<button class="cat ${state.cat === cat ? 'on' : ''}" data-cat="${cat}"><span>${cat}</span><span>${count}</span></button>`;
    }).join('');
    catList.querySelectorAll('button').forEach(button => button.addEventListener('click', () => { state.cat = button.dataset.cat; renderCats(); renderTools(); }));
  }
  function filtered() {
    const query = state.q.trim().toLowerCase();
    return tools.filter(tool => (state.cat === '全部' || tool.cat === state.cat) && (!query || textOf(tool).includes(query)));
  }
  function card(tool) {
    return `<a class="card" href="${tool.url}" target="_blank" rel="noreferrer"><div class="card-top"><div class="ico">${tool.icon}</div><h3>${tool.name}</h3></div><p>${tool.desc}</p><div class="meta"><span class="label">${tool.cat}</span><span class="open">打开 →</span></div></a>`;
  }
  function renderTools() {
    const list = filtered(); toolGrid.innerHTML = list.map(card).join(''); empty.style.display = list.length ? 'none' : 'block'; summary.textContent = `${state.cat} · ${list.length} 个匹配`;
  }
  function renderQuick() {
    const names = ['ChatGPT', 'Claude', 'DeepSeek', '豆包', 'Kimi', '通义千问', '智谱清言', 'MiniMax / 海螺 AI'];
    document.getElementById('quickTools').innerHTML = names.map(name => tools.find(tool => tool.name === name)).filter(Boolean).map(card => `<a href="${card.url}" target="_blank" rel="noreferrer"><span class="q-ico">${card.icon}</span><b>${card.name}</b></a>`).join('');
  }
  function renderProjects() { document.getElementById('projectGrid').innerHTML = projects.map(card).join(''); }
  function syncQuery(value) { state.q = value; localSearch.value = value; renderTools(); }
  webSearch.addEventListener('input', event => syncQuery(event.target.value));
  localSearch.addEventListener('input', event => { state.q = event.target.value; webSearch.value = event.target.value; renderTools(); });
  document.getElementById('searchForm').addEventListener('submit', event => {
    event.preventDefault(); const query = webSearch.value.trim(); if (!query) { webSearch.focus(); return; }
    const engine = engines.find(item => item.id === state.engine) || engines[0]; window.location.href = engine.url + encodeURIComponent(query);
  });
  function renderDisabledState() {
    document.body.innerHTML = '<main style="max-width:720px;margin:18vh auto;padding:32px 24px;text-align:center;background:rgba(255,250,240,.9);border:1px solid rgba(43,30,16,.1);border-radius:18px"><h1 style="color:#6b3410;margin-bottom:12px">司南首页已关闭</h1><p style="color:#6a5a40;line-height:1.8">你可以在插件设置中重新启用司南，或在浏览器扩展管理页停用本扩展以恢复浏览器默认新建标签页。</p><a href="settings.html" style="display:inline-block;margin-top:18px;padding:10px 18px;border-radius:8px;background:#6b3410;color:#fff">打开插件设置</a></main>';
  }
  function init() {
    const storage = typeof chrome !== 'undefined' ? chrome.storage?.local : null;
    const render = () => { renderEngines(); renderCats(); renderQuick(); renderProjects(); renderTools(); };
    if (!storage) { render(); return; }
    storage.get({ sinanEnabled: true, customStartUrl: '' }).then(config => {
      const customUrl = String(config.customStartUrl || '').trim();
      if (customUrl && /^https?:\/\//i.test(customUrl) && customUrl !== location.href) { location.replace(customUrl); return; }
      if (config.sinanEnabled === false) { renderDisabledState(); return; }
      render();
    });
  }
  init();
})();
