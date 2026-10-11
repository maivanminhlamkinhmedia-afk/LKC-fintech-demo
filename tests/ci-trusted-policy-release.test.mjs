import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync, sign} from 'node:crypto';
import {verifyPolicyRelease, POLICY_DOMAIN, POLICY_LIMITS} from '../scripts/ci/trusted-policy-release.mjs';

// Ephemeral test keys only. No filesystem, secret store or production key.
const keys = generateKeyPairSync('ed25519');
const raw = (v) => Buffer.from(JSON.stringify(v));
const hash = (b) => createHash('sha256').update(b).digest('hex');
function fixture() {
  const p = {schemaVersion: 1, revision: 'a'.repeat(40), epoch: 5, purpose: 'PR_SOURCE_EVIDENCE', event: 'pull_request',
    repository: {id: 101, fullName: 'example/catalog'}, reviewerIds: [22],
    workflow: {id: 33, path: '.github/workflows/ci.yml', requiredJobs: ['validate']}, allowForks: false,
    limits: {...POLICY_LIMITS}, artifacts: {verifierSha256: '1'.repeat(64), adapterSha256: '2'.repeat(64)}};
  const f = {p, publicKeys: new Map([['test-key', keys.publicKey]])};
  f.seal = (bytes = raw(p), domain = POLICY_DOMAIN, privateKey = keys.privateKey) => {
    f.bytes = bytes;
    f.envelope = {schemaVersion: 1, algorithm: 'Ed25519', keyId: 'test-key', digest: hash(bytes),
      signature: sign(null, Buffer.concat([Buffer.from(domain), bytes]), privateKey).toString('base64')};
    f.register = {schemaVersion: 1, repository: p.repository, revision: p.revision, epoch: p.epoch, digest: hash(bytes), registerVersion: 8,
      revocation: {generation: 2, revokedKeyIds: [], revokedDigests: []}, rollbackFloor: {epoch: 4, registerVersion: 7, revocationGeneration: 1}};
  };
  f.seal();
  f.expected = {repository: {id: 101, fullName: 'example/catalog'}, verifierSha256: '1'.repeat(64),
    adapterSha256: '2'.repeat(64), minimumEpoch: 5};
  f.verify = (overrides = {}) => verifyPolicyRelease({policyBytes: f.bytes, envelopeBytes: raw(f.envelope), publicKeys: f.publicKeys,
    readRegister: async () => raw(f.register), expected: f.expected, ...overrides});
  return f;
}

test('policy: Ed25519 raw-byte release plus consistent trusted register, immutable subsets', async () => {
  const f = fixture(), release = await f.verify();
  assert.equal(release.controllerPolicy.digest, hash(f.bytes));
  assert.equal(release.controllerPolicy.event, 'pull_request');
  assert.deepEqual(release.libraryPolicy.reviewerIds, [22]);
  assert.ok(Object.isFrozen(release.libraryPolicy.workflow.requiredJobs));
  assert.equal(await release.recheck(), true);
  assert.throws(() => { release.libraryPolicy.allowForks = true; }, TypeError);
});

for (const [label, mutate, code] of [
  ['digest', f => f.envelope.digest = '0'.repeat(64), 'POLICY_DIGEST_MISMATCH'],
  ['raw whitespace tamper', f => f.bytes = Buffer.concat([f.bytes, Buffer.from(' ')]), 'POLICY_DIGEST_MISMATCH'],
  ['wrong domain', f => f.seal(raw(f.p), 'OTHER/v1\0'), 'POLICY_SIGNATURE_INVALID'],
  ['missing domain terminator', f => f.seal(raw(f.p), 'LKC-G1C-POLICY/v1'), 'POLICY_SIGNATURE_INVALID'],
  ['wrong signing key', f => f.seal(raw(f.p), POLICY_DOMAIN, generateKeyPairSync('ed25519').privateKey), 'POLICY_SIGNATURE_INVALID'],
  ['untrusted key', f => f.publicKeys.clear(), 'POLICY_KEY_UNTRUSTED'],
  ['private key as trust root', f => f.publicKeys.set('test-key', keys.privateKey), 'POLICY_KEY_INVALID'],
  ['unsigned', f => delete f.envelope.signature, 'POLICY_ENVELOPE_INVALID'],
  ['bad base64', f => f.envelope.signature += '\n', 'POLICY_SIGNATURE_INVALID'],
  ['wrong algorithm', f => f.envelope.algorithm = 'none', 'POLICY_ENVELOPE_INVALID'],
  ['schema', f => { f.p.schemaVersion = 2; f.seal(); }, 'POLICY_SCHEMA_INVALID'],
  ['fork opt-in', f => { f.p.allowForks = true; f.seal(); }, 'POLICY_SCHEMA_INVALID'],
  ['event substitution', f => { f.p.event = 'workflow_dispatch'; f.seal(); }, 'POLICY_SCHEMA_INVALID'],
  ['repository', f => { f.p.repository.id++; f.seal(); }, 'POLICY_REPOSITORY_MISMATCH'],
  ['artifact pin', f => { f.p.artifacts.adapterSha256 = '9'.repeat(64); f.seal(); }, 'POLICY_MATERIAL_MISMATCH'],
  ['bounds', f => { f.p.limits.evaluationTimeoutMs++; f.seal(); }, 'POLICY_LIMIT_MISMATCH'],
  ['self-provided key root', f => { f.p.publicKeys = {}; f.seal(); }, 'POLICY_SCHEMA_INVALID'],
  ['duplicate reviewer', f => { f.p.reviewerIds = [22, 22]; f.seal(); }, 'POLICY_RULES_INVALID'],
]) test(`policy denial: ${label}`, async () => {
  const f = fixture(); mutate(f); await assert.rejects(f.verify(), e => e.code === code);
});

test('policy exact raw-byte signature remains valid with intentionally signed whitespace', async () => {
  const f = fixture(); f.seal(Buffer.from(JSON.stringify(f.p, null, 2)));
  assert.equal(await (await f.verify()).recheck(), true);
});

test('policy signed duplicate payload/envelope rejected before interpretation', async () => {
  const f = fixture(); f.seal(Buffer.from(JSON.stringify(f.p).replace('"epoch":5', '"epoch":4,"\\u0065poch":5')));
  const original = JSON.parse; let called = 0;
  JSON.parse = (...args) => { called++; return original(...args); };
  try { await assert.rejects(f.verify(), /JSON_DUPLICATE_KEY/); assert.equal(called, 0); }
  finally { JSON.parse = original; }
  const g = fixture();
  await assert.rejects(g.verify({envelopeBytes: Buffer.from(JSON.stringify(g.envelope).replace('"keyId":"test-key"', '"keyId":"test-key","keyId":"test-key"'))}), /JSON_DUPLICATE_KEY/);
});

for (const [label, mutate, code] of [
  ['revision', r => r.revision = 'b'.repeat(40), 'POLICY_REGISTER_MISMATCH'],
  ['epoch', r => r.epoch++, 'POLICY_REGISTER_MISMATCH'],
  ['digest', r => r.digest = '0'.repeat(64), 'POLICY_REGISTER_MISMATCH'],
  ['missing generation', r => delete r.revocation.generation, 'POLICY_REVOCATION_INVALID'],
  ['revoked key', r => r.revocation.revokedKeyIds.push('test-key'), 'POLICY_REVOKED'],
  ['revoked digest', r => r.revocation.revokedDigests.push(r.digest), 'POLICY_REVOKED'],
  ['missing floor', r => delete r.rollbackFloor, 'POLICY_REGISTER_MISMATCH'],
  ['lower epoch than floor', r => r.rollbackFloor.epoch = 6, 'POLICY_ROLLBACK_FLOOR'],
  ['lower revision than floor', r => r.rollbackFloor.registerVersion = 9, 'POLICY_ROLLBACK_FLOOR'],
  ['revocation rollback', r => r.rollbackFloor.revocationGeneration = 3, 'POLICY_ROLLBACK_FLOOR'],
]) test(`register denial: ${label}`, async () => {
  const f = fixture(); mutate(f.register); await assert.rejects(f.verify(), e => e.code === code);
});

test('policy register initial/final revision, floor, epoch, revocation and digest drift deny', async () => {
  for (const mutate of [r => r.registerVersion++, r => r.rollbackFloor.epoch++, r => r.revocation.generation++,
    r => r.revision = 'b'.repeat(40), r => r.digest = '0'.repeat(64), r => r.epoch++, r => r.revocation.revokedKeyIds.push('test-key')]) {
    const f = fixture(), release = await f.verify(); mutate(f.register);
    await assert.rejects(release.recheck());
  }
});

test('higher approved epoch can describe rollback, never unsigned floor bypass', async () => {
  const f = fixture(); f.p.epoch = 9; f.p.revision = 'b'.repeat(40); f.seal();
  f.register.rollbackFloor.epoch = 8;
  assert.equal(await (await f.verify()).recheck(), true);
});

test('G1C2-N1 replay: previously valid signed policy cannot survive consistently stale register below independent pin', async () => {
  const f = fixture(), originalBytes = Buffer.from(f.bytes), originalEnvelope = raw(f.envelope);
  assert.equal(await (await f.verify()).recheck(), true); // Epoch 5 was valid before the protected pin advanced.
  const stale = raw(f.register), observations = [stale, Buffer.from(stale)];
  assert.deepEqual(observations[0], observations[1]); // A mutable register can agree with itself after rollback.
  let reads = 0;
  await assert.rejects(f.verify({expected: {...f.expected, minimumEpoch: 6},
    readRegister: async () => observations[reads++]}).then(release => release.recheck()), /POLICY_ROLLBACK_FLOOR/);
  assert.equal(reads, 0); // Independent pin rejects replay before consulting the compromised register.
  assert.deepEqual(f.bytes, originalBytes); assert.deepEqual(raw(f.envelope), originalEnvelope);
});

test('G1C2-N1 missing, malformed, unverifiable or contradictory independent floors fail closed', async () => {
  for (const minimumEpoch of [undefined, null, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1,
    '5', {epoch: 5, verified: true}, 6]) {
    const f = fixture(); let reads = 0;
    await assert.rejects(f.verify({expected: {...f.expected, minimumEpoch},
      readRegister: async () => { reads++; return raw(f.register); }}), /POLICY_ROLLBACK_FLOOR/);
    assert.equal(reads, 0);
  }
  const f = fixture(), expected = {...f.expected}; delete expected.minimumEpoch;
  await assert.rejects(f.verify({expected}), /POLICY_ROLLBACK_FLOOR/);
});

test('G1C2-N1 legitimate newer signed policy meets independently pinned floor; register checks still run twice', async () => {
  const f = fixture(); f.p.epoch = 6; f.p.revision = 'b'.repeat(40); f.seal();
  let reads = 0;
  const release = await f.verify({expected: {...f.expected, minimumEpoch: 6},
    readRegister: async () => { reads++; return raw(f.register); }});
  assert.equal(release.controllerPolicy.epoch, 6); assert.equal(await release.recheck(), true); assert.equal(reads, 2);
});

test('G1C2-N1 signed payload or register claims cannot supply the missing protected pin', async () => {
  const f = fixture(); f.p.minimumEpoch = 1; f.seal();
  await assert.rejects(f.verify(), /POLICY_SCHEMA_INVALID/);
  const g = fixture(); g.register.minimumEpoch = 1;
  await assert.rejects(g.verify(), /POLICY_REGISTER_MISMATCH/);
  delete g.register.minimumEpoch;
  g.register.rollbackFloor.epoch = 1;
  await assert.rejects(g.verify({expected: {...g.expected, minimumEpoch: undefined}}), /POLICY_ROLLBACK_FLOOR/);
});

test('register unavailable, malformed, duplicate, missing or cancelled is not evidence', async () => {
  for (const provider of [undefined, async () => { throw new Error('sensitive-private-register'); },
    async () => Buffer.from('{'), async () => Buffer.from('{"epoch":1,"epoch":2}'), async () => ({epoch: 5})]) {
    await assert.rejects(fixture().verify({readRegister: provider}), e => !e.message.includes('sensitive'));
  }
  await assert.rejects(fixture().verify({signal: AbortSignal.abort()}), /POLICY_REGISTER_UNAVAILABLE/);
});
