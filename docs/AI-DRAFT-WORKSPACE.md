# AI 稿件库：架构、接口与操作

版本 6.0.0。面向普通写作者的本地稿件工作台，不是微信官方草稿箱。StoryForge 是独立内容合集，不是核心模型的业务分支。

## 数据与版本

Draft 包含 `id`、标题、Markdown、清洗后 HTML、纯文本、摘要、标签、合集、资源 SHA-256 引用、当前版本、checksum、来源引用、provenance、metadata、状态、平台适配稿、导出回执 ID、创建/更新时间。编号放在合集 metadata 中；普通稿件不需要编号。

Revision 使用不可变 `id`、`draftId`、`parentRevisionId`，快照正文和可比较字段，记录 `source`、`aiRunId`、checksum、时间；平台适配动作附带不可变 `platformVariant`。checksum 使用稳定排序的版本内容与 SHA-256；适配稿有单独 checksum。更新或恢复均追加版本，绝不覆写历史记录。恢复适配版本也恢复对应排版并关联新版本 ID。

更新必须同时提交 `draftId`、`baseRevisionId`、`expectedChecksum`。读取旧版本和落库之间再在同一写事务中比较，冲突返回 `CONFLICT`；不“最后写入获胜”。写入稿件、版本、资源引用和请求幂等记录属于同一事务。仅修改 Markdown 会重新生成正文 HTML；同时提供 HTML 时以显式 HTML 为排版真源。

数据库 `ai-draft-workspace-v1`，当前结构版本 **3**：

| store | 主键 | 用途 |
| --- | --- | --- |
| drafts | id | 当前稿件，collectionId 索引，唯一 importIdentity 索引 |
| revisions | id | 不可变内容快照，draftId 索引 |
| assets | sha256 | 原始 Blob、MIME、大小、引用数、平台映射 |
| collections | id | 通用合集，可选 expectedRange 审计范围 |
| aiRuns | id | 模型、指令、状态、输入/输出版本与脱敏错误 |
| exportReceipts | id | 平台、稿件版本、写入与回读 checksum、状态，draftId 索引 |
| imports | id | 导入过程、数量、冲突和完成状态 |
| operations | id | requestId 与原操作结果，重复请求去重 |
| workingCopies | id | 每个页面会话的未完成编辑恢复记录 |

升级只增加缺失 store/index；不删除数据库或旧 store。高版本数据库导致明确错误，不通过清库“修复”。连接收到 versionchange 会关闭；旧页面阻塞时提示用户关闭后重试。旧公众号知识库、图片库、设置、新标签页数据不搬迁、不重命名、不清理。

资源引用数按“任何历史版本使用此资源的稿件数”计算。共享资源不会因删除一个合集丢失；删除合集需明确确认，删除其稿件/历史/回执/恢复记录并回收无剩余引用资源。先备份才能恢复删除。

独立传输数据库 `ai-draft-file-transport-v1/files` 只承载临时 Blob，消费后删除，新文件操作顺便回收 24 小时前的未消费传输记录；它不是稿件主库。

## Draft Gateway

扩展内可信页面发送：

```json
{"type":"draft-api","request":{"type":"drafts.create","payload":{"requestId":"unique-id","draft":{"title":"产品更新公告","contentMarkdown":"# 本周更新\n\n完整正文。","tags":["公告"]}}}}
```

主要正式方法：

| 方法 | 核心参数与行为 |
| --- | --- |
| drafts.create | draft/requestId；返回 draftId、revisionId、checksum |
| drafts.update / createRevision | 三项版本条件 + changes/requestId；追加快照 |
| drafts.get | draftId；读取当前稿件 |
| drafts.list / search | query、collectionId、tag、status；最近更新排序 |
| drafts.revisions | draftId；不可变历史 |
| drafts.restoreRevision | 三项版本条件 + revisionId/requestId；新版本恢复 |
| drafts.archive | 三项版本条件；原子归档，不删除 |
| drafts.createTargetVariant | 三项版本条件 + platformId/changes；主稿内容保留，适配稿独立快照 |
| drafts.validate | draft 或 collectionId；清洗校验/完整性审计 |
| drafts.import | fileId/format/preview；全文预检，确认后导入 |
| drafts.export | filter.draftId/collectionId；完整版本与资源备份 Blob 通道 |
| drafts.readback | 三项版本条件 + changes；用户主动把平台回读另存为新版本 |
| drafts.collections / saveCollection / deleteCollection | 合集管理，删除必须 confirmed=true |
| drafts.asset / assetPreview / assetList / mapAsset | 资源、去重、预览、平台 URL 映射 |
| drafts.receipts / recordExport / confirmSaved | 导出记录与用户保存确认，不表示真实发布 |
| drafts.stats / aiRuns | 本机数量与 AI 运行审计 |
| drafts.workingCopy / workingCopies / clearWorkingCopy | 未完成编辑恢复 |
| drafts.beginAIRun / aiRun | 运行身份原子占位及过程记录，仅内部使用 |
| drafts.markAssetsExported / confirmReopened | 图片分阶段状态；保存后重开须用户确认及同篇标题、URL 回读 |

API 错误统一 `{ok:false,code,error,detail?}`。消息/changes 采用声明白名单；禁用凭据字段与常见明文凭据；禁止 AI/Agent 指定内部来源字段。单篇 4 MiB、单资源 32 MiB、包 1 GiB、单包最多 5000 篇；未知 schema/消息拒绝。`requestId` 原内容重复返回原结果，不同内容复用同 ID 则拒绝。

仅同扩展 library/popup/settings 页可以访问主数据；后台验证 sender，offscreen 再验证后台来源。已声明 content script 只负责编辑器操作，不能管理主库。没有 `externally_connectable`，没有 localhost HTTP 服务器，没有任意命令执行入口。

## AI 自动写稿

用户启用 AI 写入 → 发起指令 → 读取现有设置中的 provider/endpoint/model/key → 原子占用 runId → 请求现有 OpenAI-compatible 服务 → 校验 `{reply,actions}` → Draft API 事务落库 → 记录输出版本并在界面选中稿件。无需复制粘贴，也不会自动导出微信。

支持新建、修改当前稿件、另存副本、摘要/标签、微信适配稿。模型只获得主动选择的当前稿件与指令；不把全库、登录凭据或 WPS Token 发给模型。摘要模式仅准改摘要/标签，现有稿件一次一个完整动作；新建最多四篇。动作先校验结构、身份、内容，写入仍执行版本条件。多篇不是跨稿件全局事务；部分成功会保留逐篇结果，失败任务不会隐藏重试。

请求响应 25 秒超时，不自动重试；Service Worker 被中断可能留下 running/未知结果，用户应先查任务及版本，用新任务 ID 明确重试。服务端支持结构化 JSON 是前提；不合格式不保存、不用自然语言猜测动作。API key 只读取现有本机配置，不进入稿件、备份或日志；返回内容中出现当前 key 时拒绝保存。测试只用了本机模拟服务，真实提供商尚待验证。

## 外部本地 Agent

默认关闭。在稿件库明确启用 AI 写入和本地 Draft Gateway 后，更新后的 Native Messaging 组件建立当前用户私有 HMAC 邮箱：目录 0700、鉴权文件/消息 0600；拒绝符号链接、坏签名、超长消息和未知方法。它是同一操作系统账户的信任边界，不是跨用户/公网 API。不能让不可信代码以同一账户运行并认为 HMAC 能隔离它。

Agent 只可 create/update/createRevision/createTargetVariant/get/list/search/validate，不能删除、平台导出、保存、发布或读取凭据。轮询约一分钟一次，也可在库中主动检查。大结果可能超过原生单消息限制，Agent 应使用过滤查询并避免索取全库完整 HTML。旧组件不支持 Draft Gateway 时明确报错；原剪存入口保留。

```bash
node scripts/draft-agent.cjs submit request.json
node scripts/draft-agent.cjs result <返回的UUID>
```

请求格式同上述 `request`；更新需版本条件。submit 返回 queued 只表示入队，result 返回 Draft API 的实际 ID/checksum 才表示落库；pending/超时先查原 requestId，不隐式重复提交。正常本机队列和本地浏览器路由分别已测试，真实安装组件到浏览器的整条外部 Agent 链尚未验证。不要为了普通稿件库功能安装或启用原生网关。

## 平台接口与微信

WeChat adapter 提供 `id/name/capabilities/detect/validateDraft/transformDraft/exportToEditor/readBack/verifyExport/restore`。HTML、Markdown、JSON 是离线文件导出，不假装是另一家平台的真实发布适配器。

正文复用原 `findEditor`、`applyWhole`、HTML 双向同步流程。标题独立使用语义定位（title id/name/标题 placeholder），必须可见、可编辑且唯一；排除作者、摘要、封面、正文和插件面板。无法唯一确认就停止，绝不把标题写入正文首段。最长 64 字，过长要求用户适配而不静默截断。

确认目标页与导出 → 验证 CDN 图片及正文 → 非空平台内容二次覆盖确认 → 保存当前标题/正文快照 → 写标题并派发 input/change，复用正文写入 → 等待规范化 → 回读标题及 canonical HTML SHA-256 → 成功记录 verified，失败尝试恢复并回读原快照。不会点击平台保存或发布；复杂 CSS 被微信改变时会严格失败关闭。恢复快照当前只保留在该页面内存，页面关闭/崩溃后不保证自动恢复。

图片状态严格分为 `needs-platform-upload`、`mapped`、`exported`、`verified-after-reopen`。映射只接受 HTTPS `mmbiz.qpic.cn`，但 URL 有效性需真实平台确认。asset:// 或 Base64/外链图片不能通过微信导出验证；上传只走微信原生能力。用户确认保存只计 `user-confirmed-saved`，不是平台接口证明。重开验证核对回执标题和映射图片 URL；不表示服务器内容完全未改变，也不验证发布。

## 内容包与备份

`.sfpack` 是 ZIP STORE、schemaVersion=1：manifest + articles/*.json + assets/<sha256>.<ext>；完整备份另含 records/{revisions,exportReceipts,aiRuns,imports}.json。manifest 声明 packageId/version/kind/expectedCount、collections、article identity/path/bytes/checksum、asset hash/MIME/bytes/checksum、文件清单及 packageChecksum。文件与 manifest 使用 SHA-256，ZIP 校验 CRC、路径、中央目录与结尾；不执行 HTML/脚本，不向文件系统解包。

全包预检通过才写数据。来源 identity 作为幂等键：相同内容跳过，来源更新且本地未改才新增版本；本地修改则报告冲突，不覆盖。单篇内容导入是事务，整包导入可分篇中断，重导同包可继续。备份恢复保留原稿件/版本/资源 ID，身份冲突不覆盖，业务记录恢复原子提交；资源可能先已去重写入，失败会留下可复用的未引用资源，不丢稿件。

备份包含稿件、历史、资源、合集、回执和 AI 运行；不包含 API 档案、浏览器登录、WPS Token，也不备份尚未提交的 workingCopies 或运行中的瞬时状态。备份前先保存；新浏览器启用同扩展后导入。异常编辑恢复遇到正式稿件冲突时，可由用户明确选择另存“恢复副本”，不强覆盖原稿。旧知识库/司南数据仍用原机制，不能用稿件包当整浏览器备份。

生成 StoryForge 包是开发期操作，运行期只选择包，不读 `.codex`：

```bash
npm run pack:storyforge -- --source <diagram-edition目录> --head <WPS读取输出目录> --out <输出.sfpack>
```

001—004 的完整内联代码来自本轮只读 WPS 查询，并与 codeBlock 逐篇比对一致；005—151 是任务指定历史资料，不声称是 WPS 当前最新版。构建中验证原 checksum，提取图片 Blob、按 hash 去重、保留标题编号与非空正文，并输出缺失/重复审计。包不入 Git，避免把约 338 MB 内容硬编码进扩展。

## 测试、升级与恢复

`npm test` 包含模型、事务冲突、版本恢复、权限、资源共享、幂等导入、包损坏、备份、迁移、原生网关 HMAC 与微信 DOM fixture。`npm run test:browser` 使用真实 Chrome/Edge 的独立资料加载扩展，验证本机 AI 模拟链、预览、恢复、刷新/重启/重载及真实 151 篇内容包。它不代表用户实际安装或真实微信验收。

升级用同目录同 ID“重新加载”，不要卸载。首次导入前检查本机存储空间（去重资源约 320 MiB，预检/备份临时峰值更高），确保磁盘余量。扩展存储是浏览器资料的一部分；清除资料或卸载会丢数据，定期外部备份。

回滚软件：先完整备份、保留当前浏览器资料，在独立目录取旧提交，用扩展管理页原 ID 替换加载来源；旧版看不到新稿件库但不应该清理它。恢复时重新加载 v6，再导入备份；不能把旧软件能读新数据库作为保证。旧 HTML 编辑器仍可工作，知识库与设置无迁移。

真实平台验收必须逐篇完成 001/075/151：映射图片 → 选正确文章 → 主动导出 → 标题和正文回读通过 → 用户自行保存 → 重开同篇 → 图片 URL/展示核验。分别记本地数量、导出数量、用户确认保存数量、实际发布数量。当前不做保存、发布、群发、自动登录、私有接口上传。

参考：[Chrome Offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen)、[扩展存储](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)、[Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)、[IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)。
