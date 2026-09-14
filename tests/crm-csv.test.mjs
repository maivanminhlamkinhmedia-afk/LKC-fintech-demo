import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { csvCell, serializeCSV } from '../src/features/crm/csv.ts'

const filterUrl = new URL('../src/features/crm/customer-export-filters.ts', import.meta.url).href
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === filterUrl && specifier === './customer-filters') return nextResolve('./customer-filters.ts', context)
    return nextResolve(specifier, context)
  },
})
let parseCustomerExportFilters, customerExportHref, CUSTOMER_EXPORT_FILTER_KEYS, MAX_CUSTOMER_EXPORT_ROWS
try { ({ parseCustomerExportFilters, customerExportHref, CUSTOMER_EXPORT_FILTER_KEYS, MAX_CUSTOMER_EXPORT_ROWS } = await import(filterUrl)) }
finally { hook.deregister() }

const parse = (query) => parseCustomerExportFilters(new URLSearchParams(query))

test('CSV always quotes fields, doubles quotes and preserves comma/CR/LF contents', () => {
  for (const [value, expected] of [
    ['ASCII', '"ASCII"'], ['a,b', '"a,b"'], ['a"b', '"a""b"'],
    ['first\rsecond', '"first\rsecond"'], ['first\nsecond', '"first\nsecond"'],
    ['first\r\nsecond, "third"', '"first\r\nsecond, ""third"""'],
    ['', '""'], [null, '""'], [undefined, '""'],
  ]) assert.equal(csvCell(value), expected)
})

test('CSV preserves Vietnamese, emoji, combining marks and ordinary interior formula characters', () => {
  for (const value of ['Nguyễn Ánh 🙂', 'e\u0301', 'customer=normal', 'a+b-c@d', '  Ordinary name  ']) {
    assert.equal(csvCell(value), `"${value}"`)
  }
})

test('every spreadsheet formula prefix is neutralized before CSV quote escaping', () => {
  for (const value of ['=1+1', '+SUM(A1:A2)', '-1+2', '@SUM(1,1)', '=HYPERLINK("https://example.test")', '"=cmd..."']) {
    assert.equal(csvCell(value), `"'${value.replace(/"/g, '""')}"`)
  }
})

test('formula defense detects leading spaces, Unicode whitespace, controls and nested quote wrappers', () => {
  for (const leading of [' ', '\t', '\r\n', '\u0000', '\u001f', '\u007f', '\u0085', '\u00a0', '\uFEFF', '"', "'", ' \t"\'']) {
    for (const prefix of ['=', '+', '-', '@']) {
      const value = `${leading}${prefix}1+1`
      assert.equal(csvCell(value), `"'${value.replace(/"/g, '""')}"`, JSON.stringify(value))
    }
  }
})

test('leading C0/C1 and DEL controls are neutralized even without an immediate formula', () => {
  for (const code of [...Array.from({ length: 32 }, (_, index) => index), ...Array.from({ length: 33 }, (_, index) => index + 127)]) {
    const value = `${String.fromCharCode(code)}ordinary`
    assert.equal(csvCell(value), `"'${value}"`, String(code))
  }
})

test('serializer emits exact UTF-8 BOM, CRLF records, final CRLF and no input mutation', () => {
  const rows = [['name', 'value'], ['Nguyễn 🙂', 'a,b'], [null, '=1+1']]
  const before = structuredClone(rows)
  const csv = serializeCSV(rows)
  assert.equal(csv, '\uFEFF"name","value"\r\n"Nguyễn 🙂","a,b"\r\n"","\'=1+1"\r\n')
  assert.deepEqual([...Buffer.from(csv, 'utf8').subarray(0, 3)], [0xef, 0xbb, 0xbf])
  assert.deepEqual(rows, before)
})

test('serializer applies formula defense to every column, including non-name user-controlled fields', () => {
  const values = ['=customer', '+name', '-email@example.test', '@sales']
  assert.equal(serializeCSV([values]), '\uFEFF"\'=customer","\'+name","\'-email@example.test","\'@sales"\r\n')
})

test('export contract has a hard 5000-row cap and only seven substantive filter keys', () => {
  assert.equal(MAX_CUSTOMER_EXPORT_ROWS, 5000)
  assert.deepEqual(CUSTOMER_EXPORT_FILTER_KEYS, ['q', 'status', 'priority', 'salesId', 'teamId', 'followUp', 'task'])
})

test('export preserves the canonical customer filter normalization and all supported predicates', () => {
  const result = parse({ q: '  Nguyễn  ', status: ' LEAD ', priority: ' HIGH ', salesId: ' sales-own ', teamId: ' team_A-1 ', followUp: ' today ', task: ' overdue ' })
  assert.deepEqual(result, {
    filters: { q: 'Nguyễn', status: 'LEAD', priority: 'HIGH', salesId: 'sales-own', teamId: 'team_A-1', followUp: 'today', task: 'overdue', page: 1 },
    invalidKeys: [],
  })
  for (const key of CUSTOMER_EXPORT_FILTER_KEYS) {
    assert.equal(parse({ [key]: ' ' }).filters[key], undefined)
    assert.deepEqual(parse({ [key]: '' }).invalidKeys, [])
  }
})

test('each malformed substantive filter is reported, never silently accepted as valid', () => {
  const cases = { q: ['x'.repeat(121), 'hello\nworld'], status: ['UNKNOWN', 'lead'], priority: ['URGENT', 'high'], salesId: ['a/b', 'x'.repeat(192)], teamId: ['../team', 'team\u0000'], followUp: ['yesterday', 'TODAY'], task: ['done', 'OVERDUE'] }
  for (const [key, values] of Object.entries(cases)) for (const value of values) {
    const result = parse({ [key]: value, q: key === 'q' ? value : 'preserved' })
    assert.deepEqual(result.invalidKeys, [key])
    assert.equal(result.filters[key], undefined)
    if (key !== 'q') assert.equal(result.filters.q, 'preserved')
  }
})

test('repeated substantive query parameters remain invalid, including repeated identical or empty values', () => {
  const valid = { q: 'name', status: 'LEAD', priority: 'HIGH', salesId: 'sales', teamId: 'team', followUp: 'today', task: 'open' }
  for (const key of CUSTOMER_EXPORT_FILTER_KEYS) for (const pair of [[valid[key], valid[key]], [valid[key], 'forged'], ['', '']]) {
    const params = new URLSearchParams()
    for (const value of pair) params.append(key, value)
    const result = parseCustomerExportFilters(params)
    assert.deepEqual(result.invalidKeys, [key])
    assert.equal(result.filters[key], undefined)
  }
})

test('pagination is ignored in all forms and unknown URL keys cannot become filters', () => {
  for (const page of ['3', '0', 'bad', 'x'.repeat(5000), '\u0000']) {
    const params = new URLSearchParams({ q: 'abc', priority: 'HIGH', page, arbitrary: 'secret' })
    params.append('page', '7')
    assert.deepEqual(parseCustomerExportFilters(params), parse({ q: 'abc', priority: 'HIGH' }))
  }
})

test('export URL uses only canonical supported filters and omits current page and forged properties', () => {
  const filters = parse({ q: '  A&B=1  ', priority: 'HIGH', teamId: 'team-1' }).filters
  const href = customerExportHref({ ...filters, page: 3, arbitrary: 'secret', customerIds: 'foreign' })
  const url = new URL(href, 'https://example.test')
  assert.equal(url.pathname, '/sales/customers/export')
  assert.deepEqual([...url.searchParams], [['q', 'A&B=1'], ['priority', 'HIGH'], ['teamId', 'team-1']])
  assert.equal(customerExportHref(parse('').filters), '/sales/customers/export')
})
