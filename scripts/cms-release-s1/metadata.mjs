import { createHash } from 'node:crypto';

// This module creates no connection and performs no I/O at import. Only an
// already-authorized caller may supply a connection to captureMetadata.
const MAX_JSON_BYTES = 1_000_000;
const DB_NAME = /^s1_[a-z0-9]{8,32}_(?:lf|crlf|fault|recovery)$/;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ERROR_CODES = new Set([
  'ER_DUP_ENTRY', 'ER_ROW_IS_REFERENCED_2', 'ER_NO_REFERENCED_ROW_2',
  'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'ER_TABLE_EXISTS_ERROR',
  'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR', 'ER_CANT_CREATE_TABLE',
  'ER_FK_DUP_NAME', 'ER_CANT_DROP_FIELD_OR_KEY', 'ER_CHECK_CONSTRAINT_VIOLATED',
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'P2002', 'P2003', 'P2025', 'P2034',
]);
const EVIDENCE_CODES = new Set([
  'OK', 'EXPECTED_REJECTION', 'SCHEMA_MATCH', 'SOURCE_MATCH', 'NO_RUNTIME_EXECUTION',
  'NOT_AUTHORIZED', 'UNKNOWN_OUTCOME', 'METADATA_MISMATCH', 'MIGRATION_FAILED',
  'ASSERTION_FAILED', 'DB_CONSTRAINT', 'S1_UNEXPECTED_ERROR', ...SAFE_ERROR_CODES,
]);
const COUNT_KEYS = new Set(['rows', 'tables', 'indexes', 'foreignKeys', 'migrations',
  'attempts', 'affected', 'passed', 'failed', 'warnings', 'bytes', 'connections', 'rejected']);
const HASH_KEYS = new Set(['source', 'schema', 'migration', 'before', 'after',
  'expected', 'actual', 'metadata']);

function reject(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function plainData(value, depth = 0, seen = new Set()) {
  if (depth > 20) reject('S1_UNSAFE_EVIDENCE');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > 100_000) reject('S1_UNSAFE_EVIDENCE');
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || seen.has(value)) reject('S1_UNSAFE_EVIDENCE');
  const proto = Object.getPrototypeOf(value);
  const array = Array.isArray(value);
  if ((!array && proto !== Object.prototype && proto !== null)
      || (array && proto !== Array.prototype)) reject('S1_UNSAFE_EVIDENCE');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string')) reject('S1_UNSAFE_EVIDENCE');
  seen.add(value);
  let result;
  if (array) {
    if (value.length > 10_000 || Object.keys(descriptors).some((key) => key !== 'length'
        && !/^(?:0|[1-9][0-9]*)$/.test(key))) reject('S1_UNSAFE_EVIDENCE');
    result = [];
    for (let index = 0; index < value.length; index += 1) {
      const entry = descriptors[index];
      if (!entry || !Object.hasOwn(entry, 'value')) reject('S1_UNSAFE_EVIDENCE');
      result.push(plainData(entry.value, depth + 1, seen));
    }
  } else {
    result = Object.create(null);
    for (const key of Object.keys(descriptors).sort()) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor'
          || key.length > 128 || !Object.hasOwn(descriptors[key], 'value')) reject('S1_UNSAFE_EVIDENCE');
      result[key] = plainData(descriptors[key].value, depth + 1, seen);
    }
  }
  seen.delete(value);
  return result;
}

export function canonicalJson(value) {
  try {
    const result = JSON.stringify(plainData(value));
    if (Buffer.byteLength(result, 'utf8') > MAX_JSON_BYTES) reject('S1_UNSAFE_EVIDENCE');
    return result;
  } catch {
    reject('S1_UNSAFE_EVIDENCE');
  }
}

export function sha256(value) {
  try {
    if (typeof value !== 'string' && !Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
      reject('S1_INVALID_HASH_INPUT');
    }
    return createHash('sha256').update(value).digest('hex');
  } catch {
    reject('S1_INVALID_HASH_INPUT');
  }
}

/** Only machine-readable identifiers, never message, stack, SQL or adapter meta. */
export function safeError(error) {
  try {
    if (!error || typeof error !== 'object') return { code: 'S1_UNEXPECTED_ERROR' };
    const fields = Object.getOwnPropertyDescriptors(error);
    const code = fields.code && Object.hasOwn(fields.code, 'value') ? fields.code.value : undefined;
    const result = { code: SAFE_ERROR_CODES.has(code) ? code : 'S1_UNEXPECTED_ERROR' };
    const errno = fields.errno?.value;
    if (Number.isSafeInteger(errno) && errno >= 1000 && errno <= 9999) result.errno = errno;
    const state = fields.sqlState?.value ?? fields.sqlstate?.value;
    if (['23000', '40001', 'HY000', '42S01', '42S02', '42S22', '42000', '08000', '08006']
      .includes(state)) result.sqlState = state;
    return Object.freeze(result);
  } catch {
    return Object.freeze({ code: 'S1_UNEXPECTED_ERROR' });
  }
}

/** Public records intentionally cannot carry free text, URLs, credentials or raw output. */
export function sanitizeEvidence(records) {
  try {
    const copied = JSON.parse(canonicalJson(records));
    if (!Array.isArray(copied) || copied.length > 1000) reject('S1_UNSAFE_EVIDENCE');
    const identifiers = new Set();
    for (const record of copied) {
      if (!record || Array.isArray(record) || typeof record !== 'object'
          || Object.keys(record).some((key) => !['caseId', 'status', 'code', 'counts', 'hashes'].includes(key))
          || !/^S1-[A-Z0-9_-]{1,60}$/.test(record.caseId)
          || identifiers.has(record.caseId)
          || !['PASS', 'FAIL', 'NOT_RUN', 'BLOCKED', 'UNKNOWN_OUTCOME'].includes(record.status)
          || !EVIDENCE_CODES.has(record.code)) reject('S1_UNSAFE_EVIDENCE');
      identifiers.add(record.caseId);
      if (record.counts !== undefined) {
        if (!record.counts || Array.isArray(record.counts) || typeof record.counts !== 'object') reject('S1_UNSAFE_EVIDENCE');
        for (const [key, value] of Object.entries(record.counts)) {
          if (!COUNT_KEYS.has(key) || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000) reject('S1_UNSAFE_EVIDENCE');
        }
        Object.freeze(record.counts);
      }
      if (record.hashes !== undefined) {
        if (!record.hashes || Array.isArray(record.hashes) || typeof record.hashes !== 'object') reject('S1_UNSAFE_EVIDENCE');
        for (const [key, value] of Object.entries(record.hashes)) {
          if (!HASH_KEYS.has(key) || typeof value !== 'string' || !SHA256.test(value)) reject('S1_UNSAFE_EVIDENCE');
        }
        Object.freeze(record.hashes);
      }
      Object.freeze(record);
    }
    return Object.freeze(copied);
  } catch {
    reject('S1_UNSAFE_EVIDENCE');
  }
}

function text(value, pattern, maxLength = 128) {
  if (typeof value !== 'string' || value.length > maxLength || !pattern.test(value)) reject('S1_INVALID_METADATA');
  return value;
}
function identifier(value) { return text(value, IDENTIFIER); }
function nullableIdentifier(value) { return value === null ? null : identifier(value); }
function integer(value, max = 1_000_000) {
  const result = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(result) || result < 0 || result > max) reject('S1_INVALID_METADATA');
  return result;
}
function rows(value, max) {
  if (!Array.isArray(value) || value.length > max) reject('S1_INVALID_METADATA');
  return value;
}
function rule(value) { return text(value, /^(?:RESTRICT|CASCADE|SET NULL|NO ACTION)$/); }

/** Read-only information_schema and server variables; no application rows are read. */
export async function captureMetadata(connection, database) {
  if (typeof database !== 'string' || !DB_NAME.test(database)) reject('S1_INVALID_DATABASE');
  if (!connection || typeof connection.query !== 'function') reject('S1_INVALID_CONNECTION');
  const serverRows = rows(await connection.query(`SELECT VERSION() AS version,
    @@SESSION.sql_mode AS sqlMode, @@GLOBAL.character_set_server AS serverCharset,
    @@GLOBAL.collation_server AS serverCollation, @@SESSION.time_zone AS timezone,
    @@GLOBAL.system_time_zone AS systemTimezone, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS offsetSeconds, @@SESSION.tx_isolation AS isolation,
    @@SESSION.foreign_key_checks AS foreignKeyChecks,
    @@GLOBAL.default_storage_engine AS defaultEngine`), 1);
  if (serverRows.length !== 1) reject('S1_INVALID_METADATA');
  const raw = serverRows[0];
  if (!Number.isInteger(raw.offsetSeconds) || Math.abs(raw.offsetSeconds) > 86400) reject('S1_INVALID_METADATA');
  const server = {
    version: text(raw.version, /^[0-9][A-Za-z0-9.+_-]*$/, 160),
    sqlMode: text(raw.sqlMode, /^[A-Z0-9_,]*$/, 2048).split(',').filter(Boolean).sort(),
    serverCharset: identifier(raw.serverCharset), serverCollation: identifier(raw.serverCollation),
    timezone: text(raw.timezone, /^(?:SYSTEM|[+-][0-9]{2}:[0-9]{2}|[A-Za-z_]+(?:\/[A-Za-z_]+)*)$/),
    systemTimezone: text(raw.systemTimezone, /^[A-Za-z0-9_:+/-]+$/),
    offsetSeconds: raw.offsetSeconds,
    isolation: text(raw.isolation, /^(?:READ-UNCOMMITTED|READ-COMMITTED|REPEATABLE-READ|SERIALIZABLE)$/),
    foreignKeyChecks: integer(raw.foreignKeyChecks, 1), defaultEngine: identifier(raw.defaultEngine),
  };
  const databaseRows = rows(await connection.query(`SELECT DEFAULT_CHARACTER_SET_NAME AS charset,
    DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?`, [database]), 1);
  if (databaseRows.length !== 1) reject('S1_INVALID_METADATA');
  const schema = { charset: identifier(databaseRows[0].charset), collation: identifier(databaseRows[0].collation) };
  const tables = rows(await connection.query(`SELECT TABLE_NAME AS name, ENGINE AS engine,
    TABLE_COLLATION AS collation FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`, [database]), 100)
    .map((row) => ({ name: identifier(row.name), engine: identifier(row.engine), collation: nullableIdentifier(row.collation) }));
  const columns = rows(await connection.query(`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name,
    ORDINAL_POSITION AS ordinal, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType,
    IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue, CHARACTER_SET_NAME AS charset,
    COLLATION_NAME AS collation, EXTRA AS extra FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`, [database]), 2000)
    .map((row) => ({
      table: identifier(row.tableName), name: identifier(row.name), ordinal: integer(row.ordinal),
      dataType: identifier(row.dataType), columnType: text(row.columnType, /^[A-Za-z0-9_(),' .-]+$/, 4096),
      nullable: text(row.nullable, /^(?:YES|NO)$/) === 'YES',
      // Defaults can be arbitrary literals. Retain their identity without exposing their text.
      defaultKind: row.defaultValue === null ? 'NONE' : row.defaultValue === 'NULL' ? 'NULL' : 'VALUE',
      defaultSha256: row.defaultValue === null ? null : sha256(String(row.defaultValue)),
      charset: nullableIdentifier(row.charset), collation: nullableIdentifier(row.collation),
      extra: text(row.extra, /^[A-Za-z0-9_() ,.-]*$/, 256),
    }));
  const indexes = rows(await connection.query(`SELECT TABLE_NAME AS tableName, INDEX_NAME AS name,
    NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS sequence, COLUMN_NAME AS columnName,
    SUB_PART AS subPart FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`, [database]), 1000)
    .map((row) => ({ table: identifier(row.tableName), name: identifier(row.name),
      unique: integer(row.nonUnique, 1) === 0, sequence: integer(row.sequence),
      column: identifier(row.columnName), subPart: row.subPart === null ? null : integer(row.subPart) }));
  const foreignKeys = rows(await connection.query(`SELECT k.TABLE_NAME AS tableName, k.CONSTRAINT_NAME AS name,
    k.COLUMN_NAME AS columnName, k.ORDINAL_POSITION AS sequence,
    k.REFERENCED_TABLE_SCHEMA AS referencedSchema, k.REFERENCED_TABLE_NAME AS referencedTable,
    k.REFERENCED_COLUMN_NAME AS referencedColumn,
    r.UPDATE_RULE AS updateRule, r.DELETE_RULE AS deleteRule
    FROM information_schema.KEY_COLUMN_USAGE k
    JOIN information_schema.REFERENTIAL_CONSTRAINTS r
      ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
      AND r.TABLE_NAME = k.TABLE_NAME
    WHERE k.CONSTRAINT_SCHEMA = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL
    ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`, [database]), 1000)
    .map((row) => {
      if (row.referencedSchema !== database) reject('S1_INVALID_METADATA');
      return { table: identifier(row.tableName), name: identifier(row.name), column: identifier(row.columnName),
        sequence: integer(row.sequence), referencedTable: identifier(row.referencedTable),
        referencedColumn: identifier(row.referencedColumn), updateRule: rule(row.updateRule), deleteRule: rule(row.deleteRule) };
    });
  const checks = rows(await connection.query(`SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS name,
    CHECK_CLAUSE AS clause FROM information_schema.CHECK_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = ? ORDER BY TABLE_NAME, CONSTRAINT_NAME`, [database]), 1000)
    .map((row) => {
      if (typeof row.clause !== 'string' || row.clause.length > 16_384) reject('S1_INVALID_METADATA');
      return { table: identifier(row.tableName), name: identifier(row.name), clauseSha256: sha256(row.clause) };
    });
  return { database, server, schema, tables, columns, indexes, foreignKeys, checks };
}

/** Compare the known S0 properties, not unobserved hosting-specific binary flags/offset. */
export function assertMetadataMatchesS0(metadata, { requireTables = true } = {}) {
  const copied = JSON.parse(canonicalJson(metadata));
  if (!copied || !DB_NAME.test(copied.database ?? '') || !copied.server || !copied.schema
      || !/^10\.11\.14(?:-|$)/.test(copied.server.version)
      || canonicalJson(copied.server.sqlMode) !== canonicalJson(['ERROR_FOR_DIVISION_BY_ZERO', 'NO_ENGINE_SUBSTITUTION'])
      || copied.server.serverCharset !== 'latin1' || copied.server.serverCollation !== 'latin1_swedish_ci'
      || copied.server.isolation !== 'REPEATABLE-READ' || copied.server.timezone !== 'SYSTEM'
      || copied.server.foreignKeyChecks !== 1 || copied.server.defaultEngine !== 'InnoDB'
      || copied.schema.charset !== 'latin1' || copied.schema.collation !== 'latin1_swedish_ci'
      || !Array.isArray(copied.tables) || (requireTables && copied.tables.length === 0)
      || copied.tables.some((table) => table.engine !== 'InnoDB' || table.collation !== 'utf8mb4_unicode_ci')) {
    reject('S1_METADATA_MISMATCH');
  }
  return true;
}

/** Expected inventory must be independently obtained from reviewed SQL/schema. */
export function assertSchemaInventory(metadata, expected) {
  const actualData = JSON.parse(canonicalJson(metadata));
  const expectedData = JSON.parse(canonicalJson(expected));
  for (const key of ['tables', 'columns', 'indexes', 'foreignKeys', 'checks']) {
    if (!Array.isArray(actualData?.[key]) || !Array.isArray(expectedData?.[key])
        || canonicalJson(actualData[key]) !== canonicalJson(expectedData[key])) reject('S1_SCHEMA_MISMATCH');
  }
  return true;
}
