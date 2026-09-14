import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { CustomerTaskPriority, CustomerTaskStatus, CustomerStatus, CustomerPriority } from '@prisma/client'

// Next resolves extensionless TS imports; keep this adaptation local to the Node test.
const moduleUrl = new URL('../src/features/crm/follow-up-filters.ts', import.meta.url).href
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === moduleUrl && specifier === './customer-filters') {
      return nextResolve('./customer-filters.ts', context)
    }
    return nextResolve(specifier, context)
  },
})
const {
  TASK_STATUSES, TASK_PRIORITIES, DUE_STATES, FOLLOW_UP_PAGE_SIZE,
  parseFollowUpFilters, followUpFilterWhere, scopedFollowUpWhere,
  followUpMetricWhere, taskDueWhere, isOverdueTask, followUpFiltersHref,
} = await import(moduleUrl)
hook.deregister()

const now = new Date('2026-09-14T05:00:00.000Z')
const parse = (params) => parseFollowUpFilters(params).filters
const valid = {
  q: 'Khách hàng', status: 'TODO', priority: 'URGENT', salesId: 'sales-a', teamId: 'team-a',
  due: 'today', customerStatus: 'ACTIVE', customerPriority: 'HIGH', page: '2',
}

test('task and customer enums stay distinct and use every real Prisma value', () => {
  assert.deepEqual(TASK_STATUSES, Object.values(CustomerTaskStatus))
  assert.deepEqual(TASK_PRIORITIES, Object.values(CustomerTaskPriority))
  assert.deepEqual(DUE_STATES, ['overdue', 'today', 'upcoming', 'none'])
  assert.equal(FOLLOW_UP_PAGE_SIZE, 30)
  for (const [key, values] of Object.entries({
    status: TASK_STATUSES, priority: TASK_PRIORITIES, due: DUE_STATES,
    customerStatus: Object.values(CustomerStatus), customerPriority: Object.values(CustomerPriority),
  })) {
    for (const value of values) {
      const result = parseFollowUpFilters({ [key]: value })
      assert.equal(result.filters[key], value)
      assert.deepEqual(result.invalidKeys, [])
    }
  }
  assert.deepEqual(parseFollowUpFilters({ status: 'ACTIVE', customerStatus: 'TODO', customerPriority: 'URGENT' }).invalidKeys.sort(),
    ['customerPriority', 'customerStatus', 'status'])
})

test('all nine fields reject repeated values even identical or single-item arrays', () => {
  for (const [key, value] of Object.entries(valid)) {
    for (const values of [[value], [value, value], [value, 'foreign']]) {
      const result = parseFollowUpFilters({ [key]: values })
      assert.deepEqual(result.invalidKeys, [key], key)
      assert.equal(result.filters[key], key === 'page' ? 1 : undefined, key)
    }
  }
})

test('invalid enums, control characters, identifiers and page values never reach predicates', () => {
  const invalid = {
    status: ['todo', 'OPEN', 'DONE\n', 'x'.repeat(33)], priority: ['high', 'HIGH\u0000'],
    due: ['tomorrow', 'all', 'today\u007f'], customerStatus: ['WON', 'active', 'ACTIVE\t'],
    customerPriority: ['URGENT', 'low'],
    salesId: ['../foreign', 'sales id', 'sales%20id', 'x'.repeat(192)],
    teamId: ['team&id=x', 'team\u0000id', 'x'.repeat(192)],
    q: ['x'.repeat(121), 'A\u0000B', 'A\nB', 'A\u007fB'],
    page: ['0', '-1', '01', '1.5', '1e3', '0x10', 'NaN', '1000001', '2\n'],
  }
  for (const [key, values] of Object.entries(invalid)) {
    for (const value of values) {
      const result = parseFollowUpFilters({ [key]: value })
      assert.deepEqual(result.invalidKeys, [key], `${key}=${JSON.stringify(value)}`)
      assert.deepEqual(followUpFilterWhere(result.filters, now), { AND: [] })
    }
  }
})

test('valid boundaries, Unicode, trimmed and blank values are preserved safely', () => {
  const parsed = parseFollowUpFilters({
    q: ' Nguyễn & a+b?x=#50% ', status: ' DONE ', priority: ' ', salesId: 'x'.repeat(191),
    teamId: '', due: ' upcoming ', customerStatus: ' CLOSED ', customerPriority: '', page: '1000000',
    assignedSalesId: 'foreign', assignedToId: 'foreign', OR: '{"role":"ADMIN"}', task: 'open', followUp: 'today',
  })
  assert.deepEqual(parsed.invalidKeys, [])
  assert.equal(parsed.filters.q, 'Nguyễn & a+b?x=#50%')
  assert.equal(parsed.filters.status, 'DONE')
  assert.equal(parsed.filters.customerStatus, 'CLOSED')
  assert.equal(parsed.filters.salesId.length, 191)
  assert.equal(parsed.filters.priority, undefined)
  assert.equal(parsed.filters.page, 1000000)
  for (const key of ['OR', 'assignedSalesId', 'assignedToId', 'task', 'followUp']) assert.equal(key in parsed.filters, false)
  assert.equal(parse({ q: 'x'.repeat(120) }).q.length, 120)
  assert.equal(parse({ page: '' }).page, 1)
})

test('search uses literal MySQL wildcard escaping for task title, customer name and code only', () => {
  const choices = followUpFilterWhere(parse({ q: String.raw`100%_\discount` }), now).AND[0].OR
  assert.deepEqual(choices, [
    { title: { contains: String.raw`100\%\_\\discount` } },
    { customer: { is: { user: { name: { contains: String.raw`100\%\_\\discount` } } } } },
    { customer: { is: { customerCode: { contains: String.raw`100\%\_\\discount` } } } },
  ])
})

test('all filters intersect task-assignee predicates and independently AND customer authorization', () => {
  const filters = parse(valid)
  const scope = { assignedSalesId: 'authorized-sales' }
  const scoped = scopedFollowUpWhere(scope, filters, now)
  assert.deepEqual(scoped.AND[0], { customer: { is: scope } })
  const clauses = scoped.AND[1].AND
  assert.equal(clauses.length, 8)
  assert.equal(clauses.filter((clause) => clause.OR).length, 1)
  assert.deepEqual(clauses.find((clause) => clause.assignedToId), { assignedToId: 'sales-a' })
  assert.deepEqual(clauses.find((clause) => clause.assignedTo),
    { assignedTo: { is: { salesMemberships: { some: { teamId: 'team-a' } } } } })
  assert.deepEqual(clauses.find((clause) => clause.customer?.is?.status), { customer: { is: { status: 'ACTIVE' } } })
  assert.deepEqual(clauses.find((clause) => clause.customer?.is?.priority), { customer: { is: { priority: 'HIGH' } } })
  assert.deepEqual(scope, { assignedSalesId: 'authorized-sales' })
})

test('today uses the half-open Vietnam calendar day independent of host timezone', () => {
  const previousTimezone = process.env.TZ
  try {
    for (const timezone of ['UTC', 'America/Los_Angeles', 'Pacific/Auckland']) {
      process.env.TZ = timezone
      for (const [instant, start, end] of [
        ['2026-09-14T16:59:59.999Z', '2026-09-13T17:00:00.000Z', '2026-09-14T17:00:00.000Z'],
        ['2026-09-14T17:00:00.000Z', '2026-09-14T17:00:00.000Z', '2026-09-15T17:00:00.000Z'],
        ['2024-02-29T16:59:59.999Z', '2024-02-28T17:00:00.000Z', '2024-02-29T17:00:00.000Z'],
      ]) {
        const { dueAt } = taskDueWhere('today', new Date(instant))
        assert.equal(dueAt.gte.toISOString(), start)
        assert.equal(dueAt.lt.toISOString(), end)
        assert.equal('lte' in dueAt, false)
      }
    }
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ
    else process.env.TZ = previousTimezone
  }
})

test('date predicates split at now and include completed statuses; overdue badges are open-only', () => {
  assert.deepEqual(taskDueWhere('overdue', now), { dueAt: { lt: now } })
  assert.deepEqual(taskDueWhere('upcoming', now), { dueAt: { gte: now } })
  assert.deepEqual(taskDueWhere('none', now), { dueAt: null })
  for (const status of TASK_STATUSES) {
    const open = status === 'TODO' || status === 'IN_PROGRESS'
    assert.equal(isOverdueTask({ status, dueAt: new Date(now.getTime() - 1) }, now), open)
    for (const dueAt of [null, now, new Date(now.getTime() + 1)]) assert.equal(isOverdueTask({ status, dueAt }, now), false)
    assert.deepEqual(followUpFilterWhere(parse({ status, due: 'overdue' }), now),
      { AND: [{ status }, { dueAt: { lt: now } }] })
  }
})

test('metrics retain the full filtered authorization predicate then intersect open status and dates', () => {
  const where = scopedFollowUpWhere({ assignedSalesId: 'sales-own' }, parse({ ...valid, status: 'DONE' }), now)
  for (const due of [undefined, 'overdue', 'today', 'upcoming']) {
    assert.deepEqual(followUpMetricWhere(where, due, now), {
      AND: [where, { status: { in: ['TODO', 'IN_PROGRESS'] } }, taskDueWhere(due, now)],
    })
  }
})

test('pagination links encode and retain every filter without mutating state; reset removes filters', () => {
  const original = parse({ ...valid, q: 'Nguyễn & a+b?x=#50%' })
  const before = structuredClone(original)
  const url = new URL(followUpFiltersHref('/sales/follow-ups', original, { page: 3 }), 'https://crm.invalid')
  assert.equal(url.hash, '')
  assert.equal(url.searchParams.size, 9)
  assert.deepEqual(parse(Object.fromEntries(url.searchParams)), { ...original, page: 3 })
  assert.deepEqual(original, before)
  const reset = Object.fromEntries(Object.keys(original).map((key) => [key, key === 'page' ? 1 : undefined]))
  assert.equal(followUpFiltersHref('/sales/follow-ups', original, reset), '/sales/follow-ups')
  const retained = new URL(followUpFiltersHref('/sales/follow-ups', original, { page: 1, status: undefined }), 'https://crm.invalid')
  assert.equal(retained.searchParams.has('status'), false)
  assert.equal(retained.searchParams.has('page'), false)
  assert.equal(retained.searchParams.get('teamId'), 'team-a')
})
