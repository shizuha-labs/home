import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeMessagePreview } from './messagePreview.js'

test('strips markdown headings from ANDON previews', () => {
  const { text, chip } = sanitizeMessagePreview(
    '## 🔴 ANDON — k8s agent Deployment not ready',
  )
  assert.equal(text.startsWith('##'), false)
  assert.equal(chip, 'Andon')
  assert.match(text, /ANDON|Deployment/i)
})

test('strips emphasis markers', () => {
  const { text } = sanitizeMessagePreview('**bold** and _italic_')
  assert.equal(text.includes('**'), false)
  assert.equal(text.includes('_'), false)
  assert.match(text, /bold/)
})

test('null-safe empty', () => {
  assert.deepEqual(sanitizeMessagePreview(null), { text: '', chip: null })
})
