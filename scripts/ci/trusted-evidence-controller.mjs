import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {verifyTrustedPrEvidence} from './trusted-pr-evidence.mjs';
import {EvidenceInputError, requireEvidence, parseJsonBytes, JSON_LIMITS} from './trusted-evidence-json.mjs';
import {openGitHubEvidenceAdapter, readBootstrap} from './github-evidence-adapter.mjs';
import {verifyPolicyRelease, POLICY_LIMITS} from './trusted-policy-release.mjs';

// Trusted CODE constructs this factory. Its only returned input is raw request
// bytes: PR number/head/base. No PR-supplied adapter, token, root or policy.
// There is no CLI, socket, scheduler, real transport or GitHub write capability.
// The result never authorizes publication, a merge or reuse as a freshness lease.
const positive = (n) => Number.isSafeInteger(n) && n > 0;
const sha = (s) => typeof s === 'string' && /^[a-f0-9]{40}$/.test(s);
const digest = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
// Process-local exclusion also covers separately constructed controllers. A
// future multi-process scheduler must supply its own separately reviewed lease.
const activeEvaluations = new Set();
function report() {
  return {schemaVersion: 1, mode: 'ADVISORY', status: 'NOT_VERIFIED', authorization: 'NONE',
    enforcement: 'NOT_AUTHORIZED', execution: 'OFFLINE_SYNTHETIC', reasons: [], apiRecords: null,
    consistency: 'EVENT_SCOPED_RECHECKED_READS_NOT_ATOMIC', observation: null,
    evidence: {
      apiRecordBindings: {level: 'UNVERIFIED', basis: 'SYNTHETIC_RESPONSES_ONLY'},
      liveAuthentication: {level: 'UNVERIFIED'}, policyRegisterDurability: {level: 'UNVERIFIED'},
      controllerReleaseIntegrity: {level: 'UNVERIFIED'},
      workflowDefinition: {level: 'UNVERIFIED'}, actualCheckout: {level: 'UNVERIFIED'},
      headAuthorIndependence: {level: 'UNVERIFIED'}, lastPusherIndependence: {level: 'UNVERIFIED'},
      futureLiveIntegration: {level: 'PROPOSED'}, productionEnforcement: {level: 'OUTSIDE_SCOPE'},
    }, previousCi: {provenance: 'Integrator-observed', reusedAsEvidence: false}};
}

export function createReadOnlyEvidenceController({executionMode, bootstrapJson, broker, transport,
  policyBytes, envelopeBytes, publicKeys, readRegister, artifactDigests, minimumEpoch,
  now = Date.now, monotonicNow = () => performance.now()} = {}) {
  // Own all mutable bootstrap bytes/pins. Providers themselves are trusted code
  // capabilities; offline fixtures do not authenticate a future deployment.
  // minimumEpoch is an independent protected bootstrap pin supplied by trusted
  // code, not discovered from a provider or request. Snapshot it at construction.
  let config, configurationError = false;
  try {
    requireEvidence(executionMode === 'OFFLINE_SYNTHETIC' && positive(minimumEpoch) && publicKeys instanceof Map &&
      artifactDigests && typeof artifactDigests.verifierSha256 === 'string' && typeof artifactDigests.adapterSha256 === 'string' &&
      typeof now === 'function' && typeof monotonicNow === 'function', 'CONTROLLER_CONFIG_INVALID');
    for (const bytes of [bootstrapJson, policyBytes, envelopeBytes]) requireEvidence(bytes instanceof Uint8Array, 'CONTROLLER_CONFIG_INVALID');
    config = {bootstrapJson: Buffer.from(bootstrapJson), policyBytes: Buffer.from(policyBytes), envelopeBytes: Buffer.from(envelopeBytes),
      publicKeys: new Map(publicKeys), artifactDigests: Object.freeze({...artifactDigests}), minimumEpoch};
    readBootstrap(config.bootstrapJson);
  } catch { configurationError = true; }
  let busy = false; // One evaluation per controller; no shared mutable report/cache.
  return async function evaluate(requestBytes) {
    const result = report();
    if (configurationError) { result.reasons = ['CONTROLLER_CONFIG_INVALID']; return result; }
    if (busy) { result.reasons = ['EVALUATION_BUSY']; return result; }
    busy = true;
    const abort = new AbortController(); let timer, previousTick, start, acquiredKey;
    function tick() {
      const value = monotonicNow();
      requireEvidence(Number.isFinite(value) && (previousTick === undefined || value >= previousTick), 'CLOCK_INVALID');
      previousTick = value;
      requireEvidence(!abort.signal.aborted && (start === undefined || value - start < POLICY_LIMITS.evaluationTimeoutMs), 'EVALUATION_DEADLINE');
      return value;
    }
    try {
      start = tick();
      const q = parseJsonBytes(requestBytes, {maxBytes: JSON_LIMITS.document});
      requireEvidence(q && Object.keys(q).sort().join(',') === 'baseSha,headSha,prNumber' && positive(q.prNumber) &&
        sha(q.headSha) && sha(q.baseSha), 'REQUEST_INVALID');
      const bootstrap = readBootstrap(config.bootstrapJson);
      const key = `${bootstrap.repository.id}:${q.prNumber}`;
      requireEvidence(!activeEvaluations.has(key), 'EVALUATION_BUSY');
      activeEvaluations.add(key); acquiredKey = key;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { abort.abort(); reject(new EvidenceInputError('EVALUATION_DEADLINE')); }, POLICY_LIMITS.evaluationTimeoutMs);
      });
      await Promise.race([(async () => {
        const release = await verifyPolicyRelease({...config, readRegister, signal: abort.signal,
          expected: {...config.artifactDigests, repository: bootstrap.repository, minimumEpoch: config.minimumEpoch}});
        tick();
        const port = await openGitHubEvidenceAdapter({executionMode, bootstrapJson: config.bootstrapJson, broker, transport, now, signal: abort.signal});
        const readGitHub = async (call) => { tick(); const text = await port.readGitHub(call); tick(); return text; };
        const p = release.libraryPolicy, prefix = `/repos/${p.repository.fullName}`;
        async function discover() {
          let total; const runs = [], ids = new Set(), numbers = new Set();
          for (let page = 1; page <= 10; page++) {
            const path = `${prefix}/actions/workflows/${p.workflow.id}/runs?head_sha=${q.headSha}&event=pull_request&per_page=100&page=${page}`;
            const list = parseJsonBytes(Buffer.from(await readGitHub({method: 'GET', path, signal: abort.signal})));
            requireEvidence(list && positive(list.total_count) && list.total_count < 1000 && Array.isArray(list.workflow_runs) &&
              (total === undefined || total === list.total_count), 'DISCOVERY_INCOMPLETE');
            total = list.total_count;
            requireEvidence(list.workflow_runs.length === Math.min(100, total - runs.length), 'DISCOVERY_INCOMPLETE');
            for (const run of list.workflow_runs) {
              requireEvidence(run && positive(run.id) && positive(run.run_attempt) && positive(run.run_number) &&
                !ids.has(run.id) && !numbers.has(run.run_number) && run.event === 'pull_request' &&
                run.workflow_id === p.workflow.id && run.head_sha === q.headSha, 'DISCOVERY_INVALID');
              ids.add(run.id); numbers.add(run.run_number); runs.push(run);
            }
            if (runs.length === total) break;
          }
          requireEvidence(runs.length === total, 'DISCOVERY_INCOMPLETE');
          // Same ordering as frozen verifier: per-workflow run_number, not ID or
          // success timestamp. Core validates ALL statuses/identities/dates/pages.
          runs.sort((a, b) => a.run_number - b.run_number);
          return {latest: runs.at(-1), fingerprint: digest(runs)};
        }
        const initial = await discover();
        const core = await verifyTrustedPrEvidence({policyJson: JSON.stringify(p),
          requestJson: JSON.stringify({...q, runId: initial.latest.id, attempt: initial.latest.run_attempt}), readGitHub});
        tick();
        requireEvidence(core.status === 'VERIFIED' && core.ci?.event === 'pull_request', 'API_RECORDS_NOT_VERIFIED');
        const final = await discover();
        requireEvidence(initial.fingerprint === final.fingerprint, 'DISCOVERY_CHANGED');
        await readGitHub({method: 'GET', path: prefix, signal: abort.signal});
        await release.recheck();
        const end = tick();
        result.apiRecords = core;
        // Core validation of synthetic records is not operationally proven API evidence.
        // Retain the report's UNVERIFIED level and explicit synthetic provenance.
        result.observation = {durationMs: end - start, purpose: 'PR_SOURCE_EVIDENCE', event: 'pull_request'};
        // The accepted API subset does not close live/auth/attestation gates.
        result.reasons = ['INTEGRATION_TRUST_UNVERIFIED'];
      })(), timeout]);
    } catch (error) {
      // No partial VERIFIED subtree survives any final consistency failure.
      result.apiRecords = null; result.evidence.apiRecordBindings.level = 'UNVERIFIED'; result.observation = null;
      result.reasons = [error instanceof EvidenceInputError ? error.code : 'EVALUATION_UNAVAILABLE'];
    } finally { clearTimeout(timer); abort.abort(); if (acquiredKey) activeEvaluations.delete(acquiredKey); busy = false; }
    return result;
  };
}
