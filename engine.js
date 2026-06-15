(() => {
  // ../yuntype/src/lib/render/markdown.ts
  function renderInline(text) {
    return text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/__(.+?)__/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>").replace(/_(.+?)_/g, "<em>$1</em>").replace(/`(.+?)`/g, '<code style="background: rgba(0,0,0,0.06); padding: 2px 6px; border-radius: 3px; font-size: 0.9em;">$1</code>').replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" style="text-decoration: underline;">$1</a>').replace(/!\[(.+?)\]\((.+?)\)/g, '<img src="$2" alt="$1" style="max-width: 100%;" />');
  }
  function parseTableRow(line) {
    return line.trim().split("|").slice(1, -1).map((c) => c.trim());
  }
  function isTableSeparator(cells) {
    return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
  }
  function parseMarkdown(md) {
    const lines = md.split("\n");
    const nodes = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === "") {
        i++;
        continue;
      }
      const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
      if (headingMatch) {
        nodes.push({
          type: "heading",
          level: headingMatch[1].length,
          text: headingMatch[2].trim()
        });
        i++;
        continue;
      }
      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
        nodes.push({ type: "hr" });
        i++;
        continue;
      }
      const imgMatch = line.trim().match(/^!\[(.*)?\]\((.+?)\)$/);
      if (imgMatch) {
        nodes.push({
          type: "image",
          alt: imgMatch[1] || "",
          src: imgMatch[2]
        });
        i++;
        continue;
      }
      if (line.trim().startsWith("```")) {
        const lang = line.trim().slice(3).trim();
        const codeLines = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith("```")) {
          codeLines.push(lines[i]);
          i++;
        }
        nodes.push({
          type: "code",
          text: codeLines.join("\n"),
          lang: lang || void 0
        });
        i++;
        continue;
      }
      if (line.trimStart().startsWith("> ")) {
        const quoteLines = [];
        while (i < lines.length && lines[i].trimStart().startsWith("> ")) {
          quoteLines.push(lines[i].trimStart().slice(2));
          i++;
        }
        nodes.push({
          type: "blockquote",
          text: quoteLines.join("\n")
        });
        continue;
      }
      if (line.trimStart().startsWith("|")) {
        const tableLines = [];
        while (i < lines.length && lines[i].trimStart().startsWith("|")) {
          tableLines.push(lines[i]);
          i++;
        }
        const parsedLines = tableLines.map(parseTableRow);
        let headers = [];
        const rows = [];
        let foundSeparator = false;
        for (const cells of parsedLines) {
          if (isTableSeparator(cells)) {
            foundSeparator = true;
          } else if (!foundSeparator) {
            headers = cells;
          } else {
            rows.push(cells);
          }
        }
        if (!foundSeparator && parsedLines.length > 0) {
          headers = parsedLines[0];
          for (let j = 1; j < parsedLines.length; j++) rows.push(parsedLines[j]);
        }
        if (headers.length > 0) {
          nodes.push({ type: "table", headers, rows });
        }
        continue;
      }
      if (/^\s*[-*+]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*+]\s+/, "").trim());
          i++;
        }
        nodes.push({
          type: "list",
          ordered: false,
          children: items
        });
        continue;
      }
      const ORDERED_RE = /^\s*(?:\(\d+\)|（\d+）|\d+[.．、)]|[一二三四五六七八九十百千]+[、.．]|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])\s*/;
      if (ORDERED_RE.test(line)) {
        const items = [];
        while (i < lines.length && ORDERED_RE.test(lines[i])) {
          items.push(lines[i].replace(ORDERED_RE, "").trim());
          i++;
        }
        nodes.push({
          type: "list",
          ordered: true,
          children: items
        });
        continue;
      }
      nodes.push({
        type: "paragraph",
        text: line.trim()
      });
      i++;
    }
    return nodes;
  }

  // ../yuntype/src/lib/atoms/slots/title.ts
  function h(text) {
    return renderInline(text);
  }
  var titleSlots = [
    // ── T01 左对齐底线 ──
    {
      id: "left-underline",
      name: "\u5DE6\u5BF9\u9F50\u5E95\u7EBF",
      tags: ["minimal", "clean", "professional"],
      render: (text, level, ctx) => {
        const sizes = { 1: 24, 2: 20, 3: 17 };
        const fs = sizes[level] ?? 20;
        const border = level <= 2 ? `border-bottom: ${px(2, ctx)} solid ${ctx.colors.primary}; padding-bottom: ${px(8, ctx)};` : `border-left: ${px(3, ctx)} solid ${ctx.colors.primary}; padding-left: ${px(10, ctx)};`;
        return `<section style="margin: ${px(28, ctx)} 0 ${px(16, ctx)} 0; font-size: ${px(fs, ctx)}; font-weight: ${ctx.typo.headingWeight}; color: ${ctx.colors.primary}; line-height: 1.4; ${border}">${h(text)}</section>`;
      }
    },
    // ── T02 居中对称 ──
    {
      id: "center-symmetric",
      name: "\u5C45\u4E2D\u5BF9\u79F0",
      tags: ["elegant", "literary", "formal"],
      render: (text, level, ctx) => {
        const sizes = { 1: 26, 2: 21, 3: 17 };
        const fs = sizes[level] ?? 21;
        return `<section style="margin: ${px(32, ctx)} 0 ${px(16, ctx)} 0; text-align: center; font-size: ${px(fs, ctx)}; font-weight: ${ctx.typo.headingWeight}; color: ${ctx.colors.primary}; line-height: 1.3; letter-spacing: ${px(2, ctx)};">
  <span style="color: ${ctx.colors.secondary}; margin-right: ${px(8, ctx)};">\u2014</span>${h(text)}<span style="color: ${ctx.colors.secondary}; margin-left: ${px(8, ctx)};">\u2014</span>
</section>`;
      }
    },
    // ── T03 色块标签 ──
    {
      id: "color-badge",
      name: "\u8272\u5757\u6807\u7B7E",
      tags: ["modern", "colorful", "design"],
      render: (text, level, ctx) => {
        const sizes = { 1: 22, 2: 18, 3: 15 };
        const fs = sizes[level] ?? 18;
        const padV = level === 1 ? 8 : level === 2 ? 6 : 4;
        const padH = level === 1 ? 20 : level === 2 ? 16 : 12;
        const radius = level === 1 ? 6 : 4;
        return `<section style="margin: ${px(28, ctx)} 0 ${px(16, ctx)} 0; font-size: ${px(fs, ctx)}; line-height: 1.4;">
  <span style="background: ${ctx.colors.primary}; color: #FFFFFF; padding: ${px(padV, ctx)} ${px(padH, ctx)}; border-radius: ${px(radius, ctx)}; display: inline-block; font-weight: ${ctx.typo.headingWeight};">${h(text)}</span>
</section>`;
      }
    },
    // ── T04 双线框 ──
    {
      id: "double-border",
      name: "\u53CC\u7EBF\u6846",
      tags: ["academic", "serious", "structured"],
      render: (text, level, ctx) => {
        const sizes = { 1: 22, 2: 19, 3: 16 };
        const fs = sizes[level] ?? 19;
        if (level <= 2) {
          return `<section style="margin: ${px(32, ctx)} 0 ${px(16, ctx)} 0; border: ${px(2, ctx)} double ${ctx.colors.primary}; padding: ${px(10, ctx)} ${px(16, ctx)}; font-size: ${px(fs, ctx)}; font-weight: ${ctx.typo.headingWeight}; color: ${ctx.colors.primary}; text-align: center; line-height: 1.4;">${h(text)}</section>`;
        }
        return `<section style="margin: ${px(24, ctx)} 0 ${px(12, ctx)} 0; border-bottom: ${px(2, ctx)} double ${ctx.colors.secondary}; padding-bottom: ${px(6, ctx)}; font-size: ${px(fs, ctx)}; font-weight: ${ctx.typo.headingWeight}; color: ${ctx.colors.primary}; line-height: 1.4;">${h(text)}</section>`;
      }
    },
    // ── T05 Banner 横幅 ──
    {
      id: "banner-full",
      name: "Banner \u6A2A\u5E45",
      tags: ["bold", "magazine", "impactful"],
      render: (text, level, ctx) => {
        const sizes = { 1: 24, 2: 20, 3: 16 };
        const fs = sizes[level] ?? 20;
        if (level <= 2) {
          return `<section style="margin: ${px(28, ctx)} ${px(-20, ctx)} ${px(16, ctx)} ${px(-20, ctx)}; background: ${ctx.colors.primary}; color: #FFFFFF; padding: ${px(14, ctx)} ${px(24, ctx)}; font-size: ${px(fs, ctx)}; font-weight: ${ctx.typo.headingWeight}; line-height: 1.3;">${h(text)}</section>`;
        }
        return `<section style="margin: ${px(24, ctx)} 0 ${px(12, ctx)} 0; background: ${ctx.colors.secondary}; color: ${ctx.colors.primary}; padding: ${px(8, ctx)} ${px(16, ctx)}; font-size: ${px(fs, ctx)}; font-weight: ${ctx.typo.headingWeight}; line-height: 1.4;">${h(text)}</section>`;
      }
    },
    // ── T06 编号序号 ──
    {
      id: "numbered",
      name: "\u7F16\u53F7\u5E8F\u53F7",
      tags: ["structured", "tutorial", "step-by-step"],
      render: (text, level, ctx, index = 0) => {
        const sizes = { 1: 22, 2: 19, 3: 16 };
        const fs = sizes[level] ?? 19;
        const numSize = level === 1 ? 32 : 26;
        const num = String(index + 1).padStart(2, "0");
        return `<section style="margin: ${px(28, ctx)} 0 ${px(16, ctx)} 0; font-size: ${px(fs, ctx)}; font-weight: ${ctx.typo.headingWeight}; color: ${ctx.colors.primary}; line-height: 1.4; display: flex; align-items: baseline; gap: ${px(10, ctx)};">
  <span style="font-size: ${px(numSize, ctx)}; font-weight: 800; color: ${ctx.colors.primary}; opacity: 0.3; font-family: Georgia, serif;">${num}</span>
  <span>${h(text)}</span>
</section>`;
      }
    },
    // ── T07 左色条 ──
    {
      id: "left-bar",
      name: "\u5DE6\u8272\u6761",
      tags: ["professional", "clean", "business"],
      render: (text, level, ctx) => {
        const sizes = { 1: 22, 2: 19, 3: 16 };
        const fs = sizes[level] ?? 19;
        const barW = level === 1 ? 5 : level === 2 ? 4 : 3;
        return `<section style="margin: ${px(28, ctx)} 0 ${px(14, ctx)} 0; border-left: ${px(barW, ctx)} solid ${ctx.colors.primary}; padding-left: ${px(14, ctx)}; font-size: ${px(fs, ctx)}; font-weight: ${ctx.typo.headingWeight}; color: ${ctx.colors.primary}; line-height: 1.4;">${h(text)}</section>`;
      }
    },
    // ── T08 几何前缀 ──
    {
      id: "geometric-prefix",
      name: "\u51E0\u4F55\u524D\u7F00",
      tags: ["geometric", "design", "unique"],
      render: (text, level, ctx) => {
        const sizes = { 1: 22, 2: 19, 3: 16 };
        const fs = sizes[level] ?? 19;
        const icons = { 1: "\u25C6", 2: "\u25C7", 3: "\u25B8" };
        const icon = icons[level] ?? "\u25B8";
        return `<section style="margin: ${px(28, ctx)} 0 ${px(14, ctx)} 0; font-size: ${px(fs, ctx)}; font-weight: ${ctx.typo.headingWeight}; color: ${ctx.colors.primary}; line-height: 1.4;">
  <span style="color: ${ctx.colors.primary}; margin-right: ${px(8, ctx)};">${icon}</span>${h(text)}
</section>`;
      }
    },
    // ── T09 日式细字 ──
    {
      id: "zen-minimal",
      name: "\u65E5\u5F0F\u7EC6\u5B57",
      tags: ["japanese", "minimal", "elegant"],
      render: (text, level, ctx) => {
        const sizes = { 1: 20, 2: 17, 3: 15 };
        const fs = sizes[level] ?? 17;
        return `<section style="margin: ${px(36, ctx)} 0 ${px(18, ctx)} 0; text-align: center; font-size: ${px(fs, ctx)}; font-weight: 300; color: ${ctx.colors.primary}; line-height: 1.6; letter-spacing: ${px(4, ctx)};">${h(text)}</section>`;
      }
    },
    // ── T10 圆润气泡 ──
    {
      id: "bubble",
      name: "\u5706\u6DA6\u6C14\u6CE1",
      tags: ["friendly", "warm", "cute"],
      render: (text, level, ctx) => {
        const sizes = { 1: 20, 2: 18, 3: 15 };
        const fs = sizes[level] ?? 18;
        const padV = level === 1 ? 10 : 8;
        const padH = level === 1 ? 24 : 20;
        return `<section style="margin: ${px(28, ctx)} 0 ${px(14, ctx)} 0; font-size: ${px(fs, ctx)}; line-height: 1.4;">
  <span style="background: ${ctx.colors.secondary}; padding: ${px(padV, ctx)} ${px(padH, ctx)}; border-radius: ${px(20, ctx)}; display: inline-block; font-weight: ${ctx.typo.headingWeight}; color: ${ctx.colors.primary};">${h(text)}</span>
</section>`;
      }
    }
  ];

  // ../yuntype/src/lib/atoms/slots/quote.ts
  function r(text) {
    return renderInline(text);
  }
  var quoteSlots = [
    // ── Q01 左竖线 ──
    {
      id: "left-bar",
      name: "\u5DE6\u7AD6\u7EBF",
      tags: ["minimal", "clean", "professional"],
      render: (content, ctx) => `<section style="margin: 0 0 ${px(16, ctx)} 0; border-left: ${px(3, ctx)} solid ${ctx.colors.secondary}; padding: ${px(12, ctx)} ${px(16, ctx)}; background: rgba(${ctx.isDark ? "255,255,255" : "0,0,0"},0.03); color: ${ctx.colors.text}; font-size: ${px(15, ctx)}; line-height: 1.8;">${r(content)}</section>`
    },
    // ── Q02 圆角卡片 ──
    {
      id: "rounded-card",
      name: "\u5706\u89D2\u5361\u7247",
      tags: ["modern", "card", "friendly"],
      render: (content, ctx) => `<section style="margin: 0 0 ${px(16, ctx)} 0; background: ${ctx.colors.secondary}; padding: ${px(16, ctx)} ${px(20, ctx)}; border-radius: ${px(10, ctx)}; color: ${ctx.colors.text}; font-size: ${px(15, ctx)}; line-height: 1.8;">${r(content)}</section>`
    },
    // ── Q03 Pull-quote 居中大字 ──
    {
      id: "pull-quote",
      name: "\u5C45\u4E2D\u5927\u5B57\u5F15\u8FF0",
      tags: ["magazine", "editorial", "literary"],
      render: (content, ctx) => `<section style="margin: ${px(24, ctx)} 0; padding: ${px(20, ctx)} ${px(32, ctx)}; text-align: center; font-size: ${px(20, ctx)}; font-style: italic; color: ${ctx.colors.primary}; line-height: 1.6; border-top: ${px(1, ctx)} solid ${ctx.colors.secondary}; border-bottom: ${px(1, ctx)} solid ${ctx.colors.secondary};">${r(content)}</section>`
    },
    // ── Q04 双线框 ──
    {
      id: "double-border",
      name: "\u53CC\u7EBF\u6846",
      tags: ["academic", "serious", "structured"],
      render: (content, ctx) => `<section style="margin: 0 0 ${px(16, ctx)} 0; border: ${px(2, ctx)} double ${ctx.colors.secondary}; padding: ${px(16, ctx)}; color: ${ctx.colors.text}; font-size: ${px(15, ctx)}; line-height: 1.8;">${r(content)}</section>`
    },
    // ── Q05 大引号 ──
    {
      id: "big-quotes",
      name: "\u5927\u5F15\u53F7",
      tags: ["literary", "decorative", "elegant"],
      render: (content, ctx) => `<section style="margin: 0 0 ${px(16, ctx)} 0; padding: ${px(16, ctx)} ${px(20, ctx)} ${px(16, ctx)} ${px(40, ctx)}; position: relative; color: ${ctx.colors.text}; font-size: ${px(15, ctx)}; line-height: 1.8;">
  <span style="position: absolute; left: ${px(8, ctx)}; top: ${px(4, ctx)}; font-size: ${px(48, ctx)}; color: ${ctx.colors.primary}; opacity: 0.25; font-family: Georgia, serif; line-height: 1;">"</span>
  ${r(content)}
</section>`
    },
    // ── Q06 虚线框 ──
    {
      id: "dashed-frame",
      name: "\u865A\u7EBF\u6846",
      tags: ["japanese", "minimal", "clean"],
      render: (content, ctx) => `<section style="margin: 0 0 ${px(16, ctx)} 0; border: ${px(1, ctx)} dashed ${ctx.colors.secondary}; padding: ${px(14, ctx)} ${px(18, ctx)}; color: ${ctx.colors.textMuted}; font-size: ${px(14, ctx)}; line-height: 1.8;">${r(content)}</section>`
    },
    // ── Q07 气泡对话 ──
    {
      id: "bubble",
      name: "\u6C14\u6CE1\u5BF9\u8BDD",
      tags: ["friendly", "cute", "warm"],
      render: (content, ctx) => `<section style="margin: 0 0 ${px(16, ctx)} 0; background: ${ctx.colors.secondary}; padding: ${px(14, ctx)} ${px(18, ctx)}; border-radius: ${px(16, ctx)} ${px(16, ctx)} ${px(16, ctx)} ${px(4, ctx)}; color: ${ctx.colors.text}; font-size: ${px(15, ctx)}; line-height: 1.8;">${r(content)}</section>`
    },
    // ── Q08 摘要框 ──
    {
      id: "summary-box",
      name: "\u6458\u8981\u6846",
      tags: ["structured", "tutorial", "professional"],
      render: (content, ctx) => `<section style="margin: 0 0 ${px(16, ctx)} 0; border: ${px(1, ctx)} solid ${ctx.colors.secondary}; border-left: ${px(4, ctx)} solid ${ctx.colors.primary}; padding: ${px(14, ctx)} ${px(18, ctx)}; background: rgba(${ctx.isDark ? "255,255,255" : "0,0,0"},0.02); color: ${ctx.colors.text}; font-size: ${px(14, ctx)}; line-height: 1.8;">
  <span style="display: block; font-size: ${px(12, ctx)}; color: ${ctx.colors.primary}; font-weight: 600; margin-bottom: ${px(6, ctx)}; letter-spacing: ${px(1, ctx)};">\u{1F4CC} \u6458\u8981</span>
  ${r(content)}
</section>`
    }
  ];

  // ../yuntype/src/lib/atoms/slots/list.ts
  function r2(text) {
    return renderInline(text);
  }
  var listSlots = [
    // ── L01 圆点 ──
    {
      id: "dot",
      name: "\u25CF \u5706\u70B9",
      tags: ["default", "clean", "professional"],
      render: (items, ordered, ctx) => {
        const html = items.map((item, idx) => {
          const prefix = ordered ? `<span style="color: ${ctx.colors.primary}; font-weight: bold; margin-right: ${px(6, ctx)};">${idx + 1}.</span>` : `<span style="color: ${ctx.colors.primary}; margin-right: ${px(8, ctx)};">\u25CF</span>`;
          return `<section style="margin-bottom: ${px(8, ctx)}; display: flex; align-items: baseline; font-size: ${px(15, ctx)}; line-height: 1.75; color: ${ctx.colors.text}; letter-spacing: ${ctx.typo.letterSpacing};">${prefix}<span>${r2(item)}</span></section>`;
        }).join("");
        return `<section style="margin: 0 0 ${px(16, ctx)} 0; padding-left: ${px(4, ctx)};">${html}</section>`;
      }
    },
    // ── L02 方块 ──
    {
      id: "square",
      name: "\u25A0 \u65B9\u5757",
      tags: ["modern", "design", "bold"],
      render: (items, ordered, ctx) => {
        const html = items.map((item, idx) => {
          const prefix = ordered ? `<span style="background: ${ctx.colors.primary}; color: #fff; width: ${px(22, ctx)}; height: ${px(22, ctx)}; border-radius: ${px(3, ctx)}; display: inline-flex; align-items: center; justify-content: center; font-size: ${px(12, ctx)}; margin-right: ${px(8, ctx)}; flex-shrink: 0;">${idx + 1}</span>` : `<span style="color: ${ctx.colors.primary}; margin-right: ${px(8, ctx)};">\u25A0</span>`;
          return `<section style="margin-bottom: ${px(8, ctx)}; display: flex; align-items: baseline; font-size: ${px(15, ctx)}; line-height: 1.75; color: ${ctx.colors.text};">${prefix}<span>${r2(item)}</span></section>`;
        }).join("");
        return `<section style="margin: 0 0 ${px(16, ctx)} 0; padding-left: ${px(4, ctx)};">${html}</section>`;
      }
    },
    // ── L03 箭头 ──
    {
      id: "arrow",
      name: "\u25B6 \u7BAD\u5934",
      tags: ["dynamic", "tutorial", "step-by-step"],
      render: (items, ordered, ctx) => {
        const html = items.map((item, idx) => {
          const prefix = ordered ? `<span style="color: ${ctx.colors.primary}; font-weight: bold; margin-right: ${px(6, ctx)};">${idx + 1}.</span>` : `<span style="color: ${ctx.colors.primary}; margin-right: ${px(8, ctx)}; font-size: ${px(12, ctx)};">\u25B6</span>`;
          return `<section style="margin-bottom: ${px(8, ctx)}; display: flex; align-items: baseline; font-size: ${px(15, ctx)}; line-height: 1.75; color: ${ctx.colors.text};">${prefix}<span>${r2(item)}</span></section>`;
        }).join("");
        return `<section style="margin: 0 0 ${px(16, ctx)} 0; padding-left: ${px(4, ctx)};">${html}</section>`;
      }
    },
    // ── L04 菱形 ──
    {
      id: "diamond",
      name: "\u{1F539} \u83F1\u5F62",
      tags: ["friendly", "warm", "cute"],
      render: (items, ordered, ctx) => {
        const html = items.map((item, idx) => {
          const prefix = ordered ? `<span style="color: ${ctx.colors.primary}; font-weight: bold; margin-right: ${px(6, ctx)};">${idx + 1}.</span>` : `<span style="margin-right: ${px(8, ctx)};">\u{1F539}</span>`;
          return `<section style="margin-bottom: ${px(8, ctx)}; display: flex; align-items: baseline; font-size: ${px(15, ctx)}; line-height: 1.75; color: ${ctx.colors.text};">${prefix}<span>${r2(item)}</span></section>`;
        }).join("");
        return `<section style="margin: 0 0 ${px(16, ctx)} 0; padding-left: ${px(4, ctx)};">${html}</section>`;
      }
    },
    // ── L05 清单打勾 ──
    {
      id: "checklist",
      name: "\u2611 \u6E05\u5355",
      tags: ["structured", "tutorial", "checklist"],
      render: (items, _ordered, ctx) => {
        const html = items.map(
          (item) => `<section style="margin-bottom: ${px(8, ctx)}; display: flex; align-items: baseline; font-size: ${px(15, ctx)}; line-height: 1.75; color: ${ctx.colors.text};">
  <span style="color: ${ctx.colors.primary}; margin-right: ${px(8, ctx)};">\u2611</span><span>${r2(item)}</span>
</section>`
        ).join("");
        return `<section style="margin: 0 0 ${px(16, ctx)} 0; padding-left: ${px(4, ctx)};">${html}</section>`;
      }
    },
    // ── L06 短线前缀 ──
    {
      id: "dash-prefix",
      name: "\u2014 \u77ED\u7EBF",
      tags: ["japanese", "minimal", "elegant"],
      render: (items, ordered, ctx) => {
        const html = items.map((item, idx) => {
          const prefix = ordered ? `<span style="color: ${ctx.colors.textMuted}; margin-right: ${px(8, ctx)};">${idx + 1}.</span>` : `<span style="color: ${ctx.colors.textMuted}; margin-right: ${px(8, ctx)};">\u2014</span>`;
          return `<section style="margin-bottom: ${px(10, ctx)}; display: flex; align-items: baseline; font-size: ${px(15, ctx)}; line-height: 1.8; color: ${ctx.colors.text};">${prefix}<span>${r2(item)}</span></section>`;
        }).join("");
        return `<section style="margin: 0 0 ${px(16, ctx)} 0; padding-left: ${px(4, ctx)};">${html}</section>`;
      }
    },
    // ── L07 卡片列表 ──
    {
      id: "card-items",
      name: "\u5361\u7247\u5217\u8868",
      tags: ["card", "modular", "structured"],
      render: (items, ordered, ctx) => {
        const html = items.map((item, idx) => {
          const prefix = ordered ? `<span style="background: ${ctx.colors.primary}; color: #fff; width: ${px(22, ctx)}; height: ${px(22, ctx)}; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: ${px(12, ctx)}; margin-right: ${px(10, ctx)}; flex-shrink: 0;">${idx + 1}</span>` : `<span style="width: ${px(6, ctx)}; height: ${px(6, ctx)}; border-radius: 50%; background: ${ctx.colors.primary}; display: inline-block; margin-right: ${px(10, ctx)}; flex-shrink: 0; position: relative; top: ${px(-2, ctx)};"></span>`;
          return `<section style="margin-bottom: ${px(8, ctx)}; padding: ${px(10, ctx)} ${px(14, ctx)}; background: ${ctx.colors.secondary}; border-radius: ${px(6, ctx)}; display: flex; align-items: center; font-size: ${px(15, ctx)}; line-height: 1.6; color: ${ctx.colors.text};">${prefix}<span>${r2(item)}</span></section>`;
        }).join("");
        return `<section style="margin: 0 0 ${px(16, ctx)} 0;">${html}</section>`;
      }
    },
    // ── L08 编号圆圈 ──
    {
      id: "circle-number",
      name: "\u2460\u2461\u2462 \u5706\u5708\u7F16\u53F7",
      tags: ["structured", "tutorial", "formal"],
      render: (items, _ordered, ctx) => {
        const circles = ["\u2460", "\u2461", "\u2462", "\u2463", "\u2464", "\u2465", "\u2466", "\u2467", "\u2468", "\u2469"];
        const html = items.map((item, idx) => {
          const prefix = `<span style="color: ${ctx.colors.primary}; margin-right: ${px(8, ctx)}; font-size: ${px(16, ctx)};">${circles[idx] ?? `${idx + 1}.`}</span>`;
          return `<section style="margin-bottom: ${px(8, ctx)}; display: flex; align-items: baseline; font-size: ${px(15, ctx)}; line-height: 1.75; color: ${ctx.colors.text};">${prefix}<span>${r2(item)}</span></section>`;
        }).join("");
        return `<section style="margin: 0 0 ${px(16, ctx)} 0; padding-left: ${px(4, ctx)};">${html}</section>`;
      }
    }
  ];

  // ../yuntype/src/lib/atoms/slots/divider.ts
  var dividerSlots = [
    // ── D01 细线 ──
    {
      id: "thin-line",
      name: "\u7EC6\u7EBF",
      tags: ["minimal", "clean", "default"],
      render: (ctx) => `<section style="border-top: ${px(1, ctx)} solid ${ctx.colors.secondary}; margin: ${px(24, ctx)} 0;"></section>`
    },
    // ── D02 粗线 ──
    {
      id: "thick-line",
      name: "\u7C97\u7EBF",
      tags: ["bold", "modern", "strong"],
      render: (ctx) => `<section style="border-top: ${px(3, ctx)} solid ${ctx.colors.secondary}; margin: ${px(24, ctx)} 0;"></section>`
    },
    // ── D03 双线 ──
    {
      id: "double-line",
      name: "\u53CC\u7EBF",
      tags: ["academic", "formal", "serious"],
      render: (ctx) => `<section style="border-top: ${px(3, ctx)} double ${ctx.colors.secondary}; margin: ${px(24, ctx)} 0;"></section>`
    },
    // ── D04 渐变线 ──
    {
      id: "gradient-line",
      name: "\u6E10\u53D8\u7EBF",
      tags: ["modern", "design", "premium"],
      render: (ctx) => `<section style="height: ${px(2, ctx)}; background: linear-gradient(to right, transparent, ${ctx.colors.primary}, transparent); margin: ${px(28, ctx)} 0;"></section>`
    },
    // ── D05 点状 ──
    {
      id: "dots",
      name: "\u70B9\u72B6 \xB7 \xB7 \xB7",
      tags: ["literary", "elegant", "poetic"],
      render: (ctx) => `<p style="text-align: center; color: ${ctx.colors.secondary}; letter-spacing: ${px(8, ctx)}; margin: ${px(24, ctx)} 0; font-size: ${px(14, ctx)};">\xB7 \xB7 \xB7 \xB7 \xB7</p>`
    },
    // ── D06 装饰花 ──
    {
      id: "ornament",
      name: "\u88C5\u9970\u82B1 \u2756",
      tags: ["decorative", "literary", "elegant"],
      render: (ctx) => `<p style="text-align: center; color: ${ctx.colors.primary}; margin: ${px(28, ctx)} 0; font-size: ${px(16, ctx)}; opacity: 0.6;">\u2756</p>`
    },
    // ── D07 菱形 ──
    {
      id: "diamond",
      name: "\u83F1\u5F62 \u25C7\u25C7\u25C7",
      tags: ["geometric", "unique", "design"],
      render: (ctx) => `<p style="text-align: center; color: ${ctx.colors.secondary}; letter-spacing: ${px(6, ctx)}; margin: ${px(24, ctx)} 0;">\u25C7 \u25C7 \u25C7</p>`
    },
    // ── D08 居中圆 ──
    {
      id: "single-circle",
      name: "\u5C45\u4E2D \u25CB",
      tags: ["japanese", "minimal", "zen"],
      render: (ctx) => `<p style="text-align: center; color: ${ctx.colors.secondary}; margin: ${px(28, ctx)} 0; font-size: ${px(12, ctx)};">\u25CB</p>`
    }
  ];

  // ../yuntype/src/lib/atoms/slots/paragraph.ts
  function r3(text) {
    return renderInline(text);
  }
  var paragraphSlots = [
    // ── P01 无缩进紧凑 ──
    {
      id: "compact",
      name: "\u65E0\u7F29\u8FDB\u7D27\u51D1",
      tags: ["modern", "tech", "clean"],
      render: (text, ctx) => `<p style="margin: 0 0 ${px(16, ctx)} 0; font-size: ${px(15, ctx)}; line-height: 1.75; color: ${ctx.colors.text}; font-weight: ${ctx.typo.bodyWeight}; letter-spacing: ${ctx.typo.letterSpacing};">${r3(text)}</p>`
    },
    // ── P02 首行缩进 ──
    {
      id: "indented",
      name: "\u9996\u884C\u7F29\u8FDB",
      tags: ["chinese", "traditional", "reading"],
      render: (text, ctx) => `<p style="margin: 0 0 ${px(20, ctx)} 0; text-indent: 2em; font-size: ${px(16, ctx)}; line-height: 2.0; color: ${ctx.colors.text}; font-weight: ${ctx.typo.bodyWeight}; letter-spacing: ${ctx.typo.letterSpacing};">${r3(text)}</p>`
    },
    // ── P03 首字下沉 ──
    {
      id: "drop-cap",
      name: "\u9996\u5B57\u4E0B\u6C89",
      tags: ["magazine", "editorial", "premium"],
      render: (text, ctx, isFirst = false) => {
        if (isFirst && text.length > 1) {
          const firstChar = text[0];
          const rest = text.slice(1);
          return `<p style="margin: 0 0 ${px(18, ctx)} 0; font-size: ${px(16, ctx)}; line-height: 1.9; color: ${ctx.colors.text}; font-weight: ${ctx.typo.bodyWeight}; letter-spacing: ${ctx.typo.letterSpacing};">
  <span style="float: left; font-size: ${px(48, ctx)}; line-height: 1; font-weight: bold; color: ${ctx.colors.primary}; margin: ${px(2, ctx)} ${px(8, ctx)} 0 0; font-family: Georgia, 'Times New Roman', serif;">${firstChar}</span>${r3(rest)}
</p>`;
        }
        return `<p style="margin: 0 0 ${px(18, ctx)} 0; font-size: ${px(16, ctx)}; line-height: 1.9; color: ${ctx.colors.text}; font-weight: ${ctx.typo.bodyWeight}; letter-spacing: ${ctx.typo.letterSpacing};">${r3(text)}</p>`;
      }
    },
    // ── P04 大留白舒展 ──
    {
      id: "airy-wide",
      name: "\u5927\u7559\u767D\u8212\u5C55",
      tags: ["japanese", "minimal", "elegant"],
      render: (text, ctx) => `<p style="margin: 0 0 ${px(28, ctx)} 0; font-size: ${px(15, ctx)}; line-height: 2.2; color: ${ctx.colors.text}; font-weight: ${ctx.typo.bodyWeight}; letter-spacing: ${px(1, ctx)};">${r3(text)}</p>`
    },
    // ── P05 首段放大 ──
    {
      id: "lead-paragraph",
      name: "\u9996\u6BB5\u653E\u5927",
      tags: ["magazine", "editorial", "impactful"],
      render: (text, ctx, isFirst = false) => {
        const fs = isFirst ? px(18, ctx) : px(15, ctx);
        const lh = isFirst ? "1.8" : "1.75";
        const fw = isFirst ? "500" : ctx.typo.bodyWeight;
        const mb = isFirst ? px(24, ctx) : px(16, ctx);
        return `<p style="margin: 0 0 ${mb} 0; font-size: ${fs}; line-height: ${lh}; color: ${ctx.colors.text}; font-weight: ${fw}; letter-spacing: ${ctx.typo.letterSpacing};">${r3(text)}</p>`;
      }
    },
    // ── P06 两端对齐 ──
    {
      id: "justified",
      name: "\u4E24\u7AEF\u5BF9\u9F50",
      tags: ["academic", "formal", "serious"],
      render: (text, ctx) => `<p style="margin: 0 0 ${px(18, ctx)} 0; font-size: ${px(15, ctx)}; line-height: 1.85; color: ${ctx.colors.text}; font-weight: ${ctx.typo.bodyWeight}; letter-spacing: ${ctx.typo.letterSpacing}; text-align: justify;">${r3(text)}</p>`
    }
  ];

  // ../yuntype/src/lib/atoms/slots/section.ts
  var sectionSlots = [
    // ── S01 平铺无包裹 ──
    {
      id: "flat-flow",
      name: "\u5E73\u94FA\u65E0\u5305\u88F9",
      tags: ["minimal", "clean", "default"],
      render: (innerHtml) => innerHtml
    },
    // ── S02 卡片阴影 ──
    {
      id: "card-shadow",
      name: "\u5361\u7247\u9634\u5F71",
      tags: ["card", "modular", "structured"],
      render: (innerHtml, _heading, ctx) => `<section style="background: ${ctx.isDark ? "rgba(255,255,255,0.04)" : "#FFFFFF"}; border-radius: ${px(10, ctx)}; padding: ${px(20, ctx)}; margin: ${px(20, ctx)} 0; box-shadow: 0 ${px(2, ctx)} ${px(12, ctx)} rgba(0,0,0,${ctx.isDark ? "0.3" : "0.06"}); border: ${px(1, ctx)} solid rgba(${ctx.isDark ? "255,255,255,0.08" : "0,0,0,0.06"});">${innerHtml}</section>`
    },
    // ── S03 交替色带 ──
    {
      id: "alternating-bands",
      name: "\u4EA4\u66FF\u8272\u5E26",
      tags: ["structured", "colorful", "magazine"],
      render: (innerHtml, _heading, ctx, index) => {
        const isEven = index % 2 === 0;
        const bg = isEven ? "transparent" : ctx.colors.secondary;
        return `<section style="background: ${bg}; padding: ${isEven ? "0" : px(20, ctx)}; margin: ${isEven ? "0" : `${px(16, ctx)} -${px(20, ctx)}`}; border-radius: 0;">${innerHtml}</section>`;
      }
    },
    // ── S04 时间线轨道 ──
    {
      id: "timeline",
      name: "\u65F6\u95F4\u7EBF\u8F68\u9053",
      tags: ["timeline", "step-by-step", "structured"],
      render: (innerHtml, _heading, ctx, index) => `<section style="position: relative; padding-left: ${px(28, ctx)}; margin: ${px(16, ctx)} 0; border-left: ${px(2, ctx)} solid ${ctx.colors.secondary};">
  <span style="position: absolute; left: -${px(7, ctx)}; top: ${px(4, ctx)}; width: ${px(12, ctx)}; height: ${px(12, ctx)}; border-radius: 50%; background: ${ctx.colors.primary}; display: block;"></span>
  <span style="position: absolute; left: -${px(7, ctx)}; top: ${px(4, ctx)}; width: ${px(12, ctx)}; height: ${px(12, ctx)}; border-radius: 50%; background: ${ctx.colors.primary}; opacity: 0.3; display: block; transform: scale(1.6);"></span>
  <span style="font-size: ${px(12, ctx)}; color: ${ctx.colors.textMuted}; margin-bottom: ${px(4, ctx)}; display: block;">Step ${index + 1}</span>
  ${innerHtml}
</section>`
    },
    // ── S05 左侧标签 ──
    {
      id: "left-label",
      name: "\u5DE6\u4FA7\u6807\u7B7E",
      tags: ["professional", "business", "clean"],
      render: (innerHtml, heading, ctx) => `<section style="display: flex; gap: ${px(16, ctx)}; margin: ${px(20, ctx)} 0; align-items: flex-start;">
  ${heading ? `<span style="writing-mode: vertical-lr; font-size: ${px(12, ctx)}; color: ${ctx.colors.primary}; letter-spacing: ${px(2, ctx)}; white-space: nowrap; padding-top: ${px(4, ctx)}; border-right: ${px(2, ctx)} solid ${ctx.colors.primary}; padding-right: ${px(8, ctx)};">${heading}</span>` : ""}
  <section style="flex: 1;">${innerHtml}</section>
</section>`
    },
    // ── S06 分隔线段落 ──
    {
      id: "divider-separated",
      name: "\u5206\u9694\u7EBF\u6BB5\u843D",
      tags: ["clean", "editorial", "reading"],
      render: (innerHtml, _heading, ctx, index) => {
        const sep = index > 0 ? `<section style="border-top: ${px(1, ctx)} solid ${ctx.colors.secondary}; margin: ${px(24, ctx)} 0;"></section>` : "";
        return `${sep}${innerHtml}`;
      }
    }
  ];

  // ../yuntype/src/lib/atoms/slots/index.ts
  function px(base, ctx) {
    const s = ctx.scale ?? 1;
    return `${Math.round(base * s)}px`;
  }
  var slotRegistry = {
    title: titleSlots,
    quote: quoteSlots,
    list: listSlots,
    divider: dividerSlots,
    paragraph: paragraphSlots,
    section: sectionSlots
  };
  function getSlot(type, id) {
    const slots = slotRegistry[type];
    return slots.find((s) => s.id === id) ?? slots[0];
  }

  // ../yuntype/src/lib/media.ts
  function parseAnchoredMarkdown(markdown) {
    return parseMarkdown(markdown).map((node, anchorIndex) => ({ ...node, anchorIndex }));
  }
  function getPlacementAsset(assets, placement) {
    return assets.find((asset) => asset.id === placement.assetId);
  }
  function placementsForAnchor(placements, platform, anchorIndex, position) {
    return placements.filter(
      (placement) => placement.anchorIndex === anchorIndex && placement.position === position && placement.platforms.includes(platform)
    );
  }

  // ../yuntype/src/lib/render/wechat.ts
  function renderImage(node) {
    return `<section style="text-align: center; margin: 16px 0;"><img src="${node.src}" alt="${node.alt ?? ""}" style="max-width: 100%; border-radius: 4px;" /></section>`;
  }
  function groupSections(nodes) {
    const sections = [];
    let current = { heading: null, headingLevel: 0, headingAnchorIndex: null, nodes: [] };
    for (const node of nodes) {
      if (node.type === "heading" && (node.level ?? 3) <= 2) {
        if (current.heading !== null || current.nodes.length > 0) {
          sections.push(current);
        }
        current = {
          heading: node.text ?? "",
          headingLevel: node.level ?? 2,
          headingAnchorIndex: node.anchorIndex,
          nodes: []
        };
      } else {
        current.nodes.push(node);
      }
    }
    if (current.heading !== null || current.nodes.length > 0) {
      sections.push(current);
    }
    return sections;
  }
  function renderWechatV2(markdown, style, media) {
    const nodes = parseAnchoredMarkdown(markdown);
    const { color, typography, blueprint, slots } = style;
    const c = color.colors;
    const isDark = color.category === "dark";
    const ctx = {
      colors: c,
      typo: typography.wechat,
      isDark
    };
    const titleSlot = getSlot("title", slots.title);
    const quoteSlot = getSlot("quote", slots.quote);
    const listSlot = getSlot("list", slots.list);
    const dividerSlot = getSlot("divider", slots.divider);
    const paragraphSlot = getSlot("paragraph", slots.paragraph);
    const sectionSlot = getSlot("section", slots.section);
    const sections = groupSections(nodes);
    let headingIndex = 0;
    const sectionsHtml = sections.map((section, sIdx) => {
      let innerHtml = "";
      let isFirstParagraph = true;
      const renderMedia = (anchorIndex, position) => renderMediaPlacements(anchorIndex, position, media, ctx);
      if (section.heading) {
        if (section.headingAnchorIndex !== null) {
          innerHtml += renderMedia(section.headingAnchorIndex, "before");
        }
        innerHtml += titleSlot.render(section.heading, section.headingLevel, ctx, headingIndex);
        headingIndex++;
        if (section.headingAnchorIndex !== null) {
          innerHtml += renderMedia(section.headingAnchorIndex, "after");
        }
      }
      for (const node of section.nodes) {
        innerHtml += renderMedia(node.anchorIndex, "before");
        switch (node.type) {
          case "heading":
            innerHtml += titleSlot.render(node.text ?? "", node.level ?? 3, ctx, headingIndex);
            headingIndex++;
            break;
          case "paragraph":
            innerHtml += paragraphSlot.render(node.text ?? "", ctx, isFirstParagraph);
            isFirstParagraph = false;
            break;
          case "blockquote":
            innerHtml += quoteSlot.render(node.text ?? "", ctx);
            break;
          case "list":
            innerHtml += listSlot.render(node.children ?? [], node.ordered ?? false, ctx);
            break;
          case "code":
            innerHtml += renderCodeBlockV2(node, ctx);
            break;
          case "hr":
            innerHtml += dividerSlot.render(ctx);
            break;
          case "image":
            innerHtml += renderImage(node);
            break;
        }
        innerHtml += renderMedia(node.anchorIndex, "after");
      }
      return sectionSlot.render(innerHtml, section.heading, ctx, sIdx);
    }).join("");
    const containerCss = blueprint.containerStyle(c);
    return `<section style="${containerCss} padding: ${blueprint.contentPadding}; max-width: 100%; box-sizing: border-box; font-size: 15px; line-height: 1.75; letter-spacing: ${typography.wechat.letterSpacing}; font-weight: ${typography.wechat.bodyWeight};">${sectionsHtml}</section>`;
  }
  function renderMediaPlacements(anchorIndex, position, media, ctx) {
    if (!media) return "";
    return placementsForAnchor(media.placements, "wechat", anchorIndex, position).map((placement) => {
      const asset = getPlacementAsset(media.assets, placement);
      if (!asset) return "";
      const caption = placement.caption ?? asset.caption;
      const radius = placement.layout === "card" ? 12 : 6;
      const cardStyle = placement.layout === "card" ? `background:${ctx.colors.contentBg};padding:10px;border:1px solid ${ctx.colors.primary}20;border-radius:${radius}px;box-shadow:0 4px 18px rgba(0,0,0,0.06);` : "";
      return `
        <section style="margin:18px 0;text-align:center;${cardStyle}">
          <img src="${asset.url}" alt="${caption ?? asset.name}" style="max-width:100%;display:block;margin:0 auto;border-radius:${radius}px;" />
          ${caption ? `<p style="margin:8px 0 0;font-size:12px;line-height:1.5;color:${ctx.colors.textMuted};">${caption}</p>` : ""}
        </section>`;
    }).join("");
  }
  function renderCodeBlockV2(node, ctx) {
    const bgColor = ctx.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)";
    const textColor = ctx.isDark ? "#C8D0D8" : "#333333";
    const code = (node.text ?? "").replace(/</g, "<").replace(/>/g, ">");
    return `<section style="margin: 0 0 16px 0; background: ${bgColor}; padding: 12px 16px; border-radius: 4px; overflow: hidden;"><pre style="margin: 0; white-space: pre-wrap; word-break: break-all; font-size: 13px; line-height: 1.6; color: ${textColor}; font-family: Consolas, Monaco, 'Courier New', monospace;">${code}</pre></section>`;
  }

  // ../yuntype/src/lib/atoms/colors.ts
  var colorSchemes = [
    {
      id: "L1",
      name: "\u5976\u8336\u6E29\u67D4",
      category: "light",
      colors: {
        pageBg: "#FAF6F1",
        contentBg: "#FFFFFF",
        primary: "#C8A882",
        secondary: "#E8D5C0",
        accent: "#8B6914",
        text: "#4A3F35",
        textMuted: "#8C7B6B"
      },
      tags: ["warm", "feminine", "lifestyle"]
    },
    {
      id: "L2",
      name: "\u8584\u8377\u6E05\u65B0",
      category: "light",
      colors: {
        pageBg: "#F0FAF6",
        contentBg: "#FFFFFF",
        primary: "#2D9F83",
        secondary: "#B8E6D8",
        accent: "#1A7A5C",
        text: "#2C3E3A",
        textMuted: "#6B8F85"
      },
      tags: ["fresh", "health", "nature"]
    },
    {
      id: "L3",
      name: "\u871C\u6843\u6D3B\u529B",
      category: "light",
      colors: {
        pageBg: "#FFF5F0",
        contentBg: "#FFFFFF",
        primary: "#FF7B54",
        secondary: "#FFD4C2",
        accent: "#E85D3A",
        text: "#3D2C25",
        textMuted: "#9C7B6F"
      },
      tags: ["energetic", "young", "beauty"]
    },
    {
      id: "L4",
      name: "\u70DF\u7070\u9AD8\u7EA7",
      category: "light",
      colors: {
        pageBg: "#F5F5F3",
        contentBg: "#FFFFFF",
        primary: "#6B6B6B",
        secondary: "#E0E0DC",
        accent: "#3A3A3A",
        text: "#333333",
        textMuted: "#999999"
      },
      tags: ["business", "tech", "minimal"]
    },
    {
      id: "L5",
      name: "\u85E4\u7D2B\u6587\u827A",
      category: "light",
      colors: {
        pageBg: "#F8F4FA",
        contentBg: "#FFFFFF",
        primary: "#8B6AAE",
        secondary: "#E4D6F0",
        accent: "#6B4C8A",
        text: "#3A2D4A",
        textMuted: "#8A7A9C"
      },
      tags: ["literary", "art", "poetic"]
    },
    {
      id: "L6",
      name: "\u6D77\u76D0\u84DD\u8C03",
      category: "light",
      colors: {
        pageBg: "#F0F5FA",
        contentBg: "#FFFFFF",
        primary: "#3B7DD8",
        secondary: "#C5DAF0",
        accent: "#2B5EA8",
        text: "#2A3540",
        textMuted: "#7090A8"
      },
      tags: ["tech", "education", "professional"]
    },
    {
      id: "L7",
      name: "\u67E0\u6AAC\u9633\u5149",
      category: "light",
      colors: {
        pageBg: "#FFFCF0",
        contentBg: "#FFFFFF",
        primary: "#D4A017",
        secondary: "#F5E6B0",
        accent: "#B8860B",
        text: "#3A3520",
        textMuted: "#8A8060"
      },
      tags: ["warm", "parenting", "education"]
    },
    {
      id: "L8",
      name: "\u6A31\u82B1\u7269\u8BED",
      category: "light",
      colors: {
        pageBg: "#FFF5F8",
        contentBg: "#FFFFFF",
        primary: "#E07B9B",
        secondary: "#F8D7E2",
        accent: "#C45A7A",
        text: "#3D2A32",
        textMuted: "#9C7A88"
      },
      tags: ["feminine", "romantic", "emotional"]
    },
    {
      id: "D1",
      name: "\u58A8\u591C\u91D1\u5B57",
      category: "dark",
      colors: {
        pageBg: "#1A1A2E",
        contentBg: "#16213E",
        primary: "#E2B857",
        secondary: "#2A2A4A",
        accent: "#F0D078",
        text: "#D4D4D4",
        textMuted: "#8888AA"
      },
      tags: ["luxury", "business", "finance"]
    },
    {
      id: "D2",
      name: "\u6781\u591C\u6781\u5149",
      category: "dark",
      colors: {
        pageBg: "#0F0F1A",
        contentBg: "#1A1A2A",
        primary: "#00D4AA",
        secondary: "#1A2A35",
        accent: "#00FFCC",
        text: "#C8D0D8",
        textMuted: "#6A8090"
      },
      tags: ["tech", "geek", "programming"]
    },
    {
      id: "D3",
      name: "\u6DF1\u6D77\u58A8\u84DD",
      category: "dark",
      colors: {
        pageBg: "#0A1628",
        contentBg: "#12233D",
        primary: "#5BA4E6",
        secondary: "#1A3050",
        accent: "#7ABCF5",
        text: "#C0D0E0",
        textMuted: "#6080A0"
      },
      tags: ["academic", "analysis", "serious"]
    }
  ];

  // ../yuntype/src/lib/atoms/typography.ts
  var typographySets = [
    {
      id: "F1",
      name: "\u73B0\u4EE3\u7B80\u7EA6",
      wechat: {
        headingWeight: "700",
        bodyWeight: "400",
        letterSpacing: "0.5px"
      },
      xiaohongshu: {
        titleFont: "Smiley Sans",
        bodyFont: "Noto Sans SC",
        titleFontUrl: "https://cdn.jsdelivr.net/gh/atelier-anchor/smiley-sans@latest/dist/SmileySans-Oblique.ttf",
        bodyFontUrl: "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700&display=swap"
      },
      tags: ["modern", "clean", "sans-serif"]
    },
    {
      id: "F2",
      name: "\u6587\u827A\u4F18\u96C5",
      wechat: {
        headingWeight: "600",
        bodyWeight: "400",
        letterSpacing: "1px"
      },
      xiaohongshu: {
        titleFont: "LXGW WenKai",
        bodyFont: "Noto Serif SC",
        titleFontUrl: "https://cdn.jsdelivr.net/gh/lxgw/LxgwWenKai@latest/fonts/LXGWWenKai-Regular.ttf",
        bodyFontUrl: "https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700&display=swap"
      },
      tags: ["literary", "elegant", "serif"]
    },
    {
      id: "F3",
      name: "\u6D3B\u6CFC\u8DA3\u5473",
      wechat: {
        headingWeight: "800",
        bodyWeight: "400",
        letterSpacing: "0"
      },
      xiaohongshu: {
        titleFont: "ZCOOL KuaiLe",
        bodyFont: "Alibaba PuHuiTi",
        titleFontUrl: "https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap",
        bodyFontUrl: "https://fonts.googleapis.com/css2?family=Alibaba+PuHuiTi:wght@400;700&display=swap"
      },
      tags: ["playful", "fun", "rounded"]
    }
  ];

  // ../yuntype/src/lib/atoms/blueprints.ts
  var blueprints = [
    // ═══════════ 极简系 ═══════════
    {
      id: "B01",
      name: "\u6781\u7B80\u6E05\u723D",
      desc: "\u65E0\u88C5\u9970\uFF0C\u5185\u5BB9\u4E3A\u738B",
      icon: "\u{1F4DD}",
      defaultSlots: {
        title: "left-underline",
        quote: "left-bar",
        list: "dot",
        divider: "thin-line",
        paragraph: "compact",
        section: "flat-flow"
      },
      containerStyle: (c) => `background-color: ${c.contentBg}; color: ${c.text};`,
      contentPadding: "16px 20px",
      tags: ["minimal", "clean", "professional"],
      xhs: {
        coverVariant: "minimal",
        contentLayout: "standard",
        pageDecoration: { headerBar: false, footerLine: true, pageNumberStyle: "right", brandPosition: "bottom-center" },
        endingStyle: "minimal"
      }
    },
    {
      id: "B02",
      name: "\u65E5\u5F0F\u7559\u767D",
      desc: "\u5927\u91CF\u7559\u767D\uFF0C\u7985\u610F\u547C\u5438\u611F",
      icon: "\u{1F375}",
      defaultSlots: {
        title: "zen-minimal",
        quote: "dashed-frame",
        list: "dash-prefix",
        divider: "single-circle",
        paragraph: "airy-wide",
        section: "flat-flow"
      },
      containerStyle: (c) => `background-color: ${c.contentBg}; color: ${c.text};`,
      contentPadding: "24px 28px",
      tags: ["japanese", "minimal", "elegant"],
      xhs: {
        coverVariant: "minimal",
        contentLayout: "standard",
        pageDecoration: { headerBar: false, footerLine: false, pageNumberStyle: "center", brandPosition: "bottom-center" },
        endingStyle: "minimal"
      }
    },
    // ═══════════ 线条系 ═══════════
    {
      id: "B03",
      name: "\u7EBF\u6761\u4E3B\u5BFC",
      desc: "\u4EE5\u7EBF\u6761\u5206\u5272\u548C\u5F3A\u8C03\u7ED3\u6784",
      icon: "\u{1F4CF}",
      defaultSlots: {
        title: "left-underline",
        quote: "left-bar",
        list: "arrow",
        divider: "gradient-line",
        paragraph: "compact",
        section: "divider-separated"
      },
      containerStyle: (c) => `background-color: ${c.contentBg}; color: ${c.text};`,
      contentPadding: "16px 20px",
      tags: ["structured", "clean", "professional"],
      xhs: {
        coverVariant: "classic",
        contentLayout: "standard",
        pageDecoration: { headerBar: true, footerLine: true, pageNumberStyle: "right", brandPosition: "bottom-right" },
        endingStyle: "standard"
      }
    },
    {
      id: "B04",
      name: "\u53CC\u7EBF\u5B66\u672F",
      desc: "\u53CC\u7EBF\u6846 + \u4E24\u7AEF\u5BF9\u9F50\uFF0C\u8BBA\u6587\u98CE",
      icon: "\u{1F393}",
      defaultSlots: {
        title: "double-border",
        quote: "double-border",
        list: "circle-number",
        divider: "double-line",
        paragraph: "justified",
        section: "flat-flow"
      },
      containerStyle: (c) => `background-color: ${c.contentBg}; color: ${c.text};`,
      contentPadding: "20px 24px",
      tags: ["academic", "formal", "serious"],
      xhs: {
        coverVariant: "magazine",
        contentLayout: "standard",
        pageDecoration: { headerBar: true, footerLine: true, pageNumberStyle: "fraction", brandPosition: "bottom-center" },
        endingStyle: "standard"
      }
    },
    // ═══════════ 色块系 ═══════════
    {
      id: "B05",
      name: "\u8272\u5757\u6807\u7B7E",
      desc: "\u6807\u9898\u7528\u8272\u5757\u9AD8\u4EAE\uFF0C\u73B0\u4EE3\u611F\u5F3A",
      icon: "\u{1F3F7}\uFE0F",
      defaultSlots: {
        title: "color-badge",
        quote: "rounded-card",
        list: "square",
        divider: "thick-line",
        paragraph: "compact",
        section: "flat-flow"
      },
      containerStyle: (c) => `background-color: ${c.contentBg}; color: ${c.text};`,
      contentPadding: "16px 20px",
      tags: ["modern", "colorful", "design"],
      xhs: {
        coverVariant: "bold",
        contentLayout: "standard",
        pageDecoration: { headerBar: true, footerLine: false, pageNumberStyle: "right", brandPosition: "bottom-right" },
        endingStyle: "standard"
      }
    },
    {
      id: "B06",
      name: "\u4EA4\u66FF\u8272\u5E26",
      desc: "\u5947\u5076\u8282\u533A\u4EA4\u66FF\u5E95\u8272",
      icon: "\u{1F308}",
      defaultSlots: {
        title: "left-bar",
        quote: "rounded-card",
        list: "dot",
        divider: "thin-line",
        paragraph: "compact",
        section: "alternating-bands"
      },
      containerStyle: (c) => `background-color: ${c.contentBg}; color: ${c.text};`,
      contentPadding: "16px 20px",
      tags: ["structured", "colorful", "magazine"],
      xhs: {
        coverVariant: "classic",
        contentLayout: "alternating-bg",
        pageDecoration: { headerBar: false, footerLine: true, pageNumberStyle: "center", brandPosition: "bottom-center" },
        endingStyle: "standard"
      }
    },
    // ═══════════ 卡片系 ═══════════
    {
      id: "B07",
      name: "\u5361\u7247\u6A21\u5757",
      desc: "\u6BCF\u8282\u72EC\u7ACB\u5361\u7247\uFF0C\u6E05\u6670\u5206\u533A",
      icon: "\u{1F0CF}",
      defaultSlots: {
        title: "left-bar",
        quote: "highlight-box",
        list: "card-items",
        divider: "dots",
        paragraph: "compact",
        section: "card-shadow"
      },
      containerStyle: (c) => `background-color: ${c.pageBg}; color: ${c.text};`,
      contentPadding: "12px 16px",
      tags: ["card", "modular", "structured"],
      xhs: {
        coverVariant: "card",
        contentLayout: "card-wrapped",
        pageDecoration: { headerBar: false, footerLine: false, pageNumberStyle: "dot", brandPosition: "bottom-center" },
        endingStyle: "card"
      }
    },
    {
      id: "B08",
      name: "\u6C14\u6CE1\u5706\u6DA6",
      desc: "\u5706\u89D2\u6C14\u6CE1\u5305\u88F9\uFF0C\u4EB2\u548C\u529B\u5F3A",
      icon: "\u{1F4AC}",
      defaultSlots: {
        title: "bubble",
        quote: "bubble",
        list: "diamond",
        divider: "dots",
        paragraph: "compact",
        section: "card-shadow"
      },
      containerStyle: (c) => `background-color: ${c.pageBg}; color: ${c.text};`,
      contentPadding: "12px 16px",
      tags: ["friendly", "warm", "cute"],
      xhs: {
        coverVariant: "card",
        contentLayout: "card-wrapped",
        pageDecoration: { headerBar: false, footerLine: false, pageNumberStyle: "dot", brandPosition: "bottom-center" },
        endingStyle: "card"
      }
    },
    // ═══════════ 杂志系 ═══════════
    {
      id: "B09",
      name: "\u6742\u5FD7\u7F16\u8F91",
      desc: "\u9996\u6BB5\u653E\u5927 + Pull-quote \u5C45\u4E2D\u5F15\u8FF0",
      icon: "\u{1F4F0}",
      defaultSlots: {
        title: "banner-full",
        quote: "pull-quote",
        list: "arrow",
        divider: "gradient-line",
        paragraph: "lead-paragraph",
        section: "flat-flow"
      },
      containerStyle: (c) => `background-color: ${c.contentBg}; color: ${c.text};`,
      contentPadding: "20px 24px",
      tags: ["magazine", "editorial", "premium"],
      xhs: {
        coverVariant: "magazine",
        contentLayout: "standard",
        pageDecoration: { headerBar: true, footerLine: true, pageNumberStyle: "fraction", brandPosition: "bottom-right" },
        endingStyle: "standard"
      }
    },
    {
      id: "B10",
      name: "\u9996\u5B57\u4E0B\u6C89",
      desc: "\u9996\u6BB5\u9996\u5B57\u653E\u5927\uFF0C\u53E4\u5178\u6742\u5FD7\u611F",
      icon: "\u{1F524}",
      defaultSlots: {
        title: "center-symmetric",
        quote: "big-quotes",
        list: "dot",
        divider: "ornament",
        paragraph: "drop-cap",
        section: "divider-separated"
      },
      containerStyle: (c) => `background-color: ${c.contentBg}; color: ${c.text};`,
      contentPadding: "20px 24px",
      tags: ["literary", "editorial", "classic"],
      xhs: {
        coverVariant: "classic",
        contentLayout: "standard",
        pageDecoration: { headerBar: false, footerLine: true, pageNumberStyle: "center", brandPosition: "bottom-center" },
        endingStyle: "standard"
      }
    },
    // ═══════════ 结构系 ═══════════
    {
      id: "B11",
      name: "\u7F16\u53F7\u6B65\u9AA4",
      desc: "\u6807\u9898\u81EA\u52A8\u7F16\u53F7\uFF0C\u6559\u7A0B\u98CE\u683C",
      icon: "\u{1F522}",
      defaultSlots: {
        title: "numbered",
        quote: "highlight-box",
        list: "checklist",
        divider: "thin-line",
        paragraph: "compact",
        section: "flat-flow"
      },
      containerStyle: (c) => `background-color: ${c.contentBg}; color: ${c.text};`,
      contentPadding: "16px 20px",
      tags: ["tutorial", "step-by-step", "structured"],
      xhs: {
        coverVariant: "bold",
        contentLayout: "standard",
        pageDecoration: { headerBar: true, footerLine: false, pageNumberStyle: "right", brandPosition: "bottom-right" },
        endingStyle: "standard"
      }
    },
    {
      id: "B12",
      name: "\u65F6\u95F4\u7EBF",
      desc: "\u5DE6\u4FA7\u8F68\u9053 + \u5706\u70B9\u8282\u70B9",
      icon: "\u{1F4CD}",
      defaultSlots: {
        title: "left-bar",
        quote: "left-bar",
        list: "arrow",
        divider: "dots",
        paragraph: "compact",
        section: "timeline"
      },
      containerStyle: (c) => `background-color: ${c.contentBg}; color: ${c.text};`,
      contentPadding: "16px 20px 16px 8px",
      tags: ["timeline", "step-by-step", "structured"],
      xhs: {
        coverVariant: "classic",
        contentLayout: "timeline-rail",
        pageDecoration: { headerBar: false, footerLine: true, pageNumberStyle: "right", brandPosition: "bottom-center" },
        endingStyle: "standard"
      }
    },
    // ═══════════ 文学系 ═══════════
    {
      id: "B13",
      name: "\u6587\u827A\u6563\u6587",
      desc: "\u5C45\u4E2D\u6807\u9898 + \u9996\u884C\u7F29\u8FDB + \u5927\u5F15\u53F7",
      icon: "\u2712\uFE0F",
      defaultSlots: {
        title: "center-symmetric",
        quote: "big-quotes",
        list: "dash-prefix",
        divider: "ornament",
        paragraph: "indented",
        section: "flat-flow"
      },
      containerStyle: (c) => `background-color: ${c.contentBg}; color: ${c.text};`,
      contentPadding: "20px 28px",
      tags: ["literary", "poetic", "elegant"],
      xhs: {
        coverVariant: "minimal",
        contentLayout: "standard",
        pageDecoration: { headerBar: false, footerLine: false, pageNumberStyle: "center", brandPosition: "bottom-center" },
        endingStyle: "minimal"
      }
    },
    // ═══════════ 商务系 ═══════════
    {
      id: "B14",
      name: "\u5546\u52A1\u5DE6\u6807\u7B7E",
      desc: "\u5DE6\u4FA7\u7AD6\u6392\u6807\u7B7E + \u53F3\u4FA7\u5185\u5BB9",
      icon: "\u{1F4BC}",
      defaultSlots: {
        title: "left-bar",
        quote: "highlight-box",
        list: "square",
        divider: "thin-line",
        paragraph: "justified",
        section: "left-label"
      },
      containerStyle: (c) => `background-color: ${c.contentBg}; color: ${c.text};`,
      contentPadding: "16px 20px",
      tags: ["business", "professional", "clean"],
      xhs: {
        coverVariant: "classic",
        contentLayout: "standard",
        pageDecoration: { headerBar: true, footerLine: true, pageNumberStyle: "right", brandPosition: "bottom-right" },
        endingStyle: "standard"
      }
    },
    // ═══════════ 几何系 ═══════════
    {
      id: "B15",
      name: "\u51E0\u4F55\u88C5\u9970",
      desc: "\u25C6\u25B8\u25C7 \u51E0\u4F55\u56FE\u5F62\u70B9\u7F00",
      icon: "\u{1F537}",
      defaultSlots: {
        title: "geometric-prefix",
        quote: "double-border",
        list: "arrow",
        divider: "diamond",
        paragraph: "compact",
        section: "flat-flow"
      },
      containerStyle: (c) => `background-color: ${c.contentBg}; color: ${c.text};`,
      contentPadding: "16px 20px",
      tags: ["geometric", "unique", "design"],
      xhs: {
        coverVariant: "bold",
        contentLayout: "standard",
        pageDecoration: { headerBar: true, footerLine: true, pageNumberStyle: "right", brandPosition: "bottom-right" },
        endingStyle: "standard"
      }
    }
  ];
  function getBlueprint(id) {
    return blueprints.find((b) => b.id === id) ?? blueprints[0];
  }

  // ../yuntype/src/lib/atoms/coordination.ts
  function tagAffinity(tagsA, tagsB) {
    let score = 0;
    for (const t of tagsA) {
      if (tagsB.includes(t)) score++;
    }
    return score;
  }
  function mergeTags(...tagArrays) {
    const set = /* @__PURE__ */ new Set();
    for (const tags of tagArrays) {
      for (const t of tags) set.add(t);
    }
    return [...set];
  }
  function weightedPick(items, weight, baseWeight = 1, affinityBoost = 3) {
    const weights = items.map((item) => baseWeight + affinityBoost * weight(item));
    const total = weights.reduce((sum, w) => sum + w, 0);
    let r4 = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
      r4 -= weights[i];
      if (r4 <= 0) return items[i];
    }
    return items[items.length - 1];
  }
  function pickColor(seedTags) {
    return weightedPick(colorSchemes, (c) => tagAffinity(c.tags, seedTags));
  }
  function pickTypography(seedTags) {
    return weightedPick(typographySets, (t) => tagAffinity(t.tags, seedTags));
  }
  function pickSlotVariant(type, seedTags) {
    const variants = slotRegistry[type];
    const picked = weightedPick(
      [...variants],
      (v) => tagAffinity(v.tags, seedTags)
    );
    return picked.id;
  }
  function pickAllSlots(seedTags) {
    return {
      title: pickSlotVariant("title", seedTags),
      quote: pickSlotVariant("quote", seedTags),
      list: pickSlotVariant("list", seedTags),
      divider: pickSlotVariant("divider", seedTags),
      paragraph: pickSlotVariant("paragraph", seedTags),
      section: pickSlotVariant("section", seedTags)
    };
  }
  function coordinatedPick() {
    const bp = blueprints[Math.floor(Math.random() * blueprints.length)];
    const color = pickColor(bp.tags);
    const tagsL2 = mergeTags(bp.tags, color.tags);
    const typo = pickTypography(tagsL2);
    const tagsL3 = mergeTags(bp.tags, color.tags, typo.tags);
    const slots = pickAllSlots(tagsL3);
    return {
      colorId: color.id,
      typographyId: typo.id,
      blueprintId: bp.id,
      slots
    };
  }

  // ../yuntype/src/lib/atoms/presets-v2.ts
  var scenePresetsV2 = [
    {
      id: "SP01",
      name: "\u6587\u827A\u6563\u6587",
      nameEn: "Literary Prose",
      emoji: "\u2712\uFE0F",
      desc: "\u85E4\u7D2B\u914D\u8272 + \u6587\u827A\u5B57\u4F53\uFF0C\u9002\u5408\u6563\u6587\u3001\u8BD7\u6B4C\u3001\u8BFB\u4E66\u7B14\u8BB0",
      ids: {
        blueprintId: "B13",
        colorId: "L5",
        typographyId: "F2",
        slots: { title: "center-symmetric", quote: "big-quotes", list: "dash-prefix", divider: "ornament", paragraph: "indented", section: "flat-flow" }
      },
      sceneTags: ["literary", "poetic", "elegant", "art"]
    },
    {
      id: "SP02",
      name: "\u5546\u52A1\u7B80\u7EA6",
      nameEn: "Business Clean",
      emoji: "\u{1F4BC}",
      desc: "\u70DF\u7070\u914D\u8272 + \u73B0\u4EE3\u5B57\u4F53\uFF0C\u9002\u5408\u5546\u52A1\u5206\u6790\u3001\u5DE5\u4F5C\u603B\u7ED3",
      ids: {
        blueprintId: "B14",
        colorId: "L4",
        typographyId: "F1",
        slots: { title: "left-bar", quote: "highlight-box", list: "square", divider: "thin-line", paragraph: "justified", section: "left-label" }
      },
      sceneTags: ["business", "professional", "clean", "tech"]
    },
    {
      id: "SP03",
      name: "\u7985\u610F\u7559\u767D",
      nameEn: "Zen Minimal",
      emoji: "\u{1F375}",
      desc: "\u5976\u8336\u914D\u8272 + \u65E5\u5F0F\u7559\u767D\uFF0C\u9002\u5408\u751F\u6D3B\u611F\u609F\u3001\u6162\u8282\u594F\u5185\u5BB9",
      ids: {
        blueprintId: "B02",
        colorId: "L1",
        typographyId: "F2",
        slots: { title: "zen-minimal", quote: "dashed-frame", list: "dash-prefix", divider: "single-circle", paragraph: "airy-wide", section: "flat-flow" }
      },
      sceneTags: ["japanese", "minimal", "warm", "lifestyle"]
    },
    {
      id: "SP04",
      name: "\u6742\u5FD7\u7F16\u8F91",
      nameEn: "Magazine Editorial",
      emoji: "\u{1F4F0}",
      desc: "\u84DD\u8C03\u914D\u8272 + \u9996\u5B57\u653E\u5927\uFF0C\u9002\u5408\u4E13\u9898\u62A5\u9053\u3001\u6DF1\u5EA6\u5206\u6790",
      ids: {
        blueprintId: "B09",
        colorId: "L6",
        typographyId: "F1",
        slots: { title: "banner-full", quote: "pull-quote", list: "arrow", divider: "gradient-line", paragraph: "lead-paragraph", section: "flat-flow" }
      },
      sceneTags: ["magazine", "editorial", "premium", "professional"]
    },
    {
      id: "SP05",
      name: "\u5B66\u672F\u8BBA\u6587",
      nameEn: "Academic Paper",
      emoji: "\u{1F393}",
      desc: "\u6DF1\u6D77\u914D\u8272 + \u53CC\u7EBF\u6846\u67B6\uFF0C\u9002\u5408\u8BBA\u6587\u7B14\u8BB0\u3001\u5B66\u672F\u603B\u7ED3",
      ids: {
        blueprintId: "B04",
        colorId: "D3",
        typographyId: "F1",
        slots: { title: "double-border", quote: "double-border", list: "circle-number", divider: "double-line", paragraph: "justified", section: "flat-flow" }
      },
      sceneTags: ["academic", "formal", "serious", "analysis"]
    },
    {
      id: "SP06",
      name: "\u5361\u7247\u6A21\u5757",
      nameEn: "Card Modular",
      emoji: "\u{1F0CF}",
      desc: "\u8584\u8377\u914D\u8272 + \u5361\u7247\u9634\u5F71\uFF0C\u9002\u5408\u77E5\u8BC6\u5361\u7247\u3001\u4FE1\u606F\u6574\u7406",
      ids: {
        blueprintId: "B07",
        colorId: "L2",
        typographyId: "F1",
        slots: { title: "left-bar", quote: "highlight-box", list: "card-items", divider: "dots", paragraph: "compact", section: "card-shadow" }
      },
      sceneTags: ["card", "modular", "structured", "fresh"]
    },
    {
      id: "SP07",
      name: "\u6D3B\u6CFC\u8DA3\u5473",
      nameEn: "Playful Fun",
      emoji: "\u{1F351}",
      desc: "\u871C\u6843\u914D\u8272 + \u6C14\u6CE1\u5706\u6DA6\uFF0C\u9002\u5408\u751F\u6D3B\u5206\u4EAB\u3001\u7F8E\u98DF\u63A2\u5E97",
      ids: {
        blueprintId: "B08",
        colorId: "L3",
        typographyId: "F3",
        slots: { title: "bubble", quote: "bubble", list: "diamond", divider: "dots", paragraph: "compact", section: "card-shadow" }
      },
      sceneTags: ["friendly", "warm", "cute", "young", "beauty"]
    },
    {
      id: "SP08",
      name: "\u6559\u7A0B\u653B\u7565",
      nameEn: "Tutorial Guide",
      emoji: "\u{1F4DD}",
      desc: "\u84DD\u8C03\u914D\u8272 + \u7F16\u53F7\u6B65\u9AA4\uFF0C\u9002\u5408\u6559\u7A0B\u3001\u5E72\u8D27\u653B\u7565",
      ids: {
        blueprintId: "B11",
        colorId: "L6",
        typographyId: "F1",
        slots: { title: "numbered", quote: "highlight-box", list: "checklist", divider: "thin-line", paragraph: "compact", section: "flat-flow" }
      },
      sceneTags: ["tutorial", "step-by-step", "structured", "education"]
    },
    {
      id: "SP09",
      name: "\u6697\u591C\u91D1\u5B57",
      nameEn: "Midnight Gold",
      emoji: "\u{1F319}",
      desc: "\u91D1\u5B57\u914D\u8272 + \u7EBF\u6761\u4E3B\u5BFC\uFF0C\u9002\u5408\u9AD8\u7AEF\u54C1\u724C\u3001\u5962\u534E\u8C03\u6027",
      ids: {
        blueprintId: "B03",
        colorId: "D1",
        typographyId: "F2",
        slots: { title: "left-underline", quote: "left-bar", list: "arrow", divider: "gradient-line", paragraph: "compact", section: "divider-separated" }
      },
      sceneTags: ["luxury", "business", "finance", "premium"]
    },
    {
      id: "SP10",
      name: "\u6A31\u82B1\u6D6A\u6F2B",
      nameEn: "Sakura Romance",
      emoji: "\u{1F338}",
      desc: "\u6A31\u82B1\u914D\u8272 + \u6587\u827A\u5B57\u4F53\uFF0C\u9002\u5408\u60C5\u611F\u6587\u7AE0\u3001\u5973\u6027\u5411\u5185\u5BB9",
      ids: {
        blueprintId: "B13",
        colorId: "L8",
        typographyId: "F2",
        slots: { title: "center-symmetric", quote: "big-quotes", list: "dash-prefix", divider: "ornament", paragraph: "indented", section: "flat-flow" }
      },
      sceneTags: ["feminine", "romantic", "emotional", "literary"]
    }
  ];
  var SCENE_TAG_KEYWORDS = {
    // 文学 / 情感
    literary: ["\u6563\u6587", "\u8BD7\u6B4C", "\u6587\u5B66", "\u5C0F\u8BF4", "\u8BFB\u4E66", "\u4E66\u8BC4", "\u6587\u5B57", "\u521B\u4F5C", "\u7B14\u8BB0"],
    poetic: ["\u8BD7", "\u8BD7\u610F", "\u610F\u5883", "\u8BCD", "\u53E4\u98CE", "\u97F5\u5473"],
    romantic: ["\u7231\u60C5", "\u604B\u7231", "\u6D6A\u6F2B", "\u544A\u767D", "\u7EA6\u4F1A", "\u60C5\u611F", "\u6E29\u67D4", "\u5FC3\u52A8"],
    emotional: ["\u611F\u52A8", "\u6CEA", "\u601D\u5FF5", "\u6000\u5FF5", "\u79BB\u522B", "\u6210\u957F", "\u6CBB\u6108"],
    elegant: ["\u4F18\u96C5", "\u7CBE\u81F4", "\u683C\u8C03", "\u54C1\u5473", "\u7F8E\u5B66"],
    // 商务 / 专业
    business: ["\u5546\u52A1", "\u4F1A\u8BAE", "\u62A5\u544A", "\u65B9\u6848", "\u7B56\u5212", "\u7BA1\u7406", "\u56E2\u961F", "\u5E02\u573A", "\u8FD0\u8425"],
    professional: ["\u4E13\u4E1A", "\u6548\u7387", "\u5206\u6790", "\u6570\u636E", "\u6218\u7565", "\u89C4\u5212", "\u9879\u76EE"],
    finance: ["\u91D1\u878D", "\u6295\u8D44", "\u7406\u8D22", "\u57FA\u91D1", "\u80A1\u7968", "\u8D22\u62A5", "\u7ECF\u6D4E"],
    tech: ["\u6280\u672F", "\u5F00\u53D1", "\u7A0B\u5E8F", "\u4EE3\u7801", "\u8F6F\u4EF6", "\u7CFB\u7EDF", "\u67B6\u6784", "AI", "\u4EBA\u5DE5\u667A\u80FD"],
    // 教育 / 学术
    academic: ["\u8BBA\u6587", "\u7814\u7A76", "\u5B66\u672F", "\u671F\u520A", "\u5F15\u7528", "\u5B9E\u9A8C", "\u7406\u8BBA"],
    education: ["\u6559\u80B2", "\u5B66\u4E60", "\u8BFE\u7A0B", "\u8003\u8BD5", "\u77E5\u8BC6", "\u8003\u7814", "\u82F1\u8BED", "\u7559\u5B66"],
    tutorial: ["\u6559\u7A0B", "\u653B\u7565", "\u6B65\u9AA4", "\u65B9\u6CD5", "\u6280\u5DE7", "\u6307\u5357", "\u5165\u95E8", "\u5B9E\u64CD"],
    // 生活 / 美食
    lifestyle: ["\u751F\u6D3B", "\u65E5\u5E38", "\u5BB6\u5C45", "\u597D\u7269", "\u79CD\u8349", "\u63A8\u8350", "\u5B89\u5229"],
    warm: ["\u6E29\u6696", "\u5E78\u798F", "\u966A\u4F34", "\u5BB6\u4EBA", "\u5988\u5988", "\u5C0F\u786E\u5E78"],
    fresh: ["\u6E05\u65B0", "\u81EA\u7136", "\u690D\u7269", "\u68EE\u6797", "\u7530\u56ED", "\u7EFF\u8272", "\u6625\u5929"],
    health: ["\u5065\u5EB7", "\u8FD0\u52A8", "\u5065\u8EAB", "\u745C\u4F3D", "\u517B\u751F", "\u996E\u98DF"],
    nature: ["\u81EA\u7136", "\u65C5\u884C", "\u98CE\u666F", "\u6237\u5916", "\u9732\u8425", "\u5C71", "\u6D77"],
    // 美妆 / 时尚
    beauty: ["\u7F8E\u5986", "\u62A4\u80A4", "\u5316\u5986", "\u53E3\u7EA2", "\u9762\u819C", "\u7CBE\u534E", "\u7A7F\u642D"],
    feminine: ["\u5973\u6027", "\u5973\u751F", "\u95FA\u871C", "\u5C11\u5973", "\u751C\u7F8E", "\u53EF\u7231"],
    young: ["\u9752\u6625", "\u5927\u5B66", "\u6821\u56ED", "\u6D3B\u529B", "\u5143\u6C14", "\u5FEB\u4E50"],
    // 美食
    cute: ["\u840C", "\u53EF\u7231", "\u5361\u901A", "\u624B\u8D26", "\u624B\u7ED8", "\u8D34\u7EB8"],
    friendly: ["\u5206\u4EAB", "\u4E92\u52A8", "\u63A8\u8350", "\u4F53\u9A8C", "\u6D4B\u8BC4", "\u6253\u5361", "\u63A2\u5E97"],
    // 杂志 / 高级
    magazine: ["\u6742\u5FD7", "\u4E13\u9898", "\u5C01\u9762", "\u6392\u7248", "\u8BBE\u8BA1", "\u89C6\u89C9"],
    editorial: ["\u7F16\u8F91", "\u6DF1\u5EA6", "\u8C03\u67E5", "\u8BC4\u8BBA", "\u89C2\u70B9", "\u6D1E\u5BDF"],
    premium: ["\u9AD8\u7AEF", "\u5962\u534E", "\u54C1\u724C", "\u8D28\u611F", "\u5B9A\u5236", "\u9650\u91CF"],
    luxury: ["\u5962\u4F88", "\u540D\u724C", "\u8C6A\u534E", "\u7CBE\u54C1", "\u94BB\u77F3", "\u91D1\u8272"],
    // 结构 / 卡片
    structured: ["\u6E05\u5355", "\u5217\u8868", "\u5206\u7C7B", "\u6574\u7406", "\u5F52\u7EB3", "\u603B\u7ED3"],
    modular: ["\u6A21\u5757", "\u5361\u7247", "\u4FE1\u606F", "\u6570\u636E", "\u56FE\u8868"],
    minimal: ["\u6781\u7B80", "\u7B80\u7EA6", "\u7559\u767D", "\u7EAF\u51C0", "\u7D20\u96C5"],
    "step-by-step": ["\u6B65\u9AA4", "\u6D41\u7A0B", "\u9636\u6BB5", "\u7B2C\u4E00\u6B65", "\u63A5\u4E0B\u6765"],
    // 设计 / 几何
    design: ["\u8BBE\u8BA1", "\u521B\u610F", "\u7075\u611F", "\u914D\u8272", "\u6392\u7248", "\u6D77\u62A5"],
    geometric: ["\u51E0\u4F55", "\u56FE\u5F62", "\u7EBF\u6761", "\u5BF9\u79F0", "\u56FE\u6848"],
    // 日式
    japanese: ["\u65E5\u5F0F", "\u548C\u98CE", "\u7985", "\u4F98\u5BC2", "\u67AF\u5C71\u6C34", "\u62B9\u8336"],
    // 时间线
    timeline: ["\u65F6\u95F4\u7EBF", "\u5386\u53F2", "\u5E74\u8868", "\u56DE\u987E", "\u7F16\u5E74", "\u53D1\u5C55"],
    // 育儿
    parenting: ["\u80B2\u513F", "\u5B9D\u5B9D", "\u4EB2\u5B50", "\u513F\u7AE5", "\u6BCD\u5A74", "\u65E9\u6559"],
    // 编程
    programming: ["\u7F16\u7A0B", "\u4EE3\u7801", "\u5F00\u53D1\u8005", "\u524D\u7AEF", "\u540E\u7AEF", "\u6570\u636E\u5E93", "Python", "JavaScript"],
    geek: ["\u6781\u5BA2", "\u9ED1\u5BA2", "\u5F00\u6E90", "\u7EC8\u7AEF", "\u547D\u4EE4\u884C"]
  };
  function analyzeArticleTags(article) {
    if (!article || article.length < 10) return [];
    const tagScores = /* @__PURE__ */ new Map();
    for (const [tag, keywords] of Object.entries(SCENE_TAG_KEYWORDS)) {
      let score = 0;
      for (const kw of keywords) {
        const matches = article.split(kw).length - 1;
        score += Math.min(matches, 3);
      }
      if (score > 0) {
        tagScores.set(tag, score);
      }
    }
    return [...tagScores.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
  }
  function recommendPresets(article) {
    const articleTags = analyzeArticleTags(article);
    if (articleTags.length === 0) return scenePresetsV2.slice(0, 5);
    const scored = scenePresetsV2.map((preset) => {
      let score = 0;
      for (const st of preset.sceneTags) {
        const idx = articleTags.indexOf(st);
        if (idx !== -1) {
          score += articleTags.length - idx;
        }
      }
      return { preset, score };
    });
    return scored.sort((a, b) => b.score - a.score).slice(0, 5).map((s) => s.preset);
  }

  // ../yuntype/src/lib/atoms/index.ts
  function getStyleComboV2(ids) {
    const bp = getBlueprint(ids.blueprintId);
    const baseColor = colorSchemes.find((c) => c.id === ids.colorId) ?? colorSchemes[0];
    const color = ids.colorOverride ? { ...baseColor, colors: { ...baseColor.colors, ...ids.colorOverride } } : baseColor;
    return {
      color,
      typography: typographySets.find((t) => t.id === ids.typographyId) ?? typographySets[0],
      blueprint: bp,
      slots: ids.slots
    };
  }
  function randomAtomIdsV2() {
    return coordinatedPick();
  }
  function getComboNameV2(ids) {
    const combo = getStyleComboV2(ids);
    return `${combo.blueprint.icon} ${combo.blueprint.name} \xB7 ${combo.color.name} \xB7 ${combo.typography.name}`;
  }
  var TOTAL_COMBOS_V2 = blueprints.length * colorSchemes.length * typographySets.length;
  function defaultAtomIdsV2() {
    const bp = blueprints[0];
    return {
      colorId: "L1",
      typographyId: "F1",
      blueprintId: bp.id,
      slots: { ...bp.defaultSlots }
    };
  }

  // engine/entry.ts
  var YunType = {
    renderWechatV2,
    getStyleComboV2,
    defaultAtomIdsV2,
    randomAtomIdsV2,
    getComboNameV2,
    blueprints,
    colorSchemes,
    typographySets,
    TOTAL_COMBOS_V2,
    analyzeArticleTags,
    recommendPresets
  };
  globalThis.YunType = YunType;
})();
