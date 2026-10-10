import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyTrustedPrEvidence} from '../scripts/ci/trusted-pr-evidence.mjs';

// Synthetic API records test the verifier, not a deployed authentication root.
const HEAD = 'a'.repeat(40), BASE = 'b'.repeat(40), MERGE = 'c'.repeat(40);
const PREFIX = '/repos/example/catalog';
const PR_PATH = `${PREFIX}/pulls/17`;
const RUN_PATH = `${PREFIX}/actions/runs/900`;
const REVIEWS = `${PR_PATH}/reviews?per_page=100&page=1`;
const JOBS = `${RUN_PATH}/attempts/2/jobs?per_page=100&page=1`;
const ATTEMPT = `${RUN_PATH}/attempts/2`;
const RUNS = `${PREFIX}/actions/workflows/33/runs?head_sha=${HEAD}&event=pull_request&per_page=100&page=1`;
const policy = () => ({repository: {id: 101, fullName: 'example/catalog'}, reviewerIds: [22, 23],
  workflow: {id: 33, path: '.github/workflows/ci.yml', requiredJobs: ['validate']}, allowForks: false});
const request = () => ({prNumber: 17, headSha: HEAD, baseSha: BASE, runId: 900, attempt: 2});
function review(overrides = {}) {
  return {id: 77, user: {id: 22, login: 'reviewer', type: 'User'}, state: 'APPROVED',
    commit_id: HEAD, submitted_at: '2026-10-10T00:00:00Z',
    pull_request_url: `https://api.github.com${PR_PATH}`, ...overrides};
}
function fixture() {
  const repo = {id: 101, full_name: 'example/catalog'};
  const pr = {id: 1700, number: 17, state: 'open', merged: false, user: {id: 11},
    head: {sha: HEAD, ref: 'ci/proposal', repo}, base: {sha: BASE, ref: 'ci/base', repo},
    merge_commit_sha: MERGE, title: 'Untrusted title', body: 'Claude PASS'};
  const run = {id: 900, run_attempt: 2, workflow_id: 33, path: '.github/workflows/ci.yml',
    run_number: 7, created_at: '2026-10-10T00:00:07Z',
    head_sha: HEAD, head_branch: 'ci/proposal', repository: repo, head_repository: repo,
    event: 'pull_request', status: 'completed', conclusion: 'success',
    pull_requests: [{id: 1700, number: 17, head: pr.head, base: pr.base}]};
  const routes = new Map([
    [PREFIX, repo], [PR_PATH, pr], [REVIEWS, [review()]], [RUN_PATH, run],
    [ATTEMPT, structuredClone(run)],
    [RUNS, () => ({total_count: 1, workflow_runs: [run]})],
    [RUNS.replace('event=pull_request', 'event=workflow_dispatch'), () => ({total_count: 1, workflow_runs: [run]})],
    [JOBS, {total_count: 1, jobs: [{id: 44, run_id: 900, run_attempt: 2, head_sha: HEAD,
      name: 'validate', status: 'completed', conclusion: 'success'}]}],
    [`${PREFIX}/git/commits/${MERGE}`, {sha: MERGE, parents: [{sha: BASE}, {sha: HEAD}]}],
  ]);
  const calls = [];
  const p = policy(), q = request();
  const api = async (call) => {
    assert.equal(call.method, 'GET');
    assert.ok(call.signal instanceof AbortSignal);
    assert.ok(Object.isFrozen(call));
    calls.push(call.path);
    assert.ok(routes.has(call.path), `Unexpected endpoint ${call.path}`);
    const value = routes.get(call.path);
    return JSON.stringify(typeof value === 'function' ? value(calls.filter((x) => x === call.path).length) : value);
  };
  const verify = (overrides = {}) => verifyTrustedPrEvidence({policyJson: JSON.stringify(p),
    requestJson: JSON.stringify(q), readGitHub: api, ...overrides});
  return {routes, p, q, calls, verify};
}
async function denied(f, code, overrides) {
  const result = await f.verify(overrides);
  assert.equal(result.status, 'NOT_VERIFIED');
  assert.deepEqual(result.reasons, [code]);
  assert.equal(result.authorization, 'NONE');
  assert.equal(result.review, null);
  assert.equal(result.ci, null);
  return result;
}

test('G1c: binds authenticated-adapter records; source and prospective merge stay distinct', async () => {
  const f = fixture();
  const result = await f.verify();
  assert.equal(result.status, 'VERIFIED');
  assert.deepEqual(result.identity, {repositoryId: 101, repository: 'example/catalog', prNumber: 17,
    sourceHead: HEAD, baseSha: BASE, fork: false});
  assert.deepEqual(result.review.approvals, [{reviewId: 77, reviewerId: 22, sourceHead: HEAD}]);
  assert.equal(result.ci.runId, 900);
  assert.equal(result.ci.attempt, 2);
  assert.equal(result.ci.sourceHead, HEAD);
  assert.deepEqual(result.ci.requiredJobs, [{jobId: 44, name: 'validate', conclusion: 'success'}]);
  assert.deepEqual(result.syntheticMerge.parents, [BASE, HEAD]);
  assert.equal(result.syntheticMerge.sha, MERGE);
  assert.equal(result.actualCheckout.status, 'NOT_VERIFIED');
  assert.equal(result.trust.workflowDefinition, 'NOT_VERIFIED');
  assert.equal(result.trust.installedRoot, 'NOT_ATTESTED');
  assert.equal(result.scope, 'GITHUB_API_RECORD_BINDING_ONLY');
  assert.equal(result.mode, 'ADVISORY');
  assert.equal(result.authorization, 'NONE');
  assert.equal(result.consistency, 'RECHECKED_READS_NOT_ATOMIC');
  assert.equal(f.calls.filter((x) => x === PR_PATH).length, 2);
});

test('missing adapter or protected policy never accepts authenticated flags / author evidence', async () => {
  const f = fixture();
  await denied(f, 'TRUSTED_ADAPTER_MISSING', {readGitHub: undefined});
  await denied(f, 'TRUSTED_ADAPTER_MISSING', {readGitHub: {authenticated: true}});
  await denied(f, 'POLICY_INVALID', {policyJson: undefined});
  const r = await verifyTrustedPrEvidence();
  assert.equal(r.status, 'NOT_VERIFIED');
  f.routes.set(REVIEWS, []);
  f.routes.get(PR_PATH).body = JSON.stringify({authenticated: true, reviewer: 'Claude 2',
    review: review(), trusted: true, verdict: 'PASS', source: HEAD});
  f.q.review = review();
  await denied(f, 'REVIEW_NOT_APPROVED_AT_SOURCE');
});

for (const [label, mutate, code] of [
  ['repository ID', (f) => f.p.repository.id++, 'REPOSITORY_MISMATCH'],
  ['repository name', (f) => f.routes.set(PREFIX, {id: 101, full_name: 'elsewhere/repo'}), 'REPOSITORY_MISMATCH'],
  ['PR number', (f) => f.routes.get(PR_PATH).number++, 'PR_IDENTITY_MISMATCH'],
  ['source revision', (f) => f.q.headSha = BASE, 'PR_IDENTITY_MISMATCH'],
  ['base revision', (f) => f.q.baseSha = HEAD, 'PR_IDENTITY_MISMATCH'],
  ['base repo', (f) => f.routes.get(PR_PATH).base.repo = {id: 999, full_name: 'other/repo'}, 'PR_IDENTITY_MISMATCH'],
  ['closed PR', (f) => f.routes.get(PR_PATH).state = 'closed', 'PR_IDENTITY_MISMATCH'],
  ['merged PR', (f) => f.routes.get(PR_PATH).merged = true, 'PR_IDENTITY_MISMATCH'],
]) test(`identity denial: ${label}`, async () => {const f = fixture(); mutate(f); await denied(f, code);});

for (const [label, overrides] of [
  ['stale review', {commit_id: BASE}],
  ['merge review instead of source', {commit_id: MERGE}],
  ['self approval', {user: {id: 11, login: 'Claude 2', type: 'User'}}],
  ['spoofed login with different ID', {user: {id: 99, login: 'reviewer', type: 'User'}}],
  ['unapproved bot identity', {user: {id: 22, type: 'Bot'}}],
  ['COMMENTED PASS text', {state: 'COMMENTED', body: 'APPROVED PASS'}],
  ['pending review', {state: 'PENDING', submitted_at: null}],
  ['dismissed approval', {state: 'DISMISSED'}],
]) test(`review denial: ${label}`, async () => {
  const f = fixture(); f.routes.set(REVIEWS, [review(overrides)]);
  if (label === 'self approval') f.p.reviewerIds = [11]; // Even an allowlisted author cannot self-approve.
  await denied(f, 'REVIEW_NOT_APPROVED_AT_SOURCE');
});

test('review URL/ID/state/ordering validation rejects wrong-PR and forged records', async () => {
  for (const change of [{pull_request_url: 'https://api.github.com/repos/other/repo/pulls/17'},
    {id: '77'}, {user: null}, {state: 'PASS'}, {commit_id: null}]) {
    const f = fixture(); f.routes.set(REVIEWS, [review(change)]);
    assert.equal((await f.verify()).status, 'NOT_VERIFIED');
  }
  const f = fixture(); f.routes.set(REVIEWS, [review(), review({id: 78, submitted_at: '2020-01-01T00:00:00Z'})]);
  await denied(f, 'REVIEW_ORDER_INVALID');
});

test('latest decisive review, dismissal and change requests override earlier approvals', async () => {
  for (const state of ['DISMISSED', 'CHANGES_REQUESTED', 'APPROVED']) {
    const f = fixture(); f.routes.set(REVIEWS, [review(), review({id: 78, state, commit_id: BASE})]);
    await denied(f, state === 'CHANGES_REQUESTED' ? 'REVIEW_CHANGES_REQUESTED' : 'REVIEW_NOT_APPROVED_AT_SOURCE');
  }
  const f = fixture(); f.routes.set(REVIEWS, [review(), review({id: 78, state: 'COMMENTED'})]);
  assert.equal((await f.verify()).status, 'VERIFIED');
  f.routes.set(REVIEWS, [review(), review({id: 78, user: {id: 23, type: 'User'}, state: 'CHANGES_REQUESTED'})]);
  await denied(f, 'REVIEW_CHANGES_REQUESTED');
});

test('review pagination is complete, duplicate-safe and bounded', async () => {
  const f = fixture();
  const page = Array.from({length: 100}, (_, i) => review({id: i + 1, state: 'COMMENTED'}));
  f.routes.set(REVIEWS, page);
  f.routes.set(REVIEWS.replace('&page=1', '&page=2'), [review({id: 101})]);
  assert.equal((await f.verify()).status, 'VERIFIED');
  f.routes.set(REVIEWS.replace('&page=1', '&page=2'), [review({id: 1})]);
  await denied(f, 'DUPLICATE_REVIEW');
  f.routes.set(REVIEWS, [review(), review()]);
  await denied(f, 'DUPLICATE_REVIEW');
  for (let n = 1; n <= 10; n++) f.routes.set(REVIEWS.replace('&page=1', `&page=${n}`),
    page.map((r, i) => ({...r, id: (n - 1) * 100 + i + 1})));
  await denied(f, 'REVIEWS_LIMIT_EXCEEDED');
});

for (const [label, field, value] of [
  ['run ID', 'id', 901], ['attempt', 'run_attempt', 1], ['source', 'head_sha', BASE],
  ['merge SHA is not source', 'head_sha', MERGE], ['workflow ID', 'workflow_id', 99],
  ['workflow path', 'path', '.github/workflows/evil.yml'], ['branch', 'head_branch', 'other'],
  ['privileged event', 'event', 'pull_request_target'], ['unrelated push', 'event', 'push'],
  ['repository', 'repository', {id: 999, full_name: 'example/catalog'}],
  ['head repository', 'head_repository', {id: 999, full_name: 'fork/catalog'}],
]) test(`CI denial: wrong ${label}`, async () => {
  const f = fixture(); f.routes.get(RUN_PATH)[field] = value;
  await denied(f, 'RUN_IDENTITY_MISMATCH');
});

test('CI pending, failed, cancelled or skipped is NOT_VERIFIED, never PASS', async () => {
  for (const [status, conclusion] of [['queued', null], ['in_progress', null],
    ['completed', 'failure'], ['completed', 'cancelled'], ['completed', 'skipped']]) {
    const f = fixture(); Object.assign(f.routes.get(RUN_PATH), {status, conclusion});
    await denied(f, 'RUN_NOT_SUCCESS');
  }
});

test('run must bind exact PR, source, base and repositories; unrelated run is denied', async () => {
  for (const mutate of [(r) => r.pull_requests = [], (r) => r.pull_requests.push(r.pull_requests[0]),
    (r) => r.pull_requests[0].number++, (r) => r.pull_requests[0].id++,
    (r) => r.pull_requests[0].head = {sha: BASE}, (r) => r.pull_requests[0].base = {sha: HEAD},
    (r) => r.pull_requests[0].head = {...r.pull_requests[0].head, repo: {id: 999}}]) {
    const f = fixture(); const r = structuredClone(f.routes.get(RUN_PATH)); mutate(r); f.routes.set(RUN_PATH, r);
    await denied(f, 'RUN_PR_BINDING_MISMATCH');
  }
  const f = fixture(); f.routes.get(ATTEMPT).run_attempt = 1;
  await denied(f, 'RUN_IDENTITY_MISMATCH');
});

test('attempt jobs must be complete, unique and successful for protected required names', async () => {
  for (const change of [{id: null}, {run_id: 901}, {run_attempt: 1}, {head_sha: BASE}]) {
    const f = fixture(); Object.assign(f.routes.get(JOBS).jobs[0], change);
    await denied(f, 'JOB_IDENTITY_MISMATCH');
  }
  for (const change of [{status: 'queued'}, {conclusion: 'skipped'}, {conclusion: 'failure'}, {name: 'cms009-candidate'}]) {
    const f = fixture(); Object.assign(f.routes.get(JOBS).jobs[0], change);
    await denied(f, 'REQUIRED_JOB_NOT_SUCCESS');
  }
  const f = fixture(); f.routes.get(JOBS).total_count = 2;
  await denied(f, 'JOBS_INCOMPLETE');
  f.routes.get(JOBS).jobs.push(f.routes.get(JOBS).jobs[0]);
  await denied(f, 'DUPLICATE_OR_EXCESS_JOBS');
  f.routes.get(JOBS).jobs[1] = {...f.routes.get(JOBS).jobs[0], id: 45};
  await denied(f, 'REQUIRED_JOB_NOT_SUCCESS');
  f.routes.get(JOBS).total_count = 201;
  await denied(f, 'JOBS_INCOMPLETE');
});

test('complete job pagination allows optional candidate skip; later-page required job is checked', async () => {
  const f = fixture(), required = f.routes.get(JOBS).jobs[0];
  f.routes.set(JOBS, {total_count: 101, jobs: Array.from({length: 100}, (_, i) =>
    ({...required, id: 100 + i, name: `optional-${i}`, conclusion: 'skipped'}))});
  f.routes.set(JOBS.replace('&page=1', '&page=2'), {total_count: 101, jobs: [required]});
  assert.equal((await f.verify()).status, 'VERIFIED');
  f.routes.get(JOBS.replace('&page=1', '&page=2')).total_count = 100;
  await denied(f, 'JOBS_INCOMPLETE');
});

test('dispatch verifies source only; does not invent merge checkout or tested base', async () => {
  const f = fixture();
  for (const path of [RUN_PATH, ATTEMPT]) Object.assign(f.routes.get(path), {event: 'workflow_dispatch', pull_requests: []});
  const result = await f.verify();
  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.ci.baseBinding, 'NOT_TESTED_BY_DISPATCH');
  assert.equal(result.syntheticMerge.status, 'NOT_APPLICABLE');
  assert.equal(result.actualCheckout.status, 'NOT_VERIFIED');
  assert.ok(!f.calls.some((x) => x.includes('/git/commits/')));
});

test('fork policy defaults to deny; explicit read-only fork verification binds head repository', async () => {
  const f = fixture(), fork = {id: 202, full_name: 'contributor/catalog'};
  f.routes.get(PR_PATH).head.repo = fork;
  for (const path of [RUN_PATH, ATTEMPT]) {
    f.routes.get(path).head_repository = fork;
    f.routes.get(path).pull_requests[0].head.repo = fork;
  }
  await denied(f, 'FORK_NOT_ALLOWED');
  f.p.allowForks = true;
  const result = await f.verify();
  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.identity.fork, true);
  assert.ok(f.calls.every((path) => path.startsWith(PREFIX)));
  for (const path of [RUN_PATH, ATTEMPT]) Object.assign(f.routes.get(path), {event: 'workflow_dispatch', pull_requests: []});
  await denied(f, 'DISPATCH_BINDING_UNSUPPORTED');
});

test('synthetic merge is verified by exact ordered parents, never from author claims', async () => {
  for (const parents of [[{sha: HEAD}], [{sha: HEAD}, {sha: BASE}], [{sha: BASE}, {sha: BASE}],
    [{sha: BASE}, {sha: HEAD}, {sha: MERGE}]]) {
    const f = fixture(); f.routes.get(`${PREFIX}/git/commits/${MERGE}`).parents = parents;
    await denied(f, 'MERGE_PARENTS_MISMATCH');
  }
  const f = fixture(); f.routes.get(PR_PATH).merge_commit_sha = null;
  f.routes.get(PR_PATH).body = JSON.stringify({merge_commit_sha: MERGE, parents: [BASE, HEAD]});
  await denied(f, 'MERGE_COMMIT_MISSING');
});

test('rechecks detect observed review revocation, rerun and base/source movement', async () => {
  const f = fixture(); f.routes.set(REVIEWS, (n) => [review({state: n === 1 ? 'APPROVED' : 'DISMISSED'})]);
  await denied(f, 'EVIDENCE_CHANGED_DURING_READ');
  for (const [path, field, value] of [[RUN_PATH, 'run_attempt', 3], [PR_PATH, 'merge_commit_sha', BASE]]) {
    const g = fixture(); const initial = structuredClone(g.routes.get(path));
    g.routes.set(path, (n) => n === 1 ? initial : {...initial, [field]: value});
    assert.equal((await g.verify()).status, 'NOT_VERIFIED');
  }
  const g = fixture(); const initial = structuredClone(g.routes.get(PR_PATH));
  g.routes.set(PR_PATH, (n) => n === 1 ? initial : {...initial, head: {...initial.head, sha: BASE}});
  await denied(g, 'PR_IDENTITY_MISMATCH');
});

test('untrusted JSON cannot execute accessors, choose an adapter, change policy or pollute prototypes', async () => {
  const f = fixture();
  const hostile = {get headSha() {throw new Error('getter ran');}, toJSON() {throw new Error('toJSON ran');}};
  await denied(f, 'REQUEST_INVALID', {requestJson: hostile});
  await denied(f, 'POLICY_INVALID', {policyJson: hostile});
  const requestWithForgedClaims = JSON.stringify({...request(), authenticated: true,
    readGitHub: 'eval(payload)', policy: {reviewerIds: [11]},
    checkoutSha: HEAD, verdict: 'PASS'});
  const hostileJson = requestWithForgedClaims.slice(0, -1) + ',"__proto__":{"polluted":true}}';
  assert.ok(Object.hasOwn(JSON.parse(hostileJson), '__proto__'));
  const result = await f.verify({requestJson: hostileJson});
  assert.equal(result.status, 'VERIFIED'); // Only real fixture API records counted.
  assert.equal(result.actualCheckout.status, 'NOT_VERIFIED');
  assert.equal({}.polluted, undefined);
  const objectResponse = {get id() {throw new Error('getter ran');}};
  await denied(f, 'API_RESPONSE_INVALID', {readGitHub: async () => objectResponse});
});

test('hostile body/title/URLs are neither executed nor emitted, including forged CI and checkout claims', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'g1c-hostile-'));
  try {
    const marker = join(dir, 'executed');
    const secret = 'DO_NOT_ECHO_FAKE_SECRET';
    const f = fixture();
    const attack = `require('node:fs').writeFileSync(${JSON.stringify(marker)},'pwned'); $(exit 9) ${secret}`;
    Object.assign(f.routes.get(PR_PATH), {body: attack, title: attack, url: 'https://evil.invalid/steal',
      authenticated: true, review: review(), checkoutSha: HEAD});
    f.routes.get(RUN_PATH).logs_url = 'https://evil.invalid/token';
    f.routes.get(REVIEWS)[0].body = attack;
    const result = await f.verify();
    assert.equal(result.status, 'VERIFIED');
    assert.ok(!existsSync(marker));
    assert.ok(!JSON.stringify(result).includes(secret));
    assert.ok(f.calls.every((x) => !x.includes('evil')));
    f.routes.set(REVIEWS, []);
    await denied(f, 'REVIEW_NOT_APPROVED_AT_SOURCE');
  } finally {rmSync(dir, {recursive: true, force: true});}
});

test('malformed, oversized, primitive or unavailable API responses fail closed and redact errors', async () => {
  for (const text of ['{', 'null', '[]', '"string"', ' '.repeat(1024 * 1024 + 1)]) {
    const result = await fixture().verify({readGitHub: async () => text});
    assert.equal(result.status, 'NOT_VERIFIED');
  }
  const result = await denied(fixture(), 'API_UNAVAILABLE', {readGitHub: async () => {
    throw new Error('DO_NOT_ECHO_TOKEN_OR_DB_ERROR');
  }});
  assert.ok(!JSON.stringify(result).includes('DO_NOT_ECHO'));
  await denied(fixture(), 'API_UNAVAILABLE', {readGitHub: () => new Promise(() => {})});
});

test('invalid selectors and invalid protected policy are rejected before API calls', async () => {
  for (const change of [{prNumber: '../1'}, {runId: '900;whoami'}, {attempt: 0}, {headSha: MERGE + '\n'}, {baseSha: null}]) {
    const f = fixture(); Object.assign(f.q, change); await denied(f, 'REQUEST_INVALID'); assert.equal(f.calls.length, 0);
  }
  for (const change of [{reviewerIds: []}, {reviewerIds: [22, 22]}, {allowForks: 'true'},
    {repository: {id: 101, fullName: 'example/..'}},
    {workflow: {...policy().workflow, requiredJobs: []}}, {workflow: {...policy().workflow, path: '../evil.yml'}}]) {
    const f = fixture(); Object.assign(f.p, change); await denied(f, 'POLICY_INVALID'); assert.equal(f.calls.length, 0);
  }
});

test('library has no CLI, network, environment, shell, checkout or workflow mutation capability', () => {
  const source = readFileSync(new URL('../scripts/ci/trusted-pr-evidence.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bimport\s|\brequire\s*\(|\bprocess\.|\bfetch\s*\(|\beval\s*\(|\bnew\s+Function\b/);
  assert.doesNotMatch(source, /\bexec(?:File|Sync)?\s*\(|\bspawn(?:Sync)?\s*\(|\bwriteFile/);
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.ok(!workflow.includes('trusted-pr-evidence.mjs'));
});

for (const [label, status, conclusion] of [
  ['FAILURE', 'completed', 'failure'], ['IN_PROGRESS', 'in_progress', null],
  ['QUEUED', 'queued', null], ['CANCELLED', 'completed', 'cancelled'], ['SUCCESS', 'completed', 'success'],
]) test(`G1C-B1 old SUCCESS / newer ${label} is NOT_VERIFIED`, async () => {
  const f = fixture();
  const old = structuredClone(f.routes.get(RUN_PATH));
  // Lower ID but higher workflow run_number: ID magnitude is NOT chronology.
  const newer = {...old, id: 899, run_number: 8, run_attempt: 1, created_at: '2026-10-10T00:00:08Z', status, conclusion};
  f.routes.set(RUNS, {total_count: 2, workflow_runs: [old, newer]});
  const result = await f.verify();
  assert.equal(result.status, 'NOT_VERIFIED');
  assert.deepEqual(result.reasons, ['RUN_NOT_LATEST']);
  assert.equal(result.ci, null);
  assert.ok(f.calls.includes(RUNS));
});

function runPages(f, records) {
  for (let page = 1; page <= Math.ceil(records.length / 100); page++) {
    f.routes.set(RUNS.replace('&page=1', `&page=${page}`),
      {total_count: records.length, workflow_runs: records.slice((page - 1) * 100, page * 100)});
  }
}
function runHistory(f, count) {
  for (const path of [RUN_PATH, ATTEMPT]) Object.assign(f.routes.get(path),
    {run_number: 2000, created_at: '2026-10-10T01:00:00Z'});
  const selected = structuredClone(f.routes.get(RUN_PATH));
  return [...Array.from({length: count - 1}, (_, i) => ({...selected, id: 10000 + i, run_number: i + 1,
    created_at: new Date(Date.UTC(2026, 9, 10) + i * 1000).toISOString(), conclusion: 'failure'})), selected];
}

test('G1C-B1 single latest SUCCESS and newer selected SUCCESS verify through two list reads', async () => {
  const f = fixture();
  assert.equal((await f.verify()).status, 'VERIFIED');
  assert.equal(f.calls.filter((p) => p === RUNS).length, 2);
  const selected = structuredClone(f.routes.get(RUN_PATH));
  // Higher ID and same timestamp, but lower documented sequence: this is older.
  const older = {...selected, id: 999999, run_number: 6, conclusion: 'failure'};
  runPages(f, [selected, older]);
  const result = await f.verify();
  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.ci.runId, 900);
  assert.equal(result.ci.runNumber, 7);
  assert.ok(f.calls.filter((p) => p.includes('/workflows/')).every((p) =>
    p.includes('head_sha=' + HEAD) && p.includes('event=pull_request') && !p.includes('status=')));
});

test('G1C-B1 complete pagination works across 100/101/200/999 boundaries, regardless of API order', async () => {
  for (const count of [100, 101, 200, 999]) {
    const f = fixture();
    const history = runHistory(f, count);
    if (count === 200) history.reverse();
    runPages(f, history);
    assert.equal((await f.verify()).status, 'VERIFIED', `count=${count}`);
    assert.equal(f.calls.filter((p) => p.startsWith(`${PREFIX}/actions/workflows/`)).length, Math.ceil(count / 100) * 2);
  }
});

test('G1C-B1 newer failure beyond first page prevents early success', async () => {
  const f = fixture(), history = runHistory(f, 100);
  history.push({...history.at(-1), id: 899, run_number: 2001, created_at: '2026-10-10T01:00:01Z', conclusion: 'failure'});
  runPages(f, history);
  await denied(f, 'RUN_NOT_LATEST');
  assert.ok(f.calls.includes(RUNS.replace('&page=1', '&page=2')));
});

test('G1C-B1 incomplete pages, changing totals and API search ceiling deny freshness', async () => {
  for (const total of [0, -1, 1.5, '1', 1000, 1001, Number.MAX_SAFE_INTEGER + 1]) {
    const f = fixture(); f.routes.set(RUNS, {total_count: total, workflow_runs: [f.routes.get(RUN_PATH)]});
    await denied(f, 'RUN_LIST_INCOMPLETE_OR_LIMIT');
  }
  for (const mode of ['short-first', 'short-last', 'count-drift', 'missing-page', 'too-many']) {
    const f = fixture(); runPages(f, runHistory(f, 101));
    const page2 = RUNS.replace('&page=1', '&page=2');
    if (mode === 'short-first') f.routes.get(RUNS).workflow_runs.pop();
    if (mode === 'short-last') f.routes.get(page2).workflow_runs = [];
    if (mode === 'count-drift') f.routes.get(page2).total_count = 102;
    if (mode === 'missing-page') f.routes.delete(page2);
    if (mode === 'too-many') f.routes.get(page2).workflow_runs.push(f.routes.get(RUN_PATH));
    await denied(f, mode === 'missing-page' ? 'API_UNAVAILABLE' : 'RUN_LIST_INCOMPLETE_OR_LIMIT');
  }
});

test('G1C-B1 duplicates, ambiguous sequence or timestamps and wrong-filter records fail closed', async () => {
  const badRecords = [
    [r => ({...r}), 'RUN_LIST_DUPLICATE_OR_AMBIGUOUS'],
    [r => ({...r, id: 899}), 'RUN_LIST_DUPLICATE_OR_AMBIGUOUS'],
    [r => ({...r, id: 899, run_number: 8, created_at: '2026-10-09T00:00:00Z'}), 'RUN_LIST_ORDER_INCONSISTENT'],
    [r => ({...r, id: 899, run_number: null}), 'RUN_ORDER_INVALID'],
    [r => ({...r, id: 899, run_number: 8, created_at: '2026-02-30T00:00:00Z'}), 'RUN_ORDER_INVALID'],
    [r => ({...r, id: 899, run_number: 8, created_at: 'not-a-date'}), 'RUN_ORDER_INVALID'],
    [r => ({...r, id: 899, run_number: 8, event: 'workflow_dispatch'}), 'RUN_LIST_FILTER_MISMATCH'],
    [r => ({...r, id: 899, run_number: 8, head_sha: BASE}), 'RUN_IDENTITY_MISMATCH'],
    [r => ({...r, id: 899, run_number: 8, workflow_id: 34}), 'RUN_IDENTITY_MISMATCH'],
    [r => ({...r, id: 899, run_number: 8, status: 'queued', conclusion: 'success'}), 'RUN_STATE_INVALID'],
    [r => ({...r, id: 899, run_number: 8, status: 'made-up', conclusion: null}), 'RUN_STATE_INVALID'],
    [r => ({...r, id: 899, run_number: 8, pull_requests: []}), 'RUN_PR_BINDING_MISMATCH'],
  ];
  for (const [mutate, code] of badRecords) {
    const f = fixture(), selected = structuredClone(f.routes.get(RUN_PATH));
    runPages(f, [selected, mutate(selected)]);
    await denied(f, code);
  }
  const f = fixture(); runPages(f, runHistory(f, 101));
  f.routes.get(RUNS.replace('&page=1', '&page=2')).workflow_runs[0] = f.routes.get(RUNS).workflow_runs[0];
  await denied(f, 'RUN_LIST_DUPLICATE_OR_AMBIGUOUS');
});

test('G1C-B1 selected record must be listed consistently; latest attempt is still mandatory', async () => {
  for (const changes of [{run_attempt: 3}, {run_number: 8}, {created_at: '2026-10-10T00:00:08Z'},
    {status: 'in_progress', conclusion: null}, {conclusion: 'failure'}]) {
    const f = fixture(); runPages(f, [{...f.routes.get(RUN_PATH), ...changes}]);
    await denied(f, 'RUN_LIST_SELECTED_MISMATCH');
  }
  const f = fixture(); f.routes.get(RUN_PATH).run_attempt = 3;
  // Request still selects attempt 2, while GitHub says newest successful run is at attempt 3.
  await denied(f, 'RUN_IDENTITY_MISMATCH');
  const g = fixture(); g.routes.get(ATTEMPT).run_number = 6;
  await denied(g, 'ATTEMPT_MISMATCH');
});

test('G1C-B1 final full run-list reread detects new run, status/attempt changes and deletion', async () => {
  for (const mode of ['new-run', 'status', 'attempt', 'delete']) {
    const f = fixture(), selected = structuredClone(f.routes.get(RUN_PATH));
    f.routes.set(RUNS, (n) => {
      if (n === 1) return {total_count: 1, workflow_runs: [selected]};
      if (mode === 'new-run') return {total_count: 2, workflow_runs: [selected,
        {...selected, id: 899, run_number: 8, created_at: '2026-10-10T00:00:08Z', status: 'queued', conclusion: null}]};
      if (mode === 'delete') return {total_count: 0, workflow_runs: []};
      return {total_count: 1, workflow_runs: [{...selected,
        ...(mode === 'status' ? {conclusion: 'failure'} : {run_attempt: 3})}]};
    });
    await denied(f, mode === 'delete' ? 'RUN_LIST_INCOMPLETE_OR_LIMIT' : 'EVIDENCE_CHANGED_DURING_READ');
    assert.equal(f.calls.filter((p) => p === RUNS).length, 2);
  }
  const f = fixture(); runPages(f, runHistory(f, 101));
  const page2 = RUNS.replace('&page=1', '&page=2'), initial = structuredClone(f.routes.get(page2));
  f.routes.set(page2, (n) => n === 1 ? initial : {total_count: 101, workflow_runs: [{...initial.workflow_runs[0], run_attempt: 3}]});
  await denied(f, 'EVIDENCE_CHANGED_DURING_READ');
  assert.equal(f.calls.filter((p) => p === page2).length, 2);
});

test('G1C-B1 run-list malformed payload, API failure and timeout cannot fall back to selected SUCCESS', async () => {
  for (const payload of [null, [], {}, {total_count: 1, workflow_runs: null},
    {total_count: 1, workflow_runs: [null]}, {total_count: 1, workflow_runs: [{}]}]) {
    const f = fixture(); f.routes.set(RUNS, payload);
    assert.equal((await f.verify()).status, 'NOT_VERIFIED');
  }
  const f = fixture(); f.routes.set(RUNS, () => {throw new Error('DO_NOT_ECHO_SECRET');});
  const result = await denied(f, 'API_UNAVAILABLE');
  assert.ok(!JSON.stringify(result).includes('DO_NOT_ECHO_SECRET'));
  const g = fixture();
  const routesApi = async ({path}) => {
    const data = g.routes.get(path);
    return JSON.stringify(typeof data === 'function' ? data(1) : data);
  };
  for (const text of ['{', ' '.repeat(1024 * 1024 + 1)]) {
    await denied(g, 'API_RESPONSE_INVALID', {readGitHub: (call) => call.path === RUNS ? text : routesApi(call)});
  }
  await denied(g, 'API_UNAVAILABLE', {readGitHub: (call) => call.path === RUNS ? new Promise(() => {}) : routesApi(call)});
});

test('G1C-B1 request metadata cannot choose order, time, state or filtered endpoint', async () => {
  const f = fixture(); Object.assign(f.q, {run_number: 999999, created_at: '2999-01-01T00:00:00Z',
    order: 'newest', status: 'success', event: 'push', runsUrl: 'https://evil.invalid/success'});
  const selected = structuredClone(f.routes.get(RUN_PATH));
  runPages(f, [selected, {...selected, id: 899, run_number: 8, created_at: '2026-10-10T00:00:08Z', conclusion: 'failure'}]);
  await denied(f, 'RUN_NOT_LATEST');
  assert.ok(f.calls.includes(RUNS));
  assert.ok(f.calls.every((p) => !p.includes('evil') && !p.includes('status=')));
});
