import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

const root = new URL('../src/features/crm/', import.meta.url)
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(root.href) && /^\.\/[\w-]+$/.test(specifier)) return nextResolve(`${specifier}.ts`, context)
    return nextResolve(specifier, context)
  },
})
let parseAuditFilters, auditFiltersHref, auditWhere, auditSqlWhere, AUDIT_PERIODS, AUDIT_PAGE_SIZE, AUDIT_MAX_PAGE, AUDIT_ACTOR_LIMIT, CRM_AUDIT_REGISTRY, CRM_AUDIT_CATEGORIES
try {
  ({ parseAuditFilters, auditFiltersHref, auditWhere, auditSqlWhere, AUDIT_PERIODS, AUDIT_PAGE_SIZE, AUDIT_MAX_PAGE, AUDIT_ACTOR_LIMIT } = await import(new URL('audit-filters.ts', root)));
  ({ CRM_AUDIT_REGISTRY, CRM_AUDIT_CATEGORIES } = await import(new URL('audit-registry.ts', root)))
} finally { hook.deregister() }
const now = new Date('2026-09-14T05:00:00.000Z')
const parse = (params = {}, instant = now) => parseAuditFilters(params, instant)
function bounds(params, start, end, instant = now) {
  const result = parse(params, instant)
  assert.equal(result.range.startUtc.toISOString(), start)
  assert.equal(result.range.endExclusiveUtc.toISOString(), end)
  return result
}

test('audit default and hard limits are explicit: 30 calendar days, 50 rows, 1000 pages, 200 actor choices', () => {
  assert.deepEqual(AUDIT_PERIODS, ['7d', '30d', '90d', 'custom'])
  assert.equal(AUDIT_PAGE_SIZE, 50)
  assert.equal(AUDIT_MAX_PAGE, 1000)
  assert.equal(AUDIT_ACTOR_LIMIT, 200)
  const result = bounds({}, '2026-08-15T17:00:00.000Z', '2026-09-14T17:00:00.000Z')
  assert.deepEqual(result.filters, { period: '30d', from: undefined, to: undefined, action: undefined, category: undefined, actorId: undefined, page: 1 })
  assert.deepEqual(result.invalidKeys, [])
  assert.equal(result.range.from, '2026-08-16')
  assert.equal(result.range.to, '2026-09-14')
})

test('audit presets use Vietnam inclusive calendar days and exclude the next local midnight', () => {
  bounds({ period: '7d' }, '2026-09-07T17:00:00.000Z', '2026-09-14T17:00:00.000Z')
  bounds({ period: '90d' }, '2026-06-16T17:00:00.000Z', '2026-09-14T17:00:00.000Z')
  bounds({ period: '7d' }, '2026-09-08T17:00:00.000Z', '2026-09-15T17:00:00.000Z', new Date('2026-09-14T17:00:00.000Z'))
  bounds({ period: '7d' }, '2026-12-25T17:00:00.000Z', '2027-01-01T17:00:00.000Z', new Date('2026-12-31T17:00:00.000Z'))
})

test('custom ranges use strict date-only UTC+7 conversion and accept exactly 366 inclusive days', () => {
  const oneDay = bounds({ period: 'custom', from: '2024-02-29', to: '2024-02-29' }, '2024-02-28T17:00:00.000Z', '2024-02-29T17:00:00.000Z')
  assert.deepEqual(oneDay.invalidKeys, [])
  const max = bounds({ period: 'custom', from: '2024-01-01', to: '2024-12-31' }, '2023-12-31T17:00:00.000Z', '2024-12-31T17:00:00.000Z')
  assert.deepEqual(max.invalidKeys, [])
  assert.equal(max.filters.period, 'custom')
  assert.equal(max.filters.from, '2024-01-01')
  assert.equal(max.filters.to, '2024-12-31')
  for (const params of [{}, { from: '2026-09-01' }, { to: '2026-09-14' }, { from: '2026-09-15', to: '2026-09-14' }, { from: '2024-01-01', to: '2025-01-01' }]) {
    const result = parse({ period: 'custom', ...params })
    assert.equal(result.filters.period, '30d')
    assert.ok(result.invalidKeys.some((key) => ['from', 'to'].includes(key)))
    assert.deepEqual(result.range, parse().range)
  }
})

test('malformed custom dates reject normalized calendars, unsafe years, offsets, controls and whitespace', () => {
  for (const date of ['2026-02-29', '2026-02-30', '2026-04-31', '2026-00-01', '2026-13-01', '2026-09-00', '2026-09-32', '26-09-14', '2026-9-14',
    '2026/09/14', '2026-09-14T00:00', '2026-09-14Z', ' 2026-09-14', '2026-09-14 ', '2026-09-14\n', '2026-09-14\u0000',
    '0000-01-01', '0999-12-31', '1000-01-01', '9999-12-31', 'x'.repeat(5000)]) {
    const result = parse({ period: 'custom', from: date, to: '2026-09-14' })
    assert.ok(result.invalidKeys.includes('from'), date)
    assert.equal(result.filters.period, '30d')
  }
})

test('unused preset dates remain validated but cannot change the selected preset range', () => {
  assert.deepEqual(parse({ period: '7d', from: '2000-01-01', to: '2000-01-02' }).range, parse({ period: '7d' }).range)
  assert.deepEqual(parse({ period: '7d', from: 'INVALID', to: ['2026-09-14'] }).invalidKeys, ['from', 'to'])
})

test('every supported audit parameter rejects arrays, including single arrays and repeated identical values', () => {
  const valid = { period: 'custom', from: '2026-09-01', to: '2026-09-14', action: 'CUSTOMER_PROFILE_UPDATE', category: 'CUSTOMER', actorId: 'actor-own', page: '2' }
  for (const [key, value] of Object.entries(valid)) for (const invalid of [[value], [value, value], [value, 'forged'], []]) {
    const result = parse({ ...valid, [key]: invalid })
    assert.ok(result.invalidKeys.includes(key), key)
    if (['action', 'category', 'actorId'].includes(key)) assert.equal(result.filters[key], undefined)
    if (key === 'page') assert.equal(result.filters.page, 1)
  }
})

test('period/action/category are exact known literals, with no prefix, case or whitespace widening', () => {
  for (const action of CRM_AUDIT_REGISTRY.map((entry) => entry.action)) assert.equal(parse({ action }).filters.action, action)
  for (const category of CRM_AUDIT_CATEGORIES) assert.equal(parse({ category }).filters.category, category)
  for (const [key, values] of Object.entries({ period: ['ytd', 'ALL', ' 7d', '7d ', '7D'], action: ['CUSTOMER_', 'CUSTOMER_UNKNOWN', 'AUTH_LOGIN', 'customer_profile_update', ' CUSTOMER_PROFILE_UPDATE'], category: ['customer', 'CUSTOMER ', 'UNKNOWN'] })) {
    for (const value of values) assert.deepEqual(parse({ [key]: value }).invalidKeys, [key])
  }
  for (const key of ['period', 'action', 'category', 'actorId', 'page']) for (const value of [' ', 'x\n', 'x\u0000', 'x\u007f', 'x\u0085', 'x'.repeat(5000)]) {
    assert.deepEqual(parse({ [key]: value }).invalidKeys, [key])
  }
})

test('actor filter uses strict ASCII ID boundaries, never names/emails or trimmed user input', () => {
  for (const actorId of ['a', 'cuid_123-ABC', 'x'.repeat(191)]) assert.equal(parse({ actorId }).filters.actorId, actorId)
  for (const actorId of [' actor', 'actor ', 'a/b', '../foreign', 'a%2Fb', 'actor@example.test', 'a b', 'a&x=1', 'id\n', 'x'.repeat(192)]) {
    const result = parse({ actorId })
    assert.equal(result.filters.actorId, undefined)
    assert.deepEqual(result.invalidKeys, ['actorId'])
  }
})

test('page grammar is canonical 1..1000 with malformed/out-of-range values visibly rejected', () => {
  for (const page of ['1', '2', '999', '1000']) assert.equal(parse({ page }).filters.page, Number(page))
  for (const page of ['0', '-1', '01', '1e3', '1.5', '1001', 'Infinity', '+2', ' 2', '2 ', '2\n']) {
    assert.equal(parse({ page }).filters.page, 1)
    assert.deepEqual(parse({ page }).invalidKeys, ['page'])
  }
})

test('blank optional fields and unknown URL keys never introduce free-text or business predicates', () => {
  assert.deepEqual(parse({ period: '', from: '', to: '', action: '', category: '', actorId: '', page: '' }), parse())
  assert.deepEqual(parse({ q: 'PRIVATE', userName: 'PRIVATE', email: 'PRIVATE', entityId: 'foreign', customerId: 'foreign', role: 'ADMIN', OR: '{}', arbitrary: ['a', 'b'] }), parse())
})

test('invalid and unsupported clock values are explicitly marked invalid instead of opening an unbounded query', () => {
  for (const instant of [new Date('invalid'), new Date('1000-01-01T00:00:00.000Z'), new Date('9998-01-01T00:00:00.000Z'), null, '2026-09-14']) {
    const result = parse({}, instant)
    assert.deepEqual(result.invalidKeys, ['period'])
    assert.ok(Number.isFinite(result.range.startUtc.getTime()))
    assert.ok(Number.isFinite(result.range.endExclusiveUtc.getTime()))
  }
})

test('audit where always intersects exact registry/date/action/category/actor predicates, including empty intersections', () => {
  const { filters, range } = parse({ action: 'CUSTOMER_PROFILE_UPDATE', category: 'TASK', actorId: 'foreign-actor', page: '3' })
  const allowed = CRM_AUDIT_REGISTRY.map((entry) => entry.action)
  const task = CRM_AUDIT_REGISTRY.filter((entry) => entry.category === 'TASK').map((entry) => entry.action)
  assert.deepEqual(auditWhere(filters, range), { AND: [
    { action: { in: allowed } }, { createdAt: { gte: range.startUtc, lt: range.endExclusiveUtc } },
    { action: 'CUSTOMER_PROFILE_UPDATE' }, { action: { in: task } }, { actorId: 'foreign-actor' },
  ] })
  assert.deepEqual(auditWhere(filters, range, false), { AND: auditWhere(filters, range).AND.slice(0, -1) })
})

test('audit SQL binds the exact registry, dates and optional binary actor match without interpolating values', () => {
  const { filters, range } = parse({ actorId: 'actor-own' })
  const query = auditSqlWhere(filters, range)
  const actions = CRM_AUDIT_REGISTRY.map((entry) => entry.action)
  assert.equal(query.sql.replace(/\s+/g, ' ').trim(), `BINARY a.action IN (${actions.map(() => '?').join(',')}) AND a.createdAt >= ? AND a.createdAt < ? AND BINARY a.actorId = ?`)
  assert.deepEqual(query.values, [...actions, range.startUtc, range.endExclusiveUtc, 'actor-own'])
  assert.equal(query.sql.includes('CUSTOMER_PROFILE_UPDATE'), false)
  assert.equal(query.sql.includes('actor-own'), false)
  const actors = auditSqlWhere(filters, range, false)
  assert.equal(actors.sql.includes('BINARY a.actorId'), false)
  assert.deepEqual(actors.values, [...actions, range.startUtc, range.endExclusiveUtc])
})

test('audit SQL narrows static action/category intersection and returns an impossible predicate for contradictions', () => {
  for (const definition of CRM_AUDIT_REGISTRY) {
    const { filters, range } = parse({ action: definition.action, category: definition.category })
    assert.deepEqual(auditSqlWhere(filters, range).values, [definition.action, range.startUtc, range.endExclusiveUtc])
  }
  const { filters, range } = parse({ category: 'TASK' })
  assert.deepEqual(auditSqlWhere(filters, range).values, [
    ...CRM_AUDIT_REGISTRY.filter((entry) => entry.category === 'TASK').map((entry) => entry.action), range.startUtc, range.endExclusiveUtc,
  ])
  for (const invalid of [{ ...filters, action: 'CUSTOMER_PROFILE_UPDATE' }, { ...filters, action: 'CUSTOMER_UNKNOWN' }]) {
    const query = auditSqlWhere(invalid, range)
    assert.equal(query.sql, '1 = 0')
    assert.deepEqual(query.values, [])
  }
})

test('even a faulty direct SQL-helper caller cannot splice malicious actor text into executable SQL', () => {
  const { filters, range } = parse()
  const actorId = "x' OR 1=1; DROP TABLE AuditLog; --"
  const query = auditSqlWhere({ ...filters, actorId }, range)
  assert.equal(query.sql.includes(actorId), false)
  assert.equal(query.sql.includes('DROP'), false)
  assert.equal(query.values.at(-1), actorId)
  assert.deepEqual(parse({ actorId }).invalidKeys, ['actorId'])
})

test('Vietnam day/leap/year/DST boundaries are host-timezone independent', () => {
  const previous = process.env.TZ
  try {
    for (const timezone of ['UTC', 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Ho_Chi_Minh']) {
      process.env.TZ = timezone
      bounds({ period: '7d' }, '2026-09-07T17:00:00.000Z', '2026-09-14T17:00:00.000Z', new Date('2026-09-14T16:59:59.999Z'))
      bounds({ period: '7d' }, '2026-09-08T17:00:00.000Z', '2026-09-15T17:00:00.000Z', new Date('2026-09-14T17:00:00.000Z'))
      bounds({ period: 'custom', from: '2024-02-29', to: '2024-03-01' }, '2024-02-28T17:00:00.000Z', '2024-03-01T17:00:00.000Z')
      bounds({ period: 'custom', from: '2026-03-08', to: '2026-03-08' }, '2026-03-07T17:00:00.000Z', '2026-03-08T17:00:00.000Z')
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous }
})

test('audit pagination URLs preserve supported filters only and omit default page and irrelevant preset dates', () => {
  const filters = parse({ period: 'custom', from: '2026-09-01', to: '2026-09-14', action: 'CUSTOMER_PROFILE_UPDATE', category: 'CUSTOMER', actorId: 'actor-own', page: '2' }).filters
  const before = structuredClone(filters)
  const url = new URL(auditFiltersHref({ ...filters, q: 'PRIVATE', role: 'ADMIN' }, 3), 'https://example.test')
  assert.equal(url.pathname, '/sales/audit')
  assert.deepEqual(parse(Object.fromEntries(url.searchParams)).filters, { ...filters, page: 3 })
  assert.equal(url.searchParams.has('q'), false)
  assert.equal(url.searchParams.has('role'), false)
  assert.deepEqual(filters, before)
  const preset = new URL(auditFiltersHref({ ...filters, period: '7d' }, 1), 'https://example.test')
  for (const key of ['from', 'to', 'page']) assert.equal(preset.searchParams.has(key), false)
  assert.equal(preset.searchParams.get('actorId'), 'actor-own')
})
