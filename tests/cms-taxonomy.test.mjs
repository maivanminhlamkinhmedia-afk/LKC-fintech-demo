import assert from 'node:assert/strict'
import test from 'node:test'
import { INSTRUMENT_TYPES, TaxonomyError, mapTaxonomyError, normalizeTaxonomyDelete, normalizeTaxonomyInput, normalizeTaxonomySearch, parseTaxonomyId, parseTaxonomyKind, parseTaxonomyTimestamp } from '../src/features/cms/taxonomy.ts'

const token = '2026-09-28T00:00:00.123Z'
const create = (kind, change = {}) => ({ name: '  Tên tiếng Việt  ', ...(kind === 'instrument'
  ? { symbol: 'vnm', instrumentType: 'EQUITY', exchange: ' hose ', countryCode: 'vn', currency: 'vnd', isActive: true }
  : { slug: ' danh-muc ', ...(kind !== 'tag' ? { description: null, isActive: true } : {}), ...(kind === 'category' ? { sortOrder: 0 } : {}) }), ...change })
const update = (kind, change = {}) => { const input = create(kind, change); for (const key of ['slug', 'symbol', 'instrumentType', 'exchange']) delete input[key]; return { ...input, expectedUpdatedAt: token } }
const invalid = callback => assert.throws(callback, error => error instanceof TaxonomyError && error.code === 'VALIDATION_ERROR')

test('TAX-02/03/04: exact four create/update contracts normalize canonical Unicode metadata', () => {
  for (const kind of ['category', 'topic', 'tag', 'instrument']) {
    const result = normalizeTaxonomyInput(kind, 'create', create(kind, { name: ' Tên  ' }))
    assert.equal(result.data.name, 'Tên'); assert.equal(result.expectedUpdatedAt, null)
    const changed = normalizeTaxonomyInput(kind, 'update', update(kind))
    assert.equal(changed.expectedUpdatedAt.toISOString(), token)
    for (const key of ['slug', 'canonicalKey', 'symbol', 'exchange', 'instrumentType']) assert.equal(Object.hasOwn(changed.data, key), false)
  }
})
test('TAX-04: every required create field is required; extras, undefined and immutable update fields rejected', () => {
  for (const kind of ['category', 'topic', 'tag', 'instrument']) {
    const good = create(kind)
    for (const key of Object.keys(good)) { const missing = { ...good }; delete missing[key]; invalid(() => normalizeTaxonomyInput(kind, 'create', missing)); invalid(() => normalizeTaxonomyInput(kind, 'create', { ...good, [key]: undefined })) }
    for (const key of ['createdAt', 'id', 'canonicalKey', 'toJSON', 'articles']) invalid(() => normalizeTaxonomyInput(kind, 'create', { ...good, [key]: 'forged' }))
    for (const key of ['slug', 'symbol', 'instrumentType', 'exchange']) invalid(() => normalizeTaxonomyInput(kind, 'update', { ...update(kind), [key]: 'forged' }))
  }
})
test('TAX-04: hostile objects reject without executing getters/toJSON; proxy traps fail safely', () => {
  let invoked = 0
  for (const field of ['name', 'slug']) {
    const getter = Object.defineProperty(create('tag'), field, { enumerable: true, get() { invoked++; return 'unsafe' } })
    invalid(() => normalizeTaxonomyInput('tag', 'create', getter))
  }
  for (const value of [[], null, new Date(), Object.assign(Object.create({ inherited: true }), create('tag')),
    { ...create('tag'), [Symbol('hidden')]: 'x' }, Object.defineProperty(create('tag'), 'name', { value: 'X', enumerable: false }),
    { ...create('tag'), toJSON() { invoked++; return create('tag') } }, new Proxy({}, { ownKeys() { throw new Error('SECRET') } })]) invalid(() => normalizeTaxonomyInput('tag', 'create', value))
  assert.equal(invoked, 0)
})
test('TAX-04: Unicode limits count code points and retain normal description newline', () => {
  assert.equal(normalizeTaxonomyInput('category', 'create', create('category', { name: '😀'.repeat(180), description: '  Dòng 1\nDòng 2  ' })).data.description, 'Dòng 1\nDòng 2')
  for (const name of ['', ' ', '😀'.repeat(181), 'A\nB', '\tName', 'Name\0', 'A\u2028B']) invalid(() => normalizeTaxonomyInput('tag', 'create', create('tag', { name })))
  assert.equal(normalizeTaxonomyInput('topic', 'create', create('topic', { description: '  ' })).data.description, null)
  invalid(() => normalizeTaxonomyInput('topic', 'create', create('topic', { description: 'x'.repeat(4001) })))
})
test('TAX-04: slug, boolean, sort order primitives/ranges strictly validated', () => {
  assert.equal(normalizeTaxonomyInput('tag', 'create', create('tag', { slug: ' ABC-123 ' })).data.slug, 'abc-123')
  for (const slug of ['a--b', '-a', 'a-', 'á', 'a/b', 'a_b', 'a'.repeat(121), '', 1]) invalid(() => normalizeTaxonomyInput('tag', 'create', create('tag', { slug })))
  for (const sortOrder of ['0', null, true, NaN, Infinity, -10001, 10001, 1.1]) invalid(() => normalizeTaxonomyInput('category', 'create', create('category', { sortOrder })))
  for (const isActive of [1, 'true', null]) invalid(() => normalizeTaxonomyInput('topic', 'create', create('topic', { isActive })))
  invalid(() => normalizeTaxonomyInput('tag', 'create', { ...create('tag'), isActive: true }))
})
test('TAX-05: server canonical identity follows examples and all instrument enum values', () => {
  for (const [instrumentType, exchange, symbol, expected] of [['INDEX', null, 'vnindex', 'VNINDEX'], ['EQUITY', 'hose', 'vnm', 'HOSE:VNM'], ['EQUITY', 'hnx', 'shs', 'HNX:SHS'], ['EQUITY', 'nasdaq', 'aapl', 'NASDAQ:AAPL'], ['FX', null, 'usdvnd', 'FX:USDVND'], ['CRYPTO', '', 'btcusd', 'CRYPTO:BTCUSD']]) {
    assert.equal(normalizeTaxonomyInput('instrument', 'create', create('instrument', { instrumentType, exchange, symbol })).data.canonicalKey, expected)
  }
  for (const instrumentType of INSTRUMENT_TYPES) assert.equal(normalizeTaxonomyInput('instrument', 'create', create('instrument', { instrumentType, exchange: null })).data.instrumentType, instrumentType)
  for (const type of ['EQUITY', 'FUND']) assert.equal(normalizeTaxonomyInput('instrument', 'create', create('instrument', { instrumentType: type })).data.canonicalKey, 'HOSE:VNM')
})
test('TAX-05: reserved namespaces, injection, ASCII, optional codes and non-alias behavior', () => {
  for (const symbol of ['HOSE:VNM', 'A B', 'Đ', '/A', 'a'.repeat(49), 'A\n', null]) invalid(() => normalizeTaxonomyInput('instrument', 'create', create('instrument', { symbol })))
  for (const exchange of ['FX', 'CRYPTO', 'A/B', 'a'.repeat(33)]) invalid(() => normalizeTaxonomyInput('instrument', 'create', create('instrument', { exchange })))
  for (const instrumentType of ['FX', 'CRYPTO']) invalid(() => normalizeTaxonomyInput('instrument', 'create', create('instrument', { instrumentType, exchange: 'VENUE' })))
  for (const change of [{ countryCode: 'USA' }, { currency: 'VN' }, { instrumentType: 'STOCK' }]) invalid(() => normalizeTaxonomyInput('instrument', 'create', create('instrument', change)))
  const keys = ['USD/VND', 'USDVND'].map(symbol => normalizeTaxonomyInput('instrument', 'create', create('instrument', { instrumentType: 'FX', exchange: null, symbol })).data.canonicalKey)
  assert.notEqual(...keys)
})
test('TAX-04/06: canonical timestamp, bounded ID/kind and exact delete token', () => {
  assert.equal(parseTaxonomyTimestamp(token).toISOString(), token)
  for (const value of ['2026-09-28T00:00:00Z', '2026-02-30T00:00:00.000Z', '0999-01-01T00:00:00.000Z', new Date(token), token.replace('Z', '+00:00')]) invalid(() => parseTaxonomyTimestamp(value))
  for (const value of ['../x', '', 'x'.repeat(192), {}, null]) assert.throws(() => parseTaxonomyId(value))
  for (const value of ['article', '__proto__', {}, 'CATEGORY']) invalid(() => parseTaxonomyKind(value))
  invalid(() => normalizeTaxonomyDelete({ expectedUpdatedAt: token, id: 'x' }))
})
test('TAX-09: bounded search exact payload never coerces malformed page', () => {
  assert.deepEqual(normalizeTaxonomySearch({ q: ' VN ', page: 100000, active: 'active' }), { q: 'VN', page: 100000, active: 'active' })
  for (const page of [0, -1, 1.5, 100001, NaN, Infinity, '1']) invalid(() => normalizeTaxonomySearch({ q: '', page, active: 'all' }))
  invalid(() => normalizeTaxonomySearch({ q: '😀'.repeat(101), page: 1, active: 'all' }))
})
test('TAX-27: safe errors map operation-specific FK/unique/deadlock without getters or raw text', () => {
  for (const [error, deleting, expected] of [[{ code: 'P2002', message: 'SECRET' }, false, 'IDENTITY_CONFLICT'], [{ code: 'P2003' }, true, 'TAXONOMY_IN_USE'], [{ code: 'P2003' }, false, 'INTERNAL_ERROR'], [{ code: 'P2034' }, false, 'EDIT_CONFLICT'], [{ code: 'P2010', meta: { driverAdapterError: { cause: { kind: 'TransactionWriteConflict' } } } }, false, 'EDIT_CONFLICT']]) assert.equal(mapTaxonomyError(error, deleting).code, expected)
  let invoked = 0
  const hostile = Object.defineProperty({}, 'code', { get() { invoked++; return 'SECRET' } })
  assert.equal(mapTaxonomyError(hostile).code, 'INTERNAL_ERROR'); assert.equal(invoked, 0)
  const mapped = mapTaxonomyError(new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('SECRET') } }))
  assert.equal(JSON.stringify(mapped).includes('SECRET'), false)
})
