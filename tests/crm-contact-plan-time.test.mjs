import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CONTACT_PLAN_MAX_DAYS,
  CONTACT_PLAN_TOLERANCE_MS,
  parseContactPlanForm,
  parseVietnamContactInput,
  toVietnamContactInput,
} from '../src/features/crm/contact-plan-time.ts'

const now = new Date('2026-09-14T02:30:00.000Z')
const day = 86_400_000
const localInput = (value) => new Date(value.getTime() + 7 * 3_600_000).toISOString().slice(0, 16)

function form(overrides = {}) {
  const data = new FormData()
  const fields = { customerId: 'customer-own', operation: 'SET', nextContactAt: '2026-09-15T09:30', ...overrides }
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null) for (const item of Array.isArray(value) ? value : [value]) data.append(key, item)
  }
  return data
}

function rejected(data, instant = now) {
  const result = parseContactPlanForm(data, instant)
  assert.equal(result.ok, false)
  assert.equal(typeof result.message, 'string')
  assert.ok(result.message.trim().length > 0)
  assert.equal('data' in result, false)
}

test('Vietnam local contact input converts to exact UTC across calendar boundaries', () => {
  const examples = [
    ['2026-09-15T09:30', '2026-09-15T02:30:00.000Z'],
    ['2026-09-15T00:00', '2026-09-14T17:00:00.000Z'],
    ['2026-09-15T23:59', '2026-09-15T16:59:00.000Z'],
    ['2026-10-01T00:00', '2026-09-30T17:00:00.000Z'],
    ['2027-01-01T00:00', '2026-12-31T17:00:00.000Z'],
    ['2024-02-29T00:00', '2024-02-28T17:00:00.000Z'],
    ['2000-02-29T23:59', '2000-02-29T16:59:00.000Z'],
    ['2400-02-29T12:45', '2400-02-29T05:45:00.000Z'],
  ]
  for (const [input, expected] of examples) {
    const parsed = parseVietnamContactInput(input)
    assert.ok(parsed instanceof Date, input)
    assert.equal(parsed.toISOString(), expected, input)
    assert.equal(toVietnamContactInput(parsed), input, input)
  }
})

test('date parser rejects impossible calendar values without JavaScript normalization', () => {
  for (const input of [
    '2026-02-29T09:30', '1900-02-29T09:30', '2100-02-29T09:30',
    '2026-04-31T09:30', '2026-06-31T09:30', '2026-09-31T09:30', '2026-11-31T09:30',
    '2026-00-15T09:30', '2026-13-15T09:30', '2026-09-00T09:30', '2026-09-32T09:30',
    '2026-09-15T24:00', '2026-09-15T25:30', '2026-09-15T09:60', '2026-09-15T09:99',
  ]) assert.equal(parseVietnamContactInput(input), null, input)
})

test('input grammar accepts only exact minute-precision local timestamps, without trimming or timezone suffixes', () => {
  for (const input of [
    '', ' ', '\t\r\n', '2026-09-15', '2026-9-15T09:30', '2026-09-5T09:30',
    '2026-09-15T9:30', '2026-09-15T09:3', '2026-09-15 09:30', '2026-09-15t09:30',
    ' 2026-09-15T09:30', '2026-09-15T09:30 ', '2026-09-15T09:30\n',
    '2026-09-15T09:30:00', '2026-09-15T09:30:00.000', '2026-09-15T09:30Z',
    '2026-09-15T09:30+07:00', '2026-09-15T09:30-05:00', '2026-09-15T09:30 Asia/Ho_Chi_Minh',
    '2026-09-15T09:30\u0000', '2026-09-15T09:30\u007f', '2026-09-15T09:\u000130',
    '２０２６-０９-１５T０９:３０', 'x'.repeat(5000),
  ]) assert.equal(parseVietnamContactInput(input), null, JSON.stringify(input))
  for (const input of [null, undefined, 0, true, {}, [], ['2026-09-15T09:30'], new Date(), new Blob(['date'])]) {
    assert.equal(parseVietnamContactInput(input), null)
  }
})

test('converted UTC dates remain inside MySQL DATETIME year bounds', () => {
  for (const input of ['0000-01-01T07:00', '0099-01-01T07:00', '0999-12-31T23:59', '1000-01-01T00:00', '1000-01-01T06:59', '10000-01-01T00:00']) {
    assert.equal(parseVietnamContactInput(input), null, input)
  }
  for (const [input, expected] of [
    ['1000-01-01T07:00', '1000-01-01T00:00:00.000Z'],
    ['9999-12-31T23:59', '9999-12-31T16:59:00.000Z'],
  ]) assert.equal(parseVietnamContactInput(input)?.toISOString(), expected)
})

test('parsing and input formatting are independent of the host timezone and DST', () => {
  const previous = process.env.TZ
  try {
    for (const timezone of ['UTC', 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Ho_Chi_Minh']) {
      process.env.TZ = timezone
      for (const [input, expected] of [
        ['2026-03-08T02:30', '2026-03-07T19:30:00.000Z'],
        ['2026-11-01T01:30', '2026-10-31T18:30:00.000Z'],
        ['2026-09-15T09:30', '2026-09-15T02:30:00.000Z'],
        ['2027-01-01T00:00', '2026-12-31T17:00:00.000Z'],
      ]) {
        assert.equal(parseVietnamContactInput(input)?.toISOString(), expected, timezone)
        assert.equal(toVietnamContactInput(new Date(expected)), input, timezone)
      }
    }
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
})

test('input formatting handles null and exposes minute precision without altering the Date', () => {
  assert.equal(toVietnamContactInput(null), '')
  const date = new Date('2026-09-15T02:30:45.678Z')
  assert.equal(toVietnamContactInput(date), '2026-09-15T09:30')
  assert.equal(date.toISOString(), '2026-09-15T02:30:45.678Z')
})

test('SET parses a future contact plan and CLEAR explicitly produces only a null plan', () => {
  assert.deepEqual(parseContactPlanForm(form(), now), {
    ok: true,
    data: { customerId: 'customer-own', operation: 'SET', nextContactAt: new Date('2026-09-15T02:30:00.000Z') },
  })
  assert.deepEqual(parseContactPlanForm(form({ operation: 'CLEAR', nextContactAt: null }), now), {
    ok: true, data: { customerId: 'customer-own', operation: 'CLEAR', nextContactAt: null },
  })
})

test('SET requires exactly one string customer ID, operation and timestamp', () => {
  for (const key of ['customerId', 'operation', 'nextContactAt']) {
    const valid = form().get(key)
    for (const value of [null, [valid, valid], [valid, 'forged'], new Blob(['value'])]) rejected(form({ [key]: value }))
  }
  for (const data of [null, undefined, {}, 'not a form', { get: () => 'forged', getAll: () => ['forged'] }]) rejected(data)
})

test('customer IDs and operations use strict whitelists for both SET and CLEAR', () => {
  for (const operation of ['SET', 'CLEAR']) {
    const fields = operation === 'CLEAR' ? { operation, nextContactAt: null } : { operation }
    for (const customerId of ['', ' ', ' customer-own', 'customer-own ', '../foreign', 'a/b', 'a%2Fb', 'a b', 'a&x=1', 'id\n', 'id\u0000', 'id\u007f', 'x'.repeat(192)]) {
      rejected(form({ ...fields, customerId }))
    }
    for (const customerId of ['a', 'cuid_123-ABC', 'x'.repeat(191)]) {
      assert.equal(parseContactPlanForm(form({ ...fields, customerId }), now).ok, true)
    }
  }
  for (const operation of ['', ' ', 'set', 'clear', ' SET', 'CLEAR ', 'UPDATE', 'DELETE', 'SET\n', 'CLEAR\u0000', 'x'.repeat(5000)]) {
    rejected(form({ operation }))
  }
})

test('CLEAR requires explicit singleton identity/operation and rejects any submitted timestamp', () => {
  for (const key of ['customerId', 'operation']) {
    const valid = key === 'operation' ? 'CLEAR' : 'customer-own'
    for (const value of [null, [valid, valid], [valid, 'forged'], new Blob(['value'])]) {
      rejected(form({ operation: 'CLEAR', nextContactAt: null, [key]: value }))
    }
  }
  for (const nextContactAt of ['', ' ', '2026-09-15T09:30', 'invalid', ['', ''], new Blob(['value'])]) {
    rejected(form({ operation: 'CLEAR', nextContactAt }))
  }
})

test('SET returns validation errors for empty, malformed, impossible and clearly past plans', () => {
  for (const nextContactAt of ['', ' ', '\t', '2026-09-15T09:30\n', 'bad', '2026-02-29T09:30', '2026-09-15T09:30Z', '2020-01-01T09:30']) {
    rejected(form({ nextContactAt }))
  }
})

test('scheduling accepts exactly the inclusive 60-second tolerance and rejects the next millisecond', () => {
  assert.equal(CONTACT_PLAN_TOLERANCE_MS, 60_000)
  const earliest = localInput(new Date(now.getTime() - CONTACT_PLAN_TOLERANCE_MS))
  assert.equal(parseContactPlanForm(form({ nextContactAt: earliest }), now).ok, true)
  rejected(form({ nextContactAt: earliest }), new Date(now.getTime() + 1))
  assert.equal(parseContactPlanForm(form({ nextContactAt: localInput(now) }), now).ok, true)
  rejected(form({ nextContactAt: localInput(new Date(now.getTime() - 120_000)) }))
})

test('scheduling has an inclusive 1095-day upper bound and never silently clamps distant plans', () => {
  assert.equal(CONTACT_PLAN_MAX_DAYS, 1095)
  const latest = new Date(now.getTime() + CONTACT_PLAN_MAX_DAYS * day)
  const atLimit = parseContactPlanForm(form({ nextContactAt: localInput(latest) }), now)
  assert.equal(atLimit.ok, true)
  assert.equal(atLimit.data.nextContactAt.getTime(), latest.getTime())
  rejected(form({ nextContactAt: localInput(latest) }), new Date(now.getTime() - 1))
  rejected(form({ nextContactAt: localInput(new Date(latest.getTime() + 60_000)) }))
  rejected(form({ nextContactAt: '9999-12-31T23:59' }))
})

test('invalid clock input fails safely instead of allowing an unbounded schedule', () => {
  for (const operation of ['SET', 'CLEAR']) {
    rejected(form({ operation, ...(operation === 'CLEAR' ? { nextContactAt: null } : {}) }), new Date('invalid'))
  }
})

test('forged ownership, history, task, role and action-state fields cannot enter the parsed write shape', () => {
  const forged = {
    assignedSalesId: ['foreign-sales', 'another-sales'], lastContactAt: '2099-01-01',
    status: 'CLOSED', priority: 'HIGH', taskId: 'foreign-task', assignedToId: 'foreign-assignee',
    actorId: 'admin', role: 'SUPER_ADMIN', teamId: 'foreign-team', updatedAt: '1900-01-01',
    customerActivityId: 'historical-activity', note: 'private body', previousState: '{"kind":"success"}',
  }
  for (const operation of ['SET', 'CLEAR']) {
    const fields = { operation, ...(operation === 'CLEAR' ? { nextContactAt: null } : {}) }
    const expected = parseContactPlanForm(form(fields), now)
    const actual = parseContactPlanForm(form({ ...fields, ...forged }), now)
    assert.deepEqual(actual, expected)
    assert.deepEqual(Object.keys(actual.data).sort(), ['customerId', 'nextContactAt', 'operation'])
  }
})
