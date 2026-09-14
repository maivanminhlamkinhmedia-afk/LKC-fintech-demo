import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Prisma } from '@prisma/client'
import ts from 'typescript'

// Execute the real DAL/registry/parser against a read-only in-memory adapter.
// Storage isolation and authenticated HTTP behavior are separate integration tests.
const sourceRoot = new URL('../src/', import.meta.url)
const crmRoot = new URL('features/crm/', sourceRoot)
const queryUrl = new URL('audit-queries.ts', crmRoot).href
const timelineUrl = new URL('components/AuditTimeline.tsx', crmRoot).href
const filtersFormUrl = new URL('components/AuditFiltersForm.tsx', crmRoot).href
const bridgeKey = Symbol.for('crm-audit-query-test-adapter')
const clone = (value) => structuredClone(value)
let current
const record = (kind, args) => current.calls.push({ kind, ...(args === undefined ? {} : { args: clone(args) }) })
class Redirect extends Error { constructor(path) { super(`Redirect ${path}`); this.path = path } }
function matches(row, where) {
  if (where.AND && !where.AND.every((clause) => matches(row, clause))) return false
  for (const [key, value] of Object.entries(where)) {
    if (key === 'AND') continue
    if (key === 'createdAt') {
      if (value.gte && row.createdAt < value.gte) return false
      if (value.lt && row.createdAt >= value.lt) return false
    } else if (value && typeof value === 'object' && 'in' in value) {
      if (!value.in.includes(row[key])) return false
    } else if (row[key] !== value) return false
  }
  return true
}
function project(row, select) {
  if (row === null || row === undefined) return null
  return Object.fromEntries(Object.entries(select).map(([key, value]) => [key, value === true ? clone(row[key]) : project(row[key], value.select)]))
}
function sqlRows(query) {
  if (query.sql.includes('1 = 0')) return []
  const dateIndex = query.values.findIndex((value) => value instanceof Date)
  assert.ok(dateIndex > 0, 'Every audit SQL query must include an explicit action registry and bounded dates')
  const actions = query.values.slice(0, dateIndex)
  const start = query.values[dateIndex]
  const end = query.values[dateIndex + 1]
  const actorId = query.sql.includes('AND BINARY a.actorId = ?') ? query.values[dateIndex + 2] : undefined
  return current.state.audits.filter((row) => actions.includes(row.action) && row.createdAt >= start && row.createdAt < end
    && (actorId === undefined || row.actorId === actorId))
}
const adapter = {
  Link({ children, prefetch, ...props }) { void prefetch; return createElement('a', props, children) },
  redirect(path) {
    assert.equal(current.inTransaction, false, 'Redirect must not be swallowed in a transaction catch')
    record('redirect', path)
    throw new Redirect(path)
  },
  async requireRole(roles) {
    record('auth', roles)
    if (current.authError) throw current.authError
    if (!current.session?.user?.id) adapter.redirect('/dang-nhap')
    if (!roles.includes(current.session.user.role)) adapter.redirect('/dashboard')
    return clone(current.session)
  },
  forbiddenRevalidation() { record('FORBIDDEN_REVALIDATION'); throw new Error('Read-only audit console cannot revalidate') },
  prisma: {
    async $transaction(callback, options) {
      record('transaction', options)
      const before = clone(current.state)
      current.inTransaction = true
      const forbidden = async () => { record('FORBIDDEN_WRITE'); throw new Error('Read-only audit console cannot write') }
      const forbiddenBusiness = new Proxy({}, { get() { return forbidden } })
      const tx = {
        async $queryRaw(query) {
          const args = { sql: query.sql, values: query.values }
          if (query.sql.startsWith('SELECT COUNT(*) AS total')) {
            record('count', args)
            if (current.countError) throw current.countError
            return current.countRows ?? [{ total: current.total ?? BigInt(sqlRows(query).length) }]
          }
          if (query.sql.startsWith('SELECT a.id')) {
            record('ids', args)
            if (current.idsError) throw current.idsError
            const [take, skip] = query.values.slice(-2)
            return current.idRows ?? (current.records ?? sqlRows(query))
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
              .slice(skip, skip + take).map((row) => ({ id: row.id }))
          }
          if (query.sql.startsWith('SELECT u.id, u.name')) {
            record('actorOptions', args)
            if (current.optionsError) throw current.optionsError
            const rows = sqlRows(query)
            return current.state.users.filter((entry) => rows.some((row) => row.actorId === entry.id))
              .sort((a, b) => a.id.localeCompare(b.id)).slice(0, query.values.at(-1))
              .map((entry) => ({ id: entry.id, name: entry.name }))
          }
          throw new Error('Unexpected raw query in read-only audit adapter')
        },
        user: {
          async findUnique(args) {
            record('actor', args)
            if (current.actorError) throw current.actorError
            const actor = current.state.actor
            return actor?.id === args.where.id ? project(actor, args.select) : null
          },
          findMany: forbidden,
          create: forbidden, createMany: forbidden, update: forbidden, updateMany: forbidden, delete: forbidden, deleteMany: forbidden, upsert: forbidden,
        },
        auditLog: {
          count: forbidden,
          async findMany(args) {
            record('records', args)
            if (current.recordsError) throw current.recordsError
            const rows = current.records ?? current.state.audits.filter((audit) => matches(audit, args.where))
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
              .slice(0, args.take)
            return rows.map((row) => project({ ...row, actor: row.actorId === null ? null : current.state.users.find((user) => user.id === row.actorId) ?? null }, args.select))
          },
          create: forbidden, createMany: forbidden, update: forbidden, updateMany: forbidden, delete: forbidden, deleteMany: forbidden, upsert: forbidden,
        },
        customerProfile: forbiddenBusiness, customerTask: forbiddenBusiness, customerActivity: forbiddenBusiness,
        salesTeam: forbiddenBusiness, salesTeamMember: forbiddenBusiness, $executeRaw: forbidden, $executeRawUnsafe: forbidden, $queryRawUnsafe: forbidden,
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
const adapterModule = (exports) => `data:text/javascript,${encodeURIComponent(`const adapter = globalThis[Symbol.for('crm-audit-query-test-adapter')]; ${exports}`)}`
const substitutes = new Map([
  ['@/lib/authz', adapterModule('export const requireRole = adapter.requireRole;')],
  ['@/lib/prisma', adapterModule('export const prisma = adapter.prisma;')],
  ['next/navigation', adapterModule('export const redirect = adapter.redirect;')],
  ['next/cache', adapterModule('export const revalidatePath = adapter.forbiddenRevalidation;')],
  ['next/link', adapterModule('export default adapter.Link;')],
  ['server-only', 'data:text/javascript,export {};'],
])
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (substitutes.has(specifier)) return nextResolve(substitutes.get(specifier), context)
    if (specifier.startsWith('@/')) return nextResolve(new URL(`${specifier.slice(2)}.ts`, sourceRoot).href, context)
    if (context.parentURL?.startsWith(crmRoot.href) && /^\.\/[\w-]+$/.test(specifier)) return nextResolve(`${specifier}.ts`, context)
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if ([timelineUrl, filtersFormUrl].includes(url)) {
      const source = ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
      } }).outputText
      return { format: 'module', shortCircuit: true, source }
    }
    return nextLoad(url, context)
  },
})
let getCRMAudit, parseAuditFilters, auditWhere, CRM_AUDIT_REGISTRY, AuditTimeline, AuditFiltersForm
try {
  ({ getCRMAudit } = await import(queryUrl));
  ({ parseAuditFilters, auditWhere } = await import(new URL('audit-filters.ts', crmRoot)));
  ({ CRM_AUDIT_REGISTRY } = await import(new URL('audit-registry.ts', crmRoot)));
  ({ AuditTimeline } = await import(timelineUrl));
  ({ AuditFiltersForm } = await import(filtersFormUrl))
} finally { hook.deregister(); delete globalThis[bridgeKey] }

const now = new Date('2026-09-14T05:00:00.000Z')
const createdAt = new Date('2026-09-14T04:00:00.000Z')
function user(id, role = 'ADMIN', name = `Name ${id}`) {
  return { id, name, email: 'PRIVATE EMAIL', password: 'PRIVATE PASSWORD', status: 'ACTIVE', role, phone: 'PRIVATE PHONE' }
}
function audit(id, overrides = {}) {
  return { id, actorId: 'actor-own', createdAt: clone(createdAt), action: 'CUSTOMER_PROFILE_UPDATE', entityType: 'CustomerProfile', entityId: 'customer-own',
    metadata: { status: 'ACTIVE', priority: 'HIGH', note: 'PRIVATE NOTE', token: 'PRIVATE TOKEN' }, ipAddress: 'PRIVATE IP', ...overrides }
}
function scenario(overrides = {}) {
  current = {
    state: {
      actor: user('actor-own'), users: [user('actor-own'), user('actor-other', 'SALES'), user('actor-auth-only', 'CLIENT')],
      audits: [audit('audit-a'), audit('audit-z', { actorId: 'actor-other' }), audit('audit-excluded', { actorId: 'actor-auth-only', action: 'AUTH_LOGIN', entityType: 'User', entityId: 'actor-auth-only', metadata: null })],
      customers: [{ id: 'customer-own', priority: 'HIGH', nextContactAt: 'PRIVATE CONTACT', lastContactAt: 'PRIVATE CONTACT' }],
      tasks: [{ id: 'task-own', title: 'PRIVATE TASK', priority: 'URGENT' }], activities: [{ content: 'PRIVATE ACTIVITY' }], teams: [{ name: 'PRIVATE TEAM' }], memberships: [{ userId: 'actor-other' }],
    },
    session: { user: { id: 'actor-own', role: 'ADMIN' } }, calls: [], inTransaction: false, ...overrides,
  }
  return current
}
const calls = (kind) => current.calls.filter((call) => call.kind === kind)
const run = (params = {}, instant = now) => getCRMAudit(params, instant)
function unchanged(before) {
  assert.deepEqual(current.state, before)
  assert.equal(calls('FORBIDDEN_WRITE').length, 0)
  assert.equal(calls('FORBIDDEN_REVALIDATION').length, 0)
}
function noAuditReads() {
  for (const kind of ['count', 'ids', 'records', 'actorOptions']) assert.equal(calls(kind).length, 0)
}
const selectedAudit = { id: true, createdAt: true, actorId: true, action: true, entityType: true, entityId: true, metadata: true, actor: { select: { id: true, name: true } } }

test('audit DAL independently authenticates exact two-role policy before parsing or any database access', async () => {
  const authError = new Error('Auth redirect sentinel')
  scenario({ authError })
  const before = clone(current.state)
  await assert.rejects(run({ action: 'PRIVATE_INVALID' }), (error) => error === authError)
  assert.deepEqual(current.calls, [{ kind: 'auth', args: ['SUPER_ADMIN', 'ADMIN'] }])
  unchanged(before)
})

test('all seven non-audit roles and anonymous callers are blocked before transaction/actor/options/count', async () => {
  for (const role of ['MANAGER', 'SALES_MANAGER', 'SALES', 'CLIENT', 'CREATOR', 'ANALYST', 'EMPLOYEE']) {
    scenario(); current.session.user.role = role
    const before = clone(current.state)
    await assert.rejects(run(), (error) => error instanceof Redirect && error.path === '/dashboard')
    assert.deepEqual(current.calls.map((call) => call.kind), ['auth', 'redirect'])
    unchanged(before)
  }
  scenario({ session: null })
  await assert.rejects(run(), (error) => error instanceof Redirect && error.path === '/dang-nhap')
  assert.equal(calls('transaction').length, 0)
})

test('fresh transaction actor denies every demoted role even when a stale privileged session passed outer auth', async () => {
  for (const role of ['MANAGER', 'SALES_MANAGER', 'SALES', 'CLIENT', 'CREATOR', 'ANALYST', 'EMPLOYEE']) {
    scenario(); current.state.actor.role = role
    const before = clone(current.state)
    await assert.rejects(run(), (error) => error instanceof Redirect && error.path === '/dashboard')
    assert.deepEqual(current.calls.map((call) => call.kind), ['auth', 'transaction', 'actor', 'commit', 'redirect'])
    noAuditReads()
    unchanged(before)
  }
})

test('missing/deleted/inactive current actor redirects to login outside transaction catch, with no audit reads', async () => {
  for (const actor of [null, ...['INVITED', 'SUSPENDED', 'DISABLED'].map((status) => ({ ...user('actor-own'), status }))]) {
    scenario(); current.state.actor = actor
    const before = clone(current.state)
    await assert.rejects(run({ actorId: 'actor-other' }), (error) => error instanceof Redirect && error.path === '/dang-nhap')
    noAuditReads()
    assert.equal(calls('rollback').length, 0)
    unchanged(before)
  }
})

test('both current privileged roles can read even when session role differs, without altering any model', async () => {
  for (const role of ['SUPER_ADMIN', 'ADMIN']) {
    scenario(); current.state.actor.role = role; current.session.user.role = role === 'ADMIN' ? 'SUPER_ADMIN' : 'ADMIN'
    const before = clone(current.state)
    const result = await run()
    assert.equal(result.error, null)
    assert.equal(result.total, 2)
    assert.equal(result.rows.length, 2)
    assert.deepEqual(calls('actor')[0].args, { where: { id: 'actor-own' }, select: { id: true, role: true, status: true } })
    assert.deepEqual(calls('transaction')[0].args, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 })
    assert.deepEqual(current.calls.map((call) => call.kind), ['auth', 'transaction', 'actor', 'count', 'ids', 'records', 'actorOptions', 'commit'])
    unchanged(before)
  }
})

test('every invalid/repeated supported filter permits only fresh actor check and suppresses all audit/options queries', async () => {
  for (const params of [
    { period: 'ALL' }, { action: 'CUSTOMER_UNKNOWN' }, { category: 'unknown' }, { actorId: '../PRIVATE' }, { page: '1001' },
    { period: 'custom', from: '2026-02-30', to: '2026-09-14' }, { period: 'custom', from: '2024-01-01', to: '2025-01-01' },
    ...Object.entries({ period: '7d', from: '2026-09-01', to: '2026-09-14', action: 'CUSTOMER_PROFILE_UPDATE', category: 'CUSTOMER', actorId: 'actor-own', page: '1' }).map(([key, value]) => ({ [key]: [value, value] })),
  ]) {
    scenario()
    const before = clone(current.state)
    const result = await run(params)
    assert.ok(result.invalidKeys.length > 0)
    assert.equal(result.error, null)
    assert.equal(result.total, 0)
    assert.deepEqual(result.rows, [])
    assert.deepEqual(result.actors, [])
    assert.deepEqual(current.calls.map((call) => call.kind), ['auth', 'transaction', 'actor', 'commit'])
    unchanged(before)
  }
  scenario()
  const result = await run({}, new Date('invalid'))
  assert.deepEqual(result.invalidKeys, ['period'])
  noAuditReads()
})

test('malformed filters never bypass fresh role/status denial', async () => {
  scenario(); current.state.actor.role = 'SALES'
  await assert.rejects(run({ action: 'INVALID' }), (error) => error instanceof Redirect && error.path === '/dashboard')
  noAuditReads()
  scenario(); current.state.actor.status = 'DISABLED'
  await assert.rejects(run({ page: 'INVALID' }), (error) => error instanceof Redirect && error.path === '/dang-nhap')
  noAuditReads()
})

test('valid query uses exact minimized select, newest-first deterministic order and bounded 50-row fetch', async () => {
  scenario()
  const params = { period: 'custom', from: '2026-09-01', to: '2026-09-14', action: 'CUSTOMER_PROFILE_UPDATE', category: 'CUSTOMER', actorId: 'actor-other' }
  const parsed = parseAuditFilters(params, now)
  const result = await run(params)
  const where = auditWhere(parsed.filters, parsed.range)
  const predicate = 'BINARY a.action IN (?) AND a.createdAt >= ? AND a.createdAt < ? AND BINARY a.actorId = ?'
  const normalize = (sql) => sql.replace(/\s+/g, ' ').trim()
  const values = ['CUSTOMER_PROFILE_UPDATE', parsed.range.startUtc, parsed.range.endExclusiveUtc, 'actor-other']
  assert.equal(normalize(calls('count')[0].args.sql), `SELECT COUNT(*) AS total FROM AuditLog a WHERE ${predicate}`)
  assert.deepEqual(calls('count')[0].args.values, values)
  assert.equal(normalize(calls('ids')[0].args.sql), `SELECT a.id FROM AuditLog a WHERE ${predicate} ORDER BY a.createdAt DESC, a.id DESC LIMIT ? OFFSET ?`)
  assert.deepEqual(calls('ids')[0].args.values, [...values, 50, 0])
  assert.deepEqual(calls('records')[0].args, { where: { AND: [where, { id: { in: ['audit-z'] } }] }, select: selectedAudit, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50 })
  assert.equal(normalize(calls('actorOptions')[0].args.sql), 'SELECT u.id, u.name FROM User u WHERE EXISTS (SELECT 1 FROM AuditLog a WHERE a.actorId = u.id AND BINARY a.action IN (?) AND a.createdAt >= ? AND a.createdAt < ? ) ORDER BY u.id ASC LIMIT ?')
  assert.deepEqual(calls('actorOptions')[0].args.values, values.slice(0, -1).concat(200))
  assert.equal(result.total, 1)
  assert.deepEqual(result.rows.map((row) => row.id), ['audit-z'])
  assert.deepEqual(result.actors.map((actor) => actor.id), ['actor-other', 'actor-own'])
})

test('page count clamps requested valid pages, hard-caps history at 1000 pages and never skips over 49950', async () => {
  for (const [total, requested, page, pageCount, historyCapped] of [
    [0, 1000, 1, 1, false], [1, 1000, 1, 1, false], [50, 1000, 1, 1, false], [51, 1000, 2, 2, false],
    [49999, 1000, 1000, 1000, false], [50000, 1000, 1000, 1000, false], [50001, 1000, 1000, 1000, true], [1000000, 1000, 1000, 1000, true],
  ]) {
    scenario({ total })
    const result = await run({ page: String(requested) })
    assert.equal(result.total, total)
    assert.equal(result.page, page)
    assert.equal(result.pageCount, pageCount)
    assert.equal(result.historyCapped, historyCapped)
    assert.equal(result.error, null)
    assert.equal(calls('ids')[0].args.values.at(-1), (page - 1) * 50)
    assert.ok(calls('ids')[0].args.values.at(-1) <= 49950)
    assert.equal('skip' in calls('records')[0].args, false)
    assert.equal(calls('records')[0].args.take, 50)
  }
})

test('50-row pages keep timestamp ties stable by descending audit ID without row overlap', async () => {
  scenario(); current.state.audits = Array.from({ length: 51 }, (_, index) => audit(`audit-${String(index).padStart(3, '0')}`))
  const first = await run()
  const second = await run({ page: '2' })
  assert.equal(first.rows.length, 50)
  assert.equal(second.rows.length, 1)
  assert.equal(first.rows[0].id, 'audit-050')
  assert.equal(first.rows.at(-1).id, 'audit-001')
  assert.equal(second.rows[0].id, 'audit-000')
  assert.equal(new Set([...first.rows, ...second.rows].map((row) => row.id)).size, 51)
})

test('actor options are capped at 200 and derived only from matching CRM history, never arbitrary URL lookup', async () => {
  scenario()
  current.state.users = Array.from({ length: 201 }, (_, index) => user(`history-${String(index).padStart(3, '0')}`, 'SALES'))
  current.state.audits = current.state.users.map((entry, index) => audit(`audit-${index}`, { actorId: entry.id }))
  current.state.users.push(user('not-in-history'), user('auth-only'))
  current.state.audits.push(audit('auth-only-event', { actorId: 'auth-only', action: 'AUTH_LOGIN', entityType: 'User', metadata: null }))
  const result = await run({ actorId: 'nonexistent-arbitrary-id' })
  assert.equal(result.total, 0)
  assert.equal(result.rows.length, 0)
  assert.equal(result.actors.length, 200)
  assert.equal(result.actors[0].id, 'history-000')
  assert.equal(result.actors.at(-1).id, 'history-199')
  assert.ok(result.actors.every((entry) => Object.keys(entry).sort().join(',') === 'id,name'))
  assert.deepEqual(calls('actor').map((call) => call.args.where.id), ['actor-own'])
  assert.equal(JSON.stringify(calls('actorOptions')[0].args).includes('nonexistent-arbitrary-id'), false)
})

test('action/category/date restrictions narrow actor options as well as events, excluding account-only actors', async () => {
  scenario()
  current.state.audits.push(audit('task-event', { actorId: 'actor-other', action: 'CUSTOMER_TASK_CREATE', entityType: 'CustomerTask', entityId: 'task-own', metadata: { customerId: 'customer-own', priority: 'HIGH' } }))
  const task = await run({ category: 'TASK' })
  assert.deepEqual(task.rows.map((row) => row.id), ['task-event'])
  assert.deepEqual(task.actors.map((row) => row.id), ['actor-other'])
  const mismatched = await run({ category: 'TASK', action: 'CUSTOMER_PROFILE_UPDATE' })
  assert.equal(mismatched.total, 0)
  assert.deepEqual(mismatched.actors, [])
  const past = await run({ period: 'custom', from: '2020-01-01', to: '2020-01-02' })
  assert.equal(past.total, 0)
  assert.deepEqual(past.actors, [])
})

test('date predicates include selected Vietnam midnight and exclude next midnight consistently in count/rows/options', async () => {
  scenario()
  const start = new Date('2026-09-13T17:00:00.000Z')
  const end = new Date('2026-09-14T17:00:00.000Z')
  current.state.audits = [
    audit('before', { createdAt: new Date(start.getTime() - 1) }), audit('start', { createdAt: start }),
    audit('last', { createdAt: new Date(end.getTime() - 1) }), audit('end', { createdAt: end }),
  ]
  const result = await run({ period: 'custom', from: '2026-09-14', to: '2026-09-14' })
  assert.equal(result.total, 2)
  assert.deepEqual(result.rows.map((row) => row.id), ['last', 'start'])
})

test('DTO strips raw metadata/IP/User security fields and enriches no customer/task/team/activity records', async () => {
  scenario()
  const before = clone(current.state)
  const result = await run()
  assert.equal(result.error, null)
  assert.equal(result.rows.length, 2)
  for (const row of result.rows) {
    assert.deepEqual(Object.keys(row).sort(), ['action', 'actor', 'category', 'createdAt', 'customerHref', 'entityId', 'entityType', 'id', 'label', 'summary'])
    assert.deepEqual(Object.keys(row.actor).sort(), ['id', 'name'])
    assert.deepEqual(row.summary.map((field) => field.key), ['status', 'priority'])
    assert.equal(row.customerHref, '/sales/customers/customer-own')
  }
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
  unchanged(before)
})

test('null actors and deleted/missing linked users keep safe historical rows without arbitrary user/business lookups', async () => {
  for (const actorId of [null, 'deleted-actor']) {
    scenario(); current.state.audits = [audit('historical', { actorId })]
    const result = await run()
    assert.equal(result.rows.length, 1)
    assert.equal(result.rows[0].actor, null)
    assert.deepEqual(result.actors, [])
    assert.equal(calls('actor').length, 1)
  }
  scenario(); current.state.audits = [audit('membership-removed', {
    action: 'SALES_TEAM_MEMBER_REMOVE', entityType: 'SalesTeamMember', entityId: 'already-deleted-membership',
    metadata: { teamId: 'old-team', userId: 'sales-own', assignedCustomerCount: 2, nonClosedCustomerCount: 1, confirmationUsed: true },
  })]
  const result = await run()
  assert.equal(result.rows[0].entityId, 'already-deleted-membership')
  assert.equal(result.rows[0].customerHref, null)
  assert.equal(result.rows[0].summary.length, 5)
})

test('aggregate export retains null entity identity even with forged historical entityId/customerId metadata', async () => {
  scenario(); current.state.audits = [audit('export', { action: 'CUSTOMER_CSV_EXPORT', entityId: 'FORGED_CUSTOMER',
    metadata: { rowCount: 42, filtersActive: true, format: 'csv', customerId: 'PRIVATE_CUSTOMER', q: 'PRIVATE_QUERY', csv: 'PRIVATE_BODY' } })]
  const result = await run()
  const row = result.rows[0]
  assert.equal(row.entityType, 'CustomerProfile')
  assert.equal(row.entityId, null)
  assert.equal(row.customerHref, null)
  assert.deepEqual(row.summary.map((field) => field.key), ['rowCount', 'filtersActive', 'format'])
  assert.equal(JSON.stringify(result).includes('FORGED_CUSTOMER'), false)
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
})

test('wrong entity type and malformed entity IDs cannot produce raw entity displays or customer links', async () => {
  scenario(); current.state.audits = [audit('wrong-type', { entityType: '<script>PRIVATE TYPE</script>', entityId: 'customer-own' })]
  let result = await run()
  assert.equal(result.rows[0].entityType, 'Unknown')
  assert.equal(result.rows[0].entityId, null)
  assert.deepEqual(result.rows[0].summary, [])
  assert.equal(result.rows[0].customerHref, null)
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
  for (const entityId of ['../foreign', 'a/b', 'id\n', 'x'.repeat(192), null]) {
    scenario(); current.state.audits = [audit('wrong-id', { entityId })]
    result = await run()
    assert.equal(result.rows[0].entityId, null)
    assert.equal(result.rows[0].customerHref, null)
  }
})

test('task history links to validated metadata customer ID while malformed metadata remains a safe empty summary', async () => {
  scenario(); current.state.audits = [audit('task-created', { action: 'CUSTOMER_TASK_CREATE', entityType: 'CustomerTask', entityId: 'task-own', metadata: { customerId: 'customer-own', priority: 'URGENT', title: 'PRIVATE TASK TITLE' } })]
  let result = await run()
  assert.equal(result.rows[0].customerHref, '/sales/customers/customer-own')
  assert.equal(result.rows[0].entityId, 'task-own')
  for (const metadata of [null, [], 'PRIVATE RAW JSON', 1, true, { customerId: '../PRIVATE', priority: '<script>PRIVATE</script>' }]) {
    scenario(); current.state.audits = [audit('task-created', { action: 'CUSTOMER_TASK_CREATE', entityType: 'CustomerTask', entityId: 'task-own', metadata })]
    result = await run()
    assert.deepEqual(result.rows[0].summary, [])
    assert.equal(result.rows[0].customerHref, null)
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
  }
})

test('case-collation or unregistered actions returned by database fail the entire page closed with generic feedback', async () => {
  for (const action of ['customer_profile_update', 'CUSTOMER_PROFILE_UPDATE ', 'CUSTOMER_FUTURE_PRIVATE', 'AUTH_LOGIN']) {
    scenario({ records: [audit('unsafe', { action })] })
    const before = clone(current.state)
    const result = await run()
    assert.ok(result.error)
    assert.deepEqual(result.rows, [])
    assert.deepEqual(result.actors, [])
    assert.equal(result.total, 0)
    assert.equal(result.error.includes(action), false)
    assert.equal(calls('rollback').length, 1)
    unchanged(before)
  }
})

test('binary predicates exclude unknown/case/space action variants from totals, pages and actor choices before mapping', async () => {
  scenario()
  current.state.users.push(user('variant-only', 'SALES'))
  current.state.audits = [audit('registered'), ...['customer_profile_update', 'CUSTOMER_PROFILE_UPDATE ', 'CUSTOMER_UNKNOWN', 'AUTH_LOGIN'].map((action, index) =>
    audit(`variant-${index}`, { actorId: 'variant-only', action, createdAt: new Date('2026-09-14T04:59:00.000Z') }))]
  const result = await run()
  assert.equal(result.error, null)
  assert.equal(result.total, 1)
  assert.deepEqual(result.rows.map((row) => row.id), ['registered'])
  assert.deepEqual(result.actors.map((row) => row.id), ['actor-own'])
  for (const kind of ['count', 'ids', 'actorOptions']) assert.ok(calls(kind)[0].args.sql.includes('BINARY a.action IN'))
  assert.deepEqual(calls('records')[0].args.where.AND[1], { id: { in: ['registered'] } })
})

test('unsafe or missing raw count results fail closed before page IDs, records or actor queries', async () => {
  for (const countRows of [[], [{ total: -1n }], [{ total: 1.5 }], [{ total: 9007199254740992n }], [{ total: NaN }], [{ total: undefined }]]) {
    scenario({ countRows })
    const before = clone(current.state)
    const result = await run()
    assert.ok(result.error)
    assert.equal(result.total, 0)
    assert.deepEqual(result.rows, [])
    assert.deepEqual(result.actors, [])
    for (const kind of ['ids', 'records', 'actorOptions']) assert.equal(calls(kind).length, 0)
    unchanged(before)
  }
})

test('ID-page and ORM-record count mismatch returns no partial history or actor choices', async () => {
  scenario({ idRows: [{ id: 'missing-historical-record' }] })
  const before = clone(current.state)
  const result = await run()
  assert.ok(result.error)
  assert.equal(result.total, 0)
  assert.deepEqual(result.rows, [])
  assert.deepEqual(result.actors, [])
  assert.equal(calls('actorOptions').length, 0)
  assert.equal(calls('rollback').length, 1)
  unchanged(before)
})

test('actor/count/row/options/transaction failures return no partial data or diagnostics and preserve database state', async () => {
  const failure = new Error('PRIVATE MYSQL SQL CONNECTION PASSWORD')
  for (const key of ['actorError', 'countError', 'idsError', 'recordsError', 'optionsError', 'transactionError']) {
    scenario({ [key]: failure })
    const before = clone(current.state)
    const result = await run()
    assert.ok(result.error)
    assert.equal(result.error.includes('PRIVATE'), false)
    assert.equal(result.total, 0)
    assert.deepEqual(result.rows, [])
    assert.deepEqual(result.actors, [])
    assert.equal(calls('rollback').length, 1)
    unchanged(before)
  }
})

test('unknown URL properties are never propagated into database predicates or extra data lookups', async () => {
  scenario()
  await run({ q: 'PRIVATE QUERY', actorEmail: 'PRIVATE EMAIL', customerId: 'PRIVATE CUSTOMER', entityId: 'PRIVATE ID', role: 'SALES', OR: '[{}]' })
  for (const kind of ['count', 'ids', 'records', 'actorOptions']) assert.equal(JSON.stringify(calls(kind)[0].args).includes('PRIVATE'), false)
  assert.deepEqual(calls('actor').map((call) => call.args.where), [{ id: 'actor-own' }])
})

test('all 15 registered action families are safely queryable with no category/title/body enrichment', async () => {
  for (const definition of CRM_AUDIT_REGISTRY) {
    scenario(); current.state.audits = [audit('registered', { action: definition.action, entityType: definition.entityType, metadata: null })]
    const result = await run({ action: definition.action, category: definition.category })
    assert.equal(result.error, null)
    assert.equal(result.rows.length, 1)
    assert.equal(result.rows[0].action, definition.action)
    assert.equal(result.rows[0].label, definition.label)
    assert.equal(result.rows[0].category, definition.category)
    assert.deepEqual(result.rows[0].summary, [])
  }
})

test('real timeline rendering escapes script-looking current actor names and supplied display text/attributes', async () => {
  scenario(); current.state.users[0].name = '<script data-audit-poison="actor">alert(1)</script>'
  const result = await run({ actorId: 'actor-own' })
  const html = renderToStaticMarkup(createElement(AuditTimeline, { rows: result.rows }))
  assert.ok(html.includes('&lt;script'))
  assert.equal(html.includes('<script data-audit-poison='), false)
  assert.equal(html.includes('PRIVATE NOTE'), false)
  const rows = [ { ...result.rows[0], label: '<img src=x onerror=alert(1)>', summary: [{ key: 'safe-key', label: '<script>label</script>', value: '"><script data-audit-poison="value">x</script>' }] } ]
  const escaped = renderToStaticMarkup(createElement(AuditTimeline, { rows }))
  assert.ok(escaped.includes('&lt;img'))
  assert.ok(escaped.includes('&quot;&gt;&lt;script'))
  assert.equal(escaped.includes('<img src=x'), false)
  assert.equal(escaped.includes('<script data-audit-poison='), false)
  // Display escaping is distinct from metadata acceptance: the production mapper
  // rejects script-bearing IDs/enums, so these summary values need a manual DTO.
})

test('real timeline renders null-actor/aggregate/empty/bulk states without mutation controls or unsafe raw metadata', async () => {
  scenario(); current.state.audits = [audit('export', { actorId: null, action: 'CUSTOMER_CSV_EXPORT', entityId: null, metadata: { rowCount: 1, format: 'csv', filtersActive: false } }),
    audit('bulk', { action: 'CUSTOMER_BULK_PRIORITY_UPDATE', metadata: { customerId: 'customer-own', previousPriority: 'LOW', priority: 'HIGH', bulk: true } })]
  const result = await run()
  const html = renderToStaticMarkup(createElement(AuditTimeline, { rows: result.rows }))
  assert.ok(html.includes('Không xác định người thực hiện'))
  assert.ok(html.includes('Xuất dữ liệu tổng hợp'))
  assert.ok(html.includes('không phải toàn bộ lô cập nhật'))
  assert.equal(html.includes('<form'), false)
  assert.equal(html.includes('<button'), false)
  assert.ok(html.includes('href="/sales/customers/customer-own"'))
  const empty = renderToStaticMarkup(createElement(AuditTimeline, { rows: [] }))
  assert.ok(empty.includes('Không có sự kiện CRM phù hợp'))
})

test('real filter form is GET-only, resets page, uses six filter controls without hidden write state, and escapes actor names', () => {
  const parsed = parseAuditFilters({ actorId: 'selected-missing-id' }, now)
  const html = renderToStaticMarkup(createElement(AuditFiltersForm, { ...parsed, actors: [{ id: 'actor-option', name: '<script>actor</script>' }] }))
  assert.ok(html.includes('action="/sales/audit"'))
  assert.ok(html.includes('method="get"'))
  assert.ok(html.includes('ID đã chọn'))
  assert.ok(html.includes('&lt;script&gt;actor&lt;/script&gt;'))
  assert.equal(html.includes('<script>actor'), false)
  const names = [...html.matchAll(/<(?:input|select)[^>]*\bname="([^"]+)"/g)].map((match) => match[1]).sort()
  assert.deepEqual(names, ['action', 'actorId', 'category', 'from', 'period', 'to'])
  assert.equal(html.includes('$ACTION_'), false)
  const invalid = renderToStaticMarkup(createElement(AuditFiltersForm, { ...parsed, invalidKeys: ['action'], actors: [] }))
  assert.ok(invalid.includes('role="alert"'))
  assert.ok(invalid.includes('Không hiển thị kết quả'))
})
