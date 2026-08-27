# WPS 网页剪存本地组件

本目录是浏览器扩展的 Native Messaging 本地组件。它不接收任意 Shell 命令，只处理扩展发送的 `clip` 请求，并调用已安装的 `kdocs-cli` 把网页 Markdown 写入 WPS。

每次剪存会先检查用户配置的目标目录，在其中自动创建或复用名为“网页剪存”的子文件夹；网页文档全部写入该子文件夹。知识库目标同样会在目标节点下创建或复用该文件夹。

## 用户安装提示

普通用户不需要操作本目录。请在插件首次打开的安装引导页，按系统下载并运行“一键安装 WPS 剪存组件”。macOS 安装器以 ZIP 提供，解压后直接双击安装文件即可，不需要执行 `chmod` 或打开终端。安装器会自动下载 `kdocs-cli` 和 Node.js、写入本地组件、注册 Chrome/Edge Native Messaging，并打开 WPS 登录。安装完成后回到引导页点击“检测安装状态”，再在网页剪存面板填写并保存 WPS 文件夹或知识库目录链接。

网页总结仍沿用公众号编辑器中保存的 API 配置；剪存本身不需要 AI API。

组件只在点击剪存时由 Chrome 启动；成功或失败后保持短暂空闲，超过 5 分钟自动退出。网页正文只在本机处理，不经过本项目的远程服务器。

## 协议

请求：

```json
{"action":"clip","targetUrl":"https://www.kdocs.cn/...","title":"标题","url":"https://example.com","markdown":"# 标题\n\n正文","images":[]}
```

响应：

```json
{"ok":true,"link":"https://www.kdocs.cn/l/...","message":"已创建并验证 WPS 文档"}
```

## 开发者手动注册（仅用于调试）

正式用户请使用插件内的一键安装器。调试本地源码时，才需要把 `host-manifest.example.json` 中的 `allowed_origins` 替换为实际扩展 ID，再执行：

```bash
./install-macos.sh
```

Chrome 扩展不允许网页静默写入本机文件，因此无论使用一键安装器还是调试脚本，都需要用户首次确认运行一次本地安装程序。
