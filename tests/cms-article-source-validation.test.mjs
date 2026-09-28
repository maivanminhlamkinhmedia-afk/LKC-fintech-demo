import assert from 'node:assert/strict'
import test from 'node:test'
import { ArticleSourceError, SOURCE_TYPES, mapSourceError, normalizeSourceInput, normalizeSourceDeleteInput,
  normalizeSourceUrl, safeSourceUrl, parseSourceId, parseSourceTimestamp, sourceDateFromLocal, sourceDateToLocal,
} from '../src/features/cms/article-sources.ts'

const token = '2026-09-27T01:02:03.456Z'
const input = changes => ({ sourceType: 'WEBSITE', title: '  Nguồn tiếng Việt 😀  ', expectedUpdatedAt: token, ...changes })
const invalid = action => assert.throws(action, error => error instanceof ArticleSourceError && error.code === 'VALIDATION_ERROR')

test('SRC-06: eight source types and Unicode normalization, nullable fields, multiline note', () => {
  for (const sourceType of SOURCE_TYPES) {
    const value = normalizeSourceInput(input({ sourceType, publisher: '  Báo cáo  ', note: '  dòng một\n  dòng hai  ', url: '  HTTPS://EXAMPLE.COM:443/a?q=1#c  ' }))
    assert.deepEqual(value, { expectedUpdatedAt: new Date(token), data: { sourceType, title: 'Nguồn tiếng Việt 😀',
      publisher: 'Báo cáo', note: 'dòng một\n  dòng hai', url: 'https://example.com/a?q=1#c',
      publishedAt: null, accessedAt: null, dataTimestamp: null } })
  }
  for (const field of ['publisher', 'url', 'note', 'publishedAt', 'accessedAt', 'dataTimestamp']) {
    for (const value of ['', null]) assert.equal(normalizeSourceInput(input({ [field]: value })).data[field], null)
  }
  assert.equal(normalizeSourceInput(Object.assign(Object.create(null), input())).data.title, 'Nguồn tiếng Việt 😀')
})

for (const [field, limit] of [['title', 180], ['publisher', 180], ['note', 4000]]) {
  test(`SRC-06: ${field} counts Unicode code points at ${limit}`, () => {
    assert.equal(Array.from(normalizeSourceInput(input({ [field]: '😀'.repeat(limit) })).data[field]).length, limit)
    invalid(() => normalizeSourceInput(input({ [field]: '😀'.repeat(limit + 1) })))
    for (const value of [false, 1, [], {}, () => 'bad', undefined]) invalid(() => normalizeSourceInput(input({ [field]: value })))
  })
}

test('SRC-05: strict payload rejects overposting/descriptors/prototypes without running accessors or toJSON', () => {
  let executed = 0
  const getter = Object.defineProperty(input(), 'title', { enumerable: true, get() { executed++; return 'bad' } })
  const setter = Object.defineProperty(input(), 'title', { enumerable: true, set() { executed++ } })
  const hidden = Object.defineProperty(input(), 'title', { enumerable: false, value: 'hidden' })
  const symbol = { ...input(), [Symbol('secret')]: 'bad' }
  const toJSON = { ...input(), toJSON() { executed++; return input() } }
  for (const value of [null, [], new Date(), new (class { sourceType = 'WEBSITE'; title = 'bad' })(), getter, setter, hidden, symbol, toJSON]) {
    invalid(() => normalizeSourceInput(value))
  }
  for (const key of ['articleId', 'createdById', 'createdAt', 'updatedAt', 'id', 'sources', 'contentJson', '__proto__']) {
    invalid(() => normalizeSourceInput(Object.assign(Object.create(null), input(), { [key]: 'bad' })))
  }
  for (const title of ['', '   ', null]) invalid(() => normalizeSourceInput(input({ title })))
  for (const type of ['', 'website', 'UNKNOWN', 1]) invalid(() => normalizeSourceInput(input({ sourceType: type })))
  assert.equal(executed, 0)
})

const badUrls = ['javascript:alert(1)', 'data:text/html,a', 'file:///a', '//example.com', '/relative', 'example.com',
  'http:', 'https://', 'https:///example.com', 'https://user@example.com', 'https://u:p@example.com', 'https://@example.com',
  'https://example.com/a b', 'https://example.com/a\\b', 'https://example.com/\n', '\thttps://example.com',
  'https://example.com/\u0000', 'https://example.com/\u007f', 'https://exa\u0085mple.com']
for (const url of badUrls) test(`SRC-07: rejects unsafe URL ${JSON.stringify(url)}`, () => {
  invalid(() => normalizeSourceUrl(url)); assert.equal(safeSourceUrl(url), null)
})
test('SRC-07: canonical URL length uses href, preserves query/fragment and supports valid absolute hosts', () => {
  for (const url of ['http://localhost:8080/a', 'https://[::1]/a', 'https://example.com/a?b=1&c=2#part', 'https://vídụ.vn/a']) {
    assert.equal(normalizeSourceUrl(url), new URL(url).href)
  }
  const base = 'https://example.com/'
  assert.equal(normalizeSourceUrl(base + 'a'.repeat(2048 - base.length)).length, 2048)
  invalid(() => normalizeSourceUrl(base + 'a'.repeat(2049 - base.length)))
  invalid(() => normalizeSourceUrl(base + 'ệ'.repeat(300)))
})

test('SRC-09: UTC canonical dates reject rollover, timezone ambiguity, invalid year and precision', () => {
  for (const value of [token, '1000-01-01T00:00:00.000Z', '9999-12-31T23:59:59.999Z', '2024-02-29T12:00:00.001Z']) {
    assert.equal(parseSourceTimestamp(value).toISOString(), value)
    for (const field of ['publishedAt', 'accessedAt', 'dataTimestamp']) assert.equal(normalizeSourceInput(input({ [field]: value })).data[field], value)
  }
  for (const value of ['2025-02-29T00:00:00.000Z', '2026-04-31T00:00:00.000Z', '2026-01-01',
    '2026-01-01T01:00:00Z', '2026-01-01T01:00:00.000+07:00', '2026-01-01T01:00:00.0000Z',
    '0999-12-31T23:59:59.999Z', '+010000-01-01T00:00:00.000Z', '2026-01-01T24:00:00.000Z',
    '2026-01-01T01:60:00.000Z', '', null, new Date(token), 0]) invalid(() => parseSourceTimestamp(value))
})
test('SRC-09: UTC+7 local codec preserves milliseconds/calendar boundaries independently of machine zone', () => {
  for (const utc of [token, '1000-01-01T00:00:00.000Z', '9999-12-31T23:59:59.999Z', '2024-02-29T23:59:59.001Z']) {
    assert.equal(sourceDateFromLocal(sourceDateToLocal(utc)), utc)
  }
  assert.equal(sourceDateToLocal(token), '2026-09-27T08:02:03.456')
  assert.equal(sourceDateFromLocal('2026-09-27T08:02'), '2026-09-27T01:02:00.000Z')
  assert.equal(sourceDateFromLocal('2026-09-27T08:02:03.4'), '2026-09-27T01:02:03.400Z')
  assert.equal(sourceDateToLocal(null), ''); assert.equal(sourceDateFromLocal(''), null)
  for (const value of ['2025-02-29T08:00', '2026-04-31T08:00', '2026-01-01T24:00', '2026-01-01T08:00:00.0001', '1000-01-01T00:00', '2026-01-01T08:00Z']) invalid(() => sourceDateFromLocal(value))
})
test('SRC-05/15: delete accepts only token, IDs are separate and malformed IDs are safe NOT_FOUND', () => {
  assert.deepEqual(normalizeSourceDeleteInput({ expectedUpdatedAt: token }), { expectedUpdatedAt: new Date(token) })
  invalid(() => normalizeSourceDeleteInput(input()))
  invalid(() => normalizeSourceDeleteInput({ expectedUpdatedAt: token, id: 's1' }))
  for (const id of [null, '', '../x', 'x/y', 'x'.repeat(192), {}, ['a']]) assert.throws(() => parseSourceId(id), error => error.code === 'NOT_FOUND')
  assert.equal(parseSourceId('source_1-A'), 'source_1-A')
})
test('SRC-16/19: safe errors whitelist messages, detect write conflicts, never expose raw Prisma details', () => {
  let executed = 0
  for (const error of [new Error('SECRET'), { code: 'P2002', meta: { target: ['slug'] } }, { code: 'P2003' },
    { get code() { executed++; return 'FORBIDDEN' }, toJSON() { executed++; return 'SECRET' } }]) {
    const result = mapSourceError(error)
    assert.equal(result.code, 'INTERNAL_ERROR'); assert.equal(JSON.stringify(result).includes('SECRET'), false)
  }
  assert.equal(executed, 0)
  for (const error of [{ code: 'P2034' }, { code: 'P2010', meta: { driverAdapterError: { cause: { kind: 'TransactionWriteConflict' } } } }]) assert.equal(mapSourceError(error).code, 'EDIT_CONFLICT')
  assert.deepEqual(Object.keys(mapSourceError(new ArticleSourceError('VALIDATION_ERROR', 'title'))).sort(), ['code', 'fieldErrors', 'message'])
})
