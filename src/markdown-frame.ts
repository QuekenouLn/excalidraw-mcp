const AURORA_STYLES = `
:root {
  color-scheme: dark;
  --aurora-bg: #23262e;
  --aurora-surface: #292e38;
  --aurora-text: #ffca28;
  --aurora-soft: #ffd29c;
  --aurora-muted: #4f545e;
  --aurora-green: #8fd46d;
  --aurora-yellow: #ffe66d;
  --aurora-cyan: #03d6b8;
  --aurora-teal: #00e8c6;
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; background: var(--aurora-bg); }
body {
  padding: 12px;
  color: var(--aurora-text);
  font-family: "Maple Mono NF CN", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 16px;
  line-height: 1.75;
}
.markdown-frame { max-width: 100%; overflow-wrap: anywhere; zoom: var(--markdown-scale); }
.markdown-frame > :first-child { margin-top: 0; }
.markdown-frame > :last-child { margin-bottom: 0; }
h1, h2, h3 { margin: 1.1em 0 .55em; line-height: 1.3; font-weight: 600; }
h1 { font-size: 2em; color: var(--aurora-yellow); }
h2 { font-size: 1.5em; color: var(--aurora-text); }
h3 { font-size: 1.2em; color: var(--aurora-cyan); }
p, ul, ol, blockquote, pre, table { margin: .75em 0; }
a { color: var(--aurora-cyan); text-decoration: underline; text-underline-offset: 2px; }
a:hover { color: var(--aurora-teal); }
strong { color: var(--aurora-yellow); }
blockquote { margin-left: 0; padding: .2em 1em; color: var(--aurora-soft); border-left: 3px solid var(--aurora-muted); background: var(--aurora-surface); }
code { padding: .15em .35em; border-radius: 4px; background: rgba(0, 0, 0, .28); color: var(--aurora-green); font-family: inherit; }
pre { padding: 14px 16px; overflow: auto; border: 0; border-radius: 4px; background: var(--aurora-surface); color: var(--aurora-green); }
pre code { padding: 0; background: transparent; }
table { width: 100%; border-collapse: collapse; background: var(--aurora-surface); }
th, td { padding: .5em .7em; border: 1px solid var(--aurora-muted); text-align: left; }
th { color: var(--aurora-yellow); }
hr { border: 0; border-top: 2px solid var(--aurora-muted); }
li + li { margin-top: .25em; }
`;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const sanitizeUrl = (value: string) => {
  const url = value.trim();
  return /^(https?:|mailto:|\/|#)/i.test(url) ? escapeHtml(url) : "#";
};

const renderInline = (value: string) => {
  const code: string[] = [];
  let html = escapeHtml(value).replace(/`([^`]+)`/g, (_, content) => {
    code.push(`<code>${content}</code>`);
    return `@@CODE_${code.length - 1}@@`;
  });
  html = html
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (_, label, url) =>
        `<a href="${sanitizeUrl(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`,
    )
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/@@CODE_(\d+)@@/g, (_, index) => code[Number(index)]);
  return html;
};

export const renderMarkdown = (markdown: string) => {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const output: string[] = [];
  let paragraph: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let inCode = false;
  let code: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) output.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (listType) output.push(`</${listType}>`);
    listType = null;
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      flushParagraph();
      closeList();
      if (inCode) {
        output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = [];
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      output.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }
    const list = line.match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
    if (list) {
      flushParagraph();
      const nextType = list[2] ? "ol" : "ul";
      if (listType !== nextType) {
        closeList();
        listType = nextType;
        output.push(`<${listType}>`);
      }
      output.push(`<li>${renderInline(list[3])}</li>`);
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      closeList();
      output.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
      continue;
    }
    if (/^\s*---+\s*$/.test(line)) {
      flushParagraph();
      closeList();
      output.push("<hr />");
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }
    paragraph.push(line.trim());
  }
  if (inCode) output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  flushParagraph();
  closeList();
  return output.join("\n");
};

export const createMarkdownFrameHtml = (markdown: string, scale = 1) =>
  `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>${AURORA_STYLES}</style></head>
<body style="--markdown-scale:${scale}">
<article class="markdown-frame">${renderMarkdown(markdown)}</article>
</body></html>`;
