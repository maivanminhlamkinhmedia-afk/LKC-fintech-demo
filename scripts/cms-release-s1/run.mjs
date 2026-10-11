import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BASELINE_SHA, SOURCE_SHA, REPOSITORY, MIGRATIONS, SCHEMA_SHA256, FIXTURE_TIME,
  NEXT_FIXTURE_TIME, makeFixtureIds, legacyPlan, expandedPlan, constraintCases, keysetPlan,
  readLegacySpec, normalizedLegacySnapshot } from './fixture-plan.mjs';
import { canonicalJson, sha256, sanitizeEvidence, safeError, captureMetadata,
  assertMetadataMatchesS0, assertSchemaInventory } from './metadata.mjs';

// P1 is an implementation candidate, NEVER an execution grant. Neither CLI,
// event JSON, env nor a matching label can replace a separately reviewed grant.
export const EXECUTION_GRANT = null;
const HEAD_BRANCH = 'test/cms-release-s1-mariadb-rehearsal';
const BASE_BRANCH = 'feature/cms-0112-q1-review-queue-readonly';
const LOCK_SHA256 = '4cac08c47dab4658df87a6a5cdbb05bd50fb6df0823eeda16fb8652bb4cb024a';
const MAX_BYTES = 8 * 1024 * 1024;
function reject(code) { throw Object.assign(new Error(code), { code }); }
function check(ok, code = 'S1_ASSERTION_FAILED') { if (!ok) reject(code); }
function plain(input) { return JSON.parse(canonicalJson(input)); }
function exactKeys(input, keys) {
  check(input && typeof input === 'object' && !Array.isArray(input)
    && Object.keys(input).sort().join('|') === [...keys].sort().join('|'), 'S1_INVALID_INPUT');
}

/** Pure request-policy evaluation only. Its result cannot unlock the runner. */
export function evaluateWorkflowEvent(input, suppliedApproval = null) {
  try {
    const event = plain(input);
    const approval = plain(suppliedApproval);
    exactKeys(event, ['name', 'action', 'repository', 'pullRequest', 'label', 'actor']);
    exactKeys(approval, ['reviewedHeadSha', 'actor', 'approvalId']);
    const pr = event.pullRequest;
    exactKeys(pr, ['number', 'head', 'base']);
    for (const ref of [pr.head, pr.base]) exactKeys(ref, ['repository', 'ref', 'sha']);
    const allowed = event.name === 'pull_request' && event.action === 'labeled'
      && event.repository === REPOSITORY && pr.head.repository === REPOSITORY && pr.base.repository === REPOSITORY
      && pr.head.ref === HEAD_BRANCH && pr.base.ref === BASE_BRANCH && pr.base.sha === SOURCE_SHA
      && /^[a-f0-9]{40}$/.test(approval.reviewedHeadSha) && pr.head.sha === approval.reviewedHeadSha
      && event.label === 's1-' + approval.reviewedHeadSha && event.actor === approval.actor
      && /^[A-Za-z0-9-]{1,39}$/.test(approval.actor) && /^S1-[A-Z0-9-]{8,100}$/.test(approval.approvalId)
      && Number.isSafeInteger(pr.number) && pr.number > 0;
    return Object.freeze({ allowed, code: allowed ? 'S1_POLICY_MATCH_ONLY' : 'S1_REQUEST_DENIED' });
  } catch { return Object.freeze({ allowed: false, code: 'S1_REQUEST_DENIED' }); }
}

/** Parse only the expected disposable collision; never return the raw log. */
export function parsePartialDdlFailure(input) {
  try {
    check(typeof input === 'string' && input.length > 0
      && Buffer.byteLength(input, 'utf8') <= 65_536 && !input.includes('\0'), 'S1_FAULT_HISTORY_MISMATCH');
    const text = input.replaceAll('\r\n', '\n');
    check(!text.includes('\r')
      && [...text.matchAll(/^Database error code:/gm)].length === 1
      && [...text.matchAll(/^Database error:/gm)].length === 1
      && /^Database error code:(?:[ \t]+|[ \t]*\n[ \t]*)1050[ \t]*(?=\n|$)/m.test(text)
      && /^Database error:(?:[ \t]+|[ \t]*\n[ \t]*)Table (['`])ArticleVersionCategory\1 already exists[ \t]*(?=\n|$)/m.test(text),
    'S1_FAULT_HISTORY_MISMATCH');
    return Object.freeze({ errorCode: 1050, table: 'ArticleVersionCategory', logsSha256: sha256(input) });
  } catch { reject('S1_FAULT_HISTORY_MISMATCH'); }
}

/** Pure validation of projected history rows; no Date, SQL adapter or I/O. */
export function validateMigrationHistory(input, variant, phase = 'final') {
  try {
    check(['lf', 'crlf', 'fault', 'recovery'].includes(variant)
      && ['baseline', 'final'].includes(phase), 'S1_HISTORY_MISMATCH');
    const rows = plain(input);
    const fault = variant === 'fault' && phase === 'final';
    const count = phase === 'baseline' ? 4 : fault ? 5 : 7;
    check(Array.isArray(rows) && rows.length === count, 'S1_HISTORY_MISMATCH');
    const sanitized = rows.map((row, index) => {
      exactKeys(row, ['migration_name', 'checksum', 'started', 'completed', 'rolled_back', 'applied_steps_count', 'logs']);
      const expected = MIGRATIONS[index];
      const failed = fault && index === 4;
      check(row.migration_name === expected.name
        && row.checksum === (variant === 'crlf' && index < 3 ? expected.crlfSha256 : expected.lfSha256)
        && row.started === 1 && row.rolled_back === 0 && row.completed === (failed ? 0 : 1)
        && Number.isSafeInteger(row.applied_steps_count) && row.applied_steps_count >= (failed ? 0 : 1)
        && row.applied_steps_count <= 100_000, 'S1_HISTORY_MISMATCH');
      const diagnostic = failed ? parsePartialDdlFailure(row.logs) : null;
      if (!failed) check(row.logs === null || row.logs === '', 'S1_HISTORY_MISMATCH');
      return Object.freeze({ name: expected.name, checksum: row.checksum,
        status: failed ? 'EXPECTED_FAILED' : 'COMPLETED', started: true,
        completed: !failed, rolledBack: false, appliedSteps: row.applied_steps_count,
        logsSha256: diagnostic?.logsSha256 ?? null });
    });
    const evidence = { variant, phase, rows: Object.freeze(sanitized) };
    return Object.freeze({ ...evidence, historySha256: sha256(canonicalJson(evidence)) });
  } catch { reject('S1_HISTORY_MISMATCH'); }
}

const NODE_IMAGE = 'sha256:c4d5523090a817b7aa86d2111241fdd4f66d1e27782b44160e6aa63b357ecb2d';
const MARIADB_IMAGE = 'sha256:3a7d3cbc8b6fddf66433d80dc124c1e4e75a73ebab9c6e137529cc270bdadfc0';

/** Offline consistency ONLY. Caller claims, even consistent ones, grant NOTHING.
 * A separately reviewed trusted GitHub observation/approval bridge is absent.
 * No caller-supplied record is wired into EXECUTION_GRANT or executeRehearsal.
 */
export function assessExecutionPreflight(input) {
  const denied = { executionAuthorized: false, authorityVerified: false, code: 'S1_EXECUTION_HOLD' };
  try {
    const value = plain(input);
    exactKeys(value, ['request', 'provenance', 'approval', 'observedAt']);
    const { request, provenance: p, approval: a } = value;
    exactKeys(p, ['sourceSha', 'baselineSha', 'schemaGitBlob', 'schemaPayloadSha256', 'lockPayloadSha256',
      'harnessSha', 'checkoutSha', 'workflowSha', 'workflowBlob', 'workflowPayloadSha256', 'workflowPath',
      'eventSha', 'mergeParents', 'runId', 'runAttempt', 'platform', 'nodeImage', 'mariadbImage']);
    exactKeys(a, ['approvalId', 'repository', 'prNumber', 'headSha', 'baseSha', 'workflowSha', 'workflowBlob',
      'workflowPayloadSha256', 'runId', 'runAttempt', 'operator', 'reviewer', 'issuedAt', 'expiresAt',
      'consumed', 'environment']);
    exactKeys(a.environment, ['id', 'name', 'requiredReviewers', 'preventSelfReview', 'canAdminsBypass',
      'reviewState', 'reviewRunId']);
    const sha1 = (text) => typeof text === 'string' && /^(?!0{40}$)[a-f0-9]{40}$/.test(text);
    const sha256Value = (text) => typeof text === 'string' && /^(?!0{64}$)[a-f0-9]{64}$/.test(text);
    const instant = (text) => typeof text === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text)
      && Number.isFinite(Date.parse(text)) && new Date(text).toISOString() === text;
    const login = (text) => typeof text === 'string' && /^[A-Za-z0-9-]{1,39}$/.test(text);
    check(evaluateWorkflowEvent(request, { reviewedHeadSha: a.headSha, actor: a.operator, approvalId: a.approvalId }).allowed
      && request.pullRequest.number === 59 && a.prNumber === 59 && a.repository === REPOSITORY
      && a.baseSha === SOURCE_SHA && p.sourceSha === SOURCE_SHA && p.baselineSha === BASELINE_SHA
      && p.schemaGitBlob === '2ac6b2c9688ddac6dcd20f1c0ec9f47007314858'
      && p.schemaPayloadSha256 === SCHEMA_SHA256 && p.lockPayloadSha256 === LOCK_SHA256
      && [p.harnessSha, p.checkoutSha, p.workflowSha, p.workflowBlob, p.eventSha].every(sha1)
      && sha256Value(p.workflowPayloadSha256) && p.harnessSha === a.headSha && p.checkoutSha === a.headSha
      && p.workflowSha === a.workflowSha && p.workflowBlob === a.workflowBlob
      && p.workflowPayloadSha256 === a.workflowPayloadSha256
      && p.workflowPath === '.github/workflows/cms-release-s1.yml'
      && p.eventSha !== p.harnessSha && canonicalJson(p.mergeParents) === canonicalJson([SOURCE_SHA, p.harnessSha])
      && p.workflowSha === p.eventSha
      && typeof p.runId === 'string' && /^[1-9][0-9]{7,19}$/.test(p.runId)
      && p.runId === a.runId && p.runAttempt === 1 && a.runAttempt === 1
      && p.platform === 'linux/amd64' && p.nodeImage === NODE_IMAGE && p.mariadbImage === MARIADB_IMAGE
      && login(a.operator) && login(a.reviewer) && a.operator.toLowerCase() !== a.reviewer.toLowerCase()
      && instant(value.observedAt) && instant(a.issuedAt) && instant(a.expiresAt)
      && a.issuedAt <= value.observedAt && value.observedAt < a.expiresAt && a.consumed === false
      && Number.isSafeInteger(a.environment.id) && a.environment.id > 0
      && a.environment.name === 'cms-release-s1-mariadb'
      && Array.isArray(a.environment.requiredReviewers) && a.environment.requiredReviewers.length >= 1
      && a.environment.requiredReviewers.length <= 6 && a.environment.requiredReviewers.every(login)
      && new Set(a.environment.requiredReviewers.map((name) => name.toLowerCase())).size === a.environment.requiredReviewers.length
      && a.environment.requiredReviewers.some((name) => name.toLowerCase() === a.reviewer.toLowerCase())
      && a.environment.preventSelfReview === true && a.environment.canAdminsBypass === false
      && a.environment.reviewState === 'approved' && a.environment.reviewRunId === p.runId,
    'S1_PROVENANCE_REFUSED');
    return Object.freeze({ ...denied, consistency: 'CONSISTENT_UNTRUSTED', claimsSha256: sha256(canonicalJson(value)) });
  } catch { return Object.freeze({ ...denied, consistency: 'INVALID' }); }
}

export function validateTarget(input) {
  try {
    const target = plain(input);
    exactKeys(target, ['host', 'port', 'database', 'runId', 'user', 'resourceIdentity']);
    const identity = target.resourceIdentity;
    exactKeys(identity, ['runId', 'runAttempt', 'service', 'sourceSha']);
    check(target.host === 'mariadb' && target.port === 3306
      && /^[a-z0-9]{8,24}$/.test(target.runId)
      && new RegExp('^s1_' + target.runId + '_(lf|crlf|fault|recovery)$').test(target.database)
      && ['s1_client', 's1_ddl'].includes(target.user)
      && identity.runId === target.runId && identity.runAttempt === 1
      && identity.service === 'mariadb' && identity.sourceSha === SOURCE_SHA, 'S1_TARGET_REFUSED');
    return Object.freeze(target);
  } catch { reject('S1_TARGET_REFUSED'); }
}

function noLinks(absolute) {
  const path = resolve(absolute);
  let current = path;
  while (true) {
    const stat = lstatSync(current);
    check(!stat.isSymbolicLink(), 'S1_UNSAFE_PATH');
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path;
}

/** Exact bytes, not Git's newline-normalized working-copy hash. */
export function verifyArtifact(input) {
  try {
    const value = plain(input);
    check(Object.keys(value).every((key) => ['root', 'path', 'sha256', 'gitBlob'].includes(key)), 'S1_ARTIFACT_REFUSED');
    check(typeof value.root === 'string' && typeof value.path === 'string'
      && !isAbsolute(value.path) && !/^[A-Za-z]:/.test(value.path)
      && !value.path.split(/[\\/]/).some((part) => !part || part === '.' || part === '..' || /^\.env/i.test(part))
      && /^[a-f0-9]{64}$/.test(value.sha256), 'S1_ARTIFACT_REFUSED');
    const root = noLinks(value.root);
    const path = noLinks(resolve(root, value.path));
    check(relative(root, path) && !relative(root, path).startsWith('..') && !isAbsolute(relative(root, path)), 'S1_UNSAFE_PATH');
    check(realpathSync(path) === path && lstatSync(path).isFile() && lstatSync(path).size <= MAX_BYTES, 'S1_UNSAFE_PATH');
    const bytes = readFileSync(path);
    check(sha256(bytes) === value.sha256, 'S1_ARTIFACT_DIGEST_MISMATCH');
    const gitBlob = createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
    if (value.gitBlob !== undefined) check(value.gitBlob === gitBlob, 'S1_GIT_BLOB_MISMATCH');
    return Object.freeze({ sha256: value.sha256, gitBlob, bytes: bytes.length });
  } catch (error) {
    if (/^S1_/.test(error?.code ?? '')) throw error;
    reject('S1_ARTIFACT_REFUSED');
  }
}

export function deriveMigrationBytes(input, eol) {
  try {
    check(Buffer.isBuffer(input) || input instanceof Uint8Array, 'S1_INVALID_MIGRATION_BYTES');
    check(input.byteLength > 0 && input.byteLength <= MAX_BYTES && ['LF', 'CRLF'].includes(eol), 'S1_INVALID_MIGRATION_BYTES');
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input);
    check(!text.includes('\r') && !text.startsWith('\uFEFF') && !text.includes('\0'), 'S1_INVALID_MIGRATION_BYTES');
    return Buffer.from(eol === 'LF' ? text : text.replace(/\n/g, '\r\n'), 'utf8');
  } catch { reject('S1_INVALID_MIGRATION_BYTES'); }
}

export function createOperationLedger() {
  const records = [];
  const used = new Set();
  let pending = null;
  let unknown = false;
  function record(id, state) {
    const entry = { sequence: records.length, id, state, previous: records.at(-1)?.hash ?? '0'.repeat(64) };
    records.push(Object.freeze({ ...entry, hash: sha256(canonicalJson(entry)) }));
  }
  return Object.freeze({
    intent(id) {
      check(typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id)
        && !pending && !unknown && !used.has(id), 'S1_OPERATION_REFUSED');
      used.add(id); pending = id; record(id, 'INTENT');
    },
    ack(id) {
      check(!unknown && pending === id, 'S1_OPERATION_REFUSED');
      record(id, 'ACK'); pending = null;
    },
    unknown(id) {
      check(!unknown && pending === id, 'S1_OPERATION_REFUSED');
      record(id, 'UNKNOWN_OUTCOME'); unknown = true;
    },
    snapshot() { return Object.freeze([...records]); },
  });
}

export function verifySourceArtifacts({ sourceRoot, baselineRoot }) {
  const sources = [[sourceRoot, SOURCE_SHA], [baselineRoot, BASELINE_SHA]];
  for (const [root, expected] of sources) {
    noLinks(root);
    const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    check(head === expected, 'S1_SOURCE_SHA_MISMATCH');
    check(execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=no'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() === '', 'S1_SOURCE_DIRTY');
  }
  const result = MIGRATIONS.map((migration, index) => {
    const path = 'prisma/migrations/' + migration.name + '/migration.sql';
    const identity = verifyArtifact({ root: sourceRoot, path, sha256: migration.lfSha256, gitBlob: migration.gitBlob });
    if (index < 4) verifyArtifact({ root: baselineRoot, path, sha256: migration.lfSha256, gitBlob: migration.gitBlob });
    return { name: migration.name, ...identity };
  });
  verifyArtifact({ root: sourceRoot, path: 'prisma/schema.prisma', sha256: SCHEMA_SHA256,
    gitBlob: '2ac6b2c9688ddac6dcd20f1c0ec9f47007314858' });
  verifyArtifact({ root: sourceRoot, path: 'package-lock.json', sha256: LOCK_SHA256 });
  const names = readdirSync(join(sourceRoot, 'prisma/migrations')).filter((name) => name !== 'migration_lock.toml').sort();
  check(canonicalJson(names) === canonicalJson(MIGRATIONS.map((migration) => migration.name)), 'S1_MIGRATION_SET_MISMATCH');
  return result;
}

function writeExclusive(path, data) {
  const descriptor = openSync(path, 'wx', 0o600);
  try { writeFileSync(descriptor, data); fsyncSync(descriptor); } finally { closeSync(descriptor); }
}
function subprocess(executable, args, cwd, env) {
  const result = spawnSync(executable, args, { cwd, env, encoding: 'buffer', shell: false,
    timeout: 120_000, maxBuffer: MAX_BYTES, stdio: ['ignore', 'pipe', 'pipe'] });
  // Never forward raw Prisma SQL/errors, URLs, environment or process streams.
  if (result.error || result.signal || !Number.isInteger(result.status)) reject('S1_UNKNOWN_OUTCOME');
  return { status: result.status, stdoutHash: sha256(result.stdout ?? Buffer.alloc(0)), stderrHash: sha256(result.stderr ?? Buffer.alloc(0)) };
}
async function operate(ledger, output, id, operation) {
  ledger.intent(id);
  writeExclusive(join(output, 'ledger-' + ledger.snapshot().length + '.json'), canonicalJson(ledger.snapshot()));
  let result;
  try { result = await operation(); } catch (error) {
    ledger.unknown(id);
    writeExclusive(join(output, 'ledger-' + ledger.snapshot().length + '.json'), canonicalJson(ledger.snapshot()));
    throw error; // No replay and no cleanup of unknown-outcome resources.
  }
  ledger.ack(id);
  try { writeExclusive(join(output, 'ledger-' + ledger.snapshot().length + '.json'), canonicalJson(ledger.snapshot())); }
  catch { reject('S1_UNKNOWN_OUTCOME'); } // Persisted INTENT remains unresolved. Never retry.
  return result;
}
function loadClient(root, database, password) {
  const require = createRequire(join(root, 'package.json'));
  const { PrismaClient } = require('@prisma/client');
  const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
  check(require('prisma/package.json').version === '7.8.0'
    && require('@prisma/client/package.json').version === '7.8.0'
    && require('@prisma/adapter-mariadb/package.json').version === '7.8.0', 'S1_CONNECTOR_VERSION_MISMATCH');
  return new PrismaClient({ adapter: new PrismaMariaDb({ host: 'mariadb', port: 3306,
    user: 's1_client', password, database, connectionLimit: 4, timezone: 'Z' }), log: [] });
}
function migrationTree(root, sourceRoot, baselineRoot, count, variant, ddlPassword, database) {
  const directory = join(root, variant + '-' + count);
  mkdirSync(directory);
  mkdirSync(join(directory, 'migrations'));
  for (const [index, migration] of MIGRATIONS.slice(0, count).entries()) {
    const bytes = readFileSync(join(sourceRoot, 'prisma/migrations', migration.name, 'migration.sql'));
    const crlf = variant === 'crlf' && index < 3;
    const derived = deriveMigrationBytes(bytes, crlf ? 'CRLF' : 'LF');
    check(sha256(derived) === (crlf ? migration.crlfSha256 : migration.lfSha256), 'S1_DERIVED_HASH_MISMATCH');
    mkdirSync(join(directory, 'migrations', migration.name));
    writeExclusive(join(directory, 'migrations', migration.name, 'migration.sql'), derived);
  }
  writeExclusive(join(directory, 'migrations/migration_lock.toml'), 'provider = "mysql"\n');
  const schema = join(count === 4 ? baselineRoot : sourceRoot, 'prisma/schema.prisma');
  const config = join(directory, 'prisma.config.mjs');
  const configModule = createRequire(join(sourceRoot, 'package.json')).resolve('prisma/config');
  writeExclusive(config, 'import {defineConfig} from ' + JSON.stringify(pathToFileURL(configModule).href)
    + ';export default defineConfig({schema:' + JSON.stringify(schema)
    + ',migrations:{path:' + JSON.stringify(join(directory, 'migrations')) + '},datasource:{url:process.env.DATABASE_URL}});\n');
  const env = { PATH: process.env.PATH ?? '', HOME: directory, TMPDIR: root,
    DATABASE_URL: 'mysql://s1_ddl:' + encodeURIComponent(ddlPassword) + '@mariadb:3306/' + database,
    PRISMA_HIDE_UPDATE_MESSAGE: '1', CHECKPOINT_DISABLE: '1' };
  const args = [join(sourceRoot, 'node_modules/prisma/build/index.js')];
  return {
    apply() { return subprocess(process.execPath, [...args, 'migrate', 'deploy', '--config', config], directory, env); },
    diff() { return subprocess(process.execPath, [...args, 'migrate', 'diff', '--from-schema', schema,
      '--to-config-datasource', '--config', config, '--exit-code'], directory, env); },
  };
}
async function plan(client, operations) {
  const outcomes = [];
  for (const entry of operations) {
    let error;
    try { await client[entry.delegate][entry.method](entry.args); } catch (caught) { error = caught; }
    if (entry.expect === 'SUCCESS') check(!error, 'S1_FIXTURE_FAILED');
    else check(error && safeError(error).code === entry.expect, 'S1_CONSTRAINT_FAILED');
    outcomes.push({ id: entry.id, code: error ? safeError(error).code : 'OK' });
  }
  return outcomes;
}
async function oldFields(client, ids) {
  const spec = readLegacySpec(ids);
  return normalizedLegacySnapshot({
    articles: await client.article.findMany(spec.articles),
    versions: await client.articleVersion.findMany(spec.versions),
    reviews: await client.articleReview.findMany(spec.reviews),
  });
}
const HISTORY_SELECT = 'SELECT migration_name, checksum, (started_at IS NOT NULL) AS started, '
  + '(finished_at IS NOT NULL) AS completed, (rolled_back_at IS NOT NULL) AS rolled_back, '
  + 'applied_steps_count, logs FROM _prisma_migrations ORDER BY migration_name';
async function history(connection, count, variant) {
  check(count === 4 || count === 7, 'S1_HISTORY_MISMATCH');
  const rows = await connection.query(HISTORY_SELECT);
  // MariaDB result arrays carry driver metadata; only projected rows enter the validator.
  return validateMigrationHistory([...rows], variant, count === 4 ? 'baseline' : 'final');
}

/** Re-read every owned database after ALL matrix operations, including recovery. */
async function finalHistorySweep(mariadb, credentials, runId, runAttempt) {
  const result = {};
  for (const variant of ['lf', 'crlf', 'fault', 'recovery']) {
    const database = 's1_' + runId + '_' + variant;
    validateTarget({ host: 'mariadb', port: 3306, database, runId, user: 's1_ddl',
      resourceIdentity: { runId, runAttempt, service: 'mariadb', sourceSha: SOURCE_SHA } });
    let connection;
    try {
      connection = await mariadb.createConnection({ host: 'mariadb', port: 3306, user: 's1_ddl',
        password: credentials.ddl, database, connectTimeout: 5000, timezone: 'Z' });
      const evidence = validateMigrationHistory([...(await connection.query(HISTORY_SELECT))], variant);
      const entry = { database, runId, runAttempt, sourceSha: SOURCE_SHA, ...evidence };
      result[variant] = Object.freeze({ ...entry, evidenceSha256: sha256(canonicalJson(entry)) });
    } finally { if (connection) await connection.end(); }
  }
  return Object.freeze(result);
}
async function concurrencyAndKeyset(client, second, connection, ids) {
  let firstLocked, releaseFirst, secondStarted;
  const locked = new Promise((resolvePromise) => { firstLocked = resolvePromise; });
  const release = new Promise((resolvePromise) => { releaseFirst = resolvePromise; });
  const started = new Promise((resolvePromise) => { secondStarted = resolvePromise; });
  const first = client.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe('SELECT CONNECTION_ID() AS id');
    const changed = await tx.article.updateMany({ where: { id: ids.casArticle, updatedAt: new Date(FIXTURE_TIME) },
      data: { title: 'Synthetic winner', updatedAt: new Date(NEXT_FIXTURE_TIME) } });
    firstLocked(Number(rows[0].id)); await release; return changed.count;
  }, { isolationLevel: 'Serializable', timeout: 15_000, maxWait: 5_000 });
  // Always settle barrier failures instead of hanging when the first tx fails.
  const connectionId = await Promise.race([locked, first.then(() => { throw new Error('S1_BARRIER_FAILED'); })]);
  try {
    const observed = await connection.query('SELECT trx_isolation_level AS isolation FROM information_schema.innodb_trx WHERE trx_mysql_thread_id = ?', [connectionId]);
    check(observed.length === 1 && observed[0].isolation === 'SERIALIZABLE', 'S1_ISOLATION_NOT_OBSERVED');
    const later = second.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe('SELECT CONNECTION_ID() AS id');
      secondStarted(Number(rows[0].id));
      return (await tx.article.updateMany({ where: { id: ids.casArticle, updatedAt: new Date(FIXTURE_TIME) },
        data: { title: 'Synthetic contender', updatedAt: new Date(NEXT_FIXTURE_TIME) } })).count;
    }, { isolationLevel: 'Serializable', timeout: 15_000, maxWait: 5_000 });
    const secondId = await Promise.race([started, later.then(() => { reject('S1_BARRIER_FAILED'); })]);
    // Observation polling only, never retrying a mutation. Prove an actual lock wait.
    const deadline = performance.now() + 5000;
    let blocked = false;
    while (performance.now() < deadline) {
      const waits = await connection.query(`SELECT r.trx_mysql_thread_id AS requester, b.trx_mysql_thread_id AS blocker
        FROM information_schema.innodb_lock_waits w
        JOIN information_schema.innodb_trx r ON r.trx_id = w.requesting_trx_id
        JOIN information_schema.innodb_trx b ON b.trx_id = w.blocking_trx_id
        WHERE r.trx_mysql_thread_id = ? AND b.trx_mysql_thread_id = ?`, [secondId, connectionId]);
      if (waits.length === 1) { blocked = true; break; }
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
    releaseFirst();
    if (!blocked) { await Promise.allSettled([first, later]); reject('S1_LOCK_WAIT_NOT_OBSERVED'); }
    const outcomes = await Promise.allSettled([first, later]);
    const changed = outcomes.map((result) => result.status === 'fulfilled' ? result.value : safeError(result.reason).code);
    check(changed[0] === 1 && (changed[1] === 0 || changed[1] === 'P2034'), 'S1_CAS_FAILED');
  } finally { releaseFirst(); await first.catch(() => {}); }
  await plan(client, keysetPlan(ids));
  const where = { id: { startsWith: ids.namespace + '_page' }, status: 'SUBMITTED' };
  const all = await client.article.findMany({ where, select: { id: true, submittedAt: true }, orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }] });
  const visited = []; let cursor = null;
  for (let page = 0; page < 4; page += 1) {
    const rows = await client.article.findMany({ where: { ...where, ...(cursor ? { OR: [
      { submittedAt: { gt: cursor.submittedAt } }, { submittedAt: cursor.submittedAt, id: { gt: cursor.id } },
    ] } : {}) }, select: { id: true, submittedAt: true }, orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }], take: 20 });
    if (!rows.length) break;
    visited.push(...rows); cursor = rows.at(-1);
  }
  check(all.length === 53 && canonicalJson(normalizedLegacySnapshot(visited)) === canonicalJson(normalizedLegacySnapshot(all))
    && new Set(visited.map((row) => row.id)).size === 53, 'S1_KEYSET_FAILED');
  const expectedTimes = new Map(keysetPlan(ids).map((entry) => [entry.args.data.id, entry.args.data.submittedAt]));
  check(all.every((row) => row.submittedAt.toISOString() === expectedTimes.get(row.id)), 'S1_TIMESTAMP_PRECISION_FAILED');
  const result = await connection.query("SELECT (_utf8mb4'a' = _utf8mb4'A' COLLATE utf8mb4_unicode_ci) AS equalCase, (_utf8mb4'e' = _utf8mb4'é' COLLATE utf8mb4_unicode_ci) AS equalAccent");
  check(Number(result[0].equalCase) === 1 && Number(result[0].equalAccent) === 1, 'S1_COLLATION_FAILED');
}


async function inspectLegacyWithRealConsumer(sourceRoot, version) {
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith('/article-review-snapshot.ts')
      && ['./editor-schema', './article-sources'].includes(specifier)) {
      return nextResolve(new URL(specifier + '.ts', context.parentURL).href, context);
    }
    return nextResolve(specifier, context);
  } });
  try {
    const { inspectReviewSnapshot } = await import(pathToFileURL(join(sourceRoot, 'src/features/cms/article-review-snapshot.ts')).href);
    const result = inspectReviewSnapshot({ version });
    check(result.ok === false && result.error === 'UNSUPPORTED_SNAPSHOT', 'S1_LEGACY_CONSUMER_FAILED');
  } finally { hooks.deregister(); }
}
async function cycleAndMediaRetention(client, ids) {
  const version = { ...legacyPlan(ids).find((entry) => entry.id === 'legacy-version-a').args.data,
    id: ids.namespace + '_cycleversion', articleId: ids.casArticle, versionNumber: 99 };
  await client.articleVersion.create({ data: version });
  await client.article.update({ where: { id: ids.casArticle }, data: {
    activeReviewVersionId: version.id, activeApprovalVersionId: version.id,
  } });
  const refusedDelete = async () => {
    let code;
    try { await client.articleVersion.delete({ where: { id: version.id } }); }
    catch (error) { code = safeError(error).code; }
    check(code === 'P2003', 'S1_POINTER_RESTRICT_FAILED');
  };
  await refusedDelete();
  await client.article.update({ where: { id: ids.casArticle }, data: { activeReviewVersionId: null } });
  await refusedDelete();
  await client.article.update({ where: { id: ids.casArticle }, data: { activeApprovalVersionId: null } });
  await client.articleVersion.delete({ where: { id: version.id } });
  check(await client.articleVersion.count({ where: { id: version.id } }) === 0, 'S1_CYCLE_CLEANUP_FAILED');
  const abort = Object.assign(new Error('S1_EXPECTED_ROLLBACK'), { code: 'S1_EXPECTED_ROLLBACK' });
  let aborted;
  try {
    await client.$transaction(async (tx) => {
      // Only this exact owned edge is removed; no filesystem object ever exists.
      await tx.articleVersionMedia.delete({ where: { versionId_assetId_context: { versionId: ids.versionNew, assetId: ids.media, context: 'COVER' } } });
      await tx.mediaAsset.delete({ where: { id: ids.media } });
      throw abort;
    }, { isolationLevel: 'Serializable' });
  } catch (error) { aborted = error; }
  check(aborted === abort && await client.mediaAsset.count({ where: { id: ids.media } }) === 1
    && await client.articleVersionMedia.count({ where: { versionId: ids.versionNew, assetId: ids.media } }) === 1,
  'S1_MEDIA_RETENTION_ROLLBACK_FAILED');
}
async function nonStrictWarnings(connection, ids) {
  await connection.beginTransaction();
  try {
    await connection.query("UPDATE Article SET status='S1_INVALID_STATUS' WHERE id=?", [ids.articleB]);
    const warnings = await connection.query('SHOW WARNINGS');
    check(warnings.some((warning) => Number(warning.Code) === 1265), 'S1_SQL_MODE_WARNING_MISSING');
    // Do not log warning.Message: it can contain SQL or row details.
    const rows = await connection.query('SELECT status FROM Article WHERE id=?', [ids.articleB]);
    check(rows.length === 1 && rows[0].status === '', 'S1_SQL_MODE_COERCION_UNEXPECTED');
  } finally { await connection.rollback(); }
}

/** Not exported: all mutable runtime code is reachable only through the hard gate. */
async function runMatrix(options) {
  const { runId, runAttempt } = options;
  const sourceRoot = resolve(options.sourceRoot), baselineRoot = resolve(options.baselineRoot), output = resolve(options.output);
  check(process.platform === 'linux' && process.arch === 'x64' && process.versions.node.startsWith('22.'), 'S1_RUNTIME_MISMATCH');
  const identities = verifySourceArtifacts({ sourceRoot, baselineRoot });
  check(!existsSync(output), 'S1_OUTPUT_EXISTS');
  noLinks(dirname(output)); mkdirSync(output);
  const ledger = createOperationLedger();
  const records = [];
  const passed = (caseId, counts = {}) => records.push({ caseId, status: 'PASS', code: 'OK', counts });
  const require = createRequire(join(sourceRoot, 'package.json'));
  const mariadb = require('mariadb');
  const credentials = { root: process.env.S1_BOOTSTRAP_PASSWORD,
    ddl: randomBytes(32).toString('hex'), client: randomBytes(32).toString('hex') };
  check(credentials.root === 's1-' + process.env.GITHUB_RUN_ID + '-' + runAttempt + '-synthetic-only', 'S1_BOOTSTRAP_REFUSED');
  // Target invariants are checked BEFORE any connection. No arbitrary URL/host option.
  for (const variant of ['lf', 'crlf', 'fault', 'recovery']) validateTarget({
    host: 'mariadb', port: 3306, database: 's1_' + runId + '_' + variant, runId, user: 's1_ddl',
    resourceIdentity: { runId, runAttempt, service: 'mariadb', sourceSha: SOURCE_SHA },
  });
  let bootstrap;
  const inventories = {};
  let finalHistory = null;
  const publish = (status) => {
    writeExclusive(join(output, 'results.json'), canonicalJson(sanitizeEvidence(records)));
    writeExclusive(join(output, 'manifest.json'), canonicalJson({
      formatVersion: 1, sourceSha: SOURCE_SHA, baselineSha: BASELINE_SHA,
      harnessSha: EXECUTION_GRANT.reviewedHeadSha, runId, runAttempt,
      event: 'pull_request:labeled', approvalId: EXECUTION_GRANT.approvalId, status,
      node: process.versions.node, connector: require('mariadb/package.json').version,
      prisma: require('prisma/package.json').version, migrations: identities,
      resultsSha256: sha256(readFileSync(join(output, 'results.json'))),
      ledgerSha256: sha256(canonicalJson(ledger.snapshot())),
      ledger: ledger.snapshot(), runtime: 'EXECUTED_DISPOSABLE_ONLY',
      metadata: inventories, finalHistory,
    }));
  };
  try {
    bootstrap = await mariadb.createConnection({ host: 'mariadb', port: 3306, user: 'root', password: credentials.root,
      connectTimeout: 5000, timezone: 'Z', multipleStatements: false });
    const initial = await bootstrap.query('SELECT VERSION() AS version');
    check(/^10\.11\.14(?:-|$)/.test(initial[0].version), 'S1_TARGET_VERSION_MISMATCH');
    const names = await bootstrap.query('SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA');
    check(names.every((row) => ['information_schema', 'mysql', 'performance_schema', 'sys', 'test'].includes(row.name)), 'S1_NONEMPTY_RESOURCE');
    await operate(ledger, output, 'configure-disposable', async () => {
      await bootstrap.query("SET GLOBAL sql_mode='ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'");
      await bootstrap.query("SET GLOBAL character_set_server='latin1'");
      await bootstrap.query("SET GLOBAL collation_server='latin1_swedish_ci'");
      await bootstrap.query("SET GLOBAL time_zone='SYSTEM'");
      await bootstrap.query("SET GLOBAL tx_isolation='REPEATABLE-READ'");
      await bootstrap.query("CREATE USER 's1_ddl'@'%' IDENTIFIED BY ?", [credentials.ddl]);
      await bootstrap.query("CREATE USER 's1_client'@'%' IDENTIFIED BY ?", [credentials.client]);
      // PROCESS only observes this entirely synthetic service's active transactions.
      await bootstrap.query("GRANT PROCESS ON *.* TO 's1_ddl'@'%'");
    });
    for (const variant of ['lf', 'crlf', 'fault', 'recovery']) {
      const database = 's1_' + runId + '_' + variant;
      await operate(ledger, output, variant + '-create-database', async () => {
        await bootstrap.query('CREATE DATABASE ' + database + ' CHARACTER SET latin1 COLLATE latin1_swedish_ci');
        await bootstrap.query('GRANT ALL PRIVILEGES ON ' + database + ".* TO 's1_ddl'@'%'");
        await bootstrap.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ' + database + ".* TO 's1_client'@'%'");
      });
      let connection, oldClient, newClient, secondClient;
      try {
        connection = await mariadb.createConnection({ host: 'mariadb', port: 3306, user: 's1_ddl', password: credentials.ddl,
          database, connectTimeout: 5000, timezone: 'Z' });
        assertMetadataMatchesS0(await captureMetadata(connection, database), { requireTables: false });
        const four = migrationTree(output, sourceRoot, baselineRoot, 4, variant, credentials.ddl, database);
        const seven = migrationTree(output, sourceRoot, baselineRoot, 7, variant, credentials.ddl, database);
        await operate(ledger, output, variant + '-baseline', async () => check(four.apply().status === 0, 'S1_MIGRATION_FAILED'));
        await history(connection, 4, variant);
        oldClient = loadClient(baselineRoot, database, credentials.client);
        const ids = makeFixtureIds(runId);
        await operate(ledger, output, variant + '-legacy', () => plan(oldClient, legacyPlan(ids)));
        const before = canonicalJson(await oldFields(oldClient, ids));
        if (variant === 'fault') {
          await operate(ledger, output, 'fault-inject-owned-collision', () => connection.query('CREATE TABLE ArticleVersionCategory (synthetic_collision INT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'));
          const outcome = await operate(ledger, output, 'fault-partial-ddl', async () => seven.apply());
          check(outcome.status !== 0, 'S1_FAULT_NOT_REPRODUCED');
          const failed = await connection.query('SELECT migration_name, finished_at, rolled_back_at, logs FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL');
          check(failed.length === 1 && failed[0].migration_name === MIGRATIONS[4].name, 'S1_FAULT_HISTORY_MISMATCH');
          const diagnostic = parsePartialDdlFailure(failed[0].logs);
          // Raw migration error text stays in memory, never in stdout or artifacts.
          const partial = await captureMetadata(connection, database);
          const collisionColumns = partial.columns.filter((field) => field.table === 'ArticleVersionCategory');
          check(collisionColumns.length === 1 && collisionColumns[0].name === 'synthetic_collision', 'S1_FAULT_COLLISION_CHANGED');
          check(partial.columns.some((field) => field.table === 'Article' && field.name === 'activeReviewVersionId')
            && partial.columns.some((field) => field.table === 'ArticleReview' && field.name === 'versionId'), 'S1_PARTIAL_DDL_NOT_OBSERVED');
          inventories.fault = partial;
          records.push({ caseId: 'S1-PARTIAL-DDL-HISTORY', status: 'PASS', code: 'EXPECTED_REJECTION',
            hashes: { metadata: sha256(canonicalJson(partial)), actual: diagnostic.logsSha256 } });
          passed('S1-PARTIAL-DDL', { migrations: 4 });
          continue; // Preserve damaged disposable DB; NEVER retry/resolve/reverse its DDL.
        }
        await operate(ledger, output, variant + '-expand', async () => check(seven.apply().status === 0, 'S1_MIGRATION_FAILED'));
        await history(connection, 7, variant);
        check(seven.diff().status === 0, 'S1_SCHEMA_DRIFT');
        check(canonicalJson(await oldFields(oldClient, ids)) === before, 'S1_LEGACY_CHANGED');
        newClient = loadClient(sourceRoot, database, credentials.client);
        secondClient = loadClient(sourceRoot, database, credentials.client);
        check(canonicalJson(await oldFields(newClient, ids)) === before, 'S1_MIXED_READ_CHANGED');
        const legacy = await newClient.articleVersion.findUnique({ where: { id: ids.versionA } });
        await inspectLegacyWithRealConsumer(sourceRoot, legacy);
        check(legacy.snapshotFormatVersion === null && legacy.basisUpdatedAt === null
          && legacy.accessMode === null && legacy.articleType === null, 'S1_LEGACY_NULL_FAILED');
        check((await newClient.articleReview.findUnique({ where: { id: ids.legacyReview } })).versionId === null, 'S1_LEGACY_NULL_FAILED');
        await operate(ledger, output, variant + '-constraints', async () => {
          await plan(newClient, expandedPlan(ids));
          const outcomes = await plan(newClient, constraintCases(ids));
          for (const outcome of outcomes) records.push({
            caseId: 'S1-' + variant.toUpperCase() + '-' + outcome.id.toUpperCase(),
            status: 'PASS', code: outcome.code,
          });
        });
        // Application rollback simulation: old generated client remains usable on expanded schema.
        await operate(ledger, output, variant + '-old-client-write', () => oldClient.article.update({
          where: { id: ids.articleB }, data: { title: 'Synthetic old client write', updatedAt: new Date(FIXTURE_TIME) },
        }));
        check((await newClient.article.findUnique({ where: { id: ids.articleB } })).title === 'Synthetic old client write', 'S1_MIXED_WRITE_FAILED');
        await operate(ledger, output, variant + '-new-client-write', () => newClient.article.update({
          where: { id: ids.articleB }, data: { title: 'Synthetic new client write', updatedAt: new Date(FIXTURE_TIME) },
        }));
        check((await oldClient.article.findUnique({ where: { id: ids.articleB } })).title === 'Synthetic new client write', 'S1_MIXED_WRITE_FAILED');
        await operate(ledger, output, variant + '-transaction-rollback', async () => {
        const beforeRollback = await newClient.article.findUnique({ where: { id: ids.articleB } });
        let rollbackError;
        try {
          await newClient.$transaction(async (tx) => {
            await tx.article.update({ where: { id: ids.articleB }, data: { title: 'Must rollback' } });
            await tx.articleVersionProduct.create({ data: { articleId: ids.articleA, versionId: ids.versionB, productId: ids.product } });
          }, { isolationLevel: 'Serializable' });
        } catch (error) { rollbackError = error; }
        check(safeError(rollbackError).code === 'P2003'
          && canonicalJson(normalizedLegacySnapshot(await newClient.article.findUnique({ where: { id: ids.articleB } })))
            === canonicalJson(normalizedLegacySnapshot(beforeRollback)), 'S1_TRANSACTION_ROLLBACK_FAILED');
        });
        await operate(ledger, output, variant + '-concurrency-keyset', () => concurrencyAndKeyset(newClient, secondClient, connection, ids));
        await operate(ledger, output, variant + '-pointer-cycle-media', () => cycleAndMediaRetention(newClient, ids));
        await operate(ledger, output, variant + '-non-strict-warnings', () => nonStrictWarnings(connection, ids));
        const metadata = await captureMetadata(connection, database);
        assertMetadataMatchesS0(metadata);
        inventories[variant] = metadata;
        if (variant === 'crlf' || variant === 'recovery') assertSchemaInventory(metadata, inventories.lf);
        passed('S1-' + variant.toUpperCase() + '-MATRIX', { migrations: 7, tables: metadata.tables.length, passed: constraintCases(ids).length });
        records.push({ caseId: 'S1-' + variant.toUpperCase() + '-METADATA', status: 'PASS', code: 'SCHEMA_MATCH',
          hashes: { metadata: sha256(canonicalJson(metadata)), before: sha256(before) } });
      } finally {
        for (const client of [oldClient, newClient, secondClient]) if (client) await client.$disconnect();
        if (connection) await connection.end();
      }
    }
    finalHistory = await finalHistorySweep(mariadb, credentials, runId, runAttempt);
    for (const variant of ['lf', 'crlf', 'fault', 'recovery']) records.push({
      caseId: 'S1-' + variant.toUpperCase() + '-FINAL-HISTORY', status: 'PASS', code: 'SCHEMA_MATCH',
      counts: { migrations: finalHistory[variant].rows.length },
      hashes: { actual: finalHistory[variant].evidenceSha256 },
    });
    publish('PASS');
  } catch (error) {
    records.push({ caseId: 'S1-STOP', status: 'UNKNOWN_OUTCOME', code: safeError(error).code });
    if (!existsSync(join(output, 'results.json')) && !existsSync(join(output, 'manifest.json'))) publish('STOPPED');
    reject('S1_REHEARSAL_STOPPED');
  } finally { if (bootstrap) await bootstrap.end(); }
}

/** The grant is intentionally not an argument and cannot be replaced by callers. */
export async function executeRehearsal(options) {
  if (EXECUTION_GRANT === null) reject('S1_EXECUTION_HOLD');
  // Future grant changes require separate Integrator authorization and independent review.
  check(process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_EVENT_NAME === 'pull_request'
    && process.env.GITHUB_RUN_ATTEMPT === '1', 'S1_NOT_AUTHORIZED');
  const eventPath = noLinks(process.env.GITHUB_EVENT_PATH);
  check(lstatSync(eventPath).isFile() && lstatSync(eventPath).size < MAX_BYTES, 'S1_EVENT_REFUSED');
  const raw = JSON.parse(readFileSync(eventPath, 'utf8'));
  const event = { name: process.env.GITHUB_EVENT_NAME, action: raw.action, repository: raw.repository?.full_name,
    pullRequest: { number: raw.number, head: { repository: raw.pull_request?.head?.repo?.full_name,
      ref: raw.pull_request?.head?.ref, sha: raw.pull_request?.head?.sha },
      base: { repository: raw.pull_request?.base?.repo?.full_name, ref: raw.pull_request?.base?.ref, sha: raw.pull_request?.base?.sha } },
    label: raw.label?.name, actor: raw.sender?.login };
  check(evaluateWorkflowEvent(event, EXECUTION_GRANT).allowed, 'S1_NOT_AUTHORIZED');
  return runMatrix(options);
}

// Main detection does no work on import; --execute still reaches the same hard gate.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (key) => args[args.indexOf(key) + 1];
  executeRehearsal({
    sourceRoot: option('--source'), baselineRoot: option('--baseline'), output: option('--output'),
    runId: 'run' + (process.env.GITHUB_RUN_ID ?? ''), runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
  }).catch(() => { process.stderr.write('S1_EXECUTION_HOLD_OR_SAFE_FAILURE\n'); process.exitCode = 1; });
}
