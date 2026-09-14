import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { CustomerTaskPriority, CustomerTaskStatus } from '@prisma/client'

const moduleUrl = new URL('../src/features/crm/task-plan-validation.ts', import.meta.url).href
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === moduleUrl && specifier === './contact-plan-time') return nextResolve('./contact-plan-time.ts', context)
    return nextResolve(specifier, context)
  },
})
const {
  TASK_PLAN_TITLE_MAX, TASK_PLAN_PRIORITIES, TASK_PLAN_MIN_INPUT, TASK_PLAN_MAX_INPUT,
  canPlanTask, parseTaskPlanForm,
} = await import(moduleUrl)
hook.deregister()

const version = '2026-09-14T02:30:45.678Z'
const defaults = { taskId: 'task-own', title: 'Chuẩn bị hồ sơ khách hàng', priority: 'MEDIUM', dueAt: '2026-09-15T09:30', expectedUpdatedAt: version }

function form(overrides = {}) {
  const data = new FormData()
  for (const [key, value] of Object.entries({ ...defaults, ...overrides })) {
    if (value !== null) for (const entry of Array.isArray(value) ? value : [value]) data.append(key, entry)
  }
  return data
}

function accepted(fields = {}) {
  const result = parseTaskPlanForm(form(fields))
  assert.equal(result.ok, true, JSON.stringify(fields))
  return result.data
}

function rejected(data, label = '') {
  const result = parseTaskPlanForm(data)
  assert.equal(result.ok, false, label)
  assert.equal(typeof result.message, 'string', label)
  assert.ok(result.message.trim().length > 0, label)
  assert.equal('data' in result, false, label)
}

test('planning contract uses the real priority enum, existing title limit and explicit date range', () => {
  assert.deepEqual(TASK_PLAN_PRIORITIES, Object.values(CustomerTaskPriority))
  assert.deepEqual(TASK_PLAN_PRIORITIES, ['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  assert.equal(TASK_PLAN_TITLE_MAX, 160)
  assert.equal(TASK_PLAN_MIN_INPUT, '1900-01-01T00:00')
  assert.equal(TASK_PLAN_MAX_INPUT, '2100-12-31T23:59')
})

test('valid planning input returns only canonical fields with distinct due and version timestamps', () => {
  assert.deepEqual(accepted({ title: '  Chuẩn bị hồ sơ khách hàng  ' }), {
    taskId: 'task-own', title: defaults.title, priority: CustomerTaskPriority.MEDIUM,
    dueAt: new Date('2026-09-15T02:30:00.000Z'), expectedUpdatedAt: new Date(version),
  })
})

test('all five trusted fields require exactly one string, including an explicit dueAt field', () => {
  for (const key of Object.keys(defaults)) {
    for (const value of [null, [defaults[key], defaults[key]], [defaults[key], 'forged'], new File(['value'], `${key}.txt`)]) {
      rejected(form({ [key]: value }), key)
    }
  }
  for (const value of [null, undefined, {}, 'not a form', { get: () => 'forged', getAll: () => ['forged'] }]) rejected(value)
})

test('task IDs enforce the exact existing identifier grammar and 191-character limit', () => {
  for (const taskId of ['a', 'cuid_123-ABC', 'x'.repeat(191)]) assert.equal(accepted({ taskId }).taskId, taskId)
  for (const taskId of ['', ' ', ' task-own', 'task-own ', '../foreign', 'task/id', 'task%2Fid', 'task id', 'task&x=1', 'task\n', 'task\u0000', 'task\u007f', 'x'.repeat(192)]) {
    rejected(form({ taskId }), JSON.stringify(taskId))
  }
})

test('title is required after whitespace trimming and never silently truncated', () => {
  for (const title of ['', ' ', '\u00a0\u2003', '\t\r\n']) rejected(form({ title }), JSON.stringify(title))
  const title = 'ế'.repeat(TASK_PLAN_TITLE_MAX)
  assert.equal(accepted({ title: `  ${title}\u00a0` }).title, title)
  rejected(form({ title: `${title}x` }), '161 UTF-16 units')
  rejected(form({ title: 'x'.repeat(5000) }), 'very long title')
})

test('title length uses UTF-16 units with exact Vietnamese and astral Unicode boundaries', () => {
  assert.equal(accepted({ title: 'Đ'.repeat(160) }).title, 'Đ'.repeat(160))
  assert.equal(accepted({ title: '🙂'.repeat(80) }).title, '🙂'.repeat(80))
  rejected(form({ title: '🙂'.repeat(80) + 'a' }))
  rejected(form({ title: '🙂'.repeat(81) }))
  assert.equal(accepted({ title: 'e\u0301'.repeat(80) }).title, 'e\u0301'.repeat(80))
})

test('title rejects every C0 and DEL control even on edges that trim would remove', () => {
  const controls = Array.from({ length: 32 }, (_, index) => String.fromCharCode(index)).concat('\u007f')
  for (const control of controls) for (const title of [`${control}Task`, `Task${control}`, `Ta${control}sk`]) {
    rejected(form({ title }), JSON.stringify(title))
  }
})

test('title preserves Vietnamese, combining marks and HTML-looking content as literal text', () => {
  for (const title of ['Nguyễn Ánh — chuẩn bị hồ sơ 🙂; NFD: e\u0301', '<script>alert("x")</script><img src=x onerror=alert(1)> & "quote"']) {
    assert.equal(accepted({ title: `  ${title}  ` }).title, title)
  }
})

test('priority accepts every real enum value but rejects casing, whitespace and forged variants', () => {
  for (const priority of Object.values(CustomerTaskPriority)) assert.equal(accepted({ priority }).priority, priority)
  for (const priority of ['', 'low', 'Medium', ' HIGH', 'URGENT ', 'URGENT\n', 'LOW\u0000', 'HIGH\u007f', 'CRITICAL', 'DONE', 'x'.repeat(5000)]) {
    rejected(form({ priority }), JSON.stringify(priority))
  }
})

test('explicit empty dueAt clears while omitted, whitespace, null-like, repeated and file fields fail', () => {
  assert.equal(accepted({ dueAt: '' }).dueAt, null)
  for (const dueAt of [null, ' ', '\t', '\n', 'null', 'undefined', ['', ''], new File([''], 'date.txt')]) rejected(form({ dueAt }))
  const cleared = accepted({ dueAt: '' })
  assert.equal(cleared.title, defaults.title)
  assert.equal(cleared.priority, defaults.priority)
  assert.equal(cleared.expectedUpdatedAt.toISOString(), version)
})

test('due dates use exact UTC+7 conversion at minute, day, month, year and leap-day boundaries', () => {
  for (const [dueAt, expected] of [
    ['2026-09-15T09:30', '2026-09-15T02:30:00.000Z'],
    ['2026-09-15T00:00', '2026-09-14T17:00:00.000Z'],
    ['2026-09-15T23:59', '2026-09-15T16:59:00.000Z'],
    ['2026-10-01T00:00', '2026-09-30T17:00:00.000Z'],
    ['2027-01-01T00:00', '2026-12-31T17:00:00.000Z'],
    ['2024-02-29T00:00', '2024-02-28T17:00:00.000Z'],
    ['2000-02-29T23:59', '2000-02-29T16:59:00.000Z'],
  ]) assert.equal(accepted({ dueAt }).dueAt.toISOString(), expected, dueAt)
})

test('due date range includes legitimate past plans and both exact bounds without clamping', () => {
  for (const [dueAt, expected] of [
    ['1900-01-01T00:00', '1899-12-31T17:00:00.000Z'],
    ['2001-01-01T12:00', '2001-01-01T05:00:00.000Z'],
    ['2100-12-31T23:59', '2100-12-31T16:59:00.000Z'],
  ]) assert.equal(accepted({ dueAt }).dueAt.toISOString(), expected)
  for (const dueAt of ['1899-12-31T23:59', '2101-01-01T00:00', '1000-01-01T07:00', '9999-12-31T23:59']) {
    rejected(form({ dueAt }), dueAt)
  }
})

test('due dates reject normalized impossible dates and numeric component overflow', () => {
  for (const dueAt of [
    '1900-02-29T09:30', '2100-02-29T09:30', '2026-02-29T09:30', '2026-04-31T09:30',
    '2026-06-31T09:30', '2026-09-31T09:30', '2026-11-31T09:30',
    '2026-00-15T09:30', '2026-13-15T09:30', '2026-09-00T09:30', '2026-09-32T09:30',
    '2026-09-15T24:00', '2026-09-15T25:30', '2026-09-15T09:60', '2026-09-15T09:99',
  ]) rejected(form({ dueAt }), dueAt)
})

test('due date grammar allows only exact local minute precision with no trimming or timezone suffix', () => {
  for (const dueAt of [
    '2026-09-15', '2026-9-15T09:30', '2026-09-5T09:30', '2026-09-15T9:30', '2026-09-15T09:3',
    '2026-09-15 09:30', '2026-09-15t09:30', ' 2026-09-15T09:30', '2026-09-15T09:30 ',
    '2026-09-15T09:30:00', '2026-09-15T09:30:00.000', '2026-09-15T09:30Z',
    '2026-09-15T09:30+07:00', '2026-09-15T09:30-05:00', '2026-09-15T09:30 Asia/Ho_Chi_Minh',
    '2026-09-15T09:30\n', '2026-09-15T09:30\u0000', '2026-09-15T09:30\u007f',
    '２０２６-０９-１５T０９:３０', 'x'.repeat(5000),
  ]) rejected(form({ dueAt }), JSON.stringify(dueAt))
})

test('due and version parsing remain host-timezone independent including DST and year rollover', () => {
  const previous = process.env.TZ
  try {
    for (const timezone of ['UTC', 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Ho_Chi_Minh']) {
      process.env.TZ = timezone
      for (const [dueAt, expected] of [
        ['2026-03-08T02:30', '2026-03-07T19:30:00.000Z'],
        ['2026-11-01T01:30', '2026-10-31T18:30:00.000Z'],
        ['2027-01-01T00:00', '2026-12-31T17:00:00.000Z'],
      ]) {
        const parsed = accepted({ dueAt })
        assert.equal(parsed.dueAt.toISOString(), expected, timezone)
        assert.equal(parsed.expectedUpdatedAt.toISOString(), version, timezone)
      }
    }
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
})

test('expectedUpdatedAt accepts canonical millisecond ISO UTC versions independently of due-date range', () => {
  for (const expectedUpdatedAt of ['1000-01-01T00:00:00.000Z', '2000-02-29T23:59:59.999Z', version, '9999-12-31T23:59:59.999Z']) {
    assert.equal(accepted({ expectedUpdatedAt }).expectedUpdatedAt.toISOString(), expectedUpdatedAt)
  }
})

test('expectedUpdatedAt rejects impossible, noncanonical, imprecise, zoned and control-bearing versions', () => {
  for (const expectedUpdatedAt of [
    '', ' ', 'not-a-date', '0000-01-01T00:00:00.000Z', '0999-12-31T23:59:59.999Z', '+010000-01-01T00:00:00.000Z',
    '2026-02-29T00:00:00.000Z', '2026-04-31T00:00:00.000Z', '2026-13-01T00:00:00.000Z',
    '2026-09-14T24:00:00.000Z', '2026-09-14T02:60:00.000Z', '2026-09-14T02:30:60.000Z',
    '2026-09-14T02:30', '2026-09-14T02:30:45Z', '2026-09-14T02:30:45.67Z', '2026-09-14T02:30:45.6789Z',
    '2026-09-14T02:30:45.678', '2026-09-14T02:30:45.678+00:00', '2026-09-14T09:30:45.678+07:00',
    '2026-09-14t02:30:45.678z', '2026-9-14T02:30:45.678Z', ` ${version}`, `${version} `,
    `${version}\n`, `${version}\u0000`, `${version}\u007f`, 'x'.repeat(5000),
  ]) rejected(form({ expectedUpdatedAt }), JSON.stringify(expectedUpdatedAt))
})

test('only actual open task statuses are eligible for planning without reopening terminal tasks', () => {
  for (const status of Object.values(CustomerTaskStatus)) assert.equal(canPlanTask(status), ['TODO', 'IN_PROGRESS'].includes(status), status)
  for (const status of ['', 'todo', ' TODO', 'IN_PROGRESS ', 'DONE\n', 'ARCHIVED', 'OPEN']) assert.equal(canPlanTask(status), false)
})

test('forged identity, ownership, status, completion, contact and audit fields never enter parsed data', () => {
  const forged = {
    customerId: ['foreign-customer', 'another-customer'], assignedToId: 'foreign-assignee', status: 'DONE',
    completedAt: '2099-01-01', createdAt: '1900-01-01', updatedAt: '2099-01-01', description: 'Sensitive private description',
    customerAssignedSalesId: 'foreign-owner', nextContactAt: '2099-01-01', lastContactAt: '2099-01-01',
    teamId: 'foreign-team', actorId: 'forged-admin', role: 'SUPER_ADMIN', operation: 'DELETE',
    previousState: '{"kind":"success"}', changedFields: ['status', 'assignedToId'],
  }
  for (const dueAt of [defaults.dueAt, '']) {
    const result = accepted({ ...forged, dueAt })
    assert.deepEqual(result, accepted({ dueAt }))
    assert.deepEqual(Object.keys(result).sort(), ['dueAt', 'expectedUpdatedAt', 'priority', 'taskId', 'title'])
  }
})

test('parsing does not mutate source form values, even when the result trims title or clears dueAt', () => {
  for (const dueAt of [defaults.dueAt, '']) {
    const data = form({ title: '  Tiêu đề gốc  ', dueAt })
    const before = [...data.entries()]
    assert.equal(parseTaskPlanForm(data).ok, true)
    assert.deepEqual([...data.entries()], before)
  }
})
