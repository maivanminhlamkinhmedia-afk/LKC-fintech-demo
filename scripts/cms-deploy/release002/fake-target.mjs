// A disk-backed fake target, never an SSH/server deployment client. No import-time I/O.
import * as fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isId, LIMITS, normalizeApproval, sha256, verifyArchive } from './archive-integrity.mjs';
import { classifyRecovery, readActivationPlan } from './activation-plan.mjs';
import { appendJournal, assertMockSandbox, assertMockTarget, assertRealDirectory, initializeJournal, readJournal, readRegular, syncDirectory } from './release-journal.mjs';

export const FAULTS = Object.freeze(['beforePrepare', 'midPrepare', 'afterPrepared', 'afterIntent', 'afterPrevious', 'afterCurrent', 'afterCommit']);
const result = (state, code, ok = false) => ({ ok, state, code, mode: 'OFFLINE_SYNTHETIC', authorization: 'NONE', liveDeployment: false, retryAllowed: false });
const fail = () => { throw new Error('MOCK_INVARIANT'); };
const exists = (p) => { try { fs.lstatSync(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };

function lockIdentity(directory) {
  assertRealDirectory(directory);
  const s = fs.lstatSync(directory, { bigint: true });
  if (!s.isDirectory() || s.isSymbolicLink() || s.ino <= 0n) fail();
  return [s.dev, s.ino, s.birthtimeNs].join(':');
}

function requireReadyJournal(root) {
  const read = readJournal(root);
  if (!read.ok || read.rows.length && read.rows.at(-1).state !== 'ACKNOWLEDGED') fail();
  return read;
}

// Only the newly acquired, still empty directory can be removed on failure. Never unlink
// owner evidence, recurse, or adopt an existing lock. Identity checks assume cooperative
// mock processes; pathname checks do not prove safety against a hostile same-UID replacer.
function cleanupUnpublishedLock(root, lock, acquiredIdentity) {
  let step = 'VERIFY_IDENTITY', removed = false;
  try {
    assertMockTarget(root);
    if (!acquiredIdentity || lockIdentity(lock) !== acquiredIdentity) {
      return { status: 'RETAINED', code: 'LOCK_IDENTITY_NOT_VERIFIED' };
    }
    step = 'VERIFY_EMPTY';
    if (fs.readdirSync(lock).length) return { status: 'RETAINED', code: 'LOCK_NOT_EMPTY' };
    if (lockIdentity(lock) !== acquiredIdentity) return { status: 'RETAINED', code: 'LOCK_IDENTITY_NOT_VERIFIED' };
    step = 'REMOVE_EMPTY_DIRECTORY';
    fs.rmdirSync(lock); // non-recursive; a newly present owner/file makes this fail closed
    removed = true;
    step = 'SYNC_PARENT';
    return { status: 'REMOVED', code: 'EMPTY_INVOCATION_LOCK_REMOVED', directorySync: syncDirectory(root) };
  } catch (error) {
    const systemCode = ['EACCES', 'EPERM', 'ENOTEMPTY', 'ENOENT', 'EBUSY', 'EIO', 'ENOTDIR'].includes(error.code) ? error.code : 'UNCLASSIFIED';
    return { status: 'FAILED', code: 'PREOWNERSHIP_CLEANUP_FAILED', step, removed, systemCode };
  }
}

function writeNew(file, bytes) {
  assertRealDirectory(path.dirname(file));
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function writeRelease(directory, artifact, interrupt = () => {}) {
  assertRealDirectory(path.dirname(directory));
  fs.mkdirSync(directory, { mode: 0o700 });
  const payload = path.join(directory, 'files');
  fs.mkdirSync(payload, { mode: 0o700 });
  for (const [index, entry] of artifact.entries.entries()) {
    const file = path.join(payload, ...entry.path.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeNew(file, entry.bytes);
    syncDirectory(path.dirname(file));
    if (index === 0) interrupt();
  }
  writeNew(path.join(directory, 'receipt.json'), JSON.stringify(artifact.identity));
  syncDirectory(payload);
  syncDirectory(directory);
  syncDirectory(path.dirname(directory));
}

function verifyRelease(directory, expectedReceipt) {
  if (!exists(directory)) return null;
  assertRealDirectory(directory);
  if (fs.readdirSync(directory).sort().join(',') !== 'files,receipt.json') fail();
  const receipt = readRegular(path.join(directory, 'receipt.json'), 64 * 1024);
  if (sha256(receipt) !== expectedReceipt) fail();
  const identity = normalizeApproval(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(receipt)));
  if (JSON.stringify(identity) !== receipt.toString()) fail();
  const found = [], allowedDirs = new Set(['']);
  for (const f of identity.files) {
    const parts = f.path.split('/');
    for (let i = 1; i < parts.length; i++) allowedDirs.add(parts.slice(0, i).join('/'));
  }
  function walk(dir, prefix) {
    assertRealDirectory(dir);
    if (!allowedDirs.has(prefix)) fail();
    for (const name of fs.readdirSync(dir)) {
      const absolute = path.join(dir, name), relative = prefix ? prefix + '/' + name : name;
      const s = fs.lstatSync(absolute);
      if (s.isSymbolicLink()) fail();
      if (s.isDirectory()) walk(absolute, relative);
      else {
        const f = identity.files.find((f) => f.path === relative);
        if (!f || s.size !== f.size || sha256(readRegular(absolute, LIMITS.file)) !== f.sha256) fail();
        found.push(relative);
      }
    }
  }
  walk(path.join(directory, 'files'), '');
  if (found.length !== identity.files.length) fail();
  return identity.releaseId;
}

function handle(root) {
  const targetId = assertMockTarget(root);
  const current = path.join(root, 'current'), previous = path.join(root, 'previous'), prepared = path.join(root, 'prepared');
  const lock = path.join(root, 'activation.lock');
  function binding(plan) {
    if (assertMockTarget(root) !== targetId) fail();
    const p = readActivationPlan(plan);
    if (p.targetId !== targetId) fail();
    return p;
  }
  function uploadFile(p) { assertRealDirectory(path.join(root, 'uploads')); return path.join(root, 'uploads', p.operationId + '.tar.gz'); }

  function inspectLock(p) {
    try {
      if (!exists(lock)) return { state: 'ABSENT' };
      assertRealDirectory(lock);
      const names = fs.readdirSync(lock);
      if (!names.length) return { state: 'EMPTY_OWNERLESS' };
      if (!names.includes('owner.json')) return { state: 'NONEMPTY_OWNERLESS' };
      if (names.length !== 1) return { state: 'INVALID_OWNER_RECORD' };
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(readRegular(path.join(lock, 'owner.json'), 1024));
      const o = JSON.parse(raw);
      if (!o || ![o.targetId, o.operationId, o.ownerId].every(isId) || !Number.isSafeInteger(o.fence) || o.fence < 1
        || typeof o.nonce !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(o.nonce)
        || raw !== JSON.stringify({ targetId: o.targetId, operationId: o.operationId, ownerId: o.ownerId, fence: o.fence, nonce: o.nonce })) fail();
      return { state: o.targetId === targetId && o.operationId === p.operationId && o.ownerId === p.ownerId ? 'OWNED_OPERATION' : 'OWNED_OTHER_OPERATION',
        operationId: o.operationId, ownerId: o.ownerId, fence: o.fence };
    } catch { return { state: 'INVALID_OR_UNREADABLE_LOCK' }; }
  }

  return Object.freeze({
    root, mode: 'OFFLINE_SYNTHETIC',
    upload(plan, bytes) {
      try {
        const p = binding(plan);
        if (!Buffer.isBuffer(bytes) || bytes.length > LIMITS.compressed || bytes.length === 0) fail();
        writeNew(uploadFile(p), Buffer.from(bytes));
        syncDirectory(path.join(root, 'uploads'));
        return result('UPLOADED_NOT_ACTIVATED', 'SYNTHETIC_UPLOAD', true);
      } catch { return result('REJECTED', 'UPLOAD_REJECTED'); }
    },
    async activate(plan, { fault = null, onPhase = async () => {} } = {}) {
      let p, ownerBytes, journalBinding, acquiredIdentity, createdLock = false, ownershipPublished = false, activationPossible = false;
      let failurePhase = 'INPUT';
      try {
        if (fault !== null && !FAULTS.includes(fault)) return result('REJECTED', 'INVALID_FAULT');
        p = binding(plan);
        const artifact = verifyArchive(readRegular(uploadFile(p), LIMITS.compressed), p.artifact);
        if (!artifact.ok) return result('REJECTED', artifact.code);
        // Existing locks are evidence, including empty ownerless locks; never clear them.
        if (exists(lock)) return result('BLOCKED', 'LOCK_HELD');
        failurePhase = 'JOURNAL_PRECHECK';
        requireReadyJournal(root);
        // First and subsequent activators share the same mkdir lock, not a process-local flag.
        try { fs.mkdirSync(lock, { mode: 0o700 }); }
        catch (error) { if (error.code === 'EEXIST') return result('BLOCKED', 'LOCK_HELD'); throw error; }
        createdLock = true;
        failurePhase = 'PREOWNERSHIP';
        acquiredIdentity = lockIdentity(lock);
        await onPhase('beforeOwnerPublication'); // synthetic pre-ownership failure/race probe
        if (lockIdentity(lock) !== acquiredIdentity || fs.readdirSync(lock).length) fail();
        failurePhase = 'LOCKED_JOURNAL_CHECK';
        const read = requireReadyJournal(root); // authoritative check under the acquired lock
        const fence = read.rows.length + 1;
        ownerBytes = JSON.stringify({ targetId, operationId: p.operationId, ownerId: p.ownerId, fence, nonce: randomUUID() });
        failurePhase = 'OWNER_PUBLICATION';
        writeNew(path.join(lock, 'owner.json'), ownerBytes);
        ownershipPublished = true; // even a subsequent sync/validation failure retains this lock
        syncDirectory(lock); syncDirectory(root);
        failurePhase = 'OWNED_OPERATION';
        const assertOwner = () => {
          binding(plan); assertRealDirectory(lock);
          if (readRegular(path.join(lock, 'owner.json'), 1024).toString() !== ownerBytes) fail();
        };
        const checkpoint = async (name) => { await onPhase(name); assertOwner(); if (fault === name) fail(); };
        assertOwner();
        if (verifyRelease(current, p.expectedCurrent.receiptSha256) !== p.expectedCurrent.releaseId
          || exists(previous) || exists(prepared)) fail();
        journalBinding = { targetId, operationId: p.operationId, ownerId: p.ownerId, fence, planDigest: plan.digest,
          releaseId: p.artifact.releaseId, priorId: p.expectedCurrent.releaseId,
          priorReceipt: p.expectedCurrent.receiptSha256, candidateReceipt: artifact.receiptSha256 };
        appendJournal(root, journalBinding, 'LOCKED');
        await checkpoint('beforePrepare');
        appendJournal(root, journalBinding, 'PREPARING');
        writeRelease(prepared, artifact, () => { if (fault === 'midPrepare') fail(); });
        if (verifyRelease(prepared, artifact.receiptSha256) !== p.artifact.releaseId) fail();
        appendJournal(root, journalBinding, 'PREPARED');
        await checkpoint('afterPrepared');
        // Revalidate both complete trees after a possible pause, before any switch.
        if (verifyRelease(current, p.expectedCurrent.receiptSha256) !== p.expectedCurrent.releaseId
          || verifyRelease(prepared, artifact.receiptSha256) !== p.artifact.releaseId || exists(previous)) fail();
        appendJournal(root, journalBinding, 'ACTIVATING');
        activationPossible = true;
        await checkpoint('afterIntent');
        fs.renameSync(current, previous); syncDirectory(root);
        await checkpoint('afterPrevious');
        fs.renameSync(prepared, current); syncDirectory(root);
        await checkpoint('afterCurrent');
        if (verifyRelease(current, artifact.receiptSha256) !== p.artifact.releaseId
          || verifyRelease(previous, p.expectedCurrent.receiptSha256) !== p.expectedCurrent.releaseId) fail();
        appendJournal(root, journalBinding, 'COMMITTED');
        await checkpoint('afterCommit'); // lost ACK must not return success or replay activation
        if (verifyRelease(current, artifact.receiptSha256) !== p.artifact.releaseId
          || verifyRelease(previous, p.expectedCurrent.receiptSha256) !== p.expectedCurrent.releaseId) fail();
        appendJournal(root, journalBinding, 'ACKNOWLEDGED');
        assertOwner();
        fs.unlinkSync(path.join(lock, 'owner.json')); fs.rmdirSync(lock); syncDirectory(root);
        return result('ACTIVATED_SYNTHETIC', 'ACKNOWLEDGED', true);
      } catch {
        const state = activationPossible ? 'UNKNOWN_OUTCOME' : 'RECOVERY_REQUIRED';
        const cleanup = createdLock && !ownershipPublished && !activationPossible
          ? cleanupUnpublishedLock(root, lock, acquiredIdentity)
          : { status: 'NOT_ATTEMPTED', code: ownershipPublished ? 'OWNERSHIP_PUBLISHED' : 'NO_INVOCATION_LOCK' };
        // Best effort only. A torn journal must stay torn for inspection, never silently repaired.
        try {
          if (journalBinding && readRegular(path.join(lock, 'owner.json'), 1024).toString() === ownerBytes) appendJournal(root, journalBinding, state);
        } catch { /* unresolved journal/owner retained; no mutation retry */ }
        const cleanupUnresolved = cleanup.status === 'FAILED' || cleanup.status === 'RETAINED';
        return { ...result(state, activationPossible ? 'ACTIVATION_RESPONSE_UNCERTAIN'
          : cleanupUnresolved ? 'PREOWNERSHIP_CLEANUP_UNRESOLVED' : 'PREPARATION_OR_STATE_UNCERTAIN'), failurePhase, cleanup };
      }
    },
    inspectRecovery(plan) {
      let lockEvidence = { state: 'NOT_INSPECTED' };
      try {
        const p = binding(plan);
        lockEvidence = inspectLock(p);
        const read = readJournal(root);
        if (!read.ok) return { ...classifyRecovery({ journalValid: false }), lockEvidence };
        if (!['ABSENT', 'OWNED_OPERATION'].includes(lockEvidence.state)) {
          return { ...result('RECOVERY_REQUIRED', 'LOCK_REQUIRES_INSPECTION'), lockEvidence };
        }
        const rows = read.rows.filter((r) => r.operationId === p.operationId);
        const digest = sha256(JSON.stringify(p.artifact));
        if (!rows.length || rows.some((r) => r.planDigest !== plan.digest || r.priorReceipt !== p.expectedCurrent.receiptSha256 || r.candidateReceipt !== digest)) fail();
        if (lockEvidence.state === 'OWNED_OPERATION' && lockEvidence.fence !== rows.at(-1).fence) fail();
        if (exists(prepared) && rows.some((r) => r.state === 'PREPARED')
          && verifyRelease(prepared, digest) !== p.artifact.releaseId) fail();
        let actualCurrent;
        try { actualCurrent = verifyRelease(current, digest); }
        catch { actualCurrent = verifyRelease(current, p.expectedCurrent.receiptSha256); }
        const actualPrevious = verifyRelease(previous, p.expectedCurrent.receiptSha256);
        return { ...classifyRecovery({ journalValid: true, phase: rows.at(-1).state, committed: rows.some((r) => r.state === 'COMMITTED'),
          current: actualCurrent, previous: actualPrevious, candidateId: p.artifact.releaseId, priorId: p.expectedCurrent.releaseId }), lockEvidence };
      } catch { return { ...result('RECOVERY_REQUIRED', 'TARGET_OR_EVIDENCE_INCONSISTENT'), lockEvidence }; }
    },
  });
}

export function createFakeTarget(sandboxRoot, targetId, initialBytes, initialApproval) {
  assertMockSandbox(sandboxRoot);
  if (!isId(targetId)) fail();
  const artifact = verifyArchive(initialBytes, initialApproval);
  if (!artifact.ok) fail();
  const root = path.join(sandboxRoot, targetId);
  fs.mkdirSync(root, { mode: 0o700 });
  writeNew(path.join(root, '.mock-target.json'), JSON.stringify({ purpose: 'RELEASE002_FAKE_TARGET', targetId }));
  fs.mkdirSync(path.join(root, 'uploads'), { mode: 0o700 });
  writeRelease(path.join(root, 'current'), artifact);
  initializeJournal(root);
  return handle(root);
}

export function openFakeTarget(sandboxRoot, targetId) {
  assertMockSandbox(sandboxRoot);
  if (!isId(targetId)) fail();
  return handle(path.join(sandboxRoot, targetId));
}
