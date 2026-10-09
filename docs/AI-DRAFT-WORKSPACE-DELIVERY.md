# v6 AI 稿件库交付报告

日期：2026-10-09。结论：本地稿件库、AI 自动落库链路、版本恢复、内容包和微信编辑器适配已实现，并完成本地与独立浏览器验证；**未完成真实微信最低验收，不能称全部任务验收通过**。未触碰 StoryForge 主仓库、生产发布或用户日常浏览器数据。

## 1. 分支与提交

工作分支：`feat/ai-draft-workspace`；基线：`43e3c1e`。本报告与实现提交在同一功能分支，最终短 SHA 见交付消息（也可 `git rev-parse --short HEAD`）。仅本地提交，未推送/合并 main，未部署。原有未提交的剪存菜单修改已保留并纳入本次交付。

## 2. 修改文件

既有文件：`.gitignore`、`README.md`、`DEVELOPMENT.md`、`background.js`、`content.js`、`manifest.json`、`web-content.js`、`native-host/host.js`、`native-host/macos-installer.pkg`。

新增文件：`popup.html`、`popup.js`、`library.html`、`library.css`、`library.js`、`draft-background.js`、`draft-host.html`、`draft-host.js`、`draft-schema.js`、`draft-sanitize.js`、`draft-store.js`、`draft-gateway.js`、`draft-files.js`、`content-pack.js`、`platform-adapters/wechat.js`、`native-host/package.json`、`package.json`、`package-lock.json`、`scripts/draft-agent.cjs`、`scripts/fetch-storyforge-head.js`、`scripts/build-storyforge-pack.js`、`scripts/build-macos-installer.js`、`tests/drafts.test.js`、`tests/native.test.js`、`tests/wechat.test.js`、`tests/regression.test.js`、`tests/browser-smoke.js`、本文与 `docs/AI-DRAFT-WORKSPACE.md`。

本机交付但不提交 Git：`content-packs/storyforge-wechat-drafts.sfpack`（337,885,180 bytes）、同名 `.audit.json`；`test-results/browser-report.json` 和 Chrome/Edge 截图；只读 WPS 来源在忽略目录 `artifacts/wps-source/`。依赖/临时浏览器资料不提交。包不依赖 `.codex` 运行，需单独复制或备份此包。

## 3–5. Draft 模型、IndexedDB 与迁移

Draft 保存通用正文、标题、摘要、标签、合集、来源、SHA-256 资源、当前版本、适配版本、回执、状态和时间。Revision 不可变，记录 parent、来源、AI run 与内容 checksum；恢复生成新版本。平台适配稿保留独立不可变快照与 checksum。

新增 extension-origin 数据库 `ai-draft-workspace-v1` 结构版本 3：drafts/revisions/assets/collections/aiRuns/exportReceipts/imports/operations/workingCopies。关键事务同时提交稿件、版本、资源引用与幂等身份；更新需 ID/版本/checksum 三项条件。迁移只增加缺失结构，不清理旧数据；新建、旧版本升级、未来版本拒绝且不清库已测试。旧知识库、配置与司南存储保留。

## 6–7. Gateway 与 AI 链路

正式 CRUD、revision/restore、search/validate、import/export、variant/readback、collections/assets/receipts/runs API 见 [接口说明](AI-DRAFT-WORKSPACE.md)。后台与 offscreen 两层校验内部 sender、方法和字段；没有开放网页外部连接。启用权限后，AI 结构化动作经预检、版本条件和事务自动落库，界面直接选中结果，不需复制。AI run 原子占位，重复/超时不隐藏重试，失败不清空已有稿。

复用现有 AI 配置，没有新增账户或 key。完整“请求 → 返回动作 → 创建/修改 → 版本 → 刷新/重启”链路在 Chrome/Edge **本机模拟服务**测试通过；未调用真实提供商。外部 Agent 的私有 HMAC 原生邮箱已实现并单独测试，默认禁用，只能读取/创建/修改本地稿，不能导出/删除/保存/发布。真实安装组件到浏览器的整条 Agent 链尚未验证。

## 8–9. 平台接口与微信写入

WeChat adapter 提供 detect/capabilities/validateDraft/transformDraft/exportToEditor/readBack/verifyExport/restore。正文复用原 findEditor/applyWhole/同步机制；标题独立语义定位，排除摘要/作者/封面/正文。标题含混、DOM 改变、未映射图片或回读不一致时停止；非空内容须明确覆盖确认，失败恢复原快照并检查。适配测试包括标题、正文、input/change、覆盖取消、失败恢复及不提供保存/发布方法。

HTML/Markdown/JSON 目前是离线文件输出，不声称已有其他平台真机适配。微信接口中没有自动点击保存、发布、登录、群发或私有上传功能。

## 10. 包格式

独立 ZIP STORE `.sfpack`，schemaVersion=1，manifest 声明合集、文章 identity/checksum/大小、资源 SHA/MIME/大小、预期数量及包 checksum。完整备份加不可变历史、回执、AI 运行与导入记录。校验所有文件、CRC、路径、目录/结尾、身份与引用后再入库。重复内容跳过；来源更新追加版本；本地修改冲突不覆盖；中断重导可继续。完整备份/恢复和损坏包拒绝已测试，不含配置或登录凭据。

## 11–15. StoryForge 与图片审计

| 项目 | 结果 |
| --- | --- |
| 编号 | 001—151，共 151 篇 |
| 缺失编号 | 空 |
| 重复编号 | 空 |
| 超范围、空正文、checksum 问题 | 空 |
| 标题编号 | 每篇带对应三位编号 |
| 首次导入（Chrome / Edge） | 各新增 151，更新 0、冲突 0、错误 0 |
| 再次导入（Chrome / Edge） | 各跳过 151，新增 0 |
| 原始 HTML 大小 | 907,411,167 bytes |
| 图片引用 | 302 次 |
| 独立图片 | 152 份，335,526,210 bytes |
| 消除重复图片副本 | 150 份 |
| 包大小 | 337,885,180 bytes，约 322.2 MiB |
| 微信 CDN 映射 | **0**，均需用户原生上传后映射 |

001—004 本轮只读 WPS，并逐篇验证完整 codeBlock 与提取 HTML 一致；005—151 使用任务指定 `diagram-edition` **历史本地资料**。未将历史资料声称为当前 WPS 最新稿，未修改云文档；这是完整编号内容包，不是最新内容同步承诺。

## 16–17. Chrome / Edge

Chrome 155.0.8059.39、Edge 154.0.4258.62，本机独立测试资料：AI 新建/修改、历史恢复、可见排版预览、异常编辑恢复及冲突另存副本不覆盖原稿、单篇完整备份往返、刷新、浏览器重启、扩展管理页重新加载、popup、151 篇真包导入和再次导入均通过。管理页重载时开启开发者模式；不会以“卸载再装”冒充重载（卸载可能删除数据）。

证据：`test-results/browser-report.json`、`chrome-library.png`、`chrome-storyforge.png`、`msedge-library.png`、`msedge-storyforge.png`。两份资料各有 **152 篇 = StoryForge 151 + AI 测试稿 1**，独立资源 152，错误列表空。未安装到或迁移用户日常浏览器，日常浏览器内本地稿件数量未核验。

单元/迁移/原生/DOM/回归检查：`npm test` **17 项通过**。`git diff --check`、相关 JS 语法检查和依赖审计通过。回归检查覆盖剪存菜单、无悬浮按钮、打开剪存不远程写入、原配置保留、旧入口/快捷键与固定扩展身份；不等于真实站点所有旧功能的完整人工验收。

## 18–20. 真实平台与尚未验证

| 状态（StoryForge） | 数量 / 结论 |
| --- | --- |
| 本地内容包 | 151 篇 |
| 独立测试浏览器稿件库 | 每个 151 篇（不含 1 篇通用 AI 测试稿） |
| 用户日常浏览器稿件库 | 未核验；用户需重载并导入 |
| 成功导出真实微信编辑器 | **0 篇** |
| 用户确认已保存微信官方草稿 | **0 篇** |
| 实际发布 | **0 篇** |
| 001 / 075 / 151 真实标题正文回读 | **未执行** |
| 图片原生上传 → 导出 → 用户保存 → 重开 | **未执行** |

没有使用其他接口绕过此前的网站控制限制，没有微信写入/保存/发布证据。真实模型兼容性、真实 native host 浏览器集成、Windows/Linux 原生安装、真实微信 CSS/DOM 与完整旧功能人工回归仍待验证。macOS 安装包已重建，但未在用户系统运行，包未签名/公证。

## 21. 风险

- 微信 DOM 可能变更；标题查找/严格 HTML 校验可失败关闭，需真实回读验证，不能把 fixture 当平台保证。
- 图片 0 CDN 映射会阻止 151 篇含图稿直接导出。需原生上传、对应映射和保存后重开，不使用 Base64 成功显示作通过证据。
- 005—151 是历史内容，若要当前 WPS 新版本需另行只读对照和重构包，不能静默覆盖本地编辑。
- 浏览器资料、扩展 ID、清除站点数据/卸载影响存储；本地不是云备份。约 320 MiB 图片加预检和备份需额外磁盘/内存空间。
- AI 请求 25 秒超时；中断可留下未知 run。必须先查版本与任务，不自动重试制造重复。多篇 AI 创建逐篇事务，部分成功会留记录。
- 未完成编辑恢复有 200ms 防抖窗口；页面突然崩溃前最后一小段可能未持久化。恢复冲突保留记录，不强覆盖。
- 平台失败恢复快照只在当前页面内存，页面关闭后不保证可恢复；导出前先确认目标文章。
- 原生 HMAC 邮箱只隔离其他操作系统账户，不隔离同账户恶意代码；默认关闭、显式启用。

## 22. 回滚与数据恢复

先在稿件库导出完整 `.sfpack`，把包复制到扩展目录外，并保留现有浏览器资料。软件回滚在独立旧代码目录加载同固定 ID，不卸载、不清库；旧版不提供新稿件库 UI，但不会通过迁移清掉旧知识库。重回 v6 后导入备份恢复，冲突不会覆盖；跨浏览器同样先加载扩展再导入包。备份不会恢复 AI key/登录或未提交 workingCopies，它们需要原配置或当前资料。

下一验收步骤：用户日常浏览器重载扩展 → 插件菜单 AI 稿件库 → 导入本内容包 → 核验151与缺失/重复空 → 原生上传并映射001/075/151图片 → 主动导出和回读 → 用户自行保存 → 重开确认图片。完成后另增真实平台证据，不改写本报告中本轮实际为0的事实。
