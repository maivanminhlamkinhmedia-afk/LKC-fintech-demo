import test from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { executeValidation, assertRuntimePermit, assessRequest, validateTarget } from '../scripts/cms-w0-db-validation/run.mjs';
import { SOURCE_SHA, HARNESS_SHA, BASELINE_SHA, REPOSITORY, HEAD_BRANCH, BASE_BRANCH, REUSE_BLOBS,
  databaseName, legacyOperations, migrationPlan, MIGRATION_NAMES, cleanupPlan, expectedRuntimeCases } from '../scripts/cms-w0-db-validation/fixture-plan.mjs';
import { plain, resultRecord, failureCode, completion, createJournal, inspectJournal, sha256, gitBlob, verifyBytes, migrationPayload, safePath, identity } from '../scripts/cms-w0-db-validation/evidence.mjs';
import { createBarrier, installActionBridge } from '../scripts/cms-w0-db-validation/action-bridge.mjs';
import { runW0RuntimeCases } from './cms-w0-db-validation-runtime.test.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const workflow = readFileSync(join(root, '.github/workflows/cms-w0-mariadb-validation.yml'), 'utf8');
const reviewed = { head: 'a'.repeat(40), workflowBlob: 'b'.repeat(40) };
const request = () => ({ event: 'pull_request', action: 'labeled', repository: REPOSITORY, headRepository: REPOSITORY,
  baseRepository: REPOSITORY, headBranch: HEAD_BRANCH, baseBranch: BASE_BRANCH, head: reviewed.head,
  base: SOURCE_SHA, label: `w0-db-${reviewed.head}`, attempt: 1 });
const nonce = 'a'.repeat(22);
const target = () => ({ host: 'mariadb', port: 3306, nonce, variant: 'lf', database: databaseName(nonce, 'lf'),
  serviceId: 'b'.repeat(64), networkId: 'c'.repeat(64), publishedPorts: [] });
const migrations = MIGRATION_NAMES.map(name => ({ name, gitBlob: 'a'.repeat(40), lfSha256: 'b'.repeat(64), crlfSha256: 'c'.repeat(64) }));
const validIdentity = () => ({ source: SOURCE_SHA, harness: HARNESS_SHA, baseline: BASELINE_SHA, candidate: reviewed.head,
  workflowBlob: reviewed.workflowBlob, runId: '123456', attempt: 1, job: 'validate-w0', serviceId: 'b'.repeat(64), networkId: 'c'.repeat(64) });

const isAuditChild = process.argv[2] === '--w0-vm-audit-child';
if (!isAuditChild) {
test('closed execution denies before hostile options, env, filesystem or DB access', async () => {
  let touched = 0; const hostile = new Proxy({}, { get() { touched++; throw new Error('PRIVATE'); }, ownKeys() { touched++; throw new Error('PRIVATE'); } });
  const saved = process.env.EXECUTION_GRANT; process.env.EXECUTION_GRANT = 'APPROVED';
  try {
    for (const value of [null, {}, { approval: true, driver: 'REAL_DRIVER' }, hostile]) await assert.rejects(executeValidation(value), { message: 'W0_EXECUTION_HOLD' });
  } finally { if (saved === undefined) delete process.env.EXECUTION_GRANT; else process.env.EXECUTION_GRANT = saved; }
  assert.equal(touched, 0);
});
test('caller cannot mint a runtime capability or load application bridge', async () => {
  assert.throws(() => assertRuntimePermit({ approved: true }), /W0_EXECUTION_HOLD/);
  await assert.rejects(installActionBridge({ permit: {}, sourceRoot: '/not-read' }), /W0_EXECUTION_HOLD/);
  await assert.rejects(runW0RuntimeCases({ permit: {} }), /W0_EXECUTION_HOLD/);
});
test('matching label is request matching only, never an execution grant', () => {
  assert.deepEqual(assessRequest(request(), reviewed), { matches: true, executionAuthorized: false });
});
for (const [key, value] of Object.entries({ event: 'workflow_dispatch', action: 'opened', repository: 'fork/repo', headRepository: 'fork/repo',
  baseRepository: 'fork/repo', headBranch: 'main', baseBranch: 'main', head: 'c'.repeat(40), base: 'd'.repeat(40), label: 'approved', attempt: 2 })) {
  test(`request rejects wrong ${key}`, () => assert.deepEqual(assessRequest({ ...request(), [key]: value }, reviewed), { matches: false, executionAuthorized: false }));
}
test('missing, malformed or all-zero reviewed identity never matches', () => {
  for (const r of [null, {}, { ...reviewed, head: '0'.repeat(40) }, { ...reviewed, workflowBlob: 'invalid' }]) assert.equal(assessRequest(request(), r).matches, false);
});
test('unexpected request fields and hostile approval are rejected', () => {
  assert.equal(assessRequest({ ...request(), credential: 'PRIVATE' }, reviewed).matches, false);
  let getter = 0; const r = Object.defineProperty({}, 'head', { enumerable: true, get() { getter++; return reviewed.head; } });
  assert.equal(assessRequest(request(), r).matches, false); assert.equal(getter, 0);
});
for (const [key, value] of Object.entries({ host: 'localhost', port: 3307, database: 'edpmjmha_lkcstage', nonce: '../', variant: 'prod', serviceId: 'label-only', networkId: '', publishedPorts: ['3306:3306'] })) {
  test(`target rejects invalid ${key}`, () => assert.throws(() => validateTarget({ ...target(), [key]: value })));
}
test('target shape validates only exact disposable namespace; it does not authorize', () => {
  assert.equal(validateTarget(target()).database, databaseName(nonce, 'lf'));
  assert.throws(() => validateTarget({ ...target(), approved: true }));
});
test('source/harness/run/workflow provenance identities are distinct and exact', () => {
  assert.equal(identity(validIdentity()).source, SOURCE_SHA);
  for (const [k, v] of Object.entries({ source: HARNESS_SHA, harness: SOURCE_SHA, baseline: SOURCE_SHA, candidate: 'main', workflowBlob: 'label', attempt: 2, runId: 'unsafe\n', job: 'deploy', serviceId: 'label', networkId: 'label' })) {
    assert.throws(() => identity({ ...validIdentity(), [k]: v }));
  }
});
test('migration order, immutable identities and exact historical EOL variants', () => {
  const crlf = migrationPlan(migrations, 'crlf', 7);
  assert.deepEqual(crlf.map(m => m.eol), ['CRLF', 'CRLF', 'CRLF', 'LF', 'LF', 'LF', 'LF']);
  assert.equal(migrationPlan(migrations, 'lf', 4).length, 4);
  assert.equal(migrationPlan(migrations, 'recovery', 7).every(m => m.eol === 'LF'), true);
  for (const m of [migrations.slice(1), [...migrations].reverse(), migrations.map((m, i) => i === 4 ? { ...m, lfSha256: '' } : m)]) assert.throws(() => migrationPlan(m, 'lf', 7));
});
test('derived legacy fixture slugs are canonical before snapshot; reusable plans unchanged', () => {
  const data = { id: 's1_example_article', slug: 's1_example_article', updatedAt: '2026-01-01T00:00:00.123Z' };
  const plan = Object.freeze([Object.freeze({ delegate: 'article', method: 'create', args: Object.freeze({ data: Object.freeze(data) }) })]);
  const derived = legacyOperations(plan);
  assert.equal(derived[0].args.data.slug, 's1-example-article');
  assert.equal(plan[0].args.data.slug, 's1_example_article');
  assert.equal(derived[0].args.data.id, data.id); assert.equal(derived[0].args.data.updatedAt, data.updatedAt);
});

test('raw CRLF and Git LF fingerprints are separate, not silently equated', () => {
  const lf = Buffer.from('one\ntwo\n'), crlf = Buffer.from('one\r\ntwo\r\n'), blob = gitBlob(lf);
  const a = verifyBytes(lf, blob), b = verifyBytes(crlf, blob);
  assert.equal(a.gitBlob, b.gitBlob); assert.equal(a.payloadSHA256, b.payloadSHA256); assert.notEqual(a.rawSHA256, b.rawSHA256);
  assert.throws(() => verifyBytes(Buffer.from('changed\n'), blob));
  assert.throws(() => verifyBytes(lf, '0'.repeat(40)));
  assert.deepEqual(migrationPayload(crlf, blob), lf); assert.deepEqual(migrationPayload(lf, blob), lf);
  assert.throws(() => migrationPayload(Buffer.from('changed\r\n'), blob));
});
test('unsafe artifact paths and symlinks fail closed', t => {
  const dir = mkdtempSync(join(tmpdir(), 'w0-boundary-'));
  t.after(() => { assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + '\\') || resolve(dir).startsWith(resolve(tmpdir()) + '/')); rmSync(dir, { recursive: true }); });
  writeFileSync(join(dir, 'safe.txt'), 'safe');
  assert.equal(safePath(dir, 'safe.txt'), join(dir, 'safe.txt'));
  for (const p of ['../secret', '/absolute', 'C:/secret', '.env', 'a/../safe.txt', 'a\\safe.txt', 'safe.txt/']) assert.throws(() => safePath(dir, p));
  mkdirSync(join(dir, 'real')); writeFileSync(join(dir, 'real/data.txt'), 'data');
  symlinkSync(join(dir, 'real'), join(dir, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => safePath(dir, 'alias/data.txt'), /W0_PATH_REFUSED/);
});
test('journal is ordered, hash-bound, rejects duplicates and no blind retry after unknown', async () => {
  const journal = createJournal(() => {}); let calls = 0;
  await journal.operate('first', async () => { calls++; });
  await assert.rejects(journal.operate('first', async () => { calls++; }), /W0_OPERATION_REFUSED/);
  await assert.rejects(journal.operate('second', async () => { calls++; throw new Error('PRIVATE SQL'); }), /W0_UNKNOWN_OUTCOME/);
  await assert.rejects(journal.operate('third', async () => { calls++; }), /W0_OPERATION_REFUSED/);
  assert.equal(calls, 2); assert.equal(inspectJournal(journal.snapshot()).outcome, 'UNKNOWN');
  assert.ok(!JSON.stringify(journal.snapshot()).includes('PRIVATE'));
});
test('lost journal ACK prevents any subsequent operation', async () => {
  let writes = 0, mutations = 0;
  const journal = createJournal(() => { if (++writes === 2) throw new Error('disk'); });
  await assert.rejects(journal.operate('one', async () => { mutations++; }));
  await assert.rejects(journal.operate('two', async () => { mutations++; }));
  assert.equal(mutations, 1); assert.equal(journal.unknown(), true);
});
test('tampered/reordered journal rejected; incomplete tail is UNKNOWN, never recover/replay', async () => {
  const j = createJournal(() => {}); await j.operate('one', async () => {}); const rows = j.snapshot();
  assert.equal(inspectJournal(rows).outcome, 'KNOWN');
  assert.equal(inspectJournal(rows.slice(0, 1)).outcome, 'UNKNOWN');
  assert.throws(() => inspectJournal([...rows].reverse()));
  assert.throws(() => inspectJournal([...rows, rows[1]]));
  const altered = structuredClone(rows); altered[1].phase = 'UNKNOWN'; assert.throws(() => inspectJournal(altered));
});
test('cleanup refuses foreign ownership; partial setup and unknown never delete', () => {
  const input = { nonce, variant: 'lf', database: databaseName(nonce, 'lf'), owned: true, outcome: 'KNOWN_COMPLETE', activeConnections: 0 };
  assert.equal(cleanupPlan(input).action, 'RUNNER_SERVICE_DISPOSAL_ONLY');
  for (const patch of [{ outcome: 'UNKNOWN' }, { outcome: 'EXPECTED_PARTIAL_DDL' }, { activeConnections: 1 }]) assert.equal(cleanupPlan({ ...input, ...patch }).action, 'PRESERVE');
  assert.throws(() => cleanupPlan({ ...input, owned: false })); assert.throws(() => cleanupPlan({ ...input, database: 'other' }));
});
test('allowlisted evidence rejects raw logs, secrets, invalid outcomes and incomplete PASS', () => {
  const row = { caseId: 'lf:BASELINE', status: 'PASS', code: 'OK', evidenceSHA256: sha256('synthetic') };
  assert.deepEqual(resultRecord(row), row);
  for (const value of [null, 7, [], { ...row, caseId: 42 }]) assert.throws(() => resultRecord(value), { message: 'W0_EVIDENCE_REFUSED' });
  for (const extra of ['password', 'stdout', 'stderr', 'session', 'body', 'message']) assert.throws(() => resultRecord({ ...row, [extra]: 'SECRET' }));
  assert.throws(() => resultRecord({ ...row, code: 'mysql://secret' })); assert.throws(() => resultRecord({ ...row, status: 'SKIP' }));
  assert.equal(completion([row]), false); assert.throws(() => completion([row, row]));
  const all = expectedRuntimeCases().map(caseId => ({ ...row, caseId })); assert.equal(completion(all), true);
  assert.equal(completion(all.map((r, i) => i ? r : { ...r, status: 'NOT_RUN', code: 'W0_INCOMPLETE' })), false);
});
test('failure diagnostics allow known codes without raw SQL, credentials or hostile properties', () => {
  assert.equal(failureCode(new Error('W0_MIGRATION_FAILED')), 'W0_MIGRATION_FAILED');
  assert.equal(failureCode({ code: 'P2034', message: 'PRIVATE SQL' }), 'P2034');
  for (const error of [null, new Error('mysql://secret'), { code: 'PRIVATE' }, new Proxy({}, { ownKeys() { throw new Error('SECRET'); } })]) {
    assert.equal(failureCode(error), 'W0_UNCLASSIFIED_FAILURE');
  }
});

test('hostile getters, proxies, cycles and over-budget evidence have safe failure', () => {
  let touched = 0; const x = Object.defineProperty({}, 'password', { enumerable: true, get() { touched++; throw new Error('SECRET'); } });
  const cycle = {}; cycle.self = cycle;
  for (const v of [x, new Proxy({}, { ownKeys() { throw new Error('SECRET'); } }), cycle, 'x'.repeat(65537)]) assert.throws(() => plain(v), { message: 'W0_EVIDENCE_REFUSED' });
  assert.equal(touched, 0);
});
test('bounded evidence accommodates four schema inventories and still rejects oversized arrays', () => {
  const columns = Array.from({ length: 700 }, () => ({ table: 'Synthetic', name: 'field', ordinal: 1,
    dataType: 'varchar', nullable: true, charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci', defaultKind: 'NONE', defaultSha256: null }));
  const metadata = Object.fromEntries(['lf', 'crlf', 'fault', 'recovery'].map(v => [v, { columns }]));
  assert.equal(plain(metadata).recovery.columns.length, 700);
  assert.throws(() => plain(Array(20001).fill(null)), { message: 'W0_EVIDENCE_REFUSED' });
});

test('barriers synchronize without retries; invalid/extra arrivals fail', async () => {
  const b = createBarrier(2, 1000); let released = false;
  const first = b.arrive().then(() => { released = true; }); assert.equal(released, false);
  await b.arrive(); await first; assert.equal(released, true); assert.throws(() => b.arrive());
  assert.throws(() => createBarrier(0));
  const cancelled = createBarrier(2); const wait = cancelled.arrive(); cancelled.cancel(); await assert.rejects(wait, /W0_BARRIER_CANCELLED/);
});
test('workflow has independent closed pre-service gate, exact source refs and no deploy permissions', () => {
  assert.match(workflow, /\$\{\{ false &&/); assert.match(workflow, /types: \[labeled\]/);
  assert.match(workflow, /contents: read/); assert.equal((workflow.match(/persist-credentials: false/g) ?? []).length, 4);
  for (const sha of [SOURCE_SHA, HARNESS_SHA, BASELINE_SHA]) assert.ok(workflow.includes('ref: ' + sha));
  assert.ok(!/\bsecrets\.|pull_request_target:|workflow_dispatch:|workflow_run:|\bports:|\bvolumes:|uses:.*deploy|gh workflow|ssh |scp /.test(workflow));
  assert.match(workflow, /runs-on: ubuntu-24\.04/); assert.match(workflow, /mariadb:10\.11\.14@sha256:[a-f0-9]{64}/);
});
test('runtime suite has explicit full matrix, no test discovery or mock DB registration', () => {
  const runtime = readFileSync(join(root, 'tests/cms-w0-db-validation-runtime.test.mjs'), 'utf8');
  assert.ok(!/from ['"]node:test['"]|mock\.method|test\.skip/.test(runtime));
  for (const id of ['SAVE_NULL_PUBLIC', 'OMITTED_AUDIENCE', 'STALE_CAS', 'SERIALIZABLE', 'CONCURRENT_ACTIONS', 'ROLLBACK', 'LOST_ACK', 'PAID_DENIED', 'INCONSISTENT_DENIED', 'ACTOR_SCOPE', 'POINTERS_HISTORY', 'CONSTRAINTS']) assert.ok(runtime.includes(`pass('${id}'`), id);
});
test('reused exports exclude S1 executor; all three transitive helper blobs pinned', () => {
  assert.equal(Object.keys(REUSE_BLOBS).length, 3);
  const runner = readFileSync(join(root, 'scripts/cms-w0-db-validation/run.mjs'), 'utf8');
  assert.match(runner, /EXECUTION_GRANT = null/); assert.match(runner, /helpers\.validateMigrationHistory/);
  assert.ok(!/helpers\.executeRehearsal\s*\(/.test(runner));
});

}

// Import-time audit under a VM graph. Builtin APIs are inert traps; any top-level
// FS/network/process/timer/random call fails. Not an OS sandbox or race-proof isolation.
async function auditDirect(extra = '') {
  assert.equal(typeof vm.SourceTextModule, 'function', 'Run offline audit with --experimental-vm-modules');
  const context = vm.createContext({}); const cache = new Map(), moduleCache = new Map(); let calls = 0;
  const trap = () => { calls++; throw new Error('IMPORT_SIDE_EFFECT'); };
  const processStub = { argv: [], env: {}, version: 'v22.23.2' };
  Object.assign(context, { process: processStub, console: { log: trap, error: trap }, setTimeout: trap, clearTimeout: trap, Buffer, URL });
  context.Math = Object.create(Math); context.Math.random = trap;
  async function load(id) {
    if (cache.has(id)) return cache.get(id);
    if (id.startsWith('node:')) {
      const real = createRequire(import.meta.url)(id), names = [...new Set([...Object.keys(real), 'default'])];
      const m = new vm.SyntheticModule(names, function() {
        for (const name of names) this.setExport(name, typeof real[name] === 'function' ? trap : name === 'default' ? new Proxy({}, { get: () => trap }) : real[name]);
      }, { context, identifier: id }); cache.set(id, m); return m;
    }
    const full = resolve(id); assert.ok(relative(root, full) && !relative(root, full).startsWith('..'));
    const code = readFileSync(full, 'utf8');
    const m = new vm.SourceTextModule(code, { context, identifier: full, initializeImportMeta(meta) { meta.url = new URL('file:///' + full.replaceAll('\\', '/')).href; },
      importModuleDynamically: trap });
    cache.set(id, m); return m;
  }
  const entries = ['run.mjs', 'fixture-plan.mjs', 'action-bridge.mjs', 'evidence.mjs'].map(n => join(root, 'scripts/cms-w0-db-validation', n));
  async function linker(spec, parent) { return load(spec.startsWith('node:') ? spec : resolve(parent.identifier, '..', spec)); }
  for (const file of entries) {
    const m = await load(file); if (m.status === 'unlinked') await m.link(linker); if (m.status !== 'evaluated') await m.evaluate(); moduleCache.set(file, m);
  }
  if (extra) {
    const control = new vm.SourceTextModule(extra, { context, identifier: join(root, 'control.mjs') });
    await control.link(linker); await control.evaluate();
  }
  return calls;
}
const controls = Object.freeze({
  filesystem: "import {writeFileSync} from 'node:fs';writeFileSync('x','x');",
  process: "import {spawnSync} from 'node:child_process';spawnSync('x');",
  network: "import {connect} from 'node:net';connect(3306);",
  randomness: 'Math.random();', timer: 'setTimeout(()=>{},1);',
});
const auditNames = ['base', ...Object.keys(controls)];
function readAuditResult(child, expectedHash) {
  const need = condition => { if (!condition) throw new Error('W0_VM_CHILD_REFUSED'); };
  try {
    need(child.status === 0 && !child.error && !child.signal);
    need(typeof child.stdout === 'string' && child.stdout.length < 8192);
    const value = plain(JSON.parse(child.stdout));
    need(Object.keys(value).sort().join('|') === 'node|records|sourceSHA256|vmFlag');
    need(value.node === process.version && value.sourceSHA256 === expectedHash && value.vmFlag === true);
    need(Array.isArray(value.records) && value.records.length === auditNames.length);
    for (const [i, row] of value.records.entries()) {
      need(Object.keys(row).sort().join('|') === 'name|outcome');
      need(row.name === auditNames[i] && row.outcome === (i === 0 ? 'NO_SIDE_EFFECT' : 'IMPORT_SIDE_EFFECT'));
    }
    return value;
  } catch { throw new Error('W0_VM_CHILD_REFUSED'); }
}
let childEvidence;
async function audit(extra = '') {
  if (typeof vm.SourceTextModule === 'function') return auditDirect(extra);
  if (!childEvidence) {
    const self = fileURLToPath(import.meta.url), expectedHash = sha256(readFileSync(self));
    // Fixed executable/argv, no shell, no inherited NODE_OPTIONS or credentials.
    const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP'].filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]));
    const child = spawnSync(process.execPath, ['--experimental-vm-modules', self, '--w0-vm-audit-child'],
      { env, shell: false, encoding: 'utf8', timeout: 15000, maxBuffer: 32768, windowsHide: true });
    if (sha256(readFileSync(self)) !== expectedHash) throw new Error('W0_VM_CHILD_REFUSED');
    childEvidence = readAuditResult(child, expectedHash);
  }
  if (extra) {
    assert.ok(Object.values(controls).includes(extra));
    throw new Error('IMPORT_SIDE_EFFECT'); // Only after all exact child outcomes were verified.
  }
  return 0;
}
if (isAuditChild) {
  // This branch registers no node:test cases. The parent verifies six explicit outcomes.
  try {
    if (!process.execArgv.includes('--experimental-vm-modules') || typeof vm.SourceTextModule !== 'function') throw new Error('W0_VM_CHILD_REFUSED');
    const records = [];
    if (await auditDirect() !== 0) throw new Error('W0_VM_CHILD_REFUSED');
    records.push({ name: 'base', outcome: 'NO_SIDE_EFFECT' });
    for (const [name, code] of Object.entries(controls)) {
      let blocked = false;
      try { await auditDirect(code); } catch (error) { blocked = error.message === 'IMPORT_SIDE_EFFECT'; }
      if (!blocked) throw new Error('W0_VM_CHILD_REFUSED');
      records.push({ name, outcome: 'IMPORT_SIDE_EFFECT' });
    }
    console.log(JSON.stringify({ node: process.version, sourceSHA256: sha256(readFileSync(fileURLToPath(import.meta.url))), vmFlag: true, records }));
  } catch { console.error('W0_VM_CHILD_REFUSED'); process.exitCode = 1; }
} else {
  test('VM child evidence rejects failure, unknown outcome, wrong runtime/flag/source and incomplete controls', () => {
    const expectedHash = 'a'.repeat(64);
    const value = { node: process.version, sourceSHA256: expectedHash, vmFlag: true,
      records: auditNames.map((name, i) => ({ name, outcome: i === 0 ? 'NO_SIDE_EFFECT' : 'IMPORT_SIDE_EFFECT' })) };
    const child = { status: 0, stdout: JSON.stringify(value), signal: null };
    assert.equal(readAuditResult(child, expectedHash).records.length, 6);
    for (const patch of [{ status: 1 }, { status: null }, { signal: 'SIGTERM' }, { error: new Error('secret') }, { stdout: '' }, { stdout: 'SECRET' }]) {
      assert.throws(() => readAuditResult({ ...child, ...patch }, expectedHash), { message: 'W0_VM_CHILD_REFUSED' });
    }
    for (const patch of [{ node: 'v0.0.0' }, { vmFlag: false }, { sourceSHA256: 'b'.repeat(64) }, { records: value.records.slice(1) }, { records: [...value.records].reverse() }, { records: value.records.map(r => ({ ...r, outcome: 'PASS' })) }]) {
      assert.throws(() => readAuditResult({ ...child, stdout: JSON.stringify({ ...value, ...patch }) }, expectedHash), { message: 'W0_VM_CHILD_REFUSED' });
    }
  });
  test('import audit performs no FS/process/network/time/random activity', async () => assert.equal(await audit(), 0));
  for (const [name, code] of Object.entries(controls)) {
    test(`import audit negative control detects ${name}`, async () => assert.rejects(audit(code), /IMPORT_SIDE_EFFECT/));
  }
}
