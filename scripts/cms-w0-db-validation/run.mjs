import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync, openSync, closeSync, fsyncSync, lstatSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { SOURCE_SHA, HARNESS_SHA, BASELINE_SHA, REPOSITORY, HEAD_BRANCH, BASE_BRANCH, SCHEMA_BLOB,
  REUSE_BLOBS, VARIANTS, legacyOperations, migrationPlan, databaseName, expectedRuntimeCases, cleanupPlan } from './fixture-plan.mjs';
import { check, fail, plain, exactKeys, identity, verifyFile, migrationPayload, safePath, sha256, canonical,
  resultRecord, failureCode, completion, createJournal, inspectJournal, writeExclusive } from './evidence.mjs';

export const EXECUTION_GRANT = null;
const permits = new WeakSet();
export function assertRuntimePermit(value) { check(permits.has(value), 'W0_EXECUTION_HOLD'); }
export const IMAGE_CANDIDATES = Object.freeze({
  node: 'sha256:c4d5523090a817b7aa86d2111241fdd4f66d1e27782b44160e6aa63b357ecb2d',
  mariadb: 'sha256:3a7d3cbc8b6fddf66433d80dc124c1e4e75a73ebab9c6e137529cc270bdadfc0',
});
/** Pure request matching, never authorization. No env/label/caller JSON can mint a permit. */
export function assessRequest(input, reviewed) {
  try {
    const v = plain(input), r = plain(reviewed);
    exactKeys(v, ['event', 'action', 'repository', 'headRepository', 'baseRepository', 'headBranch', 'baseBranch', 'head', 'base', 'label', 'attempt']);
    exactKeys(r, ['head', 'workflowBlob']);
    const matches = /^[a-f0-9]{40}$/.test(r.head) && !/^0+$/.test(r.head) && /^[a-f0-9]{40}$/.test(r.workflowBlob)
      && v.event === 'pull_request' && v.action === 'labeled' && v.repository === REPOSITORY
      && v.headRepository === REPOSITORY && v.baseRepository === REPOSITORY
      && v.headBranch === HEAD_BRANCH && v.baseBranch === BASE_BRANCH && v.base === SOURCE_SHA
      && v.head === r.head && v.label === `w0-db-${r.head}` && v.attempt === 1;
    return { matches, executionAuthorized: false };
  } catch { return { matches: false, executionAuthorized: false }; }
}
export function validateTarget(input) {
  const v = plain(input); exactKeys(v, ['host', 'port', 'nonce', 'variant', 'database', 'serviceId', 'networkId', 'publishedPorts']);
  check(v.host === 'mariadb' && v.port === 3306 && v.database === databaseName(v.nonce, v.variant)
    && /^[a-f0-9]{64}$/.test(v.serviceId) && /^[a-f0-9]{64}$/.test(v.networkId)
    && Array.isArray(v.publishedPorts) && v.publishedPorts.length === 0, 'W0_TARGET_REFUSED');
  return Object.freeze(v); // Structure only; trusted GitHub service attestation is a separate gate.
}
function git(root, ...args) {
  return execFileSync('git', ['-c', 'safe.directory=' + root.replaceAll('\\', '/'), '-C', root, ...args],
    { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000, windowsHide: true }).trim();
}
export function verifyCheckout(root, expected) {
  check(/^[a-f0-9]{40}$/.test(expected) && git(root, 'rev-parse', 'HEAD') === expected, 'W0_SOURCE_REFUSED');
  const rows = git(root, 'ls-tree', '-r', 'HEAD').split('\n'), fingerprints = {};
  for (const row of rows) {
    const [meta, rel] = row.split('\t'); const [mode, kind, blob] = meta.split(' ');
    check(kind === 'blob' && ['100644', '100755'].includes(mode) && rel && !rel.split('/').some(p => p.startsWith('.env')), 'W0_SOURCE_REFUSED');
    fingerprints[rel] = verifyFile(root, rel, blob);
  }
  check(!git(root, 'diff', '--name-only', 'HEAD'), 'W0_SOURCE_REFUSED');
  // Also reject env files anywhere directly in checkout (node_modules installed later).
  function walk(p) {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      if (['.git', 'node_modules'].includes(e.name)) continue;
      check(!e.name.startsWith('.env') && !e.isSymbolicLink(), 'W0_SOURCE_REFUSED');
      if (e.isDirectory()) walk(join(p, e.name));
    }
  }
  walk(root); return fingerprints;
}
export async function loadReusable(root) {
  check(git(root, 'rev-parse', 'HEAD') === HARNESS_SHA, 'W0_HARNESS_REFUSED');
  for (const [path, blob] of Object.entries(REUSE_BLOBS)) verifyFile(root, path, blob);
  // Import graph of run.mjs is only builtins plus these two verified sibling files.
  const fixtures = await import(pathToFileURL(safePath(root, 'scripts/cms-release-s1/fixture-plan.mjs')));
  const metadata = await import(pathToFileURL(safePath(root, 'scripts/cms-release-s1/metadata.mjs')));
  const helpers = await import(pathToFileURL(safePath(root, 'scripts/cms-release-s1/run.mjs')));
  check(helpers.EXECUTION_GRANT === null && fixtures.SOURCE_SHA !== SOURCE_SHA && fixtures.SCHEMA_SHA256
    && fixtures.BASELINE_SHA === BASELINE_SHA, 'W0_HARNESS_REFUSED');
  return Object.freeze({ fixtures, metadata, helpers: Object.freeze({
    deriveMigrationBytes: helpers.deriveMigrationBytes, validateMigrationHistory: helpers.validateMigrationHistory,
    parsePartialDdlFailure: helpers.parsePartialDdlFailure,
  }) }); // Never export S1 executeRehearsal/target/source authority as a W0 dependency.
}
function runPrisma(sourceRoot, args, cwd, url) {
  const env = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', HOME: cwd, TMPDIR: cwd,
    DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1', CHECKPOINT_DISABLE: '1', NEXT_TELEMETRY_DISABLED: '1' };
  const result = spawnSync(process.execPath, [join(sourceRoot, 'node_modules/prisma/build/index.js'), ...args],
    { cwd, env, encoding: 'buffer', shell: false, timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  check(result.status !== null && !result.error && !result.signal, 'W0_PROCESS_UNKNOWN');
  return { exit: result.status, outputSHA256: createHash('sha256').update(result.stdout ?? '').update(result.stderr ?? '').digest('hex') };
}
function migrationTree({ work, sourceRoot, baselineRoot, reuse, count, variant, password, database }) {
  const folder = join(work, `${variant}-${count}`); mkdirSync(folder); mkdirSync(join(folder, 'migrations'));
  for (const m of migrationPlan(reuse.fixtures.MIGRATIONS, variant, count)) {
    const raw = readFileSync(safePath(sourceRoot, `prisma/migrations/${m.name}/migration.sql`));
    const bytes = migrationPayload(raw, m.gitBlob);
    const derived = reuse.helpers.deriveMigrationBytes(bytes, m.eol); check(sha256(derived) === m.sha256, 'W0_MIGRATION_BYTES_REFUSED');
    mkdirSync(join(folder, 'migrations', m.name)); writeFileSync(join(folder, 'migrations', m.name, 'migration.sql'), derived, { flag: 'wx' });
  }
  writeFileSync(join(folder, 'migrations/migration_lock.toml'), 'provider = "mysql"\n', { flag: 'wx' });
  const schema = join(count === 4 ? baselineRoot : sourceRoot, 'prisma/schema.prisma');
  const config = join(folder, 'prisma.config.mjs');
  const require = createRequire(join(sourceRoot, 'package.json'));
  writeFileSync(config, `import {defineConfig} from ${JSON.stringify(pathToFileURL(require.resolve('prisma/config')).href)};\nexport default defineConfig({schema:${JSON.stringify(schema)},migrations:{path:${JSON.stringify(join(folder, 'migrations'))}},datasource:{url:process.env.DATABASE_URL}});\n`, { flag: 'wx' });
  const url = `mysql://w0_ddl:${encodeURIComponent(password)}@mariadb:3306/${database}`;
  return {
    apply: () => runPrisma(sourceRoot, ['migrate', 'deploy', '--config', config], folder, url),
    diff: () => runPrisma(sourceRoot, ['migrate', 'diff', '--from-schema', schema, '--to-config-datasource', '--config', config, '--exit-code'], folder, url),
  };
}
function makeClient(root, database, password) {
  const require = createRequire(join(root, 'package.json'));
  for (const p of ['prisma', '@prisma/client', '@prisma/adapter-mariadb']) check(require(p + '/package.json').version === '7.8.0', 'W0_CONNECTOR_REFUSED');
  const { PrismaClient } = require('@prisma/client'), { PrismaMariaDb } = require('@prisma/adapter-mariadb');
  return new PrismaClient({ adapter: new PrismaMariaDb({ host: 'mariadb', port: 3306, user: 'w0_client', password, database, connectionLimit: 1, timezone: 'Z' }), log: [] });
}
async function actualHistory(connection, reuse, variant, phase) {
  const rows = await connection.query('SELECT migration_name, checksum, started_at, finished_at, rolled_back_at, applied_steps_count, logs FROM _prisma_migrations ORDER BY migration_name');
  return reuse.helpers.validateMigrationHistory(rows.map(row => ({ migration_name: row.migration_name, checksum: row.checksum,
    started: row.started_at === null ? 0 : 1, completed: row.finished_at === null ? 0 : 1,
    rolled_back: row.rolled_back_at === null ? 0 : 1, applied_steps_count: Number(row.applied_steps_count), logs: row.logs })), variant, phase);
}
async function legacySnapshot(client, reuse, ids) {
  const s = reuse.fixtures.readLegacySpec(ids);
  return reuse.fixtures.normalizedLegacySnapshot({ articles: await client.article.findMany(s.articles),
    versions: await client.articleVersion.findMany(s.versions), reviews: await client.articleReview.findMany(s.reviews) });
}
async function matrix(permit, options, provenance, reuse) {
  assertRuntimePermit(permit);
  const { sourceRoot, baselineRoot, outputRoot } = options;
  // No customer data. Schema/client roots are independent; no shared generated client.
  const require = createRequire(join(sourceRoot, 'package.json'));
  const mariadb = require('mariadb');
  const nonce = randomBytes(11).toString('hex');
  const credentials = { root: process.env.W0_SYNTHETIC_BOOTSTRAP, ddl: randomBytes(24).toString('hex'), client: randomBytes(24).toString('hex') };
  check(typeof credentials.root === 'string' && /^w0-[0-9]+-1-synthetic-only$/.test(credentials.root), 'W0_BOOTSTRAP_REFUSED');
  mkdirSync(outputRoot); const work = join(outputRoot, 'private-work'); mkdirSync(work, { mode: 0o700 });
  const fd = openSync(join(outputRoot, 'journal.jsonl'), 'wx', 0o600);
  const journal = createJournal(row => { writeFileSync(fd, canonical(row) + '\n'); fsyncSync(fd); });
  const records = [], histories = {}, metadata = {}, cleanup = []; const owned = new Set();
  const record = (variant, id, status, code, evidenceSHA256) => {
    const row = resultRecord({ caseId: `${variant}:${id}`, status, code, evidenceSHA256 });
    check(!records.some(r => r.caseId === row.caseId), 'W0_DUPLICATE_RESULT'); records.push(row);
  };
  let bootstrap, bridge, stopped = false, failure = null, phase = 'bootstrap-preflight';
  try {
    bootstrap = await mariadb.createConnection({ host: 'mariadb', port: 3306, user: 'root', password: credentials.root, connectTimeout: 5000, timezone: 'Z', multipleStatements: false });
    const version = await bootstrap.query('SELECT VERSION() AS version'); check(/^10\.11\.14(?:-|$)/.test(version[0].version), 'W0_TARGET_VERSION_REFUSED');
    const inventory = await bootstrap.query('SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA');
    check(inventory.every(r => ['information_schema', 'mysql', 'performance_schema', 'sys', 'test'].includes(r.name)), 'W0_NONEMPTY_TARGET');
    phase = 'bootstrap';
    await journal.operate('bootstrap', async () => {
      for (const sql of ["SET GLOBAL sql_mode='ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'", "SET GLOBAL character_set_server='latin1'", "SET GLOBAL collation_server='latin1_swedish_ci'", "SET GLOBAL time_zone='SYSTEM'", "SET GLOBAL tx_isolation='REPEATABLE-READ'"]) await bootstrap.query(sql);
      await bootstrap.query("CREATE USER 'w0_ddl'@'%' IDENTIFIED BY ?", [credentials.ddl]);
      await bootstrap.query("CREATE USER 'w0_client'@'%' IDENTIFIED BY ?", [credentials.client]);
      await bootstrap.query("GRANT PROCESS ON *.* TO 'w0_ddl'@'%'");
    });
    const { installActionBridge } = await import('./action-bridge.mjs');
    bridge = await installActionBridge({ permit, sourceRoot });
    const { runW0RuntimeCases } = await import('../../tests/cms-w0-db-validation-runtime.test.mjs');
    for (const variant of VARIANTS) {
      const database = databaseName(nonce, variant);
      validateTarget({ host: 'mariadb', port: 3306, nonce, variant, database, serviceId: provenance.serviceId, networkId: provenance.networkId, publishedPorts: [] });
      phase = `${variant}-setup`;
      let ddl, old, client, second;
      try {
        await journal.operate(`${variant}-create`, async () => {
          await bootstrap.query(`CREATE DATABASE ${database} CHARACTER SET latin1 COLLATE latin1_swedish_ci`);
          await bootstrap.query(`GRANT ALL PRIVILEGES ON ${database}.* TO 'w0_ddl'@'%'`);
          await bootstrap.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${database}.* TO 'w0_client'@'%'`);
          owned.add(database);
        });
        ddl = await mariadb.createConnection({ host: 'mariadb', port: 3306, user: 'w0_ddl', password: credentials.ddl, database, connectTimeout: 5000, timezone: 'Z', multipleStatements: false });
        reuse.metadata.assertMetadataMatchesS0(await reuse.metadata.captureMetadata(ddl, database), { requireTables: false });
        const four = migrationTree({ work, sourceRoot, baselineRoot, reuse, count: 4, variant, password: credentials.ddl, database });
        const seven = migrationTree({ work, sourceRoot, baselineRoot, reuse, count: 7, variant, password: credentials.ddl, database });
        phase = `${variant}-baseline`;
        await journal.operate(`${variant}-baseline`, async () => { check(four.apply().exit === 0, 'W0_MIGRATION_FAILED'); check(four.diff().exit === 0, 'W0_SCHEMA_MISMATCH'); });
        const baseline = await actualHistory(ddl, reuse, variant, 'baseline');
        record(variant, 'BASELINE', 'PASS', 'OK', baseline.historySha256);
        old = makeClient(baselineRoot, database, credentials.client);
        const ids = reuse.fixtures.makeFixtureIds(nonce);
        phase = `${variant}-legacy-fixtures`;
        await journal.operate(`${variant}-legacy-fixtures`, async () => {
          for (const op of legacyOperations(reuse.fixtures.legacyPlan(ids))) await old[op.delegate][op.method](op.args);
        });
        const before = canonical(await legacySnapshot(old, reuse, ids));
        if (variant === 'fault') {
          phase = 'fault-partial-ddl';
          await journal.operate('fault-collision', () => ddl.query('CREATE TABLE ArticleVersionCategory (synthetic_collision INT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'));
          await journal.operate('fault-partial-ddl', async () => { check(seven.apply().exit !== 0, 'W0_FAULT_NOT_REPRODUCED'); });
          const history = await actualHistory(ddl, reuse, variant, 'final');
          const observed = await reuse.metadata.captureMetadata(ddl, database);
          check(observed.columns.some(c => c.table === 'Article' && c.name === 'activeReviewVersionId')
            && observed.columns.some(c => c.table === 'ArticleReview' && c.name === 'versionId'), 'W0_PARTIAL_DDL_NOT_OBSERVED');
          const collision = observed.columns.filter(c => c.table === 'ArticleVersionCategory');
          check(collision.length === 1 && collision[0].name === 'synthetic_collision', 'W0_PARTIAL_DDL_NOT_OBSERVED');
          metadata.fault = observed; record(variant, 'PARTIAL_DDL', 'PASS', 'OK', history.historySha256);
          continue; // No retry, resolve, reverse DDL or SQL cleanup of fault database.
        }
        phase = `${variant}-expand`;
        await journal.operate(`${variant}-expand`, async () => { check(seven.apply().exit === 0, 'W0_MIGRATION_FAILED'); check(seven.diff().exit === 0, 'W0_SCHEMA_MISMATCH'); });
        const expanded = await actualHistory(ddl, reuse, variant, 'final');
        record(variant, 'MIGRATION', 'PASS', 'OK', expanded.historySha256);
        check(canonical(await legacySnapshot(old, reuse, ids)) === before, 'W0_LEGACY_CHANGED');
        client = makeClient(sourceRoot, database, credentials.client); second = makeClient(sourceRoot, database, credentials.client);
        check(canonical(await legacySnapshot(client, reuse, ids)) === before, 'W0_LEGACY_CHANGED');
        phase = `${variant}-w0-cases`;
        await journal.operate(`${variant}-w0-cases`, () => runW0RuntimeCases({ permit, client, second, old, ddl, ids, reuse, bridge, variant,
          record: (id, status, code, hash) => record(variant, id, status, code, hash) }));
        phase = `${variant}-final-schema`;
        check(seven.diff().exit === 0, 'W0_SCHEMA_MISMATCH');
        const observed = await reuse.metadata.captureMetadata(ddl, database); reuse.metadata.assertMetadataMatchesS0(observed);
        metadata[variant] = observed;
        if (variant !== 'lf') reuse.metadata.assertSchemaInventory(observed, metadata.lf);
        record(variant, 'FINAL_SCHEMA', 'PASS', 'OK', sha256(canonical(observed)));
        if (variant === 'recovery') record(variant, 'RECOVERY', 'PASS', 'OK', sha256(canonical({ history: expanded, schemaComparedToLf: true })));
      } finally {
        // Connections only. Never delete application rows or reverse DDL on failure.
        const closing = await Promise.allSettled([old, client, second].filter(Boolean).map(c => c.$disconnect()));
        if (ddl) closing.push(...await Promise.allSettled([ddl.end()]));
        check(closing.every(x => x.status === 'fulfilled'), 'W0_CLOSE_UNKNOWN');
      }
    }
    // Reread all histories AFTER every test/mutation, not a cached earlier history result.
    for (const variant of VARIANTS) {
      const database = databaseName(nonce, variant);
      phase = `${variant}-final-history`;
      const connection = await mariadb.createConnection({ host: 'mariadb', port: 3306, user: 'w0_ddl', password: credentials.ddl, database, connectTimeout: 5000, timezone: 'Z' });
      try { histories[variant] = await actualHistory(connection, reuse, variant, 'final'); }
      finally { await connection.end(); }
      record(variant, 'FINAL_HISTORY', 'PASS', 'OK', histories[variant].historySha256);
      cleanup.push(cleanupPlan({ nonce, database, variant, owned: owned.has(database), outcome: variant === 'fault' ? 'EXPECTED_PARTIAL_DDL' : 'KNOWN_COMPLETE', activeConnections: 0 }));
    }
    check(completion(records), 'W0_INCOMPLETE');
  } catch (error) { stopped = true; failure = { phase, code: failureCode(error) }; }
  finally {
    bridge?.close();
    if (bootstrap) { try { await bootstrap.end(); } catch { stopped = true; failure ??= { phase: 'close-bootstrap', code: 'W0_CLOSE_UNKNOWN' }; } }
    closeSync(fd);
  }
  for (const id of expectedRuntimeCases()) if (!records.some(r => r.caseId === id)) records.push(resultRecord({ caseId: id, status: 'NOT_RUN', code: 'W0_INCOMPLETE', evidenceSHA256: sha256('NOT_RUN') }));
  const journalState = inspectJournal(journal.snapshot());
  const success = !stopped && !journal.unknown() && completion(records);
  // Only projections/hashes are emitted. Raw command output, history.logs and credentials never leave memory.
  const resultsSHA256 = writeExclusive(outputRoot, 'results.json', records);
  const metadataSHA256 = writeExclusive(outputRoot, 'metadata.json', metadata);
  const historySHA256 = writeExclusive(outputRoot, 'history.json', histories);
  writeExclusive(outputRoot, 'manifest.json', { purpose: 'W0_REAL_DATABASE_VALIDATION', provenance,
    status: success ? 'PASS' : journalState.outcome === 'UNKNOWN' ? 'UNKNOWN_OUTCOME' : 'FAIL',
    failure, nonce, runtime: { node: process.version, prisma: '7.8.0', connector: require('mariadb/package.json').version },
    hashes: { results: resultsSHA256, metadata: metadataSHA256, history: historySHA256, journal: sha256(readFileSync(join(outputRoot, 'journal.jsonl'))) },
    migrationIdentities: reuse.fixtures.MIGRATIONS, inputEvidence: options.inputEvidence, cleanup,
    limits: ['AUTH_SESSION_BOUNDARY_ADAPTED', 'BROWSER_NOT_RUN', 'ACK_LOSS_INJECTED_AFTER_REAL_COMMIT', 'NO_PRODUCTION_PARITY_CLAIM'] });
  check(success, 'W0_MATRIX_FAILED'); return { status: 'PASS', cases: records.length };
}

/** Closed before reading caller options, environment, Git, files or DB libraries. */
export async function executeValidation(options) {
  if (EXECUTION_GRANT === null) fail('W0_EXECUTION_HOLD');
  // A trusted approval + GitHub service attestation bridge MUST be separately reviewed.
  // Deliberately no fabricated Environment approval and no caller-provided authority.
  fail('W0_TRUSTED_AUTHORITY_BRIDGE_REQUIRED');
  // Wiring is intentionally dormant; kept as real implementation for the future integration grant.
  return prepareAndExecute(options);
}
async function prepareAndExecute(options) {
  const { sourceRoot, baselineRoot, harnessRoot, candidateRoot, outputRoot } = options;
  check(Object.keys(options).sort().join('|') === 'baselineRoot|candidateRoot|harnessRoot|outputRoot|sourceRoot', 'W0_OPTIONS_REFUSED');
  check(new Set([sourceRoot, baselineRoot, harnessRoot, candidateRoot, outputRoot].map(p => resolve(p))).size === 5, 'W0_ROOT_COLLISION');
  const w0 = verifyCheckout(sourceRoot, SOURCE_SHA); verifyCheckout(baselineRoot, BASELINE_SHA);
  verifyCheckout(harnessRoot, HARNESS_SHA); verifyCheckout(candidateRoot, EXECUTION_GRANT.candidate);
  check(w0['prisma/schema.prisma'].gitBlob === SCHEMA_BLOB, 'W0_SCHEMA_REFUSED');
  verifyFile(candidateRoot, '.github/workflows/cms-w0-mariadb-validation.yml', EXECUTION_GRANT.workflowBlob);
  const reuse = await loadReusable(harnessRoot);
  const migrationEvidence = reuse.fixtures.MIGRATIONS.map(m => ({ name: m.name, ...verifyFile(sourceRoot, `prisma/migrations/${m.name}/migration.sql`, m.gitBlob) }));
  check(!lstatSync(dirname(outputRoot)).isSymbolicLink(), 'W0_PATH_REFUSED');
  const provenance = identity(EXECUTION_GRANT.provenance);
  const permit = Object.freeze({}); permits.add(permit);
  try { return await matrix(permit, { sourceRoot, baselineRoot, outputRoot, inputEvidence: { schema: w0['prisma/schema.prisma'], migrations: migrationEvidence } }, provenance, reuse); }
  finally { permits.delete(permit); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  executeValidation(null).then(() => { console.log('W0_DB_VALIDATION_PASS'); }, () => { console.error('W0_EXECUTION_REFUSED'); process.exitCode = 1; });
}
