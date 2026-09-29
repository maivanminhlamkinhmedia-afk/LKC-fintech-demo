import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

// Explicit local mechanism probe. The existing sanitized Node wrapper is required.
// Only synthetic loopback Chromium and in-memory lifecycle adapters are used;
// never import/run the CMS suite, application, credentials, fixtures or real DB.
// Short budgets/delays below belong solely to this generated local configuration.
const root = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(import.meta.url), ts = require('typescript')
const source = await readFile(join(root, 'tests/e2e/cms-taxonomy.spec.ts'), 'utf8')
const ast = ts.createSourceFile('taxonomy.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const callbacks = new Map()
for (const statement of ast.statements) {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) continue
  const call = statement.expression, name = call.expression.getText(ast)
  if (['test.afterEach', 'test.afterAll'].includes(name)) {
    const callback = call.arguments[0]
    assert.ok(ts.isArrowFunction(callback) && ts.isBlock(callback.body))
    const body = callback.body.statements.map(statement => statement.getText(ast)).join('\n')
    callbacks.set(name, ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext } }).outputText)
  }
}
assert.equal(callbacks.size, 2, 'Current taxonomy lifecycle callbacks must be extracted')
const work = await mkdtemp(join(root, '.next/cms008-timeout-budget-'))
const playwright = pathToFileURL(join(root, 'node_modules/@playwright/test/index.mjs')).href
const reporter = pathToFileURL(join(root, 'tests/e2e/safe-reporter.mjs')).href
const diagnostics = pathToFileURL(join(root, 'scripts/cms-e2e/diagnostics.mjs')).href
const taxonomyDiagnostics = pathToFileURL(join(root, 'scripts/cms-e2e/taxonomy-diagnostics.mjs')).href
const cases = [
  { key: 'body-budget', budget: 1600, body: 1220, locator: 900, browser: true, status: 'timedOut' },
  { key: 'expect-budget', budget: 1600, body: 0, locator: 400, browser: true, status: 'failed' },
  { key: 'teardown-independent', budget: 650, body: 440, close: 200, recover: 180, status: 'passed' },
  { key: 'close-timeout', budget: 650, body: 440, close: 850, recover: 10, disconnect: 300, status: 'timedOut' },
  { key: 'recover-timeout', budget: 650, body: 440, close: 150, recover: 750, disconnect: 300, status: 'timedOut' },
  { key: 'async-close-timeout', budget: 650, body: 440, background: 1280, recover: 10, disconnect: 300, status: 'timedOut' },
  { key: 'fixture-shared-timeout', budget: 650, body: 100, close: 240, recover: 220, fixture: 360, disconnect: 250, status: 'timedOut' },
  { key: 'all-hooks-independent', budget: 650, beforeAll: 440, body: 440, close: 70, recover: 70, disconnect: 440, status: 'passed' },
  { key: 'afterAll-timeout', budget: 650, body: 100, close: 10, recover: 10, disconnect: 850, status: 'timedOut' },
]

for (const sample of cases) {
  await writeFile(join(work, `${sample.key}.spec.mjs`), `
import { test as base, expect, chromium } from ${JSON.stringify(playwright)};
import http from 'node:http';
import { performance } from 'node:perf_hooks';
const sample = ${JSON.stringify(sample)}, epoch = performance.now();
const mark = event => process.stdout.write('LOCAL_BUDGET_EVENT ' + JSON.stringify({ scenario: sample.key, event,
  ms: Math.round((performance.now() - epoch) * 100) / 100 }) + '\\n');
const delay = async (name, duration) => { mark(name + '-start'); await new Promise(resolve => setTimeout(resolve, duration)); mark(name + '-settle'); };
const test = base.extend({ syntheticLifetime: [async ({}, use) => {
  mark('fixture-setup'); await use(null); if (sample.fixture) await delay('fixture-teardown', sample.fixture);
}, { auto: true }] });
let browser, server, page, background;
const releases = [() => mark('dispose')], contexts = [];
const recover = async () => { await delay('recover', sample.recover ?? 0); };
const db = { async $disconnect() { await delay('disconnect', sample.disconnect ?? 0);
  if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); } };
test.beforeAll(async () => {
  mark('before-all-start');
  if (sample.beforeAll) await delay('before-all-work', sample.beforeAll);
  if (sample.browser) {
    server = http.createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>Synthetic timeout</title><p>No target option</p>'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    page = await context.newPage(); await page.goto(origin);
    contexts.push({ async close() { mark('close-start'); await context.close(); mark('close-settle'); } });
  } else contexts.push({ async close() {
    if (sample.background) { mark('close-start'); await background; mark('close-settle'); }
    else await delay('close', sample.close ?? 0);
  } });
  mark('before-all-settle');
});
test.afterEach(async () => { mark('after-each-start'); try {
  ${callbacks.get('test.afterEach')}
} finally { mark('after-each-settle'); } });
test.afterAll(async () => { mark('after-all-start'); try {
  ${callbacks.get('test.afterAll')}
} finally { mark('after-all-settle'); } });
test('Synthetic timeout budget ' + sample.key, async () => {
  mark('body-start');
  try { await test.step(sample.locator ? 'TAX_SELECTION_ROUNDTRIP' : 'TAX_DELETE_GUARDS', async () => {
    if (sample.background) background = delay('background', sample.background);
    if (sample.body) await delay('body-work', sample.body);
    if (sample.locator) {
      mark('assertion-start');
      try { await test.step('TAX_REPLACE_CATEGORY', async () => { await expect(page.locator('#absent-option')).toBeVisible({ timeout: sample.locator }); }); mark('assertion-resolve'); }
      catch (error) { mark('assertion-reject'); throw error; }
    }
  }); } finally { mark('body-settle'); }
});
`, 'utf8')
}

await writeFile(join(work, 'reporter.mjs'), `
import SafeReporter from ${JSON.stringify(reporter)};
import { createDiagnosticOutputFilter, MAX_TIMING_MS } from ${JSON.stringify(diagnostics)};
import { TAXONOMY_CASES } from ${JSON.stringify(taxonomyDiagnostics)};
const records = new Map(), results = [], pending = new Map();
const record = scenario => { let value = records.get(scenario); if (!value) { value = { events: [], steps: [], protocol: [] }; records.set(scenario, value); } return value; };
const scenarioOf = test => test.title.replace('Synthetic timeout budget ', '');
const codeOf = step => ({ 'Before Hooks': 'PW_BEFORE_HOOKS', 'After Hooks': 'PW_AFTER_HOOKS',
  'Worker Cleanup': 'PW_WORKER_CLEANUP', 'TAX_SELECTION_ROUNDTRIP': 'LOCAL_BODY', 'TAX_DELETE_GUARDS': 'LOCAL_BODY' }[step.title]
  ?? (/^TAX_TEARDOWN_(?:DISPOSE|CONTEXT_CLOSE|RECOVER|DISCONNECT)$/.test(step.title) ? step.title : null));
// Only synthetic test metadata is projected onto a static reviewed registry
// entry. Real runner result/step objects, durations, hierarchy and verdicts are
// untouched. This is not a CMS case execution or staging evidence.
const projectTest = test => ({ title: TAXONOMY_CASES.find(row => row[0] ===
  (['body-budget', 'expect-budget'].includes(scenarioOf(test)) ? 'TAX-10/11' : 'TAX-08'))[1],
  timeout: test.timeout, location: { ...test.location, file: ${JSON.stringify(join(root, 'tests/e2e/cms-taxonomy.spec.ts'))} } });
let currentScenario;
const filter = createDiagnosticOutputFilter(line => {
  if (!currentScenario) return;
  const match = /^CMS_E2E (TIMING|DIAGNOSTIC|CASE) (\\{.*\\})$/.exec(line.trim());
  if (match) record(currentScenario).protocol.push({ kind: match[1], ...JSON.parse(match[2]) });
});
export default class BudgetReporter extends SafeReporter {
  constructor() { super({ write: line => filter.push(Buffer.from(line)) }); }
  onBegin() {}
  onTestBegin(test, result) { record(scenarioOf(test)).start = result.startTime.getTime(); }
  onStepBegin(test, result, step) { currentScenario = scenarioOf(test); super.onStepBegin(projectTest(test), result, step); }
  onStdOut(chunk, test) {
    const key = test?.id ?? 'hook', text = (pending.get(key) ?? '') + chunk.toString();
    const lines = text.split(/\\r?\\n/); pending.set(key, lines.pop());
    for (const line of lines) if (line.startsWith('LOCAL_BUDGET_EVENT ')) {
      const value = JSON.parse(line.slice(19)); record(value.scenario).events.push({ event: value.event, ms: value.ms });
    }
  }
  onStepEnd(test, result, step) {
    currentScenario = scenarioOf(test); super.onStepEnd(projectTest(test), result, step);
    const code = codeOf(step); if (!code) return;
    const value = record(scenarioOf(test));
    value.steps.push({ code, category: step.category, status: step.error ? 'failed' : 'passed',
      durationMs: step.duration, testOffsetMs: step.startTime.getTime() - value.start });
  }
  onTestEnd(test, result) {
    currentScenario = scenarioOf(test); super.onTestEnd(projectTest(test), result);
    const value = record(scenarioOf(test));
    results.push({ scenario: scenarioOf(test), status: result.status, resultDurationMs: result.duration, events: value.events, steps: value.steps, protocol: value.protocol });
  }
  onStdErr() {}
  onError() { process.stdout.write('LOCAL_BUDGET_INFRASTRUCTURE_ERROR\\n'); }
  onEnd(result) { filter.end(); process.stdout.write('LOCAL_BUDGET_RESULTS ' + JSON.stringify({ status: result.status, maxTimingMs: MAX_TIMING_MS, results }) + '\\n'); }
}
`, 'utf8')
await writeFile(join(work, 'playwright.config.mjs'), `export default {
  testDir: '.', fullyParallel: false, workers: 1, retries: 0,
  reporter: [['./reporter.mjs']], preserveOutput: 'never', outputDir: './output',
  use: { trace: 'off', screenshot: 'off', video: 'off' },
  projects: ${JSON.stringify(cases.map(sample => ({ name: sample.key, testMatch: `${sample.key}.spec.mjs`, timeout: sample.budget })))},
};`, 'utf8')

// Inherit only the existing sanitized wrapper process, never a staging shell.
const child = spawnSync(process.execPath, [join(root, 'node_modules/@playwright/test/cli.js'), 'test', '--config',
  join(work, 'playwright.config.mjs')], { cwd: root, encoding: 'utf8' })
assert.equal(child.error, undefined)
assert.equal(child.status, 1, 'Deliberate synthetic timeouts/failure must keep the runner failed')
const encoded = child.stdout.split(/\r?\n/).find(line => line.startsWith('LOCAL_BUDGET_RESULTS '))
assert.ok(encoded, 'Synthetic runner must complete and return safe structured results')
assert.equal(child.stdout.includes('LOCAL_BUDGET_INFRASTRUCTURE_ERROR'), false)
const { results, maxTimingMs } = JSON.parse(encoded.slice(21))
assert.equal(results.length, cases.length)
const event = (result, name) => result.events.find(row => row.event === name)?.ms
const span = (result, start, end) => {
  const one = event(result, start), two = event(result, end)
  return one === undefined || two === undefined ? null : Math.round((two - one) * 100) / 100
}
const summary = results.map(result => ({ scenario: result.scenario, status: result.status,
  budgetMs: cases.find(row => row.key === result.scenario).budget,
  bodyMs: span(result, 'body-start', 'body-settle'), assertionStartedAfterBodyMs: span(result, 'body-start', 'assertion-start'),
  assertionMs: span(result, 'assertion-start', 'assertion-reject'),
  afterEachMs: span(result, 'after-each-start', 'after-each-settle'),
  closeMs: span(result, 'close-start', 'close-settle'), recoverMs: span(result, 'recover-start', 'recover-settle'),
  fixtureTeardownMs: span(result, 'fixture-teardown-start', 'fixture-teardown-settle'),
  beforeAllMs: span(result, 'before-all-start', 'before-all-settle'), afterAllMs: span(result, 'after-all-start', 'after-all-settle'),
  resultDurationMs: result.resultDurationMs, events: result.events, steps: result.steps,
  filteredTimingRecords: result.protocol.filter(row => row.kind === 'TIMING').length }))
// Print only synthetic enum/numeric evidence, also if a mechanism assertion fails.
console.log(JSON.stringify({ probe: 'TAXONOMY_TIMEOUT_BUDGET', node: process.version,
  playwright: require('playwright/package.json').version, childExitCode: child.status,
  evidenceDirectory: relative(root, work).replaceAll('\\', '/'), observations: summary }))
for (const sample of cases) assert.equal(results.find(row => row.scenario === sample.key).status, sample.status, sample.key)
for (const result of results) {
  const timings = result.protocol.filter(row => row.kind === 'TIMING')
  assert.ok(timings.length > 0, `${result.scenario} emits real runner timing through the production filter`)
  for (const row of timings) for (const key of ['durationMs', 'testOffsetMs', 'bodyElapsedMs', 'testTimeoutMs']) {
    assert.ok(Number.isSafeInteger(row[key]) && row[key] >= 0 && row[key] <= maxTimingMs)
  }
  assert.deepEqual(result.protocol.filter(row => row.kind === 'CASE').map(row => row.status), [result.status],
    'The timing protocol must preserve the real runner CASE verdict')
  assert.ok(timings.some(row => row.scope === 'hook' && row.phaseCode === 'PW_AFTER_HOOKS'))
  assert.ok(timings.some(row => row.scope === 'phase' && row.phaseCode === 'TAX_TEARDOWN_CONTEXT_CLOSE'))
  const body = timings.find(row => row.scope === 'phase' && ['TAX_SELECTION_ROUNDTRIP', 'TAX_DELETE_GUARDS'].includes(row.phaseCode)
    && row.status !== 'started')
  assert.ok(body && body.bodyState === 'ended')
  assert.equal(body.bodyElapsedMs, body.durationMs, 'Controlled body timing freezes at its own end')
  for (const row of timings.filter(row => row.bodyState === 'ended')) {
    assert.equal(row.bodyElapsedMs, body.durationMs, 'Later teardown must not inflate the frozen controlled-body duration')
  }
}
for (const key of ['body-budget', 'expect-budget']) assert.ok(results.find(row => row.scenario === key).protocol
  .some(row => row.kind === 'TIMING' && row.scope === 'assertion' && row.phaseCode === 'TAX_REPLACE_CATEGORY' && row.status === 'failed'))
const byKey = key => summary.find(row => row.scenario === key)
assert.ok(byKey('body-budget').assertionMs < 750, 'Body deadline must interrupt before the configured 900ms locator wait')
assert.ok(byKey('expect-budget').assertionMs >= 380 && byKey('expect-budget').assertionMs < 900,
  'The independent 400ms locator timeout must actually elapse with ample body budget')
const independent = byKey('teardown-independent')
assert.ok(independent.afterEachMs > independent.budgetMs - independent.bodyMs,
  'Passing teardown must demonstrably exceed the remaining body budget')
for (const key of ['close-timeout', 'recover-timeout', 'async-close-timeout', 'fixture-shared-timeout', 'afterAll-timeout']) {
  assert.equal(byKey(key).steps.find(row => row.code === 'LOCAL_BODY')?.status, 'passed', `${key} body step must pass`)
}
const allHooks = byKey('all-hooks-independent')
assert.ok(allHooks.beforeAllMs + allHooks.bodyMs + allHooks.afterEachMs + allHooks.afterAllMs > allHooks.budgetMs * 2)
assert.ok(allHooks.resultDurationMs < allHooks.beforeAllMs + allHooks.bodyMs + allHooks.afterEachMs,
  'result.duration is not testBegin-to-end wall time and excludes the separate all-hook slots')
console.log(JSON.stringify({ result: 'PASS', cases: cases.length, stagingRootCause: 'UNDETERMINED',
  filteredTimingRecords: results.flatMap(row => row.protocol).filter(row => row.kind === 'TIMING').length,
  filteredCaseVerdictsPreserved: true,
  note: 'Controlled synthetic delays prove installed runner budget mechanisms, not the cause of either staging timeout.' }))
