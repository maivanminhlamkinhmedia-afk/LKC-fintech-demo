import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { relative, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// Standalone synthetic Playwright lifecycle probe, never the guarded CMS suite.
// Run with the filtered Node 22 environment from the implementation report.
// No browser, application, credentials, real DB or fixture operation is started.
const root = fileURLToPath(new URL('../../', import.meta.url))
const sourcePath = join(root, 'tests/e2e/cms-sources.spec.ts')
const source = await readFile(sourcePath, 'utf8')
const afterEach = /test\.afterEach\(async \(\) => \{([\s\S]*?)\n\}\)/.exec(source)?.[1]
const afterAll = /test\.afterAll\(async \(\) => \{([\s\S]*?)\n\}\)/.exec(source)?.[1]
assert.ok(afterEach && afterAll, 'Actual source lifecycle callbacks must be extractable')
const directory = await mkdtemp(join(root, '.next/cms008-src18-lifecycle-'))
const playwright = pathToFileURL(join(root, 'node_modules/@playwright/test/index.mjs')).href
const reporter = pathToFileURL(join(root, 'tests/e2e/safe-reporter.mjs')).href
const diagnostics = pathToFileURL(join(root, 'scripts/cms-e2e/diagnostics.mjs')).href
const expected = { success: 'passed', close: 'failed', recover: 'failed', disconnect: 'failed', asynchronous: 'failed' }
const phases = ['SRC_TEARDOWN_DISPOSE', 'SRC_TEARDOWN_CONTEXT_CLOSE', 'SRC_TEARDOWN_RECOVER', 'SRC_TEARDOWN_DISCONNECT']

// Identical callback bodies from the current working tree, with explicitly
// synthetic adapters. Failures are injected separately; none represents an
// observed cause of the original staging failure.
for (const scenario of Object.keys(expected)) {
  await writeFile(join(directory, `${scenario}.spec.mjs`), `
import { test, expect } from ${JSON.stringify(playwright)};
const scenario = ${JSON.stringify(scenario)};
const events = [];
const releases = [() => events.push('dispose')];
const contexts = [{ async close() {
  events.push('close');
  if (scenario === 'close') throw Error('SYNTHETIC_CLOSE');
  if (scenario === 'asynchronous') await new Promise(resolve => setTimeout(resolve, 30));
} }];
const db = { async $disconnect() { events.push('disconnect'); if (scenario === 'disconnect') throw Error('SYNTHETIC_DISCONNECT'); } };
const recover = async () => { events.push('recover'); if (scenario === 'recover') throw Error('SYNTHETIC_RECOVER'); };
test.afterEach(async () => { ${afterEach} });
test.afterAll(async () => { ${afterAll} });
test('SRC-18 offline and lost real ACK preserve input and never duplicate create', async () => {
  await test.step('SRC_UNKNOWN_ACK', async () => {
    let attempts = 0;
    await expect.poll(() => ++attempts, { intervals: [1] }).toBeGreaterThan(2);
    expect(events).toEqual([]);
  });
  if (scenario === 'asynchronous') setImmediate(() => { void Promise.reject(Error('SYNTHETIC_ASYNCHRONOUS')); });
});
`, 'utf8')
}

await writeFile(join(directory, 'reporter.mjs'), `
import SafeReporter from ${JSON.stringify(reporter)};
import { createDiagnosticOutputFilter } from ${JSON.stringify(diagnostics)};
const knownFile = ${JSON.stringify(sourcePath)};
const phases = ${JSON.stringify(phases)};
const projectTest = test => ({ title: test.title, location: { ...test.location, file: knownFile } });
export default class ProbeReporter extends SafeReporter {
  constructor() {
    const filter = createDiagnosticOutputFilter(line => process.stdout.write(line));
    super({ write: line => filter.push(Buffer.from(line)) });
    this.filter = filter;
    this.phases = new Map();
  }
  onStepEnd(test, result, step) {
    super.onStepEnd(projectTest(test), result, step);
    if (step.category === 'test.step' && phases.includes(step.title)) {
      const records = this.phases.get(test.id) ?? [];
      records.push({ phase: step.title, status: step.error ? 'failed' : 'passed' });
      this.phases.set(test.id, records);
    }
  }
  onTestEnd(test, result) {
    super.onTestEnd(projectTest(test), result);
    const scenario = test.location.file.replaceAll('\\\\', '/').split('/').at(-1).replace('.spec.mjs', '');
    process.stdout.write('LOCAL_LIFECYCLE ' + JSON.stringify({ scenario, status: result.status, phases: this.phases.get(test.id) ?? [] }) + '\\n');
  }
  onEnd(result) { super.onEnd(result); this.filter.end(); }
}
`, 'utf8')
await writeFile(join(directory, 'playwright.config.mjs'), `
export default {
  testDir: '.', testMatch: '*.spec.mjs', workers: 1, retries: 0, fullyParallel: false,
  reporter: [['./reporter.mjs']], preserveOutput: 'never', outputDir: './output',
  use: { trace: 'off', screenshot: 'off', video: 'off' }
};
`, 'utf8')

// Inherit only the already filtered environment of this local probe. The report
// command is required; never run this probe from an inherited staging shell.
const result = spawnSync(process.execPath, [join(root, 'node_modules/@playwright/test/cli.js'),
  'test', '--config', join(directory, 'playwright.config.mjs')], { cwd: root, encoding: 'utf8' })
assert.equal(result.error, undefined)
assert.equal(result.status, 1, 'Injected failing cases must retain a failed runner verdict')
const lines = result.stdout.trim().split(/\r?\n/)
const outcomes = lines.filter(line => line.startsWith('LOCAL_LIFECYCLE ')).map(line => JSON.parse(line.slice(16)))
assert.deepEqual(Object.fromEntries(outcomes.map(row => [row.scenario, row.status])), expected)
const diagnosticRows = lines.filter(line => line.startsWith('CMS_E2E DIAGNOSTIC ')).map(line => JSON.parse(line.slice(19)))
const cases = lines.filter(line => line.startsWith('CMS_E2E CASE ')).map(line => JSON.parse(line.slice(13)))
assert.equal(cases.length, 5)
const bodySteps = diagnosticRows.filter(row => row.stepCode === 'SRC_UNKNOWN_ACK')
assert.equal(bodySteps.filter(row => row.status === 'passed').length, 5)
assert.equal(bodySteps.filter(row => row.status === 'failed').length, 10)
for (const [scenario, phase] of [['close', phases[1]], ['recover', phases[2]], ['disconnect', phases[3]]]) {
  const result = outcomes.find(row => row.scenario === scenario)
  assert.deepEqual(result.phases, phases.map(current => ({ phase: current, status: current === phase ? 'failed' : 'passed' })))
}
assert.deepEqual(outcomes.find(row => row.scenario === 'success').phases, phases.map(phase => ({ phase, status: 'passed' })))
// An unhandled asynchronous error stops the worker and may interrupt an in-flight
// hook before onStepEnd. Never invent a hook failure/complete phase from that gap.
const asynchronous = outcomes.find(row => row.scenario === 'asynchronous')
assert.equal(asynchronous.status, 'failed')
assert.ok(asynchronous.phases.every(row => phases.includes(row.phase)))
assert.ok(diagnosticRows.filter(row => phases.includes(row.stepCode)).length >= 16)
assert.ok(diagnosticRows.every(row => row.assertionLocation === null))
assert.equal(lines.some(line => /SYNTHETIC_(?:CLOSE|RECOVER|DISCONNECT|ASYNCHRONOUS)/.test(line)), false)
console.log(JSON.stringify({ probe: 'SRC-18-LIFECYCLE', node: process.version, scenarios: outcomes,
  controlledStepsPassed: 5, failedInternalPollDiagnostics: 10, finalCases: { passed: 1, failed: 4 },
  reportedTeardownPhases: diagnosticRows.filter(row => phases.includes(row.stepCode)).length,
  runnerExitCode: result.status, verdictPreserved: true, stagingCause: 'UNDETERMINED',
  evidenceDirectory: relative(root, directory).replaceAll('\\', '/') }))
