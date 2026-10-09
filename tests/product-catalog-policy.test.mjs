import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  validateProductIdentity,
  validateProductBenefits,
  projectSelectableCatalog,
  validateProductSelection,
} from '../src/features/products/product-catalog-policy.ts'

// Fixtures only: these IDs/names do not seed or configure a production catalog.
const groups = ['MANUAL_RECOMMENDATION', 'AUTOMATED_RECOMMENDATION', 'PROBABILITY_OUTLOOK']
const productNames = ['Chứng khoán cơ sở', 'Chứng khoán phái sinh', 'Hàng hóa phái sinh', 'Vàng', 'Tài sản số']
const product = (id = 'fixture-product-a', extra = {}) => ({
  kind: 'product', id, name: 'Fixture A', selectableForContent: true,
  saleStopped: false, retired: false, benefitGroups: [...groups], ...extra,
})
const snapshot = (items = [product()], catalogVersion = 'fixture-catalog-v1') => ({ state: 'AVAILABLE', catalogVersion, items })
const selectionOptions = { usage: 'new-selection', maxProductIds: 8 }
const denied = error => ({ ok: false, error })

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

test('PCAT-01: Product identity excludes plan/instrument identity; rename preserves supplied ID', () => {
  const identity = { kind: 'product', id: 'opaque-A' }
  assert.deepEqual(validateProductIdentity(identity), { ok: true, value: identity })
  for (const kind of ['product-plan', 'financial-instrument']) {
    assert.deepEqual(validateProductIdentity({ kind, id: 'opaque-A', productId: 'opaque-A' }), denied('VALIDATION_ERROR'))
  }
  const before = projectSelectableCatalog(snapshot([product('opaque-A', { name: 'Before', slug: 'before' })]))
  const after = projectSelectableCatalog(snapshot([product('opaque-A', { name: 'After', slug: 'after' })]))
  assert.equal(before.value.items[0].id, after.value.items[0].id)
  assert.equal(after.value.items[0].name, 'After')
})

test('PCAT-02: five fixture Products each include all three groups with no priced tab', () => {
  const records = productNames.map((name, i) => product(`fixture-p${i}`, { name }))
  const output = projectSelectableCatalog(snapshot(records))
  assert.deepEqual(output, {
    ok: true,
    value: {
      catalogVersion: 'fixture-catalog-v1',
      items: records.map(({ id, name }) => ({ id, name, selectableForContent: true })),
    },
  })
  for (const record of records) {
    assert.deepEqual(validateProductSelection([record.id], snapshot(records), selectionOptions), {
      ok: true, value: { productIds: [record.id], catalogVersion: 'fixture-catalog-v1' },
    })
    assert.deepEqual(validateProductBenefits(record.benefitGroups), { ok: true, value: groups })
  }
  assert.deepEqual(validateProductBenefits([...groups].reverse()), { ok: true, value: groups })
  // Origin and display group are separate; an origin is not an extra paid group.
  for (const origin of ['STAFF', 'WEBHOOK']) {
    assert.deepEqual(projectSelectableCatalog(snapshot([product('p', { origin })])), {
      ok: true,
      value: { catalogVersion: 'fixture-catalog-v1', items: [{ id: 'p', name: 'Fixture A', selectableForContent: true }] },
    })
  }
})

test('PCAT-02 negative: omitted, duplicate, unknown or priced groups cannot replace the bundle', () => {
  for (const benefits of [undefined, [], groups.slice(0, 2), [...groups, 'WEBHOOK'], [groups[0], groups[0], groups[2]], groups.map(group => ({ group, price: 1 }))]) {
    assert.deepEqual(validateProductBenefits(benefits), denied('VALIDATION_ERROR'))
    assert.deepEqual(projectSelectableCatalog(snapshot([product('p', { benefitGroups: benefits })])), denied('VALIDATION_ERROR'))
  }
})

test('PCAT-03: missing/empty/malformed/duplicate/oversized input fails without wildcard', () => {
  for (const ids of [undefined, null, [], Array(1), 'fixture-product-a', [null], [''], [' p'], [1], ['fixture-product-a', 'fixture-product-a']]) {
    assert.deepEqual(validateProductSelection(ids, snapshot(), selectionOptions), denied('VALIDATION_ERROR'))
  }
  assert.deepEqual(validateProductSelection(['a', 'b'], snapshot([product('a'), product('b')]), { usage: 'new-selection', maxProductIds: 1 }), denied('VALIDATION_ERROR'))
  for (const options of [undefined, { usage: 'new-selection' }, { usage: 'publish', maxProductIds: 8 }, { usage: 'new-selection', maxProductIds: 0 }]) {
    assert.deepEqual(validateProductSelection(['fixture-product-a'], snapshot(), options), denied('VALIDATION_ERROR'))
  }
  const invalidUsage = { toString() { throw new Error('Input must not be coerced') } }
  assert.deepEqual(validateProductSelection(['fixture-product-a'], snapshot(), { ...selectionOptions, usage: invalidUsage }), denied('VALIDATION_ERROR'))
  for (const maxProductIds of [NaN, Infinity, 1.5, '8', Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(validateProductSelection(['fixture-product-a'], snapshot(), { ...selectionOptions, maxProductIds }), denied('VALIDATION_ERROR'))
  }
})

test('PCAT-03: unknown IDs fail the whole set; known IDs retain identity and revision', () => {
  const input = snapshot([product('a'), product('b')], 'revision-2')
  assert.deepEqual(validateProductSelection(['b', 'a'], input, selectionOptions), { ok: true, value: { productIds: ['b', 'a'], catalogVersion: 'revision-2' } })
  for (const ids of [['unknown'], ['a', 'unknown'], ['unknown', 'a']]) {
    // This is membership against supplied records, not inference of an ID kind.
    assert.deepEqual(validateProductSelection(ids, input, selectionOptions), denied('PRODUCT_INVALID'))
  }
})

test('PCAT-03: malformed supplied records/revision and duplicate identity fail clearly', () => {
  for (const input of [undefined, {}, snapshot([], ''), snapshot([product('')]), snapshot([product('a'), product('a')]), snapshot([product('a', { selectableForContent: 'true' })]), snapshot([product('a', { name: '  ' })]), snapshot([product('a', { kind: 'product-plan' })])]) {
    assert.deepEqual(projectSelectableCatalog(input), denied('VALIDATION_ERROR'))
  }
})

test('PCAT-03/04: non-selectable is excluded from list and denied for new selection', () => {
  const input = snapshot([product('active'), product('hidden', { selectableForContent: false })])
  assert.deepEqual(projectSelectableCatalog(input).value.items.map(item => item.id), ['active'])
  assert.deepEqual(validateProductSelection(['hidden'], input, selectionOptions), denied('PRODUCT_INVALID'))
})

test('M1 / PCAT-04: retired is excluded from projection and all new selections, independent of selectability', () => {
  for (const selectableForContent of [false, true]) {
    const input = snapshot([product('active'), product('retired', { retired: true, selectableForContent })])
    assert.deepEqual(projectSelectableCatalog(input), {
      ok: true,
      value: { catalogVersion: 'fixture-catalog-v1', items: [{ id: 'active', name: 'Fixture A', selectableForContent: true }] },
    })
    for (const ids of [['retired'], ['active', 'retired'], ['retired', 'active']]) {
      assert.deepEqual(validateProductSelection(ids, input, selectionOptions), denied('PRODUCT_INVALID'))
      assert.deepEqual(validateProductSelection(ids, input, { ...selectionOptions, usage: 'retained-reference' }), denied('POLICY_UNRESOLVED'))
    }
    assert.deepEqual(projectSelectableCatalog(snapshot([product('retired', { retired: true, selectableForContent })])), {
      ok: true, value: { catalogVersion: 'fixture-catalog-v1', items: [] },
    })
  }
})

test('L1 / PCAT-03: snapshot.items accessor throws return a safe Result in both APIs', () => {
  const input = { state: 'AVAILABLE', catalogVersion: 'fixture-catalog-v1', get items() { throw new Error('Fixture accessor') } }
  assert.deepEqual(projectSelectableCatalog(input), denied('VALIDATION_ERROR'))
  assert.deepEqual(validateProductSelection(['p'], input, selectionOptions), denied('VALIDATION_ERROR'))
})

test('L1 / PCAT-03: item.name accessor throws return a safe Result in both APIs', () => {
  const item = product('p')
  Object.defineProperty(item, 'name', { get() { throw new Error('Fixture accessor') } })
  const input = snapshot([item])
  assert.deepEqual(projectSelectableCatalog(input), denied('VALIDATION_ERROR'))
  assert.deepEqual(validateProductSelection(['p'], input, selectionOptions), denied('VALIDATION_ERROR'))
})

test('L1 / PCAT-03: identity, benefits, IDs and options input reads also contain accessor throws', () => {
  assert.deepEqual(validateProductIdentity({ kind: 'product', get id() { throw new Error('Fixture accessor') } }), denied('VALIDATION_ERROR'))
  const benefits = [...groups]
  Object.defineProperty(benefits, 0, { get() { throw new Error('Fixture accessor') } })
  assert.deepEqual(validateProductBenefits(benefits), denied('VALIDATION_ERROR'))
  const ids = ['fixture-product-a']
  Object.defineProperty(ids, 0, { get() { throw new Error('Fixture accessor') } })
  assert.deepEqual(validateProductSelection(ids, snapshot(), selectionOptions), denied('VALIDATION_ERROR'))
  assert.deepEqual(validateProductSelection(['fixture-product-a'], snapshot(), {
    ...selectionOptions, get usage() { throw new Error('Fixture accessor') },
  }), denied('VALIDATION_ERROR'))
})

test('PCAT-04: stopped sale does not imply non-selectability or mutate supplied rights', () => {
  const rights = deepFreeze({ productId: 'p', periods: [{ id: 'old-grant', valid: true }], benefitGroups: [...groups] })
  const input = deepFreeze(snapshot([product('p', { saleStopped: true, rights })]))
  const before = JSON.stringify(input)
  assert.deepEqual(projectSelectableCatalog(input), {
    ok: true,
    value: { catalogVersion: 'fixture-catalog-v1', items: [{ id: 'p', name: 'Fixture A', selectableForContent: true }] },
  })
  assert.deepEqual(validateProductSelection(['p'], input, selectionOptions), { ok: true, value: { productIds: ['p'], catalogVersion: 'fixture-catalog-v1' } })
  assert.equal(JSON.stringify(input), before)
  assert.equal(rights.periods[0].valid, true)
  // This proves lack of mutation/denial due to sale flag, not entitlement runtime.
})

test('PCAT-04: retained retired policy remains unresolved, even with caller selectable flag', () => {
  for (const selectableForContent of [false, true]) {
    const input = snapshot([product('retired', { retired: true, selectableForContent })])
    assert.deepEqual(validateProductSelection(['retired'], input, { ...selectionOptions, usage: 'retained-reference' }), denied('POLICY_UNRESOLVED'))
  }
  assert.deepEqual(validateProductSelection(['active'], snapshot([product('active')]), { ...selectionOptions, usage: 'retained-reference' }), { ok: true, value: { productIds: ['active'], catalogVersion: 'fixture-catalog-v1' } })
})

test('PCAT-05: unavailable differs from an available empty catalog; no PUBLIC fallback', () => {
  const unavailable = { state: 'UNAVAILABLE', items: [], catalogVersion: 'ignored' }
  assert.deepEqual(projectSelectableCatalog(unavailable), denied('PRODUCT_UNAVAILABLE'))
  assert.deepEqual(validateProductSelection(['p'], unavailable, selectionOptions), denied('PRODUCT_UNAVAILABLE'))
  const unavailableWithUnusedAccessor = { state: 'UNAVAILABLE', get items() { throw new Error('Unused accessor') } }
  assert.deepEqual(projectSelectableCatalog(unavailableWithUnusedAccessor), denied('PRODUCT_UNAVAILABLE'))
  assert.deepEqual(validateProductSelection(['p'], unavailableWithUnusedAccessor, selectionOptions), denied('PRODUCT_UNAVAILABLE'))
  assert.deepEqual(projectSelectableCatalog(snapshot([])), { ok: true, value: { catalogVersion: 'fixture-catalog-v1', items: [] } })
  assert.deepEqual(validateProductSelection(['p'], snapshot([]), selectionOptions), denied('PRODUCT_INVALID'))
})

test('PCAT-06: CMS projection uses an exact metadata allowlist and fresh objects', () => {
  const input = snapshot([product('p', { body: 'private', price: 99, user: { id: 'u' }, payment: { id: 'pay' }, secret: 'fixture-only', slug: 'mutable' })])
  const result = projectSelectableCatalog({ ...input, privateField: 'fixture' })
  assert.deepEqual(result, { ok: true, value: { catalogVersion: 'fixture-catalog-v1', items: [{ id: 'p', name: 'Fixture A', selectableForContent: true }] } })
  result.value.items[0].name = 'Consumer edit'
  assert.equal(input.items[0].name, 'Fixture A')
  assert.deepEqual(validateProductIdentity(input.items[0]), { ok: true, value: { kind: 'product', id: 'p' } })
})

test('PCAT-07: frozen inputs, deterministic results and no runtime imports/side effects', () => {
  const input = deepFreeze(snapshot([product('a'), product('b')]))
  const ids = deepFreeze(['a', 'b'])
  const options = deepFreeze({ ...selectionOptions })
  const before = JSON.stringify({ input, ids, options })
  const first = validateProductSelection(ids, input, options)
  assert.deepEqual(first, validateProductSelection(ids, input, options))
  assert.equal(JSON.stringify({ input, ids, options }), before)
  const policySource = readFileSync(new URL('../src/features/products/product-catalog-policy.ts', import.meta.url), 'utf8')
  const contractSource = readFileSync(new URL('../src/features/products/product-catalog-contract.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(policySource, /\b(?:fetch|require|setTimeout|setInterval|process|globalThis)\s*(?:\.|\()/)
  assert.doesNotMatch(policySource, /(?:node:|@\/|prisma|readFile|writeFile|Date\.now|Math\.random)/)
  const valueImport = /^\s*import\b|\bimport\s*\(/m
  const allowedTypeImport = /^import type \{[\w,\s]*\} from '\.\/product-catalog-contract\.ts'\r?\n/m
  assert.match(policySource, allowedTypeImport)
  const policyWithoutAllowedImport = policySource.replace(allowedTypeImport, '')
  assert.doesNotMatch(policyWithoutAllowedImport, valueImport)
  assert.doesNotMatch(contractSource, valueImport)
  assert.doesNotMatch(policyWithoutAllowedImport, /^\s*export\s+(?:\*|\{[^}]*\})\s+from\b/m)
  // Negative controls: a relative value/side-effect/dynamic import must fail this guard.
  for (const addedImport of ["import { helper } from './other.ts'", "import './other.ts'", "const loader = import('./other.ts')"]) {
    assert.throws(() => assert.doesNotMatch(`${policyWithoutAllowedImport}\n${addedImport}`, valueImport))
  }
  assert.doesNotMatch(policySource, /(?:fixture-product|Chứng khoán|Hàng hóa|Tài sản số)/)
})
