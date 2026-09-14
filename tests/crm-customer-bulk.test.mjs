import assert from 'node:assert/strict'
import test from 'node:test'
import { CustomerPriority } from '@prisma/client'
import { MAX_BULK_CUSTOMERS, parseCustomerBulkForm } from '../src/features/crm/customer-bulk-validation.ts'

function form(fields = {}) {
  const data = new FormData()
  for (const [key, value] of Object.entries({ customerIds: ['customer-a'], priority: 'HIGH', ...fields })) {
    if (value !== null) for (const entry of Array.isArray(value) ? value : [value]) data.append(key, entry)
  }
  return data
}
function rejected(value) {
  const result = parseCustomerBulkForm(value)
  assert.equal(result.ok, false)
  assert.equal(typeof result.message, 'string')
  assert.ok(result.message.trim())
  assert.equal('data' in result, false)
}

test('bulk priority uses the actual three-value customer enum, never task URGENT', () => {
  assert.deepEqual(Object.values(CustomerPriority), ['LOW', 'MEDIUM', 'HIGH'])
  for (const priority of Object.values(CustomerPriority)) {
    assert.deepEqual(parseCustomerBulkForm(form({ priority })), { ok: true, data: { customerIds: ['customer-a'], priority } })
  }
  rejected(form({ priority: 'URGENT' }))
})

test('bulk IDs are intentionally multi-valued, deduplicated and sorted deterministically', () => {
  assert.deepEqual(parseCustomerBulkForm(form({ customerIds: ['customer-z', 'customer-a', 'customer-z', 'customer-B'] })), {
    ok: true, data: { customerIds: ['customer-B', 'customer-a', 'customer-z'], priority: 'HIGH' },
  })
})

test('bulk raw occurrence cap is exactly 100, including repeated IDs, with no silent truncation', () => {
  assert.equal(MAX_BULK_CUSTOMERS, 100)
  const ids = Array.from({ length: 100 }, (_, index) => `customer-${index}`)
  assert.equal(parseCustomerBulkForm(form({ customerIds: ids })).data.customerIds.length, 100)
  assert.deepEqual(parseCustomerBulkForm(form({ customerIds: Array(100).fill('customer-a') })).data.customerIds, ['customer-a'])
  rejected(form({ customerIds: [...ids, 'customer-100'] }))
  rejected(form({ customerIds: Array(101).fill('customer-a') }))
})

test('bulk rejects missing/empty selection and non-FormData objects safely', () => {
  for (const customerIds of [null, [], '']) rejected(form({ customerIds }))
  for (const value of [null, undefined, {}, 'not a form', { getAll: () => ['customer-a'] }]) rejected(value)
})

test('every ID obeys strict singleton-string ID grammar without trimming or partial processing', () => {
  for (const id of ['a', 'cuid_123-ABC', 'x'.repeat(191)]) assert.equal(parseCustomerBulkForm(form({ customerIds: [id] })).ok, true)
  for (const id of ['', ' ', ' customer-a', 'customer-a ', '../foreign', 'a/b', 'a%2Fb', 'a&x=1', 'a b', 'id\n', 'id\u0000', 'id\u007f', 'x'.repeat(192)]) {
    rejected(form({ customerIds: ['customer-a', id] }))
  }
  rejected(form({ customerIds: ['customer-a', new File(['customer-b'], 'id.txt')] }))
})

test('priority requires one exact enum string and rejects missing, repeated, File and forged forms', () => {
  for (const priority of [null, [], '', ' ', 'high', 'Medium', ' HIGH', 'HIGH ', 'HIGH\n', 'HIGH\u0000', 'HIGH\u007f', 'CRITICAL', 'x'.repeat(5000), ['HIGH', 'HIGH'], ['HIGH', 'LOW'], new File(['HIGH'], 'priority.txt')]) {
    rejected(form({ priority }))
  }
})

test('forged ownership/status/contact/task/user/audit/previous-state keys cannot enter bulk write input', () => {
  const forged = {
    customerId: 'other', assignedSalesId: 'foreign', status: 'CLOSED', lastContactAt: '2099-01-01', nextContactAt: '2099-01-01',
    source: 'forged', note: 'private', taskId: 'task', taskPriority: 'URGENT', userId: 'user', actorId: 'admin', role: 'SUPER_ADMIN',
    teamId: 'foreign-team', createdAt: '1900-01-01', updatedAt: '1900-01-01', previousPriority: 'LOW', previousState: '{"kind":"success"}',
  }
  assert.deepEqual(parseCustomerBulkForm(form(forged)), parseCustomerBulkForm(form()))
  assert.deepEqual(Object.keys(parseCustomerBulkForm(form(forged)).data).sort(), ['customerIds', 'priority'])
})

test('bulk parsing neither mutates original order/repetitions nor changes submitted priority', () => {
  const data = form({ customerIds: ['z', 'a', 'z'] })
  const before = [...data.entries()]
  assert.equal(parseCustomerBulkForm(data).ok, true)
  assert.deepEqual([...data.entries()], before)
})
