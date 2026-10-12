/**
 * React-free markdown helpers shared by the viewer UI and the node:test
 * suite. The fallback renderer escapes ALL input before adding any HTML
 * tags: the ticket body/comments are user-controlled Bugzilla content, and
 * an unescaped `<script>` in a non-JSON ticket cache would otherwise be
 * injected verbatim via dangerouslySetInnerHTML.
 */

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

/** Soft, simple markdown-to-HTML used only as a fallback when no JSON is found. */
export function renderFallbackMarkdown(md: string): string {
  if (!md) return "";
  return escapeHtml(md)
    .replace(/^### (.*$)/gim, "<h3>$1</h3>")
    .replace(/^## (.*$)/gim, "<h2>$1</h2>")
    .replace(/^# (.*$)/gim, "<h1>$1</h1>")
    .replace(/^> (.*$)/gim, "<blockquote>$1</blockquote>")
    .replace(/\*\*(.*)\*\*/gim, "<b>$1</b>")
    .replace(/\*(.*)\*/gim, "<i>$1</i>")
    .replace(/`([^`]+)`/gim, "<code>$1</code>")
    .replace(/^\s*-\s+(.*$)/gim, "<li>$1</li>")
    .replace(/\n/gim, "<br />");
}

/**
 * Fence placeholder sentinels, built from Unicode private-use-area
 * characters (U+E000..U+F8FF). They cannot appear in ordinary ticket or
 * document text, so unlike the old `@@FENCE0@@` markers a collision with
 * literal source text is practically impossible — and if one ever happens,
 * the leftover sentinel renders as its escaped literal source, never as
 * "undefined".
 */
const FENCE_OPEN = "\uE000F";
const FENCE_CLOSE = "\uE000";
const FENCE_SENTINEL = /^\uE000F\d+\uE000$/;

/**
 * Render one blank-line-separated block: headings, bullet/ordered lists
 * (with lazy continuation lines folded into their item), and paragraphs
 * with standard markdown soft-wrap (single newline = space) so
 * hard-wrapped sources reflow to the panel width.
 */
function renderBlock(lines: string[]): string {
  const heading = /^(#{1,3}) (.+)$/.exec(lines[0] ?? "");
  if (heading && lines.length === 1) {
    return `<h${heading[1].length}>${escapeHtml(heading[2])}</h${heading[1].length}>`;
  }
  const parts: string[] = [];
  if (heading) {
    parts.push(`<h${heading[1].length}>${escapeHtml(heading[2])}</h${heading[1].length}>`);
    lines = lines.slice(1);
  }
  const isBullet = (line: string) => /^[-*] /.test(line);
  const isOrdered = (line: string) => /^\d+[.)] /.test(line);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const kind = isBullet(line) ? "ul" : isOrdered(line) ? "ol" : null;
    if (!kind) {
      const paragraph: string[] = [];
      while (index < lines.length && !isBullet(lines[index]) && !isOrdered(lines[index])) {
        paragraph.push(lines[index]);
        index += 1;
      }
      parts.push(`<p>${escapeHtml(paragraph.join(" "))}</p>`);
      continue;
    }
    const matcher = kind === "ul" ? isBullet : isOrdered;
    const items: string[] = [];
    while (index < lines.length) {
      if (matcher(lines[index])) {
        items.push(lines[index].replace(/^\S+\s/, ""));
        index += 1;
      } else if (items.length > 0 && !isBullet(lines[index]) && !(kind === "ul" && isOrdered(lines[index])) && !(kind === "ol" && /^[-*] /.test(lines[index]))) {
        // lazy continuation of the current item
        items[items.length - 1] += ` ${lines[index]}`;
        index += 1;
      } else {
        break;
      }
    }
    parts.push(`<${kind}>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</${kind}>`);
  }
  return parts.join("\n");
}

/**
 * Render a markdown document (headings, lists, paragraphs, ``` code fences)
 * to HTML with every non-fence character escaped. Used for the doc tabs.
 */
export function renderMarkdown(source: string): string {
  const fences: string[] = [];
  const text = source.replace(/\r\n/g, "\n").replace(/```[\w]*\n([\s\S]*?)```/g, (_, code) => {
    fences.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
    return `${FENCE_OPEN}${fences.length - 1}${FENCE_CLOSE}`;
  });
  const html = text
    .split(/\n{2,}/)
    .map((block) => {
      // A block that is exactly a fence placeholder (a standalone code
      // fence) passes through untouched; everything else goes through
      // renderBlock, which escapes it (placeholders are restored afterwards).
      const trimmed = block.trim();
      if (FENCE_SENTINEL.test(trimmed)) return trimmed;
      return renderBlock(block.split("\n").map((line) => line.trim()).filter(Boolean));
    })
    .join("\n");
  return html.replace(/\uE000F(\d+)\uE000/g, (_, index) => {
    const entry = fences[Number(index)];
    // Collision case: a sentinel the source itself contained. Render its
    // escaped literal source — never "undefined".
    return entry === undefined ? escapeHtml(`${FENCE_OPEN}${index}${FENCE_CLOSE}`) : entry;
  });
}
