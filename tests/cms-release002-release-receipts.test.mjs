import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineReceiptValidator, fingerprintReceipt, RECEIPT_KINDS } from '../scripts/cms-deploy/release002/release-receipts.mjs';

const hash = c => c.repeat(64);
const clone = value => JSON.parse(JSON.stringify(value)); // synthetic fixture builder, NOT a runtime raw-JSON API
const proof = () => ({ source: 'CMS_OWNER_OR_OPERATOR_SYNTHETIC', verification: 'VERIFIED_SYNTHETIC', evidenceRef: 'synthetic-evidence' });
const allRisks = ['CPU', 'MEMORY', 'IO', 'CONNECTIONS', 'ADMINISTRATION', 'BACKUP_RESTORE'];
function fixture() {
  const contract = { version: 1, repository: { id: 42, fullName: 'synthetic-owner/synthetic-repository' },
    toolingSourceSha: '1'.repeat(40),
    application: { sourceSha: '2'.repeat(40), artifactSha256: hash('a'), manifestSha256: hash('b'), releaseId: 'synthetic-next' },
    target: { id: 'synthetic-staging', environment: 'STAGING', accountId: 'synthetic-account',
      databaseFingerprint: hash('c'), instanceFingerprint: hash('d') },
    operation: { id: 'synthetic-operation', phase: 'NOT_STARTED', journalStatus: 'VERIFIED_SYNTHETIC',
      currentReleaseId: 'synthetic-prior', expectedPreviousReleaseId: 'synthetic-prior' },
    database: { engine: 'MARIADB', serverVersion: '10.11.8', prismaVersion: '7.8.0', adapterVersion: '7.8.0',
      baselineSchemaSha256: hash('1'), baselineHistorySha256: hash('2'), schemaSha256: hash('3'),
      historySha256: hash('4'), migrationsSha256: hash('5') } };
  const binding = { repository: contract.repository, application: contract.application,
    target: contract.target, operationId: contract.operation.id };
  const isolation = { instanceFingerprint: contract.target.instanceFingerprint,
    databaseFingerprint: contract.target.databaseFingerprint, targetId: contract.target.id,
    environment: 'STAGING', sharedWithProduction: 'FALSE', provenance: proof(),
    observedAt: 900, validUntil: 1800, limitations: [], resourceRisks: [], riskAcceptanceRef: null };
  const db = { engine: 'MARIADB', serverVersion: '10.11.8', prismaVersion: '7.8.0', adapterVersion: '7.8.0',
    schemaSha256: hash('3'), historySha256: hash('4'), migrationsSha256: hash('5') };
  const pass = fields => Object.fromEntries(fields.map(k => [k, 'PASS_SYNTHETIC']));
  const data = [
    { engine: 'MARIADB', serverVersion: '10.11.8', prismaVersion: '7.8.0', adapterVersion: '7.8.0',
      schemaSha256: hash('1'), historySha256: hash('2'), instanceIsolation: isolation },
    { ...db, rehearsalTarget: { id: 'synthetic-disposable', environment: 'DISPOSABLE',
      databaseFingerprint: hash('e'), instanceFingerprint: hash('f') },
    checks: pass(['legacy', 'compositeFk', 'restrict', 'mixedVersion', 'partialApplyRecovery', 'restore']) },
    { ...db, migrationState: 'COMPLETE', instanceIsolation: isolation,
      writerLease: { id: 'synthetic-lease', operationId: contract.operation.id, exclusive: true, expiresAt: 1800 },
      compatibility: pass(['legacy', 'newAppNewSchema', 'oldAppNewSchema', 'oldAppNewData']) },
    { backupId: 'synthetic-backup', sha256: hash('6'), components: ['DATABASE', 'MEDIA', 'CONFIG', 'PREVIOUS_APP'],
      restoreProofRef: 'synthetic-restore', restoreStatus: 'PASS_SYNTHETIC', previousReleaseId: 'synthetic-prior' },
    { purpose: 'OFFLINE_CONTRACT_EVALUATION', previousReleaseId: 'synthetic-prior', approvedReceiptPins: [] },
  ];
  const receipts = RECEIPT_KINDS.map((kind, i) => ({ version: 1, id: `synthetic-receipt-${i}`, kind,
    issuerId: i === 4 ? 'synthetic-authority' : 'synthetic-operator', authorityRevision: 'synthetic-policy-v1',
    epoch: 5, issuedAt: 950, observedAt: 900, expiresAt: 2000, revoked: false,
    provenance: proof(), binding: clone(binding), data: clone(data[i]) }));
  const config = { mode: 'OFFLINE_SYNTHETIC', provenance: 'INDEPENDENT_SYNTHETIC_FIXTURE', contract,
    now: 1000, minimumEpoch: 5, authorityRevision: 'synthetic-policy-v1',
    issuers: [{ id: 'synthetic-operator', role: 'DB_OPERATOR' }, { id: 'synthetic-authority', role: 'RELEASE_AUTHORITY' }],
    pins: [], revokedReceiptIds: [], consumedReceiptIds: [], consumedOperationIds: [], riskAcceptances: [] };
  return pin({ config, receipts });
}
function pin(f) {
  const approval = f.receipts.find(r => r.kind === 'RELEASE_AUTHORIZATION');
  if (approval) approval.data.approvedReceiptPins = f.receipts.filter(r => r !== approval)
    .map(r => ({ id: r.id, sha256: fingerprintReceipt(r).sha256 }));
  f.config.pins = f.receipts.map(r => ({ id: r.id, kind: r.kind, issuerId: r.issuerId, sha256: fingerprintReceipt(r).sha256 }));
  return f;
}
const run = f => createOfflineReceiptValidator(f.config)({ receipts: f.receipts });
function assertHold(result) {
  assert.equal(result.status, 'NOT_VERIFIED'); assert.equal(result.decision, 'HOLD');
  assert.equal(result.dbReady, false); assert.equal(result.authorization, 'NONE');
  assert.equal(result.enforcement, 'NOT_AUTHORIZED');
  assert.ok(Object.values(result.permissions).every(v => v === false));
}
function deny(f, code, repin = true) {
  if (repin) pin(f);
  const result = run(f); assertHold(result); assert.equal(result.scenarioValidation, 'FAIL');
  if (code) assert.equal(result.code, code); return result;
}
function share(f) {
  for (const i of [0, 2]) Object.assign(f.receipts[i].data.instanceIsolation, {
    sharedWithProduction: 'TRUE', limitations: ['shared-production-instance'],
    resourceRisks: [...allRisks], riskAcceptanceRef: 'synthetic-risk-acceptance' });
  f.config.riskAcceptances = [{ id: 'synthetic-risk-acceptance', issuerId: 'synthetic-authority',
    authorityRevision: f.config.authorityRevision, binding: clone(f.receipts[0].binding),
    instanceFingerprint: f.config.contract.target.instanceFingerprint, scope: 'DB_RESOURCE_SHARING',
    risks: [...allRisks], issuedAt: 950, observedAt: 900, expiresAt: 1900, revoked: false, evidenceRef: 'synthetic-risk-review' }];
  return pin(f);
}

test('P5 separate-instance positive is a synthetic contract match, never DB_READY or activation', () => {
  const result = run(fixture()); assertHold(result);
  assert.equal(result.scenarioValidation, 'PASS'); assert.equal(result.code, 'OFFLINE_CONTRACTS_MATCH_ONLY');
  assert.equal(result.isolation, 'SEPARATE_INSTANCE_REPORTED_SYNTHETIC');
});
test('P5 shared-instance positive requires pinned risk acceptance and stays explicitly shared', () => {
  const result = run(share(fixture())); assertHold(result); assert.equal(result.scenarioValidation, 'PASS');
  assert.equal(result.isolation, 'SHARED_INSTANCE_ACCEPTED_SYNTHETIC');
  assert.doesNotMatch(result.isolation, /INDEPENDENT|ISOLATED|SEPARATE/);
});
test('P5 validation is deterministic and does not mutate receipts or bootstrap', () => {
  const f = fixture(), before = clone(f), evaluate = createOfflineReceiptValidator(f.config);
  assert.deepEqual(evaluate({ receipts: f.receipts }), evaluate({ receipts: f.receipts })); assert.deepEqual(f, before);
  f.config.now = 3000; f.config.pins.length = 0;
  assert.equal(evaluate({ receipts: f.receipts }).scenarioValidation, 'PASS');
  assert.equal(createOfflineReceiptValidator(f.config)({ receipts: f.receipts }).scenarioValidation, 'FAIL');
});
test('P5 hash alone without independent synthetic issuer configuration is insufficient', () => {
  const f = fixture(); assert.equal(fingerprintReceipt(f.receipts[0]).ok, true);
  for (const cfg of [undefined, {}, { mode: 'OFFLINE_SYNTHETIC' }, { ...f.config, issuers: [] }]) {
    const result = createOfflineReceiptValidator(cfg)({ receipts: f.receipts });
    assertHold(result); assert.equal(result.code, 'TRUST_CONFIGURATION_NOT_VERIFIED');
  }
});
for (const [name, mutate] of [
  ['live mode', c => { c.mode = 'LIVE'; }], ['missing minimum epoch', c => delete c.minimumEpoch],
  ['unknown bootstrap provenance', c => { c.provenance = 'PR_BODY'; }],
  ['wrong issuer role', c => { c.issuers[0].role = 'RELEASE_AUTHORITY'; }],
  ['duplicate issuer', c => { c.issuers.push(c.issuers[0]); }],
  ['duplicate pin', c => { c.pins[1] = c.pins[0]; }],
  ['missing pin', c => { c.pins.pop(); }], ['unknown field', c => { c.token = 'synthetic-secret-marker'; }],
  ['invalid clock', c => { c.now = NaN; }],
]) test(`P5 rejects bootstrap ${name}`, () => {
  const f = fixture(); mutate(f.config); deny(f, 'TRUST_CONFIGURATION_NOT_VERIFIED', false);
});
for (const field of ['authority', 'config', 'pins', 'issuer', 'instanceIsolation', 'now', 'riskAcceptances'])
  test(`P5 rejects request injection ${field}`, () => {
    const f = fixture(), result = createOfflineReceiptValidator(f.config)({ receipts: f.receipts, [field]: f.config });
    assertHold(result); assert.equal(result.scenarioValidation, 'FAIL');
  });
for (const [name, mutate, code] of [
  ['expired receipt', f => { f.receipts[0].expiresAt = 1000; }, 'RECEIPT_STALE'],
  ['future observation', f => { f.receipts[0].observedAt = 1100; }, 'RECEIPT_STALE'],
  ['future issuance', f => { f.receipts[0].issuedAt = 1100; }, 'RECEIPT_STALE'],
  ['self-revocation', f => { f.receipts[0].revoked = true; }, 'RECEIPT_REVOKED'],
  ['independent revocation', f => { f.config.revokedReceiptIds.push(f.receipts[0].id); }, 'RECEIPT_REVOKED'],
  ['receipt replay', f => { f.config.consumedReceiptIds.push(f.receipts[0].id); }, 'RECEIPT_REPLAY'],
  ['operation replay', f => { f.config.consumedOperationIds.push(f.config.contract.operation.id); }, 'OPERATION_REPLAY'],
  ['rolled-back epoch', f => { f.receipts[0].epoch = 4; }, 'AUTHORITY_OR_EPOCH_MISMATCH'],
  ['authority revision mismatch', f => { f.receipts[0].authorityRevision = 'stale-policy'; }, 'AUTHORITY_OR_EPOCH_MISMATCH'],
  ['unverified evidence', f => { f.receipts[0].provenance.verification = 'UNVERIFIED'; }, 'EVIDENCE_UNVERIFIED'],
  ['PR authored evidence', f => { f.receipts[0].provenance.source = 'PR_BODY'; }, 'EVIDENCE_UNVERIFIED'],
]) test(`P5 rejects ${name}`, () => { const f = fixture(); mutate(f); deny(f, code); });

for (const [name, mutate] of [
  ['repository ID', b => { b.repository.id++; }], ['repository name', b => { b.repository.fullName = 'synthetic/other'; }],
  ['application source', b => { b.application.sourceSha = '9'.repeat(40); }],
  ['stale valid artifact', b => { b.application.artifactSha256 = hash('9'); }],
  ['manifest', b => { b.application.manifestSha256 = hash('9'); }],
  ['release ID', b => { b.application.releaseId = 'synthetic-old'; }],
  ['target', b => { b.target.id = 'synthetic-other'; }], ['account', b => { b.target.accountId = 'synthetic-other'; }],
  ['environment', b => { b.target.environment = 'PRODUCTION'; }],
  ['database', b => { b.target.databaseFingerprint = hash('9'); }],
  ['instance', b => { b.target.instanceFingerprint = hash('9'); }],
  ['operation', b => { b.operationId = 'synthetic-other'; }],
]) test(`P5 rejects candidate binding mismatch ${name}`, () => {
  const f = fixture(); mutate(f.receipts[2].binding); deny(f, 'RECEIPT_BINDING_MISMATCH');
});
test('P5 tampering without re-pin fails issuer binding even if syntax remains valid', () => {
  const f = fixture(); f.receipts[0].data.instanceIsolation.provenance.evidenceRef = 'synthetic-tampered';
  deny(f, 'ISSUER_PIN_NOT_VERIFIED', false);
});
test('P5 unrecognized receipt issuer cannot self-claim an approved identity', () => {
  const f = fixture(); f.receipts[0].issuerId = 'synthetic-attacker'; deny(f, 'ISSUER_PIN_NOT_VERIFIED', false);
});
test('P5 missing TARGET_DB_READY cannot be supplied by a second S1 or empty set', () => {
  const f = fixture(), evaluate = createOfflineReceiptValidator(f.config);
  for (const receipts of [[], f.receipts.filter(r => r.kind !== 'TARGET_DB_READY'), [...f.receipts, f.receipts[0]]]) {
    const r = evaluate({ receipts }); assertHold(r); assert.equal(r.code, 'RECEIPT_SET_INCOMPLETE');
  }
  const duplicate = clone(f.receipts); duplicate[2] = duplicate[1];
  assert.equal(evaluate({ receipts: duplicate }).code, 'RECEIPT_CONFLICT');
});

for (const index of [0, 2]) {
  for (const [name, mutate, code] of [
    ['missing structure', r => delete r.data.instanceIsolation, 'INVALID_INPUT'],
    ['missing instance identity', r => delete r.data.instanceIsolation.instanceFingerprint, 'ISOLATION_INVALID'],
    ['wrong instance', r => { r.data.instanceIsolation.instanceFingerprint = hash('9'); }, 'ISOLATION_BINDING_MISMATCH'],
    ['wrong database', r => { r.data.instanceIsolation.databaseFingerprint = hash('9'); }, 'ISOLATION_BINDING_MISMATCH'],
    ['wrong target', r => { r.data.instanceIsolation.targetId = 'synthetic-other'; }, 'ISOLATION_BINDING_MISMATCH'],
    ['wrong environment', r => { r.data.instanceIsolation.environment = 'PRODUCTION'; }, 'ISOLATION_BINDING_MISMATCH'],
    ['UNKNOWN', r => { r.data.instanceIsolation.sharedWithProduction = 'UNKNOWN'; }, 'ISOLATION_UNKNOWN'],
    ['boolean false instead of FALSE', r => { r.data.instanceIsolation.sharedWithProduction = false; }, 'ISOLATION_INVALID'],
    ['unverified isolation', r => { r.data.instanceIsolation.provenance.verification = 'UNVERIFIED'; }, 'EVIDENCE_UNVERIFIED'],
    ['missing provenance', r => delete r.data.instanceIsolation.provenance, 'ISOLATION_INVALID'],
    ['stale isolation', r => { r.data.instanceIsolation.validUntil = 1000; }, 'ISOLATION_STALE'],
    ['future isolation', r => { r.data.instanceIsolation.observedAt = 1001; }, 'ISOLATION_STALE'],
    ['validity beyond receipt', r => { r.data.instanceIsolation.validUntil = 2100; }, 'ISOLATION_STALE'],
    ['missing limitations', r => delete r.data.instanceIsolation.limitations, 'ISOLATION_INVALID'],
    ['missing risks', r => delete r.data.instanceIsolation.resourceRisks, 'ISOLATION_INVALID'],
  ]) test(`DEPLOY-P4-BUG-001 ${RECEIPT_KINDS[index]} rejects ${name}`, () => {
    const f = fixture(); mutate(f.receipts[index]); deny(f, code);
  });
}
test('DEPLOY-P4-BUG-001 independently pinned S0/TARGET disagreement still fails', () => {
  const f = share(fixture()); f.receipts[0].data.instanceIsolation.sharedWithProduction = 'FALSE';
  deny(f, 'ISOLATION_CONFLICT');
});
test('DEPLOY-P4-BUG-001 shared evidence without a trusted risk acceptance fails', () => {
  const f = share(fixture()); f.config.riskAcceptances = []; deny(f, 'RISK_ACCEPTANCE_REQUIRED');
});
for (const [name, mutate] of [
  ['missing reference', f => { f.receipts[2].data.instanceIsolation.riskAcceptanceRef = null; }],
  ['unknown reference', f => { f.receipts[2].data.instanceIsolation.riskAcceptanceRef = 'synthetic-unapproved'; }],
  ['missing risk category', f => { f.receipts[2].data.instanceIsolation.resourceRisks.pop(); }],
  ['empty limitations', f => { f.receipts[2].data.instanceIsolation.limitations = []; }],
  ['wrong risk authority', f => { f.config.riskAcceptances[0].issuerId = 'synthetic-operator'; }],
  ['wrong risk target', f => { f.config.riskAcceptances[0].binding.target.id = 'synthetic-other'; }],
  ['wrong risk instance', f => { f.config.riskAcceptances[0].instanceFingerprint = hash('9'); }],
  ['stale risk acceptance', f => { f.config.riskAcceptances[0].expiresAt = 1000; }],
  ['short risk acceptance', f => { f.config.riskAcceptances[0].expiresAt = 1700; }],
  ['revoked risk acceptance', f => { f.config.riskAcceptances[0].revoked = true; }],
  ['uncovered IO risk', f => { f.config.riskAcceptances[0].risks = ['CPU']; }],
]) test(`DEPLOY-P4-BUG-001 shared instance rejects ${name}`, () => {
  const f = share(fixture()); mutate(f); deny(f);
});
test('P5 separate DB instance with shared resources/limitations still requires acceptance', () => {
  const f = fixture(); for (const i of [0, 2]) f.receipts[i].data.instanceIsolation.resourceRisks = ['CPU'];
  deny(f, 'RISK_ACCEPTANCE_REQUIRED');
});
test('P5 risk acceptance never turns UNKNOWN into isolated', () => {
  const f = share(fixture()); for (const i of [0, 2]) f.receipts[i].data.instanceIsolation.sharedWithProduction = 'UNKNOWN';
  deny(f, 'ISOLATION_UNKNOWN');
});

for (const [name, mutate, code] of [
  ['engine', d => { d.engine = 'MYSQL'; }, 'DB_VERSION_MISMATCH'],
  ['server version', d => { d.serverVersion = '10.6.0'; }, 'DB_VERSION_MISMATCH'],
  ['Prisma', d => { d.prismaVersion = '7.7.0'; }, 'DB_VERSION_MISMATCH'],
  ['adapter', d => { d.adapterVersion = '7.7.0'; }, 'DB_VERSION_MISMATCH'],
  ['schema', d => { d.schemaSha256 = hash('9'); }, 'DB_HISTORY_MISMATCH'],
  ['history', d => { d.historySha256 = hash('9'); }, 'DB_HISTORY_MISMATCH'],
  ['migrations', d => { d.migrationsSha256 = hash('9'); }, 'DB_HISTORY_MISMATCH'],
  ['partial DDL', d => { d.migrationState = 'PARTIAL'; }, 'DB_MIGRATION_NOT_COMPLETE'],
  ['expired writer lease', d => { d.writerLease.expiresAt = 1000; }, 'DB_LEASE_INVALID'],
  ['nonexclusive writer lease', d => { d.writerLease.exclusive = false; }, 'DB_LEASE_INVALID'],
  ['wrong lease operation', d => { d.writerLease.operationId = 'synthetic-other'; }, 'DB_LEASE_INVALID'],
]) test(`P5 actual target rejects ${name}`, () => { const f = fixture(); mutate(f.receipts[2].data); deny(f, code); });
for (const name of ['legacy', 'newAppNewSchema', 'oldAppNewSchema', 'oldAppNewData'])
  test(`P5 target compatibility ${name} cannot be unverified`, () => {
    const f = fixture(); f.receipts[2].data.compatibility[name] = 'NOT_RUN'; deny(f, 'COMPATIBILITY_NOT_PASS');
  });
for (const name of ['legacy', 'compositeFk', 'restrict', 'mixedVersion', 'partialApplyRecovery', 'restore'])
  test(`P5 S1 check ${name} cannot be unverified`, () => {
    const f = fixture(); f.receipts[1].data.checks[name] = 'NOT_RUN'; deny(f, 'COMPATIBILITY_NOT_PASS');
  });
for (const [name, mutate] of [
  ['same target', d => { d.rehearsalTarget.id = 'synthetic-staging'; }],
  ['same database', d => { d.rehearsalTarget.databaseFingerprint = hash('c'); }],
  ['same instance', d => { d.rehearsalTarget.instanceFingerprint = hash('d'); }],
  ['production environment', d => { d.rehearsalTarget.environment = 'PRODUCTION'; }],
]) test(`P5 rehearsal cannot claim ${name}`, () => {
  const f = fixture(); mutate(f.receipts[1].data); deny(f, 'REHEARSAL_TARGET_INVALID');
});
test('P5 synthetic S1/target evidence can never establish production DB_READY', () => {
  const f = fixture(); f.config.contract.target.environment = 'PRODUCTION';
  deny(f, 'PRODUCTION_OUT_OF_SCOPE');
});
for (const [name, mutate] of [
  ['missing media backup', d => { d.components = ['DATABASE', 'CONFIG', 'PREVIOUS_APP']; }],
  ['unknown restore', d => { d.restoreStatus = 'NOT_RUN'; }],
  ['wrong previous backup', d => { d.previousReleaseId = 'synthetic-other'; }],
]) test(`P5 backup rejects ${name}`, () => { const f = fixture(); mutate(f.receipts[3].data); deny(f, 'BACKUP_NOT_VERIFIED'); });
test('P5 release approval must bind all four current receipt fingerprints', () => {
  const f = fixture(); f.receipts[4].data.approvedReceiptPins[0].sha256 = hash('9');
  f.config.pins[4].sha256 = fingerprintReceipt(f.receipts[4]).sha256;
  deny(f, 'APPROVAL_BINDING_MISMATCH', false);
});
for (const [phase, code] of [['UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME'], ['RECOVERY_REQUIRED', 'RECOVERY_REQUIRED'],
  ['COMMITTED', 'OPERATION_REPLAY'], ['ACKNOWLEDGED', 'OPERATION_REPLAY']])
  test(`P5 ${phase} never permits retry/rollback/unlock/cleanup`, () => {
    const f = fixture(); f.config.contract.operation.phase = phase; deny(f, code);
  });
test('P5 invalid journal/current release and same release replay fail closed', () => {
  const corrupt = fixture(); corrupt.config.contract.operation.journalStatus = 'CORRUPT'; deny(corrupt, 'RECOVERY_REQUIRED');
  const drift = fixture(); drift.config.contract.operation.currentReleaseId = 'synthetic-other'; deny(drift, 'PREVIOUS_RELEASE_CONFLICT');
  const stale = fixture(); stale.config.contract.application.releaseId = 'synthetic-prior'; deny(stale, 'PREVIOUS_RELEASE_CONFLICT');
});
test('P5 rejects hostile getters, proxies and pollution before executing attacker code', () => {
  const f = fixture(), evaluate = createOfflineReceiptValidator(f.config); let invoked = false;
  const hostile = {};
  Object.defineProperty(hostile, 'receipts', { enumerable: true, get() { invoked = true; throw Error('synthetic-secret-marker'); } });
  const proxy = new Proxy({}, { getPrototypeOf() { invoked = true; throw Error('synthetic-secret-marker'); } });
  const nested = clone(f.receipts);
  Object.defineProperty(nested[0].data.instanceIsolation, 'sharedWithProduction', { enumerable: true,
    get() { invoked = true; throw Error('synthetic-secret-marker'); } });
  const polluted = { receipts: f.receipts }; Object.defineProperty(polluted, '__proto__', { value: { polluted: true }, enumerable: true });
  for (const request of [hostile, proxy, { receipts: nested }, polluted, '{"receipts":[],"receipts":[]}', null]) {
    const r = evaluate(request); assertHold(r); assert.equal(r.scenarioValidation, 'FAIL');
    assert.doesNotMatch(JSON.stringify(r), /secret-marker/);
  }
  assert.equal(invoked, false); assert.equal({}.polluted, undefined);
});
test('P5 canonical object digest is stable under key order, but does not deserialize or authenticate', () => {
  assert.equal(fingerprintReceipt({ a: 1, b: 2 }).sha256, fingerprintReceipt({ b: 2, a: 1 }).sha256);
  assert.equal(fingerprintReceipt(new Proxy({}, {})).ok, false);
});
