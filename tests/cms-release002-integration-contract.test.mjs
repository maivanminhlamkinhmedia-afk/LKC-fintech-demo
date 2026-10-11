import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';
import { validateIntegrationContract, snapshotData, exactRecord, integrationReport } from '../scripts/cms-deploy/release002/integration-contract.mjs';

const hash = c => c.repeat(64);
function candidate() {
  return { version: 1, repository: { id: 42, fullName: 'synthetic-owner/synthetic-repository' },
    toolingSourceSha: '1'.repeat(40),
    application: { sourceSha: '2'.repeat(40), artifactSha256: hash('a'), manifestSha256: hash('b'), releaseId: 'synthetic-next' },
    target: { id: 'synthetic-staging', environment: 'STAGING', accountId: 'synthetic-account',
      databaseFingerprint: hash('c'), instanceFingerprint: hash('d') },
    operation: { id: 'synthetic-operation', phase: 'NOT_STARTED', journalStatus: 'VERIFIED_SYNTHETIC',
      currentReleaseId: 'synthetic-prior', expectedPreviousReleaseId: 'synthetic-prior' },
    database: { engine: 'MARIADB', serverVersion: '10.11.8', prismaVersion: '7.8.0', adapterVersion: '7.8.0',
      baselineSchemaSha256: hash('1'), baselineHistorySha256: hash('2'), schemaSha256: hash('3'),
      historySha256: hash('4'), migrationsSha256: hash('5') } };
}
test('P5 contract preserves separate app/source/artifact/tooling identities without authority', () => {
  const input = candidate(), result = validateIntegrationContract(input);
  assert.equal(result.ok, true); assert.equal(result.authorization, 'NONE');
  assert.equal(result.evidence, 'STRUCTURE_ONLY');
  assert.equal(result.contract.application.sourceSha, input.application.sourceSha);
  assert.notEqual(result.contract.application.sourceSha, result.contract.toolingSourceSha);
  input.application.releaseId = 'mutated'; assert.equal(result.contract.application.releaseId, 'synthetic-next');
  assert.throws(() => { result.contract.application.releaseId = 'mutated'; }, TypeError);
});
for (const [name, mutate] of [
  ['repo identity missing', c => delete c.repository.id],
  ['repo fullName invalid', c => { c.repository.fullName = '../outside'; }],
  ['commit substituted with artifact', c => { c.application.sourceSha = hash('a'); }],
  ['artifact substituted with commit', c => { c.application.artifactSha256 = '2'.repeat(40); }],
  ['manifest digest absent', c => delete c.application.manifestSha256],
  ['tooling source absent', c => delete c.toolingSourceSha],
  ['unexpected credentials', c => { c.credentials = 'synthetic-secret-marker'; }],
  ['unknown environment', c => { c.target.environment = 'ISOLATED'; }],
  ['database fingerprint absent', c => delete c.target.databaseFingerprint],
  ['instance fingerprint absent', c => delete c.target.instanceFingerprint],
  ['operation identity absent', c => delete c.operation.id],
  ['unknown operation phase', c => { c.operation.phase = 'READY'; }],
  ['unknown journal status', c => { c.operation.journalStatus = 'PASS'; }],
  ['DB engine mismatch', c => { c.database.engine = 'MYSQL'; }],
  ['DB version vague', c => { c.database.serverVersion = 'latest'; }],
  ['baseline history absent', c => delete c.database.baselineHistorySha256],
  ['desired history absent', c => delete c.database.historySha256],
  ['migration inventory absent', c => delete c.database.migrationsSha256],
]) test(`P5 contract rejects ${name}`, () => {
  const c = candidate(); mutate(c); assert.deepEqual(validateIntegrationContract(c),
    { ok: false, code: 'INVALID_CONTRACT', authorization: 'NONE' });
});

for (const [name, value] of [
  ['raw JSON string', '{"version":1,"version":2}'], ['raw bytes', Buffer.from('{}')],
  ['null', null], ['function', () => {}], ['bigint', 1n], ['nonfinite number', NaN],
  ['unsafe integer', Number.MAX_SAFE_INTEGER + 1], ['date', new Date(0)],
  ['map', new Map()], ['set', new Set()], ['custom prototype', Object.create({ version: 1 })],
]) test(`P5 rejects unsupported input ${name}`, () => assert.equal(validateIntegrationContract(value).ok, false));

for (const key of ['__proto__', 'constructor', 'prototype']) test(`P5 rejects nested pollution key ${key}`, () => {
  const c = candidate(); Object.defineProperty(c.database, key, { value: {}, enumerable: true });
  assert.equal(validateIntegrationContract(c).ok, false); assert.equal({}.polluted, undefined);
});
test('P5 rejects throwing accessor without executing it or exposing its message', () => {
  const c = candidate(); let called = false;
  Object.defineProperty(c.target, 'id', { enumerable: true, get() { called = true; throw Error('synthetic-secret-marker'); } });
  const result = validateIntegrationContract(c);
  assert.equal(called, false); assert.equal(result.ok, false); assert.doesNotMatch(JSON.stringify(result), /secret-marker/);
});
test('P5 rejects proxies before traps and revoked proxies without raw exceptions', () => {
  let called = false;
  const proxy = new Proxy(candidate(), { ownKeys() { called = true; throw Error('trap'); }, getPrototypeOf() { called = true; throw Error('trap'); } });
  assert.equal(validateIntegrationContract(proxy).ok, false); assert.equal(called, false);
  const revocable = Proxy.revocable({}, {}); revocable.revoke(); assert.equal(validateIntegrationContract(revocable.proxy).ok, false);
});
test('P5 rejects symbols, hidden fields, sparse/custom arrays, cycles and excessive input', () => {
  const values = [{ [Symbol('hidden')]: 1 }, Object.defineProperty({}, 'hidden', { value: 1 }),
    new Array(2), Object.assign([], { extra: true }), Array(129).fill(1), 'a'.repeat(2049), '\u0000'];
  const cycle = {}; cycle.cycle = cycle; values.push(cycle);
  let deep = {}; for (let i = 0; i < 26; i++) deep = { next: deep }; values.push(deep);
  values.push(Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`key${i}`, 1])));
  values.push(Array.from({ length: 100 }, () => 'a'.repeat(1000)));
  values.push(Array.from({ length: 100 }, () => Array(100).fill(null)));
  for (const value of values) assert.throws(() => snapshotData(value));
});
test('P5 can snapshot own inert null-prototype data and empty arrays', () => {
  const value = Object.assign(Object.create(null), { value: 1, items: [] });
  const copy = snapshotData(value); assert.equal(copy.value, 1); assert.deepEqual(copy.items, []);
  assert.equal(Object.getPrototypeOf(copy), null);
});
test('P5 exact key sets cannot collide through a delimiter embedded in an input key', () => {
  assert.throws(() => exactRecord(snapshotData({ 'a|b': 1 }), ['a', 'b']));
});
test('P5 report cannot grant any implicit action even for a positive synthetic scenario', () => {
  for (const result of [integrationReport('SYNTHETIC_ONLY', true), integrationReport('UNKNOWN_OUTCOME')]) {
    assert.equal(result.status, 'NOT_VERIFIED'); assert.equal(result.decision, 'HOLD');
    assert.equal(result.authorization, 'NONE'); assert.equal(result.dbReady, false);
    assert.equal(result.enforcement, 'NOT_AUTHORIZED');
    assert.ok(Object.values(result.permissions).every(value => value === false));
    assert.throws(() => { result.permissions.activate = true; }, TypeError);
  }
});
test('P5 source import surface is core util/crypto plus private contract, without live entrypoints', () => {
  const base = new URL('../scripts/cms-deploy/release002/', import.meta.url);
  const contract = readFileSync(new URL('integration-contract.mjs', base), 'utf8');
  const receipts = readFileSync(new URL('release-receipts.mjs', base), 'utf8');
  const imports = text => [...text.matchAll(/from\s+['"]([^'"]+)['"]/gu)].map(match => match[1]);
  assert.deepEqual(imports(contract), ['node:util']);
  assert.deepEqual(imports(receipts), ['node:crypto', './integration-contract.mjs']);
  for (const text of [contract, receipts]) {
    assert.doesNotMatch(text, /\b(?:fetch|eval|Function|setTimeout|setInterval)\s*\(|process\.(?:env|argv)|import\s*\(|JSON\.parse\s*\(/u);
    assert.doesNotMatch(text, /from\s+['"][^'"]*(?:scripts\/ci|trusted-evidence|node:(?:fs|http|net|child_process))/u);
  }
});
test('P5 fresh imports cause no network, subprocess or filesystem-write calls', async () => {
  let calls = 0; const saved = [];
  const block = () => { calls++; throw Error('IMPORT_SIDE_EFFECT'); };
  const replace = (object, key) => { saved.push([object, key, object[key]]); object[key] = block; };
  for (const name of ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'mkdir', 'mkdirSync',
    'rename', 'renameSync', 'unlink', 'unlinkSync', 'rm', 'rmSync', 'createWriteStream']) replace(fs, name);
  for (const name of ['writeFile', 'appendFile', 'mkdir', 'rename', 'unlink', 'rm']) replace(fs.promises, name);
  for (const name of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']) replace(childProcess, name);
  for (const object of [http, https]) { replace(object, 'request'); replace(object, 'get'); }
  replace(net, 'connect'); replace(net, 'createConnection'); replace(net.Socket.prototype, 'connect');
  replace(tls, 'connect'); replace(dgram, 'createSocket'); replace(globalThis, 'fetch');
  let failure;
  try {
    syncBuiltinESMExports();
    await import('../scripts/cms-deploy/release002/integration-contract.mjs?p5-safe-import');
    await import('../scripts/cms-deploy/release002/release-receipts.mjs?p5-safe-import');
  } catch (error) { failure = error; }
  finally { for (const [object, key, original] of saved.reverse()) object[key] = original; syncBuiltinESMExports(); }
  assert.equal(failure, undefined); assert.equal(calls, 0);
});
