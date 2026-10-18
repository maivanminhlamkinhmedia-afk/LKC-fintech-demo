import assert from 'node:assert/strict'
import test from 'node:test'
import {
  readReferralInput, createReferralEntry, changeReferralCode,
  beginReferralCheck, completeReferralCheck, getRegistrationReferralIntent,
} from '../src/features/referrals/registration-referral-intent.ts'

for (const raw of [undefined, '']) {
  test(`referral is optional: ${String(raw)}`, () => {
    const state = createReferralEntry(raw)
    assert.equal(state.status, 'omitted')
    assert.equal(beginReferralCheck(state), state)
    assert.deepEqual(getRegistrationReferralIntent(state), { kind: 'omitted' })
  })
}

for (const raw of [null, false, 123, [], {}, { assignedSalesId: 'sales-1' }, { code: 'A', verified: true }]) {
  test(`untrusted non-string input is blocked: ${JSON.stringify(raw)}`, () => {
    const state = createReferralEntry(raw)
    assert.equal(state.status, 'invalid-input')
    assert.equal(beginReferralCheck(state), state)
    assert.deepEqual(getRegistrationReferralIntent(state), { kind: 'blocked', reason: 'invalid-input' })
  })
}

test('input objects are not coerced or inspected for referral/assigned Sales', () => {
  const raw = { toString() { throw Error('must not coerce') }, get assignedSalesId() { throw Error('must not infer') } }
  assert.deepEqual(readReferralInput(raw), { kind: 'invalid-input' })
})

for (const raw of [' ', '\t', ' aBc ', 'MÃ-例', '<script>alert(1)</script>', 'A\nB']) {
  test(`no unapproved format, case or whitespace normalization: ${JSON.stringify(raw)}`, () => {
    const state = createReferralEntry(raw)
    assert.equal(state.status, 'unverified')
    assert.deepEqual(getRegistrationReferralIntent(state), {
      kind: 'requires-server-verification', code: raw, displayStatus: 'unverified',
    })
  })
}

test('pending never passes as valid and duplicate begin does not replace the request', () => {
  const state = beginReferralCheck(createReferralEntry('CODE'))
  assert.equal(state.status, 'pending')
  assert.equal(beginReferralCheck(state), state)
  assert.equal(getRegistrationReferralIntent(state).kind, 'requires-server-verification')
})

for (const [outcome, status] of [['invalid', 'invalid'], ['unavailable', 'source-error'], ['valid', 'reported-valid']]) {
  test(`${outcome} has a distinct display state, preserves exact code and cannot authorize registration`, () => {
    const pending = beginReferralCheck(createReferralEntry(' AbC '))
    const state = completeReferralCheck(pending, pending.request, { outcome })
    assert.equal(state.status, status)
    assert.equal(state.request, null)
    assert.deepEqual(getRegistrationReferralIntent(state), {
      kind: 'requires-server-verification', code: ' AbC ', displayStatus: status,
    })
    assert.deepEqual(Object.keys(state).sort(), ['input', 'request', 'status'])
  })
}

for (const payload of [null, true, 'valid', [], {}, { valid: true }, { outcome: 'VALID' },
  { outcome: 'valid', assignedSalesId: 'private' }, { outcome: 'valid', subscriptionActive: true },
  { outcome: 'invalid', message: '<private customer identity>' }]) {
  test(`malformed/extra verification data is a source error: ${JSON.stringify(payload)}`, () => {
    const pending = beginReferralCheck(createReferralEntry('CODE'))
    const state = completeReferralCheck(pending, pending.request, payload)
    assert.equal(state.status, 'source-error')
    assert.equal(state.input.code, 'CODE')
    assert.ok(!JSON.stringify(state).includes('private'))
  })
}

test('verification accessor is not executed; inherited outcomes are not trusted', () => {
  const pending = beginReferralCheck(createReferralEntry('CODE'))
  let calls = 0
  const accessor = { get outcome() { calls++; return 'valid' } }
  assert.equal(completeReferralCheck(pending, pending.request, accessor).status, 'source-error')
  assert.equal(calls, 0)
  assert.equal(completeReferralCheck(pending, pending.request, Object.create({ outcome: 'valid' })).status, 'source-error')
})

test('edited code rejects old responses, including A -> B -> A', () => {
  const first = beginReferralCheck(createReferralEntry('A'))
  const edited = changeReferralCode(first, 'B')
  assert.equal(edited.status, 'unverified')
  assert.equal(completeReferralCheck(edited, first.request, { outcome: 'valid' }), edited)
  const second = beginReferralCheck(changeReferralCode(edited, 'A'))
  assert.equal(completeReferralCheck(second, first.request, { outcome: 'valid' }), second)
  assert.equal(completeReferralCheck(second, { code: 'A' }, { outcome: 'valid' }), second)
})

test('retry rejects old request and duplicate responses', () => {
  const first = beginReferralCheck(createReferralEntry('A'))
  const failed = completeReferralCheck(first, first.request, { outcome: 'unavailable' })
  const second = beginReferralCheck(failed)
  assert.equal(completeReferralCheck(second, first.request, { outcome: 'invalid' }), second)
  const result = completeReferralCheck(second, second.request, { outcome: 'valid' })
  assert.equal(completeReferralCheck(result, second.request, { outcome: 'invalid' }), result)
})

test('only explicit clearing removes entered code; states cannot be mutated', () => {
  const pending = beginReferralCheck(createReferralEntry('A'))
  assert.throws(() => { pending.input.code = '' }, TypeError)
  assert.throws(() => { pending.status = 'reported-valid' }, TypeError)
  const cleared = changeReferralCode(pending, '')
  assert.equal(cleared.status, 'omitted')
  assert.equal(completeReferralCheck(cleared, pending.request, { outcome: 'valid' }), cleared)
})
