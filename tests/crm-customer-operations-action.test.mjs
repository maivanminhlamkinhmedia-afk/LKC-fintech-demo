import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { Prisma } from '@prisma/client'

// Real production modules with isolated auth/Prisma/revalidation adapters. These
// tests establish control-flow and rollback expectations, not MySQL isolation.
const rootUrl = new URL('../', import.meta.url)
const bulkUrl = new URL('src/features/crm/customer-bulk-actions.ts', rootUrl).href
const exportUrl = new URL('src/features/crm/customer-export.ts', rootUrl).href
const routeUrl = new URL('src/app/sales/customers/export/route.ts', rootUrl).href
const filterUrl = new URL('src/features/crm/customer-export-filters.ts', rootUrl).href
const bridgeKey = Symbol.for('crm-customer-operations-test-adapter')
let current
const clone = (value) => structuredClone(value)
const record = (kind, args) => current.calls.push({ kind, ...(args === undefined ? {} : { args: clone(args) }) })

function matches(row, where) {
  if (where.AND && !where.AND.every((clause) => matches(row, clause))) return false
  if (where.OR && !where.OR.some((clause) => matches(row, clause))) return false
  for (const [key, value] of Object.entries(where)) {
    if (['AND', 'OR'].includes(key)) continue
    if (key === 'assignedSales') {
      const team = value.salesMemberships?.some
      if (team?.team?.managerId && row.managerId !== team.team.managerId) return false
      if (team?.teamId && row.teamId !== team.teamId) return false
    } else if (value instanceof Date) {
      if (row[key]?.getTime() !== value.getTime()) return false
    } else if (value && typeof value === 'object' && 'in' in value) {
      if (!value.in.includes(row[key])) return false
    } else if (row[key] !== value) return false
  }
  return true
}

const adapter = {
  async requirePermission(permission) {
    record('auth', permission)
    if (current.authError) throw current.authError
    return clone(current.session)
  },
  revalidatePath(path) {
    assert.equal(current.inTransaction, false)
    assert.ok(current.calls.some((call) => call.kind === 'commit'))
    record('revalidate', path)
    current.paths.push(path)
  },
  prisma: {
    async $transaction(callback, options) {
      record('transaction', options)
      const before = clone(current.state)
      current.inTransaction = true
      const tx = {
        user: { async findUnique(args) {
          record('actor', args)
          return current.state.actor?.id === args.where.id ? clone(current.state.actor) : null
        } },
        customerProfile: {
          async count(args) {
            record('count', args)
            if (current.countError) throw current.countError
            return current.exportCount ?? current.state.customers.filter((row) => matches(row, args.where)).length
          },
          async findMany(args) {
            record('customers', args)
            if (current.fetchError) throw current.fetchError
            return clone((current.fetchRows ?? current.state.customers.filter((row) => matches(row, args.where))).slice(0, args.take))
          },
          async updateMany(args) {
            record('update', args)
            if (current.updateError) throw current.updateError
            if (current.beforeUpdate) current.beforeUpdate(current.state)
            const rows = current.state.customers.filter((row) => matches(row, args.where))
            for (const row of rows) Object.assign(row, clone(args.data), { updatedAt: new Date(row.updatedAt.getTime() + 10) })
            return { count: current.updateCount ?? rows.length }
          },
        },
        auditLog: {
          async createMany(args) {
            record('audits', args)
            if (current.auditError) throw current.auditError
            current.state.audits.push(...clone(args.data))
            return { count: current.auditCount ?? args.data.length }
          },
          async create(args) {
            record('audit', args)
            if (current.auditError) throw current.auditError
            current.state.audits.push(clone(args.data))
            return clone(args.data)
          },
        },
      }
      try {
        if (current.transactionError) throw current.transactionError
        const result = await callback(tx)
        record('commit')
        return result
      } catch (error) {
        current.state = before
        record('rollback')
        throw error
      } finally { current.inTransaction = false }
    },
  },
}
globalThis[bridgeKey] = adapter
const adapterModule = (exports) => `data:text/javascript,${encodeURIComponent(`const adapter = globalThis[Symbol.for('crm-customer-operations-test-adapter')]; ${exports}`)}`
const substitutes = new Map([
  ['@/lib/authz', adapterModule('export const requirePermission = adapter.requirePermission;')],
  ['@/lib/prisma', adapterModule('export const prisma = adapter.prisma;')],
  ['next/cache', adapterModule('export const revalidatePath = adapter.revalidatePath;')],
  ['server-only', 'data:text/javascript,export {};'],
])
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (substitutes.has(specifier)) return nextResolve(substitutes.get(specifier), context)
    if (specifier.startsWith('@/')) return nextResolve(new URL(`src/${specifier.slice(2)}.ts`, rootUrl).href, context)
    if (context.parentURL === filterUrl && specifier === './customer-filters') return nextResolve('./customer-filters.ts', context)
    return nextResolve(specifier, context)
  },
})
let updateCustomerPriorities, customerExportResponse, GET, HEAD
try {
  ({ updateCustomerPriorities } = await import(bulkUrl));
  ({ customerExportResponse } = await import(exportUrl));
  ({ GET, HEAD } = await import(routeUrl))
} finally { hook.deregister(); delete globalThis[bridgeKey] }

const version = new Date('2026-09-14T00:00:00.000Z')
const paths = ['/sales/customers', '/sales/pipeline', '/sales/reports', '/sales', '/sales/follow-ups', '/sales/assignment']
function customer(id, priority = 'LOW', assignedSalesId = 'actor-own') {
  return {
    id, userId: `user-${id}`, customerCode: `code-${id}`, priority, assignedSalesId,
    managerId: assignedSalesId === 'actor-own' ? 'actor-own' : 'foreign-manager', teamId: 'team-own',
    status: 'LEAD', source: 'private-source', note: 'NEVER EXPORT PRIVATE NOTE',
    lastContactAt: new Date('2020-01-01T00:00:00.000Z'), nextContactAt: null,
    createdAt: new Date('2025-01-01T00:00:00.000Z'), updatedAt: clone(version),
    user: { name: `Name ${id}`, email: `${id}@example.test`, password: 'NEVER EXPORT PASSWORD', phone: 'PRIVATE PHONE' },
    assignedSales: { id: 'internal-sales-id', name: 'Sales Name', email: 'PRIVATE SALES EMAIL' },
  }
}
function scenario(overrides = {}) {
  current = {
    state: {
      actor: { id: 'actor-own', role: 'SALES', status: 'ACTIVE' },
      customers: [customer('customer-a'), customer('customer-b', 'MEDIUM'), customer('customer-c', 'HIGH'), customer('customer-foreign', 'LOW', 'foreign-owner')],
      audits: [{ id: 'historical-audit', metadata: { preserved: true } }],
      tasks: [{ id: 'task-a', priority: 'URGENT', status: 'DONE', completedAt: '2020-01-01' }],
      activities: [{ content: 'PRIVATE ACTIVITY' }], teams: [{ name: 'Preserve team' }], memberships: [{ userId: 'actor-own' }],
    },
    session: { user: { id: 'actor-own', role: 'SUPER_ADMIN' } },
    calls: [], paths: [], inTransaction: false, ...overrides,
  }
  return current
}
function form(fields = {}) {
  const data = new FormData()
  for (const [key, value] of Object.entries({ customerIds: ['customer-a'], priority: 'HIGH', ...fields })) {
    if (value !== null) for (const item of Array.isArray(value) ? value : [value]) data.append(key, item)
  }
  return data
}
const run = (fields) => updateCustomerPriorities({ kind: 'success', message: 'Forged prior state' }, form(fields))
const calls = (kind) => current.calls.filter((call) => call.kind === kind)
const exportRequest = (query = '') => GET(new Request(`https://example.test/sales/customers/export?${query}`))
const csvText = async (response) => Buffer.from(await response.arrayBuffer()).toString('utf8')
function untouched(before) {
  assert.deepEqual(current.state, before)
  assert.deepEqual(current.paths, [])
}
function onlyPrioritiesChanged(before, ids) {
  const stable = clone(current.state)
  for (const row of stable.customers) if (ids.includes(row.id)) {
    const prior = before.customers.find((entry) => entry.id === row.id)
    row.priority = prior.priority
    row.updatedAt = prior.updatedAt
  }
  stable.audits = before.audits
  assert.deepEqual(stable, before)
}
const exportSelect = {
  customerCode: true, status: true, priority: true, lastContactAt: true, nextContactAt: true, createdAt: true,
  user: { select: { name: true, email: true } }, assignedSales: { select: { name: true } },
}

test('bulk authentication precedes validation and permission failure propagates without database access', async () => {
  const authError = new Error('Auth redirect')
  scenario({ authError })
  const before = clone(current.state)
  await assert.rejects(run({ priority: '' }), (error) => error === authError)
  assert.deepEqual(current.calls, [{ kind: 'auth', args: 'sales:write' }])
  untouched(before)
})

test('bulk invalid parser results never open a transaction or change any state', async () => {
  for (const fields of [{ customerIds: [] }, { customerIds: Array(101).fill('customer-a') }, { priority: ['HIGH', 'HIGH'] }, { priority: new File(['HIGH'], 'p.txt') }]) {
    scenario()
    const before = clone(current.state)
    assert.equal((await run(fields)).kind, 'error')
    assert.deepEqual(current.calls.map((call) => call.kind), ['auth'])
    untouched(before)
  }
})

test('bulk fresh transaction actor rejects missing, inactive and every non-writing role before customer fetch', async () => {
  for (const actor of [null, ...['SUSPENDED', 'DISABLED', 'INVITED'].map((status) => ({ id: 'actor-own', role: 'SALES', status })),
    ...['MANAGER', 'CLIENT', 'CREATOR', 'ANALYST', 'EMPLOYEE'].map((role) => ({ id: 'actor-own', role, status: 'ACTIVE' }))]) {
    scenario(); current.state.actor = actor
    const before = clone(current.state)
    assert.equal((await run()).kind, 'error')
    assert.equal(calls('customers').length, 0)
    assert.equal(calls('update').length, 0)
    untouched(before)
  }
})

test('bulk uses fresh role scopes and one bounded customer fetch for all four writing roles', async () => {
  for (const role of ['SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'SALES']) {
    scenario(); current.state.actor.role = role; current.session.user.role = 'CLIENT'
    assert.equal((await run()).kind, 'success')
    const scope = role === 'SALES' ? { assignedSalesId: 'actor-own' } : role === 'SALES_MANAGER'
      ? { assignedSales: { salesMemberships: { some: { team: { managerId: 'actor-own' } } } } } : {}
    assert.deepEqual(calls('actor')[0].args, { where: { id: 'actor-own' }, select: { id: true, role: true, status: true } })
    assert.equal(calls('customers').length, 1)
    assert.deepEqual(calls('customers')[0].args, {
      where: { AND: [{ id: { in: ['customer-a'] } }, scope] },
      select: { id: true, priority: true, updatedAt: true }, orderBy: { id: 'asc' }, take: 100,
    })
    assert.deepEqual(calls('transaction')[0].args, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 })
  }
})

test('one foreign/missing/reassigned customer rejects the entire batch before writes, even with no-op rows', async () => {
  let genericMessage
  for (const role of ['SALES', 'SALES_MANAGER']) for (const foreign of ['customer-foreign', 'customer-missing']) {
    scenario(); current.state.actor.role = role
    const before = clone(current.state)
    const result = await run({ customerIds: ['customer-a', 'customer-c', foreign] })
    assert.equal(result.kind, 'error')
    genericMessage ??= result.message
    assert.equal(result.message, genericMessage)
    assert.equal(result.message.includes(foreign), false)
    assert.equal(calls('update').length, 0)
    assert.equal(calls('audits').length, 0)
    untouched(before)
  }
})

test('completed customer reassignment or team removal revokes old bulk selection while actor role stays valid', async () => {
  for (const role of ['SALES', 'SALES_MANAGER']) {
    scenario(); current.state.actor.role = role
    if (role === 'SALES') current.state.customers[0].assignedSalesId = 'new-owner'
    else current.state.customers[0].managerId = null
    const before = clone(current.state)
    assert.equal((await run()).kind, 'error')
    assert.equal(calls('update').length, 0)
    untouched(before)
  }
})

test('bulk all-no-op validates complete scope but performs zero updates/audits/revalidation', async () => {
  scenario()
  const before = clone(current.state)
  assert.equal((await run({ customerIds: ['customer-c', 'customer-c'] })).kind, 'success')
  assert.equal(calls('customers').length, 1)
  assert.equal(calls('update').length, 0)
  assert.equal(calls('audits').length, 0)
  untouched(before)
})

test('mixed bulk updates only changed rows using exact priority/version/scope CAS and explicit business allowlist', async () => {
  scenario()
  const before = clone(current.state)
  const result = await run({ customerIds: ['customer-c', 'customer-b', 'customer-a', 'customer-a'], status: 'CLOSED', assignedSalesId: 'foreign',
    customerId: 'customer-foreign', actorId: 'admin', role: 'SUPER_ADMIN', nextContactAt: '2099-01-01', taskPriority: 'LOW', updatedAt: '1900-01-01' })
  assert.equal(result.kind, 'success')
  assert.deepEqual(calls('update')[0].args, {
    where: { AND: [{ assignedSalesId: 'actor-own' }, { OR: [
      { id: 'customer-a', priority: 'LOW', updatedAt: version }, { id: 'customer-b', priority: 'MEDIUM', updatedAt: version },
    ] }] }, data: { priority: 'HIGH' },
  })
  assert.deepEqual(current.state.customers.slice(0, 3).map((row) => row.priority), ['HIGH', 'HIGH', 'HIGH'])
  assert.equal(current.state.customers[2].updatedAt.getTime(), version.getTime())
  assert.deepEqual(current.paths, [...paths, '/sales/customers/customer-a', '/sales/customers/customer-b'])
  onlyPrioritiesChanged(before, ['customer-a', 'customer-b'])
})

test('bulk appends exactly one privacy-minimized audit per real change and retains historical audits', async () => {
  scenario()
  const before = clone(current.state)
  assert.equal((await run({ customerIds: ['customer-a', 'customer-b', 'customer-c'] })).kind, 'success')
  assert.equal(calls('audits').length, 1)
  assert.deepEqual(calls('audits')[0].args, { data: ['customer-a', 'customer-b'].map((id, index) => ({
    actorId: 'actor-own', action: 'CUSTOMER_BULK_PRIORITY_UPDATE', entityType: 'CustomerProfile', entityId: id,
    metadata: { customerId: id, previousPriority: index ? 'MEDIUM' : 'LOW', priority: 'HIGH', bulk: true },
  })) })
  assert.deepEqual(current.state.audits.slice(0, before.audits.length), before.audits)
  assert.equal(current.state.audits.length - before.audits.length, 2)
  assert.deepEqual(current.calls.map((call) => call.kind).slice(0, 7), ['auth', 'transaction', 'actor', 'customers', 'update', 'audits', 'commit'])
})

test('bulk update-count mismatch rolls back tentative changes before any audit or invalidation', async () => {
  for (const updateCount of [0, 1, 3]) {
    scenario({ updateCount })
    const before = clone(current.state)
    assert.equal((await run({ customerIds: ['customer-a', 'customer-b'] })).kind, 'error')
    assert.equal(calls('audits').length, 0)
    assert.equal(calls('rollback').length, 1)
    untouched(before)
  }
})

test('bulk transaction-time priority/version/scope changes fail exact CAS and roll back the entire batch', async () => {
  for (const field of ['priority', 'updatedAt', 'assignedSalesId']) {
    scenario({ beforeUpdate(state) { state.customers[0][field] = field === 'priority' ? 'MEDIUM' : field === 'updatedAt' ? new Date(version.getTime() + 1) : 'foreign-owner' } })
    const before = clone(current.state)
    assert.equal((await run({ customerIds: ['customer-a', 'customer-b'] })).kind, 'error')
    assert.equal(calls('audits').length, 0)
    untouched(before)
  }
})

test('bulk audit count mismatch and injected storage failures roll back all changes with generic safe feedback', async () => {
  const failure = new Error('MYSQL PRIVATE DIAGNOSTIC')
  for (const override of [{ auditCount: 0 }, { auditCount: 1 }, { auditError: failure }, { updateError: failure }, { transactionError: failure }]) {
    scenario(override)
    const before = clone(current.state)
    const result = await run({ customerIds: ['customer-a', 'customer-b'] })
    assert.equal(result.kind, 'error')
    assert.equal(result.message.includes('MYSQL'), false)
    assert.equal(calls('rollback').length, 1)
    untouched(before)
  }
})

test('maximum valid bulk selection performs one bounded fetch/update/audit batch and exactly 100 change audits', async () => {
  scenario(); current.state.customers = Array.from({ length: 100 }, (_, index) => customer(`customer-${String(index).padStart(3, '0')}`))
  const before = clone(current.state)
  const ids = current.state.customers.map((row) => row.id)
  assert.equal((await run({ customerIds: ids })).kind, 'success')
  assert.equal(calls('customers').length, 1)
  assert.equal(calls('update').length, 1)
  assert.equal(calls('update')[0].args.where.AND[1].OR.length, 100)
  assert.equal(calls('audits').length, 1)
  assert.equal(calls('audits')[0].args.data.length, 100)
  assert.equal(current.state.audits.length - before.audits.length, 100)
  assert.equal(current.paths.length, paths.length + 100)
  onlyPrioritiesChanged(before, ids)
})

test('export route authenticates sales:read before invalid filters and HEAD never generates CSV/audit', async () => {
  const authError = new Error('Auth redirect')
  scenario({ authError })
  await assert.rejects(exportRequest('priority=INVALID'), (error) => error === authError)
  assert.deepEqual(current.calls, [{ kind: 'auth', args: 'sales:read' }])
  current.calls = []
  const response = HEAD()
  assert.equal(response.status, 405)
  assert.equal(response.headers.get('allow'), 'GET')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(await response.text(), '')
  assert.deepEqual(current.calls, [])
})

test('export invalid/repeated substantive filters fail before database counts and never return CSV or echoed query', async () => {
  for (const query of ['priority=PRIVATE_INVALID', 'q=PRIVATE%0AQUERY', 'priority=HIGH&priority=HIGH', 'salesId=../PRIVATE', 'teamId=a&teamId=b']) {
    scenario()
    const before = clone(current.state)
    const response = await exportRequest(query)
    assert.equal(response.status, 400)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('content-disposition'), null)
    assert.equal((await response.text()).includes('PRIVATE'), false)
    assert.deepEqual(current.calls.map((call) => call.kind), ['auth'])
    untouched(before)
  }
})

test('export current actor validation denies missing, inactive and all forbidden roles before count/query', async () => {
  for (const actor of [null, ...['SUSPENDED', 'DISABLED', 'INVITED'].map((status) => ({ id: 'actor-own', role: 'SALES', status })),
    ...['CLIENT', 'CREATOR', 'ANALYST', 'EMPLOYEE'].map((role) => ({ id: 'actor-own', role, status: 'ACTIVE' }))]) {
    scenario(); current.state.actor = actor
    const before = clone(current.state)
    const response = await exportRequest()
    assert.equal(response.status, 403)
    assert.equal(calls('count').length, 0)
    assert.equal(calls('customers').length, 0)
    assert.equal(response.headers.get('content-disposition'), null)
    untouched(before)
  }
})

test('export all five read roles derive fresh customer scope, never task assignee or stale session role', async () => {
  for (const role of ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SALES_MANAGER', 'SALES']) {
    scenario(); current.state.actor.role = role; current.session.user.role = 'CLIENT'
    const response = await exportRequest()
    const csv = await csvText(response)
    const global = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(role)
    assert.equal(response.status, 200)
    assert.equal(csv.includes('code-customer-foreign'), global)
    assert.equal(calls('audit')[0].args.data.metadata.rowCount, global ? 4 : 3)
    const scope = role === 'SALES' ? { assignedSalesId: 'actor-own' } : role === 'SALES_MANAGER'
      ? { assignedSales: { salesMemberships: { some: { team: { managerId: 'actor-own' } } } } } : {}
    assert.deepEqual(calls('count')[0].args.where, { AND: [scope, { AND: [] }] })
    assert.deepEqual(calls('transaction')[0].args, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 })
  }
})

test('foreign Sales/team filters intersect authorization and return identical safe empty exports for absent scopes', async () => {
  for (const query of ['salesId=foreign-owner', 'salesId=missing-owner', 'teamId=foreign-team', 'teamId=missing-team']) {
    scenario()
    const response = await exportRequest(query)
    const csv = await csvText(response)
    assert.equal(response.status, 200)
    assert.equal(csv.split('\r\n').length, 2)
    assert.equal(csv.includes('customer-foreign'), false)
    assert.equal(calls('audit')[0].args.data.metadata.rowCount, 0)
    assert.deepEqual(calls('count')[0].args.where.AND[0], { assignedSalesId: 'actor-own' })
  }
})

test('completed reassignment/team removal immediately reduces export scope and never retains a stale customer row', async () => {
  for (const role of ['SALES', 'SALES_MANAGER']) {
    scenario(); current.state.actor.role = role
    if (role === 'SALES') current.state.customers[0].assignedSalesId = 'new-owner'
    else current.state.customers[0].managerId = null
    const response = await exportRequest()
    assert.equal(response.status, 200)
    const csv = await csvText(response)
    assert.equal(csv.includes('code-customer-a'), false)
    assert.equal(csv.includes('code-customer-b'), true)
    assert.equal(calls('audit')[0].args.data.metadata.rowCount, 2)
  }
})

test('export bounded fetch uses exact minimized select and list ordering after count, ignoring page/unknown input', async () => {
  scenario()
  const response = await exportRequest('priority=%20HIGH%20&page=3&page=INVALID&unknown=PRIVATE')
  assert.equal(response.status, 200)
  const where = { AND: [{ assignedSalesId: 'actor-own' }, { AND: [{ priority: 'HIGH' }] }] }
  assert.deepEqual(calls('count')[0].args, { where })
  assert.deepEqual(calls('customers')[0].args, { where, select: exportSelect, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 5000 })
  assert.equal(calls('customers').length, 1)
  assert.deepEqual(current.calls.map((call) => call.kind), ['auth', 'transaction', 'actor', 'count', 'customers', 'audit', 'commit'])
  assert.deepEqual(current.paths, [])
})

test('export emits exact nine columns, UTC dates, safe cells and no selected-out private fields or internal IDs', async () => {
  scenario(); current.state.customers = [customer('customer-a')]
  const row = current.state.customers[0]
  row.customerCode = '=code'; row.user.name = 'Nguyễn, "Ánh" 🙂'; row.user.email = '+mail@example.test'; row.assignedSales.name = '@sales'
  const response = await exportRequest()
  assert.equal(response.headers.get('content-type'), 'text/csv; charset=utf-8')
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="lkc-customers.csv"')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  const csv = await csvText(response)
  assert.equal(csv, '\uFEFF"customerCode","name","email","status","priority","assignedSalesName","lastContactAt","nextContactAt","createdAt"\r\n"\'=code","Nguyễn, ""Ánh"" 🙂","\'+mail@example.test","LEAD","LOW","\'@sales","2020-01-01T00:00:00.000Z","","2025-01-01T00:00:00.000Z"\r\n')
  for (const forbidden of ['PRIVATE', 'PASSWORD', 'internal-sales-id', 'user-customer-a', 'priorityTask', 'historical-audit']) assert.equal(csv.includes(forbidden), false)
})

test('export audit is one aggregate with null entityId and exact count/filter/format only; business data stays unchanged', async () => {
  for (const query of ['', 'priority=HIGH', 'page=3&unknown=PRIVATE']) {
    scenario()
    const before = clone(current.state)
    assert.equal((await exportRequest(query)).status, 200)
    assert.equal(calls('audit').length, 1)
    assert.deepEqual(calls('audit')[0].args, { data: {
      actorId: 'actor-own', action: 'CUSTOMER_CSV_EXPORT', entityType: 'CustomerProfile', entityId: null,
      metadata: { rowCount: query === 'priority=HIGH' ? 1 : 3, filtersActive: query === 'priority=HIGH', format: 'csv' },
    } })
    const stable = clone(current.state); stable.audits = before.audits
    assert.deepEqual(stable, before)
    assert.deepEqual(current.state.audits.slice(0, before.audits.length), before.audits)
    assert.deepEqual(current.paths, [])
  }
})

test('export permits exactly 5000 rows and rejects over-cap before fetch/audit without partial CSV', async () => {
  scenario(); current.state.customers = Array.from({ length: 5000 }, (_, index) => customer(`customer-${index}`))
  const accepted = await exportRequest()
  assert.equal(accepted.status, 200)
  assert.equal((await csvText(accepted)).split('\r\n').length, 5002)
  assert.equal(calls('audit')[0].args.data.metadata.rowCount, 5000)
  scenario({ exportCount: 5001 })
  const before = clone(current.state)
  const rejected = await exportRequest()
  assert.equal(rejected.status, 413)
  assert.equal(rejected.headers.get('content-disposition'), null)
  assert.equal((await rejected.text()).includes('5001'), false)
  assert.equal(calls('customers').length, 0)
  assert.equal(calls('audit').length, 0)
  untouched(before)
})

test('export count/fetch mismatch and database/audit failures never release CSV or diagnostics and roll back', async () => {
  const failure = new Error('PRIVATE MYSQL FAILURE')
  for (const override of [{ exportCount: 2 }, { exportCount: 4 }, { countError: failure }, { fetchError: failure }, { auditError: failure }, { transactionError: failure }]) {
    scenario(override)
    const before = clone(current.state)
    const response = await customerExportResponse('actor-own', new URLSearchParams())
    assert.equal(response.status, override.exportCount ? 409 : 503)
    assert.equal(response.headers.get('content-disposition'), null)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const body = await response.text()
    for (const forbidden of ['PRIVATE', 'MYSQL', 'customer-a', 'customerCode']) assert.equal(body.includes(forbidden), false)
    assert.equal(calls('rollback').length, 1)
    untouched(before)
  }
})
