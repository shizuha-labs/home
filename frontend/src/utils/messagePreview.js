/**
 * CON-279 / CON-277 — client-side message list preview sanitizer.
 * Strips markdown markers / agent artifacts so sidebar rows never show raw `##`.
 * Shared shape with Connect messages chrome (CON-277).
 */

const TYPE_PATTERNS = [
  { re: /\bANDON\b/i, chip: 'Andon' },
  { re: /\b(task|pulse)\b/i, chip: 'Task' },
  { re: /\b(system|workflow)\b/i, chip: 'System' },
]

/**
 * @param {string | null | undefined} raw
 * @returns {{ text: string, chip: string | null }}
 */
export function sanitizeMessagePreview(raw) {
  if (raw == null) return { text: '', chip: null }
  let text = String(raw)

  let chip = null
  for (const { re, chip: c } of TYPE_PATTERNS) {
    if (re.test(text)) {
      chip = c
      break
    }
  }

  text = text.replace(/```[\s\S]*?```/g, ' ')
  text = text.replace(/`([^`]+)`/g, '$1')
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, '')
  text = text.replace(/^\s{0,3}>\s?/gm, '')
  text = text.replace(/^\s*[-*+]\s+/gm, '')
  text = text.replace(/^\s*\d+\.\s+/gm, '')
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2')
  text = text.replace(/(\*|_)(.*?)\1/g, '$2')
  text = text.replace(/~~(.*?)~~/g, '$1')
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  text = text.replace(/<\/?[^>]+>/g, ' ')
  text = text.replace(/\s+/g, ' ').trim()

  if (text.length > 160) {
    const cut = text.slice(0, 160)
    const sp = cut.lastIndexOf(' ')
    text = (sp > 80 ? cut.slice(0, sp) : cut).trim() + '…'
  }

  return { text, chip }
}

export default sanitizeMessagePreview
