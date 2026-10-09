/* Shared sanitizer in extension pages and isolated content-script worlds. */
globalThis.DraftHTML = (() => {
  const tags = new Set(
    "section div p span h1 h2 h3 h4 h5 h6 strong b em i u s del br hr ul ol li blockquote pre code table thead tbody tr th td img a figure figcaption sup sub".split(
      " ",
    ),
  );
  const attrs = new Set(
    "style title alt width height colspan rowspan align".split(" "),
  );
  function safeURL(value, image = false) {
    const url = String(value).replace(/[\u0000-\u0020\u007f]/g, "");
    if (/^https?:\/\//i.test(url)) {
      try {
        return ["http:", "https:"].includes(new URL(url).protocol);
      } catch {
        return false;
      }
    }
    return (
      image &&
      (/^asset:\/\/[a-f0-9]{64}$/.test(url) ||
        /^data:image\/(png|jpeg|gif|webp);base64,[a-z\d+/=]+$/i.test(url))
    );
  }
  function sanitize(html) {
    const template = document.createElement("template");
    template.innerHTML = String(html || "");
    template.content
      .querySelectorAll(
        "script,iframe,object,embed,form,input,button,textarea,select,style,link,meta,base,svg,math,template",
      )
      .forEach((el) => el.remove());
    for (const el of [...template.content.querySelectorAll("*")]) {
      if (
        !tags.has(el.localName) ||
        el.namespaceURI !== "http://www.w3.org/1999/xhtml"
      ) {
        el.replaceWith(...el.childNodes);
        continue;
      }
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        if (
          (name === "src" && el.localName === "img") ||
          (name === "href" && el.localName === "a")
        ) {
          if (!safeURL(attr.value, name === "src"))
            el.removeAttribute(attr.name);
        } else if (!attrs.has(name)) el.removeAttribute(attr.name);
        else if (name === "style") {
          const styles = [];
          for (let i = 0; i < el.style.length; i++) {
            const key = el.style[i];
            const value = el.style.getPropertyValue(key);
            if (
              !/url\s*\(|expression|javascript|vbscript|@import|behavior|-moz-binding|\\/i.test(
                value,
              ) &&
              !/^(position|z-index|behavior|--)/i.test(key)
            )
              styles.push(`${key}:${value}`);
          }
          if (styles.length) el.setAttribute("style", styles.join(";"));
          else el.removeAttribute("style");
        }
      }
    }
    return template.innerHTML;
  }
  function canonical(html) {
    const t = document.createElement("template");
    t.innerHTML = sanitize(html);
    while (
      t.content.firstElementChild?.tagName === "P" &&
      !t.content.firstElementChild.textContent.trim() &&
      !t.content.firstElementChild.querySelector("img")
    )
      t.content.firstElementChild.remove();
    const walk = (node) => {
      if (node.nodeType === 3) return node.textContent.replace(/\s+/g, " ");
      if (node.nodeType !== 1) return [...node.childNodes].map(walk).join("");
      const attributes = [...node.attributes]
        .map((a) => [
          a.name,
          a.name === "style"
            ? a.value
                .split(";")
                .filter(Boolean)
                .map((s) => s.trim())
                .sort()
                .join(";")
            : a.value,
        ])
        .sort(([a], [b]) => a.localeCompare(b));
      return JSON.stringify([
        node.localName,
        attributes,
        [...node.childNodes].map(walk).filter(Boolean),
      ]);
    };
    return walk(t.content);
  }
  async function hash(text) {
    return [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
      ),
    ]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
  }
  return { sanitize, safeURL, canonical, hash };
})();
