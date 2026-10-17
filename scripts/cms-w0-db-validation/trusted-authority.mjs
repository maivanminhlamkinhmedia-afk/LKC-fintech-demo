import { createHash } from 'node:crypto';

/**
 * Offline, non-authorizing verifier candidate. NOT an approval issuer or runtime permit.
 * No configured trusted GitHub transport, operator identity/approval authority, service
 * attestor, trusted clock or atomic single-use store exists in this reviewed baseline.
 * Consequently even consistent evidence is UNVERIFIED and execution is always denied.
 * No injectable verifier, public key, environment variable or JSON assertion can alter
 * that boundary. Integrating real authenticated evidence requires a separate review.
 *
 * These pins identify PR70's frozen inputs, NOT a future executing bridge commit.
 * Workflow source commit, application commit, checkout and GitHub synthetic merge SHA
 * must never be conflated. This candidate accepts no synthetic merge as source proof.
 * Image digests remain inherited candidates, not registry/platform attestations.
 */
const REPOSITORY = 'maivanminhlamkinhmedia-afk/LKC-fintech-demo';
const CANDIDATE = '3097500b23a63922e839d49e411438a66c90ea16';
const APPLICATION = '5321f28673eeee11ed8f913c78c7cdcb38896f9e';
const WORKFLOW = '.github/workflows/cms-w0-mariadb-validation.yml';
const WORKFLOW_BLOB = '497c0ab37e7c5e5c4c174d6008b7ff3eb9e4b881';
const WORKFLOW_SHA256 = '61d2a74114f4a0bd20792ac69d3d6d973da551bbd833d2e0bf1fa92d41753088';
const HEAD_BRANCH = 'test/cms-w0-mariadb-validation';
const BASE_BRANCH = 'feature/cms-access-001a-draft-writer-foundation';
const NODE_IMAGE = 'sha256:c4d5523090a817b7aa86d2111241fdd4f66d1e27782b44160e6aa63b357ecb2d';
const DB_IMAGE = 'sha256:3a7d3cbc8b6fddf66433d80dc124c1e4e75a73ebab9c6e137529cc270bdadfc0';
const BLOCKERS = Object.freeze([
  'AUTHENTICATED_GITHUB_RUN_EVIDENCE_MISSING',
  'TRUSTED_OPERATOR_APPROVAL_MISSING',
  'TRUSTED_SERVICE_ATTESTATION_MISSING',
  'IMAGE_PLATFORM_ATTESTATION_MISSING',
  'TRUSTED_CLOCK_MISSING',
  'ATOMIC_SINGLE_USE_AUTHORITY_MISSING',
  'HARNESS_INTEGRATION_NOT_AUTHORIZED',
]);

function requireThat(condition) { if (!condition) throw new Error('REFUSED'); }
function keys(value, names) {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value));
  requireThat(Object.getPrototypeOf(value) === Object.prototype);
  requireThat(Object.keys(value).sort().join('|') === [...names].sort().join('|'));
}
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}
function boundedTree(value, depth = 0) {
  requireThat(depth <= 5);
  if (value !== null && typeof value === 'object') {
    requireThat(Object.keys(value).length <= 32);
    for (const v of Object.values(value)) boundedTree(v, depth + 1);
  }
}
const id = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
const hex64 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && !/^0+$/.test(value);
const epoch = value => Number.isSafeInteger(value) && value > 0;
const empty = value => Array.isArray(value) && value.length === 0;
const hash = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');
function result(code, claimsConsistent = false) {
  return Object.freeze({ code, claimsConsistent, authenticated: false,
    executionAuthorized: false, blockers: BLOCKERS });
}

/**
 * Input is a bounded canonical JSON STRING of UNTRUSTED claims. Objects/callbacks
 * are not traversed (including hostile getters/proxies). Canonical encoding rejects
 * duplicate keys and alternative encodings. Output never echoes caller data/errors.
 * A structural match is NOT GitHub, reviewer, environment or service authentication.
 */
export function inspectAuthorityClaims(serialized) {
  let code = 'EVIDENCE_FORMAT_REFUSED';
  try {
    requireThat(typeof serialized === 'string' && serialized.length <= 65536);
    const data = JSON.parse(serialized);
    boundedTree(data);
    requireThat(canonical(data) === serialized);
    keys(data, ['identity', 'run', 'approval', 'service', 'replay']);

    code = 'SOURCE_IDENTITY_REFUSED';
    const i = data.identity;
    keys(i, ['repository', 'candidateSha', 'applicationSha', 'workflowCommit', 'workflowPath', 'workflowBlob', 'workflowPayloadSha256', 'workflowPayloadBase64']);
    requireThat(i.repository === REPOSITORY && i.candidateSha === CANDIDATE
      && i.applicationSha === APPLICATION && i.workflowCommit === CANDIDATE
      && i.workflowPath === WORKFLOW && i.workflowBlob === WORKFLOW_BLOB
      && i.workflowPayloadSha256 === WORKFLOW_SHA256);
    code = 'WORKFLOW_BYTES_REFUSED';
    requireThat(typeof i.workflowPayloadBase64 === 'string' && i.workflowPayloadBase64.length <= 32768);
    const bytes = Buffer.from(i.workflowPayloadBase64, 'base64');
    requireThat(bytes.toString('base64') === i.workflowPayloadBase64);
    requireThat(hash('sha256', bytes) === WORKFLOW_SHA256);
    requireThat(hash('sha1', Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])) === WORKFLOW_BLOB);
    // Exact Git payload bytes required: do not silently normalize CRLF or call raw
    // working-copy SHA-256 a Git blob/payload hash. No filesystem reads occur here.

    code = 'RUN_IDENTITY_REFUSED';
    const r = data.run;
    keys(r, ['id', 'jobId', 'attempt', 'event', 'action', 'pr', 'headRepository', 'baseRepository', 'headBranch', 'baseBranch', 'headSha', 'baseSha', 'checkoutSha', 'workflowRef', 'label', 'createdAt']);
    requireThat(id(r.id) && id(r.jobId) && r.attempt === 1 && r.event === 'pull_request'
      && r.action === 'labeled' && r.pr === 70 && r.headRepository === REPOSITORY
      && r.baseRepository === REPOSITORY && r.headBranch === HEAD_BRANCH && r.baseBranch === BASE_BRANCH
      && r.headSha === CANDIDATE && r.baseSha === APPLICATION && r.checkoutSha === CANDIDATE
      && r.workflowRef === `${REPOSITORY}/${WORKFLOW}@${CANDIDATE}`
      && r.label === `w0-db-${CANDIDATE}` && epoch(r.createdAt));

    code = 'APPROVAL_CLAIM_REFUSED';
    const a = data.approval;
    keys(a, ['id', 'operatorId', 'reviewerId', 'environmentId', 'protected', 'approved', 'runId', 'attempt', 'candidateSha', 'workflowBlob', 'issuedAt', 'expiresAt']);
    requireThat(id(a.id) && id(a.operatorId) && id(a.reviewerId) && a.operatorId !== a.reviewerId
      && id(a.environmentId) && a.protected === true && a.approved === true && a.runId === r.id
      && a.attempt === r.attempt && a.candidateSha === CANDIDATE && a.workflowBlob === WORKFLOW_BLOB
      && epoch(a.issuedAt) && epoch(a.expiresAt) && a.issuedAt <= r.createdAt && r.createdAt < a.expiresAt);
    // These booleans/IDs/timestamps are necessary CLAIM shape only. They cannot
    // establish protection, independent operator permission or current freshness.

    code = 'SERVICE_CLAIM_REFUSED';
    const s = data.service;
    keys(s, ['runId', 'jobId', 'attempt', 'serviceId', 'jobContainerId', 'networkId', 'host', 'port', 'platform', 'nodeImage', 'mariadbImage', 'publishedPorts', 'mounts', 'disposable', 'syntheticOnly']);
    requireThat(s.runId === r.id && s.jobId === r.jobId && s.attempt === 1
      && hex64(s.serviceId) && hex64(s.jobContainerId) && hex64(s.networkId)
      && new Set([s.serviceId, s.jobContainerId, s.networkId]).size === 3
      && s.host === 'mariadb' && s.port === 3306 && s.platform === 'linux/amd64'
      && s.nodeImage === NODE_IMAGE && s.mariadbImage === DB_IMAGE
      && empty(s.publishedPorts) && empty(s.mounts) && s.disposable === true && s.syntheticOnly === true);

    code = 'REPLAY_CLAIM_REFUSED';
    const p = data.replay;
    keys(p, ['requestId', 'runId', 'attempt', 'approvalId', 'state']);
    requireThat(hex64(p.requestId) && p.runId === r.id && p.attempt === 1
      && p.approvalId === a.id && p.state === 'UNCONSUMED');
    // No caller ledger or process-local Set can prove global single use. Do not
    // consume/retry here. Duplicate and lost-ACK requests stay denied identically.
    return result('CLAIMS_CONSISTENT_BUT_UNTRUSTED', true);
  } catch { return result(code); }
}

/**
 * Public gate. There is deliberately no positive authorization branch, trusted
 * adapter injection, env switch, permit issuance or import of run.mjs.
 * Missing trust cannot be repaired by caller signatures, REAL_DRIVER labels,
 * approval JSON, matching digests, environment names or valid-looking run IDs.
 * Signed evidence verification cannot be claimed until an independently approved
 * trust anchor, issuer/audience policy and authenticated collection exist.
 */
export function verifyTrustedAuthority(serialized) {
  const inspected = inspectAuthorityClaims(serialized);
  return Object.freeze({ ...inspected, status: 'TECHNICAL_AUTHORITY_BLOCKED' });
}
