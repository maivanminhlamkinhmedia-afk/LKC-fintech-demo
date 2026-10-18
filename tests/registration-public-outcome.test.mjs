import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import ts from 'typescript'

const [major, minor] = process.versions.node.split('.').map(Number)
assert.ok(major > 22 || (major === 22 && minor >= 18), 'Node >=22.18 required')
const root = new URL('../src/features/referrals/', import.meta.url)
const names = ['registration-public-outcome', 'registration-request-gate', 'registration-server-ports', 'registration-transaction']
const urls = names.map(name => new URL(`${name}.ts`, root).href)
// Actual TS source; only the Next server-only sentinel is adapted for node:test.
// This loader is not proof of client-import prevention or real transport behavior.
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (urls.includes(context.parentURL)) {
      if (specifier === 'server-only') return { url: 'public-guard-test:server-only', shortCircuit: true }
      if (specifier.startsWith('./') && names.includes(specifier.slice(2))) return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context)
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url === 'public-guard-test:server-only') return { format: 'module', source: 'export {}', shortCircuit: true }
    if (urls.includes(url)) return {
      format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }, fileName: url,
      }).outputText,
    }
    return nextLoad(url, context)
  },
})
const { registrationPublicOutcome: outcome } = await import(urls[0])
const { gateRegistrationRequest: gate } = await import(urls[1])
const { registerClientTransaction } = await import(urls[3])
hook.deregister()

const neutral = outcome({ kind: 'committed' })
const review = outcome({ kind: 'outcome-unknown', retry: 'reconciliation-required' })
const input = () => ({ name: 'Synthetic Name', email: 'private@example.invalid', password: 'password-DO-NOT-ECHO', referralCode: ' Referral-SECRET ' })
const encode = value => new TextEncoder().encode(JSON.stringify(value))
function deferred() { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

// All numbers and approvals here are SYNTHETIC fixture choices, not production
// policy. This fake authority is NOT a durable production rate-limit backend.
function fixture(options = {}) {
  const calls = [], captured = []
  const ports = {
    policy: {
      state: 'approved', reference: 'synthetic-input-policy', rateLimitPolicyReference: 'synthetic-rate-policy',
      maxBodyBytes: 2048, maxFieldBytes: { name: 128, email: 256, password: 256, referralCode: 128 },
    },
    rateLimit: {
      capability: 'durable-atomic', policyReference: 'synthetic-rate-policy',
      async consume(request) {
        calls.push('consume'); captured.push(request)
        if (options.rateThrow) throw new Error('backend-private-key')
        if (options.rateWait) await options.rateWait
        return Object.hasOwn(options, 'decision') ? options.decision : { decision: 'allow' }
      },
    },
    async executeRegistration(data) {
      calls.push('execute'); captured.push(data)
      if (options.executeThrow) throw new Error('SQL password email referral-private')
      return Object.hasOwn(options, 'result') ? options.result : { kind: 'committed' }
    },
  }
  return { ports, calls, captured }
}

const sensitiveResults = [
  { kind: 'committed' },
  { kind: 'field-error', field: 'email', code: 'duplicate-email' },
  ...['invalid', 'disabled', 'unresolved', 'unavailable'].map(code => ({ kind: 'field-error', field: 'referralCode', code })),
  { kind: 'policy-unresolved', policies: ['referralCode'] },
  { kind: 'conflict', retry: 'new-server-attempt-required' },
  { kind: 'unavailable' },
  { kind: 'invalid-input' },
]
for (const result of sensitiveResults) test(`uniform public bytes: ${JSON.stringify(result)}`, async () => {
  const f = fixture({ result })
  assert.equal(JSON.stringify(outcome(result)), JSON.stringify(neutral))
  assert.equal(JSON.stringify(await gate(encode(input()), f.ports)), JSON.stringify(neutral))
  assert.deepEqual(f.calls, ['consume', 'execute'])
})

test('public DTO does not claim account creation or email delivery, even after committed', () => {
  assert.deepEqual(neutral, {
    state: 'not-confirmed', nextAction: 'await-guidance', resubmit: false,
    message: 'Chưa thể xác nhận kết quả đăng ký. Vui lòng chờ hướng dẫn trước khi gửi yêu cầu khác.',
  })
  assert.ok(Object.isFrozen(neutral))
  assert.equal(Object.hasOwn(neutral, 'kind'), false)
  assert.equal(Object.hasOwn(neutral, 'emailSent'), false)
  assert.equal(Object.hasOwn(neutral, 'accountCreated'), false)
})

test('unknown commit preserves reconciliation and prohibits resubmission', async () => {
  const f = fixture({ result: { kind: 'outcome-unknown', retry: 'reconciliation-required' } })
  assert.deepEqual(await gate(encode(input()), f.ports), review)
  assert.equal(review.state, 'review-required')
  assert.equal(review.nextAction, 'await-reconciliation')
  assert.equal(review.resubmit, false)
  assert.ok(Object.isFrozen(review))
  assert.equal(f.calls.filter(c => c === 'execute').length, 1)
})

test('exception after execution starts is reconciliation, never raw error or automatic retry', async () => {
  const f = fixture({ executeThrow: true })
  assert.deepEqual(await gate(encode(input()), f.ports), review)
  assert.deepEqual(f.calls, ['consume', 'execute'])
})

test('malformed execution results cannot erase an uncertain outcome', async () => {
  for (const result of [null, undefined, [], 'committed', {}, { kind: 'new-unknown-kind' }, Object.create({ kind: 'committed' })]) {
    const f = fixture({ result })
    assert.deepEqual(await gate(encode(input()), f.ports), review)
  }
})

test('mapping ignores secret payloads and avoids accessors, toJSON and inherited kind', () => {
  let reads = 0
  const internal = { kind: 'field-error', ...input(), databaseError: 'SQL-secret', toJSON() { reads++; throw new Error('must not serialize') } }
  Object.defineProperty(internal, 'message', { get() { reads++; return 'private' } })
  assert.deepEqual(outcome(internal), neutral)
  const accessor = {}; Object.defineProperty(accessor, 'kind', { get() { reads++; return 'committed' } })
  assert.deepEqual(outcome(accessor), review)
  assert.equal(reads, 0)
  for (const secret of [...Object.values(input()), 'SQL-secret', 'field-error', 'duplicate-email', 'disabled', 'outcome-unknown']) {
    assert.ok(!JSON.stringify([neutral, review]).includes(secret))
  }
})

for (const missing of ['policy', 'rateLimit', 'executeRegistration']) test(`missing ${missing} fails closed before registration`, async () => {
  const f = fixture(); delete f.ports[missing]
  assert.deepEqual(await gate(encode(input()), f.ports), neutral)
  assert.deepEqual(f.calls, [])
})

test('unresolved or malformed approval references cannot supply defaults', async () => {
  for (const change of [
    f => { f.ports.policy = { state: 'unresolved' } },
    f => { f.ports.policy.state = 'candidate' },
    f => { f.ports.policy.reference = '' },
    f => { f.ports.policy.rateLimitPolicyReference = '' },
    f => { f.ports.rateLimit.policyReference = 'different-policy' },
    f => { f.ports.rateLimit.capability = 'in-memory' },
    f => { f.ports.rateLimit.consume = null },
  ]) {
    const f = fixture(); change(f)
    assert.deepEqual(await gate(encode(input()), f.ports), neutral)
    assert.deepEqual(f.calls, [])
  }
})

test('missing/unsafe numeric limits fail closed; no implicit production limits', async () => {
  for (const limit of [undefined, null, 0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '2048']) {
    for (const where of ['body', 'field']) {
      const f = fixture()
      if (where === 'body') f.ports.policy.maxBodyBytes = limit
      else f.ports.policy.maxFieldBytes.password = limit
      assert.deepEqual(await gate(encode(input()), f.ports), neutral)
      assert.deepEqual(f.calls, [])
    }
  }
})

test('body byte limit is checked before rate authority, UTF-8/JSON processing or execution', async () => {
  const bytes = encode(input())
  const f = fixture(); f.ports.policy.maxBodyBytes = bytes.byteLength - 1
  assert.deepEqual(await gate(bytes, f.ports), neutral)
  assert.deepEqual(f.calls, [])
  const exact = fixture(); exact.ports.policy.maxBodyBytes = bytes.byteLength
  assert.deepEqual(await gate(bytes, exact.ports), neutral)
  assert.deepEqual(exact.calls, ['consume', 'execute'])
})

test('body must be transport-owned bytes, not decoded object, string, declared size or shared memory', async () => {
  for (const value of [input(), JSON.stringify(input()), null, [], { byteLength: 1 }, new Uint8Array(new SharedArrayBuffer(8))]) {
    const f = fixture()
    assert.deepEqual(await gate(value, f.ports), neutral)
    assert.deepEqual(f.calls, [])
  }
})

for (const decision of [null, undefined, true, {}, { decision: 'deny' }, { decision: 'ALLOW' }, { allowed: true }, { decision: 1 }]) test(`rate authority non-allow ${JSON.stringify(decision)} blocks execution`, async () => {
  const f = fixture({ decision })
  assert.deepEqual(await gate(encode(input()), f.ports), neutral)
  assert.deepEqual(f.calls, ['consume'])
})

test('rate authority exceptions/accessors cannot authorize, leak errors or retry', async () => {
  const down = fixture({ rateThrow: true })
  assert.deepEqual(await gate(encode(input()), down.ports), neutral)
  assert.deepEqual(down.calls, ['consume'])
  let reads = 0
  const decision = {}; Object.defineProperty(decision, 'decision', { get() { reads++; return 'allow' } })
  const f = fixture({ decision })
  assert.deepEqual(await gate(encode(input()), f.ports), neutral)
  assert.equal(reads, 0); assert.deepEqual(f.calls, ['consume'])
})

test('pending rate decision never starts execution', async () => {
  const wait = deferred(), f = fixture({ rateWait: wait.promise })
  let settled = false
  const pending = gate(encode(input()), f.ports).then(r => { settled = true; return r })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false); assert.deepEqual(f.calls, ['consume'])
  wait.resolve(); await pending
  assert.deepEqual(f.calls, ['consume', 'execute'])
})

test('snapshot bytes/limits before authority awaits; exact referral retained without normalization', async () => {
  const wait = deferred(), f = fixture({ rateWait: wait.promise }), bytes = encode(input())
  const pending = gate(bytes, f.ports)
  bytes.fill(0); f.ports.policy.maxFieldBytes.referralCode = 1
  wait.resolve(); await pending
  assert.deepEqual(f.captured[1], input())
  assert.ok(Object.isFrozen(f.captured[1]))
  assert.deepEqual(f.captured[0], { operation: 'client-registration', policyReference: 'synthetic-rate-policy' })
  assert.ok(Object.isFrozen(f.captured[0]))
})

test('malformed JSON/UTF-8/non-object bodies consume budget but never execute', async () => {
  for (const bytes of [new Uint8Array(), new Uint8Array([0xff]), new TextEncoder().encode('{'), encode(null), encode([]), encode('input'), encode(123)]) {
    const f = fixture()
    assert.deepEqual(await gate(bytes, f.ports), neutral)
    assert.deepEqual(f.calls, ['consume'])
  }
})

test('all fields require strings and required properties; browser authority keys rejected', async () => {
  const missing = input(); delete missing.password
  const cases = [missing, {}, { ...input(), email: null }, { ...input(), referralCode: {} }, { ...input(), password: 42 }]
  for (const key of ['role', 'status', 'assignedSalesId', 'verified', 'entitlement', 'policy', 'rateLimitKey', 'contentLength', '__proto__']) {
    cases.push(JSON.parse(JSON.stringify(input()).replace(/}$/, `,${JSON.stringify(key)}:"untrusted"}`)))
  }
  for (const data of cases) {
    const f = fixture()
    assert.deepEqual(await gate(encode(data), f.ports), neutral)
    assert.deepEqual(f.calls, ['consume'])
  }
})

for (const field of ['name', 'email', 'password', 'referralCode']) test(`UTF-8 field limit for ${field}, including decoded JSON escapes`, async () => {
  const data = { ...input(), [field]: 'é😀' } // 6 UTF-8 bytes, 3 UTF-16 code units.
  const tooLong = fixture(); tooLong.ports.policy.maxFieldBytes[field] = 5
  assert.deepEqual(await gate(encode(data), tooLong.ports), neutral)
  assert.deepEqual(tooLong.calls, ['consume'])
  const exact = fixture(); exact.ports.policy.maxFieldBytes[field] = 6
  await gate(encode(data), exact.ports)
  assert.deepEqual(exact.calls, ['consume', 'execute'])
  const escaped = fixture(); escaped.ports.policy.maxFieldBytes[field] = 5
  const bytes = new TextEncoder().encode(JSON.stringify(data).replace('é😀', '\\u00e9\\ud83d\\ude00'))
  await gate(bytes, escaped.ports)
  assert.deepEqual(escaped.calls, ['consume'])
})

test('optional referral omission/empty string preserved; no format/case/expiry policy invented', async () => {
  for (const code of [undefined, '', ' ', 'aBc']) {
    const data = input(); if (code === undefined) delete data.referralCode; else data.referralCode = code
    const f = fixture(); await gate(encode(data), f.ports)
    assert.deepEqual(f.captured[1], data)
  }
})

test('byte view offset respects only provided request bytes', async () => {
  const body = encode(input()), backing = new Uint8Array(body.length + 8)
  backing.set(body, 4)
  const f = fixture(); await gate(backing.subarray(4, 4 + body.length), f.ports)
  assert.deepEqual(f.captured[1], input())
})

test('M-1/L-1: actual core early referral errors and later duplicate/commit have identical public bodies', async () => {
  const traces = [], publicBodies = []
  for (const scenario of ['invalid', 'disabled', 'unresolved', 'duplicate', 'committed']) {
    const trace = []
    const f = fixture()
    const corePorts = {
      policies: Object.fromEntries(['identity', 'password', 'referralCode', 'emailVerification', 'accountActivation', 'customerProfile'].map(p => [p, { state: 'resolved', reference: 'synthetic:' + p }])),
      async prepareCredentials(data) { return { kind: 'ready', name: data.name, email: data.email, passwordHash: 'synthetic-hash' } },
      async runInTransaction(work) {
        await work({
          async verifyReferral() { trace.push('verify'); return ['invalid', 'disabled', 'unresolved'].includes(scenario) ? { kind: scenario } : { kind: 'verified', sourceId: 'opaque-source', sourceVersion: 'opaque-version' } },
          async emailExists() { trace.push('email'); return scenario === 'duplicate' },
          async createUser() { trace.push('user'); return { id: 'opaque-user' } },
          async createCustomerProfile() { trace.push('profile'); return { id: 'opaque-profile' } },
          async createAttribution() { trace.push('attribution') },
          async appendAudit() { trace.push('audit') },
        })
      },
    }
    f.ports.executeRegistration = data => registerClientTransaction(data, corePorts)
    publicBodies.push(JSON.stringify(await gate(encode(input()), f.ports)))
    traces.push(trace)
  }
  assert.equal(new Set(publicBodies).size, 1)
  assert.deepEqual(traces[0], ['verify'])
  assert.deepEqual(traces[3], ['verify', 'email'])
  assert.deepEqual(traces[4], ['verify', 'email', 'user', 'profile', 'attribution', 'audit'])
  // Deliberately different work: this test proves body equality, NOT timing equality.
})

test('no response echoes raw internal fields, credentials, database errors or rate authority metadata', async () => {
  for (const kind of ['field-error', 'outcome-unknown']) {
    const f = fixture({ result: { kind, ...input(), databaseError: 'DB-private', policy: 'backend-private' } })
    const text = JSON.stringify(await gate(encode(input()), f.ports))
    for (const secret of [...Object.values(input()), 'DB-private', 'backend-private', 'synthetic-rate-policy', kind]) assert.ok(!text.includes(secret))
  }
})
