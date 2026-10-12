import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createMemoryLedgerAdapter, createFileLedgerAdapter, openEvidenceLedger, inspectEvidenceLedger } from '../scripts/cms-release-s1-local/evidence-ledger.mjs';

const SHA = '1'.repeat(64);
const RUN = '1234567890abcdef123456';
const SOURCE = '17ffb61232de69f1be41ab61f44dc6246328b22c';
const identity = Object.freeze({ runId: RUN, sourceSha: SOURCE, inputSha256: SHA, daemonSha256: SHA, resourcePlanSha256: SHA, seccompSha256: SHA });
const operation = (operationId = 'op-0001') => ({ operationId, action: 'MIGRATE', inputSha256: SHA });
const result = () => ({ code: 'OK', evidenceSha256: SHA });
const resource = (kind = 'container', suffix = 'node', includeId = false) => ({ kind, name: `cms-s1-local-${RUN}-${suffix}`, ...(includeId ? { id: 'a'.repeat(64) } : {}) });
const createOperation = () => ({ operationId: 'op-0001', action: 'CREATE_CONTAINER', inputSha256: SHA, resource: resource() });
function fresh() { const adapter = createMemoryLedgerAdapter(); return { adapter, ledger: openEvidenceLedger({ adapter, identity }) }; }
function readonly(bytes, expected = identity) { return openEvidenceLedger({ adapter: { ...createMemoryLedgerAdapter(), read: () => bytes }, identity: expected, create: false }); }
function canonical(value) { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`; }
function rehash(records) { let prior = '0'.repeat(64); return Buffer.from(records.map((record, seq) => { const { hash: omitted, ...rest } = record; void omitted; const payload = { ...rest, seq, previousHash: prior }; prior = createHash('sha256').update(canonical(payload)).digest('hex'); return canonical({ ...payload, hash: prior }); }).join('\n') + '\n'); }
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-s1-ledger-test-'));
  t.after(() => {
    const resolved = path.resolve(root); const allowed = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(resolved.startsWith(allowed) && path.basename(resolved).startsWith('cms-s1-ledger-test-'));
    fs.rmSync(resolved, { recursive: true, force: false });
  });
  return root;
}

// These tests execute only pure adapters and owned temporary ledger files, never SQL/Docker.
test('local evidence: durable INTENT flush precedes ACK and completed chain verifies', () => {
  const memory = createMemoryLedgerAdapter(); const calls = [];
  const adapter = { ...memory, append(bytes) { calls.push(JSON.parse(bytes.toString()).kind); memory.append(bytes); }, flush() { calls.push('FLUSH'); memory.flush(); } };
  const ledger = openEvidenceLedger({ adapter, identity });
  ledger.intent(operation()); assert.deepEqual(calls, ['OPEN', 'FLUSH', 'INTENT', 'FLUSH']);
  ledger.ack('op-0001', result()); ledger.seal();
  assert.deepEqual(calls, ['OPEN', 'FLUSH', 'INTENT', 'FLUSH', 'ACK', 'FLUSH', 'SEALED', 'FLUSH']);
  assert.equal(inspectEvidenceLedger(memory.read(), identity).state, 'SEALED');
  assert.equal(ledger.snapshot().durability, 'MEMORY_ONLY');
});

test('local evidence: known stopped precondition differs from unknown mutation outcome', () => {
  const known = fresh(); known.ledger.stop('PRECONDITION_FAILED'); assert.equal(known.ledger.snapshot().state, 'STOPPED');
  const unknown = fresh(); unknown.ledger.intent(operation()); unknown.ledger.stop('KNOWN_FAILURE');
  assert.equal(unknown.ledger.snapshot().state, 'UNKNOWN_OUTCOME');
  assert.equal(inspectEvidenceLedger(unknown.adapter.read(), identity).state, 'UNKNOWN_OUTCOME');
});

test('local evidence: lost ACK prevents new intent, cleanup, ACK and sealing', () => {
  const { ledger } = fresh(); ledger.intent(operation()); ledger.unknown('op-0001');
  assert.throws(() => ledger.intent(operation('op-0002')), /LEDGER_NOT_ACTIVE/);
  assert.throws(() => ledger.ack('op-0001', result()), /LEDGER_NOT_ACTIVE/);
  assert.throws(() => ledger.seal(), /LEDGER_NOT_ACTIVE/);
  assert.equal(ledger.snapshot().pendingOperationId, 'op-0001');
});

test('local evidence: crash with pending intent reopens UNKNOWN_OUTCOME and read-only', () => {
  const { ledger, adapter } = fresh(); ledger.intent(operation()); const bytes = adapter.read(); ledger.close();
  const recovered = readonly(bytes); assert.equal(recovered.snapshot().state, 'UNKNOWN_OUTCOME');
  assert.equal(recovered.snapshot().readOnly, true); assert.throws(() => recovered.ack('op-0001', result()), /LEDGER_NOT_ACTIVE/);
});

test('local evidence: even complete unsealed prior history cannot be resumed automatically', () => {
  const { ledger, adapter } = fresh(); ledger.intent(operation()); ledger.ack('op-0001', result());
  const recovered = readonly(adapter.read()); assert.equal(recovered.snapshot().state, 'ACTIVE'); assert.equal(recovered.snapshot().readOnly, true);
  assert.throws(() => recovered.intent(operation('op-0002')), /LEDGER_NOT_ACTIVE/);
});

test('local evidence: duplicate operation and duplicate resource creation are rejected', () => {
  const { ledger } = fresh(); ledger.intent(createOperation()); ledger.ack('op-0001', { ...result(), resource: resource('container', 'node', true) });
  assert.throws(() => ledger.intent(createOperation()), /OPERATION_DUPLICATE/);
  assert.throws(() => ledger.intent({ ...createOperation(), operationId: 'op-0002' }), /RESOURCE_ALREADY_SEEN/);
});

test('local evidence: cleanup requires a matching create ACK ownership identity', () => {
  const { ledger } = fresh();
  const cleanup = { operationId: 'op-0002', action: 'CLEANUP_RESOURCE', inputSha256: SHA, resource: resource('container', 'node', true) };
  assert.throws(() => ledger.intent(cleanup), /RESOURCE_NOT_OWNED/);
  ledger.intent(createOperation()); ledger.ack('op-0001', { ...result(), resource: resource('container', 'node', true) });
  assert.throws(() => ledger.intent({ ...cleanup, resource: { ...cleanup.resource, id: 'b'.repeat(64) } }), /RESOURCE_NOT_OWNED/);
  ledger.intent(cleanup); ledger.ack('op-0002', { ...result(), resource: cleanup.resource });
  assert.throws(() => ledger.intent({ ...cleanup, operationId: 'op-0003' }), /RESOURCE_NOT_OWNED/);
});

test('local evidence: partial cleanup with lost ACK prevents deleting the next resource', () => {
  const { ledger } = fresh(); ledger.intent(createOperation()); ledger.ack('op-0001', { ...result(), resource: resource('container', 'node', true) });
  ledger.intent({ operationId: 'op-0002', action: 'CLEANUP_RESOURCE', inputSha256: SHA, resource: resource('container', 'node', true) });
  ledger.unknown('op-0002', 'PROCESS_INTERRUPTED'); assert.throws(() => ledger.intent(operation('op-0003')), /LEDGER_NOT_ACTIVE/);
});

test('local evidence: wrong ACK identity is contained as UNKNOWN_OUTCOME', () => {
  const { ledger, adapter } = fresh(); ledger.intent(createOperation());
  assert.throws(() => ledger.ack('op-0001', { ...result(), resource: resource('container', 'db', true) }), /ACK_INVALID_OUTCOME_UNKNOWN/);
  assert.equal(ledger.snapshot().state, 'UNKNOWN_OUTCOME'); assert.equal(inspectEvidenceLedger(adapter.read(), identity).state, 'UNKNOWN_OUTCOME');
});

test('local evidence: ACK without intent and mismatched operation fail closed', () => {
  const { ledger } = fresh(); assert.throws(() => ledger.ack('op-0001', result()), /OPERATION_MISSING/);
  ledger.intent(operation()); assert.throws(() => ledger.ack('op-0002', result()), /ACK_INVALID_OUTCOME_UNKNOWN/);
  assert.equal(ledger.snapshot().state, 'UNKNOWN_OUTCOME');
});

for (const [name, replacement] of [
  ['wrong source SHA', { sourceSha: 'a'.repeat(40) }], ['stale run identity', { runId: 'f'.repeat(22) }],
  ['wrong artifact hash', { inputSha256: 'b'.repeat(64) }], ['wrong daemon', { daemonSha256: 'b'.repeat(64) }],
  ['wrong seccomp', { seccompSha256: 'b'.repeat(64) }], ['wrong resource plan', { resourcePlanSha256: 'b'.repeat(64) }],
]) test(`local evidence: ${name} cannot reinterpret existing evidence`, () => {
  const { adapter } = fresh(); assert.throws(() => readonly(adapter.read(), { ...identity, ...replacement }), /LEDGER_CORRUPT|IDENTITY_INVALID/);
});

for (const name of ['missing', 'reordered', 'duplicated', 'corrupted', 'truncated', 'invalid UTF-8', 'rehashed ACK without intent', 'rehashed extra secret field']) {
  test(`local evidence: ${name} chain is rejected`, () => {
    const { ledger, adapter } = fresh(); ledger.intent(operation()); ledger.ack('op-0001', result()); ledger.seal();
    const records = adapter.read().toString().trimEnd().split('\n').map(JSON.parse); let bytes;
    if (name === 'missing') bytes = Buffer.from(records.filter((_, n) => n !== 1).map(canonical).join('\n') + '\n');
    if (name === 'reordered') bytes = Buffer.from([records[0], records[2], records[1], records[3]].map(canonical).join('\n') + '\n');
    if (name === 'duplicated') bytes = Buffer.from([...records.slice(0, 2), records[1], ...records.slice(2)].map(canonical).join('\n') + '\n');
    if (name === 'corrupted') bytes = Buffer.from(adapter.read().toString().replace('"OK"', '"NO"'));
    if (name === 'truncated') bytes = adapter.read().subarray(0, -2);
    if (name === 'invalid UTF-8') { bytes = adapter.read(); bytes[1] = 255; }
    if (name === 'rehashed ACK without intent') bytes = rehash([records[0], records[2], records[3]]);
    if (name === 'rehashed extra secret field') { records[1].password = 'credential-canary-not-for-output'; bytes = rehash(records); }
    assert.throws(() => inspectEvidenceLedger(bytes, identity), /LEDGER_CORRUPT/);
  });
}

test('local evidence: synthetic secret-bearing result is never emitted or persisted', () => {
  const { ledger, adapter } = fresh(); ledger.intent(operation());
  assert.throws(() => ledger.ack('op-0001', { ...result(), password: 'credential-canary-not-for-output', stdout: 'mysql://user:password@remote/db' }), error => error.message === 'ACK_INVALID_OUTCOME_UNKNOWN');
  const bytes = adapter.read().toString(); assert.ok(!bytes.includes('credential-canary') && !bytes.includes('mysql://') && !bytes.includes('password'));
});

test('local evidence: accessors and throwing proxies produce only safe codes', () => {
  let getters = 0; const hostile = Object.defineProperty({}, 'operationId', { enumerable: true, get() { getters++; throw new Error('credential-canary-not-for-output'); } });
  const { ledger } = fresh(); assert.throws(() => ledger.intent(hostile), error => error.message === 'EVIDENCE_INVALID'); assert.equal(getters, 0);
  assert.throws(() => ledger.intent(new Proxy({}, { ownKeys() { throw new Error('credential-canary-not-for-output'); } })), error => error.message === 'EVIDENCE_INVALID');
  assert.throws(() => openEvidenceLedger(Object.defineProperty({}, 'identity', { get() { getters++; } })), /EVIDENCE_INVALID/); assert.equal(getters, 0);
  assert.throws(() => openEvidenceLedger({ adapter: createMemoryLedgerAdapter(), identity: { ...identity, runId: { toString() { throw new Error('secret'); } } } }), error => error.message === 'IDENTITY_INVALID');
});

test('local evidence: unknown fields, oversized IDs, raw process and unknown status rejected', () => {
  const { ledger } = fresh();
  for (const value of [{ ...operation(), rawError: 'secret' }, { ...operation(), operationId: 'x'.repeat(20000) }, { ...operation(), action: 'DROP_DATABASE' }, { ...operation(), inputSha256: '../secret' }, { ...operation(), resource: undefined }]) assert.throws(() => ledger.intent(value), /EVIDENCE_INVALID|OPERATION_INVALID/);
  assert.throws(() => ledger.stop('raw server credential'), /EVIDENCE_INVALID/);
});

test('local evidence: adapter flush failure freezes state without mutation retry', () => {
  const memory = createMemoryLedgerAdapter(); let count = 0;
  const ledger = openEvidenceLedger({ adapter: { ...memory, flush() { if (++count === 2) throw new Error('credential-canary-not-for-output'); } }, identity });
  assert.throws(() => ledger.intent(operation()), error => error.message === 'LEDGER_DURABILITY_FAILED');
  assert.equal(ledger.snapshot().state, 'UNKNOWN_OUTCOME'); assert.throws(() => ledger.intent(operation()), /LEDGER_NOT_ACTIVE/); assert.equal(count, 2);
  assert.equal(readonly(memory.read()).snapshot().state, 'UNKNOWN_OUTCOME');
});

test('local evidence: adapter append partial-write failure produces an unrecoverable chain', () => {
  const memory = createMemoryLedgerAdapter(); let count = 0;
  const ledger = openEvidenceLedger({ adapter: { ...memory, append(bytes) { if (++count === 2) { memory.append(bytes.subarray(0, 10)); throw new Error('secret'); } memory.append(bytes); } }, identity });
  assert.throws(() => ledger.intent(operation()), /LEDGER_DURABILITY_FAILED/); assert.equal(ledger.snapshot().state, 'UNKNOWN_OUTCOME');
  assert.throws(() => readonly(memory.read()), /LEDGER_CORRUPT/); assert.equal(count, 2);
});

test('local evidence: file adapter persists exact chain and refuses existing run directory', t => {
  const root = temporary(t); const options = { root, directoryName: `cms-s1-local-${RUN}` };
  const adapter = createFileLedgerAdapter(options); assert.deepEqual(fs.readdirSync(root), []);
  const ledger = openEvidenceLedger({ adapter, identity }); ledger.intent(operation()); ledger.ack('op-0001', result()); ledger.seal(); const summary = ledger.snapshot(); ledger.close();
  const bytes = fs.readFileSync(path.join(root, options.directoryName, 'journal.jsonl')); assert.equal(inspectEvidenceLedger(bytes, identity).chainSha256, summary.chainSha256);
  assert.throws(() => openEvidenceLedger({ adapter: createFileLedgerAdapter(options), identity }), /LEDGER_CREATE_FAILED/);
  assert.equal(readonly(bytes).snapshot().state, 'SEALED');
  assert.equal(summary.durability, process.platform === 'win32' ? 'FILE_FSYNC_ONLY_DIRECTORY_NOT_VERIFIED' : 'FILE_AND_DIRECTORY_FSYNC');
});

test('local evidence: file adapter rejects traversal, absolute or malformed directory names', t => {
  const root = temporary(t);
  for (const directoryName of ['../victim', path.resolve(root, 'other'), 'cms-s1-local-abc', `cms-s1-local-${RUN}/x`, `cms-s1-local-${RUN}\\x`]) assert.throws(() => createFileLedgerAdapter({ root, directoryName }), /LEDGER_PATH_UNSAFE/);
  assert.throws(() => createFileLedgerAdapter({ root: 'relative', directoryName: `cms-s1-local-${RUN}` }), /LEDGER_PATH_UNSAFE/);
});

test('local evidence: directory symlink or Windows junction cannot become evidence root', t => {
  const root = temporary(t); const actual = path.join(root, 'actual'); const link = path.join(root, 'link'); fs.mkdirSync(actual);
  fs.symlinkSync(actual, link, process.platform === 'win32' ? 'junction' : 'dir');
  const adapter = createFileLedgerAdapter({ root: link, directoryName: `cms-s1-local-${RUN}` });
  assert.throws(() => openEvidenceLedger({ adapter, identity }), /LEDGER_CREATE_FAILED/); assert.deepEqual(fs.readdirSync(actual), []);
});

test('local evidence: hardlinked journal is refused before further append and readonly inspection', t => {
  const root = temporary(t); const options = { root, directoryName: `cms-s1-local-${RUN}` };
  const adapter = createFileLedgerAdapter(options); const ledger = openEvidenceLedger({ adapter, identity });
  const filename = path.join(root, options.directoryName, 'journal.jsonl'); fs.linkSync(filename, path.join(root, 'unapproved-hardlink'));
  assert.throws(() => ledger.intent(operation()), /LEDGER_DURABILITY_FAILED/); assert.equal(ledger.snapshot().state, 'UNKNOWN_OUTCOME'); ledger.close();
  assert.throws(() => openEvidenceLedger({ adapter: createFileLedgerAdapter(options), identity, create: false }), /LEDGER_READ_FAILED/);
});

test('local evidence: on-disk pending intent has no implicit recovery or cleanup', t => {
  const root = temporary(t); const options = { root, directoryName: `cms-s1-local-${RUN}` };
  const first = openEvidenceLedger({ adapter: createFileLedgerAdapter(options), identity }); first.intent(operation()); first.close();
  const second = openEvidenceLedger({ adapter: createFileLedgerAdapter(options), identity, create: false });
  assert.equal(second.snapshot().state, 'UNKNOWN_OUTCOME'); assert.throws(() => second.intent(operation('op-0002')), /LEDGER_NOT_ACTIVE/); second.close();
});

test('local evidence: hash chain has no timestamps or raw process data and is deterministic', () => {
  const one = fresh(); const two = fresh();
  for (const { ledger } of [one, two]) { ledger.intent(operation()); ledger.ack('op-0001', result()); ledger.seal(); }
  assert.deepEqual(one.adapter.read(), two.adapter.read()); assert.ok(!one.adapter.read().toString().includes('timestamp'));
});

test('local evidence: create action kind and resource identity must agree', () => {
  const { ledger } = fresh();
  assert.throws(() => ledger.intent({ ...createOperation(), action: 'CREATE_NETWORK' }), /RESOURCE_INVALID/);
  assert.throws(() => ledger.intent({ ...createOperation(), resource: resource('container', 'node', true) }), /RESOURCE_ALREADY_SEEN/);
});

test('local evidence: transformed CRLF journal bytes are rejected rather than normalized', () => {
  const { adapter } = fresh(); const changed = Buffer.from(adapter.read().toString().replaceAll('\n', '\r\n'));
  assert.throws(() => inspectEvidenceLedger(changed, identity), /LEDGER_CORRUPT/);
});
