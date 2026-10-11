// Offline approval/policy checks. No host discovery, credentials, SSH or CLI entrypoint.
import { dataRecord, isDigest, isId, normalizeApproval, sha256 } from './archive-integrity.mjs';

const plans = new WeakMap();
const denied = (code) => ({ ok: false, code });

export function checkHostKeyPolicy(value) {
  try {
    const p = dataRecord(value, ['host', 'fingerprint', 'source', 'verifiedBy']);
    if (typeof p.host !== 'string' || !/^[a-z0-9-]+\.invalid$/.test(p.host)
      || typeof p.fingerprint !== 'string' || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(p.fingerprint)
      || p.source !== 'INDEPENDENT_OPERATOR_PIN' || !isId(p.verifiedBy)) return denied('HOST_KEY_NOT_VERIFIED');
    return { ok: true, policy: p, evidence: 'SYNTHETIC_POLICY_ONLY', liveHostVerified: false };
  } catch { return denied('HOST_KEY_NOT_VERIFIED'); }
}

export function createActivationPlan(value) {
  try {
    const p = dataRecord(value, ['targetId', 'operationId', 'ownerId', 'artifact', 'expectedCurrent', 'sshUser', 'uploadPath', 'activationArchivePath', 'hostKey']);
    if (![p.targetId, p.operationId, p.ownerId].every(isId)) return denied('INVALID_PLAN');
    const artifact = normalizeApproval(p.artifact);
    const current = dataRecord(p.expectedCurrent, ['releaseId', 'receiptSha256']);
    if (!isId(current.releaseId) || !isDigest(current.receiptSha256) || current.releaseId === artifact.releaseId) return denied('STALE_RELEASE');
    if (typeof p.sshUser !== 'string' || !/^mock-[a-z0-9-]+$/.test(p.sshUser)) return denied('TARGET_ACCOUNT_MISMATCH');
    const expectedPath = '/home/' + p.sshUser + '/releases/' + artifact.releaseId + '/archive.tar.gz';
    if (p.uploadPath !== expectedPath || p.activationArchivePath !== expectedPath) return denied('UPLOAD_TARGET_MISMATCH');
    const key = checkHostKeyPolicy(p.hostKey);
    if (!key.ok) return key;
    const body = { targetId: p.targetId, operationId: p.operationId, ownerId: p.ownerId, artifact,
      expectedCurrent: current, sshUser: p.sshUser, uploadPath: expectedPath, hostKey: key.policy };
    const plan = Object.freeze({ mode: 'OFFLINE_SYNTHETIC', authorization: 'NONE', digest: sha256(JSON.stringify(body)) });
    plans.set(plan, JSON.stringify(body));
    return { ok: true, plan };
  } catch { return denied('INVALID_PLAN'); }
}

export function readActivationPlan(plan) {
  if (!plans.has(plan)) throw new Error('UNTRUSTED_PLAN');
  return JSON.parse(plans.get(plan)); // fresh copy; callers cannot alter the pinned plan
}

// Read-only classification. No lock release, retry, bundle switch or DB action is authorized.
export function classifyRecovery({ journalValid, phase, committed, current, previous, candidateId, priorId }) {
  const base = { mode: 'OFFLINE_SYNTHETIC', authorization: 'NONE', retryAllowed: false };
  if (!journalValid) return { ...base, state: 'RECOVERY_REQUIRED', code: 'JOURNAL_NOT_AUTHORITATIVE' };
  if (committed && current === candidateId && previous === priorId) return { ...base, state: 'ACTIVATED_OBSERVED', code: 'SYNTHETIC_TARGET_RECONCILED' };
  if (['LOCKED', 'PREPARING', 'PREPARED', 'RECOVERY_REQUIRED'].includes(phase)
    && current === priorId && previous === null) return { ...base, state: 'NOT_ACTIVATED_OBSERVED', code: 'RETAINED_CURRENT_VERIFIED' };
  return { ...base, state: 'RECOVERY_REQUIRED', code: 'ACTIVATION_NOT_ESTABLISHED' };
}
