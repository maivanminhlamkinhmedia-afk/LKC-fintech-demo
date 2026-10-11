// Disk-backed synthetic journal. File fsync is exercised; host/power-loss durability is NOT proven.
import * as fs from 'node:fs';
import path from 'node:path';
import { dataRecord, isDigest, isId, sha256 } from './archive-integrity.mjs';

const ZERO = '0'.repeat(64);
const sandboxMarker = '{"purpose":"LKC_RELEASE002_OFFLINE_ONLY","version":1}';
const fail = () => { throw new Error('RECOVERY_REQUIRED'); };
const transitions = Object.freeze({ LOCKED: ['PREPARING', 'RECOVERY_REQUIRED'], PREPARING: ['PREPARED', 'RECOVERY_REQUIRED'],
  PREPARED: ['ACTIVATING', 'RECOVERY_REQUIRED'], ACTIVATING: ['COMMITTED', 'UNKNOWN_OUTCOME'],
  COMMITTED: ['ACKNOWLEDGED', 'UNKNOWN_OUTCOME'], ACKNOWLEDGED: [], UNKNOWN_OUTCOME: [], RECOVERY_REQUIRED: [] });
const contextKeys = ['targetId', 'operationId', 'ownerId', 'fence', 'planDigest', 'releaseId', 'priorId', 'priorReceipt', 'candidateReceipt'];

export function assertRealDirectory(directory) {
  let at = path.resolve(directory);
  while (true) {
    const s = fs.lstatSync(at);
    if (!s.isDirectory() || s.isSymbolicLink()) fail();
    const parent = path.dirname(at);
    if (at === parent) break;
    at = parent;
  }
}

export function readRegular(file, limit = 1024 * 1024) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > limit) fail();
  return fs.readFileSync(file);
}

export function syncDirectory(directory) {
  let fd;
  try { fd = fs.openSync(directory, 'r'); fs.fsyncSync(fd); return 'SYSCALL_COMPLETED_NOT_POWER_LOSS_PROOF'; }
  catch (error) {
    if (['EPERM', 'EISDIR', 'EINVAL', 'ENOTSUP', 'EACCES'].includes(error.code)) return 'DIRECTORY_FSYNC_NOT_VERIFIED';
    throw error;
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function writeNew(file, bytes) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

export function createMockSandbox(root) {
  if (!path.isAbsolute(root) || path.resolve(root) !== root || !/^lkc-release002-mock-[a-z0-9-]+$/.test(path.basename(root))) fail();
  assertRealDirectory(path.dirname(root));
  fs.mkdirSync(root, { mode: 0o700 }); // exclusive: never adopt an existing target
  writeNew(path.join(root, '.offline-only.json'), sandboxMarker);
  return Object.freeze({ root, mode: 'OFFLINE_SYNTHETIC', directorySync: syncDirectory(root) });
}

export function assertMockSandbox(root) {
  if (!path.isAbsolute(root) || !/^lkc-release002-mock-[a-z0-9-]+$/.test(path.basename(root))) fail();
  assertRealDirectory(root);
  if (readRegular(path.join(root, '.offline-only.json'), 128).toString() !== sandboxMarker) fail();
}

export function assertMockTarget(root) {
  assertMockSandbox(path.dirname(root));
  assertRealDirectory(root);
  const raw = readRegular(path.join(root, '.mock-target.json'), 256).toString();
  const id = path.basename(root);
  if (!isId(id) || raw !== JSON.stringify({ purpose: 'RELEASE002_FAKE_TARGET', targetId: id })) fail();
  return id;
}

export function initializeJournal(root) {
  assertMockTarget(root);
  writeNew(path.join(root, 'journal.ndjson'), '');
  writeNew(path.join(root, 'journal-head.json'), JSON.stringify({ seq: 0, hash: ZERO }));
  return syncDirectory(root);
}

function context(value) {
  const c = dataRecord(value, contextKeys);
  if (![c.targetId, c.operationId, c.ownerId, c.releaseId, c.priorId].every(isId)
    || !Number.isSafeInteger(c.fence) || c.fence < 1
    || ![c.planDigest, c.priorReceipt, c.candidateReceipt].every(isDigest)) fail();
  return c;
}

function checkTransition(rows, next) {
  const prev = rows.at(-1);
  if (!prev || prev.state === 'ACKNOWLEDGED') {
    if (next.state !== 'LOCKED' || next.fence !== next.seq || rows.some((r) => r.operationId === next.operationId)) fail();
  } else {
    if (!transitions[prev.state]?.includes(next.state)
      || contextKeys.some((k) => prev[k] !== next[k])) fail();
  }
}

export function readJournal(root) {
  try {
    const targetId = assertMockTarget(root);
    if (fs.existsSync(path.join(root, 'journal-head.next'))) fail();
    const bytes = readRegular(path.join(root, 'journal.ndjson'));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text && !text.endsWith('\n')) fail();
    const lines = text ? text.slice(0, -1).split('\n') : [];
    if (lines.length > 2048) fail();
    const rows = [];
    for (const line of lines) {
      const parsed = JSON.parse(line);
      const r = dataRecord(parsed, ['version', 'seq', 'previousHash', ...contextKeys, 'state', 'hash']);
      const c = context(Object.fromEntries(contextKeys.map((k) => [k, r[k]])));
      const body = { version: 1, seq: rows.length + 1, previousHash: rows.at(-1)?.hash ?? ZERO, ...c, state: r.state };
      const expected = { ...body, hash: sha256(JSON.stringify(body)) };
      if (r.targetId !== targetId || !Object.hasOwn(transitions, r.state) || JSON.stringify(expected) !== line) fail();
      checkTransition(rows, expected);
      rows.push(expected);
    }
    const head = readRegular(path.join(root, 'journal-head.json'), 256).toString();
    if (head !== JSON.stringify({ seq: rows.length, hash: rows.at(-1)?.hash ?? ZERO })) fail();
    return { ok: true, rows };
  } catch { return { ok: false, state: 'RECOVERY_REQUIRED', code: 'JOURNAL_CORRUPT_OR_INCOMPLETE' }; }
}

export function appendJournal(root, binding, state) {
  const read = readJournal(root);
  if (!read.ok) fail();
  const c = context(binding);
  if (c.targetId !== assertMockTarget(root) || !Object.hasOwn(transitions, state)) fail();
  assertRealDirectory(path.join(root, 'activation.lock'));
  const owner = JSON.parse(readRegular(path.join(root, 'activation.lock', 'owner.json'), 1024).toString());
  if (['targetId', 'operationId', 'ownerId', 'fence'].some((key) => owner[key] !== c[key])) fail();
  const body = { version: 1, seq: read.rows.length + 1, previousHash: read.rows.at(-1)?.hash ?? ZERO, ...c, state };
  checkTransition(read.rows, body);
  const record = { ...body, hash: sha256(JSON.stringify(body)) };
  // Caller must hold the exclusive target lock. No automatic repair of a torn tail/head.
  const fd = fs.openSync(path.join(root, 'journal.ndjson'), 'a');
  try { fs.writeFileSync(fd, JSON.stringify(record) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  writeNew(path.join(root, 'journal-head.next'), JSON.stringify({ seq: record.seq, hash: record.hash }));
  fs.renameSync(path.join(root, 'journal-head.next'), path.join(root, 'journal-head.json'));
  syncDirectory(root);
  return record;
}
