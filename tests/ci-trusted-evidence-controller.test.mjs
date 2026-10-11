import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync, sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createReadOnlyEvidenceController} from '../scripts/ci/trusted-evidence-controller.mjs';
import {POLICY_DOMAIN, POLICY_LIMITS} from '../scripts/ci/trusted-policy-release.mjs';

// Synthetic broker/API/register only. Never a live GitHub authentication claim.
const keys = generateKeyPairSync('ed25519'), raw = v => Buffer.from(JSON.stringify(v));
const HEAD = 'a'.repeat(40), BASE = 'b'.repeat(40), MERGE = 'c'.repeat(40), PREFIX = '/repos/example/catalog';
const hash = b => createHash('sha256').update(b).digest('hex');
function fixture() {
  const repo = {id: 101, full_name: 'example/catalog'};
  const pr = {id: 1700, number: 17, state: 'open', merged: false, user: {id: 11},
    head: {sha: HEAD, ref: 'ci/proposal', repo}, base: {sha: BASE, ref: 'ci/base', repo}, merge_commit_sha: MERGE,
    body: 'UNTRUSTED Claude PASS and OIDC checkout claims', title: '$(touch /tmp/forged)'};
  const run = {id: 900, run_attempt: 2, workflow_id: 33, path: '.github/workflows/ci.yml', run_number: 7,
    created_at: '2026-10-10T00:00:07Z', head_sha: HEAD, head_branch: 'ci/proposal', repository: repo, head_repository: repo,
    event: 'pull_request', status: 'completed', conclusion: 'success', pull_requests: [{id: 1700, number: 17, head: pr.head, base: pr.base}]};
  const bootstrap = {appId: 10, installationId: 20, accountId: 30, repository: {id: 101, fullName: 'example/catalog'}};
  const credential = {...bootstrap, schemaVersion: 1, scopeVerified: true, token: 'synthetic_test_token_only', issuedAt: 1000, expiresAt: 60000,
    permissions: {metadata: 'read', actions: 'read', pull_requests: 'read', contents: 'read'}};
  const policy = {schemaVersion: 1, revision: 'd'.repeat(40), epoch: 5, purpose: 'PR_SOURCE_EVIDENCE', event: 'pull_request',
    repository: bootstrap.repository, reviewerIds: [22], workflow: {id: 33, path: '.github/workflows/ci.yml', requiredJobs: ['validate']},
    allowForks: false, limits: {...POLICY_LIMITS}, artifacts: {verifierSha256: '1'.repeat(64), adapterSha256: '2'.repeat(64)}};
  const f = {repo, pr, run, runs: [run], credential, bootstrap, policy, calls: [], registryReads: 0,
    reviews: [{id: 77, user: {id: 22, type: 'User'}, state: 'APPROVED', commit_id: HEAD,
      submitted_at: '2026-10-10T00:00:00Z', pull_request_url: `https://api.github.com${PREFIX}/pulls/17`}],
    merge: {sha: MERGE, parents: [{sha: BASE}, {sha: HEAD}]}, transform: (_path, value) => value};
  f.seal = () => {
    f.policyBytes = raw(policy);
    f.envelope = {schemaVersion: 1, algorithm: 'Ed25519', keyId: 'test-key', digest: hash(f.policyBytes),
      signature: sign(null, Buffer.concat([Buffer.from(POLICY_DOMAIN), f.policyBytes]), keys.privateKey).toString('base64')};
    f.register = {schemaVersion: 1, repository: bootstrap.repository, revision: policy.revision, epoch: policy.epoch,
      digest: hash(f.policyBytes), registerVersion: 8, revocation: {generation: 2, revokedKeyIds: [], revokedDigests: []},
      rollbackFloor: {epoch: 4, registerVersion: 7, revocationGeneration: 1}};
  }; f.seal();
  f.transport = async ({method, url, signal}) => {
    assert.equal(method, 'GET'); assert.ok(signal instanceof AbortSignal);
    const path = url.slice('https://api.github.com'.length); f.calls.push(path);
    const count = f.calls.filter(p => p === path).length;
    let value;
    if (path === PREFIX) value = f.repo;
    else if (path === `${PREFIX}/pulls/17`) value = f.pr;
    else if (path.startsWith(`${PREFIX}/pulls/17/reviews?`)) value = f.reviews;
    else if (path.startsWith(`${PREFIX}/actions/workflows/33/runs?`)) {
      assert.ok(path.includes('&event=pull_request&'));
      const page = Number(path.match(/&page=(\d+)$/)[1]);
      value = {total_count: f.runs.length, workflow_runs: f.runs.slice((page - 1) * 100, page * 100)};
    } else if (path === `${PREFIX}/git/commits/${MERGE}`) value = f.merge;
    else {
      const match = path.match(/\/actions\/runs\/(\d+)(?:\/attempts\/(\d+))?(\/jobs\?per_page=100&page=[12])?$/);
      assert.ok(match, `Unexpected synthetic path ${path}`);
      const selected = f.runs.find(r => r.id === Number(match[1])); assert.ok(selected);
      value = match[3] ? {total_count: 1, jobs: [{id: 44, run_id: selected.id, run_attempt: selected.run_attempt,
        head_sha: HEAD, name: 'validate', status: 'completed', conclusion: 'success'}]} : selected;
    }
    value = f.transform(path, structuredClone(value), count);
    return {status: 200, headers: {'content-type': 'application/json'}, body: value instanceof Uint8Array ? value : raw(value)};
  };
  f.options = () => ({executionMode: 'OFFLINE_SYNTHETIC', bootstrapJson: raw(bootstrap), minimumEpoch: 5,
    policyBytes: f.policyBytes, envelopeBytes: raw(f.envelope), publicKeys: new Map([['test-key', keys.publicKey]]),
    artifactDigests: {...policy.artifacts}, broker: async () => raw(credential), transport: f.transport, now: () => 2000,
    readRegister: async () => { f.registryReads++; return raw(f.register); }});
  f.request = {prNumber: 17, headSha: HEAD, baseSha: BASE};
  f.evaluate = (overrides = {}, requestBytes = raw(f.request)) => createReadOnlyEvidenceController({...f.options(), ...overrides})(requestBytes);
  return f;
}
async function denied(f, overrides, requestBytes) {
  const r = await f.evaluate(overrides, requestBytes);
  assert.equal(r.status, 'NOT_VERIFIED'); assert.equal(r.authorization, 'NONE'); assert.equal(r.apiRecords, null);
  assert.equal(r.evidence.apiRecordBindings.level, 'UNVERIFIED'); assert.ok(r.reasons.length);
  assert.ok(!JSON.stringify(r).includes('synthetic_test_token_only'));
  return r;
}
function moreRuns(f, count) {
  f.runs = Array.from({length: count}, (_, i) => ({...structuredClone(f.run), id: 900 + i, run_number: i + 1,
    created_at: new Date(Date.UTC(2026, 9, 10) + i * 1000).toISOString()}));
}

test('G1C2-N2 controller positive synthetic composition; no live/attestation/independence/enforcement promotion', async () => {
  const f = fixture(), r = await f.evaluate();
  assert.equal(r.apiRecords?.status, 'VERIFIED', JSON.stringify(r));
  assert.equal(r.apiRecords.ci.runId, 900); assert.equal(r.apiRecords.ci.attempt, 2);
  assert.equal(r.apiRecords.identity.sourceHead, HEAD); assert.equal(r.apiRecords.syntheticMerge.sha, MERGE);
  assert.equal(r.apiRecords.syntheticMerge.meaning, 'CURRENT_PR_MERGE_CANDIDATE_NOT_RUNNER_CHECKOUT');
  assert.equal(r.status, 'NOT_VERIFIED'); assert.equal(r.authorization, 'NONE'); assert.equal(r.mode, 'ADVISORY');
  assert.deepEqual(r.evidence.apiRecordBindings, {level: 'UNVERIFIED', basis: 'SYNTHETIC_RESPONSES_ONLY'});
  assert.equal(r.execution, 'OFFLINE_SYNTHETIC'); assert.equal(r.enforcement, 'NOT_AUTHORIZED');
  assert.ok(Object.values(r.evidence).every(e => e.level !== 'PROVEN'));
  for (const key of ['liveAuthentication', 'policyRegisterDurability', 'workflowDefinition', 'actualCheckout', 'headAuthorIndependence', 'lastPusherIndependence']) {
    assert.equal(r.evidence[key].level, 'UNVERIFIED');
  }
  assert.equal(r.evidence.futureLiveIntegration.level, 'PROPOSED'); assert.equal(r.evidence.productionEnforcement.level, 'OUTSIDE_SCOPE');
  assert.equal(r.previousCi.provenance, 'Integrator-observed'); assert.equal(r.previousCi.reusedAsEvidence, false);
  assert.equal(f.registryReads, 2); assert.ok(!JSON.stringify(r).includes('UNTRUSTED'));
});

for (const key of ['token', 'credentials', 'readGitHub', 'transport', 'broker', 'policy', 'publicKeys', 'repository', 'runId', 'attempt', 'event',
  'minimumEpoch', 'rollbackFloor', 'expected']) {
  test(`controller rejects PR-controlled ${key} rather than promoting authority`, async () => {
    const f = fixture(); f.request[key] = key === 'event' ? 'workflow_dispatch' : 'hostile';
    const r = await denied(f); assert.deepEqual(r.reasons, ['REQUEST_INVALID']); assert.equal(f.calls.length, 0);
  });
}

test('G1C2-N1 controller rejects signed policy replay after protected pin advances despite consistent stale register', async () => {
  const f = fixture(), oldBytes = Buffer.from(f.policyBytes);
  assert.equal((await f.evaluate()).apiRecords?.status, 'VERIFIED');
  assert.equal(f.registryReads, 2);
  f.calls.length = 0; f.registryReads = 0;
  const stale = raw(f.register);
  const r = await denied(f, {minimumEpoch: 6, readRegister: async () => { f.registryReads++; return Buffer.from(stale); }});
  assert.deepEqual(r.reasons, ['POLICY_ROLLBACK_FLOOR']);
  assert.equal(f.calls.length, 0); assert.equal(f.registryReads, 0); assert.deepEqual(f.policyBytes, oldBytes);
  f.policy.epoch = 6; f.policy.revision = 'e'.repeat(40); f.seal();
  assert.equal((await f.evaluate({minimumEpoch: 6})).apiRecords?.status, 'VERIFIED');
  assert.equal(f.registryReads, 2);
});

test('G1C2-N1 controller missing or malformed protected floor never calls a provider', async () => {
  for (const minimumEpoch of [undefined, null, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1,
    '5', {epoch: 5, verified: true}]) {
    const f = fixture(), r = await denied(f, {minimumEpoch});
    assert.deepEqual(r.reasons, ['CONTROLLER_CONFIG_INVALID']);
    assert.equal(f.registryReads, 0); assert.equal(f.calls.length, 0);
  }
});

test('G1C2-N1 factory snapshots protected floor and rejects PR selector overrides before providers', async () => {
  const f = fixture(), options = {...f.options(), minimumEpoch: 6};
  const controller = createReadOnlyEvidenceController(options); options.minimumEpoch = 1;
  const r = await controller(raw(f.request)); assert.deepEqual(r.reasons, ['POLICY_ROLLBACK_FLOOR']);
  for (const key of ['minimumEpoch', 'rollbackFloor', 'expected']) {
    const deniedResult = await controller(raw({...f.request, [key]: 1}));
    assert.deepEqual(deniedResult.reasons, ['REQUEST_INVALID']);
  }
  assert.equal(f.registryReads, 0); assert.equal(f.calls.length, 0);
});

test('G1C2-N1 PR body and synthetic API floor claims cannot replace or lower protected authority', async () => {
  const f = fixture();
  f.pr.body = JSON.stringify({minimumEpoch: 1, rollbackFloor: {epoch: 1}, trusted: true});
  f.repo.minimumEpoch = 1;
  const r = await f.evaluate(); assert.equal(r.apiRecords?.status, 'VERIFIED'); // Extra API fields confer no authority.
  f.calls.length = 0; f.registryReads = 0;
  await denied(f, {minimumEpoch: undefined}); await denied(f, {minimumEpoch: 6});
  assert.equal(f.registryReads, 0); assert.equal(f.calls.length, 0);
});

test('G1C2-N2 synthetic success and denials retain operational UNVERIFIED labels and no authorization', async () => {
  const f = fixture(), results = [await f.evaluate(), await f.evaluate({minimumEpoch: 6}),
    await f.evaluate({executionMode: 'LIVE'})];
  for (const r of results) {
    assert.deepEqual(r.evidence.apiRecordBindings, {level: 'UNVERIFIED', basis: 'SYNTHETIC_RESPONSES_ONLY'});
    assert.ok(Object.values(r.evidence).every(e => e.level !== 'PROVEN'));
    assert.equal(r.status, 'NOT_VERIFIED'); assert.equal(r.mode, 'ADVISORY');
    assert.equal(r.authorization, 'NONE'); assert.equal(r.enforcement, 'NOT_AUTHORIZED');
    assert.equal(r.execution, 'OFFLINE_SYNTHETIC');
  }
});

test('controller malformed, duplicate and prototype-polluting requests never call providers', async () => {
  for (const bytes of [Buffer.from('{'), Buffer.from('{"prNumber":17,"prNumber":18}'),
    Buffer.from('{"__proto__":{"polluted":true}}'), raw('eval("hostile")'), {trusted: true}]) {
    const f = fixture(); await denied(f, {}, bytes); assert.equal(f.calls.length, 0); assert.equal(f.registryReads, 0);
  }
  assert.equal({}.polluted, undefined);
});

test('controller wrong or absent broker identity/permissions and API repository deny', async () => {
  for (const mutate of [f => f.credential.installationId++, f => f.credential.appId++, f => delete f.credential.scopeVerified,
    f => delete f.credential.permissions.actions, f => f.repo.id++]) {
    const f = fixture(); mutate(f); await denied(f);
  }
  await denied(fixture(), {broker: undefined});
});

test('controller refuses a claimed authenticated adapter without trusted bootstrap/root', async () => {
  for (const override of [{executionMode: 'LIVE'}, {transport: {authenticated: true}}, {publicKeys: {}},
    {bootstrapJson: raw({repository: {id: 101}})}, {readRegister: undefined}]) await denied(fixture(), override);
});

test('controller initial/final policy register drift invalidates even successful API records', async () => {
  for (const mutate of [r => r.registerVersion++, r => r.rollbackFloor.epoch++, r => r.revocation.generation++,
    r => r.revocation.revokedKeyIds.push('test-key'), r => r.digest = '0'.repeat(64), r => r.epoch++]) {
    const f = fixture(); let reads = 0;
    await denied(f, {readRegister: async () => { if (++reads === 2) mutate(f.register); return raw(f.register); }});
    assert.equal(reads, 2);
  }
});

for (const [status, conclusion] of [['completed', 'failure'], ['in_progress', null], ['queued', null], ['completed', 'cancelled']]) {
  test(`controller older SUCCESS/newer ${status}:${conclusion} never verifies`, async () => {
    const f = fixture(); f.runs.push({...structuredClone(f.run), id: 899, run_number: 8, created_at: '2026-10-10T00:00:08Z', status, conclusion});
    await denied(f);
    assert.ok(f.calls.includes(`${PREFIX}/actions/runs/899`)); // run_number, not highest ID or caller SUCCESS.
  });
}

test('controller derives new successful latest run instead of stale requested/older run', async () => {
  const f = fixture(); f.runs.push({...structuredClone(f.run), id: 899, run_number: 8, created_at: '2026-10-10T00:00:08Z'});
  const r = await f.evaluate(); assert.equal(r.apiRecords?.ci.runId, 899, JSON.stringify(r));
});

for (const count of [100, 101]) test(`controller complete ${count}-run pagination selects boundary latest`, async () => {
  const f = fixture(); moreRuns(f, count); const r = await f.evaluate();
  assert.equal(r.apiRecords?.ci.runId, 899 + count, JSON.stringify(r));
  assert.equal(f.calls.some(p => p.includes('/workflows/') && p.endsWith('page=2')), count > 100);
});

test('controller pagination ceiling/incomplete, duplicates and ambiguous ordering deny', async () => {
  for (const transform of [
    v => ({...v, total_count: 1000}), v => ({...v, total_count: 2}),
    v => ({total_count: 2, workflow_runs: [v.workflow_runs[0], v.workflow_runs[0]]}),
    v => ({total_count: 2, workflow_runs: [v.workflow_runs[0], {...v.workflow_runs[0], id: 901}]}),
    v => ({...v, workflow_runs: [{...v.workflow_runs[0], run_number: 0}]}),
  ]) {
    const f = fixture(); f.transform = (p, v) => p.includes('/workflows/') ? transform(v) : v; await denied(f);
  }
  const f = fixture(); moreRuns(f, 101);
  f.transform = (p, v) => p.includes('/workflows/') && p.endsWith('page=2') ? {...v, total_count: 102} : v;
  await denied(f);
});

test('controller initial/core/final run-list and latest-attempt changes invalidate', async () => {
  for (const at of [2, 3, 4]) {
    const f = fixture();
    f.transform = (p, v, count) => p.includes('/workflows/') && count >= at ? {...v, workflow_runs: [{...v.workflow_runs[0], run_attempt: 3}]} : v;
    await denied(f);
  }
  const stale = fixture(); stale.transform = (p, v) => p === `${PREFIX}/actions/runs/900` ? {...v, run_attempt: 3} : v;
  await denied(stale);
});

test('controller event substitution cannot use dispatch success', async () => {
  const f = fixture(); f.run.event = 'workflow_dispatch'; f.run.pull_requests = [];
  await denied(f); assert.ok(f.calls.every(p => !p.includes('event=workflow_dispatch')));
});

for (const place of ['list', 'run', 'attempt']) for (const shape of ['missing', 'null', 'empty', 'multi', 'duplicate', 'object']) {
  test(`controller PR association ${place}/${shape} fails closed`, async () => {
    const f = fixture();
    f.transform = (p, v) => {
      const isList = place === 'list' && p.includes('/workflows/');
      const match = isList || place === 'run' && p === `${PREFIX}/actions/runs/900` || place === 'attempt' && p === `${PREFIX}/actions/runs/900/attempts/2`;
      if (match) {
        const r = isList ? v.workflow_runs[0] : v;
        if (shape === 'missing') delete r.pull_requests;
        else r.pull_requests = shape === 'null' ? null : shape === 'empty' ? [] : shape === 'object' ? {} :
          [r.pull_requests[0], {...r.pull_requests[0], number: shape === 'multi' ? 18 : 17}];
      }
      return v;
    };
    await denied(f);
  });
}

test('controller denies forks and never substitutes missing head repository', async () => {
  for (const repo of [null, {id: 999, full_name: 'fork/catalog'}]) {
    const f = fixture(); f.pr.head.repo = repo; await denied(f);
  }
});

test('controller stale/self/missing reviews cannot be replaced by PR body PASS or logs', async () => {
  for (const mutate of [f => f.reviews = [], f => f.reviews[0].commit_id = BASE, f => f.reviews[0].user.id = 11,
    f => f.reviews[0].state = 'DISMISSED']) {
    const f = fixture(); mutate(f); f.pr.body = raw({reviewer: 'Claude', verdict: 'PASS', checkout: MERGE}).toString(); await denied(f);
  }
});

test('controller merge parents and skipped required jobs preserve frozen fail-closed boundary', async () => {
  const f = fixture(); f.merge.parents.reverse(); await denied(f);
  const g = fixture(); g.transform = (p, v) => p.includes('/jobs?') ? {...v, jobs: [{...v.jobs[0], conclusion: 'skipped'}]} : v;
  await denied(g);
});

test('controller raw ignored duplicate API properties deny before frozen verifier deserialization', async () => {
  const f = fixture();
  f.transform = (p, v) => p.endsWith('/pulls/17') ? Buffer.from(JSON.stringify(v).replace(/}$/, ',"ignored":{"id":1,"\\u0069d":2}}')) : v;
  await denied(f);
});

test('controller deadline, clock regression, sensitive provider errors and concurrency deny safely', async () => {
  let ticks = 0;
  await denied(fixture(), {monotonicNow: () => ticks++ === 0 ? 0 : 60000});
  ticks = 0; await denied(fixture(), {monotonicNow: () => ticks++ === 0 ? 10 : 9});
  const failed = await denied(fixture(), {transport: async () => { throw new Error('DO_NOT_LEAK_PRIVATE_BODY'); }});
  assert.ok(!JSON.stringify(failed).includes('DO_NOT_LEAK'));
  const f = fixture(); let release;
  const wait = new Promise(resolve => { release = resolve; });
  const controller = createReadOnlyEvidenceController({...f.options(), broker: async () => { await wait; return raw(f.credential); }});
  const pending = controller(raw(f.request));
  const overlap = await controller(raw(f.request)); assert.deepEqual(overlap.reasons, ['EVALUATION_BUSY']);
  release(); assert.equal((await pending).apiRecords?.status, 'VERIFIED');
});

test('controller imports are offline libraries with frozen core import and no live entrypoint', () => {
  for (const name of ['trusted-evidence-json', 'github-evidence-adapter', 'trusted-policy-release', 'trusted-evidence-controller']) {
    const source = readFileSync(new URL(`../scripts/ci/${name}.mjs`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\b(?:eval|fetch)\s*\(|process\.env|process\.argv|node:(?:http|https|child_process)|createServer\s*\(/);
  }
  const source = readFileSync(new URL('../scripts/ci/trusted-evidence-controller.mjs', import.meta.url), 'utf8');
  assert.match(source, /import \{verifyTrustedPrEvidence\} from '\.\/trusted-pr-evidence\.mjs'/);
});

test('controller process-local repo/PR exclusion spans instances and releases only its own lease', async () => {
  const f = fixture(); let release;
  const wait = new Promise(resolve => { release = resolve; });
  const a = createReadOnlyEvidenceController({...f.options(), broker: async () => { await wait; return raw(f.credential); }});
  const b = createReadOnlyEvidenceController(f.options());
  const pending = a(raw(f.request));
  assert.deepEqual((await b(raw(f.request))).reasons, ['EVALUATION_BUSY']);
  // A failed contender must not free A's lease.
  assert.deepEqual((await b(raw(f.request))).reasons, ['EVALUATION_BUSY']);
  release(); assert.equal((await pending).apiRecords?.status, 'VERIFIED');
  assert.equal((await b(raw(f.request))).apiRecords?.status, 'VERIFIED');
});
