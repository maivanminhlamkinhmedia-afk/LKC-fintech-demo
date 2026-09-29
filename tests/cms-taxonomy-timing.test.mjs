import assert from 'node:assert/strict'
import test from 'node:test'
import SafeReporter from './e2e/safe-reporter.mjs'
import { formatDiagnosticRecord, createDiagnosticOutputFilter, MAX_TIMING_MS, MAX_DIAGNOSTIC_LINE_LENGTH } from '../scripts/cms-e2e/diagnostics.mjs'
import { TAXONOMY_CASES } from '../scripts/cms-e2e/taxonomy-diagnostics.mjs'

const file = 'tests/e2e/cms-taxonomy.spec.ts', location = { file, line: 79, column: 23 }
const privateText = 'SYNTHETIC_PRIVATE_QUERY_COOKIE_ROW_STACK'
const metadata = (id = 'TAX-10/11') => ({ title: TAXONOMY_CASES.find(row => row[0] === id)[1], location, timeout: 60_000 })
const record = (overrides = {}) => ({ caseId: 'TAX-10/11', phaseCode: 'TAX_REPLACE_CATEGORY', scope: 'assertion',
  status: 'failed', durationMs: 800, testOffsetMs: 59_200, bodyState: 'running', bodyElapsedMs: 59_900,
  testTimeoutMs: 60_000, location, ...overrides })
const wire = (kind, value) => `CMS_E2E ${kind} ${JSON.stringify(value)}\n`
const parse = line => { const match = /^CMS_E2E (\w+) (.+)\n$/.exec(line); return { kind: match[1], ...JSON.parse(match[2]) } }
function capture() {
  const lines = [], filter = createDiagnosticOutputFilter(line => lines.push(line))
  const reporter = new SafeReporter({ write: line => filter.push(Buffer.from(line)) })
  return { reporter, lines, records: () => lines.map(parse), filter }
}
const at = ms => new Date(1_000_000 + ms)
const phase = (title, ms, parent) => ({ category: 'test.step', title, startTime: at(ms), location, parent })

test('timing protocol roundtrips bounded exact shapes without changing legacy records', () => {
  const rows = [record(), record({ status: 'started', durationMs: 0 }),
    record({ caseId: 'TAX-08', phaseCode: 'TAX_TEARDOWN_RECOVER', scope: 'phase', bodyState: 'ended' }),
    record({ scope: 'hook', phaseCode: 'PW_BEFORE_ALL', bodyState: 'notStarted', bodyElapsedMs: 0, location: null }),
    record({ scope: 'fixture', phaseCode: 'PW_FIXTURE', durationMs: MAX_TIMING_MS })]
  const { filter, lines } = capture()
  for (const row of rows) {
    const before = structuredClone(row); Object.freeze(row)
    const line = formatDiagnosticRecord('TIMING', row)
    assert.ok(line); assert.deepEqual(row, before)
    const bytes = Buffer.from(line + '\n')
    for (const byte of bytes) filter.push(Buffer.of(byte))
    assert.deepEqual(parse(lines.at(-1)), { kind: 'TIMING', ...row })
  }
  for (const [kind, row] of [
    ['DISCOVERY', { count: 90 }], ['RESULT', { status: 'failed' }],
    ['CASE', { caseId: 'TAX-08', status: 'timedOut', testLocation: location }],
    ['DIAGNOSTIC', { caseId: 'TAX-10/11', stepCode: 'TAX_ROUNDTRIP_REPLACE', status: 'failed',
      testLocation: location, stepLocation: location, assertionLocation: location, assertionSource: 'error.location' }],
  ]) assert.equal(formatDiagnosticRecord(kind, row), wire(kind, row).trimEnd())
  filter.end()
})

test('timing rejects extra fields unknown cases phases scope status and unsafe locations', () => {
  for (const row of [
    record({ query: privateText }), record({ error: privateText }), record({ kind: privateText }),
    record({ caseId: 'UNKNOWN_CASE' }), record({ caseId: 'TAX-24-LINKS' }),
    record({ caseId: 'TAX-08' }), record({ phaseCode: privateText }),
    record({ phaseCode: 'TAX_REPLACE_CATEGORY_' + privateText }),
    record({ phaseCode: 'SRC_TEARDOWN_RECOVER' }), record({ scope: privateText }),
    record({ scope: 'hook' }), record({ phaseCode: 'PW_BEFORE_ALL' }), record({ scope: 'fixture' }),
    record({ status: 'timedOut' }), record({ bodyState: privateText }),
    record({ status: 'started', durationMs: 1 }), record({ bodyState: 'notStarted', bodyElapsedMs: 1 }),
    record({ location: { file: 'tests/e2e/cms-taxonomy-support.ts', line: 1, column: 1 } }),
    record({ location: { ...location, query: privateText } }),
    record({ location: { ...location, line: Infinity } }),
    record({ location: { ...location, column: 0 } }),
  ]) assert.equal(formatDiagnosticRecord('TIMING', row), null)
  const missing = record(); delete missing.durationMs
  assert.equal(formatDiagnosticRecord('TIMING', missing), null)
})

test('timing rejects every invalid numeric boundary including JSON null from nonfinite values', () => {
  for (const field of ['durationMs', 'testOffsetMs', 'bodyElapsedMs', 'testTimeoutMs']) {
    for (const value of [-1, 0.5, NaN, Infinity, -Infinity, MAX_TIMING_MS + 1, Number.MAX_SAFE_INTEGER, '5', null, false]) {
      const bad = record({ [field]: value })
      assert.equal(formatDiagnosticRecord('TIMING', bad), null)
      const { filter, lines } = capture(); filter.push(wire('TIMING', bad)); filter.end()
      assert.deepEqual(lines, [])
    }
    for (const value of [0, MAX_TIMING_MS]) assert.ok(formatDiagnosticRecord('TIMING', record({ [field]: value })))
  }
})

test('runner filter drops oversized forged or incomplete timing while preserving subsequent real verdict', () => {
  const { filter, lines } = capture()
  filter.push(wire('TIMING', record({ raw: privateText.repeat(MAX_DIAGNOSTIC_LINE_LENGTH) })))
  filter.push('CMS_E2E TIMING ' + 'x'.repeat(MAX_DIAGNOSTIC_LINE_LENGTH + 1) + '\n')
  filter.push(wire('TIMING', record({ phaseCode: privateText })))
  filter.push(wire('TIMING', record()))
  filter.push(wire('CASE', { caseId: 'TAX-10/11', status: 'timedOut', testLocation: location }))
  filter.push(wire('TIMING', record()).trimEnd()); filter.end()
  assert.deepEqual(lines.map(parse).map(row => row.kind), ['TIMING', 'CASE'])
  assert.equal(parse(lines.at(-1)).status, 'timedOut')
  assert.equal(lines.join('').includes(privateText), false)
})

test('reporter records assertion onset and short interruption relative to actual body, not result.duration', () => {
  const { reporter, records, lines } = capture(), known = metadata(), result = { startTime: at(0), duration: 120_000, status: 'timedOut' }
  const before = { category: 'hook', title: 'beforeAll hook', startTime: at(0), duration: 5_000 }
  reporter.onStepBegin(known, result, before); reporter.onStepEnd(known, result, before)
  const body = phase('TAX_SELECTION_ROUNDTRIP', 5_100)
  reporter.onStepBegin(known, result, body)
  const replace = phase('TAX_REPLACE_CATEGORY', 64_000, body)
  reporter.onStepBegin(known, result, replace)
  const assertion = { category: 'expect', parent: replace, location, startTime: at(64_100), duration: 700,
    get title() { throw Error('Assertion title must not be read') }, error: { message: privateText, location } }
  reporter.onStepBegin(known, result, assertion); reporter.onStepEnd(known, result, assertion)
  body.duration = 59_800; body.error = { message: privateText }
  reporter.onStepEnd(known, result, body)
  reporter.onTestEnd(known, result)
  const timed = records().filter(row => row.kind === 'TIMING' && row.scope === 'assertion')
  assert.equal(timed.length, 2)
  assert.deepEqual(timed.map(row => [row.status, row.durationMs, row.testOffsetMs, row.bodyElapsedMs]), [
    ['started', 0, 64_100, 59_000], ['failed', 700, 64_100, 59_700],
  ])
  const bodyEnd = records().find(row => row.kind === 'TIMING' && row.phaseCode === body.title && row.status === 'failed')
  assert.equal(bodyEnd.bodyElapsedMs, 59_800); assert.equal(bodyEnd.durationMs, 59_800)
  assert.equal(records().at(-1).status, 'timedOut'); assert.equal(lines.join('').includes(privateText), false)
})

test('teardown and lifecycle timing retain their own duration while completed body stays frozen', () => {
  const { reporter, records } = capture(), known = metadata('TAX-08'), result = { startTime: at(0), duration: 110_000, status: 'timedOut' }
  const body = phase('TAX_DELETE_GUARDS', 200); body.duration = 49_000
  reporter.onStepBegin(known, result, body); reporter.onStepEnd(known, result, body)
  const after = { category: 'hook', title: 'After Hooks', startTime: at(49_300), duration: 60_100, error: {} }
  reporter.onStepBegin(known, result, after)
  const recovery = phase('TAX_TEARDOWN_RECOVER', 49_500, after); recovery.duration = 59_900; recovery.error = { message: privateText }
  reporter.onStepBegin(known, result, recovery); reporter.onStepEnd(known, result, recovery)
  reporter.onStepEnd(known, result, after); reporter.onTestEnd(known, result)
  const end = records().find(row => row.kind === 'TIMING' && row.phaseCode === recovery.title && row.status === 'failed')
  assert.equal(end.durationMs, 59_900); assert.equal(end.bodyElapsedMs, 49_000); assert.equal(end.bodyState, 'ended')
  assert.equal(records().at(-1).status, 'timedOut')
  assert.equal(reporter.onEnd({ status: 'failed' }), undefined)
  assert.equal(records().at(-1).status, 'failed')
})

test('timing ignores nontarget cases raw hooks unknown phases and invalid clocks without losing CASE', () => {
  const { reporter, records, lines } = capture()
  const result = { startTime: at(0), status: 'failed' }
  const step = phase('TAX_LINKS_REGRESSION', 10); step.duration = 30
  reporter.onStepBegin(metadata('TAX-24-LINKS'), result, step); reporter.onStepEnd(metadata('TAX-24-LINKS'), result, step)
  const known = metadata()
  for (const bad of [
    { ...step, title: privateText }, { ...step, category: 'hook', title: privateText },
    { ...step, title: 'TAX_ROUNDTRIP_REPLACE', startTime: new Date(NaN) },
    { ...step, title: 'TAX_ROUNDTRIP_REPLACE', startTime: at(-1) },
    { ...step, title: 'TAX_ROUNDTRIP_REPLACE', duration: Infinity },
  ]) reporter.onStepEnd(known, result, bad)
  reporter.onStdOut(wire('TIMING', record()), known, result)
  reporter.onTestEnd(known, { status: 'failed' })
  assert.equal(records().some(row => row.kind === 'TIMING'), false)
  assert.equal(records().at(-1).status, 'failed'); assert.equal(lines.join('').includes(privateText), false)
})
