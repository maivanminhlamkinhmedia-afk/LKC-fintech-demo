import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMatrixProgram, validateOfflineTranscript, variantIdentity, migrationExpectation,
  assertExpandedInventory, classifyConcurrencyOutcomes, executeLocalMatrix, LOCAL_MATRIX_EXECUTION_GRANT, LOCAL_SOCKET, VARIANTS, PARITY_MAP } from '../scripts/cms-release-s1-local/run-local.mjs';
import { MIGRATIONS, FIXTURE_TIME, constraintCases, keysetPlan } from '../scripts/cms-release-s1/fixture-plan.mjs';

// These are deliberately supplied fake observations. No client, process, SQL or DB runs.
const NONCE = '0123456789abcdef012345';
function history(variant, phase) {
  const count = phase === 'baseline' ? 4 : variant === 'fault' ? 5 : 7;
  return MIGRATIONS.slice(0, count).map((m, i) => ({ migration_name: m.name,
    checksum: variant === 'crlf' && i < 3 ? m.crlfSha256 : m.lfSha256, started: 1,
    completed: variant === 'fault' && i === 4 ? 0 : 1, rolled_back: 0, applied_steps_count: 1,
    logs: variant === 'fault' && i === 4 ? 'Database error code:\n1050\nDatabase error:\nTable \'ArticleVersionCategory\' already exists\n' : null }));
}
function metadata(variant, empty = false) {
  const value = { database: variantIdentity(NONCE, variant).database,
    server: { version: '10.11.14-MariaDB', sqlMode: ['ERROR_FOR_DIVISION_BY_ZERO', 'NO_ENGINE_SUBSTITUTION'],
      serverCharset: 'latin1', serverCollation: 'latin1_swedish_ci', isolation: 'REPEATABLE-READ', timezone: 'SYSTEM',
      systemTimezone: 'UTC', offsetSeconds: 0, foreignKeyChecks: 1, defaultEngine: 'InnoDB' },
    schema: { charset: 'latin1', collation: 'latin1_swedish_ci' }, tables: [], columns: [], indexes: [], foreignKeys: [], checks: [] };
  if (empty) return value;
  for (const table of ['Article', 'ArticleVersion', 'Product']) value.tables.push({ name: table, engine: 'InnoDB', collation: 'utf8mb4_unicode_ci' });
  for (const table of ['Article', 'ArticleVersion']) value.columns.push({ table, name: 'accessMode', nullable: true,
    columnType: "enum('PUBLIC','PAID_PRODUCT')", defaultKind: 'NULL' });
  function fk(table, fields, target, targets) {
    const name = table + '_' + fields.join('_') + '_fkey';
    fields.forEach((field, i) => value.foreignKeys.push({ table, name, column: field, sequence: i + 1,
      referencedTable: target, referencedColumn: targets[i], updateRule: 'RESTRICT', deleteRule: 'RESTRICT' }));
  }
  for (const table of ['ArticleReview', 'ArticleReviewEvent', 'ArticleVersionCategory', 'ArticleVersionTopic',
    'ArticleVersionTag', 'ArticleVersionInstrument', 'ArticleVersionSource', 'ArticleVersionDisclosure',
    'ArticleVersionMedia', 'ArticleVersionProduct']) fk(table, ['articleId', 'versionId'], 'ArticleVersion', ['articleId', 'id']);
  for (const field of ['activeReviewVersionId', 'activeApprovalVersionId']) fk('Article', ['id', field], 'ArticleVersion', ['articleId', 'id']);
  fk('ArticleVersionMedia', ['assetId'], 'MediaAsset', ['id']); fk('ArticleProduct', ['articleId'], 'Article', ['id']);
  fk('ArticleProduct', ['productId'], 'Product', ['id']); fk('ArticleVersionProduct', ['productId'], 'Product', ['id']);
  for (const [table, columns] of [['ArticleVersion', ['articleId', 'id']], ['ArticleProduct', ['articleId', 'productId']],
    ['ArticleVersionProduct', ['versionId', 'productId']], ['ArticleVersionMedia', ['versionId', 'assetId', 'context']]]) {
    columns.forEach((column, i) => value.indexes.push({ table, name: 'test_' + table, unique: true, column, sequence: i + 1 }));
  }
  return value;
}
function response(command) {
  const { variant, kind, args } = command; const { ids, database } = variantIdentity(NONCE, variant);
  switch (kind) {
    case 'open': return { database, socketPath: LOCAL_SOCKET, skipNetworking: true, empty: true, metadata: metadata(variant, true) };
    case 'migrate': return { exitCode: variant === 'fault' && args.count === 7 ? 1 : 0, attempts: 1 };
    case 'history': return history(variant, args.phase);
    case 'final-history-reread': return history(variant, 'final');
    case 'prisma': return { code: args.entry.expect === 'SUCCESS' ? 'OK' : args.entry.expect };
    case 'legacy-read': return { articles: [ids.articleA, ids.articleB, ids.casArticle].map((id) => ({ id, updatedAt: FIXTURE_TIME })),
      versions: [{ id: ids.versionA }, { id: ids.versionB }], reviews: [{ id: ids.legacyReview }] };
    case 'legacy-expanded': return { versionId: ids.versionA, articleId: ids.articleA, reviewVersionId: null,
      snapshotFormatVersion: null, basisUpdatedAt: null, accessMode: null, articleType: null, articleAccessMode: null,
      activeReviewVersionId: null, activeApprovalVersionId: null, consumerError: 'UNSUPPORTED_SNAPSHOT' };
    case 'inject-collision': return { created: true };
    case 'schema-diff': return { exitCode: 0 };
    case 'product-defaults': return { contentState: 'UNSELECTABLE', saleStopped: true };
    case 'mixed-write': return { reader: args.writer === 'old' ? 'new' : 'old', equal: true };
    case 'rollback': return { code: 'P2003', unchanged: true };
    case 'concurrency': return { first: 1, second: 0, isolation: 'SERIALIZABLE', lockWait: true };
    case 'keyset-read': {
      let rows = keysetPlan(ids).map((e) => ({ id: e.args.data.id, submittedAt: e.args.data.submittedAt }));
      if (args.cursor) rows = rows.filter((r) => r.submittedAt > args.cursor.submittedAt || r.submittedAt === args.cursor.submittedAt && r.id > args.cursor.id);
      return args.take === null ? rows : rows.slice(0, args.take);
    }
    case 'collation': return { equalCase: 1, equalAccent: 1 };
    case 'media-pointers': return { pointerRejections: 2, mediaRejection: 'P2003', restored: true, deletedVersionCount: 0 };
    case 'non-strict-warning': return { warning1265: true, coercedEmpty: true, restored: true };
    case 'metadata': return variant === 'fault' ? { columns: [
      { table: 'ArticleVersionCategory', name: 'synthetic_collision' },
      { table: 'Article', name: 'activeReviewVersionId' }, { table: 'ArticleReview', name: 'versionId' },
    ] } : metadata(variant);
    case 'close': return { closed: true };
    default: assert.fail('Unimplemented fake observation: ' + kind);
  }
}
function drive(change = () => {}) {
  const program = createMatrixProgram(NONCE); let step = program.next(); const commands = [], transcript = [];
  while (!step.done) {
    const command = step.value; const value = response(command); change(command, value);
    commands.push(command); const record = { id: command.id, outcome: 'ACK', value }; transcript.push(record);
    step = program.next(record);
  }
  return { commands, transcript, result: step.value };
}
test('local matrix hard gate rejects before accessing hostile caller data or constructing adapters', async () => {
  assert.equal(LOCAL_MATRIX_EXECUTION_GRANT, null); let hits = 0;
  await assert.rejects(executeLocalMatrix(new Proxy({}, { get() { hits += 1; throw new Error('secret'); } })), /S1_LOCAL_EXECUTION_HOLD/);
  assert.equal(hits, 0);
});
test('22 hexadecimal nonce leaves two fixture suffix characters and distinct variant namespaces', () => {
  const ids = VARIANTS.map((v) => variantIdentity(NONCE, v).ids);
  assert.equal(new Set(ids.map((i) => i.namespace)).size, 4);
  assert.ok(ids.every((i) => i.runId.length === 24));
  for (const bad of ['x'.repeat(22), NONCE + 'aa', '', null, {}, '0'.repeat(21)]) assert.throws(() => variantIdentity(bad, 'lf'));
});
test('complete fake matrix validates observations without claiming runtime execution', () => {
  const { result, transcript } = drive(); assert.equal(result.classification, 'OBSERVATIONS_VALIDATED_NOT_RUNTIME_ATTESTATION');
  assert.deepEqual(validateOfflineTranscript(NONCE, transcript), result);
  assert.equal(Object.keys(result.histories).length, 4); assert.equal(result.histories.fault.rows.length, 5);
  assert.equal(result.histories.crlf.rows.length, 7); assert.match(result.evidenceSha256, /^[a-f0-9]{64}$/);
});
test('matrix uses frozen13legacy,43constraints,53keyset per successful variant and independent old/new reads', () => {
  const { commands } = drive();
  for (const variant of VARIANTS) {
    const entries = commands.filter((c) => c.variant === variant);
    assert.equal(entries.filter((c) => c.kind === 'prisma' && c.args.client === 'old').length, 13);
    if (variant === 'fault') continue;
    const cases = constraintCases(variantIdentity(NONCE, variant).ids); assert.equal(cases.length, 43);
    assert.equal(entries.filter((c) => c.kind === 'prisma' && cases.some((v) => v.id === c.args.entry.id)).length, 43);
    assert.equal(entries.filter((c) => c.kind === 'prisma' && c.args.entry.id.startsWith('keyset-')).length, 53);
    assert.deepEqual(entries.filter((c) => c.kind === 'legacy-read').map((c) => c.args.client), ['old', 'old', 'new']);
    assert.deepEqual(entries.filter((c) => c.kind === 'mixed-write').map((c) => c.args.writer), ['old', 'new']);
  }
});
test('concurrency accepts only acknowledged winner and zero-row contender or explicit P2034 abort', () => {
  const first = { status: 'fulfilled', value: 1 };
  assert.deepEqual(classifyConcurrencyOutcomes([first, { status: 'fulfilled', value: 0 }]), { first: 1, second: 0 });
  assert.deepEqual(classifyConcurrencyOutcomes([first, { status: 'rejected', reason: Object.assign(new Error('hidden'), { code: 'P2034' }) }]),
    { first: 1, second: 'P2034' });
  assert.throws(() => classifyConcurrencyOutcomes([first, { status: 'fulfilled', value: 1 }]), /S1_LOCAL_CONCURRENCY_FAILED/);
});
test('concurrency classifies lost ACK and unknown rejected transactions before durable ACK', () => {
  const success = { status: 'fulfilled', value: 1 };
  for (const code of ['ECONNRESET', 'ETIMEDOUT', 'P1001', 'P2028', 'P2003', 'UNEXPECTED']) {
    const rejected = { status: 'rejected', reason: Object.assign(new Error('private password must not escape'), { code }) };
    for (const outcomes of [[success, rejected], [rejected, { status: 'fulfilled', value: 0 }]]) {
      assert.throws(() => classifyConcurrencyOutcomes(outcomes), (error) => error.message === 'S1_LOCAL_UNKNOWN_OUTCOME');
    }
  }
  assert.throws(() => classifyConcurrencyOutcomes([{ status: 'rejected', reason: { code: 'P2034' } }, { status: 'fulfilled', value: 0 }]), /S1_LOCAL_UNKNOWN_OUTCOME/);
});
test('concurrency refuses malformed and accessor observations without reading hostile fields', () => {
  let accessed = 0;
  const hostile = { status: 'fulfilled', get value() { accessed += 1; throw new Error('secret'); } };
  assert.throws(() => classifyConcurrencyOutcomes([hostile, { status: 'fulfilled', value: 0 }]), /S1_LOCAL_UNKNOWN_OUTCOME/);
  assert.equal(accessed, 0);
  for (const invalid of [[], [{ status: 'fulfilled', value: 1 }], null, {},
    [{ status: 'fulfilled', value: 1 }, { status: 'rejected', reason: { get code() { accessed += 1; throw new Error('secret'); } } }]]) {
    assert.throws(() => classifyConcurrencyOutcomes(invalid), /S1_LOCAL_UNKNOWN_OUTCOME/);
  }
  assert.equal(accessed, 0);
});
test('only first three historical migrations use CRLF for both CRLF phases', () => {
  for (const variant of VARIANTS) for (const count of [4, 7]) {
    const records = migrationExpectation(variant, count); assert.equal(records.length, count);
    records.forEach((r, i) => assert.equal(r.sha256, variant === 'crlf' && i < 3 ? MIGRATIONS[i].crlfSha256 : MIGRATIONS[i].lfSha256));
  }
});
test('final histories are freshly requested after recovery and every write, fault is not repaired', () => {
  const { commands } = drive(); assert.deepEqual(commands.slice(-4).map((c) => c.kind), Array(4).fill('final-history-reread'));
  assert.deepEqual(commands.slice(-4).map((c) => c.variant), VARIANTS);
  const fault = commands.filter((c) => c.variant === 'fault');
  assert.deepEqual(fault.filter((c) => c.kind === 'migrate').map((c) => c.args.count), [4, 7]);
  assert.equal(fault.filter((c) => c.kind === 'inject-collision').length, 1);
  assert.equal(commands.some((c) => /retry|resolve|repair|cleanup|drop/i.test(c.kind)), false);
});
for (const [name, predicate, corrupt, error] of [
  ['wrong socket', (c) => c.kind === 'open', (v) => { v.socketPath = '/tmp/other.sock'; }, 'TARGET_REFUSED'],
  ['nonempty schema', (c) => c.kind === 'open', (v) => { v.empty = false; }, 'TARGET_REFUSED'],
  ['network enabled', (c) => c.kind === 'open', (v) => { v.skipNetworking = false; }, 'TARGET_REFUSED'],
  ['missing constraint rejection', (c) => c.kind === 'prisma' && c.args.entry.expect === 'P2003', (v) => { v.code = 'OK'; }, 'CONSTRAINT_FAILED'],
  ['wrong error class', (c) => c.kind === 'prisma' && c.args.entry.expect === 'P2002', (v) => { v.code = 'ER_DUP_ENTRY'; }, 'CONSTRAINT_FAILED'],
  ['second migration attempt', (c) => c.kind === 'migrate', (v) => { v.attempts = 2; }, 'MIGRATION_FAILED'],
  ['altered legacy CAS token', (c) => c.kind === 'legacy-read' && c.args.client === 'new', (v) => { v.articles[0].updatedAt = '2026-01-02T00:00:00.000Z'; }, 'LEGACY_CHANGED'],
  ['fabricated PUBLIC legacy', (c) => c.kind === 'legacy-expanded', (v) => { v.articleAccessMode = 'PUBLIC'; }, 'LEGACY_NULL_FAILED'],
  ['legacy consumer incorrectly supported', (c) => c.kind === 'legacy-expanded', (v) => { v.consumerError = 'OK'; }, 'LEGACY_NULL_FAILED'],
  ['old client mixed write invisible', (c) => c.kind === 'mixed-write', (v) => { v.equal = false; }, 'MIXED_WRITE_FAILED'],
  ['rollback changes persisted', (c) => c.kind === 'rollback', (v) => { v.unchanged = false; }, 'ROLLBACK_FAILED'],
  ['missing actual lock wait', (c) => c.kind === 'concurrency', (v) => { v.lockWait = false; }, 'CONCURRENCY_FAILED'],
  ['wrong transaction isolation', (c) => c.kind === 'concurrency', (v) => { v.isolation = 'REPEATABLE-READ'; }, 'CONCURRENCY_FAILED'],
  ['two CAS winners', (c) => c.kind === 'concurrency', (v) => { v.second = 1; }, 'CONCURRENCY_FAILED'],
  ['timestamp precision lost', (c) => c.kind === 'keyset-read' && c.args.take === null, (v) => { v[0].submittedAt = '2026-01-01T00:00:00.000Z'; }, 'TIMESTAMP_OR_KEYSET_FAILED'],
  ['keyset page omitted row', (c) => c.kind === 'keyset-read' && c.args.take === 20, (v) => { v.pop(); }, 'KEYSET_PAGE_FAILED'],
  ['nonmatching collation', (c) => c.kind === 'collation', (v) => { v.equalAccent = 0; }, 'COLLATION_FAILED'],
  ['media reference lost after rollback', (c) => c.kind === 'media-pointers', (v) => { v.restored = false; }, 'MEDIA_POINTER_FAILED'],
  ['missing ENUM warning', (c) => c.kind === 'non-strict-warning', (v) => { v.warning1265 = false; }, 'SQL_MODE_FAILED'],
  ['missing final migration', (c) => c.kind === 'final-history-reread', (v) => { v.pop(); }, 'HISTORY_MISMATCH'],
  ['CRLF checksum relabeled LF', (c) => c.kind === 'history' && c.variant === 'crlf', (v) => { v[0].checksum = MIGRATIONS[0].lfSha256; }, 'HISTORY_MISMATCH'],
  ['wrong fault table', (c) => c.kind === 'history' && c.variant === 'fault' && c.args.phase === 'final', (v) => { v[4].logs = v[4].logs.replace('ArticleVersionCategory', 'OtherTable'); }, 'HISTORY_MISMATCH'],
  ['nearby wrong fault error code', (c) => c.kind === 'history' && c.variant === 'fault' && c.args.phase === 'final', (v) => { v[4].logs = v[4].logs.replace('1050', '10501'); }, 'HISTORY_MISMATCH'],
  ['missing partial ALTER evidence', (c) => c.kind === 'metadata' && c.variant === 'fault', (v) => { v.columns.pop(); }, 'PARTIAL_DDL_NOT_OBSERVED'],
]) test('matrix rejects ' + name, () => assert.throws(() => drive((c, v) => { if (predicate(c)) corrupt(v); }), new RegExp(error)));
test('independent schema oracle rejects wrong FK column order, delete rule, nullable default and missing index', () => {
  assert.equal(assertExpandedInventory(metadata('lf')), true);
  for (const change of [
    (m) => { m.foreignKeys[0].column = 'versionId'; },
    (m) => { m.foreignKeys[0].deleteRule = 'CASCADE'; },
    (m) => { m.columns[0].defaultKind = 'VALUE'; },
    (m) => { m.indexes.pop(); },
  ]) { const value = metadata('lf'); change(value); assert.throws(() => assertExpandedInventory(value), /SCHEMA_/); }
});
test('generator rejects missing, stale, duplicated and unknown-outcome observations without advancing', () => {
  for (const record of [undefined, { id: 'forged', outcome: 'ACK', value: {} },
    { id: '0001-lf-open', outcome: 'UNKNOWN_OUTCOME', value: null }]) {
    const program = createMatrixProgram(NONCE); program.next(); assert.throws(() => program.next(record)); assert.equal(program.next().done, true);
  }
  const program = createMatrixProgram(NONCE); const first = program.next().value;
  const accepted = { id: first.id, outcome: 'ACK', value: response(first) };
  program.next(accepted); assert.throws(() => program.next(accepted), /STALE_OR_REPLAYED/);
});
test('offline transcript must be complete and contains data only, never executable adapter callbacks', () => {
  const { transcript } = drive(); assert.throws(() => validateOfflineTranscript(NONCE, transcript.slice(0, -1)), /INCOMPLETE/);
  assert.throws(() => validateOfflineTranscript(NONCE, [...transcript, transcript[0]]), /EXTRA/);
  let read = 0; const hostile = { get value() { read += 1; throw new Error('credential'); } };
  assert.throws(() => validateOfflineTranscript(NONCE, [hostile])); assert.equal(read, 0);
  assert.throws(() => validateOfflineTranscript(NONCE, { query() { assert.fail('executed'); } }));
});
test('P7 private runtime is not extracted or called and concrete Unix interpreter remains locked', () => {
  const source = readFileSync(new URL('../scripts/cms-release-s1-local/run-local.mjs', import.meta.url), 'utf8');
  assert.equal(Object.keys(PARITY_MAP).length, 6);
  assert.doesNotMatch(source, /executeRehearsal\(|registerHooks\(|runInContext\(/);
  assert.match(source, /socketPath: LOCAL_SOCKET/); assert.match(source, /persist|ledger\.intent/);
  assert.match(source, /validateMigrationHistory\(value/); assert.match(source, /innodb_lock_waits/);
  assert.match(source, /maxBuffer: 8 \* 1024 \* 1024/); assert.match(source, /shell: false/);
});
