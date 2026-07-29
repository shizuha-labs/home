/**
 * Strip common markdown syntax from a string for use as a plain-text preview.
 * Handles: headings, bold/italic, code fences/inline code, links, lists, blockquotes,
 * horizontal rules, strikethrough, and images. Collapses whitespace.
 */
export function stripMarkdown(raw) {
  if (!raw) return ''
  let text = String(raw)
    // Remove code fences (```...```) and their content
    .replace(/```[\s\S]*?```/g, '')
    // Remove inline code
    .replace(/`([^`]+)`/g, '$1')
    // Remove images ![alt](url)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // Remove links [text](url) — keep the text
    .replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')
    // Remove heading markers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold/italic markers
    .replace(/(\*{1,3}|_{1,3})(.*?)\1/g, '$2')
    // Remove strikethrough
    .replace(/~~(.*?)~~/g, '$1')
    // Remove blockquote markers
    .replace(/^>\s+/gm, '')
    // Remove list markers
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Remove horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Collapse whitespace
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return text
}
