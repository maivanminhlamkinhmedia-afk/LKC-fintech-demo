import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Script, createContext } from 'node:vm';
import { inspectAuthorityClaims, verifyTrustedAuthority } from '../scripts/cms-w0-db-validation/trusted-authority.mjs';

// Synthetic untrusted claims only. No GitHub/approval/service response is mocked
// into a successful authority decision, and no DB or network is contacted.
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const source = read('scripts/cms-w0-db-validation/trusted-authority.mjs');
const workflow = read('.github/workflows/cms-w0-mariadb-validation.yml').replaceAll('\r\n', '\n');
const candidate = '3097500b23a63922e839d49e411438a66c90ea16';
const application = '5321f28673eeee11ed8f913c78c7cdcb38896f9e';
const repo = 'maivanminhlamkinhmedia-afk/LKC-fintech-demo';
const workflowPath = '.github/workflows/cms-w0-mariadb-validation.yml';
const blob = '497c0ab37e7c5e5c4c174d6008b7ff3eb9e4b881';
const canonical = v => v !== null && typeof v === 'object'
  ? Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
    : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  : JSON.stringify(v);
function claims() {
  return {
    identity: { repository: repo, candidateSha: candidate, applicationSha: application,
      workflowCommit: candidate, workflowPath, workflowBlob: blob,
      workflowPayloadSha256: '61d2a74114f4a0bd20792ac69d3d6d973da551bbd833d2e0bf1fa92d41753088',
      workflowPayloadBase64: Buffer.from(workflow).toString('base64') },
    run: { id: '1234', jobId: '5678', attempt: 1, event: 'pull_request', action: 'labeled', pr: 70,
      headRepository: repo, baseRepository: repo, headBranch: 'test/cms-w0-mariadb-validation',
      baseBranch: 'feature/cms-access-001a-draft-writer-foundation', headSha: candidate, baseSha: application,
      checkoutSha: candidate, workflowRef: `${repo}/${workflowPath}@${candidate}`, label: `w0-db-${candidate}`, createdAt: 200 },
    approval: { id: '10', operatorId: '11', reviewerId: '12', environmentId: '13', protected: true,
      approved: true, runId: '1234', attempt: 1, candidateSha: candidate, workflowBlob: blob, issuedAt: 100, expiresAt: 300 },
    service: { runId: '1234', jobId: '5678', attempt: 1, serviceId: 'a'.repeat(64), jobContainerId: 'b'.repeat(64),
      networkId: 'c'.repeat(64), host: 'mariadb', port: 3306, platform: 'linux/amd64',
      nodeImage: 'sha256:c4d5523090a817b7aa86d2111241fdd4f66d1e27782b44160e6aa63b357ecb2d',
      mariadbImage: 'sha256:3a7d3cbc8b6fddf66433d80dc124c1e4e75a73ebab9c6e137529cc270bdadfc0',
      publishedPorts: [], mounts: [], disposable: true, syntheticOnly: true },
    replay: { requestId: 'd'.repeat(64), runId: '1234', attempt: 1, approvalId: '10', state: 'UNCONSUMED' },
  };
}
function denied(value, expectedCode) {
  const output = verifyTrustedAuthority(value);
  assert.equal(output.status, 'TECHNICAL_AUTHORITY_BLOCKED');
  assert.equal(output.executionAuthorized, false);
  assert.equal(output.authenticated, false);
  if (expectedCode) assert.equal(output.code, expectedCode);
  assert.ok(Object.isFrozen(output));
  assert.ok(Object.isFrozen(output.blockers));
  return output;
}
function changed(edit, code) {
  const value = claims(); edit(value);
  const output = denied(canonical(value), code);
  assert.equal(output.claimsConsistent, false);
}

test('complete matching claims remain untrusted; no capability or approval is issued', () => {
  const output = denied(canonical(claims()), 'CLAIMS_CONSISTENT_BUT_UNTRUSTED');
  assert.equal(output.claimsConsistent, true);
  assert.deepEqual(Object.keys(output).sort(), ['authenticated', 'blockers', 'claimsConsistent', 'code', 'executionAuthorized', 'status']);
  assert.equal(output.blockers.length, 7);
});
test('missing authority, arbitrary object and caller callbacks are denied without traversal', () => {
  for (const input of [undefined, null, {}, () => true, 'null', '{}']) denied(input);
  let accessed = 0;
  const hostile = new Proxy({}, { get() { accessed++; throw new Error('secret'); }, ownKeys() { accessed++; throw new Error('secret'); } });
  denied(hostile);
  denied({ get approval() { accessed++; throw new Error('secret'); } });
  assert.equal(accessed, 0);
});
test('malformed, oversized, deep and duplicate-key evidence is refused', () => {
  for (const input of ['{', ' '.repeat(65537), '['.repeat(20) + '0' + ']'.repeat(20), '{"a":1,"a":1}', JSON.stringify(claims())]) {
    denied(input, 'EVIDENCE_FORMAT_REFUSED');
  }
});
test('unknown fields, supplied signature, key and REAL_DRIVER cannot establish trust', () => {
  for (const extra of [{ signature: 'forged' }, { publicKey: 'caller-key' }, { source: 'REAL_DRIVER' }, { approved: true }]) {
    denied(canonical({ ...claims(), ...extra }), 'EVIDENCE_FORMAT_REFUSED');
  }
});
test('source, application and workflow commits are independently pinned', () => {
  for (const field of ['candidateSha', 'applicationSha', 'workflowCommit']) {
    changed(v => { v.identity[field] = 'e'.repeat(40); }, 'SOURCE_IDENTITY_REFUSED');
  }
});
test('workflow path traversal, wrong repository, blob and payload digest are refused', () => {
  for (const [field, val] of [['workflowPath', '../deploy.yml'], ['repository', 'attacker/repo'], ['workflowBlob', 'a'.repeat(40)], ['workflowPayloadSha256', 'b'.repeat(64)]]) {
    changed(v => { v.identity[field] = val; }, 'SOURCE_IDENTITY_REFUSED');
  }
});
test('workflow exact bytes: changed content, CRLF and noncanonical base64 fail', () => {
  for (const value of [workflow + '\n', workflow.replaceAll('\n', '\r\n'), workflow.replace('false &&', 'true &&')]) {
    changed(v => { v.identity.workflowPayloadBase64 = Buffer.from(value).toString('base64'); }, 'WORKFLOW_BYTES_REFUSED');
  }
  changed(v => { v.identity.workflowPayloadBase64 += '\n'; }, 'WORKFLOW_BYTES_REFUSED');
});
test('fork, wrong base, wrong branch, PR, event and synthetic merge checkout fail', () => {
  const cases = { headRepository: 'attacker/repo', baseRepository: 'attacker/repo', baseSha: 'a'.repeat(40),
    headSha: 'a'.repeat(40), checkoutSha: 'f'.repeat(40), headBranch: 'main', baseBranch: 'main',
    pr: 71, event: 'workflow_dispatch', action: 'opened', label: 'approved', workflowRef: `${repo}/${workflowPath}@main` };
  for (const [field, val] of Object.entries(cases)) changed(v => { v.run[field] = val; }, 'RUN_IDENTITY_REFUSED');
});
test('rerun attempt, missing job/run identity and unsafe integers fail', () => {
  for (const attempt of [0, 2, '1', null]) changed(v => { v.run.attempt = attempt; }, 'RUN_IDENTITY_REFUSED');
  for (const field of ['id', 'jobId']) changed(v => { v.run[field] = '0'; }, 'RUN_IDENTITY_REFUSED');
  changed(v => { v.run.createdAt = Number.MAX_SAFE_INTEGER + 1; }, 'RUN_IDENTITY_REFUSED');
});
test('forged protected environment and reviewer claims never authenticate', () => {
  const output = denied(canonical(claims()));
  assert.ok(output.blockers.includes('TRUSTED_OPERATOR_APPROVAL_MISSING'));
  for (const [field, val] of [['protected', false], ['approved', false], ['reviewerId', '11'], ['environmentId', ''], ['candidateSha', 'f'.repeat(40)], ['workflowBlob', 'f'.repeat(40)], ['runId', '999'], ['attempt', 2]]) {
    changed(v => { v.approval[field] = val; }, 'APPROVAL_CLAIM_REFUSED');
  }
});
test('expired/not-yet-valid approval claims fail; current freshness remains unverified', () => {
  changed(v => { v.approval.expiresAt = 200; }, 'APPROVAL_CLAIM_REFUSED');
  changed(v => { v.approval.issuedAt = 201; }, 'APPROVAL_CLAIM_REFUSED');
  assert.ok(denied(canonical(claims())).blockers.includes('TRUSTED_CLOCK_MISSING'));
});
test('service must bind run/job/attempt, distinct containers and network', () => {
  for (const [field, val] of [['runId', '999'], ['jobId', '999'], ['attempt', 2], ['serviceId', '0'.repeat(64)], ['jobContainerId', 'a'.repeat(64)], ['networkId', '']]) {
    changed(v => { v.service[field] = val; }, 'SERVICE_CLAIM_REFUSED');
  }
});
test('external DB, ports, mounts, image/platform drift or non-synthetic target fail', () => {
  for (const [field, val] of [['host', 'production.invalid'], ['port', 3307], ['platform', 'linux/arm64'], ['mariadbImage', 'mariadb:latest'], ['nodeImage', 'node:22'], ['publishedPorts', [3306]], ['mounts', ['/var/run/docker.sock']], ['disposable', false], ['syntheticOnly', false]]) {
    changed(v => { v.service[field] = val; }, 'SERVICE_CLAIM_REFUSED');
  }
});
test('valid-looking service identity is not service/platform attestation', () => {
  const output = denied(canonical(claims()));
  assert.ok(output.blockers.includes('TRUSTED_SERVICE_ATTESTATION_MISSING'));
  assert.ok(output.blockers.includes('IMAGE_PLATFORM_ATTESTATION_MISSING'));
});
test('consumed, lost-ACK, missing or inconsistent replay records fail closed', () => {
  for (const [field, val] of [['state', 'CONSUMED'], ['state', 'UNKNOWN_OUTCOME'], ['runId', '999'], ['attempt', 2], ['approvalId', '999'], ['requestId', '']]) {
    changed(v => { v.replay[field] = val; }, 'REPLAY_CLAIM_REFUSED');
  }
  changed(v => { delete v.replay.state; }, 'REPLAY_CLAIM_REFUSED');
});
test('repeated requests and new forged request IDs never mint a single-use permit', () => {
  const input = canonical(claims());
  assert.deepEqual(denied(input), denied(input));
  const modified = claims(); modified.replay.requestId = 'e'.repeat(64);
  assert.ok(denied(canonical(modified)).blockers.includes('ATOMIC_SINGLE_USE_AUTHORITY_MISSING'));
});
test('safe output never echoes secret-bearing unknown fields or parse failures', () => {
  const secret = 'canary-password-session-private-key';
  for (const input of [secret, canonical({ ...claims(), secret }), canonical({ identity: secret })]) {
    assert.ok(!JSON.stringify(denied(input)).includes(secret));
  }
});
test('validation is deterministic and leaves input, process environment and time untouched', () => {
  const value = claims(), before = canonical(value);
  for (let i = 0; i < 3; i++) denied(before);
  assert.equal(canonical(value), before);
  assert.equal(inspectAuthorityClaims(before).executionAuthorized, false);
});

// Import/evaluation audit: exact module body with only the single verified static
// crypto import and two export keywords transformed for vm.Script. This is not an
// OS sandbox or a genuine GitHub service attestation. Real ESM import above also runs.
function audit(extra = '') {
  const importLine = "import { createHash } from 'node:crypto';";
  assert.equal(source.split(importLine).length, 2);
  assert.equal((source.match(/^import /gm) ?? []).length, 1);
  assert.equal((source.match(/^export function /gm) ?? []).length, 2);
  const body = source.replace(importLine, '').replaceAll('export function ', 'function ');
  const sandbox = { createHash, Buffer, input: canonical(claims()) };
  const context = createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  new Script(`
    for (const key of ['process', 'fetch', 'require', 'Date', 'setTimeout', 'setInterval', 'console']) {
      Object.defineProperty(globalThis, key, { get() { throw new Error('SIDE_EFFECT_REFUSED'); } });
    }
    Math.random = () => { throw new Error('RANDOM_REFUSED'); };
  `).runInContext(context);
  return new Script(`${body}\n${extra}\nJSON.stringify(verifyTrustedAuthority(input));`).runInContext(context, { timeout: 1000 });
}
test('isolated module evaluation and verification need only hashing, no env/network/process/time', () => {
  const output = JSON.parse(audit());
  assert.equal(output.claimsConsistent, true);
  assert.equal(output.executionAuthorized, false);
});
for (const [name, expression] of [['environment approval', 'process.env.W0_APPROVED'], ['network', 'fetch("https://invalid.invalid")'], ['filesystem', 'require("node:fs")'], ['subprocess', 'process.execPath'], ['clock', 'Date.now()'], ['randomness', 'Math.random()']]) {
  test(`audit negative control blocks ${name}`, () => assert.throws(() => audit(expression), /SIDE_EFFECT_REFUSED|RANDOM_REFUSED/));
}
test('all eight reviewed files remain at frozen Git payload identities', () => {
  const expected = {
    '.github/workflows/cms-w0-mariadb-validation.yml': blob,
    'scripts/cms-w0-db-validation/run.mjs': '53c1c072fc23a8a00a0caaacc2681a9a3e7c43b1',
    'scripts/cms-w0-db-validation/fixture-plan.mjs': '9448105522b5237341de445ae49e12af7e57d11a',
    'scripts/cms-w0-db-validation/action-bridge.mjs': '358238ebb444abe5c828dfb463cc6823dd351f91',
    'scripts/cms-w0-db-validation/evidence.mjs': '2b129af5395e07f7c0c1d7e0f390403a3af4edec',
    'tests/cms-w0-db-validation-safety.test.mjs': 'ecc27662503c8540b70fb69f6c8a14c4f06cb218',
    'tests/cms-w0-db-validation-runtime.test.mjs': 'c5751e0cb1815bb8c2d895bf4608a3d3aeb7ae43',
    'docs/cms/operations/cms-w0-db-validation.md': 'f7e3aaf681120f1ea2eab9bc061ed805edc9cbae',
  };
  for (const [path, expectedBlob] of Object.entries(expected)) {
    const bytes = Buffer.from(read(path).replaceAll('\r\n', '\n'));
    const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(actual, expectedBlob, path);
  }
});
test('workflow false/zero and runtime null/hard-fail execution locks remain present', () => {
  assert.ok(workflow.includes('false &&'));
  assert.ok(workflow.includes("head.sha == '0000000000000000000000000000000000000000'"));
  const runner = read('scripts/cms-w0-db-validation/run.mjs');
  assert.match(runner, /export const EXECUTION_GRANT = null;/);
  assert.match(runner, /if \(EXECUTION_GRANT === null\) fail\('W0_EXECUTION_HOLD'\);/);
  assert.match(runner, /fail\('W0_TRUSTED_AUTHORITY_BRIDGE_REQUIRED'\);/);
});
