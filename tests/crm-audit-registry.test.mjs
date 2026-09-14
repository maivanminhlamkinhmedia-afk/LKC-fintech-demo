import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'
import {
  CRM_AUDIT_REGISTRY, CRM_AUDIT_CATEGORIES, CRM_AUDIT_EXCLUDED_ACTIONS,
  getAuditDefinition, summarizeAuditMetadata, auditCustomerHref, safeAuditId, formatAuditDate,
} from '../src/features/crm/audit-registry.ts'
import { CRM_AUDIT_ROLES, canReadCRMAudit } from '../src/features/crm/audit-access.ts'

const iso = '2026-09-14T17:00:00.000Z'
const examples = {
  CUSTOMER_PROFILE_UPDATE: { status: 'ACTIVE', priority: 'HIGH' },
  CUSTOMER_SALES_ASSIGNMENT: { previousSalesId: null, newSalesId: 'sales-new' },
  CUSTOMER_PIPELINE_STATUS_CHANGE: { previousStatus: 'LEAD', newStatus: 'PROSPECT' },
  CUSTOMER_TASK_CREATE: { customerId: 'customer-own', priority: 'URGENT' },
  CUSTOMER_TASK_STATUS_UPDATE: { customerId: 'customer-own', previousStatus: 'TODO', status: 'DONE' },
  CUSTOMER_TASK_PLAN_UPDATE: { customerId: 'customer-own', taskId: 'task-own', changedFields: ['title', 'priority', 'dueAt'], previousPriority: 'MEDIUM', priority: 'URGENT', previousDueAt: null, dueAt: iso },
  CUSTOMER_ACTIVITY_CREATE: { customerId: 'customer-own', activityId: 'activity-own', activityType: 'CALL' },
  CUSTOMER_NEXT_CONTACT_UPDATE: { customerId: 'customer-own', previousNextContactAt: null, nextContactAt: iso, operation: 'SET' },
  CUSTOMER_BULK_PRIORITY_UPDATE: { customerId: 'customer-own', previousPriority: 'LOW', priority: 'HIGH', bulk: true },
  CUSTOMER_CSV_EXPORT: { rowCount: 17, filtersActive: false, format: 'csv' },
  SALES_TEAM_CREATE: { name: 'PRIVATE TEAM NAME', managerId: 'manager-own' },
  SALES_TEAM_RENAME: { previousName: 'PRIVATE PREVIOUS NAME', newName: 'PRIVATE NEW NAME' },
  SALES_TEAM_MANAGER_CHANGE: { previousManagerId: 'manager-old', newManagerId: 'manager-new' },
  SALES_TEAM_MEMBER_ADD: { teamId: 'team-own', userId: 'sales-own' },
  SALES_TEAM_MEMBER_REMOVE: { teamId: 'team-own', userId: 'sales-own', assignedCustomerCount: 3, nonClosedCustomerCount: 2, confirmationUsed: true },
}
const omitted = ['name', 'previousName', 'newName']
const fields = (action, metadata) => Object.fromEntries(summarizeAuditMetadata(action, metadata).map((entry) => [entry.key, entry.value]))

test('audit access is explicitly limited to SUPER_ADMIN/ADMIN, not ordinary CRM read permission', () => {
  assert.deepEqual(CRM_AUDIT_ROLES, ['SUPER_ADMIN', 'ADMIN'])
  for (const role of ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SALES_MANAGER', 'SALES', 'CLIENT', 'CREATOR', 'ANALYST', 'EMPLOYEE']) {
    assert.equal(canReadCRMAudit(role), ['SUPER_ADMIN', 'ADMIN'].includes(role), role)
  }
  for (const role of ['', 'admin', ' ADMIN', 'ADMIN ', 'ADMIN\n', 'ADMIN\u0000', 'UNKNOWN']) assert.equal(canReadCRMAudit(role), false)
})

test('registry contains exactly all 15 known CRM actions with unique stable definitions and nine categories', () => {
  const actual = CRM_AUDIT_REGISTRY.map((entry) => entry.action)
  assert.equal(actual.length, 15)
  assert.equal(new Set(actual).size, actual.length)
  assert.deepEqual([...actual].sort(), Object.keys(examples).sort())
  assert.deepEqual([...CRM_AUDIT_CATEGORIES].sort(), ['ASSIGNMENT', 'BULK_OPERATION', 'CONTACT', 'CUSTOMER', 'EXPORT', 'INTERACTION', 'PIPELINE', 'TASK', 'TEAM'])
  for (const entry of CRM_AUDIT_REGISTRY) {
    assert.equal(getAuditDefinition(entry.action), entry)
    assert.ok(entry.label.trim())
    assert.ok(CRM_AUDIT_CATEGORIES.includes(entry.category))
    assert.equal(new Set(entry.fields.map((field) => field.key)).size, entry.fields.length)
    assert.ok(entry.fields.every((field) => field.label.trim()))
  }
  for (const action of ['CUSTOMER_UNKNOWN', 'SALES_TEAM_FUTURE', 'customer_profile_update', ' CUSTOMER_PROFILE_UPDATE', 'CUSTOMER_PROFILE_UPDATE\n', 'AUTH_LOGIN']) {
    assert.equal(getAuditDefinition(action), undefined)
    assert.deepEqual(summarizeAuditMetadata(action, examples.CUSTOMER_PROFILE_UPDATE), [])
  }
})

test('production-wide AST inventory accounts for every audit emitter: 15 CRM plus four explicit exclusions', () => {
  const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
  const files = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? files(join(directory, entry.name)) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [join(directory, entry.name)] : [])
  const emitted = []
  for (const path of files(sourceRoot)) {
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
    const visit = (node) => {
      const method = ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) ? node.expression : null
      if (method && ['create', 'createMany'].includes(method.name.text)
        && ts.isPropertyAccessExpression(method.expression) && method.expression.name.text === 'auditLog') {
        const literals = []
        const findAction = (child) => {
          if (ts.isPropertyAssignment(child) && (ts.isIdentifier(child.name) || ts.isStringLiteral(child.name)) && child.name.text === 'action') {
            assert.ok(ts.isStringLiteral(child.initializer), `Audit action must be explicitly inventoried: ${path}`)
            literals.push(child.initializer.text)
          }
          ts.forEachChild(child, findAction)
        }
        ts.forEachChild(node, findAction)
        assert.equal(literals.length, 1, `Audit emitter needs exactly one inventoried literal: ${path}`)
        emitted.push(literals[0])
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  const excluded = ['AUTH_LOGIN', 'USER_CREATE', 'USER_ROLE_UPDATE', 'USER_STATUS_UPDATE']
  assert.deepEqual(Object.keys(CRM_AUDIT_EXCLUDED_ACTIONS).sort(), excluded.sort())
  assert.ok(Object.values(CRM_AUDIT_EXCLUDED_ACTIONS).every((reason) => typeof reason === 'string' && reason.length > 10))
  assert.equal(emitted.length, 19, 'A changed production emitter inventory requires explicit registry/exclusion review')
  assert.equal(new Set(emitted).size, 19)
  assert.deepEqual(emitted.sort(), [...CRM_AUDIT_REGISTRY.map((entry) => entry.action), ...excluded].sort())
})

test('all 15 action-specific summaries expose only typed fields and deliberately omit team names', () => {
  for (const [action, metadata] of Object.entries(examples)) {
    const before = structuredClone(metadata)
    const result = summarizeAuditMetadata(action, metadata)
    assert.deepEqual(result.map((entry) => entry.key).sort(), Object.keys(metadata).filter((key) => !omitted.includes(key)).sort(), action)
    assert.ok(result.every((entry) => Object.keys(entry).sort().join(',') === 'key,label,value' && typeof entry.value === 'string' && entry.value.length > 0))
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
    assert.deepEqual(metadata, before)
  }
  assert.deepEqual(fields('CUSTOMER_CSV_EXPORT', examples.CUSTOMER_CSV_EXPORT), { rowCount: '17', filtersActive: 'Không', format: 'csv' })
  assert.deepEqual(fields('CUSTOMER_SALES_ASSIGNMENT', examples.CUSTOMER_SALES_ASSIGNMENT), { previousSalesId: 'Không có', newSalesId: 'sales-new' })
  assert.equal(fields('CUSTOMER_TASK_PLAN_UPDATE', examples.CUSTOMER_TASK_PLAN_UPDATE).changedFields, 'title, priority, dueAt')
})

test('unknown/private metadata keys never appear in any known action summary', () => {
  const poison = { password: 'PRIVATE PASSWORD', passwordHash: 'PRIVATE HASH', token: 'PRIVATE TOKEN', confirmationToken: 'PRIVATE CONFIRMATION',
    session: 'PRIVATE SESSION', ipAddress: 'PRIVATE IP', email: 'PRIVATE EMAIL', note: 'PRIVATE NOTE', content: 'PRIVATE BODY',
    title: '<script>PRIVATE TITLE</script>', description: 'PRIVATE DESCRIPTION', csv: 'PRIVATE CSV', q: 'PRIVATE QUERY',
    arbitrary: { nested: 'PRIVATE' }, previousState: 'PRIVATE STATE', constructor: 'PRIVATE CONSTRUCTOR' }
  for (const [action, metadata] of Object.entries(examples)) {
    const result = summarizeAuditMetadata(action, { ...metadata, ...poison })
    assert.deepEqual(result, summarizeAuditMetadata(action, metadata))
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
  }
})

test('null/scalar/array/nonplain metadata safely yields no summary and own getters are never executed', () => {
  for (const action of Object.keys(examples)) {
    for (const metadata of [null, undefined, '', 'PRIVATE JSON', 1, true, [], [examples[action]], new Date(), new Map(), Object.create(examples[action])]) {
      assert.deepEqual(summarizeAuditMetadata(action, metadata), [], action)
    }
  }
  let accessed = 0
  const metadata = Object.defineProperty({}, 'customerId', { get() { accessed += 1; throw new Error('Getter must not execute') } })
  assert.deepEqual(summarizeAuditMetadata('CUSTOMER_TASK_CREATE', metadata), [])
  assert.equal(auditCustomerHref('CUSTOMER_TASK_CREATE', 'CustomerTask', 'task-id', metadata), null)
  assert.equal(accessed, 0)
  const nullPrototype = Object.assign(Object.create(null), examples.CUSTOMER_TASK_CREATE)
  assert.deepEqual(fields('CUSTOMER_TASK_CREATE', nullPrototype), { customerId: 'customer-own', priority: 'URGENT' })
})

test('IDs accept only exact bounded ASCII identity strings and never trim or stringify objects', () => {
  for (const value of ['a', 'cuid_123-ABC', 'x'.repeat(191)]) assert.equal(safeAuditId(value), true)
  for (const value of [null, undefined, 123, {}, [], new String('customer-id'), '', ' ', ' id', 'id ', 'id\n', 'id\u0000', 'id\u007f', 'id\u0085',
    '../foreign', 'a/b', 'a%2Fb', 'a&x=1', 'https://evil.test', '<script>', 'x'.repeat(192), 'Nguyễn']) assert.equal(safeAuditId(value), false)
  for (const value of ['<script>PRIVATE</script>', ['id'], { id: 'PRIVATE' }, 5, 'id\n']) {
    assert.deepEqual(fields('CUSTOMER_TASK_CREATE', { customerId: value, priority: 'HIGH' }), { priority: 'HIGH' })
  }
})

test('enum fields are action-specific and reject task/customer mixing, whitespace, controls and nonstrings', () => {
  for (const entry of CRM_AUDIT_REGISTRY) for (const field of entry.fields.filter((item) => item.kind === 'enum')) {
    for (const value of field.values) assert.equal(fields(entry.action, { [field.key]: value })[field.key], value)
    for (const value of ['', 'PRIVATE_UNKNOWN', field.values[0].toLowerCase(), ` ${field.values[0]}`, `${field.values[0]} `,
      `${field.values[0]}\n`, ['HIGH'], {}, null, 1]) {
      if (!field.values.includes(value)) assert.deepEqual(fields(entry.action, { [field.key]: value }), {})
    }
  }
  assert.deepEqual(fields('CUSTOMER_PROFILE_UPDATE', { priority: 'URGENT', status: 'TODO' }), {})
  assert.deepEqual(fields('CUSTOMER_ACTIVITY_CREATE', { activityType: 'STATUS_CHANGE' }), {})
  assert.deepEqual(fields('CUSTOMER_ACTIVITY_CREATE', { activityType: 'ASSIGNMENT' }), {})
})

test('counts require safe nonnegative integers, export caps at 5000, booleans are not coerced and bulk requires true', () => {
  for (const rowCount of [0, 1, 5000]) assert.equal(fields('CUSTOMER_CSV_EXPORT', { rowCount }).rowCount, String(rowCount))
  for (const rowCount of [-1, 1.5, 5001, NaN, Infinity, '17', null, true, [], {}]) assert.deepEqual(fields('CUSTOMER_CSV_EXPORT', { rowCount }), {})
  for (const assignedCustomerCount of [0, 5001, Number.MAX_SAFE_INTEGER]) assert.equal(fields('SALES_TEAM_MEMBER_REMOVE', { assignedCustomerCount }).assignedCustomerCount, String(assignedCustomerCount))
  assert.deepEqual(fields('SALES_TEAM_MEMBER_REMOVE', { assignedCustomerCount: Number.MAX_SAFE_INTEGER + 1 }), {})
  for (const value of ['true', 'false', 0, 1, null, [], {}]) {
    assert.deepEqual(fields('CUSTOMER_CSV_EXPORT', { filtersActive: value }), {})
    assert.deepEqual(fields('SALES_TEAM_MEMBER_REMOVE', { confirmationUsed: value }), {})
  }
  assert.equal(fields('CUSTOMER_CSV_EXPORT', { filtersActive: true }).filtersActive, 'Có')
  assert.equal(fields('SALES_TEAM_MEMBER_REMOVE', { confirmationUsed: false }).confirmationUsed, 'Không')
  for (const bulk of [false, 'true', 1, null, {}]) assert.deepEqual(fields('CUSTOMER_BULK_PRIORITY_UPDATE', { bulk }), {})
  assert.equal(fields('CUSTOMER_BULK_PRIORITY_UPDATE', { bulk: true }).bulk, 'Có')
})

test('changedFields is a bounded unique field-name list and cannot carry task title/body/status content', () => {
  for (const changedFields of [['title'], ['priority'], ['dueAt'], ['title', 'priority', 'dueAt'], ['dueAt', 'title']]) {
    assert.equal(fields('CUSTOMER_TASK_PLAN_UPDATE', { changedFields }).changedFields, changedFields.join(', '))
  }
  for (const changedFields of [[], ['title', 'title'], ['title', 'status'], ['title', 'priority', 'dueAt', 'title'], ['PRIVATE TITLE'],
    ['<script>PRIVATE</script>'], ['Title'], ['title\n'], [null], 'title', null, {}, [1]]) {
    assert.deepEqual(fields('CUSTOMER_TASK_PLAN_UPDATE', { changedFields }), {})
  }
})

test('date metadata accepts only canonical UTC milliseconds or null, then formats Vietnam date/time', () => {
  const expected = new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'UTC',
  }).format(new Date(new Date(iso).getTime() + 7 * 3_600_000))
  assert.equal(formatAuditDate(iso), expected)
  assert.equal(formatAuditDate(new Date(iso)), expected)
  assert.equal(fields('CUSTOMER_TASK_PLAN_UPDATE', { dueAt: iso }).dueAt, expected)
  assert.equal(fields('CUSTOMER_NEXT_CONTACT_UPDATE', { nextContactAt: null }).nextContactAt, 'Không có')
  assert.equal(formatAuditDate(null), 'Không có')
  for (const value of ['2026-02-30T00:00:00.000Z', '2026-09-14T24:00:00.000Z', '2026-09-14T17:00:00Z', '2026-09-14T17:00:00.000+00:00',
    '2026-09-14T17:00', `${iso}\n`, ` ${iso}`, 'PRIVATE DATE', new Date(iso), 5, [], {}]) {
    assert.deepEqual(fields('CUSTOMER_TASK_PLAN_UPDATE', { dueAt: value }), {})
  }
  assert.equal(formatAuditDate(new Date('invalid')), 'Không xác định')
  assert.equal(formatAuditDate('PRIVATE DATE'), 'Không xác định')
})

test('date summary formatting is host-timezone independent at Vietnam day/year boundaries', () => {
  const previous = process.env.TZ
  const values = ['2026-09-14T16:59:59.999Z', '2026-09-14T17:00:00.000Z', '2026-12-31T17:00:00.000Z']
  const expected = values.map(formatAuditDate)
  try {
    for (const timezone of ['UTC', 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Ho_Chi_Minh']) {
      process.env.TZ = timezone
      assert.deepEqual(values.map(formatAuditDate), expected)
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous }
})

test('historical and future audit deadlines use fixed UTC+7 rather than historical regional offsets', () => {
  for (const [input, expected] of [
    ['1899-12-31T17:00:00.000Z', '00:00:00 01/01/1900'],
    ['1959-12-31T17:00:00.000Z', '00:00:00 01/01/1960'],
    ['2100-12-31T16:59:00.000Z', '23:59:00 31/12/2100'],
  ]) {
    assert.equal(formatAuditDate(input), expected)
    assert.equal(formatAuditDate(new Date(input)), expected)
    assert.equal(fields('CUSTOMER_TASK_PLAN_UPDATE', { dueAt: input }).dueAt, expected)
  }
})

test('customer links use action-specific references, never task IDs, mismatched entity types or forged extra fields', () => {
  const direct = ['CUSTOMER_PROFILE_UPDATE', 'CUSTOMER_SALES_ASSIGNMENT', 'CUSTOMER_PIPELINE_STATUS_CHANGE', 'CUSTOMER_ACTIVITY_CREATE', 'CUSTOMER_NEXT_CONTACT_UPDATE', 'CUSTOMER_BULK_PRIORITY_UPDATE']
  for (const action of direct) {
    assert.equal(auditCustomerHref(action, 'CustomerProfile', 'customer-own', { customerId: 'forged-other' }), '/sales/customers/customer-own')
    assert.equal(auditCustomerHref(action, 'CustomerTask', 'customer-own', { customerId: 'forged-other' }), null)
  }
  for (const action of ['CUSTOMER_TASK_CREATE', 'CUSTOMER_TASK_STATUS_UPDATE', 'CUSTOMER_TASK_PLAN_UPDATE']) {
    assert.equal(auditCustomerHref(action, 'CustomerTask', 'task-own', { customerId: 'customer-own' }), '/sales/customers/customer-own')
    assert.equal(auditCustomerHref(action, 'CustomerTask', 'task-own', {}), null)
    assert.equal(auditCustomerHref(action, 'CustomerProfile', 'customer-own', { customerId: 'customer-own' }), null)
  }
  for (const definition of CRM_AUDIT_REGISTRY.filter((entry) => !entry.customerReference)) {
    assert.equal(auditCustomerHref(definition.action, definition.entityType, 'fake-customer', { customerId: 'forged' }), null)
  }
  for (const invalid of [null, '', '../bad', 'a/b', 'id\n', '<script>', 'x'.repeat(192)]) {
    assert.equal(auditCustomerHref('CUSTOMER_PROFILE_UPDATE', 'CustomerProfile', invalid, {}), null)
    assert.equal(auditCustomerHref('CUSTOMER_TASK_CREATE', 'CustomerTask', 'task-own', { customerId: invalid }), null)
  }
  assert.equal(auditCustomerHref('CUSTOMER_UNKNOWN', 'CustomerProfile', 'customer-own', {}), null)
})
