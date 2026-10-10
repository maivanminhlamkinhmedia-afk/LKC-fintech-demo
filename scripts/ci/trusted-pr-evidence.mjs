/**
 * G1c-01: read-only GitHub evidence verifier, Node 22, library only.
 *
 * TRUST ROOT (not established by this library): a protected caller supplies
 * policyJson and readGitHub. The latter accepts {method: 'GET', path, signal}
 * and returns bounded JSON text obtained directly from api.github.com, or
 * throws on non-2xx. It must authenticate the origin, disallow redirects to
 * other origins, use read-only access, and not serve PR artifacts/body/cache
 * as API responses. Never construct this capability or policy from PR code.
 * There is deliberately no authenticated:true flag, token, network client,
 * event/environment loader, checkout, shell, file write or automatic approval.
 *
 * Protected policy shape:
 * {repository:{id,fullName}, reviewerIds:[GitHub numeric user IDs],
 *  workflow:{id,path,requiredJobs:[exact job names]}, allowForks:false}
 * Untrusted request JSON only selects {prNumber,headSha,baseSha,runId,attempt}.
 * The API, not the request or PR body, must corroborate every selector.
 * An injected fixture adapter exercises logic, NOT authenticated production
 * evidence. Even VERIFIED means matching GitHub records conditional on that
 * trust root; it grants no release authority and does not prove test quality.
 *
 * Scope: one open PR, the latest applicable run/attempt (which must succeed),
 * and approved allowlisted humans other than the PR author at the exact head.
 * PR author, latest commit author and most recent pusher are distinct actors;
 * independence from the latter two is NOT verified here. Any outstanding change
 * request by an allowlisted reviewer denies approval. Complete paginated
 * reviews/jobs are required. Review IDs cannot be counted twice. A comment or
 * PO relay of Claude PASS does not establish an authenticated Claude identity.
 * Provisioning independent reviewer IDs/attestors is a separate PO decision.
 *
 * Freshness: list the policy workflow with head_sha + event, without a status
 * filter. Every returned run is a candidate; context mismatches fail closed,
 * not silently excluded (including ambiguous other-PR/fork associations).
 * Order by GitHub run_number for that workflow, NOT run ID, array position,
 * request timestamps or completion time. GitHub documents that run_number
 * increases for each new workflow run and is unchanged by re-runs:
 * https://docs.github.com/en/actions/reference/workflows-and-actions/variables
 * Require unique IDs/numbers and nondecreasing API created_at in that order;
 * equal timestamps are resolved by the documented unique workflow sequence.
 * Complete, count-consistent pages and a second full list read are mandatory.
 * Reject >=1,000 results: filtered REST lists have a 1,000-result ceiling, so
 * completeness at that ceiling cannot be established. No range subdivision.
 * https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow
 *
 * PR runs bind API head_sha (SOURCE) and associated PR base/head. Current
 * prospective merge parents are checked separately through the Git API; they
 * do NOT attest what a runner checked out. Dispatch binds the source, not a
 * tested merge/base. Logs/PR artifacts cannot supply trusted checkout evidence.
 * Workflow definition approval, actual checkout, fork-code isolation and job
 * semantics need a separately reviewed trusted integration/attestation layer.
 * Fork opt-in is not an API compatibility guarantee: unavailable/empty or
 * mismatching head_repository/PR associations remain NOT_VERIFIED. Fixtures
 * do not establish real fork response shapes. Merge binding stays fail-closed.
 * API reads are rechecked for observed drift, not an atomic GitHub snapshot.
 * Revalidate before any later decision; never reuse this report as a capability.
 */

const SHA = /^[a-f0-9]{40}$/;
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_REVIEW_PAGES = 10;
const MAX_JOBS = 200;
const RUN_LIST_CEILING = 1000;
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const id = (v) => Number.isSafeInteger(v) && v > 0;
const sha = (v) => typeof v === 'string' && SHA.test(v);
const unique = (a) => new Set(a).size === a.length;
const safeName = (v) => typeof v === 'string' && v.length > 0 && v.length <= 200 && !/[\x00-\x1f\x7f]/.test(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

class EvidenceFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
function requireEvidence(condition, code) {
  if (!condition) throw new EvidenceFailure(code);
}
function parse(text, code, max = MAX_JSON_BYTES) {
  requireEvidence(typeof text === 'string' && Buffer.byteLength(text, 'utf8') <= max, code);
  try { return JSON.parse(text); } catch { throw new EvidenceFailure(code); }
}
function policyFrom(text) {
  const p = parse(text, 'POLICY_INVALID', 16 * 1024);
  requireEvidence(record(p) && record(p.repository) && id(p.repository.id) &&
    typeof p.repository.fullName === 'string' && REPOSITORY.test(p.repository.fullName) &&
    !['.', '..'].includes(p.repository.fullName.split('/')[1]) &&
    Array.isArray(p.reviewerIds) && p.reviewerIds.length > 0 && p.reviewerIds.length <= 20 &&
    p.reviewerIds.every(id) && unique(p.reviewerIds) && record(p.workflow) && id(p.workflow.id) &&
    typeof p.workflow.path === 'string' && /^\.github\/workflows\/[A-Za-z0-9_-]+\.ya?ml$/.test(p.workflow.path) &&
    Array.isArray(p.workflow.requiredJobs) && p.workflow.requiredJobs.length > 0 &&
    p.workflow.requiredJobs.length <= 20 && p.workflow.requiredJobs.every(safeName) &&
    unique(p.workflow.requiredJobs) && typeof p.allowForks === 'boolean', 'POLICY_INVALID');
  return p;
}
function requestFrom(text) {
  const q = parse(text, 'REQUEST_INVALID', 16 * 1024);
  requireEvidence(record(q) && id(q.prNumber) && id(q.runId) && id(q.attempt) &&
    sha(q.headSha) && sha(q.baseSha), 'REQUEST_INVALID');
  return q;
}
function repositoryMatches(value, expected) {
  return record(value) && value.id === expected.id && value.full_name === expected.fullName;
}
function prIdentity(pr, q, p) {
  requireEvidence(record(pr) && id(pr.id) && pr.number === q.prNumber && pr.state === 'open' &&
    pr.merged === false && id(pr.user?.id) && repositoryMatches(pr.base?.repo, p.repository) &&
    pr.head?.sha === q.headSha && pr.base?.sha === q.baseSha &&
    safeName(pr.head.ref) && safeName(pr.base.ref) && id(pr.head.repo?.id) &&
    typeof pr.head.repo?.full_name === 'string' && REPOSITORY.test(pr.head.repo.full_name), 'PR_IDENTITY_MISMATCH');
  const fork = pr.head.repo.id !== p.repository.id;
  requireEvidence(fork ? p.allowForks : pr.head.repo.full_name === p.repository.fullName, 'FORK_NOT_ALLOWED');
  return {prId: pr.id, prNumber: pr.number, sourceHead: pr.head.sha, baseSha: pr.base.sha,
    authorId: pr.user.id, headRepositoryId: pr.head.repo.id, headRepositoryName: pr.head.repo.full_name,
    headRef: pr.head.ref, baseRef: pr.base.ref, fork, mergeSha: pr.merge_commit_sha ?? null};
}
function reviewEvidence(reviews, identity, p, prefix) {
  const latest = new Map();
  let previousTime = -Infinity;
  for (const r of reviews) {
    requireEvidence(record(r) && id(r.id) && id(r.user?.id) &&
      ['User', 'Bot'].includes(r.user.type) &&
      ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED', 'PENDING'].includes(r.state) &&
      r.pull_request_url === `https://api.github.com${prefix}/pulls/${identity.prNumber}` &&
      sha(r.commit_id), 'REVIEW_RECORD_INVALID');
    if (r.state === 'PENDING') continue;
    const time = typeof r.submitted_at === 'string' ? Date.parse(r.submitted_at) : NaN;
    requireEvidence(Number.isFinite(time) && time >= previousTime, 'REVIEW_ORDER_INVALID');
    previousTime = time;
    if (!p.reviewerIds.includes(r.user.id) || r.user.id === identity.authorId || r.user.type !== 'User') continue;
    // A comment is not a new decision; a dismissal must invalidate approval.
    if (r.state !== 'COMMENTED') latest.set(r.user.id, r);
  }
  requireEvidence(![...latest.values()].some((r) => r.state === 'CHANGES_REQUESTED'), 'REVIEW_CHANGES_REQUESTED');
  const approved = [...latest.values()].filter((r) => r.state === 'APPROVED' && r.commit_id === identity.sourceHead);
  requireEvidence(approved.length > 0, 'REVIEW_NOT_APPROVED_AT_SOURCE');
  return approved.map((r) => ({reviewId: r.id, reviewerId: r.user.id, sourceHead: r.commit_id}));
}
function runIdentity(run, q, p, identity, requireSuccess = true) {
  requireEvidence(record(run) && id(run.id) && id(run.run_attempt) && run.id === q.runId && run.run_attempt === q.attempt &&
    run.head_sha === q.headSha && repositoryMatches(run.repository, p.repository) &&
    run.head_repository?.id === identity.headRepositoryId &&
    run.head_repository?.full_name === identity.headRepositoryName &&
    run.workflow_id === p.workflow.id && run.path === p.workflow.path &&
    run.head_branch === identity.headRef && ['pull_request', 'workflow_dispatch'].includes(run.event), 'RUN_IDENTITY_MISMATCH');
  requireEvidence(['completed', 'queued', 'in_progress', 'requested', 'waiting', 'pending'].includes(run.status) &&
    (run.status === 'completed'
      ? ['success', 'failure', 'cancelled', 'neutral', 'skipped', 'stale', 'timed_out', 'action_required', 'startup_failure'].includes(run.conclusion)
      : run.conclusion === null), 'RUN_STATE_INVALID');
  if (requireSuccess) requireEvidence(run.status === 'completed' && run.conclusion === 'success', 'RUN_NOT_SUCCESS');
  const created = typeof run.created_at === 'string' ? Date.parse(run.created_at) : NaN;
  requireEvidence(id(run.run_number) && Number.isFinite(created) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(run.created_at) &&
    new Date(created).toISOString() === run.created_at.replace(/(?<=:\d{2})Z$/, '.000Z'), 'RUN_ORDER_INVALID');
  requireEvidence(Array.isArray(run.pull_requests), 'RUN_PR_BINDING_MISSING');
  if (run.event === 'pull_request') {
    requireEvidence(run.pull_requests.length === 1, 'RUN_PR_BINDING_MISMATCH');
    const pr = run.pull_requests[0];
    requireEvidence(pr?.id === identity.prId && pr.number === q.prNumber &&
      pr.head?.sha === q.headSha && pr.base?.sha === q.baseSha &&
      pr.head?.repo?.id === identity.headRepositoryId && pr.base?.repo?.id === p.repository.id &&
      pr.head.ref === identity.headRef && pr.base.ref === identity.baseRef, 'RUN_PR_BINDING_MISMATCH');
  } else {
    requireEvidence(!identity.fork && run.pull_requests.length === 0, 'DISPATCH_BINDING_UNSUPPORTED');
  }
  return {runId: run.id, attempt: run.run_attempt, event: run.event, sourceHead: run.head_sha,
    workflowId: run.workflow_id, conclusion: run.conclusion, status: run.status,
    runNumber: run.run_number, createdAt: run.created_at,
    baseBinding: run.event === 'pull_request' ? 'PR_API_ASSOCIATION' : 'NOT_TESTED_BY_DISPATCH'};
}
function jobsEvidence(jobs, q, p) {
  for (const j of jobs) {
    requireEvidence(record(j) && id(j.id) && j.run_id === q.runId && j.run_attempt === q.attempt &&
      j.head_sha === q.headSha && safeName(j.name), 'JOB_IDENTITY_MISMATCH');
  }
  return p.workflow.requiredJobs.map((name) => {
    const matches = jobs.filter((j) => j.name === name);
    requireEvidence(matches.length === 1 && matches[0].status === 'completed' &&
      matches[0].conclusion === 'success', 'REQUIRED_JOB_NOT_SUCCESS');
    return {jobId: matches[0].id, name, conclusion: 'success'};
  });
}
function shell() {
  return {schemaVersion: 1, mode: 'ADVISORY', status: 'NOT_VERIFIED', authorization: 'NONE',
    scope: 'GITHUB_API_RECORD_BINDING_ONLY', reasons: [],
    trust: {root: 'CALLER_SUPPLIED_API_AND_PROTECTED_POLICY', installedRoot: 'NOT_ATTESTED',
      authorMetadata: 'NOT_EVIDENCE', workflowDefinition: 'NOT_VERIFIED'},
    actualCheckout: {status: 'NOT_VERIFIED', reason: 'REQUIRES_INDEPENDENT_RUNNER_ATTESTATION'},
    consistency: 'RECHECKED_READS_NOT_ATOMIC', identity: null, review: null, ci: null, syntheticMerge: null};
}

/**
 * readGitHub is a trusted code capability, not serializable evidence. All data
 * crossing it must be JSON text. All outputs are allowlisted; errors, URLs,
 * body/title/login/token and arbitrary payload fields are never echoed.
 * No CLI is provided: an ordinary PR job cannot authenticate itself by flags.
 */
export async function verifyTrustedPrEvidence({policyJson, requestJson, readGitHub} = {}) {
  const report = shell();
  try {
    const p = policyFrom(policyJson);
    const q = requestFrom(requestJson);
    requireEvidence(typeof readGitHub === 'function', 'TRUSTED_ADAPTER_MISSING');
    const prefix = `/repos/${p.repository.fullName}`;
    async function get(path) {
      const controller = new AbortController();
      let timer;
      try {
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, 5000);
        });
        const text = await Promise.race([
          Promise.resolve().then(() => readGitHub(Object.freeze({method: 'GET', path, signal: controller.signal}))), timeout,
        ]);
        return parse(text, 'API_RESPONSE_INVALID');
      } catch (error) {
        if (error instanceof EvidenceFailure) throw error;
        throw new EvidenceFailure('API_UNAVAILABLE');
      } finally { clearTimeout(timer); }
    }
    async function reviews() {
      const result = [];
      const ids = new Set();
      for (let page = 1; page <= MAX_REVIEW_PAGES; page++) {
        const batch = await get(`${prefix}/pulls/${q.prNumber}/reviews?per_page=100&page=${page}`);
        requireEvidence(Array.isArray(batch) && batch.length <= 100, 'REVIEWS_INCOMPLETE');
        for (const r of batch) {
          requireEvidence(id(r?.id) && !ids.has(r.id), 'DUPLICATE_REVIEW');
          ids.add(r.id);
          // Only stable evidence fields participate in the freshness recheck.
          result.push({id: r.id, user: {id: r.user?.id, type: r.user?.type}, state: r.state,
            commit_id: r.commit_id, submitted_at: r.submitted_at, pull_request_url: r.pull_request_url});
        }
        if (batch.length < 100) return result;
      }
      throw new EvidenceFailure('REVIEWS_LIMIT_EXCEEDED');
    }
    async function jobs() {
      const result = [];
      let total;
      for (let page = 1; page <= 2; page++) {
        const batch = await get(`${prefix}/actions/runs/${q.runId}/attempts/${q.attempt}/jobs?per_page=100&page=${page}`);
        requireEvidence(record(batch) && Number.isSafeInteger(batch.total_count) && batch.total_count >= 0 &&
          batch.total_count <= MAX_JOBS && Array.isArray(batch.jobs) && batch.jobs.length <= 100 &&
          (total === undefined || total === batch.total_count), 'JOBS_INCOMPLETE');
        total = batch.total_count;
        for (const j of batch.jobs) {
          requireEvidence(record(j), 'JOB_IDENTITY_MISMATCH');
          result.push({id: j.id, name: j.name, run_id: j.run_id, run_attempt: j.run_attempt,
            head_sha: j.head_sha, status: j.status, conclusion: j.conclusion});
        }
        requireEvidence(result.length <= total && unique(result.map((j) => j.id)), 'DUPLICATE_OR_EXCESS_JOBS');
        if (result.length === total) return result;
        requireEvidence(batch.jobs.length === 100, 'JOBS_INCOMPLETE');
      }
      throw new EvidenceFailure('JOBS_INCOMPLETE');
    }
    async function workflowRuns(event, identity) {
      const result = [];
      const ids = new Set(), numbers = new Set();
      let total;
      for (let page = 1; page <= RUN_LIST_CEILING / 100; page++) {
        const batch = await get(`${prefix}/actions/workflows/${p.workflow.id}/runs?head_sha=${q.headSha}&event=${event}&per_page=100&page=${page}`);
        requireEvidence(record(batch) && Number.isSafeInteger(batch.total_count) && batch.total_count > 0 &&
          batch.total_count < RUN_LIST_CEILING && Array.isArray(batch.workflow_runs) &&
          (total === undefined || total === batch.total_count), 'RUN_LIST_INCOMPLETE_OR_LIMIT');
        total = batch.total_count;
        requireEvidence(batch.workflow_runs.length === Math.min(100, total - result.length), 'RUN_LIST_INCOMPLETE_OR_LIMIT');
        for (const candidate of batch.workflow_runs) {
          requireEvidence(record(candidate) && candidate.event === event, 'RUN_LIST_FILTER_MISMATCH');
          // Validate every status, not just successes; derive IDs only from API.
          const run = runIdentity(candidate, {...q, runId: candidate.id, attempt: candidate.run_attempt}, p, identity, false);
          requireEvidence(!ids.has(run.runId) && !numbers.has(run.runNumber), 'RUN_LIST_DUPLICATE_OR_AMBIGUOUS');
          ids.add(run.runId); numbers.add(run.runNumber); result.push(run);
        }
        if (result.length === total) {
          result.sort((a, b) => a.runNumber - b.runNumber);
          requireEvidence(result.every((r, i) => i === 0 || Date.parse(result[i - 1].createdAt) <= Date.parse(r.createdAt)), 'RUN_LIST_ORDER_INCONSISTENT');
          return result;
        }
      }
      throw new EvidenceFailure('RUN_LIST_INCOMPLETE_OR_LIMIT');
    }

    requireEvidence(repositoryMatches(await get(prefix), p.repository), 'REPOSITORY_MISMATCH');
    const identity = prIdentity(await get(`${prefix}/pulls/${q.prNumber}`), q, p);
    const reviewRecords = await reviews();
    const approved = reviewEvidence(reviewRecords, identity, p, prefix);
    const runPath = `${prefix}/actions/runs/${q.runId}`;
    const run = runIdentity(await get(runPath), q, p, identity);
    const runRecords = await workflowRuns(run.event, identity);
    requireEvidence(runRecords.at(-1).runId === run.runId, 'RUN_NOT_LATEST');
    requireEvidence(same(runRecords.at(-1), run), 'RUN_LIST_SELECTED_MISMATCH');
    const attempt = runIdentity(await get(`${runPath}/attempts/${q.attempt}`), q, p, identity);
    requireEvidence(same(run, attempt), 'ATTEMPT_MISMATCH');
    const jobRecords = await jobs();
    const requiredJobs = jobsEvidence(jobRecords, q, p);
    let merge = {status: 'NOT_APPLICABLE', reason: 'DISPATCH_SOURCE_ONLY'};
    if (run.event === 'pull_request') {
      requireEvidence(sha(identity.mergeSha) && identity.mergeSha !== q.headSha, 'MERGE_COMMIT_MISSING');
      const commit = await get(`${prefix}/git/commits/${identity.mergeSha}`);
      requireEvidence(commit?.sha === identity.mergeSha && Array.isArray(commit.parents) && commit.parents.length === 2 &&
        commit.parents[0]?.sha === q.baseSha && commit.parents[1]?.sha === q.headSha, 'MERGE_PARENTS_MISMATCH');
      merge = {status: 'VERIFIED', sha: identity.mergeSha, parents: [q.baseSha, q.headSha],
        meaning: 'CURRENT_PR_MERGE_CANDIDATE_NOT_RUNNER_CHECKOUT'};
    }
    requireEvidence(same(reviewRecords, await reviews()) && same(jobRecords, await jobs()) &&
      same(run, runIdentity(await get(runPath), q, p, identity)) &&
      same(identity, prIdentity(await get(`${prefix}/pulls/${q.prNumber}`), q, p)) &&
      same(runRecords, await workflowRuns(run.event, identity)), 'EVIDENCE_CHANGED_DURING_READ');
    report.identity = {repositoryId: p.repository.id, repository: p.repository.fullName,
      prNumber: q.prNumber, sourceHead: q.headSha, baseSha: q.baseSha, fork: identity.fork};
    report.review = {status: 'VERIFIED', approvals: approved};
    report.ci = {status: 'VERIFIED', ...run, requiredJobs};
    report.syntheticMerge = merge;
    report.status = 'VERIFIED';
  } catch (error) {
    report.reasons.push(error instanceof EvidenceFailure ? error.code : 'INVALID_EVIDENCE');
  }
  return report;
}
