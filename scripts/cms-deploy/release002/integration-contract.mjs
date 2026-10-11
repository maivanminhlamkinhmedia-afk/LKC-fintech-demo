// P5 lane-private object contract. No raw JSON parser, transport, clock or live authority.
import { types } from 'node:util';

export class ContractError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export function requireContract(condition, code = 'INVALID_INPUT') {
  if (!condition) throw new ContractError(code);
}

// Only inert own data is accepted. Reject proxies BEFORE invoking their traps.
// This is object-shape validation, not a replacement for G1c's raw-byte JSON parser.
export function snapshotData(input) {
  const seen = new Set(); let nodes = 0, units = 0;
  function copy(value, depth) {
    requireContract(++nodes <= 4096 && depth <= 24);
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') { requireContract(Number.isSafeInteger(value)); return value; }
    if (typeof value === 'string') {
      units += value.length;
      requireContract(value.length <= 2048 && units <= 65536 && !/[\u0000-\u001f\u007f]/u.test(value));
      return value;
    }
    requireContract(typeof value === 'object' && !types.isProxy(value) && !seen.has(value));
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
    requireContract(array ? proto === Array.prototype : proto === Object.prototype || proto === null);
    seen.add(value);
    const keys = Reflect.ownKeys(value);
    requireContract(keys.length <= 256 && keys.every(key => typeof key === 'string'
      && !['__proto__', 'constructor', 'prototype'].includes(key)));
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of keys) {
      requireContract(Object.hasOwn(descriptors[key], 'value') && (descriptors[key].enumerable || array && key === 'length'));
      units += key.length; requireContract(units <= 65536);
    }
    let result;
    if (array) {
      const length = descriptors.length.value;
      requireContract(length <= 128 && keys.length === length + 1);
      result = [];
      for (let i = 0; i < length; i++) {
        requireContract(Object.hasOwn(descriptors, String(i)));
        result.push(copy(descriptors[i].value, depth + 1));
      }
    } else {
      result = Object.create(null);
      for (const key of keys.sort()) result[key] = copy(descriptors[key].value, depth + 1);
    }
    seen.delete(value);
    return Object.freeze(result);
  }
  return copy(input, 0);
}

export function exactRecord(value, keys, code = 'INVALID_INPUT') {
  requireContract(value && !Array.isArray(value) && typeof value === 'object'
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), code);
  return value;
}
export const isId = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/u.test(value);
export const isSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
export const isDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
export const positive = value => Number.isSafeInteger(value) && value > 0;
export const sameData = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function idList(value, code = 'INVALID_INPUT') {
  requireContract(Array.isArray(value) && value.length <= 64 && value.every(isId)
    && new Set(value).size === value.length, code);
}

export function normalizeIntegrationContract(input) {
  const c = snapshotData(input);
  exactRecord(c, ['version', 'repository', 'application', 'toolingSourceSha', 'target', 'operation', 'database']);
  requireContract(c.version === 1 && isSha(c.toolingSourceSha));
  exactRecord(c.repository, ['id', 'fullName']);
  requireContract(positive(c.repository.id) && typeof c.repository.fullName === 'string'
    && /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9][a-z0-9._-]{0,99}$/u.test(c.repository.fullName));
  exactRecord(c.application, ['sourceSha', 'artifactSha256', 'manifestSha256', 'releaseId']);
  requireContract(isSha(c.application.sourceSha) && isDigest(c.application.artifactSha256)
    && isDigest(c.application.manifestSha256) && isId(c.application.releaseId));
  exactRecord(c.target, ['id', 'environment', 'accountId', 'databaseFingerprint', 'instanceFingerprint']);
  requireContract([c.target.id, c.target.accountId].every(isId)
    && ['STAGING', 'PRODUCTION'].includes(c.target.environment)
    && [c.target.databaseFingerprint, c.target.instanceFingerprint].every(isDigest));
  exactRecord(c.operation, ['id', 'phase', 'journalStatus', 'currentReleaseId', 'expectedPreviousReleaseId']);
  requireContract([c.operation.id, c.operation.currentReleaseId, c.operation.expectedPreviousReleaseId].every(isId)
    && ['NOT_STARTED', 'UNKNOWN_OUTCOME', 'RECOVERY_REQUIRED', 'COMMITTED', 'ACKNOWLEDGED'].includes(c.operation.phase)
    && ['VERIFIED_SYNTHETIC', 'CORRUPT', 'UNKNOWN'].includes(c.operation.journalStatus));
  exactRecord(c.database, ['engine', 'serverVersion', 'prismaVersion', 'adapterVersion',
    'baselineSchemaSha256', 'baselineHistorySha256', 'schemaSha256', 'historySha256', 'migrationsSha256']);
  requireContract(c.database.engine === 'MARIADB' && ['serverVersion', 'prismaVersion', 'adapterVersion']
    .every(key => typeof c.database[key] === 'string' && /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/u.test(c.database[key]))
    && ['baselineSchemaSha256', 'baselineHistorySha256', 'schemaSha256', 'historySha256', 'migrationsSha256']
      .every(key => isDigest(c.database[key])));
  return c;
}

export function validateIntegrationContract(input) {
  try { return { ok: true, contract: normalizeIntegrationContract(input), evidence: 'STRUCTURE_ONLY', authorization: 'NONE' }; }
  catch { return { ok: false, code: 'INVALID_CONTRACT', authorization: 'NONE' }; }
}

export function expectedBinding(c) {
  return snapshotData({ repository: c.repository, application: c.application,
    target: c.target, operationId: c.operation.id });
}

export function integrationReport(code, scenarioValid = false, isolation = 'NOT_VERIFIED') {
  // No result, including a positive synthetic fixture, is an activation capability.
  return Object.freeze({ version: 1, mode: 'OFFLINE_SYNTHETIC', status: 'NOT_VERIFIED',
    decision: 'HOLD', scenarioValidation: scenarioValid ? 'PASS' : 'FAIL', code,
    authorization: 'NONE', enforcement: 'NOT_AUTHORIZED', dbReady: false,
    isolation, evidence: 'SYNTHETIC_SUPPLIED_SNAPSHOTS_ONLY',
    permissions: Object.freeze({ activate: false, retry: false, rollback: false, unlock: false, cleanup: false }),
    limitations: Object.freeze(['NO_LIVE_ISSUER_AUTHENTICATION', 'NO_DATABASE_OBSERVATION',
      'NO_DURABLE_REPLAY_PROTECTION', 'NO_FRESHNESS_LEASE']) });
}
