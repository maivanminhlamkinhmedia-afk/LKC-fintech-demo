import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  EXECUTION_GRANT, createOperationLedger, deriveMigrationBytes, evaluateWorkflowEvent,
  executeRehearsal, validateTarget, verifyArtifact,
} from '../scripts/cms-release-s1/run.mjs';
import * as fixtures from '../scripts/cms-release-s1/fixture-plan.mjs';
import * as metadata from '../scripts/cms-release-s1/metadata.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceSha = '61c5591bb875bffaeb3d71d2f734d39d1e87faf7';
const repository = 'maivanminhlamkinhmedia-afk/LKC-fintech-demo';
const reviewedHead = 'a'.repeat(40);
const runId = 'run12345';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const blob = (value) => createHash('sha1').update(Buffer.from('blob ' + value.length + '\0')).update(value).digest('hex');
const copy = (value) => structuredClone(value);
const secretCanary = 'S1_SYNTHETIC_CREDENTIAL_CANARY_NEVER_LOG';

function request() {
  return {
    name: 'pull_request', action: 'labeled', repository,
    pullRequest: {
      number: 123,
      head: { repository, ref: 'test/cms-release-s1-mariadb-rehearsal', sha: reviewedHead },
      base: { repository, ref: 'feature/cms-0112-q1-review-queue-readonly', sha: sourceSha },
    },
    label: 's1-' + reviewedHead, actor: 'synthetic-authorized-operator',
  };
}

function approval() {
  return { reviewedHeadSha: reviewedHead, actor: 'synthetic-authorized-operator', approvalId: 'S1-SYNTHETIC-APPROVAL' };
}

function target() {
  return {
    host: 'mariadb', port: 3306, database: 's1_' + runId + '_lf', runId,
    user: 's1_client',
    resourceIdentity: { runId, runAttempt: 1, service: 'mariadb', sourceSha },
  };
}

function ownedTemp(t) {
  const root = mkdtempSync(join(tmpdir(), 'cms s1 safety '));
  const temporaryRoot = resolve(tmpdir());
  assert.ok(resolve(root).startsWith(temporaryRoot + sep));
  assert.equal(lstatSync(root).isSymbolicLink(), false);
  t.after(() => {
    assert.ok(resolve(root).startsWith(temporaryRoot + sep));
    assert.equal(lstatSync(root).isSymbolicLink(), false);
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

async function refuses(fn, marker = secretCanary) {
  let rejected = false;
  try { await fn(); }
  catch (error) {
    rejected = true;
    assert.equal(String(error.message).includes(marker), false);
    assert.match(error.code ?? error.message, /^S1_[A-Z0-9_]+$/);
  }
  assert.equal(rejected, true, 'unsafe operation must be rejected');
}

test('matching request is only a pure policy match; no execution grant exists', () => {
  assert.equal(evaluateWorkflowEvent(request(), approval()).allowed, true);
  assert.equal(EXECUTION_GRANT, null);
  assert.equal(evaluateWorkflowEvent(request()).allowed, false);
});

test('wrong head or stale reviewed-head approval is rejected', () => {
  const event = request();
  event.pullRequest.head.sha = 'b'.repeat(40);
  assert.equal(evaluateWorkflowEvent(event, approval()).allowed, false);
  const wrongApproval = approval();
  wrongApproval.reviewedHeadSha = 'c'.repeat(40);
  assert.equal(evaluateWorkflowEvent(request(), wrongApproval).allowed, false);
});

test('newly added label must match exact reviewed head, without prefixes or suffixes', () => {
  for (const label of ['s1', 's1-' + 'b'.repeat(40), 'x-s1-' + reviewedHead, 's1-' + reviewedHead + '-extra']) {
    const event = request();
    event.label = label;
    assert.equal(evaluateWorkflowEvent(event, approval()).allowed, false);
  }
});

test('head repository, base repository and event repository each fail closed', () => {
  for (const path of ['head', 'base', 'event']) {
    const event = request();
    if (path === 'event') event.repository = 'untrusted/repository';
    else event.pullRequest[path].repository = 'untrusted/repository';
    assert.equal(evaluateWorkflowEvent(event, approval()).allowed, false);
  }
});

test('wrong head branch, base branch or base SHA cannot schedule rehearsal', () => {
  const mutations = [
    (event) => { event.pullRequest.head.ref = 'main'; },
    (event) => { event.pullRequest.base.ref = 'main'; },
    (event) => { event.pullRequest.base.sha = 'b'.repeat(40); },
  ];
  for (const mutate of mutations) {
    const event = request();
    mutate(event);
    assert.equal(evaluateWorkflowEvent(event, approval()).allowed, false);
  }
});

test('push, workflow_dispatch, pull_request_target and non-labeled actions are rejected', () => {
  for (const name of ['push', 'workflow_dispatch', 'pull_request_target']) {
    const event = request();
    event.name = name;
    assert.equal(evaluateWorkflowEvent(event, approval()).allowed, false);
  }
  for (const action of ['opened', 'synchronize', 'reopened', 'unlabeled']) {
    const event = request();
    event.action = action;
    assert.equal(evaluateWorkflowEvent(event, approval()).allowed, false);
  }
});

test('label alone, forged operator and malformed approval never confer execution authority', () => {
  for (const value of [null, {}, { approved: true }, { ...approval(), actor: 'another-actor' }, { ...approval(), approvalId: '' }]) {
    assert.equal(evaluateWorkflowEvent(request(), value).allowed, false);
  }
});

test('hostile request getters/proxies return a safe policy refusal', () => {
  const getter = Object.defineProperty({}, 'name', { get() { throw new Error(secretCanary); } });
  const proxy = new Proxy({}, { get() { throw new Error(secretCanary); }, ownKeys() { throw new Error(secretCanary); } });
  for (const value of [null, [], getter, proxy]) {
    const result = evaluateWorkflowEvent(value, approval());
    assert.equal(result.allowed, false);
    assert.equal(JSON.stringify(result).includes(secretCanary), false);
  }
});

test('P1 runtime entry rejects even matching request and user-supplied approval', async () => {
  await refuses(() => executeRehearsal({ event: request(), approval: approval(), approved: true }));
});

test('environment and process arguments cannot unlock runtime entry', async () => {
  const names = ['S1_EXECUTION_APPROVED', 'S1_EXECUTION_GRANT', 'DATABASE_URL'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.S1_EXECUTION_APPROVED = 'true';
    process.env.S1_EXECUTION_GRANT = JSON.stringify(approval());
    process.env.DATABASE_URL = 'mysql://synthetic:synthetic@mariadb:3306/s1_run12345_lf';
    await refuses(() => executeRehearsal({ argv: ['--approved', '--execute'], target: target(), approval: approval() }));
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test('disposable service target validates only its own identity and allowed principals', () => {
  for (const user of ['s1_client', 's1_ddl']) {
    assert.doesNotThrow(() => validateTarget({ ...target(), user }));
  }
});

test('production, localhost, URLs, published ports and foreign databases are refused', async () => {
  for (const patch of [
    { host: 'vdc-whm-cheaphosting-1112.vinahost.org' }, { host: 'localhost' },
    { host: '127.0.0.1' }, { host: 'mariadb.example.invalid' },
    { host: 'mysql://synthetic:mariadb@mariadb' }, { port: 33317 },
    { database: 'edpmjmha_lkcstage' }, { database: 's1_other123_lf' },
    { database: '../s1_run12345_lf' }, { user: 'root' },
  ]) await refuses(() => validateTarget({ ...target(), ...patch }));
});

test('missing, forged and inconsistent resource identities are refused', async () => {
  for (const identity of [
    undefined, {}, { ...target().resourceIdentity, runId: 'other123' },
    { ...target().resourceIdentity, sourceSha: 'b'.repeat(40) },
    { ...target().resourceIdentity, service: 'production' },
    { ...target().resourceIdentity, runAttempt: 0 },
  ]) await refuses(() => validateTarget({ ...target(), resourceIdentity: identity }));
});

test('matching byte hash and optional Git blob are verified on a real temp file', async (t) => {
  const root = ownedTemp(t);
  const bytes = Buffer.from('CREATE TABLE synthetic_only (id INT);\n');
  writeFileSync(join(root, 'migration.sql'), bytes);
  await verifyArtifact({ root, path: 'migration.sql', sha256: hash(bytes), gitBlob: blob(bytes) });
  assert.deepEqual(readFileSync(join(root, 'migration.sql')), bytes);
});

test('missing/corrupted artifact hashes and wrong Git blob are refused', async (t) => {
  const root = ownedTemp(t);
  const bytes = Buffer.from('SELECT 1;\n');
  writeFileSync(join(root, 'migration.sql'), bytes);
  for (const patch of [
    { sha256: undefined }, { sha256: '0'.repeat(64) }, { gitBlob: '0'.repeat(40) },
    { path: 'missing.sql' },
  ]) await refuses(() => verifyArtifact({ root, path: 'migration.sql', sha256: hash(bytes), gitBlob: blob(bytes), ...patch }));
});

test('path traversal, absolute path, env files and directories fail artifact verification', async (t) => {
  const root = ownedTemp(t);
  const bytes = Buffer.from('synthetic');
  writeFileSync(join(root, 'safe.sql'), bytes);
  writeFileSync(join(root, '.env.synthetic'), bytes);
  mkdirSync(join(root, 'directory'));
  for (const path of ['../safe.sql', '../' + secretCanary, join(root, 'safe.sql'), '.env.synthetic', 'directory']) {
    await refuses(() => verifyArtifact({ root, path, sha256: hash(bytes) }));
  }
});

test('directory symlink/junction component cannot escape artifact root', async (t) => {
  const root = ownedTemp(t);
  mkdirSync(join(root, 'owned'));
  mkdirSync(join(root, 'elsewhere'));
  const bytes = Buffer.from('synthetic');
  writeFileSync(join(root, 'elsewhere', 'payload.sql'), bytes);
  symlinkSync(join(root, 'elsewhere'), join(root, 'owned', 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await refuses(() => verifyArtifact({ root: join(root, 'owned'), path: 'link/payload.sql', sha256: hash(bytes) }));
});

test('file symlink is rejected as an artifact, when OS grants symlink creation', async (t) => {
  const root = ownedTemp(t);
  const bytes = Buffer.from('synthetic');
  writeFileSync(join(root, 'source.sql'), bytes);
  try { symlinkSync(join(root, 'source.sql'), join(root, 'link.sql'), 'file'); }
  catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.skip('Windows did not grant file-symlink creation; Linux CI must execute this branch.');
      return;
    }
    throw error;
  }
  await refuses(() => verifyArtifact({ root, path: 'link.sql', sha256: hash(bytes) }));
});

test('controlled LF/CRLF artifacts retain exact bytes with distinct payload and Git identities', () => {
  const input = Buffer.from('SELECT 1;\nSELECT 2;\n');
  const original = Buffer.from(input);
  const lf = deriveMigrationBytes(input, 'LF');
  const crlf = deriveMigrationBytes(input, 'CRLF');
  assert.deepEqual(Buffer.from(lf), original);
  assert.deepEqual(Buffer.from(crlf), Buffer.from('SELECT 1;\r\nSELECT 2;\r\n'));
  assert.notEqual(hash(lf), hash(crlf));
  assert.notEqual(blob(lf), blob(crlf));
  assert.deepEqual(input, original);
});

test('mixed newline, invalid encoding and unsupported EOL transformations are rejected', async () => {
  for (const [bytes, eol] of [
    [Buffer.from('SELECT 1;\r\n'), 'CRLF'],
    [Buffer.from('SELECT 1;\nSELECT 2;\r\n'), 'LF'],
    [Buffer.from([0xff, 0xfe, 0x00]), 'LF'],
    [Buffer.from('SELECT 1;\n'), 'NATIVE'],
  ]) await refuses(() => deriveMigrationBytes(bytes, eol));
});

test('ledger records one intent then one ACK and never retries duplicate operations', async () => {
  const ledger = createOperationLedger();
  ledger.intent('S1-OP-ONE');
  ledger.ack('S1-OP-ONE');
  const before = copy(ledger.snapshot());
  await refuses(() => ledger.intent('S1-OP-ONE'));
  await refuses(() => ledger.ack('S1-OP-ONE'));
  assert.deepEqual(ledger.snapshot(), before);
});

test('lost ACK creates UNKNOWN_OUTCOME and blocks mutation replay or later intent', async () => {
  const ledger = createOperationLedger();
  ledger.intent('S1-OP-ONE');
  ledger.unknown('S1-OP-ONE');
  const before = copy(ledger.snapshot());
  await refuses(() => ledger.intent('S1-OP-ONE'));
  await refuses(() => ledger.intent('S1-OP-TWO'));
  await refuses(() => ledger.ack('S1-OP-ONE'));
  assert.deepEqual(ledger.snapshot(), before);
  assert.match(JSON.stringify(before), /UNKNOWN/);
});

test('ledger refuses ACK/unknown without intent and concurrent outstanding intent', async () => {
  const ledger = createOperationLedger();
  await refuses(() => ledger.ack('S1-NO-INTENT'));
  await refuses(() => ledger.unknown('S1-NO-INTENT'));
  ledger.intent('S1-OP-ONE');
  await refuses(() => ledger.intent('S1-OP-TWO'));
});

test('canonical evidence hashing is deterministic across property insertion order', () => {
  const first = { nested: { z: 3, a: 1 }, name: 'synthetic' };
  const second = { name: 'synthetic', nested: { a: 1, z: 3 } };
  assert.equal(metadata.canonicalJson(first), metadata.canonicalJson(second));
  assert.equal(metadata.sha256(metadata.canonicalJson(first)), metadata.sha256(metadata.canonicalJson(second)));
  assert.deepEqual(first, { nested: { z: 3, a: 1 }, name: 'synthetic' });
});

test('canonicalization rejects getters, hostile proxies, cycles and malformed values safely', async () => {
  const circular = {};
  circular.self = circular;
  let reads = 0;
  const getter = Object.defineProperty({}, 'secret', { enumerable: true, get() { reads += 1; return secretCanary; } });
  const proxy = new Proxy({}, { ownKeys() { throw new Error(secretCanary); } });
  for (const value of [circular, getter, proxy, new Date(), NaN, Infinity, { value: undefined }, new Array(2)]) {
    await refuses(() => metadata.canonicalJson(value));
  }
  assert.equal(reads, 0, 'do not invoke getters during evidence validation');
});

test('allowlisted evidence is copied, frozen and bounded', () => {
  const input = [{ caseId: 'S1-OFFLINE-SAFETY', status: 'PASS', code: 'OK',
    counts: { connections: 0, rows: 0, attempts: 1 }, hashes: { source: 'a'.repeat(64) } }];
  const output = metadata.sanitizeEvidence(input);
  assert.deepEqual(output, input);
  assert.notEqual(output, input);
  assert.ok(Object.isFrozen(output));
  assert.ok(Object.isFrozen(output[0].counts));
  input[0].counts.attempts = 99;
  assert.equal(output[0].counts.attempts, 1);
});

test('credentials, session, raw stdout/stderr and free-text messages are refused rather than forwarded', async () => {
  const base = { caseId: 'S1-OFFLINE-SAFETY', status: 'FAIL', code: 'ASSERTION_FAILED' };
  for (const key of ['password', 'credential', 'token', 'session', 'storageState', 'stdout', 'stderr', 'message', 'sql', 'url']) {
    await refuses(() => metadata.sanitizeEvidence([{ ...base, [key]: secretCanary }]));
  }
  for (const patch of [
    { caseId: secretCanary }, { code: secretCanary }, { status: secretCanary },
    { counts: { password: 1 } }, { hashes: { source: secretCanary } },
    { counts: { rows: -1 } }, { counts: { rows: 1.5 } }, { counts: { rows: 1_000_000_001 } },
  ]) await refuses(() => metadata.sanitizeEvidence([{ ...base, ...patch }]));
});

test('duplicate evidence IDs, oversized output and hostile output objects are refused', async () => {
  const record = { caseId: 'S1-ONE', status: 'PASS', code: 'OK' };
  await refuses(() => metadata.sanitizeEvidence([record, record]));
  await refuses(() => metadata.sanitizeEvidence(Array.from({ length: 1001 }, (_, index) => ({ ...record, caseId: 'S1-' + index }))));
  await refuses(() => metadata.sanitizeEvidence([Object.defineProperty({}, 'caseId', { get() { throw new Error(secretCanary); } })]));
  await refuses(() => metadata.canonicalJson({ oversized: 'x'.repeat(100_001) }));
});

test('safe errors expose only approved machine identifiers and never raw message/meta', () => {
  const error = Object.assign(new Error(secretCanary), {
    code: 'P2003', sqlState: '23000', errno: 1452, sql: secretCanary, meta: { connectionString: secretCanary },
  });
  assert.deepEqual(metadata.safeError(error), { code: 'P2003', errno: 1452, sqlState: '23000' });
  for (const hostile of [
    { code: secretCanary, message: secretCanary },
    Object.defineProperty({}, 'code', { get() { throw new Error(secretCanary); } }),
    new Proxy({}, { ownKeys() { throw new Error(secretCanary); } }),
    secretCanary,
  ]) {
    const result = metadata.safeError(hostile);
    assert.equal(result.code, 'S1_UNEXPECTED_ERROR');
    assert.equal(JSON.stringify(result).includes(secretCanary), false);
  }
});

function syntheticMetadata() {
  return {
    database: 's1_run12345_lf',
    server: {
      version: '10.11.14-MariaDB', sqlMode: ['ERROR_FOR_DIVISION_BY_ZERO', 'NO_ENGINE_SUBSTITUTION'],
      serverCharset: 'latin1', serverCollation: 'latin1_swedish_ci', timezone: 'SYSTEM',
      systemTimezone: 'UTC', offsetSeconds: 0, isolation: 'REPEATABLE-READ', foreignKeyChecks: 1, defaultEngine: 'InnoDB',
    },
    schema: { charset: 'latin1', collation: 'latin1_swedish_ci' },
    tables: [{ name: 'Article', engine: 'InnoDB', collation: 'utf8mb4_unicode_ci' }],
    columns: [], indexes: [], foreignKeys: [], checks: [],
  };
}

test('metadata compatibility validates observed S0 values without inventing hosting timezone parity', async () => {
  const input = syntheticMetadata();
  assert.equal(metadata.assertMetadataMatchesS0(input), true);
  input.server.systemTimezone = '+07';
  assert.equal(metadata.assertMetadataMatchesS0(input), true, 'SYSTEM offset is evidence, not an invented S0 exact match');
  for (const mutate of [
    (value) => { value.server.version = '10.11.13-MariaDB'; },
    (value) => { value.server.sqlMode.push('STRICT_TRANS_TABLES'); },
    (value) => { value.server.isolation = 'READ-COMMITTED'; },
    (value) => { value.server.foreignKeyChecks = 0; },
    (value) => { value.schema.collation = 'utf8mb4_unicode_ci'; },
    (value) => { value.tables[0].engine = 'MyISAM'; },
    (value) => { value.tables[0].collation = 'latin1_swedish_ci'; },
  ]) {
    const altered = syntheticMetadata();
    mutate(altered);
    await refuses(() => metadata.assertMetadataMatchesS0(altered));
  }
});

test('schema inventory compares all five structural surfaces, not just migration count', async () => {
  const expected = {
    tables: [{ name: 'Article' }],
    columns: [{ table: 'Article', name: 'id', nullable: false }],
    indexes: [{ table: 'Article', name: 'PRIMARY', column: 'id', unique: true }],
    foreignKeys: [{ table: 'ArticleVersion', column: 'articleId', referencedTable: 'Article', deleteRule: 'RESTRICT' }],
    checks: [{ table: 'Article', name: 'valid_json', clauseSha256: 'b'.repeat(64) }],
  };
  assert.equal(metadata.assertSchemaInventory(copy(expected), expected), true);
  for (const key of ['tables', 'columns', 'indexes', 'foreignKeys', 'checks']) {
    const observed = copy(expected);
    observed[key] = [];
    await refuses(() => metadata.assertSchemaInventory(observed, expected));
  }
});

test('metadata collector refuses a non-disposable database before even a fake query', async () => {
  let queries = 0;
  await refuses(() => metadata.captureMetadata({ query() { queries += 1; throw new Error('MUST_NOT_QUERY'); } }, 'edpmjmha_lkcstage'));
  assert.equal(queries, 0);
});

test('candidate workflow remains job-locked and exposes neither ports nor production secrets', () => {
  const workflow = readFileSync(join(repoRoot, '.github/workflows/cms-release-s1.yml'), 'utf8');
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /types:\s*\[labeled\]/);
  assert.match(workflow, /if:\s*(?:>-\s*)?\$\{\{\s*false\s*&&/);
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /mariadb[^\n]*@sha256:[a-f0-9]{64}/);
  assert.match(workflow, /node[^\n]*@sha256:[a-f0-9]{64}/);
  assert.doesNotMatch(workflow, /^\s*(ports|pull_request_target|workflow_dispatch|workflow_run):/m);
  assert.doesNotMatch(workflow, /secrets\.|StrictHostKeyChecking=no|docker\.sock/);
});

test('all harness modules import with network, processes, filesystem mutation and timers denied', () => {
  const urls = ['run.mjs', 'fixture-plan.mjs', 'metadata.mjs'].map((name) =>
    pathToFileURL(join(repoRoot, 'scripts/cms-release-s1', name)).href);
  const audit = [
    "import { createRequire, syncBuiltinESMExports } from 'node:module';",
    "const require = createRequire(import.meta.url);",
    "const calls = []; const deny = (name) => (..._args) => { calls.push(name); throw new Error('S1_IMPORT_SIDE_EFFECT'); };",
    "for (const [moduleName, names] of [",
    " ['node:fs', ['writeFile','writeFileSync','appendFile','appendFileSync','mkdir','mkdirSync','rm','rmSync','unlink','unlinkSync','rename','renameSync','copyFile','copyFileSync','chmod','chmodSync','chown','chownSync','createWriteStream']],",
    " ['node:fs/promises', ['writeFile','appendFile','mkdir','rm','unlink','rename','copyFile','chmod','chown']],",
    " ['node:child_process', ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']],",
    " ['node:net', ['connect','createConnection','createServer']],",
    " ['node:tls', ['connect','createServer']],",
    " ['node:http', ['get','request','createServer']],",
    " ['node:https', ['get','request','createServer']],",
    " ['node:dns', ['lookup','resolve','resolve4','resolve6']],",
    " ['node:dns/promises', ['lookup','resolve','resolve4','resolve6']]",
    "]) { const item = require(moduleName); for (const name of names) item[name] = deny(moduleName + '.' + name); }",
    "require('node:net').Socket.prototype.connect = deny('net.Socket.connect');",
    "globalThis.fetch = deny('fetch'); globalThis.setTimeout = deny('setTimeout'); globalThis.setInterval = deny('setInterval');",
    "syncBuiltinESMExports();",
    "for (const url of " + JSON.stringify(urls) + ") await import(url);",
    "console.log(JSON.stringify({ calls, imported: " + urls.length + " }));",
  ].join('\n');
  const env = {
    ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' } : {}),
    S1_EXECUTION_APPROVED: 'true', S1_EXECUTION_GRANT: '{"approved":true}',
    DATABASE_URL: 'mysql://synthetic:synthetic@must-not-connect.invalid/no_real_database',
  };
  const result = execFileSync(process.execPath, ['--input-type=module', '-e', audit],
    { cwd: tmpdir(), env, encoding: 'utf8', timeout: 15_000 });
  assert.deepEqual(JSON.parse(result.trim()), { calls: [], imported: 3 });
});

test('fixture identities are deterministic, owned and cannot be supplied by a caller', async () => {
  const first = fixtures.makeFixtureIds(runId);
  assert.deepEqual(first, fixtures.makeFixtureIds(runId));
  assert.ok(Object.isFrozen(first));
  assert.notEqual(first.articleA, fixtures.makeFixtureIds('other123').articleA);
  for (const value of ['', 'short', 'UPPERCASE', '../run12345', 'edpmjmha_lkcstage', 'x'.repeat(25)]) {
    await refuses(() => fixtures.makeFixtureIds(value));
  }
  for (const value of [
    { ...first, articleA: 'unowned_customer_article' },
    { ...first, extra: true },
    Object.defineProperty({ ...first }, 'articleA', { get() { throw new Error(secretCanary); } }),
  ]) {
    for (const planner of [fixtures.legacyPlan, fixtures.expandedPlan, fixtures.constraintCases, fixtures.keysetPlan, fixtures.readLegacySpec]) {
      await refuses(() => planner(value));
    }
  }
});

test('legacy fixture plan uses only pre-foundation fields and does not invoke adapters', () => {
  const ids = fixtures.makeFixtureIds(runId);
  const plan = fixtures.legacyPlan(ids);
  assert.equal(plan.length, 13);
  assert.ok(plan.every((operation) => operation.method === 'create' && operation.expect === 'SUCCESS'));
  assert.equal(new Set(plan.map((operation) => operation.id)).size, plan.length);
  for (const operation of plan) {
    assert.ok(Object.isFrozen(operation.args.data));
    assert.ok(operation.args.data.id.startsWith(ids.namespace + '_'));
    for (const field of ['accessMode', 'activeReviewVersionId', 'activeApprovalVersionId', 'snapshotFormatVersion', 'basisUpdatedAt']) {
      assert.equal(Object.hasOwn(operation.args.data, field), false);
    }
  }
  assert.deepEqual(fixtures.legacyPlan(ids), plan);
});

test('expanded plans bind captured edges to the exact Article/version and separate working Product edge', () => {
  const ids = fixtures.makeFixtureIds(runId);
  const plan = fixtures.expandedPlan(ids);
  const edgeDelegates = [
    'articleVersionCategory', 'articleVersionTopic', 'articleVersionTag', 'articleVersionInstrument',
    'articleVersionSource', 'articleVersionDisclosure', 'articleVersionMedia', 'articleVersionProduct',
  ];
  for (const delegate of edgeDelegates) {
    const edge = plan.filter((operation) => operation.delegate === delegate);
    assert.equal(edge.length, 1);
    assert.equal(edge[0].args.data.articleId, ids.articleA);
    assert.equal(edge[0].args.data.versionId, ids.versionNew);
  }
  const media = plan.find((operation) => operation.delegate === 'articleVersionMedia');
  assert.equal(media.args.data.context, 'COVER');
  assert.equal(media.args.data.assetId, ids.media);
  const product = plan.find((operation) => operation.delegate === 'articleProduct');
  assert.deepEqual(product.args.data, { articleId: ids.articleA, productId: ids.product });
  assert.equal(plan.find((operation) => operation.id === 'expanded-version').args.data.accessMode, 'PAID_PRODUCT');
});

test('constraint plan independently targets uniqueness, cross-Article FKs, nullable legacy and RESTRICT', () => {
  const ids = fixtures.makeFixtureIds(runId);
  const cases = fixtures.constraintCases(ids);
  assert.equal(cases.length, 43);
  assert.equal(new Set(cases.map((entry) => entry.id)).size, cases.length);
  for (const suffix of ['category', 'topic', 'tag', 'instrument', 'source', 'disclosure', 'media', 'product']) {
    const unique = cases.find((entry) => entry.id === 'unique-' + suffix);
    const cross = cases.find((entry) => entry.id === 'cross-article-' + suffix);
    assert.equal(unique.expect, 'P2002');
    assert.equal(cross.expect, 'P2003');
    assert.equal(cross.args.data.articleId, ids.articleA);
    assert.equal(cross.args.data.versionId, ids.versionB);
    assert.notEqual(cross.args.data.versionId, unique.args.data.versionId,
      'a duplicate primary key must not conceal the cross-Article FK test');
  }
  for (const name of ['version', 'article', 'product', 'media', 'category', 'topic', 'tag', 'instrument']) {
    for (const operation of ['delete', 'update']) {
      const item = cases.find((entry) => entry.id === 'restrict-' + operation + '-' + name);
      assert.equal(item.expect, 'P2003');
      assert.ok(item.args.where.id.startsWith(ids.namespace + '_'));
    }
  }
  assert.equal(cases.find((entry) => entry.id === 'nullable-review-version').args.data.versionId, null);
  assert.equal(cases.find((entry) => entry.id === 'nullable-article-pointers').args.data.accessMode, null);
  assert.ok(cases.every((entry) => !['deleteMany', 'updateMany', 'executeRaw', 'queryRaw'].includes(entry.method)));
});

test('keyset fixtures contain multiple pages, timestamp ties and distinct owned IDs', async () => {
  const ids = fixtures.makeFixtureIds(runId);
  const plan = fixtures.keysetPlan(ids);
  assert.equal(plan.length, 53);
  assert.equal(new Set(plan.map((entry) => entry.args.data.id)).size, 53);
  assert.equal(plan[0].args.data.submittedAt, plan[2].args.data.submittedAt);
  assert.notEqual(plan[2].args.data.submittedAt, plan[3].args.data.submittedAt);
  assert.ok(plan.every((entry) => entry.args.data.id.startsWith(ids.namespace + '_')
    && entry.args.data.status === 'SUBMITTED' && /^\d{4}-.*\.\d{3}Z$/.test(entry.args.data.submittedAt)));
  assert.deepEqual(fixtures.keysetPlan(ids), plan);
  for (const count of [0, 2, 54, 3.5, '53']) await refuses(() => fixtures.keysetPlan(ids, count));
});

test('legacy comparison preserves millisecond token precision and rejects malformed snapshots', async () => {
  const snapshot = { articles: [{ id: 'synthetic', updatedAt: new Date('2026-01-01T00:00:00.123Z') }] };
  const normalized = fixtures.normalizedLegacySnapshot(snapshot);
  assert.equal(normalized.articles[0].updatedAt, '2026-01-01T00:00:00.123Z');
  assert.ok(snapshot.articles[0].updatedAt instanceof Date);
  assert.ok(Object.isFrozen(normalized.articles[0]));
  const cycle = {};
  cycle.self = cycle;
  for (const value of [cycle, new Date('invalid'), Object.defineProperty({}, 'secret', { get() { throw new Error(secretCanary); } })]) {
    await refuses(() => fixtures.normalizedLegacySnapshot(value));
  }
});

test('offline metadata adapter issues only scoped metadata SELECTs and hashes raw default/check text', async () => {
  const database = 's1_run12345_lf';
  const responses = [
    [{ version: '10.11.14-MariaDB', sqlMode: 'ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION',
      serverCharset: 'latin1', serverCollation: 'latin1_swedish_ci', timezone: 'SYSTEM',
      systemTimezone: 'UTC', offsetSeconds: 0, isolation: 'REPEATABLE-READ', foreignKeyChecks: 1, defaultEngine: 'InnoDB' }],
    [{ charset: 'latin1', collation: 'latin1_swedish_ci' }],
    [{ name: 'Article', engine: 'InnoDB', collation: 'utf8mb4_unicode_ci' }],
    [{ tableName: 'Article', name: 'id', ordinal: 1, dataType: 'varchar', columnType: 'varchar(191)',
      nullable: 'NO', defaultValue: secretCanary, charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci', extra: '' }],
    [{ tableName: 'Article', name: 'PRIMARY', nonUnique: 0, sequence: 1, columnName: 'id', subPart: null }],
    [{ tableName: 'ArticleVersion', name: 'same_article_fk', columnName: 'articleId', sequence: 1,
      referencedSchema: database, referencedTable: 'Article', referencedColumn: 'id',
      updateRule: 'RESTRICT', deleteRule: 'RESTRICT' }],
    [{ tableName: 'Article', name: 'json_check', clause: secretCanary }],
  ];
  const queries = [];
  const connection = { async query(sql, args) {
    queries.push({ sql, args });
    assert.match(sql.trim(), /^SELECT\b/);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/);
    if (queries.length > 1) {
      assert.match(sql, /information_schema\./);
      assert.deepEqual(args, [database]);
    }
    assert.ok(responses.length > 0);
    return responses.shift();
  } };
  const result = await metadata.captureMetadata(connection, database);
  assert.equal(queries.length, 7);
  assert.equal(result.server.offsetSeconds, 0);
  assert.equal(responses.length, 0);
  assert.equal(result.columns[0].defaultSha256, hash(secretCanary));
  assert.equal(result.checks[0].clauseSha256, hash(secretCanary));
  assert.equal(JSON.stringify(result).includes(secretCanary), false);
  assert.equal(result.foreignKeys[0].deleteRule, 'RESTRICT');
});

test('all seven checked-in migration payloads match the pinned LF, CRLF and Git-blob inventory', () => {
  assert.equal(fixtures.SOURCE_SHA, sourceSha);
  assert.equal(fixtures.MIGRATIONS.length, 7);
  assert.deepEqual(fixtures.MIGRATIONS.map((entry) => entry.name), [
    '20260910081136_rbac_client_sales_creator', '20260910105507_phase2_customer_crm',
    '20260914050000_sales_team_member_user_unique', '20260921130000_cms_financial_publishing',
    '20261008155242_cms011_review_foundation', '20261009003458_product_catalog_foundation',
    '20261009190000_cms_article_audience',
  ]);
  for (const migration of fixtures.MIGRATIONS) {
    const path = join(repoRoot, 'prisma/migrations', migration.name, 'migration.sql');
    const raw = readFileSync(path);
    const lf = Buffer.from(raw.toString('utf8').replaceAll('\r\n', '\n'));
    const crlf = Buffer.from(lf.toString('utf8').replaceAll('\n', '\r\n'));
    assert.equal(hash(lf), migration.lfSha256);
    assert.equal(hash(crlf), migration.crlfSha256);
    assert.equal(blob(lf), migration.gitBlob);
    assert.deepEqual(readFileSync(path), raw, 'verification never edits historical bytes');
  }
});

test('ledger snapshots cannot be used to rewrite prior operation state', () => {
  const ledger = createOperationLedger();
  ledger.intent('S1-OP-ONE');
  ledger.ack('S1-OP-ONE');
  const expected = metadata.canonicalJson(ledger.snapshot());
  const snapshot = ledger.snapshot();
  try {
    if (Array.isArray(snapshot)) snapshot.pop();
    else snapshot.entries = [];
  } catch { /* Frozen snapshots reject writes; detached snapshots are also safe. */ }
  assert.equal(metadata.canonicalJson(ledger.snapshot()), expected);
});
