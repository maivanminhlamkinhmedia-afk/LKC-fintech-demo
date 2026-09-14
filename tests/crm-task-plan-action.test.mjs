import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { Prisma } from '@prisma/client'

// Execute the real action/parser/roles/scope against an isolated in-memory adapter.
// Rollback/failure injection here proves action control flow, not MySQL isolation
// or every real concurrent interleaving. The HTTP verifier covers the real stack.
const actionUrl = new URL('../src/features/crm/task-plan-actions.ts', import.meta.url).href
const validationUrl = new URL('../src/features/crm/task-plan-validation.ts', import.meta.url).href
const timeUrl = new URL('../src/features/crm/contact-plan-time.ts', import.meta.url).href
const bridgeKey = Symbol.for('crm-task-plan-action-test-adapter')
let current
const clone = (value) => structuredClone(value)
const record = (kind, args) => current.calls.push({ kind, ...(args === undefined ? {} : { args: clone(args) }) })

function matchesScope(scope) {
  if (Object.keys(scope).length === 0) return true
  if ('assignedSalesId' in scope) return current.state.customer.assignedSalesId === scope.assignedSalesId
  return scope.assignedSales?.salesMemberships?.some?.team?.managerId === current.state.customer.managerId
}

const adapter = {
  async requirePermission(permission) {
    record('auth', permission)
    if (current.authError) throw current.authError
    return clone(current.session)
  },
  revalidatePath(path) {
    assert.equal(current.inTransaction, false, 'revalidation must occur after transaction completion')
    assert.equal(current.calls.some((call) => call.kind === 'commit'), true, 'revalidation requires committed change')
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
        customerTask: {
          async findFirst(args) {
            record('task', args)
            return current.state.task && current.state.task.id === args.where.AND[0].id
              && matchesScope(args.where.AND[1].customer.is) ? clone(current.state.task) : null
          },
          async updateMany(args) {
            record('update', args)
            if (current.updateError) throw current.updateError
            const guard = args.where.AND[0]
            const task = current.state.task
            if (current.updateCount === 0 || task.id !== guard.id || task.customerId !== guard.customerId
              || task.updatedAt.getTime() !== guard.updatedAt.getTime() || task.status !== guard.status
              || !matchesScope(args.where.AND[1].customer.is)) return { count: 0 }
            Object.assign(task, clone(args.data), {
              updatedAt: current.nextVersion ?? new Date(task.updatedAt.getTime() + 10),
            })
            return { count: 1 }
          },
          async findUniqueOrThrow(args) {
            record('version', args)
            assert.equal(args.where.id, current.state.task.id)
            return { updatedAt: clone(current.state.task.updatedAt) }
          },
        },
        auditLog: { async create(args) {
          record('audit', args)
          if (current.auditError) throw current.auditError
          current.state.audits.push(clone(args.data))
          return clone(args.data)
        } },
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
const adapterModule = (exports) => `data:text/javascript,${encodeURIComponent(
  `const adapter = globalThis[Symbol.for('crm-task-plan-action-test-adapter')]; ${exports}`,
)}`
const actionImports = new Map([
  ['@/lib/authz', adapterModule('export const requirePermission = adapter.requirePermission;')],
  ['@/lib/prisma', adapterModule('export const prisma = adapter.prisma;')],
  ['next/cache', adapterModule('export const revalidatePath = adapter.revalidatePath;')],
  ['@/lib/roles', new URL('../src/lib/roles.ts', import.meta.url).href],
  ['@/features/crm/access', new URL('../src/features/crm/access.ts', import.meta.url).href],
  ['@/features/crm/task-plan-validation', validationUrl],
  ['@/features/crm/contact-plan-time', timeUrl],
])
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === actionUrl && actionImports.has(specifier)) {
      return nextResolve(actionImports.get(specifier), context)
    }
    if (context.parentURL === validationUrl && specifier === './contact-plan-time') return nextResolve(timeUrl, context)
    return nextResolve(specifier, context)
  },
})
let updateCustomerTaskPlan
try { ({ updateCustomerTaskPlan } = await import(actionUrl)) }
finally { hook.deregister(); delete globalThis[bridgeKey] }

const originalVersion = new Date('2026-09-14T02:30:00.000Z')
const originalDue = new Date('2026-09-15T02:30:00.000Z')
const detailPaths = ['/sales/customers/customer-own', '/sales/follow-ups']
const duePaths = [...detailPaths, '/sales/reports', '/sales', '/sales/customers', '/sales/pipeline']
function scenario(overrides = {}) {
  current = {
    state: {
      actor: { id: 'actor-own', role: 'SALES', status: 'ACTIVE' },
      customer: { id: 'customer-own', assignedSalesId: 'actor-own', managerId: 'actor-own', nextContactAt: '2026-10-01', lastContactAt: '2020-01-01' },
      task: {
        id: 'task-own', customerId: 'customer-own', title: 'Original private title', priority: 'MEDIUM', dueAt: clone(originalDue),
        updatedAt: clone(originalVersion), status: 'TODO', completedAt: null, assignedToId: 'foreign-assignee',
        createdById: 'original-creator', description: 'Preserve description', createdAt: new Date('2025-01-01T00:00:00.000Z'),
      },
      audits: [{ id: 'historical-audit', metadata: { existing: true } }],
    },
    // A stale/global session role must not replace the current transaction role.
    session: { user: { id: 'actor-own', role: 'ADMIN' } },
    calls: [], paths: [], inTransaction: false,
    ...overrides,
  }
  return current
}
function form(overrides = {}) {
  const data = new FormData()
  for (const [key, value] of Object.entries({
    taskId: 'task-own', title: 'Original private title', priority: 'MEDIUM', dueAt: '2026-09-15T09:30',
    expectedUpdatedAt: originalVersion.toISOString(), ...overrides,
  })) if (value !== null) data.append(key, value)
  return data
}
const run = (overrides) => updateCustomerTaskPlan({ kind: 'success', message: 'Forged previous state' }, form(overrides))
const calls = (kind) => current.calls.filter((call) => call.kind === kind)
function assertUntouched(before) {
  assert.deepEqual(current.state, before)
  assert.deepEqual(current.paths, [])
  assert.equal(calls('audit').length, 0)
}
function assertOnlyPlanningChanged(before) {
  const stable = clone(current.state)
  for (const key of ['title', 'priority', 'dueAt', 'updatedAt']) stable.task[key] = clone(before.task[key])
  stable.audits = before.audits
  assert.deepEqual(stable, before)
}
const knownError = (code) => new Prisma.PrismaClientKnownRequestError('Injected adapter conflict details', { code, clientVersion: 'test' })

test('authentication precedes even invalid input and propagates permission failure without transaction access', async () => {
  const failure = new Error('Permission denied by authentication adapter')
  scenario({ authError: failure })
  const before = clone(current.state)
  await assert.rejects(run({ title: '' }), (error) => error === failure)
  assert.deepEqual(current.calls, [{ kind: 'auth', args: 'sales:write' }])
  assertUntouched(before)
})

test('real parser rejects malformed planning data before opening a transaction', async () => {
  scenario()
  const before = clone(current.state)
  const result = await run({ dueAt: null })
  assert.equal(result.kind, 'error')
  assert.deepEqual(current.calls.map((call) => call.kind), ['auth'])
  assertUntouched(before)
})

test('fresh missing, inactive or non-write actors fail before the scoped task query', async () => {
  for (const actor of [null,
    ...['SUSPENDED', 'DISABLED', 'INVITED'].map((status) => ({ id: 'actor-own', role: 'SALES', status })),
    ...['MANAGER', 'CLIENT', 'CREATOR', 'ANALYST', 'EMPLOYEE'].map((role) => ({ id: 'actor-own', role, status: 'ACTIVE' })),
  ]) {
    scenario(); current.state.actor = actor
    const before = clone(current.state)
    assert.equal((await run({ title: 'Changed' })).kind, 'error')
    assert.equal(calls('task').length, 0)
    assert.equal(calls('update').length, 0)
    assertUntouched(before)
  }
})

test('real fresh Sales scope and exact compare-and-swap allowlist ignore forged identity and immutable fields', async () => {
  scenario()
  const before = clone(current.state)
  const result = await run({ title: '  New private title  ', customerId: 'foreign-customer', assignedToId: 'actor-own',
    status: 'DONE', completedAt: '2099-01-01', nextContactAt: '2099-01-01', actorId: 'forged', updatedAt: '1900-01-01' })
  assert.equal(result.kind, 'success')
  assert.deepEqual(calls('actor')[0].args, { where: { id: 'actor-own' }, select: { id: true, role: true, status: true } })
  assert.deepEqual(calls('transaction')[0].args, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  assert.deepEqual(calls('task')[0].args, {
    where: { AND: [{ id: 'task-own' }, { customer: { is: { assignedSalesId: 'actor-own' } } }] },
    select: { id: true, customerId: true, title: true, priority: true, dueAt: true, status: true, updatedAt: true },
  })
  assert.deepEqual(calls('update')[0].args, {
    where: { AND: [
      { id: 'task-own', customerId: 'customer-own', updatedAt: originalVersion, status: 'TODO' },
      { customer: { is: { assignedSalesId: 'actor-own' } } },
    ] },
    data: { title: 'New private title', priority: 'MEDIUM', dueAt: originalDue },
  })
  assert.deepEqual(current.paths, detailPaths)
  assertOnlyPlanningChanged(before)
})

test('real global and manager roles derive their own current customer scopes without task-assignee authorization', async () => {
  for (const role of ['SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER']) {
    scenario(); current.state.actor.role = role; current.session.user.role = 'SALES'
    assert.equal((await run({ title: 'Changed' })).kind, 'success')
    const scope = role === 'SALES_MANAGER'
      ? { assignedSales: { salesMemberships: { some: { team: { managerId: 'actor-own' } } } } } : {}
    assert.deepEqual(calls('task')[0].args.where, { AND: [{ id: 'task-own' }, { customer: { is: scope } }] })
    assert.equal(current.state.task.assignedToId, 'foreign-assignee')
  }
})

test('missing task and foreign customer scope fail without writes even when task assignee equals actor', async () => {
  for (const missing of [false, true]) {
    scenario()
    if (missing) current.state.task = null
    else { current.state.customer.assignedSalesId = 'foreign-owner'; current.state.task.assignedToId = 'actor-own' }
    const before = clone(current.state)
    assert.equal((await run({ title: 'Changed' })).kind, 'error')
    assert.equal(calls('update').length, 0)
    assertUntouched(before)
  }
})

test('stale version is checked before no-op and protects a newer CRM-009 status/completion transition', async () => {
  for (const transitioned of [false, true]) {
    scenario(); current.state.task.updatedAt = new Date(originalVersion.getTime() + 5)
    if (transitioned) { current.state.task.status = 'DONE'; current.state.task.completedAt = new Date('2026-09-14T03:00:00Z') }
    const before = clone(current.state)
    const result = await run()
    assert.equal(result.kind, 'error')
    assert.match(result.message, /đã thay đổi/)
    assert.equal(calls('update').length, 0)
    assertUntouched(before)
  }
})

test('fresh terminal task plans remain blocked even for an otherwise no-op submission', async () => {
  for (const status of ['DONE', 'CANCELLED']) {
    scenario(); current.state.task.status = status
    const before = clone(current.state)
    assert.equal((await run()).kind, 'error')
    assert.equal(calls('update').length, 0)
    assertUntouched(before)
  }
})

test('canonical no-op preserves seconds/milliseconds and every row without audit or revalidation', async () => {
  for (const dueAt of [new Date('2026-09-15T02:30:45.678Z'), null]) {
    scenario(); current.state.task.dueAt = dueAt
    const before = clone(current.state)
    assert.equal((await run({ title: '  Original private title  ', dueAt: dueAt ? '2026-09-15T09:30' : '' })).kind, 'success')
    assert.equal(calls('update').length, 0)
    assertUntouched(before)
  }
})

test('title/priority changes preserve subminute deadline and create one private minimal audit after version verification', async () => {
  for (const fields of [{ title: 'Sensitive new title' }, { priority: 'HIGH' }]) {
    scenario(); current.state.task.dueAt = new Date('2026-09-15T02:30:45.678Z')
    const before = clone(current.state)
    assert.equal((await run(fields)).kind, 'success')
    assert.equal(calls('update').length, 1)
    assert.equal(calls('audit').length, 1)
    assert.deepEqual(current.state.task.dueAt, before.task.dueAt)
    assert.deepEqual(calls('audit')[0].args.data, {
      actorId: 'actor-own', action: 'CUSTOMER_TASK_PLAN_UPDATE', entityType: 'CustomerTask', entityId: 'task-own',
      metadata: { customerId: 'customer-own', taskId: 'task-own', changedFields: Object.keys(fields),
        previousPriority: 'MEDIUM', priority: fields.priority ?? 'MEDIUM',
        previousDueAt: before.task.dueAt.toISOString(), dueAt: before.task.dueAt.toISOString() },
    })
    assert.equal(JSON.stringify(calls('audit')[0]).includes('private title'), false)
    assert.equal(JSON.stringify(calls('audit')[0]).includes('Sensitive new title'), false)
    assert.deepEqual(current.paths, detailPaths)
    assert.deepEqual(current.calls.map((call) => call.kind), ['auth', 'transaction', 'actor', 'task', 'update', 'version', 'audit', 'commit', 'revalidate', 'revalidate'])
    assertOnlyPlanningChanged(before)
  }
})

test('due change, explicit clear and combined change use exact audit fields and due-dependent revalidation paths', async () => {
  for (const fields of [{ dueAt: '2026-09-16T00:00' }, { dueAt: '' }, { title: 'Combined private title', priority: 'URGENT', dueAt: '2020-01-01T09:30' }]) {
    scenario(); current.state.task.status = 'IN_PROGRESS'
    const before = clone(current.state)
    assert.equal((await run(fields)).kind, 'success')
    assert.equal(calls('update').length, 1)
    assert.equal(calls('audit').length, 1)
    const expectedDue = fields.dueAt === '' ? null : new Date(`${fields.dueAt}:00+07:00`)
    assert.deepEqual(current.state.task.dueAt, expectedDue)
    assert.deepEqual(calls('audit')[0].args.data.metadata, {
      customerId: 'customer-own', taskId: 'task-own', changedFields: ['title', 'priority', 'dueAt'].filter((key) => key in fields),
      previousPriority: 'MEDIUM', priority: fields.priority ?? 'MEDIUM', previousDueAt: originalDue.toISOString(), dueAt: expectedDue?.toISOString() ?? null,
    })
    assert.deepEqual(current.paths, duePaths)
    assertOnlyPlanningChanged(before)
  }
})

test('a successful planning update invalidates its previous token and an older draft cannot overwrite it', async () => {
  scenario()
  assert.equal((await run({ title: 'First committed plan' })).kind, 'success')
  const committed = clone(current.state)
  current.calls = []; current.paths = []
  const stale = await run({ title: 'Stale second draft' })
  assert.equal(stale.kind, 'error')
  assert.match(stale.message, /đã thay đổi/)
  assert.equal(calls('update').length, 0)
  assertUntouched(committed)
})

test('zero compare-and-swap update count becomes a safe stale error without audit or revalidation', async () => {
  scenario({ updateCount: 0 })
  const before = clone(current.state)
  assert.equal((await run({ title: 'Changed' })).kind, 'error')
  assert.equal(calls('version').length, 0)
  assert.equal(calls('rollback').length, 1)
  assertUntouched(before)
})

test('non-advancing Prisma-managed version rolls back the tentative update before any audit', async () => {
  for (const nextVersion of [originalVersion, new Date(originalVersion.getTime() - 1)]) {
    scenario({ nextVersion })
    const before = clone(current.state)
    assert.equal((await run({ title: 'Changed' })).kind, 'error')
    assert.equal(calls('update').length, 1)
    assert.equal(calls('version').length, 1)
    assert.equal(calls('rollback').length, 1)
    assertUntouched(before)
  }
})

test('known Prisma conflicts/missing-relation errors are handled without leaking diagnostics or automatically retrying', async () => {
  for (const code of ['P2034', 'P2025', 'P2003']) {
    scenario({ updateError: knownError(code) })
    const before = clone(current.state)
    const result = await run({ title: 'Changed' })
    assert.equal(result.kind, 'error')
    assert.equal(result.message.includes(code), false)
    assert.equal(result.message.includes('Injected'), false)
    assert.equal(calls('transaction').length, 1)
    assertUntouched(before)
  }
})

test('audit failure propagates and the transaction adapter rolls back the preceding task update and retains old audits', async () => {
  const failure = new Error('Injected audit failure')
  scenario({ auditError: failure })
  const before = clone(current.state)
  await assert.rejects(run({ title: 'Changed', dueAt: '' }), (error) => error === failure)
  assert.equal(calls('update').length, 1)
  assert.equal(calls('audit').length, 1)
  assert.equal(calls('rollback').length, 1)
  assert.deepEqual(current.state, before)
  assert.deepEqual(current.paths, [])
})

test('unexpected update errors propagate rather than fabricating success or leaving an audit', async () => {
  const failure = new Error('Injected update failure')
  scenario({ updateError: failure })
  const before = clone(current.state)
  await assert.rejects(run({ title: 'Changed' }), (error) => error === failure)
  assert.equal(calls('rollback').length, 1)
  assertUntouched(before)
})
