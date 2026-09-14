import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FOLLOW_UP_FILTERS,
  contactStates,
  customerFilterWhere,
  customerFollowUpWhere,
  filtersHref,
  isOverdueFollowUp,
  parseCustomerFilters,
  vietnamDayBounds,
} from '../src/features/crm/customer-filters.ts'

const now = new Date('2026-09-14T05:00:00.000Z')

function matches(where, value) {
  if (!('nextContactAt' in where)) return true
  if (where.nextContactAt === null) return value === null
  if (value === null) return false
  const condition = where.nextContactAt
  return (condition.lt === undefined || value < condition.lt)
    && (condition.gte === undefined || value >= condition.gte)
}

test('canonical contact predicates preserve the exact four CRM007 URL states and overlap', () => {
  assert.deepEqual(FOLLOW_UP_FILTERS, ['overdue', 'today', 'upcoming', 'none'])
  const expected = {
    overdue: { nextContactAt: { lt: now } },
    today: { nextContactAt: { gte: new Date('2026-09-13T17:00:00.000Z'), lt: new Date('2026-09-14T17:00:00.000Z') } },
    upcoming: { nextContactAt: { gte: now } },
    none: { nextContactAt: null },
  }
  for (const followUp of FOLLOW_UP_FILTERS) {
    assert.deepEqual(customerFollowUpWhere(followUp, now), expected[followUp])
    const { filters } = parseCustomerFilters({ followUp })
    assert.deepEqual(customerFilterWhere(filters, now), { AND: [expected[followUp]] })
  }
  assert.deepEqual(customerFilterWhere(parseCustomerFilters({}).filters, now), { AND: [] })
})

test('contact state labels match database predicates around now and both Vietnam midnight boundaries', () => {
  const cases = [
    [null, ['none']],
    ['2026-09-13T16:59:59.999Z', ['overdue']],
    ['2026-09-13T17:00:00.000Z', ['overdue', 'today']],
    ['2026-09-14T04:59:59.999Z', ['overdue', 'today']],
    ['2026-09-14T05:00:00.000Z', ['today', 'upcoming']],
    ['2026-09-14T05:00:00.001Z', ['today', 'upcoming']],
    ['2026-09-14T16:59:59.999Z', ['today', 'upcoming']],
    ['2026-09-14T17:00:00.000Z', ['upcoming']],
    ['2026-09-15T17:00:00.000Z', ['upcoming']],
  ]
  for (const [timestamp, expected] of cases) {
    const value = timestamp === null ? null : new Date(timestamp)
    assert.deepEqual(contactStates(value, now), expected, timestamp)
    const matchingPredicates = FOLLOW_UP_FILTERS.filter((state) => matches(customerFollowUpWhere(state, now), value))
    assert.deepEqual(matchingPredicates, expected, timestamp)
    assert.equal(isOverdueFollowUp(value, now), expected.includes('overdue'), timestamp)
  }
})

test('today overlap remains explicit rather than treating four health counts as a disjoint partition', () => {
  const morning = new Date('2026-09-14T01:00:00.000Z')
  const evening = new Date('2026-09-14T12:00:00.000Z')
  assert.deepEqual(contactStates(morning, now), ['overdue', 'today'])
  assert.deepEqual(contactStates(evening, now), ['today', 'upcoming'])
  assert.equal(contactStates(morning, now).length + contactStates(evening, now).length, 4)
})

test('contact predicates and classification stay host-timezone independent at leap-day and year rollovers', () => {
  const previous = process.env.TZ
  const instants = [
    '2024-02-28T17:00:00.000Z', '2024-02-29T16:59:59.999Z',
    '2026-12-31T16:59:59.999Z', '2026-12-31T17:00:00.000Z',
  ]
  try {
    for (const timezone of ['UTC', 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Ho_Chi_Minh']) {
      process.env.TZ = timezone
      for (const timestamp of instants) {
        const instant = new Date(timestamp)
        const { start, end } = vietnamDayBounds(instant)
        assert.deepEqual(customerFollowUpWhere('today', instant), { nextContactAt: { gte: start, lt: end } })
        for (const value of [new Date(start.getTime() - 1), start, instant, new Date(end.getTime() - 1), end]) {
          assert.deepEqual(contactStates(value, instant), FOLLOW_UP_FILTERS.filter((state) => matches(customerFollowUpWhere(state, instant), value)), `${timezone}: ${timestamp}`)
        }
        assert.equal(matches(customerFollowUpWhere('today', instant), new Date(start.getTime() - 1)), false)
        assert.equal(matches(customerFollowUpWhere('today', instant), start), true)
        assert.equal(matches(customerFollowUpWhere('today', instant), end), false)
      }
    }
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
})

test('health drill-down URLs use the existing followUp parameter and round-trip through CRM007 parsing', () => {
  for (const followUp of FOLLOW_UP_FILTERS) {
    const href = filtersHref('/sales/customers', { page: 1, followUp })
    assert.equal(href, `/sales/customers?followUp=${followUp}`)
    const query = new URL(href, 'https://crm.invalid').searchParams
    const result = parseCustomerFilters(Object.fromEntries(query))
    assert.deepEqual(result.invalidKeys, [])
    assert.equal(result.filters.followUp, followUp)
    assert.deepEqual(customerFilterWhere(result.filters, now), { AND: [customerFollowUpWhere(followUp, now)] })
  }
})

test('contact-state reuse preserves independent customer filters without adding task or status exclusions', () => {
  for (const followUp of FOLLOW_UP_FILTERS) {
    const { filters } = parseCustomerFilters({ followUp, status: 'CLOSED', priority: 'HIGH', salesId: 'sales-own', teamId: 'team-own' })
    assert.deepEqual(customerFilterWhere(filters, now), { AND: [
      { status: 'CLOSED' }, { priority: 'HIGH' }, { assignedSalesId: 'sales-own' },
      { assignedSales: { salesMemberships: { some: { teamId: 'team-own' } } } },
      customerFollowUpWhere(followUp, now),
    ] })
    assert.equal('tasks' in customerFollowUpWhere(followUp, now), false)
    assert.equal('status' in customerFollowUpWhere(followUp, now), false)
  }
})
