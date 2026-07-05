import assert from 'node:assert/strict'
import { ASSISTANT_ACTIONS, getAssistantActionExecution } from '../src/components/assistant/assistantActions.js'

const tier2 = ASSISTANT_ACTIONS.filter((action) => action.tier === 2)
const tier3 = ASSISTANT_ACTIONS.filter((action) => action.tier === 3)

assert.ok(tier2.length > 0, 'fixture must include Tier 2 actions')
assert.ok(tier3.length > 0, 'fixture must include Tier 3 actions')

for (const action of tier2) {
  const unconfirmed = getAssistantActionExecution(action)
  assert.equal(unconfirmed.mode, 'confirm', `${action.id} must preview instead of executing before confirmation`)
  assert.equal(unconfirmed.writeAllowed, false, `${action.id} must not allow writes before confirmation`)
  assert.equal(unconfirmed.preview.auditEvent, action.auditEvent)

  const confirmed = getAssistantActionExecution(action, { confirmed: true })
  assert.equal(confirmed.mode, 'ask', `${action.id} should route to assistant only after confirmation`)
  assert.equal(confirmed.prompt, action.prompt)
}

for (const action of tier3) {
  const execution = getAssistantActionExecution(action)
  assert.equal(execution.mode, 'navigate', `${action.id} must deep-link only`)
  assert.equal(execution.writeAllowed, false, `${action.id} must never allow inline writes`)
  assert.equal(execution.href, action.deepLink || action.href)
}
