import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import {
  createRemovalConfirmation,
  REMOVAL_CONFIRMATION_MAX_AGE_MS,
  verifyRemovalConfirmation,
} from '../src/features/crm/team-removal-confirmation.ts'

const secret = 'fixture-only-confirmation-secret'
const now = Date.parse('2026-09-14T05:00:00.000Z')
const binding = {
  actorId: 'admin-a', teamId: 'team-a', membershipId: 'membership-a', userId: 'sales-a',
  membershipCreatedAt: '2026-09-13T05:00:00.000Z',
}
const options = { secret, now }

test('server-issued confirmation validates the exact actor and current membership binding', () => {
  const token = createRemovalConfirmation(binding, options)
  assert.equal(verifyRemovalConfirmation(token, binding, options), true)
  for (const key of Object.keys(binding)) {
    assert.equal(verifyRemovalConfirmation(token, { ...binding, [key]: `${binding[key]}-different` }, options), false, key)
  }
})

test('token lifetime is ten minutes and rejects both expired and future-issued confirmations', () => {
  const token = createRemovalConfirmation(binding, options)
  assert.equal(REMOVAL_CONFIRMATION_MAX_AGE_MS, 600000)
  assert.equal(verifyRemovalConfirmation(token, binding, { secret, now: now + 599999 }), true)
  assert.equal(verifyRemovalConfirmation(token, binding, { secret, now: now + 600000 }), false)
  assert.equal(verifyRemovalConfirmation(token, binding, { secret, now: now - 1 }), false)
})

test('wrong secrets and modified payloads/signatures cannot confirm removal', () => {
  const token = createRemovalConfirmation(binding, options)
  assert.equal(verifyRemovalConfirmation(token, binding, { ...options, secret: 'different-secret' }), false)
  const [payload, signature] = token.split('.')
  const modified = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  modified.actorId = 'different-admin'
  assert.equal(verifyRemovalConfirmation(`${Buffer.from(JSON.stringify(modified)).toString('base64url')}.${signature}`, binding, options), false)
  const changedSignature = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`
  assert.equal(verifyRemovalConfirmation(`${payload}.${changedSignature}`, binding, options), false)
})

test('malformed and oversized confirmation tokens fail closed', () => {
  for (const token of ['', '.', 'not-a-token', 'a.b', 'a.b.c', 'a'.repeat(4097), `${'A'.repeat(20)}.${'B'.repeat(43)}`, 'payload.signature=', 'payload.\n']) {
    assert.equal(verifyRemovalConfirmation(token, binding, options), false)
  }
})

test('correctly signed but wrong-purpose, malformed, or invalid-time payloads fail closed', () => {
  const token = createRemovalConfirmation(binding, options)
  const valid = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'))
  const variants = [
    null, {}, { ...valid, purpose: 'another-purpose' }, { ...valid, userId: null },
    { ...valid, issuedAt: String(now) }, { ...valid, issuedAt: now + 0.5 },
    { ...valid, expiresAt: valid.expiresAt + 1 }, { ...valid, expiresAt: null },
  ]
  for (const value of variants) {
    const payload = Buffer.from(JSON.stringify(value)).toString('base64url')
    const signature = createHmac('sha256', secret).update(`sales-team-member-removal:v1.${payload}`).digest('base64url')
    assert.equal(verifyRemovalConfirmation(`${payload}.${signature}`, binding, options), false)
  }
  const payload = Buffer.from('not JSON').toString('base64url')
  const signature = createHmac('sha256', secret).update(`sales-team-member-removal:v1.${payload}`).digest('base64url')
  assert.equal(verifyRemovalConfirmation(`${payload}.${signature}`, binding, options), false)
})

test('tokens signed without the removal-specific HMAC domain separation fail', () => {
  const token = createRemovalConfirmation(binding, options)
  const payload = token.split('.')[0]
  const signature = createHmac('sha256', secret).update(payload).digest('base64url')
  assert.equal(verifyRemovalConfirmation(`${payload}.${signature}`, binding, options), false)
})
