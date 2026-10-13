import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { evaluateSuppliedProductAccess as evaluate } from '../src/features/subscriptions/product-access-policy.ts'

// ALL fixtures are synthetic hypotheses, not approved live interval/revoke rules,
// authenticated identities, trusted clocks, real Products or authoritative grants.
const groups = ['MANUAL_RECOMMENDATION', 'AUTOMATED_RECOMMENDATION', 'PROBABILITY_OUTLOOK']
const productNames = ['Chứng khoán cơ sở', 'Chứng khoán phái sinh', 'Hàng hóa phái sinh', 'Vàng', 'Tài sản số']
const product = id => ({ kind: 'PRODUCT', id, saleStopped: false })
const period = (periodId = 'period-a', productId = 'product-a', extra = {}) => ({
  periodId, productId, startsAt: 100, endsAt: 200, revoked: false, ...extra,
})
const fixture = () => ({
  actor: { state: 'PRESENT', subjectId: 'subject-a', status: 'ACTIVE' },
  audience: { productIds: ['product-a'], group: groups[0], reading: 'CURRENT', revisionRequirement: 'NOT_REQUESTED' },
  catalog: { state: 'AVAILABLE', products: [product('product-a'), product('product-b')] },
  entitlements: { state: 'AVAILABLE', subjectId: 'subject-a', periods: [period()] },
  at: 150,
  policy: { kind: 'SYNTHETIC', interval: 'START_INCLUSIVE_END_EXCLUSIVE', revocationScope: 'PERIOD' },
})
const decision = reason => ({
  basis: 'SUPPLIED_SNAPSHOTS_ONLY', runtimeAuthorized: false, allow: reason === 'ALLOW', reason,
})
const expect = (input, reason) => assert.deepEqual(evaluate(input), decision(reason))
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}

test('PA-01: guest, inactive actor and active identity with no entitlement deny', () => {
  const guest = fixture()
  guest.actor = { state: 'GUEST' }
  expect(guest, 'UNAUTHENTICATED')
  const inactive = fixture()
  inactive.actor.status = 'INACTIVE'
  expect(inactive, 'FORBIDDEN')
  const empty = fixture()
  empty.entitlements.periods = []
  expect(empty, 'NO_ENTITLEMENT')
  const otherSubject = fixture()
  otherSubject.entitlements.subjectId = 'subject-b'
  expect(otherSubject, 'FORBIDDEN')
})

test('PA-02: A entitlement opens A and A+B OR, never B-only', () => {
  const input = fixture()
  expect(input, 'ALLOW')
  input.audience.productIds = ['product-b']
  expect(input, 'NO_ENTITLEMENT')
  input.audience.productIds = ['product-b', 'product-a']
  expect(input, 'ALLOW')
  input.audience.productIds.reverse()
  expect(input, 'ALLOW')
})

for (const [index, label] of productNames.entries()) {
  for (const group of groups) {
    test(`PA-02: synthetic Product ${label} includes ${group} without a priced tab`, () => {
      const input = fixture()
      const ids = productNames.map((_, i) => `opaque-product-${i}`)
      input.catalog.products = ids.map(product)
      input.entitlements.periods = [period('fixture-period', ids[index])]
      input.audience.productIds = [ids[index]]
      input.audience.group = group
      expect(input, 'ALLOW')
      for (const other of ids.filter(id => id !== ids[index])) {
        input.audience.productIds = [other]
        expect(input, 'NO_ENTITLEMENT')
      }
    })
  }
}

test('PA-02/05: expiration of A leaves all three groups of B available', () => {
  const input = fixture()
  input.entitlements.periods = [period('old-a', 'product-a', { endsAt: 150 }), period('valid-b', 'product-b')]
  for (const group of groups) {
    input.audience.group = group
    input.audience.productIds = ['product-a']
    expect(input, 'EXPIRED')
    input.audience.productIds = ['product-b']
    expect(input, 'ALLOW')
    input.audience.productIds = ['product-a', 'product-b']
    expect(input, 'ALLOW')
  }
})

test('PA-03: missing, empty, duplicate, malformed and unknown audience IDs never wildcard', () => {
  for (const ids of [undefined, null, [], '', ['product-a', 'product-a'], [1], [''], ['product-a\n'],
    [' product-a'], ['product-a '], ['GOLD'], ['BTC'], ['VN30'], ['unknown'], ['product-a', 'unknown'],
    Array.from({ length: 51 }, (_, i) => `p${i}`)]) {
    const input = fixture()
    input.audience.productIds = ids
    expect(input, 'INVALID_INPUT')
  }
  for (const group of ['WEBHOOK', 'STAFF', 'PREMIUM_TAB', '', null, 0]) {
    const input = fixture()
    input.audience.group = group
    expect(input, 'INVALID_INPUT')
  }
})

test('PA-03: Product identity is explicit; instrument, plan, name and symbol cannot substitute', () => {
  for (const identity of [
    { kind: 'FINANCIAL_INSTRUMENT', id: 'product-a', saleStopped: false },
    { kind: 'PRODUCT_PLAN', id: 'product-a', saleStopped: false },
    { kind: 'PRODUCT', name: 'Vàng', saleStopped: false },
    { kind: 'PRODUCT', symbol: 'GOLD', saleStopped: false },
  ]) {
    const input = fixture()
    input.catalog.products[0] = identity
    expect(input, 'INVALID_INPUT')
  }
  // An opaque ID may happen to spell GOLD; only exact supplied catalog+grant
  // identity gives hypothetical access, never symbol inference or a name map.
  const opaque = fixture()
  opaque.catalog.products = [product('GOLD')]
  opaque.entitlements.periods = [period('p', 'GOLD')]
  opaque.audience.productIds = ['GOLD']
  expect(opaque, 'ALLOW')
})

test('PA-04: synthetic [start,end) only, using the exact supplied fixed instant', () => {
  for (const [at, reason] of [[99, 'NOT_STARTED'], [100, 'ALLOW'], [199, 'ALLOW'], [200, 'EXPIRED'], [201, 'EXPIRED']]) {
    const input = fixture()
    input.at = at
    expect(input, reason)
  }
  for (const policy of [{ kind: 'UNRESOLVED' },
    { kind: 'SYNTHETIC', interval: 'UNRESOLVED', revocationScope: 'PERIOD' },
    { kind: 'SYNTHETIC', interval: 'START_INCLUSIVE_END_EXCLUSIVE', revocationScope: 'UNRESOLVED' }]) {
    const input = fixture()
    input.policy = policy
    expect(input, 'POLICY_UNRESOLVED')
  }
  const implicit = fixture()
  delete implicit.policy
  expect(implicit, 'INVALID_INPUT')
})

test('PA-04: invalid instants and intervals cannot turn into active grants', () => {
  for (const at of [undefined, null, true, '150', new Date(150), NaN, Infinity, -Infinity, 150.5,
    Number.MAX_SAFE_INTEGER, -8640000000000001]) {
    const input = fixture()
    input.at = at
    expect(input, 'INVALID_INPUT')
  }
  for (const extra of [{ startsAt: 200 }, { startsAt: 201 }, { startsAt: '100' }, { endsAt: NaN },
    { startsAt: null }, { endsAt: Infinity }, { endsAt: 199.5 }]) {
    const input = fixture()
    input.entitlements.periods = [period('p', 'product-a', extra)]
    expect(input, 'INVALID_INPUT')
  }
  const beforeEpoch = fixture()
  beforeEpoch.at = -150
  beforeEpoch.entitlements.periods = [period('p', 'product-a', { startsAt: -200, endsAt: -100 })]
  expect(beforeEpoch, 'ALLOW')
})

test('PA-05: valid alternative period wins over expired, future and period-revoked grants', () => {
  const input = fixture()
  const alternatives = [period('expired', 'product-a', { endsAt: 150 }),
    period('future', 'product-a', { startsAt: 151 }), period('revoked', 'product-a', { revoked: true }), period('valid')]
  for (let offset = 0; offset < alternatives.length; offset++) {
    input.entitlements.periods = [...alternatives.slice(offset), ...alternatives.slice(0, offset)]
    expect(input, 'ALLOW')
    input.entitlements.periods.reverse()
    expect(input, 'ALLOW')
  }
})

test('PA-05: exact synthetic period revocation isolates another Product and another period', () => {
  const input = fixture()
  input.entitlements.periods = [period('revoked-a', 'product-a', { revoked: true }), period('valid-b', 'product-b')]
  expect(input, 'REVOKED')
  input.audience.productIds = ['product-b']
  expect(input, 'ALLOW')
  input.audience.productIds = ['product-a', 'product-b']
  expect(input, 'ALLOW')
  input.audience.productIds = ['product-a']
  input.entitlements.periods.push(period('replacement-a'))
  expect(input, 'ALLOW')
  input.policy.revocationScope = 'UNRESOLVED'
  expect(input, 'POLICY_UNRESOLVED')
})

test('PA-05: mixed deny reasons remain unresolved, independent of audience/period ordering', () => {
  const input = fixture()
  input.entitlements.periods = [period('expired', 'product-a', { endsAt: 150 }), period('future', 'product-a', { startsAt: 151 })]
  expect(input, 'POLICY_UNRESOLVED')
  input.entitlements.periods.reverse()
  expect(input, 'POLICY_UNRESOLVED')
  input.entitlements.periods = [period('expired', 'product-a', { endsAt: 150 })]
  input.audience.productIds = ['product-a', 'product-b']
  expect(input, 'POLICY_UNRESOLVED')
  input.audience.productIds.reverse()
  expect(input, 'POLICY_UNRESOLVED')
  input.audience.productIds = ['product-a']
  input.entitlements.periods = [period('expired-revoked', 'product-a', { endsAt: 150, revoked: true })]
  expect(input, 'POLICY_UNRESOLVED')
  input.entitlements.periods = [period('revoked-future', 'product-a', { startsAt: 151, revoked: true })]
  expect(input, 'POLICY_UNRESOLVED')
})

test('PA-05: repeated identical deny reasons are safe without defining precedence', () => {
  const input = fixture()
  input.entitlements.periods = [period('old1', 'product-a', { endsAt: 150 }), period('old2', 'product-a', { endsAt: 149 })]
  expect(input, 'EXPIRED')
  input.entitlements.periods = []
  input.audience.productIds = ['product-a', 'product-b']
  expect(input, 'NO_ENTITLEMENT')
})

test('PA-05/06: simultaneous failed preconditions also have no invented deny precedence', () => {
  const input = fixture()
  input.actor = { state: 'GUEST' }
  input.entitlements = { state: 'UNAVAILABLE' }
  expect(input, 'POLICY_UNRESOLVED')
  input.actor = fixture().actor
  input.actor.status = 'INACTIVE'
  expect(input, 'POLICY_UNRESOLVED')
  input.entitlements = fixture().entitlements
  input.policy = { kind: 'UNRESOLVED' }
  expect(input, 'POLICY_UNRESOLVED')
})

test('PA-06: unavailable source/catalog deny even with an otherwise valid grant', () => {
  for (const key of ['catalog', 'entitlements']) {
    const input = fixture()
    input[key] = { state: 'UNAVAILABLE' }
    expect(input, 'PRODUCT_UNAVAILABLE')
    for (const invalid of [undefined, null, false, '', [], {}, { state: 'AVAILABLE' }, { state: 'UNKNOWN' }]) {
      input[key] = invalid
      expect(input, 'INVALID_INPUT')
    }
  }
})

test('PA-06: malformed unrelated periods/catalog cannot hide behind an OR success', () => {
  for (const badPeriod of [null, {}, period('other', 'unknown'), period('other', 'product-b', { revoked: 'false' }),
    period('other', 'product-b', { endsAt: 0 }), period('period-a', 'product-b')]) {
    const input = fixture()
    input.entitlements.periods.push(badPeriod)
    expect(input, 'INVALID_INPUT')
  }
  for (const badProduct of [null, {}, product('product-a'), { ...product('other'), saleStopped: 0 }]) {
    const input = fixture()
    input.catalog.products.push(badProduct)
    expect(input, 'INVALID_INPUT')
  }
})

test('PA-06: accessors at every input level fail safely without being invoked', () => {
  const places = [input => [input, 'actor'], input => [input.actor, 'subjectId'],
    input => [input.audience, 'productIds'], input => [input.catalog, 'products'],
    input => [input.catalog.products[0], 'id'], input => [input.entitlements, 'periods'],
    input => [input.entitlements.periods[0], 'revoked'], input => [input.policy, 'interval']]
  for (const place of places) {
    const input = fixture()
    let calls = 0
    const [target, key] = place(input)
    Object.defineProperty(target, key, { enumerable: true, get() { calls++; throw new Error('private SQL/contact/payment') } })
    expect(input, 'INVALID_INPUT')
    assert.equal(calls, 0)
  }
})

test('PA-06: hostile/revoked proxies fail closed without leaking raw errors', () => {
  const fail = () => { throw new Error('secret SQL/customer/path') }
  const revoked = Proxy.revocable({}, {})
  revoked.revoke()
  for (const bad of [new Proxy({}, { getPrototypeOf: fail }), new Proxy({}, { ownKeys: fail }),
    new Proxy(fixture(), { getOwnPropertyDescriptor: fail }), revoked.proxy]) expect(bad, 'INVALID_INPUT')
  const input = fixture()
  input.entitlements.periods = new Proxy([period()], { ownKeys: fail })
  expect(input, 'INVALID_INPUT')
})

test('PA-06: sparse, accessor, extended and iterator-spoofed arrays are rejected without execution', () => {
  const sparse = new Array(1)
  const accessor = ['product-a']
  let calls = 0
  Object.defineProperty(accessor, '0', { get() { calls++; throw new Error('private') } })
  const extended = Object.assign(['product-a'], { allow: true })
  const iterator = ['product-a']
  iterator[Symbol.iterator] = () => { calls++; throw new Error('private') }
  for (const ids of [sparse, accessor, extended, iterator]) {
    const input = fixture()
    input.audience.productIds = ids
    expect(input, 'INVALID_INPUT')
  }
  assert.equal(calls, 0)
  const inherited = Object.create(fixture())
  expect(inherited, 'INVALID_INPUT')
  const nullPrototype = Object.assign(Object.create(null), fixture())
  expect(nullPrototype, 'ALLOW')
})

test('PA-06: technical bounds reject oversized snapshots and overlong/invalid IDs', () => {
  const input = fixture()
  input.catalog.products = Array.from({ length: 1001 }, (_, i) => product(`p${i}`))
  expect(input, 'INVALID_INPUT')
  input.catalog = fixture().catalog
  input.entitlements.periods = new Array(10001)
  expect(input, 'INVALID_INPUT')
  for (const id of ['x'.repeat(192), 'p\u0000', 'p\n', 'p\r', 'p/p', 'p.p', 'p🙂']) {
    const bad = fixture()
    bad.actor.subjectId = id
    expect(bad, 'INVALID_INPUT')
  }
})

test('PA-07: stopped sale alone never revokes valid grants in any included group', () => {
  const input = fixture()
  input.catalog.products[0].saleStopped = true
  for (const group of groups) {
    input.audience.group = group
    expect(input, 'ALLOW')
  }
  input.entitlements.periods = []
  expect(input, 'NO_ENTITLEMENT')
})

test('PA-08: allow/deny outputs contain only safe primitive fields and are immutable fresh objects', () => {
  const inputs = [fixture(), null, { ...fixture(), policy: { kind: 'UNRESOLVED' } }]
  for (const input of inputs) {
    const output = evaluate(input)
    assert.deepEqual(Object.keys(output).sort(), ['allow', 'basis', 'reason', 'runtimeAuthorized'])
    assert.ok(Object.values(output).every(value => ['string', 'boolean'].includes(typeof value)))
    assert.equal(output.runtimeAuthorized, false)
    assert.ok(Object.isFrozen(output))
    assert.notEqual(output, evaluate(input))
    assert.throws(() => { output.allow = true }, TypeError)
    assert.doesNotMatch(JSON.stringify(output), /subject-a|product-a|period-a|SQL|payment|contact|body|stack/)
  }
})

test('PA-08: frozen inputs remain unchanged, results are deterministic and calls share no state', () => {
  const input = freeze(fixture())
  const before = JSON.stringify(input)
  for (let i = 0; i < 20; i++) {
    expect(input, 'ALLOW')
    expect(null, 'INVALID_INPUT')
    const empty = fixture()
    empty.entitlements.periods = []
    expect(empty, 'NO_ENTITLEMENT')
  }
  assert.equal(JSON.stringify(input), before)
  const mutable = fixture()
  const prior = evaluate(mutable)
  mutable.entitlements.periods[0].revoked = true
  expect(mutable, 'REVOKED')
  assert.deepEqual(prior, decision('ALLOW'))
})

test('PA-09: browser fields and purported trust/approval flags cannot bypass the snapshot schema', () => {
  for (const [target, key, value] of [
    ['root', 'userId', 'subject-a'], ['root', 'role', 'SUPER_ADMIN'], ['root', 'allow', true],
    ['root', 'serverTime', 150], ['root', 'runtimeAuthorized', true], ['root', 'body', 'private'],
    ['actor', 'verified', true], ['actor', 'role', 'CLIENT'], ['actor', 'isPaid', true],
    ['entitlements', 'authoritative', true], ['policy', 'approved', true],
  ]) {
    const input = fixture()
    ;(target === 'root' ? input : input[target])[key] = value
    expect(input, 'INVALID_INPUT')
  }
  expect({ userId: 'subject-a', role: 'CLIENT', allow: true, at: 150 }, 'INVALID_INPUT')
  // A completely forged but structurally matching snapshot cannot be detected
  // here. The API explicitly makes NO provenance/runtime authorization claim.
  assert.equal(evaluate(fixture()).runtimeAuthorized, false)
})

test('PA-09: hostile values are never coerced and no supplied function is called', () => {
  let calls = 0
  const hostile = { toString() { calls++; return 'START_INCLUSIVE_END_EXCLUSIVE' }, valueOf() { calls++; return 150 } }
  const input = fixture()
  input.policy.interval = hostile
  expect(input, 'INVALID_INPUT')
  input.policy = fixture().policy
  input.at = hostile
  expect(input, 'INVALID_INPUT')
  assert.equal(calls, 0)
  for (const value of [undefined, null, false, 0, 1n, Symbol('private'), () => fixture(), [], new Date(), new Map()]) {
    expect(value, 'INVALID_INPUT')
  }
})

test('PA-10: required revision/history remain unresolved and no revision token is fabricated', () => {
  const input = fixture()
  input.audience.revisionRequirement = 'REQUIRED'
  expect(input, 'POLICY_UNRESOLVED')
  input.audience.revisionRequirement = 'NOT_REQUESTED'
  input.audience.reading = 'HISTORICAL'
  expect(input, 'POLICY_UNRESOLVED')
  for (const token of ['old-revision', 'new-revision', null]) {
    input.entitlements.revision = token
    expect(input, 'INVALID_INPUT')
  }
  assert.equal(Object.hasOwn(evaluate(fixture()), 'entitlementRevision'), false)
})

test('PA-08/09/10: source has only erased type imports and no runtime integration/clock/IO', () => {
  const source = readFileSync(new URL('../src/features/subscriptions/product-access-policy.ts', import.meta.url), 'utf8')
  assert.match(source, /^import type \{[\s\S]*?\} from '\.\/product-access-contract\.ts'/)
  assert.equal((source.match(/^import /gm) ?? []).length, 1)
  assert.doesNotMatch(source, /Date\.now|new Date|process\.|fetch\(|require\(|import\(|console\.|Math\.random/)
  assert.doesNotMatch(source, /['"]use (server|client)['"]|decideContentRead|server-only|@prisma|next-auth/)
})
