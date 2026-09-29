import assert from 'node:assert/strict'
import test from 'node:test'
import { ArticleClassificationError, normalizeClassificationInput, mapClassificationError, classificationTimestamp, parseClassificationId } from '../src/features/cms/article-classification.ts'

const token = '2026-09-28T01:02:03.456Z'
const input = (changes = {}) => ({ categoryId: null, topicIds: [], tagIds: [], instrumentIds: [], primaryInstrumentId: null, expectedUpdatedAt: token, ...changes })
const invalid = value => assert.throws(() => normalizeClassificationInput(value), error => error instanceof ArticleClassificationError && error.code === 'VALIDATION_ERROR')

test('TAX-10/12: exact empty/full selection, sorted independent ID arrays and primary membership', () => {
  assert.deepEqual(normalizeClassificationInput(input()).selection, { categoryId: null, topicIds: [], tagIds: [], instrumentIds: [], primaryInstrumentId: null })
  const source = input({ categoryId: 'c-1', topicIds: ['z', 'a'], tagIds: ['Z_2', 'A'], instrumentIds: ['i2', 'i1'], primaryInstrumentId: 'i1' })
  const parsed = normalizeClassificationInput(source)
  assert.deepEqual(parsed.selection.topicIds, ['a', 'z']); assert.deepEqual(source.topicIds, ['z', 'a'])
  assert.equal(parsed.expectedUpdatedAt.toISOString(), token)
  invalid(input({ primaryInstrumentId: 'unselected' }))
  assert.equal(normalizeClassificationInput(input({ instrumentIds: ['i1'] })).selection.primaryInstrumentId, null)
})
test('TAX-12: each exact 5/10/10 limit passes; overflow/duplicates and primitive non-string IDs fail', () => {
  for (const [key, limit] of [['topicIds', 5], ['tagIds', 10], ['instrumentIds', 10]]) {
    const values = Array.from({ length: limit }, (_, i) => `id-${i}`)
    assert.equal(normalizeClassificationInput(input({ [key]: values })).selection[key].length, limit)
    for (const value of [[...values, 'extra'], ['same', 'same'], null, 'id', [1], [true], [undefined], [''], ['a/b'], ['a'.repeat(192)]]) invalid(input({ [key]: value }))
  }
  for (const id of [null, {}, 1, '', 'a/b', 'a'.repeat(192)]) assert.throws(() => parseClassificationId(id))
  for (const id of ['_', 'a'.repeat(191), 'AZ_09-x']) assert.equal(parseClassificationId(id), id)
})
test('TAX-04/12: hostile roots reject without executing accessors, coercion or toJSON', () => {
  let calls = 0
  const accessor = Object.defineProperty(input(), 'categoryId', { enumerable: true, get() { calls++; return null } })
  const hidden = Object.defineProperty(input(), 'categoryId', { enumerable: false, value: null })
  const setter = Object.defineProperty(input(), 'tagIds', { enumerable: true, set() { calls++ } })
  const inherited = Object.assign(Object.create({ categoryId: null }), input())
  for (const value of [null, [], new Date(), accessor, hidden, setter, inherited, input({ [Symbol('secret')]: 1 }),
    input({ authorId: 'other' }), input({ toJSON() { calls++ } }), input({ categoryId: undefined }), { ...input(), expectedUpdatedAt: undefined },
    new Proxy({}, { ownKeys() { throw Error('SECRET') } })]) invalid(value)
  for (const key of Object.keys(input())) { const value = input(); delete value[key]; invalid(value) }
  assert.equal(calls, 0)
  assert.equal(normalizeClassificationInput(Object.assign(Object.create(null), input())).selection.categoryId, null)
})
test('TAX-04/12: array shape checked before iteration, including holes and getters', () => {
  let calls = 0
  const getter = Object.defineProperty([], '0', { get() { calls++; return 'a' }, enumerable: true })
  const hidden = Object.defineProperty(['a'], '0', { value: 'a', enumerable: false })
  class SpecialArray extends Array {}
  for (const value of [Array(1), getter, hidden, Object.assign(['a'], { extra: 1 }), Object.assign(['a'], { [Symbol('x')]: 'x' }), new SpecialArray('a'),
    new Proxy(['a'], { getOwnPropertyDescriptor() { throw Error('SECRET') } })]) invalid(input({ topicIds: value }))
  assert.equal(calls, 0)
})
test('TAX-04: timestamp is canonical UTC millisecond and bounded, not coerced', () => {
  for (const value of [token, '1000-01-01T00:00:00.000Z', '9999-12-31T23:59:59.999Z']) assert.equal(classificationTimestamp(value).toISOString(), value)
  for (const value of [new Date(token), 0, '2026-02-30T00:00:00.000Z', '0999-12-31T00:00:00.000Z', token.replace('.456', ''), token.replace('Z', '+00:00'), 'invalid']) invalid(input({ expectedUpdatedAt: value }))
})
test('TAX-04/27: safe error mapper does not execute getters or expose raw payloads', () => {
  let calls = 0
  for (const error of [Object.defineProperty({}, 'code', { get() { calls++; return 'P2034' } }),
    { code: 'P2010', meta: Object.defineProperty({}, 'driverAdapterError', { get() { calls++; throw Error() } }) },
    new Proxy({}, { getOwnPropertyDescriptor() { throw Error('SECRET') } }), Error('SECRET')]) {
    const result = mapClassificationError(error); assert.equal(result.code, 'INTERNAL_ERROR'); assert.equal(JSON.stringify(result).includes('SECRET'), false)
  }
  assert.equal(calls, 0)
  for (const error of [{ code: 'P2034' }, { code: 'P2010', meta: { driverAdapterError: { cause: { kind: 'TransactionWriteConflict' } } } }]) assert.equal(mapClassificationError(error).code, 'EDIT_CONFLICT')
  assert.equal(mapClassificationError({ code: 'P2003' }).code, 'INVALID_SELECTION')
})
