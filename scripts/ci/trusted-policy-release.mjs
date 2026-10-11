import {createHash, verify, KeyObject} from 'node:crypto';
import {EvidenceInputError, requireEvidence, parseJsonBytes, validateJsonBytes, JSON_LIMITS} from './trusted-evidence-json.mjs';

export const POLICY_DOMAIN = 'LKC-G1C-POLICY/v1\0';
export const POLICY_LIMITS = Object.freeze({responseBytes: 1048576, documentBytes: 16384, jsonDepth: 64,
  requestTimeoutMs: 5000, evaluationTimeoutMs: 60000});
const hex = (v, size) => typeof v === 'string' && new RegExp(`^[a-f0-9]{${size}}$`).test(v);
const positive = (v) => Number.isSafeInteger(v) && v > 0;
const natural = (v) => Number.isSafeInteger(v) && v >= 0;
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const keyId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(v);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

// Trusted caller supplies immutable expected repository/material pins, an
// independently protected expected.minimumEpoch and a readRegister capability.
// The minimum epoch must be pinned in protected bootstrap/release authority,
// never sourced from the register, signed payload, API response or PR request.
// The register's rollbackFloor adds constraints; it cannot lower that pin.
// Offline fixtures cannot prove bootstrap authenticity or cross-process durability.
// registerVersion is the atomic register revision; revision binds the policy
// release. Both are compared unchanged across initial/final observations.
export async function verifyPolicyRelease({policyBytes, envelopeBytes, publicKeys, readRegister, expected, signal} = {}) {
  try {
    const limits = {maxBytes: JSON_LIMITS.document};
    requireEvidence(policyBytes instanceof Uint8Array, 'JSON_BYTES_REQUIRED');
    const raw = Buffer.from(policyBytes);
    const text = validateJsonBytes(raw, limits);
    const envelope = parseJsonBytes(envelopeBytes, limits);
    requireEvidence(record(envelope) && Object.keys(envelope).sort().join(',') === 'algorithm,digest,keyId,schemaVersion,signature' &&
      envelope.schemaVersion === 1 && envelope.algorithm === 'Ed25519' && keyId(envelope.keyId) &&
      hex(envelope.digest, 64) && typeof envelope.signature === 'string', 'POLICY_ENVELOPE_INVALID');
    requireEvidence(publicKeys instanceof Map && publicKeys.has(envelope.keyId), 'POLICY_KEY_UNTRUSTED');
    const key = publicKeys.get(envelope.keyId);
    requireEvidence(key instanceof KeyObject && key.type === 'public' && key.asymmetricKeyType === 'ed25519', 'POLICY_KEY_INVALID');
    const digest = createHash('sha256').update(raw).digest('hex');
    requireEvidence(digest === envelope.digest, 'POLICY_DIGEST_MISMATCH');
    const signature = Buffer.from(envelope.signature, 'base64');
    requireEvidence(signature.length === 64 && signature.toString('base64') === envelope.signature &&
      verify(null, Buffer.concat([Buffer.from(POLICY_DOMAIN, 'utf8'), raw]), key, signature), 'POLICY_SIGNATURE_INVALID');
    // Signature and whole-input duplicate validation precede deserialization.
    const p = JSON.parse(text);
    requireEvidence(record(p) && Object.keys(p).sort().join(',') === 'allowForks,artifacts,epoch,event,limits,purpose,repository,reviewerIds,revision,schemaVersion,workflow' &&
      p.schemaVersion === 1 && hex(p.revision, 40) && positive(p.epoch) &&
      p.purpose === 'PR_SOURCE_EVIDENCE' && p.event === 'pull_request' && p.allowForks === false, 'POLICY_SCHEMA_INVALID');
    requireEvidence(record(expected) && record(expected.repository) && positive(expected.repository.id) &&
      typeof expected.repository.fullName === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(expected.repository.fullName) &&
      !['.', '..'].includes(expected.repository.fullName.split('/')[1]) &&
      record(p.repository) && Object.keys(p.repository).sort().join(',') === 'fullName,id' &&
      p.repository.id === expected.repository.id && p.repository.fullName === expected.repository.fullName, 'POLICY_REPOSITORY_MISMATCH');
    const minimumEpoch = expected.minimumEpoch;
    requireEvidence(positive(minimumEpoch) && p.epoch >= minimumEpoch, 'POLICY_ROLLBACK_FLOOR');
    requireEvidence(record(p.artifacts) && Object.keys(p.artifacts).sort().join(',') === 'adapterSha256,verifierSha256' &&
      hex(expected.verifierSha256, 64) && hex(expected.adapterSha256, 64) &&
      p.artifacts.verifierSha256 === expected.verifierSha256 && p.artifacts.adapterSha256 === expected.adapterSha256, 'POLICY_MATERIAL_MISMATCH');
    requireEvidence(record(p.limits) && Object.keys(p.limits).length === Object.keys(POLICY_LIMITS).length &&
      Object.entries(POLICY_LIMITS).every(([k, v]) => p.limits[k] === v), 'POLICY_LIMIT_MISMATCH');
    requireEvidence(Array.isArray(p.reviewerIds) && p.reviewerIds.length > 0 && p.reviewerIds.length <= 20 &&
      p.reviewerIds.every(positive) && new Set(p.reviewerIds).size === p.reviewerIds.length &&
      record(p.workflow) && Object.keys(p.workflow).sort().join(',') === 'id,path,requiredJobs' && positive(p.workflow.id) &&
      typeof p.workflow.path === 'string' && /^\.github\/workflows\/[A-Za-z0-9_-]+\.ya?ml$/.test(p.workflow.path) &&
      Array.isArray(p.workflow.requiredJobs) && p.workflow.requiredJobs.length > 0 && p.workflow.requiredJobs.length <= 20 &&
      p.workflow.requiredJobs.every((j) => typeof j === 'string' && j.length > 0 && j.length <= 200 && !/[\x00-\x1f\x7f]/.test(j)) &&
      new Set(p.workflow.requiredJobs).size === p.workflow.requiredJobs.length, 'POLICY_RULES_INVALID');
    requireEvidence(typeof readRegister === 'function', 'POLICY_REGISTER_MISSING');
    async function observe() {
      requireEvidence(!signal?.aborted, 'POLICY_REGISTER_UNAVAILABLE');
      let timer, onAbort;
      const controller = new AbortController();
      const readSignal = AbortSignal.any([controller.signal, signal].filter(Boolean));
      try {
        const denied = new Promise((_, reject) => {
          onAbort = () => reject(new EvidenceInputError('POLICY_REGISTER_UNAVAILABLE'));
          readSignal.addEventListener('abort', onAbort, {once: true});
          timer = setTimeout(() => controller.abort(), POLICY_LIMITS.requestTimeoutMs);
        });
        const bytes = await Promise.race([Promise.resolve().then(() => readRegister(Object.freeze({signal: readSignal}))), denied]);
        const r = parseJsonBytes(bytes, limits);
        requireEvidence(record(r) && Object.keys(r).sort().join(',') === 'digest,epoch,registerVersion,repository,revision,revocation,rollbackFloor,schemaVersion' &&
          r.schemaVersion === 1 && positive(r.registerVersion) && r.revision === p.revision && r.epoch === p.epoch &&
          r.digest === digest && record(r.repository) && r.repository.id === p.repository.id &&
          r.repository.fullName === p.repository.fullName, 'POLICY_REGISTER_MISMATCH');
        const rev = r.revocation, floor = r.rollbackFloor;
        requireEvidence(record(rev) && Object.keys(rev).sort().join(',') === 'generation,revokedDigests,revokedKeyIds' &&
          natural(rev.generation) && Array.isArray(rev.revokedKeyIds) && rev.revokedKeyIds.length <= 100 &&
          rev.revokedKeyIds.every(keyId) && new Set(rev.revokedKeyIds).size === rev.revokedKeyIds.length &&
          Array.isArray(rev.revokedDigests) && rev.revokedDigests.length <= 100 && rev.revokedDigests.every((d) => hex(d, 64)) &&
          new Set(rev.revokedDigests).size === rev.revokedDigests.length, 'POLICY_REVOCATION_INVALID');
        requireEvidence(!rev.revokedKeyIds.includes(envelope.keyId) && !rev.revokedDigests.includes(digest), 'POLICY_REVOKED');
        requireEvidence(record(floor) && Object.keys(floor).sort().join(',') === 'epoch,registerVersion,revocationGeneration' &&
          positive(floor.epoch) && positive(floor.registerVersion) && natural(floor.revocationGeneration) &&
          p.epoch >= floor.epoch && r.registerVersion >= floor.registerVersion && rev.generation >= floor.revocationGeneration,
        'POLICY_ROLLBACK_FLOOR');
        // Copy/sort only known fields; even a changed floor is an inconsistent observation.
        return freeze({revision: r.revision, epoch: r.epoch, digest: r.digest, registerVersion: r.registerVersion,
          repository: {id: r.repository.id, fullName: r.repository.fullName},
          revocation: {generation: rev.generation, revokedKeyIds: [...rev.revokedKeyIds].sort(), revokedDigests: [...rev.revokedDigests].sort()},
          rollbackFloor: {epoch: floor.epoch, registerVersion: floor.registerVersion, revocationGeneration: floor.revocationGeneration}});
      } catch (error) {
        if (error instanceof EvidenceInputError) throw error;
        throw new EvidenceInputError('POLICY_REGISTER_UNAVAILABLE');
      } finally { clearTimeout(timer); readSignal.removeEventListener('abort', onAbort); }
    }
    const initial = await observe();
    return Object.freeze({
      libraryPolicy: freeze({repository: p.repository, reviewerIds: p.reviewerIds, workflow: p.workflow, allowForks: false}),
      controllerPolicy: freeze({purpose: p.purpose, event: p.event, limits: p.limits, revision: p.revision, epoch: p.epoch, digest}),
      recheck: async () => { requireEvidence(equal(initial, await observe()), 'POLICY_REGISTER_CHANGED'); return true; },
    });
  } catch (error) {
    if (error instanceof EvidenceInputError) throw error;
    throw new EvidenceInputError('POLICY_INVALID');
  }
}
