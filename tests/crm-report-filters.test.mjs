import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { CustomerPriority, CustomerStatus } from '@prisma/client'

const moduleUrl = new URL('../src/features/crm/report-filters.ts', import.meta.url).href
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === moduleUrl && specifier === './customer-filters') return nextResolve('./customer-filters.ts', context)
    return nextResolve(specifier, context)
  },
})
const { parseReportFilters, reportCustomerWhere, reportFiltersHref, REPORT_MAX_DAYS, REPORT_PAGE_SIZE, REPORT_OPTION_LIMIT } = await import(moduleUrl)
hook.deregister()
const now = new Date('2026-09-14T05:00:00.000Z')
const parse = (params = {}, instant = now) => parseReportFilters(params, instant)
function bounds(params, start, end, instant = now) {
  const parsed = parse(params, instant)
  assert.equal(parsed.range.startUtc.toISOString(), start)
  assert.equal(parsed.range.endExclusiveUtc.toISOString(), end)
  return parsed
}

test('default 30 calendar days includes today, not a rolling 720-hour interval', () => {
  const parsed = bounds({}, '2026-08-15T17:00:00.000Z', '2026-09-14T17:00:00.000Z')
  assert.equal(parsed.filters.period, '30d')
  assert.equal(parsed.range.from, '2026-08-16')
  assert.equal(parsed.range.to, '2026-09-14')
  assert.equal(parsed.filters.page, 1)
  assert.equal(parsed.filters.teamPage, 1)
  assert.deepEqual(parsed.invalidKeys, [])
})

test('7d, 90d and YTD use Vietnam calendar boundaries including current day', () => {
  bounds({ period: '7d' }, '2026-09-07T17:00:00.000Z', '2026-09-14T17:00:00.000Z')
  bounds({ period: '90d' }, '2026-06-16T17:00:00.000Z', '2026-09-14T17:00:00.000Z')
  bounds({ period: 'ytd' }, '2025-12-31T17:00:00.000Z', '2026-09-14T17:00:00.000Z')
  bounds({ period: 'ytd' }, '2026-12-31T17:00:00.000Z', '2027-01-01T17:00:00.000Z', new Date('2026-12-31T17:00:00.000Z'))
})

test('custom UI inclusive end includes its full day but excludes next Vietnam midnight', () => {
  const parsed = bounds({ period: 'custom', from: '2026-09-01', to: '2026-09-14' }, '2026-08-31T17:00:00.000Z', '2026-09-14T17:00:00.000Z')
  assert.equal(parsed.filters.from, '2026-09-01')
  assert.equal(parsed.filters.to, '2026-09-14')
  bounds({ period: 'custom', from: '2024-02-29', to: '2024-02-29' }, '2024-02-28T17:00:00.000Z', '2024-02-29T17:00:00.000Z')
})

test('date validation rejects impossible dates, alternate syntax, controls, and DB-unsafe years', () => {
  for (const value of ['2026-02-29', '2026-02-30', '2026-04-31', '2026-00-01', '2026-13-01', '2026-09-00',
    '26-09-14', '2026-9-14', '2026-09-14T00:00:00Z', '2026/09/14', '2026-09-14\n', ' 2026-09-14', 'x'.repeat(5000), '0000-01-01', '0099-01-01', '0999-12-31', '1000-01-01', '9999-12-31']) {
    const parsed = parse({ period: 'custom', from: value, to: '2026-09-14', salesId: 'own-sales' })
    assert.equal(parsed.filters.period, '30d', value)
    assert.equal(parsed.filters.salesId, 'own-sales')
    assert.ok(parsed.invalidKeys.includes('from'), value)
    assert.deepEqual(parsed.range, parse().range)
  }
})

test('missing custom dates, reversed order and ranges exceeding 366 inclusive days fall back visibly', () => {
  assert.equal(REPORT_MAX_DAYS, 366)
  for (const params of [{}, { from: '2026-09-01' }, { to: '2026-09-14' },
    { from: '2026-09-15', to: '2026-09-14' }, { from: '2024-01-01', to: '2025-01-01' }]) {
    const result = parse({ period: 'custom', ...params })
    assert.equal(result.filters.period, '30d')
    assert.ok(result.invalidKeys.length > 0)
    assert.equal(result.filters.from, undefined)
    assert.equal(result.filters.to, undefined)
  }
  const max = bounds({ period: 'custom', from: '2024-01-01', to: '2024-12-31' }, '2023-12-31T17:00:00.000Z', '2024-12-31T17:00:00.000Z')
  assert.deepEqual(max.invalidKeys, [])
})

test('every report parameter rejects arrays, including identical and single repeated values', () => {
  const valid = { period: 'custom', from: '2026-09-01', to: '2026-09-14', salesId: 'sales-a', teamId: 'team-a', status: 'ACTIVE', priority: 'HIGH', page: '2', teamPage: '3' }
  for (const [key, value] of Object.entries(valid)) {
    for (const array of [[value], [value, value], [value, 'foreign']]) {
      const parsed = parse({ ...valid, [key]: array })
      assert.ok(parsed.invalidKeys.includes(key), key)
      assert.equal(parsed.filters[key], key === 'period' ? '30d' : ['page', 'teamPage'].includes(key) ? 1 : undefined, key)
    }
  }
})

test('invalid enums, identifiers and pages are ignored without admitting unknown predicate keys', () => {
  for (const key of ['status', 'priority', 'salesId', 'teamId', 'period', 'page', 'teamPage']) {
    for (const value of ['x'.repeat(192), '../foreign', 'x\n', 'x\u0000', 'bad value']) {
      const result = parse({ [key]: value })
      assert.deepEqual(result.invalidKeys, [key])
      assert.deepEqual(reportCustomerWhere({ assignedSalesId: 'own' }, result.filters), { AND: [{ assignedSalesId: 'own' }, { AND: [] }] })
    }
  }
  for (const page of ['0', '-1', '01', '1e3', '1.5', '1000001', 'Infinity']) {
    assert.deepEqual(parse({ page, teamPage: page }).invalidKeys, ['page', 'teamPage'])
  }
  const result = parse({ q: 'ignored', assignedToId: 'foreign', assignedSalesId: 'foreign', OR: '{}', customerId: 'foreign' })
  assert.deepEqual(result, parse())
})

test('real customer enums, identifier boundaries, valid pages, trim and blanks follow CRM conventions', () => {
  for (const status of Object.values(CustomerStatus)) assert.equal(parse({ status }).filters.status, status)
  for (const priority of Object.values(CustomerPriority)) assert.equal(parse({ priority }).filters.priority, priority)
  assert.equal(parse({ status: 'DONE' }).filters.status, undefined)
  assert.equal(parse({ priority: 'URGENT' }).filters.priority, undefined)
  const result = parse({ period: ' 7d ', salesId: 'x'.repeat(191), teamId: ' team-a ', status: ' ACTIVE ', priority: '', page: '1000000', teamPage: '2' })
  assert.deepEqual(result.invalidKeys, [])
  assert.equal(result.filters.salesId.length, 191)
  assert.equal(result.filters.teamId, 'team-a')
  assert.equal(result.filters.page, 1000000)
  assert.equal(result.filters.teamPage, 2)
  assert.equal(REPORT_PAGE_SIZE, 20)
  assert.equal(REPORT_OPTION_LIMIT, 100)
})

test('preset dates never override the preset; invalid unused dates still produce a notice', () => {
  assert.deepEqual(parse({ period: '7d', from: '2000-01-01', to: '2000-01-02' }).range, parse({ period: '7d' }).range)
  const invalid = parse({ period: '7d', from: ['2026-09-01'], to: 'invalid' })
  assert.equal(invalid.filters.period, '7d')
  assert.deepEqual(invalid.invalidKeys, ['from', 'to'])
  assert.deepEqual(invalid.range, parse({ period: '7d' }).range)
})

test('Vietnam midnight, year and leap-day boundaries are independent of host timezone', () => {
  const previousTimezone = process.env.TZ
  try {
    for (const timezone of ['UTC', 'America/Los_Angeles', 'Pacific/Auckland']) {
      process.env.TZ = timezone
      bounds({ period: '7d' }, '2026-09-07T17:00:00.000Z', '2026-09-14T17:00:00.000Z', new Date('2026-09-14T16:59:59.999Z'))
      bounds({ period: '7d' }, '2026-09-08T17:00:00.000Z', '2026-09-15T17:00:00.000Z', new Date('2026-09-14T17:00:00.000Z'))
      bounds({ period: 'custom', from: '2024-02-29', to: '2024-03-01' }, '2024-02-28T17:00:00.000Z', '2024-03-01T17:00:00.000Z')
    }
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ
    else process.env.TZ = previousTimezone
  }
})

test('current customer scope is independently ANDed with ownership filters, never the reporting dates', () => {
  const scope = { assignedSalesId: 'authorized-sales' }
  const filters = parse({ period: 'custom', from: '2026-09-01', to: '2026-09-14', salesId: 'foreign-sales', teamId: 'team-a', status: 'ACTIVE', priority: 'HIGH' }).filters
  assert.deepEqual(reportCustomerWhere(scope, filters), { AND: [scope, { AND: [
    { assignedSalesId: 'foreign-sales' }, { assignedSales: { salesMemberships: { some: { teamId: 'team-a' } } } },
    { status: 'ACTIVE' }, { priority: 'HIGH' },
  ] }] })
  assert.deepEqual(scope, { assignedSalesId: 'authorized-sales' })
})

test('independent workload pagination retains all filters; switching presets removes custom dates', () => {
  const filters = parse({ period: 'custom', from: '2026-09-01', to: '2026-09-14', salesId: 'sales-a', teamId: 'team-a', status: 'CLOSED', priority: 'LOW', page: '2', teamPage: '3' }).filters
  const before = structuredClone(filters)
  const url = new URL(reportFiltersHref('/sales/reports', filters, { page: 4 }), 'https://crm.invalid')
  assert.deepEqual(parse(Object.fromEntries(url.searchParams)).filters, { ...filters, page: 4 })
  assert.deepEqual(filters, before)
  const preset = new URL(reportFiltersHref('/sales/reports', filters, { period: '7d', page: 1, teamPage: 1 }), 'https://crm.invalid')
  for (const key of ['from', 'to', 'page', 'teamPage']) assert.equal(preset.searchParams.has(key), false)
  assert.equal(preset.searchParams.get('salesId'), 'sales-a')
})
