import assert from 'node:assert/strict'
import test from 'node:test'
import { formatDiagnosticRecord, createDiagnosticOutputFilter } from '../scripts/cms-e2e/diagnostics.mjs'
import SafeReporter from './e2e/safe-reporter.mjs'

// Pure synthetic reporter/stream callbacks only. No Playwright runner, browser,
// app, credential lookup, environment file or database is initialized here.
const FORMAT_FILE = 'tests/e2e/cms-draft.spec.ts'
const CLIP_FILE = 'tests/e2e/cms-editor-safety.spec.ts'
const FORMAT_CASE = 'EDIT-04/05/06/21'
const CLIP_CASE = 'EDIT-18'
const FORMAT_TITLE = 'EDIT-04/05/06/21 create and refresh Vietnamese formatting with no writes from GET or typing'
const CLIP_TITLE = 'EDIT-18 real HTML clipboard paste removes unsafe content and persists canonical safe links'
const PRIVATE = 'SYNTHETIC_PRIVATE_PASSWORD_COOKIE_BODY_EXPECTED_ACTUAL'
const FORMAT_STEPS = ['FMT_LOGIN', 'FMT_INPUT', 'FMT_BOLD', 'FMT_LIST', 'FMT_CODE_BLOCK',
  'FMT_NO_WRITE', 'FMT_SAVE_NAVIGATE', 'FMT_DB', 'FMT_RELOAD', 'FMT_DOM_TEXT', 'FMT_DOM_BOLD',
  'FMT_DOM_LIST', 'FMT_DOM_CODE', 'FMT_LIST_LINK', 'FMT_DASHBOARD']
const CLIP_STEPS = ['CLIP_LOGIN', 'CLIP_PERMISSION', 'CLIP_INPUT', 'CLIP_WRITE', 'CLIP_NATIVE_PASTE',
  'CLIP_SAVE_NAVIGATE', 'CLIP_DB_CANONICAL', 'CLIP_DB_LINKS', 'CLIP_RELOAD', 'CLIP_DOM_TEXT',
  'CLIP_LINK_COUNT', 'CLIP_LINK_HREF', 'CLIP_LINK_TARGET', 'CLIP_LINK_REL', 'CLIP_LINK_CLASS',
  'CLIP_LINK_TITLE', 'CLIP_DANGEROUS_ELEMENTS', 'CLIP_EVENT_ATTRIBUTES', 'CLIP_SCRIPT_EXECUTION',
  'CLIP_RELOAD_DOM_TEXT', 'CLIP_RELOAD_LINK_COUNT', 'CLIP_RELOAD_LINK_HREF', 'CLIP_RELOAD_LINK_TARGET',
  'CLIP_RELOAD_LINK_REL', 'CLIP_RELOAD_LINK_CLASS', 'CLIP_RELOAD_LINK_TITLE', 'CLIP_RELOAD_DANGEROUS_ELEMENTS',
  'CLIP_RELOAD_EVENT_ATTRIBUTES', 'CLIP_RELOAD_SCRIPT_EXECUTION']
const location = (file = FORMAT_FILE, line = 120, column = 7) => ({ file, line, column })
const testCase = (title = FORMAT_TITLE, file = FORMAT_FILE) => ({ title, location: location(file) })
const caseRecord = (overrides = {}) => ({ caseId: FORMAT_CASE, status: 'failed', testLocation: location(), ...overrides })
const diagnosticRecord = (overrides = {}) => ({
  caseId: FORMAT_CASE, stepCode: 'FMT_DOM_BOLD', status: 'failed',
  testLocation: location(), stepLocation: location(FORMAT_FILE, 140, 3),
  assertionLocation: location(FORMAT_FILE, 141, 5), assertionSource: 'error.location', ...overrides,
})
const wire = (kind, value) => `CMS_E2E ${kind} ${JSON.stringify(value)}\n`
const parse = line => {
  assert.ok(line.endsWith('\n'))
  const match = /^CMS_E2E (DISCOVERY|CASE|RESULT|DIAGNOSTIC) (.+)\n$/.exec(line)
  assert.ok(match, 'only canonical structured diagnostic lines may be emitted')
  return { kind: match[1], record: JSON.parse(match[2]) }
}
function capture() {
  const lines = []
  const reporter = new SafeReporter({ write: line => lines.push(line) })
  return { reporter, lines, records: () => lines.map(parse) }
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item)
    Object.freeze(value)
  }
  return value
}

test('diagnostic formatter emits only canonical allowlisted record shapes without mutating inputs', () => {
  const valid = [
    ['DISCOVERY', { count: 0 }], ['DISCOVERY', { count: 20 }],
    ['CASE', caseRecord()], ['CASE', caseRecord({ caseId: 'UNKNOWN_CASE', testLocation: null, status: 'unknown' })],
    ['RESULT', { status: 'failed' }], ['RESULT', { status: 'infrastructure-error-details-redacted' }],
    ['DIAGNOSTIC', diagnosticRecord()],
    ['DIAGNOSTIC', diagnosticRecord({ caseId: CLIP_CASE, stepCode: 'CLIP_LINK_HREF',
      testLocation: location(CLIP_FILE), stepLocation: null, assertionLocation: null, assertionSource: null })],
  ]
  for (const [kind, record] of valid) {
    const before = structuredClone(record)
    freeze(record)
    assert.equal(formatDiagnosticRecord(kind, record), wire(kind, record).trimEnd())
    assert.deepEqual(record, before)
  }
  for (const status of ['passed', 'failed', 'timedOut', 'skipped', 'interrupted', 'unknown']) {
    assert.notEqual(formatDiagnosticRecord('CASE', caseRecord({ status })), null)
  }
  for (const status of ['passed', 'failed', 'timedout', 'interrupted', 'unknown', 'infrastructure-error-details-redacted']) {
    assert.notEqual(formatDiagnosticRecord('RESULT', { status }), null)
  }
})

test('diagnostic formatter rejects unknown fields/types/enums and case-step crossmapping', () => {
  const rejected = [
    ['RAW', { message: PRIVATE }], ['RESULT', { status: PRIVATE }], ['RESULT', { status: 'failed', message: PRIVATE }],
    ['RESULT', null], ['RESULT', []], ['RESULT', 'failed'], ['RESULT', {}],
    ['DISCOVERY', { count: '20' }], ['DISCOVERY', { count: -1 }], ['DISCOVERY', { count: 1.5 }],
    ['DISCOVERY', { count: Number.NaN }], ['DISCOVERY', { count: Number.POSITIVE_INFINITY }],
    ['DISCOVERY', { count: Number.MAX_SAFE_INTEGER + 1 }], ['DISCOVERY', { count: 20, secret: PRIVATE }],
    ['CASE', caseRecord({ caseId: PRIVATE })], ['CASE', caseRecord({ status: PRIVATE })],
    ['CASE', { ...caseRecord(), title: PRIVATE }], ['CASE', { caseId: FORMAT_CASE, status: 'failed' }],
    ['DIAGNOSTIC', diagnosticRecord({ stepCode: PRIVATE })],
    ['DIAGNOSTIC', diagnosticRecord({ caseId: CLIP_CASE, stepCode: 'FMT_DOM_BOLD', testLocation: location(CLIP_FILE) })],
    ['DIAGNOSTIC', diagnosticRecord({ stepCode: 'CLIP_LINK_HREF' })],
    ['DIAGNOSTIC', diagnosticRecord({ status: 'timedOut' })],
    ['DIAGNOSTIC', diagnosticRecord({ assertionSource: PRIVATE })],
    ['DIAGNOSTIC', diagnosticRecord({ assertionSource: null })],
    ['DIAGNOSTIC', diagnosticRecord({ assertionLocation: null })],
    ['DIAGNOSTIC', diagnosticRecord({ status: 'passed' })],
    ['DIAGNOSTIC', { ...diagnosticRecord(), message: PRIVATE }],
  ]
  for (const [kind, record] of rejected) assert.equal(formatDiagnosticRecord(kind, record), null)
})

test('diagnostic locations reject unsafe paths, coordinates and nested extra fields', () => {
  const unsafeFiles = [PRIVATE, '../tests/e2e/cms-draft.spec.ts', './tests/e2e/cms-draft.spec.ts',
    'tests/e2e/../e2e/cms-draft.spec.ts', 'tests\\e2e\\cms-draft.spec.ts', '/tmp/tests/e2e/cms-draft.spec.ts',
    'C:\\private\\tests\\e2e\\cms-draft.spec.ts', 'file:///tests/e2e/cms-draft.spec.ts',
    'tests/e2e/cms-draft.spec.ts?password=private', 'tests/e2e/cms-draft.spec.ts\nPRIVATE', 'tests/e2e/unknown.spec.ts']
  const badCoordinates = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '12', null]
  for (const file of unsafeFiles) {
    assert.equal(formatDiagnosticRecord('CASE', caseRecord({ testLocation: location(file) })), null)
    assert.equal(formatDiagnosticRecord('DIAGNOSTIC', diagnosticRecord({ assertionLocation: location(file) })), null)
  }
  for (const coordinate of badCoordinates) for (const field of ['line', 'column']) {
    assert.equal(formatDiagnosticRecord('CASE', caseRecord({ testLocation: { ...location(), [field]: coordinate } })), null)
  }
  for (const bad of [{ ...location(), source: PRIVATE }, { file: FORMAT_FILE, line: 1 }, {}, [], PRIVATE]) {
    assert.equal(formatDiagnosticRecord('CASE', caseRecord({ testLocation: bad })), null)
  }
})

test('reporter preserves failing outcomes, resolves only exact known title/file pairs, and never overrides onEnd status', async () => {
  const { reporter, records } = capture()
  const known = freeze(testCase())
  const failed = freeze({ status: 'failed', errors: [{ message: PRIVATE }], attachments: [{ body: PRIVATE }] })
  reporter.onBegin({}, { allTests: () => [known, testCase(CLIP_TITLE, CLIP_FILE)] })
  reporter.onTestEnd(known, failed)
  reporter.onTestEnd(freeze(testCase(CLIP_TITLE, CLIP_FILE)), freeze({ status: 'timedOut' }))
  reporter.onTestEnd(freeze(testCase(`${FORMAT_TITLE} ${PRIVATE}`)), freeze({ status: 'failed' }))
  reporter.onTestEnd(freeze(testCase(FORMAT_TITLE, CLIP_FILE)), freeze({ status: 'failed' }))
  assert.equal(await reporter.onEnd(freeze({ status: 'failed' })), undefined)
  assert.deepEqual(records(), [
    { kind: 'DISCOVERY', record: { count: 2 } },
    { kind: 'CASE', record: caseRecord() },
    { kind: 'CASE', record: caseRecord({ caseId: CLIP_CASE, status: 'timedOut', testLocation: location(CLIP_FILE) }) },
    { kind: 'CASE', record: { caseId: 'UNKNOWN_CASE', status: 'failed', testLocation: null } },
    { kind: 'CASE', record: { caseId: 'UNKNOWN_CASE', status: 'failed', testLocation: null } },
    { kind: 'RESULT', record: { status: 'failed' } },
  ])
  assert.equal(failed.status, 'failed')
})

test('reporter emits explicit static step outcomes and failed assertion locations without generated titles', () => {
  const { reporter, records } = capture()
  const known = freeze(testCase())
  const stepLocation = location(FORMAT_FILE, 140, 3)
  const errorLocation = location(FORMAT_FILE, 141, 5)
  const explicit = freeze({ category: 'test.step', title: 'FMT_DOM_BOLD', location: stepLocation })
  reporter.onStepEnd(known, { status: 'passed' }, explicit)
  let generatedTitleReads = 0
  const assertion = {
    category: 'expect', parent: explicit, location: location(FORMAT_FILE, 142, 9),
    error: freeze({ message: PRIVATE, location: errorLocation }),
    get title() { generatedTitleReads++; throw new Error('Auto-generated title must not be read') },
  }
  Object.freeze(assertion)
  reporter.onStepEnd(known, { status: 'failed' }, assertion)
  reporter.onStepEnd(known, { status: 'failed' }, freeze({ ...explicit, error: { message: PRIVATE } }))
  assert.equal(generatedTitleReads, 0)
  const rows = records()
  assert.equal(rows.length, 3)
  assert.deepEqual(rows[0], { kind: 'DIAGNOSTIC', record: diagnosticRecord({ status: 'passed',
    stepLocation, assertionLocation: null, assertionSource: null }) })
  assert.deepEqual(rows[1], { kind: 'DIAGNOSTIC', record: diagnosticRecord({ stepLocation, assertionLocation: errorLocation }) })
  assert.equal(rows[2].kind, 'DIAGNOSTIC')
  assert.equal(rows[2].record.status, 'failed')
  assert.equal(rows[2].record.stepCode, 'FMT_DOM_BOLD')
  assert.equal(JSON.stringify(rows).includes(PRIVATE), false)
})

test('all 44 approved step codes report pass/fail only for their owning case and reject raw suffixes', () => {
  assert.equal(FORMAT_STEPS.length + CLIP_STEPS.length, 44)
  for (const [caseId, title, file, codes, otherTitle, otherFile] of [
    [FORMAT_CASE, FORMAT_TITLE, FORMAT_FILE, FORMAT_STEPS, CLIP_TITLE, CLIP_FILE],
    [CLIP_CASE, CLIP_TITLE, CLIP_FILE, CLIP_STEPS, FORMAT_TITLE, FORMAT_FILE],
  ]) {
    for (const stepCode of codes) {
      const { reporter, records } = capture()
      const step = { category: 'test.step', title: stepCode, location: location(file, 150, 3) }
      reporter.onStepEnd(testCase(title, file), {}, step)
      reporter.onStepEnd(testCase(title, file), {}, { ...step, error: { message: PRIVATE } })
      reporter.onStepEnd(testCase(otherTitle, otherFile), {}, step)
      reporter.onStepEnd(testCase(title, file), {}, { ...step, title: `${stepCode} ${PRIVATE}` })
      const rows = records()
      assert.equal(rows.length, 2, stepCode)
      assert.deepEqual(rows.map(row => [row.record.caseId, row.record.stepCode, row.record.status]), [
        [caseId, stepCode, 'passed'], [caseId, stepCode, 'failed'],
      ])
      assert.equal(JSON.stringify(rows).includes(PRIVATE), false)
    }
  }
})

test('all 20 static case identities survive exact matching while unknown status becomes unknown safely', async () => {
  const definitions = [
    ['EDIT-01', 'EDIT-01 anonymous new/edit redirects to login without article metadata'],
    ['EDIT-02-CLIENT', 'EDIT-02 client direct routes deny access'],
    ['EDIT-02-ANALYST', 'EDIT-02 analyst direct routes deny access'],
    [FORMAT_CASE, FORMAT_TITLE],
    ['EDIT-07', 'EDIT-07 creator foreign ID behaves like missing ID without revealing metadata'],
    ['EDIT-08', 'EDIT-08 creator saves own DRAFT and CHANGES_REQUESTED without changing status'],
    ['EDIT-09-ADMIN', 'EDIT-09 admin edits foreign drafts without reassigning the author'],
    ['EDIT-09-SUPER', 'EDIT-09 super edits foreign drafts without reassigning the author'],
    ['EDIT-10-CREATOR', 'EDIT-10 creator cannot edit articles outside DRAFT/CHANGES_REQUESTED'],
    ['EDIT-10-ADMIN', 'EDIT-10 admin cannot edit articles outside DRAFT/CHANGES_REQUESTED'],
    ['EDIT-10-SUPER', 'EDIT-10 super cannot edit articles outside DRAFT/CHANGES_REQUESTED'],
    ['EDIT-11', 'EDIT-11 suspended or demoted actor cannot save an already-open editor'],
    ['EDIT-12', 'EDIT-12 status and owner changes after opening cannot bypass the write guard'],
    ['EDIT-13', 'EDIT-13 simultaneous saves from two tabs have one winner and preserve the losing draft'],
    ['EDIT-14', 'EDIT-14 real DATETIME(3) tokens advance by one millisecond when stored time is ahead of the clock'],
    ['EDIT-15', 'EDIT-15 canonical slug collision is a form error with no duplicate article or metadata leak'],
    ['EDIT-16', 'EDIT-16 blank body saves without an author profile'],
    ['EDIT-22', 'EDIT-22 editor works at 390/768/desktop and exposes keyboard-operable controls'],
    [CLIP_CASE, CLIP_TITLE, CLIP_FILE],
    ['EDIT-20', 'EDIT-20 offline save retains the draft, dirty app-link dismissal stays in editor, and explicit retry succeeds', CLIP_FILE],
  ]
  assert.equal(definitions.length, 20)
  const { reporter, records } = capture()
  for (const [caseId, title, file = FORMAT_FILE] of definitions) {
    reporter.onTestEnd(testCase(title, file), { status: 'failed' })
    assert.deepEqual(records().at(-1), { kind: 'CASE', record: { caseId, status: 'failed', testLocation: location(file) } })
  }
  reporter.onTestEnd(testCase(), { status: PRIVATE })
  assert.equal(records().at(-1).record.status, 'unknown')
  assert.equal(await reporter.onEnd({ status: PRIVATE }), undefined)
  assert.deepEqual(records().at(-1), { kind: 'RESULT', record: { status: 'unknown' } })
  assert.equal(JSON.stringify(records()).includes(PRIVATE), false)
})

test('assertion location falls back only to its safe step location and never invents absent coordinates', () => {
  const { reporter, records } = capture()
  const known = testCase()
  const parent = { category: 'test.step', title: 'FMT_DOM_BOLD', location: location(FORMAT_FILE, 140, 3) }
  const assertionLocation = location(FORMAT_FILE, 141, 5)
  reporter.onStepEnd(known, {}, { category: 'expect', parent, location: assertionLocation, error: { message: PRIVATE } })
  reporter.onStepEnd(known, {}, { category: 'expect', parent, error: { message: PRIVATE } })
  reporter.onStepEnd(known, {}, { category: 'expect', parent, location: { ...assertionLocation, line: 0 },
    error: { location: location('private/credentials.ts') } })
  const rows = records().map(row => row.record)
  assert.equal(rows.length, 3)
  assert.deepEqual(rows[0].assertionLocation, assertionLocation)
  assert.equal(rows[0].assertionSource, 'step.location')
  for (const row of rows.slice(1)) {
    assert.equal(row.assertionLocation, null)
    assert.equal(row.assertionSource, null)
    assert.deepEqual(row.stepLocation, parent.location)
  }
  reporter.onStepEnd(known, {}, { category: 'test.step', title: 'FMT_DOM_BOLD', error: { message: PRIVATE } })
  assert.equal(records().at(-1).record.stepLocation, null)
  assert.equal(records().at(-1).record.assertionLocation, null)
  assert.equal(records().at(-1).record.assertionSource, null)
})

test('failed expect resolves the nearest approved ancestor and safely ignores cyclic unknown parents', () => {
  const { reporter, records } = capture()
  const outer = { category: 'test.step', title: 'FMT_DOM_BOLD', location: location(FORMAT_FILE, 130, 3) }
  const inner = { category: 'test.step', title: 'FMT_DOM_TEXT', location: location(FORMAT_FILE, 140, 3), parent: outer }
  const wrapper = { category: 'test.step', title: PRIVATE, parent: inner }
  const error = { location: location(FORMAT_FILE, 141, 5), message: PRIVATE }
  reporter.onStepEnd(testCase(), {}, { category: 'expect', parent: wrapper, error, title: PRIVATE })
  assert.equal(records().length, 1)
  assert.equal(records()[0].record.stepCode, 'FMT_DOM_TEXT')
  assert.deepEqual(records()[0].record.stepLocation, inner.location)
  const cycle = { category: 'test.step', title: PRIVATE }
  cycle.parent = cycle
  reporter.onStepEnd(testCase(), {}, { category: 'expect', parent: cycle, error, title: PRIVATE })
  assert.equal(records().length, 1)
  assert.equal(JSON.stringify(records()).includes(PRIVATE), false)
})

test('reporter ignores unknown steps, successful assertions and all raw output/error payload channels', async () => {
  const { reporter, lines, records } = capture()
  let sensitiveReads = 0
  const poisoned = object => {
    for (const key of ['message', 'stack', 'cause', 'params', 'titlePath', 'subtitle', 'expected', 'actual', 'attachments', 'stdout', 'stderr']) {
      Object.defineProperty(object, key, { enumerable: true, get() { sensitiveReads++; throw new Error(PRIVATE) } })
    }
    return Object.freeze(object)
  }
  const known = poisoned(testCase())
  const result = poisoned({ status: 'failed' })
  const error = poisoned({ location: location(FORMAT_FILE, 141, 5) })
  const parent = poisoned({ category: 'test.step', title: 'FMT_DOM_BOLD', location: location(FORMAT_FILE, 140, 3) })
  reporter.onStepEnd(known, result, poisoned({ category: 'expect', parent, error, title: PRIVATE }))
  reporter.onStepEnd(known, result, { category: 'test.step', title: PRIVATE, error })
  reporter.onStepEnd(known, result, { category: 'expect', title: PRIVATE, parent })
  reporter.onStepEnd(known, result, { category: 'expect', title: PRIVATE, error })
  reporter.onStepEnd(testCase(CLIP_TITLE, CLIP_FILE), result, { category: 'test.step', title: 'FMT_DOM_BOLD', error })
  const forged = wire('CASE', caseRecord()) + wire('RESULT', { status: 'passed' }) + PRIVATE
  reporter.onStdOut(forged, known, result)
  reporter.onStdErr(Buffer.from(forged), known, result)
  reporter.onError(error)
  reporter.onTestEnd(known, result)
  assert.equal(await reporter.onEnd({ status: 'failed' }), undefined)
  assert.equal(sensitiveReads, 0)
  assert.deepEqual(records().map(row => row.kind), ['DIAGNOSTIC', 'RESULT', 'CASE', 'RESULT'])
  assert.equal(records()[1].record.status, 'infrastructure-error-details-redacted')
  assert.equal(records().at(-1).record.status, 'failed')
  assert.equal(lines.join('').includes(PRIVATE), false)
})

test('runner filter handles every byte split and mixed Buffer/string chunks without losing canonical records', () => {
  const expected = [wire('DISCOVERY', { count: 20 }), wire('CASE', caseRecord()), wire('DIAGNOSTIC', diagnosticRecord()), wire('RESULT', { status: 'failed' })]
  const input = Buffer.from(expected.join(''))
  for (let split = 0; split <= input.length; split++) {
    const lines = []
    const filter = createDiagnosticOutputFilter(line => lines.push(line))
    filter.push(input.subarray(0, split))
    filter.push(input.subarray(split))
    filter.end()
    assert.deepEqual(lines, expected, `split ${split}`)
  }
  const lines = []
  const filter = createDiagnosticOutputFilter(line => lines.push(line))
  for (let index = 0; index < input.length; index++) {
    filter.push(index % 2 ? input.subarray(index, index + 1) : input.subarray(index, index + 1).toString())
  }
  filter.end()
  assert.deepEqual(lines, expected)
})

test('runner filter survives split CRLF and multibyte UTF-8 while rejecting private raw and malformed lines', () => {
  const sensitive = `${PRIVATE}: Mật khẩu bí mật — 秘密 🔒`
  const expected = [wire('CASE', caseRecord()), wire('RESULT', { status: 'failed' })]
  const bytes = Buffer.from(expected[0].replace(/\n$/, '\r\n')
    + `${sensitive}\r\n`
    + `CMS_E2E RESULT {"status":"${sensitive}"\r\n`
    + wire('CASE', caseRecord({ caseId: sensitive })).replace(/\n$/, '\r\n')
    + expected[1].replace(/\n$/, '\r\n'), 'utf8')

  // Every byte boundary includes CR|LF and the interiors of Vietnamese, CJK,
  // and four-byte emoji code points. Rejected text must not poison the next line.
  for (let split = 0; split <= bytes.length; split++) {
    const lines = []
    const filter = createDiagnosticOutputFilter(line => lines.push(line))
    filter.push(bytes.subarray(0, split))
    filter.push(bytes.subarray(split))
    filter.end()
    assert.deepEqual(lines, expected, `UTF-8/CRLF split ${split}`)
  }
  const lines = []
  const filter = createDiagnosticOutputFilter(line => lines.push(line))
  for (let offset = 0; offset < bytes.length; offset++) filter.push(bytes.subarray(offset, offset + 1))
  filter.end()
  assert.deepEqual(lines, expected)
  assert.equal(lines.join('').includes(PRIVATE), false)
})

test('runner filter rejects forged structured output, unsafe metadata and multiline raw diagnostics', () => {
  const lines = []
  const filter = createDiagnosticOutputFilter(line => lines.push(line))
  const invalid = [
    PRIVATE, `Error: ${PRIVATE}`, `    at ${PRIVATE}`, 'CMS_E2E CASE failed',
    'CMS_E2E RESULT {"status":"failed"', wire('CASE', { ...caseRecord(), message: PRIVATE }).trimEnd(),
    wire('CASE', caseRecord({ caseId: PRIVATE })).trimEnd(), wire('RESULT', { status: PRIVATE }).trimEnd(),
    wire('RESULT', { status: 'passed', stdout: PRIVATE }).trimEnd(),
    wire('DIAGNOSTIC', diagnosticRecord({ assertionLocation: location(`/${PRIVATE}`) })).trimEnd(),
    wire('DIAGNOSTIC', diagnosticRecord({ stepCode: 'CLIP_LINK_HREF' })).trimEnd(),
  ]
  filter.push(invalid.join('\n') + '\n')
  filter.push(wire('RESULT', { status: 'failed' }))
  filter.end()
  assert.deepEqual(lines, [wire('RESULT', { status: 'failed' })])
  assert.equal(lines.join('').includes(PRIVATE), false)
})

test('runner filter drops oversized lines through the next newline and drops unterminated final fragments', () => {
  const lines = []
  const filter = createDiagnosticOutputFilter(line => lines.push(line))
  const valid = wire('RESULT', { status: 'failed' })
  filter.push('x'.repeat(4097))
  filter.push(valid.slice(0, -1))
  assert.deepEqual(lines, [])
  filter.push('\n')
  // Valid JSON with excessive insignificant whitespace would otherwise parse.
  filter.push(`CMS_E2E RESULT ${' '.repeat(4096)}{"status":"passed"}\n`)
  filter.push(valid)
  filter.push(valid.slice(0, -1))
  filter.end()
  assert.deepEqual(lines, [valid])
})

test('reporter and runner-filter integration keeps safe failure diagnostics while dropping output-channel forgeries', async () => {
  const lines = []
  const filter = createDiagnosticOutputFilter(line => lines.push(line))
  const reporter = new SafeReporter({ write: line => {
    const bytes = Buffer.from(line)
    for (let start = 0; start < bytes.length; start += 7) filter.push(bytes.subarray(start, start + 7))
  } })
  const known = testCase(CLIP_TITLE, CLIP_FILE)
  reporter.onBegin({}, { allTests: () => [known] })
  const parent = { category: 'test.step', title: 'CLIP_LINK_HREF', location: location(CLIP_FILE, 80, 3) }
  reporter.onStepEnd(known, {}, { category: 'expect', title: `expect(${PRIVATE})`, parent,
    location: location(CLIP_FILE, 81, 5), error: { message: PRIVATE, stack: PRIVATE } })
  reporter.onStdOut(wire('RESULT', { status: 'passed' }), known, { status: 'failed' })
  reporter.onStdErr(wire('CASE', caseRecord({ status: 'passed' })), known, { status: 'failed' })
  filter.push(`${PRIVATE}\n${wire('RESULT', { status: 'passed', message: PRIVATE })}`)
  reporter.onTestEnd(known, { status: 'failed', error: { message: PRIVATE }, attachments: [{ body: PRIVATE }] })
  assert.equal(await reporter.onEnd({ status: 'failed' }), undefined)
  filter.end()
  const rows = lines.map(parse)
  assert.deepEqual(rows.map(row => row.kind), ['DISCOVERY', 'DIAGNOSTIC', 'CASE', 'RESULT'])
  assert.equal(rows[1].record.caseId, CLIP_CASE)
  assert.equal(rows[1].record.stepCode, 'CLIP_LINK_HREF')
  assert.equal(rows[1].record.assertionSource, 'step.location')
  assert.equal(rows[2].record.status, 'failed')
  assert.equal(rows[3].record.status, 'failed')
  assert.equal(lines.join('').includes(PRIVATE), false)
})
