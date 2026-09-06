import { describe, expect, it } from 'vitest'
import { sanitizeMessagePreview } from './messagePreview.js'

describe('sanitizeMessagePreview', () => {
  it('strips markdown headings from ANDON previews', () => {
    const { text, chip } = sanitizeMessagePreview(
      '## 🔴 ANDON — k8s agent Deployment not ready',
    )
    expect(text.startsWith('##')).toBe(false)
    expect(chip).toBe('Andon')
    expect(text).toMatch(/ANDON|Deployment/i)
  })

  it('strips emphasis markers', () => {
    const { text } = sanitizeMessagePreview('**bold** and _italic_')
    expect(text.includes('**')).toBe(false)
    expect(text.includes('_')).toBe(false)
    expect(text).toMatch(/bold/)
  })

  it('null-safe empty', () => {
    expect(sanitizeMessagePreview(null)).toEqual({ text: '', chip: null })
  })

  it('hides ack-only Replied. and Keyterms leftovers from the sidebar', () => {
    expect(sanitizeMessagePreview('Replied.')).toEqual({ text: '', chip: null })
    expect(sanitizeMessagePreview('Keyterms: Shizuha, Hritik, Hive, Cortex, Pulse')).toEqual({
      text: '',
      chip: null,
    })
    expect(sanitizeMessagePreview("Hey. I'm here.").text).toMatch(/hey/i)
  })
})
