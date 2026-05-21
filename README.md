# 微信公众号 HTML 插入器

> 配合 **[云中书 YunType](https://yuntype.pages.dev)** 排版工具使用 —— 在微信公众号编辑器中一键插入精美 HTML 排版，告别平淡无奇的公众号样式。

---

## ✨ 功能特性

- **一键插入**：把云中书生成的 HTML 排版直接注入微信公众号编辑器，格式完整保留
- **兼容 ProseMirror**：微信公众号编辑器使用 ProseMirror 内核，本插件专门适配，绕过粘贴过滤机制
- **多策略兜底**：内置 5 种插入策略（renderCopy → Paste → execCommand → Range → innerHTML），逐级降级，确保成功率
- **浮动按钮**：进入编辑器页面自动出现紫色悬浮图标，随时可用
- **记忆上次内容**：关闭弹窗后重新打开，上次粘贴的 HTML 仍然保留
- **代码安全过滤**：自动剥离 `<script>` / `<iframe>` / 事件处理器等危险标签

---

## 🚀 快速上手

### 第一步：安装插件

**Chrome 浏览器**

1. 下载本仓库（点右上角 `Code → Download ZIP`，解压）
2. 地址栏输入 `chrome://extensions/` 回车
3. 右上角开启 **开发者模式**
4. 点击 **加载已解压的扩展程序**，选择解压后的文件夹
5. 安装完成 ✅

**Edge 浏览器**

1. 同上解压，地址栏输入 `edge://extensions/` 回车
2. 左下角开启 **开发人员模式**
3. 点击 **加载解压缩的扩展**，选择文件夹
4. 安装完成 ✅

---

### 第二步：用云中书生成排版 HTML

1. 打开 **[云中书 YunType](https://yuntype.pages.dev)**
2. 左侧粘贴 Markdown 内容，右侧选择配色 / 字体 / 比例
3. 点击 **导出 HTML**，复制生成的代码

> 云中书支持小红书风格多图排版、微信公众号长图文、信息图等多种格式。

---

### 第三步：插入到公众号编辑器

1. 用安装了插件的浏览器打开微信公众号后台，新建图文
2. 编辑器右侧出现 **紫色 `<>` 悬浮图标**
3. 点击图标，弹出插入面板
4. 粘贴 HTML 代码，点击 **插入**
5. 排版格式直接出现在编辑器中 🎉

---

## 📁 文件结构

```
wechat-html-injector/
├── manifest.json   # 插件配置（Manifest V3）
├── content.js      # 核心逻辑：编辑器探测 + 多策略插入 + UI
├── icon.png        # 插件图标
└── README.md       # 本文档
```

---

## 🔧 技术原理

微信公众号编辑器基于 **ProseMirror**，直接合成 `paste` 事件会被其规范化过滤掉 `grid` / `flex` 等现代 CSS 布局。

本插件的核心策略（Strategy A）：

1. 将 HTML 渲染进屏幕外的 `contenteditable` 暂存区
2. 用 `execCommand('copy')` 写入**真实系统剪贴板**（非合成 DataTransfer）
3. 再对编辑器执行 `execCommand('paste')`

这样 ProseMirror 收到的是"来自系统剪贴板的真实粘贴"，完整保留 `inline style`，grid / flex 布局不会被降级。

---

## ⚠️ 注意事项

- 本插件以**开发者模式**加载，属于本地扩展，不会上传到 Chrome 商店，数据完全本地处理
- 微信公众号保存发布后，部分复杂 CSS 可能被服务器端二次过滤，建议使用云中书的**内联样式**导出版本
- 仅支持 `https://mp.weixin.qq.com` 域名下的编辑器页面

---

## 🤝 配套工具

| 工具 | 地址 | 说明 |
|---|---|---|
| 云中书 YunType | [yuntype.pages.dev](https://yuntype.pages.dev) | 生成排版 HTML 的主工具 |
| 云中书源码 | [github.com/yuanbw2025/yuntype](https://github.com/yuanbw2025/yuntype) | 开源，欢迎 Star |

---

## 📄 License

MIT — 自由使用、修改、分发。
