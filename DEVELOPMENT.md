# 开发指南

## 仓库角色

本仓库（`yuanbw2025/wechat-html-injector`）是 **开发正本**，所有日常开发、功能迭代、bug 修复都在此仓库进行。

## 架构关系

```
本仓库（开发正本）  ──subtree pull──>  my-website（集成部署库）──> Vercel 部署
```

- **本仓库**：日常开发，接受 PR，独立 git 历史
- **my-website**：集成部署库，通过 `git subtree pull` 拉取本仓库代码，统一构建部署到 Vercel
- **Vercel**：自动部署，线上地址 `https://yuanbw.vercel.app/wechat-plugin/`

## 开发流程

### 日常开发

```bash
cd ~/Desktop/projects/wechat-html-injector
git checkout -b feat/xxx
# ... 开发 ...
git add . && git commit -m "feat: xxx"
git push origin feat/xxx
# 在 GitHub 上创建 PR 并合并，或本地 merge 到 main
```

### 同步到主库（部署）

开发完成后，需要到主库执行同步：

```bash
cd ~/Desktop/projects/my-website
bash sync.sh wechat-plugin
git push origin main    # 触发 Vercel 自动部署
```

## 一键排版引擎（engine.js）

v4.2 起，插件内置「一键排版」，复用 **云中书 yuntype** 的纯 TS 排版引擎（15 蓝图 × 11 配色 × 3 字体）。

- `engine/entry.ts` —— 打包入口，从 `../yuntype/src/lib` 引入公众号渲染链，挂到 `window.YunType`
- `engine.js` —— esbuild 打成的 IIFE 产物（**已提交仓库**），manifest 在 `content.js` 前加载它
- `content.js` 通过 `window.YunType` 调用 `renderWechatV2 / getStyleComboV2 / recommendPresets` 等

**重新构建引擎**（仅当云中书引擎更新时需要；需同级存在 `../yuntype`）：

```bash
cd ~/Desktop/projects/wechat-html-injector
./build-engine.sh        # 生成 engine.js
```

> `content.js`（手写 UI/逻辑）**不需要构建**，照常直接改。只有 `engine.js` 是构建产物。
> 部署到主库无需构建——`engine.js` 已提交，subtree 同步即带上。

## 云中书原生样式库（v4.5）

工具栏「☁️ 云中书」按钮在公众号页面左侧滑出**纯原生 DOM** 的样式库（仿壹伴，**不用 iframe**，故不受公众号页面 CSP 限制）：

- 数据来自打包好的 `engine.js`（`window.YunType`）：15 套蓝图卡片 + 11 配色 + 3 字体 + 🎲换一版 / 🤖智能推荐 / ↩️还原。
- 点任意蓝图/配色/字体 → 调 `applyLayout()` 把当前**原生正文**（`htmlToMarkdown` 取草稿）经 `renderWechatV2` 整篇排版后写回原生编辑器，编辑区始终是公众号自己的编辑器。
- 选中态用 `markGalleryActive()` 高亮；换版复用 `state.layoutRaw` 原始草稿，避免越套越烂；`↩️还原` 退回纯文本。

> 之前 v4.4 试过"iframe 内嵌整个云中书应用"，因公众号页面 CSP 可能禁止跨源 iframe 而**放弃**——壹伴能嵌是因为它走扩展原生 DOM，不是外部 iframe。故 v4.5 改为原生 DOM。
> 云中书 `yuntype` 仓库里残留的 `?embed=1` 桥接（`App.tsx` / `FloatingActionBar.tsx`）已无用，可保留也可清理。

## 原生编辑区同步（v4.7）

v4.7 起，公众号编辑器 `.ProseMirror` 是唯一内容真源：

- `MutationObserver` 监听原生编辑区的 `childList/subtree/attributes/characterData`，用户直接在公众号里改正文、格式或粘贴图片后，源码面板会读取最新 `editor.innerHTML`。
- 插件主动写回时使用 `state.applying` 避免把自己的写入误判成用户编辑；源码框被程序同步时使用 `state.syncingCode` 避免触发草稿脏状态。
- 顶部工具栏按钮和左侧面板共用 `applyWhole/readFromArticle/applyLayout/renderImageLibrary`，不要为新按钮另写一套 DOM 写入逻辑。
- 图片不走微信上传接口逆向。可靠路径是：用户先用公众号原生能力上传/粘贴图片，插件扫描编辑区里的最终 `<img>` URL，再在 HTML 中引用。

## 本地目录结构

所有项目统一存放在 `~/Desktop/projects/` 下：

```
~/Desktop/projects/
├── my-website/                    ← 集成部署库（Vercel 入口）
├── storyforge/                    ← 故事熔炉
├── yuntype/                       ← 云中书
├── cyber-flying-sword/            ← 赛博飞剑
├── novel-game/                    ← 小说交互游戏
├── ai-slides/                     ← AI 演示文稿
├── ai-presentation/               ← AI 演示稿
├── Infinite_SpatioTemporal_Map/   ← 无限时空图
├── flying-sword-pinball/          ← 飞剑弹珠
├── wechat-html-injector/          ← 微信 HTML 注入器
└── freellmapizh/                  ← 免费 LLM API 中文文档
```

## 重要规则

| 规则 | 说明 |
|------|------|
| ✅ 在本仓库开发 | 所有功能和修复都在这里提交 |
| ✅ 可接受外部 PR | 合并后同步到主库即可 |
| ❌ 不要在 my-website 里直接改本项目代码 | 会导致 subtree pull 冲突 |

> **架构变更记录**：2026-05-26 之前采用"主库开发 → 镜像推送"模式。现已改为"独立仓库开发 → 主库集成"模式。
