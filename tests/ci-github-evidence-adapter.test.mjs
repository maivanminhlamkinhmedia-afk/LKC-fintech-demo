import test from 'node:test';
import assert from 'node:assert/strict';
import {openGitHubEvidenceAdapter} from '../scripts/ci/github-evidence-adapter.mjs';
import {EvidenceInputError} from '../scripts/ci/trusted-evidence-json.mjs';

const raw = (v) => Buffer.from(JSON.stringify(v));
function fixture() {
  const bootstrap = {appId: 10, installationId: 20, accountId: 30, repository: {id: 101, fullName: 'example/catalog'}};
  const credential = {...bootstrap, schemaVersion: 1, scopeVerified: true, token: 'synthetic_test_token_only', issuedAt: 1000, expiresAt: 60000,
    permissions: {metadata: 'read', actions: 'read', pull_requests: 'read', contents: 'read'}};
  const calls = [], f = {bootstrap, credential, calls, now: 2000, body: raw({id: 101, full_name: 'example/catalog'}),
    status: 200, headers: {'content-type': 'application/json; charset=utf-8'}};
  f.transport = async (request) => {
    calls.push(request);
    return {status: f.status, headers: f.headers, body: f.body};
  };
  f.options = () => ({executionMode: 'OFFLINE_SYNTHETIC', bootstrapJson: raw(bootstrap), broker: async () => raw(credential),
    transport: f.transport, now: () => f.now});
  f.open = (overrides = {}) => openGitHubEvidenceAdapter({...f.options(), ...overrides});
  return f;
}

test('adapter: synthetic scope evidence plus API repository ID required; GET-only fixed origin', async () => {
  const f = fixture(), port = await f.open();
  assert.equal(f.calls.length, 1);
  for (const path of ['/repos/example/catalog', '/repos/example/catalog/pulls/17',
    '/repos/example/catalog/pulls/17/reviews?per_page=100&page=10', '/repos/example/catalog/actions/runs/900/attempts/2',
    '/repos/example/catalog/actions/runs/900/attempts/2/jobs?per_page=100&page=2',
    '/repos/example/catalog/actions/workflows/33/runs?head_sha=' + 'a'.repeat(40) + '&event=pull_request&per_page=100&page=1',
    '/repos/example/catalog/git/commits/' + 'c'.repeat(40)]) {
    await port.readGitHub({method: 'GET', path});
  }
  for (const call of f.calls) {
    assert.equal(call.method, 'GET'); assert.ok(call.url.startsWith('https://api.github.com/repos/example/catalog'));
    assert.equal(call.headers['X-GitHub-Api-Version'], '2022-11-28'); assert.equal(call.headers['Accept-Encoding'], 'identity');
    assert.ok(call.signal instanceof AbortSignal); assert.ok(Object.isFrozen(call));
  }
});

for (const [label, change, code] of [
  ['app', f => f.credential.appId++, 'BROKER_IDENTITY_MISMATCH'],
  ['installation', f => f.credential.installationId++, 'BROKER_IDENTITY_MISMATCH'],
  ['account', f => f.credential.accountId++, 'BROKER_IDENTITY_MISMATCH'],
  ['repository', f => f.credential.repository = {id: 999, fullName: 'example/catalog'}, 'BROKER_IDENTITY_MISMATCH'],
  ['scope missing', f => delete f.credential.scopeVerified, 'BROKER_IDENTITY_MISMATCH'],
  ['insufficient permissions', f => delete f.credential.permissions.actions, 'BROKER_PERMISSION_MISMATCH'],
  ['write permission', f => f.credential.permissions.contents = 'write', 'BROKER_PERMISSION_MISMATCH'],
  ['excess permission', f => f.credential.permissions.administration = 'read', 'BROKER_PERMISSION_MISMATCH'],
  ['expired', f => f.now = 60000, 'BROKER_CREDENTIAL_EXPIRED'],
  ['not yet issued', f => f.now = 999, 'BROKER_CREDENTIAL_EXPIRED'],
  ['repository API ID', f => f.body = raw({id: 999, full_name: 'example/catalog'}), 'REPOSITORY_IDENTITY_MISMATCH'],
  ['repository API name', f => f.body = raw({id: 101, full_name: 'other/repository'}), 'REPOSITORY_IDENTITY_MISMATCH'],
]) test(`adapter fail closed: ${label}`, async () => {
  const f = fixture(); change(f); await assert.rejects(f.open(), (e) => e.code === code);
});

test('adapter requires protected capabilities; no anonymous/live fallback', async () => {
  for (const overrides of [{broker: undefined}, {transport: undefined}, {executionMode: 'LIVE'}, {broker: {authenticated: true}},
    {bootstrapJson: raw({appId: 0})}]) await assert.rejects(fixture().open(overrides));
  assert.equal(fixture().calls.length, 0);
});

test('adapter rejects every non-template endpoint without invoking transport', async () => {
  const f = fixture(), port = await f.open();
  for (const path of ['https://evil.invalid/', '/repos/other/repo', '/repos/example/catalogue', '/repos/example/catalog/../secrets',
    '/repos/example/catalog/%2e%2e', '/repos/example/catalog#frag', '/repos/example/catalog\\pulls\\17',
    '/repos/example/catalog/pulls/17?token=secret', '/repos/example/catalog/pulls/17/reviews?per_page=100&page=11',
    '/repos/example/catalog/actions/workflows/33/runs?head_sha=' + 'a'.repeat(40) + '&event=workflow_dispatch&per_page=100&page=1']) {
    await assert.rejects(port.readGitHub({method: 'GET', path}), /ENDPOINT_FORBIDDEN/);
  }
  await assert.rejects(port.readGitHub({method: 'POST', path: '/repos/example/catalog'}), /ENDPOINT_FORBIDDEN/);
  assert.equal(f.calls.length, 1);
});

for (const status of [301, 302, 401, 403, 404, 429, 500]) test(`adapter HTTP ${status} denies with no retry/redirect`, async () => {
  const f = fixture(); f.status = status;
  await assert.rejects(f.open(), status === 429 ? /API_RATE_LIMITED/ : /API_HTTP_DENIED/);
  assert.equal(f.calls.length, 1);
});

test('adapter rejects compression, non-JSON, parsed SDK objects, malformed and duplicate raw responses', async () => {
  for (const mutate of [f => f.headers['content-encoding'] = 'gzip', f => f.headers['content-type'] = 'text/html',
    f => f.body = {id: 101}, f => f.body = Buffer.from('{'), f => f.body = Buffer.from('{"id":999,"id":101,"full_name":"example/catalog"}'),
    f => f.body = Buffer.alloc(1048577)]) {
    const f = fixture(); mutate(f); await assert.rejects(f.open());
  }
});

test('adapter broker/API getter failures and sensitive errors are mapped without leaks', async () => {
  const f = fixture();
  for (const overrides of [
    {broker: async () => { throw new Error('private-key-secret'); }},
    {transport: async () => { throw new Error('synthetic_test_token_only'); }},
    {transport: async () => ({get status() { throw new Error('private-body'); }})},
  ]) {
    await assert.rejects(f.open(overrides), e => !/secret|token_only|private-body/.test(e.message));
  }
});

test('adapter rechecks credential expiry and repository identity on subsequent reads', async () => {
  const f = fixture(), port = await f.open();
  f.now = f.credential.expiresAt;
  await assert.rejects(port.readGitHub({method: 'GET', path: '/repos/example/catalog'}), /BROKER_CREDENTIAL_EXPIRED/);
  f.now = 2000; f.body = raw({id: 999, full_name: 'example/catalog'});
  await assert.rejects(port.readGitHub({method: 'GET', path: '/repos/example/catalog'}), /REPOSITORY_IDENTITY_MISMATCH/);
});

test('adapter cancellation interrupts stalled body and never retries', async () => {
  const f = fixture(), abort = new AbortController();
  f.body = (async function* () { yield Buffer.from('{'); await new Promise(() => {}); })();
  const pending = f.open({signal: abort.signal});
  setImmediate(() => abort.abort());
  await assert.rejects(pending, /ADAPTER_ABORTED/); assert.equal(f.calls.length, 1);
});

test('adapter safe-code containment and hostile request getter', async () => {
  const f = fixture(), port = await f.open();
  await assert.rejects(port.readGitHub({get path() { throw new Error('DO_NOT_LEAK'); }}), /API_UNAVAILABLE/);
  await assert.rejects(f.open({broker: async () => { throw new EvidenceInputError('DO_NOT_LEAK'); }}), /EVIDENCE_INVALID/);
});

test('adapter timeout cancels a stalled synthetic broker without issuing a request', async () => {
  const f = fixture(); let brokerSignal;
  await assert.rejects(f.open({broker: async ({signal}) => { brokerSignal = signal; return new Promise(() => {}); }}), /ADAPTER_ABORTED/);
  assert.equal(brokerSignal.aborted, true); assert.equal(f.calls.length, 0);
});
