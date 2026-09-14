import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { CustomerActivityType } from '@prisma/client'

const moduleUrl = new URL('../src/features/crm/activity-filters.ts', import.meta.url).href
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === moduleUrl && specifier === './customer-filters') return nextResolve('./customer-filters.ts', context)
    return nextResolve(specifier, context)
  },
})
const { ACTIVITY_TYPES, ACTIVITY_PAGE_SIZE, parseActivityFilters, activityWhere, activityFiltersHref } = await import(moduleUrl)
hook.deregister()

const parse = (params) => parseActivityFilters(params).filters

test('timeline choices contain every real manual and system activity type', () => {
  assert.deepEqual(ACTIVITY_TYPES, Object.values(CustomerActivityType))
  assert.equal(ACTIVITY_PAGE_SIZE, 20)
  for (const activityType of Object.values(CustomerActivityType)) {
    const result = parseActivityFilters({ activityType })
    assert.equal(result.filters.activityType, activityType)
    assert.equal(result.filters.activityPage, 1)
    assert.deepEqual(result.invalidKeys, [])
  }
})

test('default and blank values mean all activity types on page one', () => {
  for (const params of [{}, { activityType: '', activityPage: '' }, { activityType: ' ', activityPage: ' ' }]) {
    assert.deepEqual(parseActivityFilters(params), { filters: { activityType: undefined, activityPage: 1 }, invalidKeys: [] })
  }
  assert.deepEqual(parseActivityFilters({ activityType: ' NOTE ', activityPage: ' 2 ' }), {
    filters: { activityType: 'NOTE', activityPage: 2 }, invalidKeys: [],
  })
})

test('invalid, overlong and control-bearing types are ignored with a known-key notice', () => {
  for (const activityType of ['note', 'TASK_CREATED', 'TEAM_CHANGE', 'UNKNOWN', 'x'.repeat(33), 'NOTE\u0000', 'NOTE\n', '\tCALL', 'NOTE\u007f']) {
    const result = parseActivityFilters({ activityType })
    assert.equal(result.filters.activityType, undefined)
    assert.deepEqual(result.invalidKeys, ['activityType'])
  }
})

test('repeated type and page parameters are rejected even if identical or single-element arrays', () => {
  for (const [key, value] of [['activityType', 'NOTE'], ['activityPage', '2']]) {
    for (const repeated of [[value], [value, value], [value, 'foreign']]) {
      const result = parseActivityFilters({ [key]: repeated })
      assert.deepEqual(result.invalidKeys, [key])
      assert.equal(result.filters[key], key === 'activityPage' ? 1 : undefined)
    }
  }
})

test('activity page accepts bounded positive decimal integers and safely resets malformed pages', () => {
  for (const activityPage of ['1', '2', '1000000']) {
    const result = parseActivityFilters({ activityPage })
    assert.equal(result.filters.activityPage, Number(activityPage))
    assert.deepEqual(result.invalidKeys, [])
  }
  for (const activityPage of ['0', '-1', '01', '1.5', '1e3', '0x10', 'NaN', 'Infinity', '1000001', '999999999', '2\n']) {
    const result = parseActivityFilters({ activityPage })
    assert.equal(result.filters.activityPage, 1)
    assert.deepEqual(result.invalidKeys, ['activityPage'])
  }
})

test('foreign identity, actor, task and unrelated query parameters are never accepted filters', () => {
  const result = parseActivityFilters({
    customerId: 'foreign', actorId: 'viewer', assignedSalesId: 'foreign', salesId: 'foreign',
    teamId: 'foreign', assignedToId: 'viewer', OR: '1=1', page: '2', period: '7d', q: '<script>',
  })
  assert.deepEqual(result, { filters: { activityType: undefined, activityPage: 1 }, invalidKeys: [] })
})

test('customer identity and customer scope remain independent AND predicates with every type filter', () => {
  const scopes = [
    {},
    { assignedSalesId: 'sales-a' },
    { assignedSales: { salesMemberships: { some: { team: { managerId: 'manager-a' } } } } },
  ]
  for (const scope of scopes) {
    for (const activityType of [undefined, ...Object.values(CustomerActivityType)]) {
      const filters = { activityType, activityPage: 2 }
      assert.deepEqual(activityWhere('customer-a', scope, filters), {
        AND: [{ customerId: 'customer-a' }, { customer: { is: scope } }, ...(activityType ? [{ type: activityType }] : [])],
      })
      assert.equal(JSON.stringify(activityWhere('customer-a', scope, filters)).includes('actorId'), false)
    }
  }
})

test('invalid or repeated type filters cannot remove the customer authorization predicate', () => {
  const scope = { assignedSalesId: 'sales-a' }
  for (const params of [
    { activityType: 'INVALID' }, { activityType: ['NOTE', 'STATUS_CHANGE'] },
    { activityPage: '-5' }, { activityPage: ['1', '2'] },
  ]) {
    assert.deepEqual(activityWhere('foreign-customer', scope, parse(params)), {
      AND: [{ customerId: 'foreign-customer' }, { customer: { is: scope } }],
    })
  }
})

test('pagination links preserve the type and timeline anchor without mutating source filters', () => {
  const filters = parse({ activityType: 'STATUS_CHANGE', activityPage: '2' })
  const original = structuredClone(filters)
  const url = new URL(activityFiltersHref('/sales/customers/customer-a', filters, { activityPage: 3 }), 'https://crm.invalid')
  assert.equal(url.pathname, '/sales/customers/customer-a')
  assert.equal(url.searchParams.get('activityType'), 'STATUS_CHANGE')
  assert.equal(url.searchParams.get('activityPage'), '3')
  assert.equal(url.searchParams.size, 2)
  assert.equal(url.hash, '#activity-timeline')
  assert.deepEqual(filters, original)
})

test('changing filters can reset pagination and reset links contain no stale query values', () => {
  const filters = parse({ activityType: 'ASSIGNMENT', activityPage: '99' })
  assert.equal(activityFiltersHref('/sales/customers/customer-a', filters, { activityType: 'NOTE', activityPage: 1 }),
    '/sales/customers/customer-a?activityType=NOTE#activity-timeline')
  assert.equal(activityFiltersHref('/sales/customers/customer-a', filters, { activityType: undefined, activityPage: 1 }),
    '/sales/customers/customer-a#activity-timeline')
  assert.equal(activityFiltersHref('/sales/customers/customer-a', { activityPage: 1 }),
    '/sales/customers/customer-a#activity-timeline')
})
