// Pure supplied-receipt binding for OFFLINE evaluation; not a signer or trust provider.
import { createHash } from 'node:crypto';
import { ContractError, requireContract as need, snapshotData, exactRecord as record,
  isId, isDigest, positive, idList, sameData, normalizeIntegrationContract,
  expectedBinding, integrationReport } from './integration-contract.mjs';

export const RECEIPT_KINDS = Object.freeze(['S0_TARGET_METADATA', 'S1_REHEARSAL',
  'TARGET_DB_READY', 'BACKUP_READY', 'RELEASE_AUTHORIZATION']);
const roles = Object.freeze({ S0_TARGET_METADATA: ['CMS_DB_OWNER', 'DB_OPERATOR'],
  S1_REHEARSAL: ['CMS_DB_OWNER', 'DB_OPERATOR'], TARGET_DB_READY: ['CMS_DB_OWNER', 'DB_OPERATOR'],
  BACKUP_READY: ['DB_OPERATOR'], RELEASE_AUTHORIZATION: ['RELEASE_AUTHORITY'] });
const riskCodes = ['CPU', 'MEMORY', 'IO', 'CONNECTIONS', 'ADMINISTRATION', 'BACKUP_RESTORE'];
const fail = code => { throw new ContractError(code); };

// Object identity digest only. NOT a raw-byte signature, authentication or G1c policy.
export function fingerprintReceipt(value) {
  try { return { ok: true, sha256: createHash('sha256').update(JSON.stringify(snapshotData(value))).digest('hex') }; }
  catch { return { ok: false, code: 'INVALID_RECEIPT_INPUT' }; }
}
function windowValid(value, now, code) {
  need(positive(value.issuedAt) && positive(value.observedAt) && positive(value.expiresAt)
    && value.issuedAt <= now && value.observedAt <= value.issuedAt && value.expiresAt > now
    && value.expiresAt > value.issuedAt, code);
}
function provenance(p) {
  record(p, ['source', 'verification', 'evidenceRef'], 'EVIDENCE_UNVERIFIED');
  need(p.source === 'CMS_OWNER_OR_OPERATOR_SYNTHETIC' && p.verification === 'VERIFIED_SYNTHETIC'
    && isId(p.evidenceRef), 'EVIDENCE_UNVERIFIED');
}
function riskList(list) {
  need(Array.isArray(list) && list.every(item => riskCodes.includes(item))
    && new Set(list).size === list.length, 'ISOLATION_INVALID');
}
function configure(input) {
  const cfg = snapshotData(input);
  record(cfg, ['mode', 'provenance', 'contract', 'now', 'authorityRevision', 'minimumEpoch',
    'issuers', 'pins', 'revokedReceiptIds', 'consumedReceiptIds', 'consumedOperationIds', 'riskAcceptances']);
  need(cfg.mode === 'OFFLINE_SYNTHETIC' && cfg.provenance === 'INDEPENDENT_SYNTHETIC_FIXTURE'
    && positive(cfg.now) && positive(cfg.minimumEpoch) && isId(cfg.authorityRevision));
  const c = normalizeIntegrationContract(cfg.contract);
  need(Array.isArray(cfg.issuers) && cfg.issuers.length > 0 && cfg.issuers.length <= 16);
  const issuerIds = new Set();
  for (const issuer of cfg.issuers) {
    record(issuer, ['id', 'role']);
    need(isId(issuer.id) && !issuerIds.has(issuer.id)
      && ['CMS_DB_OWNER', 'DB_OPERATOR', 'RELEASE_AUTHORITY'].includes(issuer.role));
    issuerIds.add(issuer.id);
  }
  for (const key of ['revokedReceiptIds', 'consumedReceiptIds', 'consumedOperationIds']) idList(cfg[key]);
  need(Array.isArray(cfg.pins) && cfg.pins.length === RECEIPT_KINDS.length);
  const pinIds = new Set(), pinKinds = new Set();
  for (const pin of cfg.pins) {
    record(pin, ['id', 'kind', 'issuerId', 'sha256']);
    need(isId(pin.id) && isDigest(pin.sha256) && RECEIPT_KINDS.includes(pin.kind)
      && !pinIds.has(pin.id) && !pinKinds.has(pin.kind)
      && cfg.issuers.some(i => i.id === pin.issuerId && roles[pin.kind].includes(i.role)));
    pinIds.add(pin.id); pinKinds.add(pin.kind);
  }
  need(Array.isArray(cfg.riskAcceptances) && cfg.riskAcceptances.length <= 16);
  const ids = new Set();
  for (const risk of cfg.riskAcceptances) {
    record(risk, ['id', 'issuerId', 'authorityRevision', 'binding', 'instanceFingerprint', 'scope',
      'risks', 'issuedAt', 'observedAt', 'expiresAt', 'revoked', 'evidenceRef']);
    need(isId(risk.id) && !ids.has(risk.id) && risk.authorityRevision === cfg.authorityRevision
      && cfg.issuers.some(i => i.id === risk.issuerId && i.role === 'RELEASE_AUTHORITY')
      && sameData(risk.binding, expectedBinding(c)) && risk.instanceFingerprint === c.target.instanceFingerprint
      && risk.scope === 'DB_RESOURCE_SHARING' && risk.revoked === false && isId(risk.evidenceRef));
    riskList(risk.risks); windowValid(risk, cfg.now, 'RISK_ACCEPTANCE_INVALID'); ids.add(risk.id);
  }
  return { cfg, c };
}

function isolation(value, receipt, cfg, c) {
  record(value, ['instanceFingerprint', 'databaseFingerprint', 'targetId', 'environment',
    'sharedWithProduction', 'provenance', 'observedAt', 'validUntil', 'limitations',
    'resourceRisks', 'riskAcceptanceRef'], 'ISOLATION_INVALID');
  need(value.instanceFingerprint === c.target.instanceFingerprint && isDigest(value.instanceFingerprint)
    && value.databaseFingerprint === c.target.databaseFingerprint && value.targetId === c.target.id
    && value.environment === c.target.environment, 'ISOLATION_BINDING_MISMATCH');
  provenance(value.provenance);
  need(positive(value.observedAt) && positive(value.validUntil) && value.observedAt <= receipt.observedAt
    && value.validUntil > cfg.now && value.validUntil <= receipt.expiresAt, 'ISOLATION_STALE');
  idList(value.limitations, 'ISOLATION_INVALID'); riskList(value.resourceRisks);
  need(['TRUE', 'FALSE', 'UNKNOWN'].includes(value.sharedWithProduction), 'ISOLATION_INVALID');
  need(value.sharedWithProduction !== 'UNKNOWN', 'ISOLATION_UNKNOWN');
  const shared = value.sharedWithProduction === 'TRUE';
  // Shared infrastructure must describe every relevant risk category, not merely
  // set a shared boolean with an empty limitations/risk list.
  if (shared) need(value.limitations.length > 0 && riskCodes.every(r => value.resourceRisks.includes(r)), 'SHARED_RISKS_MISSING');
  const requiresAcceptance = shared || value.resourceRisks.length > 0 || value.limitations.length > 0;
  if (requiresAcceptance) {
    const accepted = cfg.riskAcceptances.find(r => r.id === value.riskAcceptanceRef);
    need(accepted && accepted.expiresAt >= value.validUntil
      && value.resourceRisks.every(r => accepted.risks.includes(r)), 'RISK_ACCEPTANCE_REQUIRED');
  } else need(value.riskAcceptanceRef === null, 'ISOLATION_INVALID');
  // Comparison excludes timestamps/evidence references: independent observations
  // may differ in time, but cannot disagree about identity, sharing or limitations.
  return { instanceFingerprint: value.instanceFingerprint, databaseFingerprint: value.databaseFingerprint,
    sharedWithProduction: value.sharedWithProduction, limitations: [...value.limitations].sort(),
    resourceRisks: [...value.resourceRisks].sort(), riskAcceptanceRef: value.riskAcceptanceRef };
}
function versions(data, c) {
  need(['engine', 'serverVersion', 'prismaVersion', 'adapterVersion'].every(k => data[k] === c.database[k]), 'DB_VERSION_MISMATCH');
}
function desired(data, c) {
  versions(data, c);
  need(['schemaSha256', 'historySha256', 'migrationsSha256'].every(k => data[k] === c.database[k]), 'DB_HISTORY_MISMATCH');
}
function checks(data, fields) {
  record(data, fields, 'COMPATIBILITY_MISSING');
  need(fields.every(key => data[key] === 'PASS_SYNTHETIC'), 'COMPATIBILITY_NOT_PASS');
}

function validateData(r, cfg, c) {
  const d = r.data;
  if (r.kind === 'S0_TARGET_METADATA') {
    record(d, ['engine', 'serverVersion', 'prismaVersion', 'adapterVersion', 'schemaSha256', 'historySha256', 'instanceIsolation']);
    versions(d, c);
    need(d.schemaSha256 === c.database.baselineSchemaSha256 && d.historySha256 === c.database.baselineHistorySha256, 'DB_HISTORY_MISMATCH');
    return isolation(d.instanceIsolation, r, cfg, c);
  }
  if (r.kind === 'TARGET_DB_READY') {
    record(d, ['engine', 'serverVersion', 'prismaVersion', 'adapterVersion', 'schemaSha256', 'historySha256',
      'migrationsSha256', 'migrationState', 'writerLease', 'compatibility', 'instanceIsolation']);
    desired(d, c); need(d.migrationState === 'COMPLETE', 'DB_MIGRATION_NOT_COMPLETE');
    record(d.writerLease, ['id', 'operationId', 'exclusive', 'expiresAt'], 'DB_LEASE_INVALID');
    need(isId(d.writerLease.id) && d.writerLease.operationId === c.operation.id
      && d.writerLease.exclusive === true && positive(d.writerLease.expiresAt)
      && d.writerLease.expiresAt > cfg.now && d.writerLease.expiresAt <= r.expiresAt, 'DB_LEASE_INVALID');
    checks(d.compatibility, ['legacy', 'newAppNewSchema', 'oldAppNewSchema', 'oldAppNewData']);
    return isolation(d.instanceIsolation, r, cfg, c);
  }
  if (r.kind === 'S1_REHEARSAL') {
    record(d, ['engine', 'serverVersion', 'prismaVersion', 'adapterVersion', 'schemaSha256', 'historySha256',
      'migrationsSha256', 'rehearsalTarget', 'checks']); desired(d, c);
    record(d.rehearsalTarget, ['id', 'environment', 'databaseFingerprint', 'instanceFingerprint']);
    need(isId(d.rehearsalTarget.id) && d.rehearsalTarget.id !== c.target.id
      && d.rehearsalTarget.environment === 'DISPOSABLE'
      && isDigest(d.rehearsalTarget.databaseFingerprint) && isDigest(d.rehearsalTarget.instanceFingerprint)
      && d.rehearsalTarget.databaseFingerprint !== c.target.databaseFingerprint
      && d.rehearsalTarget.instanceFingerprint !== c.target.instanceFingerprint, 'REHEARSAL_TARGET_INVALID');
    checks(d.checks, ['legacy', 'compositeFk', 'restrict', 'mixedVersion', 'partialApplyRecovery', 'restore']);
  } else if (r.kind === 'BACKUP_READY') {
    record(d, ['backupId', 'sha256', 'components', 'restoreProofRef', 'restoreStatus', 'previousReleaseId']);
    need(isId(d.backupId) && isDigest(d.sha256) && isId(d.restoreProofRef)
      && d.restoreStatus === 'PASS_SYNTHETIC' && d.previousReleaseId === c.operation.expectedPreviousReleaseId
      && Array.isArray(d.components) && d.components.length === 4
      && ['DATABASE', 'MEDIA', 'CONFIG', 'PREVIOUS_APP'].every(key => d.components.includes(key)), 'BACKUP_NOT_VERIFIED');
  } else if (r.kind === 'RELEASE_AUTHORIZATION') {
    record(d, ['purpose', 'previousReleaseId', 'approvedReceiptPins']);
    need(d.purpose === 'OFFLINE_CONTRACT_EVALUATION' && d.previousReleaseId === c.operation.expectedPreviousReleaseId
      && Array.isArray(d.approvedReceiptPins) && d.approvedReceiptPins.length === 4, 'APPROVAL_INVALID');
    const ids = new Set();
    for (const p of d.approvedReceiptPins) {
      record(p, ['id', 'sha256']);
      need(!ids.has(p.id) && cfg.pins.some(expected => expected.kind !== 'RELEASE_AUTHORIZATION'
        && expected.id === p.id && expected.sha256 === p.sha256), 'APPROVAL_BINDING_MISMATCH'); ids.add(p.id);
    }
  }
  return null;
}

export function createOfflineReceiptValidator(configuration) {
  let trusted;
  try { trusted = configure(configuration); } catch { /* invalid configuration fails closed at evaluation */ }
  // No provider callback or request-supplied authority. This closure owns an inert,
  // frozen synthetic bootstrap snapshot, not real issuer authentication.
  return function evaluate(request) {
    if (!trusted) return integrationReport('TRUST_CONFIGURATION_NOT_VERIFIED');
    const { cfg, c } = trusted;
    try {
      const q = snapshotData(request); record(q, ['receipts']);
      need(c.target.environment === 'STAGING', 'PRODUCTION_OUT_OF_SCOPE');
      if (c.operation.phase === 'UNKNOWN_OUTCOME') fail('UNKNOWN_OUTCOME');
      if (c.operation.phase === 'RECOVERY_REQUIRED' || c.operation.journalStatus !== 'VERIFIED_SYNTHETIC') fail('RECOVERY_REQUIRED');
      need(c.operation.phase === 'NOT_STARTED' && !cfg.consumedOperationIds.includes(c.operation.id), 'OPERATION_REPLAY');
      need(c.operation.currentReleaseId === c.operation.expectedPreviousReleaseId
        && c.application.releaseId !== c.operation.currentReleaseId, 'PREVIOUS_RELEASE_CONFLICT');
      need(Array.isArray(q.receipts) && q.receipts.length === RECEIPT_KINDS.length, 'RECEIPT_SET_INCOMPLETE');
      const ids = new Set(), kinds = new Set(); let s0Isolation, targetIsolation;
      for (const r of q.receipts) {
        record(r, ['version', 'id', 'kind', 'issuerId', 'authorityRevision', 'epoch', 'issuedAt', 'observedAt',
          'expiresAt', 'revoked', 'provenance', 'binding', 'data'], 'RECEIPT_INVALID');
        need(r.version === 1 && isId(r.id) && RECEIPT_KINDS.includes(r.kind), 'RECEIPT_INVALID');
        need(!ids.has(r.id) && !kinds.has(r.kind), 'RECEIPT_CONFLICT'); ids.add(r.id); kinds.add(r.kind);
        need(!cfg.consumedReceiptIds.includes(r.id), 'RECEIPT_REPLAY');
        need(r.revoked === false && !cfg.revokedReceiptIds.includes(r.id), 'RECEIPT_REVOKED');
        need(r.authorityRevision === cfg.authorityRevision && positive(r.epoch) && r.epoch >= cfg.minimumEpoch, 'AUTHORITY_OR_EPOCH_MISMATCH');
        windowValid(r, cfg.now, 'RECEIPT_STALE'); provenance(r.provenance);
        need(sameData(r.binding, expectedBinding(c)), 'RECEIPT_BINDING_MISMATCH');
        const pin = cfg.pins.find(p => p.id === r.id && p.kind === r.kind && p.issuerId === r.issuerId);
        need(pin && pin.sha256 === fingerprintReceipt(r).sha256, 'ISSUER_PIN_NOT_VERIFIED');
        const iso = validateData(r, cfg, c);
        if (r.kind === 'S0_TARGET_METADATA') s0Isolation = iso;
        if (r.kind === 'TARGET_DB_READY') targetIsolation = iso;
      }
      need(sameData(s0Isolation, targetIsolation), 'ISOLATION_CONFLICT');
      return integrationReport('OFFLINE_CONTRACTS_MATCH_ONLY', true,
        targetIsolation.sharedWithProduction === 'TRUE' ? 'SHARED_INSTANCE_ACCEPTED_SYNTHETIC' : 'SEPARATE_INSTANCE_REPORTED_SYNTHETIC');
    } catch (error) {
      return integrationReport(error instanceof ContractError ? error.code : 'VALIDATION_FAILED');
    }
  };
}
