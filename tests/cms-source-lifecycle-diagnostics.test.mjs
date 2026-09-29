import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import SafeReporter from './e2e/safe-reporter.mjs'
import { diagnosticCase, formatDiagnosticRecord, createDiagnosticOutputFilter } from '../scripts/cms-e2e/diagnostics.mjs'

// Execute the actual hook bodies with synthetic adapters. No app, browser, DB,
// staging credentials or lifecycle cleanup is started by these unit tests.
const file = 'tests/e2e/cms-sources.spec.ts'
const title = 'SRC-18 offline and lost real ACK preserve input and never duplicate create'
const location = { file, line: 1, column: 1 }
const known = { title, location }
const phases = ['SRC_TEARDOWN_DISPOSE', 'SRC_TEARDOWN_CONTEXT_CLOSE', 'SRC_TEARDOWN_RECOVER', 'SRC_TEARDOWN_DISCONNECT']
const source = await readFile(new URL('./e2e/cms-sources.spec.ts', import.meta.url), 'utf8')
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
function callback(name) {
  const body = new RegExp(`test\\.${name}\\(async \\(\\) => \\{([\\s\\S]*?)\\n\\}\\)`).exec(source)?.[1]
  assert.ok(body, `${name} callback exists`)
  return new AsyncFunction('test', 'releases', 'contexts', 'db', 'recover', body)
}
const afterEach = callback('afterEach'), afterAll = callback('afterAll')
async function execute(failures = {}, all = false) {
  const events = [], observed = []
  const perform = phase => { events.push(phase); if (failures[phase]) throw failures[phase] }
  const runner = { async step(code, work) {
    try { const result = await work(); observed.push([code, 'passed']); return result }
    catch (error) { observed.push([code, 'failed']); throw error }
  } }
  let error
  try {
    await (all ? afterAll : afterEach)(runner, [() => perform('dispose')], [{ async close() { perform('close') } }],
      { async $disconnect() { perform('disconnect') } }, async () => perform('recover'))
  } catch (caught) { error = caught }
  return { events, observed, error }
}

test('source teardown registry admits only four static codes on source cases', () => {
  const titles = [...source.matchAll(/test\('([^']+)'/g)].map(match => match[1])
  titles.push(...['admin', 'super'].map(actor => `SRC-03 ${actor} source author does not replace article ownership`),
    ...['source', 'autosave'].map(first => `SRC-13 ${first} commit conflicts with the other stale surface`))
  assert.equal(titles.length, 19)
  for (const title of titles) assert.deepEqual(diagnosticCase({ title, location }).steps.filter(code => code.startsWith('SRC_TEARDOWN_')), phases)
  for (const stepCode of phases) {
    const record = { caseId: 'SRC-18', stepCode, status: 'failed', testLocation: location,
      stepLocation: location, assertionLocation: null, assertionSource: null }
    assert.ok(formatDiagnosticRecord('DIAGNOSTIC', record))
    for (const wrong of [{ ...record, caseId: 'TAX-01', testLocation: null, stepLocation: null },
      { ...record, stepCode: `${stepCode}_arbitrary` }, { ...record, phaseDetails: 'private' }]) {
      assert.equal(formatDiagnosticRecord('DIAGNOSTIC', wrong), null)
    }
  }
})

test('actual source afterEach preserves dispose then close then recovery ordering', async () => {
  const result = await execute()
  assert.deepEqual(result.events, ['dispose', 'close', 'recover'])
  assert.deepEqual(result.observed, phases.slice(0, 3).map(code => [code, 'passed']))
  assert.equal(result.error, undefined)
})

test('actual source close rejection remains rejected after recovery finally runs', async () => {
  const failure = new Error('synthetic close'), result = await execute({ close: failure })
  assert.equal(result.error, failure)
  assert.deepEqual(result.events, ['dispose', 'close', 'recover'])
  assert.deepEqual(result.observed, [[phases[0], 'passed'], [phases[1], 'failed'], [phases[2], 'passed']])
})

test('actual source recovery rejection and original finally precedence remain visible', async () => {
  const close = new Error('synthetic close'), recover = new Error('synthetic recovery')
  for (const failures of [{ recover }, { close, recover }]) {
    const result = await execute(failures)
    assert.equal(result.error, recover)
    assert.deepEqual(result.events, ['dispose', 'close', 'recover'])
    assert.deepEqual(result.observed.at(-1), [phases[2], 'failed'])
  }
})

test('actual source dispose failure is not swallowed and still prevents subsequent work', async () => {
  const failure = new Error('synthetic dispose'), result = await execute({ dispose: failure })
  assert.equal(result.error, failure)
  assert.deepEqual(result.events, ['dispose'])
  assert.deepEqual(result.observed, [[phases[0], 'failed']])
})

test('actual source afterAll labels disconnect without changing rejection identity', async () => {
  const failure = new Error('synthetic disconnect'), result = await execute({ disconnect: failure }, true)
  assert.equal(result.error, failure)
  assert.deepEqual(result.events, ['disconnect'])
  assert.deepEqual(result.observed, [[phases[3], 'failed']])
})

test('source phase failures survive reporter and filter while error messages and payloads do not', () => {
  const lines = [], filter = createDiagnosticOutputFilter(line => lines.push(line))
  const reporter = new SafeReporter({ write: line => filter.push(Buffer.from(line)) })
  let reads = 0
  const error = { get message() { reads++; throw Error('raw message must not be read') } }
  for (const phase of phases) reporter.onStepEnd(known, {}, { category: 'test.step', title: phase, location, error })
  reporter.onTestEnd(known, { status: 'failed', error })
  assert.equal(reporter.onEnd({ status: 'failed' }), undefined)
  filter.push(Buffer.from('CMS_E2E DIAGNOSTIC {"private":"synthetic-secret"}\n'))
  filter.end()
  const parsed = lines.map(line => JSON.parse(line.slice(line.indexOf('{'))))
  assert.deepEqual(parsed.slice(0, 4).map(row => [row.stepCode, row.status]), phases.map(code => [code, 'failed']))
  assert.equal(parsed[4].status, 'failed'); assert.equal(parsed[5].status, 'failed')
  assert.equal(parsed.length, 6); assert.equal(reads, 0)
  assert.equal(lines.join('').includes('synthetic-secret'), false)
})

test('passed source phases never turn an asynchronous failed CASE into success', () => {
  const lines = [], reporter = new SafeReporter({ write: line => lines.push(line) })
  for (const code of ['SRC_UNKNOWN_ACK', ...phases]) reporter.onStepEnd(known, {}, { category: 'test.step', title: code, location })
  reporter.onTestEnd(known, { status: 'failed', error: { message: 'synthetic async failure' } })
  assert.equal(reporter.onEnd({ status: 'failed' }), undefined)
  assert.ok(lines.at(-2).includes('"status":"failed"'))
  assert.equal(lines.join('').includes('synthetic async failure'), false)
})
