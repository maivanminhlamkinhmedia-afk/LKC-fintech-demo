/** Offline candidate: hash chains detect corruption, not a malicious host/admin. */
import * as fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const SOURCE = '17ffb61232de69f1be41ab61f44dc6246328b22c';
const HEX = /^[a-f0-9]{64}$/;
const RUN = /^[a-f0-9]{22}$/;
const ZERO = '0'.repeat(64);
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_RECORDS = 4096;
const ACTIONS = new Set(['CREATE_NETWORK', 'CREATE_VOLUME', 'CREATE_CONTAINER', 'START_CONTAINER', 'ATTEST_RESOURCE', 'RUN_MATRIX', 'CLEANUP_RESOURCE', 'TRANSFER_INPUTS', 'RUN_CANARY', 'PREPARE_VOLUMES', 'MIGRATE', 'SEED_FIXTURE', 'TRANSACTION', 'OBSERVE']);
const CODES = new Set(['PRECONDITION_FAILED', 'POLICY_DENIED', 'KNOWN_FAILURE', 'EVIDENCE_INVALID', 'RESOURCE_IDENTITY_CHANGED', 'INCOMPLETE_EVIDENCE', 'IO_FAILURE', 'LOST_ACK', 'PROCESS_INTERRUPTED', 'OPERATION_FAILED']);
const SUFFIXES = new Set(['network', 'inputs', 'work', 'evidence', 'data', 'socket', 'db', 'node', 'db-canary', 'node-canary']);

function fail(code) { throw new Error(code); }
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function object(value, keys, optional = []) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('EVIDENCE_INVALID');
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) fail('EVIDENCE_INVALID');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some(k => typeof k !== 'string' || ![...keys, ...optional].includes(k))) fail('EVIDENCE_INVALID');
    if (keys.some(k => !Object.hasOwn(descriptors, k))) fail('EVIDENCE_INVALID');
    const copy = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail('EVIDENCE_INVALID');
      copy[key] = descriptor.value;
    }
    return copy;
  } catch { fail('EVIDENCE_INVALID'); }
}
function canonical(value) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}
function identityValue(value) {
  const item = object(value, ['runId', 'sourceSha', 'inputSha256', 'daemonSha256', 'resourcePlanSha256', 'seccompSha256']);
  if (typeof item.runId !== 'string' || !RUN.test(item.runId) || item.sourceSha !== SOURCE || ['inputSha256', 'daemonSha256', 'resourcePlanSha256', 'seccompSha256'].some(k => typeof item[k] !== 'string' || !HEX.test(item[k]))) fail('IDENTITY_INVALID');
  return item;
}
function resourceValue(value, runId, requireId = false) {
  const item = object(value, ['kind', 'name'], ['id']);
  if (!['container', 'network', 'volume'].includes(item.kind) || typeof item.name !== 'string') fail('RESOURCE_INVALID');
  const prefix = `cms-s1-local-${runId}-`;
  if (!item.name.startsWith(prefix) || !SUFFIXES.has(item.name.slice(prefix.length))) fail('RESOURCE_INVALID');
  const suffix = item.name.slice(prefix.length);
  if ((item.kind === 'network' && suffix !== 'network') || (item.kind === 'volume' && !['inputs', 'work', 'evidence', 'data', 'socket'].includes(suffix)) || (item.kind === 'container' && !['db', 'node', 'db-canary', 'node-canary'].includes(suffix))) fail('RESOURCE_INVALID');
  if ((requireId || Object.hasOwn(item, 'id')) && (typeof item.id !== 'string' || !HEX.test(item.id))) fail('RESOURCE_INVALID');
  return item;
}
function operationValue(value, identity) {
  const item = object(value, ['operationId', 'action', 'inputSha256'], ['resource']);
  if (typeof item.operationId !== 'string' || !/^op-[0-9]{4}$/.test(item.operationId) || !ACTIONS.has(item.action) || typeof item.inputSha256 !== 'string' || !HEX.test(item.inputSha256)) fail('OPERATION_INVALID');
  if (Object.hasOwn(item, 'resource')) item.resource = resourceValue(item.resource, identity.runId);
  if (!['RUN_MATRIX', 'MIGRATE', 'SEED_FIXTURE', 'TRANSACTION', 'OBSERVE'].includes(item.action) && !item.resource) fail('RESOURCE_INVALID');
  if (item.action === 'CLEANUP_RESOURCE' && !item.resource?.id) fail('RESOURCE_INVALID');
  const createKind = { CREATE_NETWORK: 'network', CREATE_VOLUME: 'volume', CREATE_CONTAINER: 'container' }[item.action];
  if (createKind && item.resource?.kind !== createKind) fail('RESOURCE_INVALID');
  return item;
}
function ackValue(value, identity, operation) {
  const item = object(value, ['code', 'evidenceSha256'], ['resource']);
  if (item.code !== 'OK' || typeof item.evidenceSha256 !== 'string' || !HEX.test(item.evidenceSha256)) fail('EVIDENCE_INVALID');
  if (operation.resource) {
    item.resource = resourceValue(item.resource, identity.runId, true);
    if (item.resource.kind !== operation.resource.kind || item.resource.name !== operation.resource.name || (operation.resource.id && item.resource.id !== operation.resource.id)) fail('RESOURCE_INVALID');
  } else if (Object.hasOwn(item, 'resource')) fail('RESOURCE_INVALID');
  return item;
}
function safeCode(code) { if (!CODES.has(code)) fail('EVIDENCE_INVALID'); return code; }
function recordHash(record) { const { hash: omitted, ...payload } = record; void omitted; return digest(canonical(payload)); }
function same(a, b) { return canonical(a) === canonical(b); }

/** No raw stdout/stderr, SQL, arbitrary messages, credential fields or free-form text are accepted. */
export function inspectEvidenceLedger(bytes, expectedIdentity) {
  try {
    const expected = identityValue(expectedIdentity);
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_BYTES || bytes.at(-1) !== 10) fail('LEDGER_CORRUPT');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const lines = text.slice(0, -1).split('\n');
    if (lines.length > MAX_RECORDS || lines.some(line => Buffer.byteLength(line) > 16384)) fail('LEDGER_CORRUPT');
    const records = []; const seen = new Set(); const owned = new Map(); const created = new Set(); let pending = null; let state = 'ACTIVE'; let previous = ZERO;
    for (let seq = 0; seq < lines.length; seq++) {
      const raw = JSON.parse(lines[seq]);
      const fields = ['version', 'seq', 'previousHash', 'kind', 'hash'];
      const additions = { OPEN: ['identity'], INTENT: ['operation'], ACK: ['operationId', 'result'], STOPPED: ['code'], UNKNOWN_OUTCOME: ['operationId', 'code'], SEALED: ['code'] };
      if (!Object.hasOwn(additions, raw.kind)) fail('LEDGER_CORRUPT');
      const item = object(raw, [...fields, ...additions[raw.kind]]);
      if (item.version !== 1 || item.seq !== seq || item.previousHash !== previous || !HEX.test(item.hash) || item.hash !== recordHash(item) || lines[seq] !== canonical(item)) fail('LEDGER_CORRUPT');
      if (seq === 0) {
        if (item.kind !== 'OPEN' || !same(identityValue(item.identity), expected)) fail('LEDGER_CORRUPT');
      } else {
        if (state !== 'ACTIVE') fail('LEDGER_CORRUPT');
        if (item.kind === 'INTENT') {
          const operation = operationValue(item.operation, expected);
          if (pending || seen.has(operation.operationId)) fail('LEDGER_CORRUPT');
          if (operation.action === 'CLEANUP_RESOURCE' && !same(owned.get(operation.resource.name) ?? null, operation.resource)) fail('LEDGER_CORRUPT');
          if (['CREATE_NETWORK', 'CREATE_VOLUME', 'CREATE_CONTAINER'].includes(operation.action)) {
            if (created.has(operation.resource.name) || operation.resource.id) fail('LEDGER_CORRUPT'); created.add(operation.resource.name);
          }
          seen.add(operation.operationId); pending = operation;
        } else if (item.kind === 'ACK') {
          if (!pending || item.operationId !== pending.operationId) fail('LEDGER_CORRUPT');
          const result = ackValue(item.result, expected, pending);
          if (['CREATE_NETWORK', 'CREATE_VOLUME', 'CREATE_CONTAINER'].includes(pending.action)) owned.set(result.resource.name, result.resource);
          if (pending.action === 'CLEANUP_RESOURCE') owned.delete(result.resource.name);
          pending = null;
        } else if (item.kind === 'UNKNOWN_OUTCOME') {
          if (!pending || item.operationId !== pending.operationId) fail('LEDGER_CORRUPT');
          safeCode(item.code); state = 'UNKNOWN_OUTCOME';
        } else if (item.kind === 'STOPPED') {
          if (pending) fail('LEDGER_CORRUPT');
          safeCode(item.code); state = 'STOPPED';
        } else if (item.kind === 'SEALED') {
          if (pending || item.code !== 'COMPLETE') fail('LEDGER_CORRUPT'); state = 'SEALED';
        } else fail('LEDGER_CORRUPT');
      }
      records.push(item); previous = item.hash;
    }
    return Object.freeze({ state: pending ? 'UNKNOWN_OUTCOME' : state, pendingOperationId: pending?.operationId ?? null, recordCount: records.length, chainSha256: previous, identitySha256: digest(canonical(expected)), records: Object.freeze(records) });
  } catch { fail('LEDGER_CORRUPT'); }
}

/** Test adapter is explicitly memory-only; this is not filesystem durability evidence. */
export function createMemoryLedgerAdapter() {
  let content = null; let closed = false;
  return Object.freeze({
    durability: 'MEMORY_ONLY',
    initialize() { if (content !== null) fail('LEDGER_EXISTS'); content = Buffer.alloc(0); },
    read() { if (content === null) fail('LEDGER_MISSING'); return Buffer.from(content); },
    append(bytes) { if (closed || content === null) fail('LEDGER_IO_FAILED'); content = Buffer.concat([content, bytes]); },
    flush() { if (closed) fail('LEDGER_IO_FAILED'); },
    close() { closed = true; },
  });
}
function assertNoLinks(target, directory) {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved); let cursor = parsed.root;
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && cursor !== resolved)) fail('LEDGER_PATH_UNSAFE');
  }
  const stat = fs.lstatSync(resolved);
  if (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) fail('LEDGER_PATH_UNSAFE');
  return stat;
}

/** No filesystem access at import or adapter construction. Operations are explicit and local. */
export function createFileLedgerAdapter(options) {
  const config = object(options, ['root', 'directoryName']);
  if (typeof config.root !== 'string' || !path.isAbsolute(config.root) || typeof config.directoryName !== 'string' || !/^cms-s1-local-[a-f0-9]{22}$/.test(config.directoryName)) fail('LEDGER_PATH_UNSAFE');
  const root = path.resolve(config.root); const directory = path.join(root, config.directoryName);
  const filename = path.join(directory, 'journal.jsonl'); let fd = null; let closed = false; let identity = null;
  function check() {
    if (closed || fd === null) fail('LEDGER_IO_FAILED');
    assertNoLinks(root, true); assertNoLinks(directory, true);
    const actual = assertNoLinks(filename, false); const open = fs.fstatSync(fd);
    if (actual.dev !== open.dev || actual.ino !== open.ino || actual.nlink !== 1 || actual.dev !== identity.dev || actual.ino !== identity.ino) fail('LEDGER_PATH_UNSAFE');
  }
  return Object.freeze({
    // fsync(file) is real; Windows directory fsync / crash-atomic directory creation is NOT VERIFIED.
    durability: process.platform === 'win32' ? 'FILE_FSYNC_ONLY_DIRECTORY_NOT_VERIFIED' : 'FILE_AND_DIRECTORY_FSYNC',
    initialize() {
      try {
        if (closed || fd !== null) fail('LEDGER_EXISTS');
        assertNoLinks(root, true); fs.mkdirSync(directory, { mode: 0o700 }); assertNoLinks(directory, true);
        fd = fs.openSync(filename, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
        identity = fs.fstatSync(fd); fs.fsyncSync(fd);
        if (process.platform !== 'win32') for (const entry of [directory, root]) {
          const handle = fs.openSync(entry, 'r'); try { fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
        }
      } catch { if (fd !== null) { try { fs.closeSync(fd); } catch { /* Already closed: no retry. */ } fd = null; } fail('LEDGER_CREATE_FAILED'); }
    },
    read() {
      let reader = null;
      try {
        assertNoLinks(root, true); assertNoLinks(directory, true); const before = assertNoLinks(filename, false);
        if (before.size > MAX_BYTES) fail('LEDGER_CORRUPT');
        reader = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
        const opened = fs.fstatSync(reader); if (before.dev !== opened.dev || before.ino !== opened.ino || opened.nlink !== 1) fail('LEDGER_PATH_UNSAFE');
        const buffer = Buffer.alloc(opened.size + 1); let length = 0;
        while (length < buffer.length) { const count = fs.readSync(reader, buffer, length, buffer.length - length, null); if (!count) break; length += count; }
        if (length !== opened.size || fs.fstatSync(reader).size !== opened.size) fail('LEDGER_CORRUPT'); return buffer.subarray(0, length);
      } catch { fail('LEDGER_READ_FAILED'); } finally { if (reader !== null) fs.closeSync(reader); }
    },
    append(bytes) {
      try {
        check(); if (!Buffer.isBuffer(bytes) || bytes.length > 16384 || fs.fstatSync(fd).size + bytes.length > MAX_BYTES) fail('LEDGER_IO_FAILED');
        let offset = 0; while (offset < bytes.length) { const written = fs.writeSync(fd, bytes, offset, bytes.length - offset); if (written <= 0) fail('LEDGER_IO_FAILED'); offset += written; }
      } catch { fail('LEDGER_IO_FAILED'); }
    },
    flush() { try { check(); fs.fsyncSync(fd); } catch { fail('LEDGER_IO_FAILED'); } },
    close() { try { if (fd !== null) { fs.closeSync(fd); fd = null; } closed = true; } catch { fail('LEDGER_IO_FAILED'); } },
  });
}

/** Opening existing evidence never grants continuation; it is reconciliation/read-only only. */
export function openEvidenceLedger(options) {
  const config = object(options, ['adapter', 'identity'], ['create']);
  const adapter = object(config.adapter, ['durability', 'initialize', 'read', 'append', 'flush', 'close']);
  if (!['MEMORY_ONLY', 'FILE_FSYNC_ONLY_DIRECTORY_NOT_VERIFIED', 'FILE_AND_DIRECTORY_FSYNC'].includes(adapter.durability) || ['initialize', 'read', 'append', 'flush', 'close'].some(key => typeof adapter[key] !== 'function')) fail('EVIDENCE_INVALID');
  const create = Object.hasOwn(config, 'create') ? config.create : true;
  const identity = identityValue(config.identity);
  if (typeof create !== 'boolean') fail('EVIDENCE_INVALID');
  let state = 'ACTIVE'; let pending = null; let closed = false; let previous = ZERO; let sequence = 0;
  const records = []; const seen = new Set(); const owned = new Map(); const created = new Set();
  function append(kind, extra) {
    if (records.length >= MAX_RECORDS) { state = 'UNKNOWN_OUTCOME'; fail('LEDGER_CAPACITY'); }
    const payload = { version: 1, seq: sequence, previousHash: previous, kind, ...extra };
    const record = { ...payload, hash: digest(canonical(payload)) };
    try { adapter.append(Buffer.from(`${canonical(record)}\n`, 'utf8')); adapter.flush(); }
    catch { state = 'UNKNOWN_OUTCOME'; fail('LEDGER_DURABILITY_FAILED'); }
    records.push(record); previous = record.hash; sequence++;
  }
  function writable() { if (closed || !create || state !== 'ACTIVE') fail('LEDGER_NOT_ACTIVE'); }
  function markUnknown(code) {
    if (!pending) fail('OPERATION_MISSING');
    try { append('UNKNOWN_OUTCOME', { operationId: pending.operationId, code: safeCode(code) }); }
    finally { state = 'UNKNOWN_OUTCOME'; }
  }
  if (create) {
    try { adapter.initialize(); } catch { fail('LEDGER_CREATE_FAILED'); }
    append('OPEN', { identity });
  } else {
    const existing = inspectEvidenceLedger(adapter.read(), identity);
    state = existing.state; previous = existing.chainSha256; sequence = existing.recordCount;
    records.push(...existing.records);
    if (existing.pendingOperationId) pending = records.find(record => record.kind === 'INTENT' && record.operation.operationId === existing.pendingOperationId).operation;
  }
  return Object.freeze({
    intent(value) {
      writable(); if (pending) fail('OPERATION_PENDING');
      const item = operationValue(value, identity); if (seen.has(item.operationId)) fail('OPERATION_DUPLICATE');
      if (item.action === 'CLEANUP_RESOURCE' && !same(owned.get(item.resource.name) ?? null, item.resource)) fail('RESOURCE_NOT_OWNED');
      if (['CREATE_NETWORK', 'CREATE_VOLUME', 'CREATE_CONTAINER'].includes(item.action)) {
        if (created.has(item.resource.name) || item.resource.id) fail('RESOURCE_ALREADY_SEEN'); created.add(item.resource.name);
      }
      seen.add(item.operationId); pending = item; append('INTENT', { operation: item });
      return Object.freeze({ operationId: item.operationId, intentSha256: previous });
    },
    ack(operationId, result) {
      writable(); if (!pending) fail('OPERATION_MISSING');
      let item;
      try { if (operationId !== pending.operationId) fail('OPERATION_MISMATCH'); item = ackValue(result, identity, pending); }
      catch { markUnknown('EVIDENCE_INVALID'); fail('ACK_INVALID_OUTCOME_UNKNOWN'); }
      append('ACK', { operationId, result: item });
      if (['CREATE_NETWORK', 'CREATE_VOLUME', 'CREATE_CONTAINER'].includes(pending.action)) owned.set(item.resource.name, item.resource);
      if (pending.action === 'CLEANUP_RESOURCE') owned.delete(item.resource.name);
      pending = null;
    },
    stop(code) { writable(); if (pending) { markUnknown('LOST_ACK'); return; } append('STOPPED', { code: safeCode(code) }); state = 'STOPPED'; },
    unknown(operationId, code = 'LOST_ACK') { writable(); if (!pending || pending.operationId !== operationId) fail('OPERATION_MISMATCH'); markUnknown(code); },
    seal() { writable(); if (pending) fail('OPERATION_PENDING'); append('SEALED', { code: 'COMPLETE' }); state = 'SEALED'; return previous; },
    snapshot() { return Object.freeze({ state, pendingOperationId: pending?.operationId ?? null, recordCount: records.length, chainSha256: previous, identitySha256: digest(canonical(identity)), durability: adapter.durability, readOnly: !create }); },
    close() { if (!closed) { adapter.close(); closed = true; } },
  });
}
