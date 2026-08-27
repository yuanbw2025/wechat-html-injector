# WPS 网页剪存本地组件

本目录是浏览器扩展的 Native Messaging 本地组件。它不接收任意 Shell 命令，只处理扩展发送的 `clip` 请求，并调用已安装的 `kdocs-cli` 把网页 Markdown 写入 WPS。

每次剪存会先检查用户配置的目标目录，在其中自动创建或复用名为“网页剪存”的子文件夹；网页文档全部写入该子文件夹。知识库目标同样会在目标节点下创建或复用该文件夹。

## 用户安装提示

首次使用需要：

1. 安装 `kdocs-cli` 并完成一次 `kdocs-cli auth login`。
2. 运行对应系统的安装脚本，注册 Native Messaging host。
3. 在插件的“网页剪存”面板填写并保存 WPS 文件夹或知识库目录链接。
4. 确认插件的 API 配置已保存（网页总结才需要 API）。

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

## 注册

先把 `host-manifest.example.json` 中的 `allowed_origins` 替换为实际扩展 ID，再执行：

```bash
./install-macos.sh
```

Chrome 扩展商店发布后，安装包应由项目发布页或安装引导页提供。Chrome 不允许扩展在安装时静默写入本机文件，因此这里需要用户首次运行一次安装脚本。
