import { SOURCE_SHA, BASELINE_SHA, MIGRATIONS, FIXTURE_TIME, NEXT_FIXTURE_TIME,
  makeFixtureIds, legacyPlan, expandedPlan, constraintCases, keysetPlan,
  readLegacySpec, normalizedLegacySnapshot } from '../cms-release-s1/fixture-plan.mjs';
import { canonicalJson, sha256, safeError, assertMetadataMatchesS0,
  assertSchemaInventory } from '../cms-release-s1/metadata.mjs';
import { parsePartialDdlFailure, validateMigrationHistory } from '../cms-release-s1/run.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Caller data, CLI flags and environment variables cannot replace this gate.
export const LOCAL_MATRIX_EXECUTION_GRANT = null;
export const LOCAL_SOCKET = '/run/cms-s1/mysqld.sock';
export const HARNESS_SHA = '17ffb61232de69f1be41ab61f44dc6246328b22c';
export const VARIANTS = Object.freeze(['lf', 'crlf', 'fault', 'recovery']);
export const PARITY_MAP = Object.freeze({
  migrationAndClients: 'P7 run.mjs:265-358; independent Unix-socket implementation',
  finalHistory: 'P7 run.mjs:359-374; actual reread after every matrix operation',
  concurrencyAndKeyset: 'P7 run.mjs:376-434; no mutation retries',
  snapshotConsumer: 'P7 run.mjs:437-451; sealed compiled consumer, no runtime hooks',
  mediaPointers: 'P7 run.mjs:453-493; same Restrict/rollback observations',
  matrix: 'P7 run.mjs:551-658; separate LF/CRLF/FAULT/RECOVERY resources',
});
function fail(code) { throw Object.assign(new Error(code), { code }); }
function check(value, code) { if (!value) fail(code); }
function safeFailure(error) {
  let code;
  try { code = Object.getOwnPropertyDescriptor(error, 'code')?.value; } catch { /* Untrusted throwable. */ }
  if (typeof code === 'string' && /^(?:S1_LOCAL_[A-Z_]+|S1_HISTORY_MISMATCH|S1_FAULT_HISTORY_MISMATCH|S1_METADATA_MISMATCH|S1_SCHEMA_MISMATCH|S1_UNSAFE_EVIDENCE)$/.test(code)) fail(code);
  fail('S1_LOCAL_OBSERVATION_REFUSED');
}
function clone(value) { return JSON.parse(canonicalJson(value)); }
function equal(a, b) { return canonicalJson(a) === canonicalJson(b); }
function measuredConfiguration(input) {
  const value = clone(input); const s = value.server;
  check(typeof s.version === 'string' && /^10\.11\.14(?:-[A-Za-z0-9.+_-]{1,100})?$/.test(s.version)
    && ['UTC', 'Etc/UTC', 'GMT'].includes(s.systemTimezone) && s.offsetSeconds === 0, 'S1_LOCAL_CONFIGURATION_REFUSED');
  // Narrow public projection, never arbitrary metadata fields or SQL values.
  return { version: s.version, sqlMode: s.sqlMode, baselineIsolation: s.isolation,
    sessionTimezone: s.timezone, systemTimezone: s.systemTimezone, offsetSeconds: s.offsetSeconds,
    serverCharset: s.serverCharset, serverCollation: s.serverCollation,
    databaseCharset: value.schema.charset, databaseCollation: value.schema.collation,
    foreignKeyChecks: s.foreignKeyChecks, defaultEngine: s.defaultEngine };
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
export function variantIdentity(runNonce, variant) {
  check(typeof runNonce === 'string' && /^[a-f0-9]{22}$/.test(runNonce)
    && VARIANTS.includes(variant), 'S1_LOCAL_INVALID_IDENTITY');
  const suffix = { lf: 'lf', crlf: 'cr', fault: 'fa', recovery: 're' }[variant];
  return freeze({ database: `s1_${runNonce}_${variant}`, ids: makeFixtureIds(runNonce + suffix) });
}
export function migrationExpectation(variant, count) {
  check(VARIANTS.includes(variant) && [4, 7].includes(count), 'S1_LOCAL_INVALID_MIGRATION_PLAN');
  return freeze(MIGRATIONS.slice(0, count).map((item, index) => ({ name: item.name,
    sha256: variant === 'crlf' && index < 3 ? item.crlfSha256 : item.lfSha256,
    eol: variant === 'crlf' && index < 3 ? 'CRLF' : 'LF', gitBlob: item.gitBlob })));
}
/** Independent declarations oracle, in addition to actual Prisma schema diff.
 * Comparing successful variants only with LF is not an independent oracle. */
function verifyExpandedInventory(input) {
  const m = clone(input); assertMetadataMatchesS0(m);
  const bindingTables = ['ArticleReview', 'ArticleReviewEvent', 'ArticleVersionCategory',
    'ArticleVersionTopic', 'ArticleVersionTag', 'ArticleVersionInstrument', 'ArticleVersionSource',
    'ArticleVersionDisclosure', 'ArticleVersionMedia', 'ArticleVersionProduct'];
  function fk(table, columns, target, targetColumns) {
    const groups = new Map();
    for (const row of m.foreignKeys.filter((entry) => entry.table === table)) {
      if (!groups.has(row.name)) groups.set(row.name, []);
      groups.get(row.name).push(row);
    }
    check([...groups.values()].some((rows) => {
      rows.sort((a, b) => a.sequence - b.sequence);
      return equal(rows.map((r) => r.column), columns)
        && equal(rows.map((r) => r.referencedColumn), targetColumns)
        && rows.every((r) => r.referencedTable === target && r.updateRule === 'RESTRICT' && r.deleteRule === 'RESTRICT');
    }), 'S1_LOCAL_SCHEMA_FK_MISMATCH');
  }
  for (const table of bindingTables) fk(table, ['articleId', 'versionId'], 'ArticleVersion', ['articleId', 'id']);
  for (const field of ['activeReviewVersionId', 'activeApprovalVersionId']) fk('Article', ['id', field], 'ArticleVersion', ['articleId', 'id']);
  fk('ArticleVersionMedia', ['assetId'], 'MediaAsset', ['id']);
  fk('ArticleProduct', ['articleId'], 'Article', ['id']);
  fk('ArticleProduct', ['productId'], 'Product', ['id']);
  fk('ArticleVersionProduct', ['productId'], 'Product', ['id']);
  for (const table of ['Article', 'ArticleVersion']) {
    const field = m.columns.find((row) => row.table === table && row.name === 'accessMode');
    check(field?.nullable === true && field.columnType === "enum('PUBLIC','PAID_PRODUCT')"
      && ['NULL', 'NONE'].includes(field.defaultKind), 'S1_LOCAL_SCHEMA_NULL_MISMATCH');
  }
  for (const [table, columns] of [['ArticleVersion', ['articleId', 'id']],
    ['ArticleProduct', ['articleId', 'productId']], ['ArticleVersionProduct', ['versionId', 'productId']],
    ['ArticleVersionMedia', ['versionId', 'assetId', 'context']]]) {
    const groups = new Map();
    for (const row of m.indexes.filter((r) => r.table === table && r.unique)) {
      if (!groups.has(row.name)) groups.set(row.name, []);
      groups.get(row.name).push(row);
    }
    check([...groups.values()].some((rows) => equal(rows.sort((a, b) => a.sequence - b.sequence).map((r) => r.column), columns)),
      'S1_LOCAL_SCHEMA_INDEX_MISMATCH');
  }
  return true;
}
export function assertExpandedInventory(input) {
  try { return verifyExpandedInventory(input); } catch (error) { safeFailure(error); }
}
/** Pure protocol. Supplied observations NEVER attest execution or authorize an adapter.
 * Consumers cannot inject executable callbacks; responses are copied as data. */
export function* createMatrixProgram(runNonce) {
  try {
  variantIdentity(runNonce, 'lf');
  let sequence = 0;
  const evidence = [], inventories = {}, histories = {}, configurations = {};
  function* request(variant, kind, args = {}, mutation = false) {
    const id = `${String(++sequence).padStart(4, '0')}-${variant}-${kind}`;
    const command = freeze({ id, variant, kind, mutation, args: clone(args) });
    let response;
    try { response = clone(yield command); } catch { fail('S1_LOCAL_RESPONSE_REFUSED'); }
    check(equal(Object.keys(response).sort(), ['id', 'outcome', 'value']) && response.id === id,
      'S1_LOCAL_STALE_OR_REPLAYED_RESPONSE');
    if (response.outcome === 'UNKNOWN_OUTCOME') fail('S1_LOCAL_UNKNOWN_OUTCOME');
    check(response.outcome === 'ACK', 'S1_LOCAL_OPERATION_STOPPED');
    return response.value;
  }
  function* operation(variant, client, entry) {
    const outcome = yield* request(variant, 'prisma', { client, entry }, true);
    check(equal(Object.keys(outcome), ['code']) && outcome.code === (entry.expect === 'SUCCESS' ? 'OK' : entry.expect),
      'S1_LOCAL_CONSTRAINT_FAILED');
    evidence.push({ caseId: `${variant}-${entry.id}`, code: outcome.code });
  }
  for (const variant of VARIANTS) {
    const { database, ids } = variantIdentity(runNonce, variant);
    const admission = yield* request(variant, 'open', { database }, true);
    check(admission.database === database && admission.socketPath === LOCAL_SOCKET && admission.empty === true
      && admission.skipNetworking === true, 'S1_LOCAL_TARGET_REFUSED');
    assertMetadataMatchesS0(admission.metadata, { requireTables: false });
    configurations[variant] = measuredConfiguration(admission.metadata);
    const baseline = yield* request(variant, 'migrate', { count: 4, migrations: migrationExpectation(variant, 4) }, true);
    check(baseline.exitCode === 0 && baseline.attempts === 1, 'S1_LOCAL_MIGRATION_FAILED');
    validateMigrationHistory(yield* request(variant, 'history', { phase: 'baseline' }), variant, 'baseline');
    for (const entry of legacyPlan(ids)) yield* operation(variant, 'old', entry);
    const before = yield* request(variant, 'legacy-read', { client: 'old', ids });
    check(before && Array.isArray(before.articles) && before.articles.length === 3
      && before.versions?.length === 2 && before.reviews?.length === 1, 'S1_LOCAL_LEGACY_SHAPE');
    if (variant === 'fault') {
      check((yield* request(variant, 'inject-collision', {}, true)).created === true, 'S1_LOCAL_FAULT_INJECTION_FAILED');
      const failed = yield* request(variant, 'migrate', { count: 7, migrations: migrationExpectation(variant, 7) }, true);
      check(Number.isInteger(failed.exitCode) && failed.exitCode > 0 && failed.attempts === 1, 'S1_LOCAL_FAULT_NOT_REPRODUCED');
      validateMigrationHistory(yield* request(variant, 'history', { phase: 'final' }), variant);
      const partial = yield* request(variant, 'metadata');
      const collision = partial.columns.filter((r) => r.table === 'ArticleVersionCategory');
      check(collision.length === 1 && collision[0].name === 'synthetic_collision'
        && partial.columns.some((r) => r.table === 'Article' && r.name === 'activeReviewVersionId')
        && partial.columns.some((r) => r.table === 'ArticleReview' && r.name === 'versionId'), 'S1_LOCAL_PARTIAL_DDL_NOT_OBSERVED');
      evidence.push({ caseId: 'fault-partial-ddl', code: 'EXPECTED_REJECTION', metadataSha256: sha256(canonicalJson(partial)) });
      yield* request(variant, 'close');
      continue;
    }
    const expanded = yield* request(variant, 'migrate', { count: 7, migrations: migrationExpectation(variant, 7) }, true);
    check(expanded.exitCode === 0 && expanded.attempts === 1, 'S1_LOCAL_MIGRATION_FAILED');
    validateMigrationHistory(yield* request(variant, 'history', { phase: 'final' }), variant);
    check((yield* request(variant, 'schema-diff')).exitCode === 0, 'S1_LOCAL_SCHEMA_DRIFT');
    for (const client of ['old', 'new']) check(equal(yield* request(variant, 'legacy-read', { client, ids }), before), 'S1_LOCAL_LEGACY_CHANGED');
    const legacy = yield* request(variant, 'legacy-expanded', { ids });
    check(legacy.versionId === ids.versionA && legacy.articleId === ids.articleA && legacy.reviewVersionId === null
      && ['snapshotFormatVersion', 'basisUpdatedAt', 'accessMode', 'articleType'].every((key) => legacy[key] === null)
      && legacy.articleAccessMode === null && legacy.activeReviewVersionId === null && legacy.activeApprovalVersionId === null
      && legacy.consumerError === 'UNSUPPORTED_SNAPSHOT', 'S1_LOCAL_LEGACY_NULL_FAILED');
    for (const entry of expandedPlan(ids)) yield* operation(variant, 'new', entry);
    for (const entry of constraintCases(ids)) yield* operation(variant, 'new', entry);
    const defaults = yield* request(variant, 'product-defaults', { ids }, true);
    check(defaults.contentState === 'UNSELECTABLE' && defaults.saleStopped === true, 'S1_LOCAL_PRODUCT_DEFAULT_FAILED');
    for (const writer of ['old', 'new']) {
      const mixed = yield* request(variant, 'mixed-write', { writer, ids }, true);
      check(mixed.reader === (writer === 'old' ? 'new' : 'old') && mixed.equal === true, 'S1_LOCAL_MIXED_WRITE_FAILED');
    }
    const rollback = yield* request(variant, 'rollback', { ids }, true);
    check(rollback.code === 'P2003' && rollback.unchanged === true, 'S1_LOCAL_ROLLBACK_FAILED');
    const concurrency = yield* request(variant, 'concurrency', { ids }, true);
    check(concurrency.isolation === 'SERIALIZABLE' && concurrency.lockWait === true && concurrency.first === 1
      && [0, 'P2034'].includes(concurrency.second), 'S1_LOCAL_CONCURRENCY_FAILED');
    for (const entry of keysetPlan(ids)) yield* operation(variant, 'new', entry);
    const all = yield* request(variant, 'keyset-read', { ids, cursor: null, take: null });
    const expected = keysetPlan(ids).map((e) => ({ id: e.args.data.id, submittedAt: e.args.data.submittedAt }));
    check(equal(all, expected), 'S1_LOCAL_TIMESTAMP_OR_KEYSET_FAILED');
    const visited = []; let cursor = null;
    for (let page = 0; page < 4; page += 1) {
      const rows = yield* request(variant, 'keyset-read', { ids, cursor, take: 20 });
      check(Array.isArray(rows) && rows.length <= 20, 'S1_LOCAL_KEYSET_PAGE_FAILED');
      if (!rows.length) break;
      visited.push(...rows); cursor = rows.at(-1);
    }
    check(equal(visited, all) && new Set(visited.map((row) => row.id)).size === 53, 'S1_LOCAL_KEYSET_PAGE_FAILED');
    const collation = yield* request(variant, 'collation');
    check(collation.equalCase === 1 && collation.equalAccent === 1, 'S1_LOCAL_COLLATION_FAILED');
    const media = yield* request(variant, 'media-pointers', { ids }, true);
    check(media.pointerRejections === 2 && media.mediaRejection === 'P2003' && media.restored === true
      && media.deletedVersionCount === 0, 'S1_LOCAL_MEDIA_POINTER_FAILED');
    const mode = yield* request(variant, 'non-strict-warning', { ids }, true);
    check(mode.warning1265 === true && mode.coercedEmpty === true && mode.restored === true, 'S1_LOCAL_SQL_MODE_FAILED');
    const metadata = yield* request(variant, 'metadata');
    assertExpandedInventory(metadata); inventories[variant] = metadata;
    check(equal(measuredConfiguration(metadata), configurations[variant]), 'S1_LOCAL_CONFIGURATION_CHANGED');
    if (variant !== 'lf') assertSchemaInventory(metadata, inventories.lf);
    evidence.push({ caseId: `${variant}-matrix`, code: 'OBSERVATIONS_MATCH', metadataSha256: sha256(canonicalJson(metadata)),
      beforeSha256: sha256(canonicalJson(before)) });
    yield* request(variant, 'close');
  }
  // Actual history must be reread after recovery and all writes, never cached.
  for (const variant of VARIANTS) {
    const rows = yield* request(variant, 'final-history-reread', { database: variantIdentity(runNonce, variant).database });
    histories[variant] = validateMigrationHistory(rows, variant);
  }
  return freeze({ classification: 'OBSERVATIONS_VALIDATED_NOT_RUNTIME_ATTESTATION', sourceSha: SOURCE_SHA,
    baselineSha: BASELINE_SHA, harnessSha: HARNESS_SHA, operations: sequence, evidence, histories, configurations,
    evidenceSha256: sha256(canonicalJson({ runNonce, evidence, histories, configurations })) });
  } catch (error) { safeFailure(error); }
}

/** Recorded offline observations only, never an executable adapter. */
export function validateOfflineTranscript(runNonce, transcript) {
  const records = clone(transcript); check(Array.isArray(records), 'S1_LOCAL_TRANSCRIPT_REFUSED');
  const program = createMatrixProgram(runNonce); let step = program.next();
  for (const record of records) { check(!step.done, 'S1_LOCAL_EXTRA_OBSERVATION'); step = program.next(record); }
  check(step.done, 'S1_LOCAL_INCOMPLETE_TRANSCRIPT'); return step.value;
}

const HISTORY_SQL = 'SELECT migration_name, checksum, (started_at IS NOT NULL) AS started, '
  + '(finished_at IS NOT NULL) AS completed, (rolled_back_at IS NOT NULL) AS rolled_back, '
  + 'applied_steps_count, logs FROM _prisma_migrations ORDER BY migration_name';
// Everything below is private, reachable only after the immutable execution gate.
// No test rewrites source, instruments private functions or supplies a real adapter.
async function observeSchema(connection, database) {
  const [serverRaw] = await connection.query(`SELECT VERSION() AS version, @@SESSION.sql_mode AS sqlMode,
    @@GLOBAL.character_set_server AS serverCharset, @@GLOBAL.collation_server AS serverCollation,
    @@SESSION.time_zone AS timezone, @@GLOBAL.system_time_zone AS systemTimezone,
    TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS offsetSeconds, @@SESSION.tx_isolation AS isolation,
    @@SESSION.foreign_key_checks AS foreignKeyChecks, @@GLOBAL.default_storage_engine AS defaultEngine`);
  const [schema] = await connection.query('SELECT DEFAULT_CHARACTER_SET_NAME AS charset, DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database]);
  const tables = await connection.query("SELECT TABLE_NAME AS name, ENGINE AS engine, TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME", [database]);
  const columns = (await connection.query(`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name,
    ORDINAL_POSITION AS ordinal, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType, IS_NULLABLE AS nullable,
    COLUMN_DEFAULT AS defaultValue, CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation, EXTRA AS extra
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME, ORDINAL_POSITION`, [database]))
    .map((r) => ({ table: r.tableName, name: r.name, ordinal: Number(r.ordinal), dataType: r.dataType,
      columnType: r.columnType, nullable: r.nullable === 'YES', defaultKind: r.defaultValue === null ? 'NONE' : r.defaultValue === 'NULL' ? 'NULL' : 'VALUE',
      defaultSha256: r.defaultValue === null ? null : sha256(String(r.defaultValue)), charset: r.charset, collation: r.collation, extra: r.extra }));
  const indexes = (await connection.query(`SELECT TABLE_NAME AS tableName, INDEX_NAME AS name,
    NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS sequence, COLUMN_NAME AS columnName, SUB_PART AS subPart
    FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`, [database]))
    .map((r) => ({ table: r.tableName, name: r.name, unique: Number(r.nonUnique) === 0, sequence: Number(r.sequence), column: r.columnName, subPart: r.subPart === null ? null : Number(r.subPart) }));
  const foreignKeys = (await connection.query(`SELECT k.TABLE_NAME AS tableName, k.CONSTRAINT_NAME AS name,
    k.COLUMN_NAME AS columnName, k.ORDINAL_POSITION AS sequence, k.REFERENCED_TABLE_SCHEMA AS referencedSchema,
    k.REFERENCED_TABLE_NAME AS referencedTable, k.REFERENCED_COLUMN_NAME AS referencedColumn,
    r.UPDATE_RULE AS updateRule, r.DELETE_RULE AS deleteRule FROM information_schema.KEY_COLUMN_USAGE k
    JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA
    AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME
    WHERE k.CONSTRAINT_SCHEMA=? AND k.REFERENCED_TABLE_NAME IS NOT NULL
    ORDER BY k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION`, [database]))
    .map((r) => { check(r.referencedSchema === database, 'S1_LOCAL_CROSS_DATABASE_FK');
      return { table: r.tableName, name: r.name, column: r.columnName, sequence: Number(r.sequence),
        referencedTable: r.referencedTable, referencedColumn: r.referencedColumn, updateRule: r.updateRule, deleteRule: r.deleteRule }; });
  const checks = (await connection.query('SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS name, CHECK_CLAUSE AS clause FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=? ORDER BY TABLE_NAME,CONSTRAINT_NAME', [database]))
    .map((r) => ({ table: r.tableName, name: r.name, clauseSha256: sha256(r.clause) }));
  check(serverRaw && schema && Number.isInteger(Number(serverRaw.offsetSeconds))
    && Math.abs(Number(serverRaw.offsetSeconds)) <= 86400, 'S1_LOCAL_INVALID_METADATA');
  const metadata = clone({ database, server: { ...serverRaw, sqlMode: serverRaw.sqlMode.split(',').filter(Boolean).sort(),
    offsetSeconds: Number(serverRaw.offsetSeconds), foreignKeyChecks: Number(serverRaw.foreignKeyChecks) },
  schema, tables: [...tables], columns, indexes, foreignKeys, checks });
  check(metadata.tables.length <= 100 && columns.length <= 2000 && indexes.length <= 1000
    && foreignKeys.length <= 1000 && checks.length <= 1000, 'S1_LOCAL_INVALID_METADATA');
  return metadata;
}
async function legacyRead(client, ids) {
  const spec = readLegacySpec(ids);
  return normalizedLegacySnapshot({ articles: await client.article.findMany(spec.articles),
    versions: await client.articleVersion.findMany(spec.versions), reviews: await client.articleReview.findMany(spec.reviews) });
}
/** A transport rejection is not a known zero-row CAS outcome. This classifier
 * is also used by the private executor before its durable operation ACK. */
export function classifyConcurrencyOutcomes(input) {
  try {
    check(Array.isArray(input) && Object.getPrototypeOf(input) === Array.prototype, 'S1_LOCAL_UNKNOWN_OUTCOME');
    const descriptors = Object.getOwnPropertyDescriptors(input);
    check(descriptors.length?.value === 2 && equal(Object.keys(descriptors).sort(), ['0', '1', 'length']), 'S1_LOCAL_UNKNOWN_OUTCOME');
    const observations = ['0', '1'].map((index) => {
      check(Object.hasOwn(descriptors[index], 'value'), 'S1_LOCAL_UNKNOWN_OUTCOME');
      const record = descriptors[index].value;
      check(record && Object.getPrototypeOf(record) === Object.prototype, 'S1_LOCAL_UNKNOWN_OUTCOME');
      const fields = Object.getOwnPropertyDescriptors(record);
      const status = fields.status?.value;
      check(['fulfilled', 'rejected'].includes(status)
        && equal(Object.keys(fields).sort(), status === 'fulfilled' ? ['status', 'value'] : ['reason', 'status'])
        && Object.values(fields).every((field) => Object.hasOwn(field, 'value')), 'S1_LOCAL_UNKNOWN_OUTCOME');
      return { status, value: status === 'fulfilled' ? fields.value.value : safeError(fields.reason.value).code };
    });
    // A rejected first transaction can have lost commit acknowledgement.
    // Only the contender's explicit Prisma P2034 is a known aborted transaction.
    check(observations[0].status === 'fulfilled'
      && (observations[1].status === 'fulfilled' || observations[1].value === 'P2034'), 'S1_LOCAL_UNKNOWN_OUTCOME');
    check(observations[0].value === 1
      && (observations[1].status === 'fulfilled' ? observations[1].value === 0 : observations[1].value === 'P2034'),
    'S1_LOCAL_CONCURRENCY_FAILED');
    return Object.freeze({ first: 1, second: observations[1].value });
  } catch (error) { safeFailure(error); }
}
async function runConcurrency(firstClient, secondClient, observer, ids) {
  let lockedResolve, releaseResolve, startedResolve;
  const locked = new Promise((resolve) => { lockedResolve = resolve; });
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  const started = new Promise((resolve) => { startedResolve = resolve; });
  let later;
  const first = firstClient.$transaction(async (tx) => {
    const [row] = await tx.$queryRawUnsafe('SELECT CONNECTION_ID() AS id');
    const value = await tx.article.updateMany({ where: { id: ids.casArticle, updatedAt: new Date(FIXTURE_TIME) },
      data: { title: 'Synthetic winner', updatedAt: new Date(NEXT_FIXTURE_TIME) } });
    lockedResolve(Number(row.id)); await release; return value.count;
  }, { isolationLevel: 'Serializable', timeout: 15000, maxWait: 5000 });
  try {
    const firstId = await Promise.race([locked, first.then(() => fail('S1_LOCAL_BARRIER_FAILED'))]);
    const observed = await observer.query('SELECT trx_isolation_level AS isolation FROM information_schema.innodb_trx WHERE trx_mysql_thread_id=?', [firstId]);
    check(observed.length === 1 && observed[0].isolation === 'SERIALIZABLE', 'S1_LOCAL_ISOLATION_NOT_OBSERVED');
    later = secondClient.$transaction(async (tx) => {
      const [row] = await tx.$queryRawUnsafe('SELECT CONNECTION_ID() AS id'); startedResolve(Number(row.id));
      return (await tx.article.updateMany({ where: { id: ids.casArticle, updatedAt: new Date(FIXTURE_TIME) },
        data: { title: 'Synthetic contender', updatedAt: new Date(NEXT_FIXTURE_TIME) } })).count;
    }, { isolationLevel: 'Serializable', timeout: 15000, maxWait: 5000 });
    const secondId = await Promise.race([started, later.then(() => fail('S1_LOCAL_BARRIER_FAILED'))]);
    check(firstId !== secondId, 'S1_LOCAL_DISTINCT_CONNECTION_REQUIRED');
    const deadline = performance.now() + 5000; let lockWait = false;
    while (performance.now() < deadline) {
      const waits = await observer.query(`SELECT r.trx_mysql_thread_id AS requester,b.trx_mysql_thread_id AS blocker
        FROM information_schema.innodb_lock_waits w JOIN information_schema.innodb_trx r ON r.trx_id=w.requesting_trx_id
        JOIN information_schema.innodb_trx b ON b.trx_id=w.blocking_trx_id
        WHERE r.trx_mysql_thread_id=? AND b.trx_mysql_thread_id=?`, [secondId, firstId]);
      if (waits.length === 1) { lockWait = true; break; }
      // Bounded read-only observation polling, never retrying a mutation.
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    releaseResolve();
    const results = await Promise.allSettled([first, later]);
    // Classification must throw before interpret() can return and write ACK.
    const outcomes = classifyConcurrencyOutcomes(results);
    return { isolation: observed[0].isolation, lockWait, ...outcomes };
  } finally { releaseResolve(); await Promise.allSettled([first, ...(later ? [later] : [])]); }
}
async function mediaPointers(client, ids) {
  const version = { ...legacyPlan(ids).find((entry) => entry.id === 'legacy-version-a').args.data,
    id: ids.namespace + '_cycleversion', articleId: ids.casArticle, versionNumber: 99 };
  await client.articleVersion.create({ data: version });
  await client.article.update({ where: { id: ids.casArticle }, data: { activeReviewVersionId: version.id, activeApprovalVersionId: version.id } });
  let pointerRejections = 0;
  for (const field of ['activeReviewVersionId', 'activeApprovalVersionId']) {
    let code; try { await client.articleVersion.delete({ where: { id: version.id } }); } catch (error) { code = safeError(error).code; }
    check(code === 'P2003', 'S1_LOCAL_POINTER_RESTRICT_FAILED'); pointerRejections += 1;
    await client.article.update({ where: { id: ids.casArticle }, data: { [field]: null } });
  }
  await client.articleVersion.delete({ where: { id: version.id } });
  let mediaRejection;
  try { await client.mediaAsset.delete({ where: { id: ids.media } }); } catch (error) { mediaRejection = safeError(error).code; }
  check(mediaRejection === 'P2003', 'S1_LOCAL_MEDIA_RESTRICT_FAILED');
  const abort = new Error('S1_LOCAL_EXPECTED_ROLLBACK'); let caught;
  try {
    await client.$transaction(async (tx) => {
      await tx.articleVersionMedia.delete({ where: { versionId_assetId_context: { versionId: ids.versionNew, assetId: ids.media, context: 'COVER' } } });
      await tx.mediaAsset.delete({ where: { id: ids.media } }); throw abort;
    }, { isolationLevel: 'Serializable' });
  } catch (error) { caught = error; }
  return { pointerRejections, mediaRejection, deletedVersionCount: await client.articleVersion.count({ where: { id: version.id } }),
    restored: caught === abort && await client.mediaAsset.count({ where: { id: ids.media } }) === 1
      && await client.articleVersionMedia.count({ where: { versionId: ids.versionNew, assetId: ids.media } }) === 1 };
}

async function executeAuthorizedMatrix(grant) {
  check(process.platform === 'linux' && process.arch === 'x64' && /^22\./.test(process.versions.node), 'S1_LOCAL_RUNTIME_MISMATCH');
  const fs = await import('node:fs');
  const { createRequire } = await import('node:module');
  const { spawnSync } = await import('node:child_process');
  const { verifyRuntimeSeal, readRegularInput } = await import('./prepare-inputs.mjs');
  const { createFileLedgerAdapter, openEvidenceLedger } = await import('./evidence-ledger.mjs');
  const seal = verifyRuntimeSeal('/inputs', readRegularInput('/inputs', 'local-seal.json'), grant.inputManifestSha256);
  check(seal.harnessSha === HARNESS_SHA && seal.sourceSha === SOURCE_SHA && seal.baselineSha === BASELINE_SHA
    && seal.attempt === 1 && seal.runNonce === grant.runNonce, 'S1_LOCAL_SOURCE_REFUSED');
  // Credentials are synthetic, transferred to private tmpfs only. Never inherited.
  const credentialPath = '/run/cms-s1-private/runtime-credentials.json';
  for (const path of ['/run', '/run/cms-s1-private', credentialPath]) check(!fs.lstatSync(path).isSymbolicLink(), 'S1_LOCAL_UNSAFE_SECRET_PATH');
  const stat = fs.lstatSync(credentialPath);
  check(stat.isFile() && stat.nlink === 1 && stat.size < 4096 && (stat.mode & 0o077) === 0 && stat.uid === process.getuid(), 'S1_LOCAL_UNSAFE_SECRET_PATH');
  const credentials = clone(JSON.parse(fs.readFileSync(credentialPath, 'utf8')));
  check(equal(Object.keys(credentials).sort(), ['bootstrap', 'variants']) && /^[a-f0-9]{64}$/.test(credentials.bootstrap)
    && equal(Object.keys(credentials.variants).sort(), [...VARIANTS].sort()), 'S1_LOCAL_SYNTHETIC_CREDENTIAL_REFUSED');
  for (const variant of VARIANTS) check(equal(Object.keys(credentials.variants[variant]).sort(), ['client', 'ddl'])
    && Object.values(credentials.variants[variant]).every((v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)), 'S1_LOCAL_SYNTHETIC_CREDENTIAL_REFUSED');
  const requireNew = createRequire('/inputs/q1/package.json');
  const requireOld = createRequire('/inputs/old/package.json');
  for (const require of [requireOld, requireNew]) {
    for (const name of ['prisma', '@prisma/client', '@prisma/adapter-mariadb']) check(require(name + '/package.json').version === '7.8.0', 'S1_LOCAL_CLIENT_VERSION_MISMATCH');
    check(require('mariadb/package.json').version === '3.4.5', 'S1_LOCAL_CONNECTOR_VERSION_MISMATCH');
  }
  const mariadb = requireNew('mariadb');
  const ledger = openEvidenceLedger({ adapter: createFileLedgerAdapter({ root: '/evidence', directoryName: 'cms-s1-local-' + seal.runNonce }),
    identity: { runId: seal.runNonce, sourceSha: HARNESS_SHA, inputSha256: seal.inputSha256,
      daemonSha256: seal.daemonSha256, resourcePlanSha256: seal.resourcePlanSha256, seccompSha256: seal.seccompSha256 } });
  const clients = new Map(); let admin;
  function user(variant, role) { return `s1_${seal.runNonce}_${variant}_${role}`; }
  async function connection(variant) {
    return mariadb.createConnection({ socketPath: LOCAL_SOCKET, user: user(variant, 'ddl'),
      password: credentials.variants[variant].ddl, database: variantIdentity(seal.runNonce, variant).database,
      connectTimeout: 5000, multipleStatements: false, timezone: 'Z' });
  }
  function prisma(variant, which) {
    const state = clients.get(variant); check(state, 'S1_LOCAL_CLIENT_MISSING');
    if (!state[which]) {
      const require = which === 'old' ? requireOld : requireNew;
      const { PrismaClient } = require('@prisma/client'); const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
      state[which] = new PrismaClient({ adapter: new PrismaMariaDb({ socketPath: LOCAL_SOCKET,
        user: user(variant, 'client'), password: credentials.variants[variant].client,
        database: state.database, connectionLimit: 4, timezone: 'Z' }), log: [] });
    }
    return state[which];
  }
  async function closeVariant(variant) {
    const state = clients.get(variant); if (!state) return;
    for (const key of ['old', 'new', 'second']) if (state[key]) await state[key].$disconnect();
    await state.connection.end(); clients.delete(variant);
  }
  function prismaProcess(variant, count, diff = false) {
    const tree = `/inputs/migrations/${variant === 'crlf' ? 'crlf' : 'lf'}/${count}`;
    const args = ['/inputs/q1/node_modules/prisma/build/index.js', 'migrate',
      ...(diff ? ['diff', '--from-schema', '/inputs/q1/prisma/schema.prisma', '--to-config-datasource', '--exit-code'] : ['deploy']),
      '--config', tree + '/prisma.config.mjs'];
    // Closed environment; datasource is constructed from private tmpfs by the sealed config.
    const result = spawnSync(process.execPath, args, { cwd: '/work', shell: false, timeout: 120000,
      maxBuffer: 8 * 1024 * 1024, encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp', NODE_ENV: 'test', S1_VARIANT: variant } });
    if (result.error || result.signal || !Number.isInteger(result.status)) fail('S1_LOCAL_UNKNOWN_OUTCOME');
    return { exitCode: result.status, attempts: 1, stdoutSha256: sha256(result.stdout ?? Buffer.alloc(0)),
      stderrSha256: sha256(result.stderr ?? Buffer.alloc(0)) };
  }
  async function interpret(command) {
    const { variant, kind, args } = command; const state = clients.get(variant);
    const sql = state?.connection; const ids = args.ids;
    switch (kind) {
      case 'open': {
        const database = variantIdentity(seal.runNonce, variant).database;
        const existing = await admin.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database]);
        check(existing.length === 0, 'S1_LOCAL_RESOURCE_EXISTS');
        await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET latin1 COLLATE latin1_swedish_ci`);
        for (const role of ['ddl', 'client']) {
          // Identifiers derive only from exact nonce and constants; passwords bind parameters.
          await admin.query(`CREATE USER '${user(variant, role)}'@'localhost' IDENTIFIED BY ?`, [credentials.variants[variant][role]]);
          await admin.query(`GRANT ${role === 'ddl' ? 'ALL PRIVILEGES' : 'SELECT,INSERT,UPDATE,DELETE'} ON \`${database}\`.* TO '${user(variant, role)}'@'localhost'`);
        }
        await admin.query(`GRANT PROCESS ON *.* TO '${user(variant, 'ddl')}'@'localhost'`);
        const conn = await connection(variant); clients.set(variant, { connection: conn, database });
        const identity = await conn.query('SELECT DATABASE() AS name, @@GLOBAL.socket AS socketPath, @@GLOBAL.skip_networking AS skipNetworking');
        check(identity.length === 1 && identity[0].name === database, 'S1_LOCAL_DATABASE_IDENTITY');
        const metadata = await observeSchema(conn, database);
        return { database, socketPath: identity[0].socketPath, skipNetworking: Number(identity[0].skipNetworking) === 1,
          empty: metadata.tables.length === 0, metadata };
      }
      case 'migrate': return prismaProcess(variant, args.count);
      case 'schema-diff': return prismaProcess(variant, 7, true);
      case 'history': return [...(await sql.query(HISTORY_SQL))];
      case 'prisma': {
        const { entry } = args; const client = prisma(variant, args.client);
        let code = 'OK';
        try { await client[entry.delegate][entry.method](entry.args); }
        catch (error) {
          code = safeError(error).code;
          // Only exact expected constraint failures are known outcomes; lost ACK cannot become zero refs.
          if (!['P2002', 'P2003', 'P2025'].includes(code)) fail('S1_LOCAL_UNKNOWN_OUTCOME');
        }
        return { code };
      }
      case 'legacy-read': return legacyRead(prisma(variant, args.client), ids);
      case 'legacy-expanded': {
        const client = prisma(variant, 'new');
        const version = await client.articleVersion.findUnique({ where: { id: ids.versionA } });
        const article = await client.article.findUnique({ where: { id: ids.articleA } });
        const review = await client.articleReview.findUnique({ where: { id: ids.legacyReview } });
        const { inspectReviewSnapshot } = await import('file:///inputs/q1/compiled-consumer.mjs');
        const result = inspectReviewSnapshot({ version });
        return { versionId: version.id, articleId: version.articleId, reviewVersionId: review.versionId,
          snapshotFormatVersion: version.snapshotFormatVersion, basisUpdatedAt: version.basisUpdatedAt,
          accessMode: version.accessMode, articleType: version.articleType, articleAccessMode: article.accessMode,
          activeReviewVersionId: article.activeReviewVersionId, activeApprovalVersionId: article.activeApprovalVersionId,
          consumerError: result.ok === false ? result.error : 'UNEXPECTED_SUCCESS' };
      }
      case 'inject-collision':
        await sql.query('CREATE TABLE ArticleVersionCategory (synthetic_collision INT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
        return { created: true };
      case 'metadata': return observeSchema(sql, state.database);
      case 'product-defaults': {
        const row = await prisma(variant, 'new').product.create({ data: { id: ids.namespace + '_defaults', name: 'Synthetic defaults',
          createdAt: new Date(FIXTURE_TIME), updatedAt: new Date(FIXTURE_TIME) } });
        return { contentState: row.contentState, saleStopped: row.saleStopped };
      }
      case 'mixed-write': {
        const reader = args.writer === 'old' ? 'new' : 'old'; const title = 'Synthetic ' + args.writer + ' client write';
        await prisma(variant, args.writer).article.update({ where: { id: ids.articleB }, data: { title, updatedAt: new Date(FIXTURE_TIME) } });
        return { reader, equal: (await prisma(variant, reader).article.findUnique({ where: { id: ids.articleB } })).title === title };
      }
      case 'rollback': {
        const client = prisma(variant, 'new'); const before = normalizedLegacySnapshot(await client.article.findUnique({ where: { id: ids.articleB } }));
        let code = 'OK';
        try { await client.$transaction(async (tx) => {
          await tx.article.update({ where: { id: ids.articleB }, data: { title: 'Synthetic must rollback' } });
          await tx.articleVersionProduct.create({ data: { articleId: ids.articleA, versionId: ids.versionB, productId: ids.product } });
        }, { isolationLevel: 'Serializable' }); } catch (error) { code = safeError(error).code; }
        if (!['OK', 'P2003'].includes(code)) fail('S1_LOCAL_UNKNOWN_OUTCOME');
        return { code, unchanged: equal(before, normalizedLegacySnapshot(await client.article.findUnique({ where: { id: ids.articleB } }))) };
      }
      case 'concurrency': return runConcurrency(prisma(variant, 'new'), prisma(variant, 'second'), sql, ids);
      case 'keyset-read': {
        const { cursor, take } = args;
        const where = { id: { startsWith: ids.namespace + '_page' }, status: 'SUBMITTED', ...(cursor ? { OR: [
          { submittedAt: { gt: new Date(cursor.submittedAt) } }, { submittedAt: new Date(cursor.submittedAt), id: { gt: cursor.id } },
        ] } : {}) };
        return normalizedLegacySnapshot(await prisma(variant, 'new').article.findMany({ where,
          select: { id: true, submittedAt: true }, orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }], ...(take === null ? {} : { take }) }));
      }
      case 'collation': {
        const [row] = await sql.query("SELECT (_utf8mb4'a'=_utf8mb4'A' COLLATE utf8mb4_unicode_ci) AS equalCase, (_utf8mb4'e'=_utf8mb4'\u00e9' COLLATE utf8mb4_unicode_ci) AS equalAccent");
        return { equalCase: Number(row.equalCase), equalAccent: Number(row.equalAccent) };
      }
      case 'media-pointers': return mediaPointers(prisma(variant, 'new'), ids);
      case 'non-strict-warning': {
        const before = await sql.query('SELECT status FROM Article WHERE id=?', [ids.articleB]); let observation;
        await sql.beginTransaction();
        try {
          await sql.query("UPDATE Article SET status='S1_INVALID_STATUS' WHERE id=?", [ids.articleB]);
          const warnings = await sql.query('SHOW WARNINGS'); const rows = await sql.query('SELECT status FROM Article WHERE id=?', [ids.articleB]);
          observation = { warning1265: warnings.some((r) => Number(r.Code) === 1265), coercedEmpty: rows.length === 1 && rows[0].status === '' };
        } finally { await sql.rollback(); }
        return { ...observation, restored: equal([...before], [...(await sql.query('SELECT status FROM Article WHERE id=?', [ids.articleB]))]) };
      }
      case 'close': await closeVariant(variant); return { closed: true };
      case 'final-history-reread': {
        const conn = await connection(variant);
        try { return [...(await conn.query(HISTORY_SQL))]; } finally { await conn.end(); }
      }
      default: fail('S1_LOCAL_UNKNOWN_OPERATION');
    }
  }
  try {
    admin = await mariadb.createConnection({ socketPath: LOCAL_SOCKET, user: 'root', password: credentials.bootstrap,
      connectTimeout: 5000, multipleStatements: false, timezone: 'Z' });
    const [server] = await admin.query('SELECT VERSION() AS version, @@GLOBAL.socket AS socketPath, @@GLOBAL.skip_networking AS skipNetworking');
    check(/^10\.11\.14(?:-|$)/.test(server.version) && server.socketPath === LOCAL_SOCKET
      && Number(server.skipNetworking) === 1, 'S1_LOCAL_SERVER_REFUSED');
    const schemas = await admin.query('SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA');
    check(schemas.every((r) => ['information_schema', 'mysql', 'performance_schema', 'sys', 'test'].includes(r.name)), 'S1_LOCAL_NONEMPTY_SERVER');
    // Configuration is supplied by admitted MariaDB startup args, never repaired here.
    const program = createMatrixProgram(seal.runNonce); let step = program.next(); let operation = 0;
    while (!step.done) {
      const command = step.value; const operationId = 'op-' + String(++operation).padStart(4, '0');
      const action = command.kind === 'migrate' ? 'MIGRATE' : command.kind === 'prisma' ? 'SEED_FIXTURE'
        : command.mutation ? 'TRANSACTION' : 'OBSERVE';
      ledger.intent({ operationId, action, inputSha256: sha256(canonicalJson(command)) });
      let value;
      try { value = await interpret(command); }
      catch { ledger.unknown(operationId, 'OPERATION_FAILED'); fail('S1_LOCAL_UNKNOWN_OUTCOME'); }
      // Raw SQL rows and failed migration logs are not durable output. Validate in memory, hash only.
      try {
        if (command.kind === 'history' || command.kind === 'final-history-reread') {
          validateMigrationHistory(value, command.variant, command.args.phase ?? 'final');
          if (command.variant === 'fault' && (command.args.phase ?? 'final') === 'final') parsePartialDdlFailure(value[4].logs);
        }
        ledger.ack(operationId, { code: 'OK', evidenceSha256: sha256(canonicalJson(normalizedLegacySnapshot(value))) });
        step = program.next({ id: command.id, outcome: 'ACK', value });
      } catch {
        // An ACK persistence error leaves unresolved INTENT; never repeat the operation.
        ledger.stop('KNOWN_FAILURE'); fail('S1_LOCAL_STOPPED_OR_UNKNOWN');
      }
    }
    const evidence = { ...step.value, classification: 'EXECUTED_DISPOSABLE_ONLY', ledger: ledger.seal(),
      runtime: { node: process.versions.node, platform: process.platform, architecture: process.arch,
        oldPrisma: requireOld('prisma/package.json').version, newPrisma: requireNew('prisma/package.json').version,
        adapter: requireNew('@prisma/adapter-mariadb/package.json').version, connector: requireNew('mariadb/package.json').version } };
    const file = fs.openSync('/evidence/matrix-result.json', 'wx', 0o600);
    try { fs.writeFileSync(file, canonicalJson(evidence)); fs.fsyncSync(file); } finally { fs.closeSync(file); }
    return evidence;
  } finally {
    // Disconnect is containment, not mutation replay or synthetic-data cleanup.
    for (const variant of [...clients.keys()]) await closeVariant(variant);
    if (admin) await admin.end(); ledger.close();
  }
}

export async function executeLocalMatrix() {
  if (LOCAL_MATRIX_EXECUTION_GRANT === null) fail('S1_LOCAL_EXECUTION_HOLD');
  return executeAuthorizedMatrix(LOCAL_MATRIX_EXECUTION_GRANT);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  executeLocalMatrix().catch(() => { process.stderr.write('S1_LOCAL_EXECUTION_HOLD_OR_SAFE_FAILURE\n'); process.exitCode = 1; });
}
