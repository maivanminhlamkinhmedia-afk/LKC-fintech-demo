import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

const compilerUrl = new URL('../src/features/crm/report-scope-sql.ts', import.meta.url).href
const accessUrl = new URL('../src/features/crm/access.ts', import.meta.url).href
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === compilerUrl && specifier === '../../lib/roles') return nextResolve('../../lib/roles.ts', context)
    return nextResolve(specifier, context)
  },
})
const { customerScopeSql, reportCustomerSql } = await import(compilerUrl)
const { customerSalesScope } = await import(accessUrl)
hook.deregister()

const filters = { period: '30d', page: 1, teamPage: 1 }
const user = (role) => ({ id: `viewer-${role}`, role })

test('scope compiler accepts every current authorized role using the real helper output', () => {
  for (const role of ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SALES_MANAGER', 'SALES']) {
    const viewer = user(role)
    const result = customerScopeSql(viewer, customerSalesScope(viewer))
    if (['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(role)) {
      assert.equal(result.sql, '1 = 1')
      assert.deepEqual(result.values, [])
    } else {
      assert.deepEqual(result.values, [viewer.id])
      assert.equal(result.sql.includes(viewer.id), false)
      assert.equal(result.sql.includes('assignedToId'), false)
      if (role === 'SALES') assert.equal(result.sql, 'c.assignedSalesId = ?')
      else {
        assert.match(result.sql, /EXISTS/)
        assert.match(result.sql, /scope_member\.userId = c\.assignedSalesId/)
        assert.match(result.sql, /scope_team\.managerId = \?/)
      }
    }
  }
})

test('unauthorized roles and missing identity fail before compiling even a restrictive scope', () => {
  for (const role of ['CLIENT', 'CREATOR', 'ANALYST', 'EMPLOYEE', 'UNKNOWN']) {
    const viewer = user(role)
    assert.throws(() => customerScopeSql(viewer, customerSalesScope(viewer)), /denied/)
    assert.throws(() => customerScopeSql(viewer, {}), /denied/)
  }
  assert.throws(() => customerScopeSql({ id: '', role: 'ADMIN' }, {}), /denied/)
})

test('empty scopes and unexpected role/scope combinations never become global access', () => {
  for (const role of ['SALES_MANAGER', 'SALES']) assert.throws(() => customerScopeSql(user(role), {}), /refused/)
  assert.throws(() => customerScopeSql(user('ADMIN'), { assignedSalesId: user('ADMIN').id }), /refused/)
  assert.throws(() => customerScopeSql(user('SALES'), { assignedSalesId: 'another-user' }), /refused/)
  assert.throws(() => customerScopeSql(user('SALES'), customerSalesScope(user('SALES_MANAGER'))), /refused/)
  const managerScope = customerSalesScope(user('SALES_MANAGER'))
  managerScope.assignedSales.salesMemberships.some.team.managerId = 'another-manager'
  assert.throws(() => customerScopeSql(user('SALES_MANAGER'), managerScope), /refused/)
})

test('extra or unknown scope keys at every recognized nesting depth fail closed', () => {
  for (const extra of [{ OR: [] }, { AND: [] }, { NOT: {} }, { status: 'ACTIVE' }, { arbitrary: true }]) {
    assert.throws(() => customerScopeSql(user('ADMIN'), extra), /refused/)
    assert.throws(() => customerScopeSql(user('SALES'), { ...customerSalesScope(user('SALES')), ...extra }), /refused/)
  }
  const paths = [[], ['assignedSales'], ['assignedSales', 'salesMemberships'], ['assignedSales', 'salesMemberships', 'some'], ['assignedSales', 'salesMemberships', 'some', 'team']]
  for (const path of paths) {
    const scope = customerSalesScope(user('SALES_MANAGER'))
    let target = scope
    for (const key of path) target = target[key]
    target.OR = [{ managerId: 'foreign' }]
    assert.throws(() => customerScopeSql(user('SALES_MANAGER'), scope), /refused/, path.join('.'))
  }
})

test('non-object, array, inherited and symbol-bearing scopes fail closed', () => {
  for (const scope of [null, undefined, [], '', '1=1', { [Symbol('extra')]: true }, Object.create({ assignedSalesId: 'foreign' })]) {
    assert.throws(() => customerScopeSql(user('ADMIN'), scope), /refused/)
  }
  for (const sales of [null, [], {}, { salesMemberships: [] }, { salesMemberships: { some: [] } }]) {
    assert.throws(() => customerScopeSql(user('SALES_MANAGER'), { assignedSales: sales }), /refused/)
  }
})

test('report filters narrow customer ownership independently from both restricted scope shapes', () => {
  const input = { ...filters, salesId: 'foreign-sales', teamId: 'foreign-team', status: 'ACTIVE', priority: 'HIGH' }
  for (const role of ['SALES_MANAGER', 'SALES']) {
    const viewer = user(role)
    const result = reportCustomerSql(viewer, customerSalesScope(viewer), input)
    assert.deepEqual(result.values, [viewer.id, input.salesId, input.teamId, input.status, input.priority])
    assert.match(result.sql, /^\([\s\S]+\) AND \(1 = 1 AND /)
    assert.match(result.sql, /c\.assignedSalesId = \?/)
    assert.match(result.sql, /filter_member\.userId = c\.assignedSalesId AND filter_member\.teamId = \?/)
    assert.equal(result.sql.includes('assignedToId'), false)
  }
})

test('IDs and enum-like submitted strings remain bound parameters, never SQL syntax', () => {
  const injection = "x' OR 1=1; --"
  // The URL parser rejects these IDs/enums. Binding remains safe even for a faulty caller.
  const viewer = { id: injection, role: 'SALES' }
  const result = reportCustomerSql(viewer, customerSalesScope(viewer), {
    ...filters, salesId: injection, teamId: injection, status: injection, priority: injection,
  })
  assert.equal(result.sql.includes(injection), false)
  assert.deepEqual(result.values, Array(5).fill(injection))
  assert.equal((result.sql.match(/\?/g) ?? []).length, 5)
})

test('periods and page numbers never constrain or broaden the snapshot portfolio', () => {
  const viewer = user('ADMIN')
  const first = reportCustomerSql(viewer, customerSalesScope(viewer), filters)
  const changed = reportCustomerSql(viewer, customerSalesScope(viewer), {
    ...filters, period: 'custom', from: '2026-01-01', to: '2026-12-31', page: 999999, teamPage: 999999,
    OR: '1=1', assignedToId: 'foreign', customerId: 'foreign',
  })
  assert.deepEqual(changed.sql, first.sql)
  assert.deepEqual(changed.values, first.values)
  assert.equal(changed.sql.includes('createdAt'), false)
})
