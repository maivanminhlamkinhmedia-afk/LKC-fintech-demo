import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import ts from 'typescript'

const [major, minor] = process.versions.node.split('.').map(Number)
assert.ok(major > 22 || (major === 22 && minor >= 18), 'Node >=22.18 required')
const root = new URL('../src/features/referrals/', import.meta.url)
const modules = ['registration-server-ports.ts', 'registration-transaction.ts'].map(p => new URL(p, root).href)
// Load actual source with TS transpilation. Only Next's server-only sentinel is
// adapted for node:test; this does not prove Next client-boundary enforcement.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (modules.includes(context.parentURL)) {
      if (specifier === 'server-only') return { url: 'registration-test:server-only', shortCircuit: true }
      if (specifier === './registration-server-ports') return nextResolve(modules[0], context)
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url === 'registration-test:server-only') return { format: 'module', source: 'export {}', shortCircuit: true }
    if (modules.includes(url)) return {
      format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }, fileName: url,
      }).outputText,
    }
    return nextLoad(url, context)
  },
})
const { RegistrationRolledBackError } = await import(modules[0])
const { registerClientTransaction: register } = await import(modules[1])
hooks.deregister()

const policyNames = ['identity', 'password', 'referralCode', 'emailVerification', 'accountActivation', 'customerProfile']
const input = () => ({ name: 'Synthetic Person', email: 'synthetic@example.invalid', password: 'synthetic-raw-secret', referralCode: ' Ref-A ' })
function deferred() { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

/** Transaction double: stage copies, commit only after callback + commit ack.
 * It models the port contract, not MariaDB isolation, locks or persistence.
 * All resolved policies and hashes below are synthetic, NOT business approvals.
 */
function fixture(options = {}) {
  const events = [], payloads = {}, state = { rows: [], attempts: 0 }
  const ports = {
    policies: Object.fromEntries(policyNames.map(name => [name, { state: 'resolved', reference: `synthetic-policy:${name}` }])),
    async prepareCredentials(data, policies) {
      events.push('prepare'); payloads.prepare = data; payloads.policies = policies
      if (options.prepareThrow) throw new Error('raw-secret PII database host')
      await options.prepareWait
      return options.prepared ?? { kind: 'ready', name: data.name, email: data.email, passwordHash: 'synthetic-hash' }
    },
    async runInTransaction(work) {
      state.attempts++; events.push('begin')
      const pending = structuredClone(state.rows)
      async function write(step, payload) {
        events.push(step); payloads[step] = payload
        if (options.fail === step) throw options.error ?? new Error('private SQL credentials email')
        pending.push({ step, payload }); return { id: `${step}-id` }
      }
      const tx = {
        async verifyReferral(code, policy) {
          events.push('verify'); payloads.verify = { code, policy }
          if (options.verifyThrow) throw new Error('referral-secret')
          if (options.verifyWait) await options.verifyWait
          return Object.hasOwn(options, 'referral') ? options.referral : { kind: 'verified', sourceId: 'opaque-referrer', sourceVersion: 'opaque-version' }
        },
        async emailExists(email) {
          events.push('email'); payloads.email = email
          return options.exists ?? pending.some(row => row.step === 'user' && row.payload.email === email)
        },
        createUser: data => write('user', data),
        createCustomerProfile: data => write('profile', data),
        createAttribution: data => write('attribution', data),
        appendAudit: data => write('audit', data),
      }
      try {
        if (!options.skipCallback) await work(tx)
        if (options.replayCallback) await work(tx)
        if (options.commitWait) await options.commitWait
        if (options.conflict) throw new RegistrationRolledBackError('conflict')
        if (options.commitFailure === 'before') throw new Error('commit transport lost')
        state.rows = pending
        events.push('commit')
        if (options.commitFailure === 'after') throw new Error('commit ack lost')
      } catch (error) {
        events.push('abort')
        if (options.rollbackUnknown) throw new Error('rollback acknowledgement lost')
        throw error
      }
    },
  }
  return { ports, events, payloads, state }
}

test('one transaction orders authoritative verification, all four writes, then commit', async () => {
  const f = fixture()
  assert.deepEqual(await register(input(), f.ports), { kind: 'committed' })
  assert.deepEqual(f.events, ['prepare', 'begin', 'verify', 'email', 'user', 'profile', 'attribution', 'audit', 'commit'])
  assert.equal(f.state.attempts, 1)
  assert.equal(f.state.rows.length, 4)
  assert.deepEqual(Object.keys(f.payloads.user).sort(), ['accountActivationPolicy', 'email', 'emailVerificationPolicy', 'name', 'passwordHash', 'role'])
  assert.equal(f.payloads.user.role, 'CLIENT')
  assert.equal(f.payloads.user.passwordHash, 'synthetic-hash')
  assert.equal(f.payloads.user.accountActivationPolicy, 'synthetic-policy:accountActivation')
  assert.equal(f.payloads.user.emailVerificationPolicy, 'synthetic-policy:emailVerification')
  assert.deepEqual(f.payloads.profile, { userId: 'user-id', policyReference: 'synthetic-policy:customerProfile' })
  assert.deepEqual(f.payloads.attribution, { userId: 'user-id', customerProfileId: 'profile-id', sourceId: 'opaque-referrer', sourceVersion: 'opaque-version' })
})

for (const code of [undefined, '']) test(`optional referral ${String(code)} has no attribution`, async () => {
  const f = fixture(), data = input()
  if (code === undefined) delete data.referralCode
  else data.referralCode = code
  assert.equal((await register(data, f.ports)).kind, 'committed')
  assert.ok(!f.events.includes('verify') && !f.events.includes('attribution'))
  assert.equal(f.payloads.audit.referralSourceId, null)
  assert.equal(f.payloads.audit.referralSourceVersion, null)
  assert.equal(f.state.rows.length, 3)
})

for (const code of [' Ref-A ', '   ', 'aBc', 'ABC']) test(`exact entered referral retained: ${JSON.stringify(code)}`, async () => {
  const f = fixture()
  await register({ ...input(), referralCode: code }, f.ports)
  assert.equal(f.payloads.verify.code, code)
  assert.equal(f.payloads.verify.policy, 'synthetic-policy:referralCode')
  assert.ok(!Object.hasOwn(f.payloads.prepare, 'referralCode'))
})

for (const kind of ['invalid', 'disabled', 'unavailable', 'unresolved']) test(`referral ${kind} aborts with field error and zero writes`, async () => {
  const f = fixture({ referral: { kind } })
  assert.deepEqual(await register(input(), f.ports), { kind: 'field-error', field: 'referralCode', code: kind })
  assert.deepEqual(f.events, ['prepare', 'begin', 'verify', 'abort'])
  assert.deepEqual(f.state.rows, [])
})

for (const referral of [null, {}, { kind: 'verified', sourceId: '' }, { kind: 'verified', sourceId: 'opaque-referrer' }, { kind: 'reported-valid' }]) test(`malformed referral authority response ${JSON.stringify(referral)} fails closed`, async () => {
  const f = fixture({ referral })
  assert.deepEqual(await register(input(), f.ports), { kind: 'field-error', field: 'referralCode', code: 'unavailable' })
  assert.equal(f.state.rows.length, 0)
})

test('verification exception is sanitized field error; rollback uncertainty supersedes it', async () => {
  const f = fixture({ verifyThrow: true })
  assert.deepEqual(await register(input(), f.ports), { kind: 'field-error', field: 'referralCode', code: 'unavailable' })
  const unknown = fixture({ verifyThrow: true, rollbackUnknown: true })
  assert.deepEqual(await register(input(), unknown.ports), { kind: 'outcome-unknown', retry: 'reconciliation-required' })
})

for (const key of ['role', 'status', 'assignedSalesId', 'entitlement', 'subscription', 'verification', 'referralSourceId', 'policies']) test(`browser ${key} rejected before any port call`, async () => {
  const f = fixture()
  assert.deepEqual(await register({ ...input(), [key]: 'untrusted' }, f.ports), { kind: 'invalid-input' })
  assert.deepEqual(f.events, [])
})

test('reject malformed data, inherited fields, symbols and accessors without reading getters', async () => {
  let reads = 0
  const getter = { ...input() }; Object.defineProperty(getter, 'password', { get() { reads++; return 'secret' } })
  for (const data of [null, [], 'json', {}, { ...input(), password: null }, { ...input(), referralCode: 123 }, Object.create(input()), { ...input(), [Symbol('extra')]: 1 }, getter]) {
    const f = fixture()
    assert.equal((await register(data, f.ports)).kind, 'invalid-input')
    assert.deepEqual(f.events, [])
  }
  assert.equal(reads, 0)
})

for (const policy of policyNames) test(`unresolved ${policy} blocks preparation and transaction`, async () => {
  const f = fixture(); f.ports.policies[policy] = { state: 'unresolved' }
  assert.deepEqual(await register(input(), f.ports), { kind: 'policy-unresolved', policies: [policy] })
  assert.deepEqual(f.events, [])
})

test('missing/empty policy references fail closed, including optional-referral requests', async () => {
  const f = fixture(); delete f.ports.policies.identity
  f.ports.policies.referralCode = { state: 'resolved', reference: ' ' }
  const data = input(); delete data.referralCode
  assert.deepEqual(await register(data, f.ports), { kind: 'policy-unresolved', policies: ['identity', 'referralCode'] })
  assert.deepEqual(f.events, [])
})

for (const field of ['name', 'email', 'password']) test(`Auth rejects ${field} without entering transaction`, async () => {
  const f = fixture({ prepared: { kind: 'invalid', field } })
  assert.deepEqual(await register(input(), f.ports), { kind: 'field-error', field, code: 'invalid' })
  assert.deepEqual(f.events, ['prepare'])
})

test('Auth unresolved/exception/malformed credential result never creates user', async () => {
  for (const [options, expected] of [
    [{ prepared: { kind: 'unresolved', policy: 'password' } }, { kind: 'policy-unresolved', policies: ['password'] }],
    [{ prepareThrow: true }, { kind: 'unavailable' }],
    [{ prepared: { kind: 'ready', name: 'n', email: 'e', passwordHash: '' } }, { kind: 'unavailable' }],
  ]) {
    const f = fixture(options)
    assert.deepEqual(await register(input(), f.ports), expected)
    assert.deepEqual(f.events, ['prepare'])
  }
})

test('snapshot prevents caller mutation of referral and policy references during await', async () => {
  const wait = deferred(), f = fixture({ prepareWait: wait.promise }), data = input()
  const pending = register(data, f.ports)
  data.referralCode = 'changed'; f.ports.policies.referralCode.reference = 'changed'
  wait.resolve(); await pending
  assert.equal(f.payloads.verify.code, ' Ref-A ')
  assert.equal(f.payloads.verify.policy, 'synthetic-policy:referralCode')
  assert.ok(Object.isFrozen(f.payloads.policies))
})

test('pending server verification cannot produce partial success or writes', async () => {
  const wait = deferred(), f = fixture({ verifyWait: wait.promise })
  let settled = false
  const pending = register(input(), f.ports).then(result => { settled = true; return result })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false); assert.equal(f.state.rows.length, 0)
  assert.deepEqual(f.events, ['prepare', 'begin', 'verify'])
  wait.resolve(); assert.equal((await pending).kind, 'committed')
})

test('duplicate email precheck aborts without writes', async () => {
  const f = fixture({ exists: true })
  assert.deepEqual(await register(input(), f.ports), { kind: 'field-error', field: 'email', code: 'duplicate-email' })
  assert.ok(!f.events.includes('user')); assert.equal(f.state.rows.length, 0)
})

test('unique constraint race is mapped only by trusted rolled-back adapter error', async () => {
  const f = fixture({ fail: 'user', error: new RegistrationRolledBackError('duplicate-email') })
  assert.deepEqual(await register(input(), f.ports), { kind: 'field-error', field: 'email', code: 'duplicate-email' })
  assert.equal(f.state.rows.length, 0)
})

for (const fail of ['user', 'profile', 'attribution', 'audit']) test(`${fail} failure aborts entire double transaction; no partial committed rows`, async () => {
  const f = fixture({ fail, error: new RegistrationRolledBackError('unavailable') })
  assert.deepEqual(await register(input(), f.ports), { kind: 'unavailable' })
  assert.equal(f.state.rows.length, 0)
  assert.equal(f.events.at(-1), 'abort')
  assert.ok(!f.events.includes('commit'))
  assert.equal(f.state.attempts, 1)
})

test('raw database failure and fake error codes never escape or become authority', async () => {
  const f = fixture({ fail: 'audit', error: { kind: 'duplicate-email', message: 'secret SQL PII', code: 'P2002' } })
  assert.deepEqual(await register(input(), f.ports), { kind: 'outcome-unknown', retry: 'reconciliation-required' })
  assert.equal(f.state.rows.length, 0)
})

test('serialization conflict rolls back and never auto-retries callback', async () => {
  const f = fixture({ conflict: true })
  assert.deepEqual(await register(input(), f.ports), { kind: 'conflict', retry: 'new-server-attempt-required' })
  assert.equal(f.state.attempts, 1); assert.equal(f.state.rows.length, 0)
})

test('repeated client attempt rechecks authority; duplicate does not create attribution/audit twice', async () => {
  const f = fixture()
  assert.equal((await register(input(), f.ports)).kind, 'committed')
  assert.deepEqual(await register(input(), f.ports), { kind: 'field-error', field: 'email', code: 'duplicate-email' })
  assert.equal(f.state.rows.length, 4)
  assert.equal(f.events.filter(event => event === 'verify').length, 2)
})

test('success waits for commit acknowledgement after audit', async () => {
  const wait = deferred(), f = fixture({ commitWait: wait.promise })
  let settled = false
  const pending = register(input(), f.ports).then(result => { settled = true; return result })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.events.at(-1), 'audit'); assert.equal(settled, false); assert.equal(f.state.rows.length, 0)
  wait.resolve(); assert.deepEqual(await pending, { kind: 'committed' })
})

for (const when of ['before', 'after']) test(`lost commit ACK ${when} durable write is unknown, never safe automatic retry`, async () => {
  const f = fixture({ commitFailure: when })
  assert.deepEqual(await register(input(), f.ports), { kind: 'outcome-unknown', retry: 'reconciliation-required' })
  assert.equal(f.state.attempts, 1)
  assert.equal(f.state.rows.length, when === 'after' ? 4 : 0)
})

test('adapter callback omission/replay cannot produce success', async () => {
  for (const options of [{ skipCallback: true }, { replayCallback: true }]) {
    const f = fixture(options)
    assert.equal((await register(input(), f.ports)).kind, 'outcome-unknown')
    assert.equal(f.state.rows.length, 0)
  }
})

test('audit contains only event, opaque identities and policy references; core has no logging or production wiring', async () => {
  const f = fixture(); const result = await register(input(), f.ports)
  assert.deepEqual(Object.keys(f.payloads.audit).sort(), ['customerProfileId', 'event', 'policyReferences', 'referralSourceId', 'referralSourceVersion', 'userId'])
  const publicAndAudit = JSON.stringify([result, f.payloads.audit])
  for (const secret of Object.values(input())) assert.ok(!publicAndAudit.includes(secret))
  const source = readFileSync(new URL(modules[1]), 'utf8')
  assert.match(source, /import 'server-only'/)
  assert.doesNotMatch(source, /console\.|fetch\(|\bprocess\.env|['"]use server['"]|@\/lib\//)
})
