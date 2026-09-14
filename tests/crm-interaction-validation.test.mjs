import assert from 'node:assert/strict'
import test from 'node:test'
import { CustomerActivityType } from '@prisma/client'
import {
  MANUAL_ACTIVITY_TYPES, ACTIVITY_LABELS, MAX_INTERACTION_CONTENT,
  isManualActivityType, parseInteractionForm,
} from '../src/features/crm/interaction-validation.ts'

function form(overrides = {}) {
  const data = new FormData()
  for (const [key, value] of Object.entries({ customerId: 'customer-own', type: 'NOTE', content: 'Trao đổi với khách hàng', ...overrides })) {
    if (value !== null) for (const item of Array.isArray(value) ? value : [value]) data.append(key, item)
  }
  return data
}

test('manual allowlist contains only the five real interaction types, never system events', () => {
  assert.deepEqual(MANUAL_ACTIVITY_TYPES, ['NOTE', 'CALL', 'EMAIL', 'MEETING', 'MESSAGE'])
  for (const type of Object.values(CustomerActivityType)) {
    assert.equal(typeof ACTIVITY_LABELS[type], 'string')
    const expected = !['STATUS_CHANGE', 'ASSIGNMENT'].includes(type)
    assert.equal(isManualActivityType(type), expected)
    const result = parseInteractionForm(form({ type }))
    assert.equal(result.ok, expected, type)
    if (result.ok) assert.equal(result.data.title, ACTIVITY_LABELS[type])
  }
  for (const type of ['TASK_CREATE', 'TEAM_CHANGE', 'note', ' NOTE ', '', 'BAD', 'CALL\n', 'EMAIL\u0000', 'x'.repeat(5000)]) {
    assert.equal(parseInteractionForm(form({ type })).ok, false, type)
  }
})

test('every trusted field must occur exactly once and be a string, not a file', () => {
  for (const key of ['customerId', 'type', 'content']) {
    const valid = form().get(key)
    for (const value of [null, [valid, valid], [valid, 'forged'], new Blob(['text'])]) {
      assert.equal(parseInteractionForm(form({ [key]: value })).ok, false, key)
    }
  }
  for (const value of [null, undefined, {}, { get: () => 'forged' }, 'not a form']) assert.equal(parseInteractionForm(value).ok, false)
})

test('customer IDs enforce existing CRM identifier grammar and 191-character boundary', () => {
  for (const customerId of ['', ' ', '../foreign', 'customer/id', 'a%2Fb', 'a b', 'id\n', 'x'.repeat(192)]) {
    assert.equal(parseInteractionForm(form({ customerId })).ok, false, JSON.stringify(customerId))
  }
  for (const customerId of ['a', 'cuid_123-ABC', 'x'.repeat(191)]) assert.equal(parseInteractionForm(form({ customerId })).ok, true)
})

test('content is required after trimming and is rejected, never truncated, above the limit', () => {
  assert.equal(MAX_INTERACTION_CONTENT, 5000)
  for (const content of ['', '   ', '\t\r\n', '\u00a0\u2003']) assert.equal(parseInteractionForm(form({ content })).ok, false)
  const atLimit = 'ế'.repeat(MAX_INTERACTION_CONTENT)
  const result = parseInteractionForm(form({ content: `  ${atLimit}\n` }))
  assert.equal(result.ok, true)
  assert.equal(result.data.content, atLimit)
  assert.equal(parseInteractionForm(form({ content: `${atLimit}x` })).ok, false)
  assert.equal(parseInteractionForm(form({ content: '🙂'.repeat(2500) })).ok, true)
  assert.equal(parseInteractionForm(form({ content: '🙂'.repeat(2501) })).ok, false)
})

test('Vietnamese, combining marks, emoji and multiline content survive without normalization', () => {
  const content = 'Nguyễn Ánh — hẹn gặp thứ Hai 🙂\nEmail: khách@example.test\tCảm ơn!\nNFD: e\u0301'
  const result = parseInteractionForm(form({ type: 'MEETING', content: ` \n${content}\r\n ` }))
  assert.equal(result.ok, true)
  assert.equal(result.data.content, content)
  assert.equal(result.data.type, 'MEETING')
})

test('HTML/script-looking content stays literal text for React to escape', () => {
  const content = '<script>alert("x")</script><img src=x onerror=alert(1)> & "quote"'
  const result = parseInteractionForm(form({ content }))
  assert.equal(result.ok, true)
  assert.equal(result.data.content, content)
})

test('non-text control characters cannot be stored; multiline whitespace remains supported', () => {
  for (const char of ['\u0000', '\u0001', '\u0008', '\u000b', '\u000c', '\u000e', '\u001f', '\u007f']) {
    assert.equal(parseInteractionForm(form({ content: `hello${char}world` })).ok, false)
  }
  assert.equal(parseInteractionForm(form({ content: 'hello\tthere\r\nworld' })).ok, true)
})

test('forged identity, ownership, timestamps, titles and action-state fields never enter parsed data', () => {
  const expected = parseInteractionForm(form())
  const actual = parseInteractionForm(form({
    actorId: ['foreign-actor', 'admin'], assignedSalesId: 'foreign-owner', assignedToId: 'foreign-assignee',
    teamId: 'foreign-team', title: 'Fake system title', createdAt: '2000-01-01', activityId: 'existing',
    status: 'CLOSED', role: 'SUPER_ADMIN', lastContactAt: '2099-01-01', previousState: '{"kind":"success"}',
  }))
  assert.deepEqual(actual, expected)
  assert.deepEqual(Object.keys(actual.data).sort(), ['content', 'customerId', 'title', 'type'])
  assert.notEqual(actual.data.title, actual.data.content)
})
