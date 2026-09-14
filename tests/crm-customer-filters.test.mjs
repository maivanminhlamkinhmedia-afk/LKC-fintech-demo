import assert from 'node:assert/strict'
import test from 'node:test'
import { CustomerPriority, CustomerStatus, CustomerTaskStatus } from '@prisma/client'
import {
  CUSTOMER_PRIORITIES,
  CUSTOMER_STATUSES,
  customerFilterWhere,
  filtersHref,
  isOverdueFollowUp,
  parseCustomerFilters,
  vietnamDayBounds,
} from '../src/features/crm/customer-filters.ts'

const instant = new Date('2026-09-14T05:00:00.000Z')

function parse(values) {
  return parseCustomerFilters(values).filters
}

function followUpMatches(filter, value, now = instant) {
  const where = customerFilterWhere(parse({ followUp: filter }), now)
  const condition = where.AND.find((clause) => 'nextContactAt' in clause).nextContactAt
  if (condition === null) return value === null
  if (value === null) return false
  return (!condition.gte || value >= condition.gte) && (!condition.lt || value < condition.lt)
}

test('status and priority choices follow every generated Prisma enum value', () => {
  assert.deepEqual(CUSTOMER_STATUSES, Object.values(CustomerStatus))
  assert.deepEqual(CUSTOMER_PRIORITIES, Object.values(CustomerPriority))
  for (const status of Object.values(CustomerStatus)) {
    for (const priority of Object.values(CustomerPriority)) {
      const result = parseCustomerFilters({ status, priority })
      assert.equal(result.filters.status, status)
      assert.equal(result.filters.priority, priority)
      assert.deepEqual(result.invalidKeys, [])
    }
  }
})

test('repeated URL values are rejected even when all copies are valid or identical', () => {
  const valid = {
    q: 'Khách hàng', status: CustomerStatus.LEAD, priority: CustomerPriority.HIGH,
    salesId: 'sales_123', teamId: 'team-123', followUp: 'today', task: 'open', page: '2',
  }
  for (const [key, value] of Object.entries(valid)) {
    for (const repeated of [[value], [value, value], [value, 'malicious']]) {
      const result = parseCustomerFilters({ [key]: repeated })
      assert.deepEqual(result.invalidKeys, [key], key)
      assert.equal(result.filters[key], key === 'page' ? 1 : undefined, key)
    }
  }
})

test('invalid enums and control characters cannot reach Prisma filter predicates', () => {
  const cases = {
    status: ['lead', 'WON', '{"not":"CLOSED"}', 'ACTIVE\u0000'],
    priority: ['high', 'URGENT', 'HIGH\n'],
    followUp: ['tomorrow', 'all', 'today\u007f'],
    task: ['DONE', 'CANCELLED', 'any', 'open\t'],
  }
  for (const [key, values] of Object.entries(cases)) {
    for (const value of values) {
      const result = parseCustomerFilters({ [key]: value })
      assert.deepEqual(result.invalidKeys, [key], `${key}: ${JSON.stringify(value)}`)
      assert.equal(result.filters[key], undefined)
      assert.deepEqual(customerFilterWhere(result.filters, instant), { AND: [] })
    }
  }
})

test('identifier boundaries reject delimiters, controls, and oversized values', () => {
  for (const key of ['salesId', 'teamId']) {
    for (const value of ['../foreign', 'sales id', 'sales%20id', 'sales&id=x', 'sales\u0000id', 'a'.repeat(192)]) {
      const result = parseCustomerFilters({ [key]: value })
      assert.equal(result.filters[key], undefined)
      assert.deepEqual(result.invalidKeys, [key])
    }
    for (const value of ['a', 'cuid_ABC-123', 'a'.repeat(191)]) {
      const result = parseCustomerFilters({ [key]: value })
      assert.equal(result.filters[key], value)
      assert.deepEqual(result.invalidKeys, [])
    }
  }
})

test('pagination accepts bounded decimal integers and safely resets malformed inputs', () => {
  for (const value of ['0', '-1', '01', '1.5', '1e3', '0x10', 'Infinity', 'NaN', '1000001', '99999999', '2\n']) {
    const result = parseCustomerFilters({ page: value })
    assert.equal(result.filters.page, 1, value)
    assert.deepEqual(result.invalidKeys, ['page'], value)
  }
  for (const value of ['1', '2', '1000000']) {
    const result = parseCustomerFilters({ page: value })
    assert.equal(result.filters.page, Number(value))
    assert.deepEqual(result.invalidKeys, [])
  }
})

test('search length and controls are validated without rejecting ordinary Unicode or punctuation', () => {
  for (const value of ['x'.repeat(121), 'A\u0000B', 'A\nB', 'A\u007fB']) {
    const result = parseCustomerFilters({ q: value })
    assert.equal(result.filters.q, undefined)
    assert.deepEqual(result.invalidKeys, ['q'])
  }
  for (const value of ['x'.repeat(120), 'Nguyễn Thị Ánh', "O'Connor", '100%_discount', "' OR 1=1 --"]) {
    const result = parseCustomerFilters({ q: value })
    assert.equal(result.filters.q, value)
    assert.deepEqual(result.invalidKeys, [])
  }
})

test('blank controls reset filters, known values trim, and unknown keys do not enter queries', () => {
  const result = parseCustomerFilters({
    q: '   ', status: '', priority: ' HIGH ', salesId: ' sales_123 ',
    teamId: undefined, followUp: ' ', task: '', page: '',
    assignedSalesId: 'foreign', OR: '{"role":"ADMIN"}', arbitrary: ['a', 'b'],
  })
  assert.deepEqual(result.invalidKeys, [])
  assert.equal(result.filters.page, 1)
  assert.equal(result.filters.priority, CustomerPriority.HIGH)
  assert.equal(result.filters.salesId, 'sales_123')
  assert.equal(result.filters.q, undefined)
  assert.equal(result.filters.status, undefined)
  assert.equal(result.filters.followUp, undefined)
  assert.equal('assignedSalesId' in result.filters, false)
  assert.equal('OR' in result.filters, false)
})

test('search wildcard characters stay literal for name, email, and customer code', () => {
  const raw = String.raw`100%_\discount`
  const expected = String.raw`100\%\_\\discount`
  const where = customerFilterWhere(parse({ q: raw }), instant)
  const choices = where.AND.find((clause) => clause.OR).OR
  assert.equal(choices.length, 3)
  assert.equal(choices.find((choice) => choice.user?.name).user.name.contains, expected)
  assert.equal(choices.find((choice) => choice.user?.email).user.email.contains, expected)
  assert.equal(choices.find((choice) => choice.customerCode).customerCode.contains, expected)
})

test('Vietnam day boundaries survive midnight, leap day, and year rollover in different host timezones', () => {
  const previousTimezone = process.env.TZ
  const cases = [
    ['2026-09-14T16:59:59.999Z', '2026-09-13T17:00:00.000Z', '2026-09-14T17:00:00.000Z'],
    ['2026-09-14T17:00:00.000Z', '2026-09-14T17:00:00.000Z', '2026-09-15T17:00:00.000Z'],
    ['2024-02-29T16:59:59.999Z', '2024-02-28T17:00:00.000Z', '2024-02-29T17:00:00.000Z'],
    ['2026-12-31T17:00:00.000Z', '2026-12-31T17:00:00.000Z', '2027-01-01T17:00:00.000Z'],
  ]
  try {
    for (const timezone of ['UTC', 'America/Los_Angeles', 'Pacific/Auckland']) {
      process.env.TZ = timezone
      for (const [timestamp, expectedStart, expectedEnd] of cases) {
        const { start, end } = vietnamDayBounds(new Date(timestamp))
        assert.equal(start.toISOString(), expectedStart, timezone)
        assert.equal(end.toISOString(), expectedEnd, timezone)
      }
    }
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ
    else process.env.TZ = previousTimezone
  }
})

test('today includes exactly one Vietnam calendar day and excludes null follow-ups', () => {
  assert.equal(followUpMatches('today', new Date('2026-09-13T16:59:59.999Z')), false)
  assert.equal(followUpMatches('today', new Date('2026-09-13T17:00:00.000Z')), true)
  assert.equal(followUpMatches('today', new Date('2026-09-14T16:59:59.999Z')), true)
  assert.equal(followUpMatches('today', new Date('2026-09-14T17:00:00.000Z')), false)
  assert.equal(followUpMatches('today', null), false)
})

test('overdue/upcoming divide at now, with no-follow-up matching only null', () => {
  const before = new Date(instant.getTime() - 1)
  const after = new Date(instant.getTime() + 1)
  for (const [date, overdue, upcoming] of [[before, true, false], [instant, false, true], [after, false, true], [null, false, false]]) {
    assert.equal(followUpMatches('overdue', date), overdue)
    assert.equal(followUpMatches('upcoming', date), upcoming)
    assert.equal(isOverdueFollowUp(date, instant), overdue)
  }
  assert.equal(followUpMatches('none', null), true)
  assert.equal(followUpMatches('none', before), false)
})

test('task filters exclude completed/cancelled tasks and overdue additionally requires a past due date', () => {
  for (const task of ['open', 'overdue']) {
    const where = customerFilterWhere(parse({ task }), instant)
    const predicate = where.AND.find((clause) => clause.tasks).tasks.some
    for (const status of Object.values(CustomerTaskStatus)) {
      assert.equal(predicate.status.in.includes(status), status === 'TODO' || status === 'IN_PROGRESS')
    }
    if (task === 'open') {
      assert.equal('dueAt' in predicate, false)
    } else {
      assert.equal(predicate.dueAt.lt.getTime(), instant.getTime())
      assert.equal('lte' in predicate.dueAt, false)
    }
  }
})

test('combined search and team/sales filters intersect rather than becoming search alternatives', () => {
  const where = customerFilterWhere(parse({
    q: 'Ánh', status: 'LEAD', priority: 'HIGH', salesId: 'sales-a', teamId: 'team-a', followUp: 'today', task: 'open',
  }), instant)
  assert.equal(where.AND.length, 7)
  assert.equal(where.AND.filter((clause) => clause.OR).length, 1)
  assert.equal(where.AND.find((clause) => clause.assignedSalesId).assignedSalesId, 'sales-a')
  assert.equal(where.AND.find((clause) => clause.assignedSales).assignedSales.salesMemberships.some.teamId, 'team-a')
  assert.equal(where.AND.find((clause) => clause.status).status, CustomerStatus.LEAD)
  assert.equal(where.AND.find((clause) => clause.priority).priority, CustomerPriority.HIGH)
})

test('filter links encode free text, preserve every filter, and do not mutate source state', () => {
  const original = parse({
    q: 'Nguyễn & a+b?x=#50%', status: 'ACTIVE', priority: 'HIGH', salesId: 'sales-a', teamId: 'team-a',
    followUp: 'upcoming', task: 'overdue', page: '8',
  })
  const snapshot = structuredClone(original)
  const href = filtersHref('/sales/pipeline', original, { page: 9 })
  const url = new URL(href, 'https://crm.invalid')
  assert.equal(url.pathname, '/sales/pipeline')
  assert.equal(url.hash, '')
  assert.equal(url.searchParams.get('q'), original.q)
  assert.equal(url.searchParams.size, 8)
  const decoded = parseCustomerFilters(Object.fromEntries(url.searchParams))
  assert.deepEqual(decoded.invalidKeys, [])
  assert.deepEqual(decoded.filters, { ...original, page: 9 })
  assert.deepEqual(original, snapshot)
})

test('page reset and removed filters produce clean navigation without losing retained filters', () => {
  const filters = parse({ q: 'Khách hàng', status: 'LEAD', page: '12' })
  const url = new URL(filtersHref('/sales/customers', filters, { status: undefined, page: 1 }), 'https://crm.invalid')
  assert.equal(url.searchParams.get('q'), filters.q)
  assert.equal(url.searchParams.has('status'), false)
  assert.equal(url.searchParams.has('page'), false)
  assert.equal(filtersHref('/sales/customers', { page: 1 }), '/sales/customers')
  assert.equal(filtersHref('/sales/pipeline', filters, { q: undefined, status: undefined, page: 1 }), '/sales/pipeline')
})
