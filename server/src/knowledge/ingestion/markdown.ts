/**
 * Markdown as plain text, for the excerpts of list views: keeps the words and
 * drops the markup ("## **Neu:** [HUB.KI](https://…)" → "Neu: HUB.KI").
 * Good enough for a preview line, not a full parser.
 */
export function markdownToText(markdown: string): string {
  return (
    markdown
      .replace(/\r\n?/g, '\n')
      // Fenced code: keep the code, drop the fences
      .replace(/^ {0,3}(```|~~~)[^\n]*\n([\s\S]*?)^ {0,3}\1[^\n]*$/gm, '$2')
      // Images keep their alt text, links their text
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // Horizontal rules, then headings, quotes and list markers at line start
      .replace(/^ {0,3}([-*_])( *\1){2,} *$/gm, '')
      .replace(/^ {0,3}(?:>+ ?)*(?:#{1,6} +|[-*+] +(?:\[[ xX]\] +)?|\d+[.)] +)?/gm, '')
      // Emphasis, strikethrough, inline code
      .replace(/(\*\*|__)(\S(?:.*?\S)?)\1/g, '$2')
      .replace(/\*(\S(?:[^*\n]*?\S)?)\*/g, '$1')
      .replace(/(^|\W)_(\S(?:[^_\n]*?\S)?)_(?=\W|$)/g, '$1$2')
      .replace(/~~(\S(?:.*?\S)?)~~/g, '$1')
      .replace(/`([^`\n]+)`/g, '$1')
      // Inline HTML
      .replace(/<\/?[a-z][^>]*>/gi, '')
  );
}
