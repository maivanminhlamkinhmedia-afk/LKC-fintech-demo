import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute, join } from 'node:path';
import { CASE_IDS, VARIANTS, SOURCE_SHA, HARNESS_SHA, BASELINE_SHA, expectedRuntimeCases } from './fixture-plan.mjs';
export const sha256 = b => createHash('sha256').update(b).digest('hex');
export const gitBlob = b => createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
export function fail(code = 'W0_ASSERTION_FAILED') { throw new Error(code); }
export function check(ok, code) { if (!ok) fail(code); }
export function plain(value) {
  let count = 0;
  function copy(v, depth = 0) {
    check(++count <= 100000 && depth <= 20, 'W0_EVIDENCE_REFUSED');
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return v;
    if (typeof v === 'string') { check(v.length <= 65536, 'W0_EVIDENCE_REFUSED'); return v; }
    check(v && typeof v === 'object', 'W0_EVIDENCE_REFUSED');
    const ds = Object.getOwnPropertyDescriptors(v), array = Array.isArray(v);
    check(Object.getPrototypeOf(v) === (array ? Array.prototype : Object.prototype) || (!array && Object.getPrototypeOf(v) === null), 'W0_EVIDENCE_REFUSED');
    for (const k of Reflect.ownKeys(ds)) check(typeof k === 'string' && !['__proto__', 'constructor', 'prototype'].includes(k)
      && Object.hasOwn(ds[k], 'value') && (ds[k].enumerable || (array && k === 'length')), 'W0_EVIDENCE_REFUSED');
    if (array) {
      check(v.length <= 20000 && Object.keys(ds).length === v.length + 1, 'W0_EVIDENCE_REFUSED');
      return Array.from({ length: v.length }, (_, i) => { check(Object.hasOwn(ds, i), 'W0_EVIDENCE_REFUSED'); return copy(ds[i].value, depth + 1); });
    }
    return Object.fromEntries(Object.keys(ds).sort().map(k => [k, copy(ds[k].value, depth + 1)]));
  }
  try { return copy(value); } catch { fail('W0_EVIDENCE_REFUSED'); }
}
export const canonical = value => JSON.stringify(plain(value));
export function exactKeys(value, keys) { check(value !== null && typeof value === 'object' && !Array.isArray(value), 'W0_EVIDENCE_REFUSED'); check(Object.keys(value).sort().join('|') === [...keys].sort().join('|'), 'W0_EVIDENCE_REFUSED'); }
export function safePath(root, rel) {
  check(typeof root === 'string' && isAbsolute(root) && typeof rel === 'string'
    && !isAbsolute(rel) && !/^[A-Za-z]:/.test(rel) && !rel.includes('\\')
    && rel.split('/').every(p => p && p !== '.' && p !== '..' && !p.startsWith('.env')), 'W0_PATH_REFUSED');
  const p = resolve(root, rel); check(relative(root, p) && !relative(root, p).startsWith('..'), 'W0_PATH_REFUSED');
  let at = p;
  while (true) {
    check(!lstatSync(at).isSymbolicLink(), 'W0_PATH_REFUSED');
    const parent = dirname(at); if (parent === at) break; at = parent;
  }
  check(lstatSync(p).isFile() && lstatSync(p).size <= 16 * 1024 * 1024, 'W0_PATH_REFUSED');
  return p;
}
export function verifyBytes(bytes, expectedBlob) {
  check(Buffer.isBuffer(bytes) && /^[a-f0-9]{40}$/.test(expectedBlob), 'W0_ARTIFACT_REFUSED');
  const normalized = Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'));
  const payload = gitBlob(bytes) === expectedBlob ? bytes : normalized;
  check(gitBlob(payload) === expectedBlob, 'W0_ARTIFACT_REFUSED');
  return Object.freeze({ gitBlob: expectedBlob, rawSHA256: sha256(bytes), payloadSHA256: sha256(payload) });
}
export function migrationPayload(bytes, expectedBlob) {
  verifyBytes(bytes, expectedBlob);
  const payload = Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'));
  check(gitBlob(payload) === expectedBlob, 'W0_ARTIFACT_REFUSED');
  return payload; // Explicit Git payload; raw evidence remains separately recorded.
}
export function verifyFile(root, rel, blob) { return verifyBytes(readFileSync(safePath(root, rel)), blob); }
const CODES = new Set(['OK', 'W0_ASSERTION_FAILED', 'W0_MATRIX_FAILED', 'W0_MIGRATION_FAILED', 'W0_SCHEMA_MISMATCH', 'W0_INCOMPLETE', 'W0_HISTORY_FAILED', 'W0_TIMEOUT', 'UNKNOWN_OUTCOME']);
// Diagnostics are fixed codes only, never raw exception text, SQL, stack or meta.
const FAILURE_CODES = new Set(['W0_ASSERTION_FAILED', 'W0_MATRIX_FAILED', 'W0_MIGRATION_FAILED',
  'W0_SCHEMA_MISMATCH', 'W0_INCOMPLETE', 'W0_CLOSE_UNKNOWN', 'W0_PROCESS_UNKNOWN',
  'W0_TARGET_VERSION_REFUSED', 'W0_NONEMPTY_TARGET', 'W0_LEGACY_CHANGED', 'W0_PARTIAL_DDL_NOT_OBSERVED',
  'W0_FAULT_NOT_REPRODUCED', 'W0_UNKNOWN_OUTCOME', 'W0_JOURNAL_FAILED', 'W0_CONNECTOR_REFUSED',
  'S1_HISTORY_MISMATCH', 'S1_FAULT_HISTORY_MISMATCH', 'S1_METADATA_MISMATCH', 'S1_INVALID_METADATA',
  'S1_SCHEMA_MISMATCH', 'P2002', 'P2003', 'P2028', 'P2034', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT']);
export function failureCode(error) {
  try {
    const ds = Object.getOwnPropertyDescriptors(error);
    for (const key of ['code', 'message']) if (FAILURE_CODES.has(ds[key]?.value)) return ds[key].value;
  } catch { /* Hostile objects reveal nothing. */ }
  return 'W0_UNCLASSIFIED_FAILURE';
}
export function resultRecord(value) {
  const v = plain(value); exactKeys(v, ['caseId', 'status', 'code', 'evidenceSHA256']);
  check(typeof v.caseId === 'string', 'W0_EVIDENCE_REFUSED');
  const [variant, id, extra] = v.caseId.split(':');
  check(!extra && VARIANTS.includes(variant) && CASE_IDS.includes(id)
    && ['PASS', 'FAIL', 'NOT_RUN', 'UNKNOWN_OUTCOME'].includes(v.status)
    && CODES.has(v.code) && /^[a-f0-9]{64}$/.test(v.evidenceSHA256), 'W0_EVIDENCE_REFUSED');
  check(v.status !== 'PASS' || v.code === 'OK', 'W0_EVIDENCE_REFUSED');
  return Object.freeze(v);
}
export function completion(records) {
  const rows = records.map(resultRecord), expected = expectedRuntimeCases();
  check(new Set(rows.map(r => r.caseId)).size === rows.length, 'W0_EVIDENCE_REFUSED');
  return rows.length === expected.length && expected.every(id => rows.some(r => r.caseId === id && r.status === 'PASS'));
}
// Ordered operation journal. No record contains SQL, credentials, bodies, sessions or raw exceptions.
export function createJournal(persist) {
  let previous = '0'.repeat(64), pending = null, blocked = false;
  const ids = new Set(), entries = [];
  function append(id, phase) {
    const body = { seq: entries.length + 1, operation: id, phase, previous };
    const row = Object.freeze({ ...body, hash: sha256(canonical(body)) });
    try { persist(row); } catch { blocked = true; fail('W0_JOURNAL_FAILED'); }
    entries.push(row); previous = row.hash;
  }
  return Object.freeze({
    async operate(id, fn) {
      check(!blocked && !pending && /^[a-z0-9-]{1,64}$/.test(id) && !ids.has(id), 'W0_OPERATION_REFUSED');
      ids.add(id); pending = id; append(id, 'INTENT');
      try { const value = await fn(); append(id, 'ACK'); pending = null; return value; }
      catch { blocked = true; append(id, 'UNKNOWN'); fail('W0_UNKNOWN_OUTCOME'); }
    },
    snapshot: () => structuredClone(entries),
    unknown: () => blocked || pending !== null,
  });
}
export function inspectJournal(records) {
  let previous = '0'.repeat(64), active = null, stopped = false; const ids = new Set();
  for (const [i, raw] of plain(records).entries()) {
    exactKeys(raw, ['seq', 'operation', 'phase', 'previous', 'hash']);
    const { hash, ...body } = raw;
    check(!stopped && raw.seq === i + 1 && raw.previous === previous && sha256(canonical(body)) === hash
      && /^[a-z0-9-]{1,64}$/.test(raw.operation), 'W0_JOURNAL_REFUSED');
    if (raw.phase === 'INTENT') { check(active === null && !ids.has(raw.operation), 'W0_JOURNAL_REFUSED'); active = raw.operation; ids.add(active); }
    else { check(active === raw.operation && ['ACK', 'UNKNOWN'].includes(raw.phase), 'W0_JOURNAL_REFUSED'); active = null; stopped = raw.phase === 'UNKNOWN'; }
    previous = hash;
  }
  return { outcome: stopped || active !== null ? 'UNKNOWN' : 'KNOWN', head: previous };
}
export function writeExclusive(root, name, data) {
  check(['results.json', 'manifest.json', 'journal.jsonl', 'metadata.json', 'history.json'].includes(name), 'W0_OUTPUT_REFUSED');
  check(!lstatSync(root).isSymbolicLink() && lstatSync(root).isDirectory(), 'W0_OUTPUT_REFUSED');
  const bytes = Buffer.from(typeof data === 'string' ? data : canonical(data));
  check(bytes.length <= 8 * 1024 * 1024, 'W0_OUTPUT_REFUSED');
  const fd = openSync(join(root, name), 'wx', 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  return sha256(bytes);
}
export function identity(value) {
  const v = plain(value);
  exactKeys(v, ['source', 'harness', 'baseline', 'candidate', 'workflowBlob', 'runId', 'attempt', 'job', 'serviceId', 'networkId']);
  check(v.source === SOURCE_SHA && v.harness === HARNESS_SHA && v.baseline === BASELINE_SHA
    && /^[a-f0-9]{40}$/.test(v.candidate) && /^[a-f0-9]{40}$/.test(v.workflowBlob)
    && /^[0-9]{1,20}$/.test(v.runId) && v.attempt === 1 && v.job === 'validate-w0'
    && /^[a-f0-9]{64}$/.test(v.serviceId) && /^[a-f0-9]{64}$/.test(v.networkId), 'W0_IDENTITY_REFUSED');
  return Object.freeze(v);
}
