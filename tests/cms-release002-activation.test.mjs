import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import mutableFs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { LIMITS, verifyArchive } from '../scripts/cms-deploy/release002/archive-integrity.mjs';
import { checkHostKeyPolicy, createActivationPlan } from '../scripts/cms-deploy/release002/activation-plan.mjs';
import { createFakeTarget, openFakeTarget } from '../scripts/cms-deploy/release002/fake-target.mjs';
import { appendJournal, createMockSandbox, readJournal } from '../scripts/cms-deploy/release002/release-journal.mjs';

// Every fixture/child cwd is confined to one newly initialized, marked synthetic target.
const configuredRoot = process.env.LKC_RELEASE002_MOCK_ROOT;
if (configuredRoot && !path.isAbsolute(configuredRoot)) throw new Error('LKC_RELEASE002_MOCK_ROOT must be absolute');
const sandbox = createMockSandbox(path.resolve(configuredRoot ?? path.join(tmpdir(), 'lkc-release002-mock-' + randomUUID())));
const digest = (b) => createHash('sha256').update(b).digest('hex');
const sourceSha = '5e6b14f006453da7f9b1554c210e9ad85a9f8c0c';
let counter = 0;

// Independent fixture encoder; production parser is not used to construct tar headers/checksums.
function makeTar(entries, terminate = true) {
  const chunks = [];
  for (const { name, text = 'mock', type = '0', link = '', prefix = '' } of entries) {
    const content = Buffer.from(text), h = Buffer.alloc(512);
    h.write(name, 0, 100, 'ascii');
    const number = (at, length, n) => h.write(n.toString(8).padStart(length - 1, '0') + '\0', at, length, 'ascii');
    number(100, 8, 0o600); number(108, 8, 0); number(116, 8, 0); number(124, 12, content.length); number(136, 12, 0);
    h.fill(32, 148, 156); h.write(type, 156, 1, 'ascii'); h.write(link, 157, 100, 'ascii');
    h.write('ustar\0', 257, 6, 'ascii'); h.write('00', 263, 2, 'ascii'); h.write(prefix, 345, 155, 'ascii');
    const sum = h.reduce((a, b) => a + b, 0);
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    chunks.push(h, content, Buffer.alloc((512 - content.length % 512) % 512));
  }
  if (terminate) chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function artifact(releaseId = 'new-release', entries = [{ name: 'public/version.txt', text: releaseId }, { name: 'server.js', text: '// inert fixture ' + releaseId }]) {
  const bytes = gzipSync(makeTar(entries));
  const approval = { releaseId, sourceSha, archiveSha256: digest(bytes), files: entries.map((e) => ({
    path: e.prefix ? e.prefix + '/' + e.name : e.name, size: Buffer.byteLength(e.text ?? 'mock'), sha256: digest(Buffer.from(e.text ?? 'mock')),
  })).sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path))) };
  return { bytes, approval };
}

function fixture() {
  const targetId = 'case-' + (++counter), old = artifact('old-release'), next = artifact();
  const target = createFakeTarget(sandbox.root, targetId, old.bytes, old.approval);
  const request = { targetId, operationId: 'operation-' + counter, ownerId: 'codex-two', artifact: next.approval,
    expectedCurrent: { releaseId: old.approval.releaseId, receiptSha256: digest(JSON.stringify(old.approval)) },
    sshUser: 'mock-owner', uploadPath: '/home/mock-owner/releases/new-release/archive.tar.gz',
    activationArchivePath: '/home/mock-owner/releases/new-release/archive.tar.gz',
    hostKey: { host: 'target.invalid', fingerprint: 'SHA256:' + 'A'.repeat(43), source: 'INDEPENDENT_OPERATOR_PIN', verifiedBy: 'mock-operator' } };
  const made = createActivationPlan(request); assert.equal(made.ok, true);
  return { targetId, old, next, target, request, plan: made.plan };
}

function treeFingerprint(root) {
  const rows = [];
  const visit = (dir) => { for (const n of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, n), s = fs.lstatSync(p), rel = path.relative(root, p);
    if (s.isSymbolicLink()) rows.push([rel, 'link', fs.readlinkSync(p)]);
    else if (s.isDirectory()) { rows.push([rel, 'dir']); visit(p); }
    else rows.push([rel, digest(fs.readFileSync(p))]);
  } };
  visit(root); return digest(JSON.stringify(rows));
}

test('P1-01 complete candidate activates; exact previous bytes retained and journal survives reopen', async () => {
  const f = fixture(), before = treeFingerprint(path.join(f.target.root, 'current'));
  assert.equal(f.target.upload(f.plan, f.next.bytes).ok, true);
  const run = await f.target.activate(f.plan);
  assert.equal(run.state, 'ACTIVATED_SYNTHETIC'); assert.equal(run.authorization, 'NONE');
  assert.equal(treeFingerprint(path.join(f.target.root, 'previous')), before);
  assert.equal(fs.readFileSync(path.join(f.target.root, 'current/files/public/version.txt'), 'utf8'), 'new-release');
  assert.equal(fs.existsSync(path.join(f.target.root, 'activation.lock')), false);
  assert.deepEqual(readJournal(f.target.root).rows.map((r) => r.state), ['LOCKED', 'PREPARING', 'PREPARED', 'ACTIVATING', 'COMMITTED', 'ACKNOWLEDGED']);
  assert.equal(openFakeTarget(sandbox.root, f.targetId).inspectRecovery(f.plan).state, 'ACTIVATED_OBSERVED');
});

for (const variant of ['missing', 'mismatch', 'malformed']) test('P1-02 artifact SHA ' + variant + ' fails closed', async () => {
  const f = fixture(), a = structuredClone(f.next.approval);
  if (variant === 'missing') delete a.archiveSha256;
  if (variant === 'mismatch') a.archiveSha256 = '0'.repeat(64);
  if (variant === 'malformed') a.archiveSha256 = 'not-a-sha';
  assert.equal(verifyArchive(f.next.bytes, a).ok, false);
  const before = treeFingerprint(f.target.root);
  assert.equal(createActivationPlan({ ...f.request, artifact: a }).ok, variant === 'mismatch');
  assert.equal(treeFingerprint(f.target.root), before);
});

test('P1-03 valid stale tar at upload slot cannot activate; hash binds candidate, not tar readability', async () => {
  const f = fixture(); assert.equal(verifyArchive(f.old.bytes, f.old.approval).ok, true);
  assert.equal(f.target.upload(f.plan, f.old.bytes).ok, true);
  const before = treeFingerprint(f.target.root);
  const run = await f.target.activate(f.plan);
  assert.equal(run.code, 'ARTIFACT_SHA_MISMATCH');
  assert.equal(treeFingerprint(f.target.root), before);
  assert.equal(fs.existsSync(path.join(f.target.root, 'previous')), false);
});

for (const [name, patch] of [
  ['different SSH_USER', { sshUser: 'mock-other' }],
  ['hardcoded stale remote archive', { activationArchivePath: '/home/edpmjmha/lkc-deploy.tar.gz' }],
  ['upload different release', { uploadPath: '/home/mock-owner/releases/old-release/archive.tar.gz' }],
  ['old release ID reused', { artifact: artifact('old-release').approval }],
]) test('P1-04 account/release binding rejects ' + name, () => {
  const f = fixture(); assert.equal(createActivationPlan({ ...f.request, ...patch }).ok, false);
});

for (const name of ['../escape', '/absolute', 'a/../b', 'a/./b', 'a\\b', 'C:/bad', '.env', 'a/.env.local', 'NUL', 'a//b', 'trailing.', 'a:stream']) {
  test('P1-05 malicious member ' + JSON.stringify(name) + ' rejected before any extraction', () => {
    const a = artifact('new-release', [{ name }]); assert.equal(verifyArchive(a.bytes, a.approval).ok, false);
  });
}
for (const type of ['1', '2', '3', '5', '6', 'x', 'g', 'L']) test('P1-05 link/device/directory/extension type ' + type + ' rejected', () => {
  const a = artifact('new-release', [{ name: 'safe.txt', type, link: type === '2' ? '/outside' : '' }]);
  assert.equal(verifyArchive(a.bytes, a.approval).ok, false);
});

test('P1-06 checksum, member digest, duplicate/case/parent paths and tar end are checked', () => {
  for (const names of [['a', 'a'], ['A', 'a'], ['a', 'a/b']]) {
    const a = artifact('new-release', names.map((name) => ({ name })));
    assert.equal(verifyArchive(a.bytes, a.approval).ok, false);
  }
  const a = artifact(); a.approval.files[0].sha256 = '0'.repeat(64);
  assert.equal(verifyArchive(a.bytes, a.approval).code, 'MANIFEST_MISMATCH');
  for (const kind of ['checksum', 'end']) {
    const raw = makeTar([{ name: 'a' }], kind !== 'end'); if (kind === 'checksum') raw[0] ^= 1;
    const bytes = gzipSync(raw), approval = artifact('new-release', [{ name: 'a' }]).approval; approval.archiveSha256 = digest(bytes);
    assert.equal(verifyArchive(bytes, approval).ok, false);
  }
});

test('P1-07 compressed/expanded caps and immutable approval metadata', () => {
  const a = artifact();
  assert.equal(verifyArchive(Buffer.alloc(LIMITS.compressed + 1), a.approval).code, 'ARCHIVE_SIZE');
  const bomb = gzipSync(Buffer.alloc(LIMITS.expanded + 1));
  assert.equal(verifyArchive(bomb, { ...a.approval, archiveSha256: digest(bomb) }).code, 'INVALID_OR_OVERSIZED_GZIP');
  let getterCalls = 0;
  const bad = { ...a.approval }; Object.defineProperty(bad, 'files', { get() { getterCalls++; throw Error('secret'); } });
  assert.equal(verifyArchive(a.bytes, bad).ok, false); assert.equal(getterCalls, 0);
});

for (const point of ['beforePrepare', 'midPrepare', 'afterPrepared']) test('P1-08 ' + point + ' retains current; no automatic recovery/retry', async () => {
  const f = fixture(), before = treeFingerprint(path.join(f.target.root, 'current')); f.target.upload(f.plan, f.next.bytes);
  const run = await f.target.activate(f.plan, { fault: point });
  assert.equal(run.state, 'RECOVERY_REQUIRED'); assert.equal(treeFingerprint(path.join(f.target.root, 'current')), before);
  assert.equal(f.target.inspectRecovery(f.plan).state, 'NOT_ACTIVATED_OBSERVED');
  const failed = treeFingerprint(f.target.root);
  assert.equal((await f.target.activate(f.plan)).code, 'LOCK_HELD');
  assert.equal(treeFingerprint(f.target.root), failed);
});
for (const point of ['afterIntent', 'afterPrevious', 'afterCurrent']) test('P1-09 ' + point + ' is UNKNOWN until explicit inspection, never blind rollback', async () => {
  const f = fixture(); f.target.upload(f.plan, f.next.bytes);
  assert.equal((await f.target.activate(f.plan, { fault: point })).state, 'UNKNOWN_OUTCOME');
  const before = treeFingerprint(f.target.root), observed = f.target.inspectRecovery(f.plan);
  assert.equal(observed.state, 'RECOVERY_REQUIRED'); assert.equal(observed.retryAllowed, false);
  assert.equal(treeFingerprint(f.target.root), before);
});

test('P1-10 lost ACK after COMMITTED stays UNKNOWN; authoritative mock reconciliation is read-only', async () => {
  const f = fixture(); f.target.upload(f.plan, f.next.bytes);
  assert.equal((await f.target.activate(f.plan, { fault: 'afterCommit' })).state, 'UNKNOWN_OUTCOME');
  assert.equal(readJournal(f.target.root).rows.at(-1).state, 'UNKNOWN_OUTCOME');
  const before = treeFingerprint(f.target.root);
  const observed = openFakeTarget(sandbox.root, f.targetId).inspectRecovery(f.plan);
  assert.equal(observed.state, 'ACTIVATED_OBSERVED'); assert.equal(observed.retryAllowed, false);
  assert.equal((await f.target.activate(f.plan)).code, 'LOCK_HELD');
  assert.equal(treeFingerprint(f.target.root), before);
});

test('P1-11 concurrent handles serialize on disk; competing activation cannot touch prepared/current', async () => {
  const f = fixture(); f.target.upload(f.plan, f.next.bytes);
  let release, entered;
  const ready = new Promise((r) => { entered = r; }), pause = new Promise((r) => { release = r; });
  const first = f.target.activate(f.plan, { onPhase: async (phase) => { if (phase === 'afterPrepared') { entered(); await pause; } } });
  await ready;
  const before = treeFingerprint(f.target.root);
  const competitor = await openFakeTarget(sandbox.root, f.targetId).activate(f.plan);
  assert.equal(competitor.code, 'LOCK_HELD'); assert.equal(treeFingerprint(f.target.root), before);
  release(); assert.equal((await first).ok, true);
});

test('P1-12 owner/fence tampering blocks stale writer before mutation and journal append', async () => {
  const f = fixture(); f.target.upload(f.plan, f.next.bytes);
  const before = treeFingerprint(path.join(f.target.root, 'current'));
  const run = await f.target.activate(f.plan, { onPhase(phase) {
    if (phase === 'afterPrepared') {
      const file = path.join(f.target.root, 'activation.lock/owner.json'), owner = JSON.parse(fs.readFileSync(file));
      fs.writeFileSync(file, JSON.stringify({ ...owner, fence: owner.fence + 1, ownerId: 'other-owner' }));
    }
  } });
  assert.equal(run.state, 'RECOVERY_REQUIRED'); assert.equal(treeFingerprint(path.join(f.target.root, 'current')), before);
  assert.equal(readJournal(f.target.root).rows.at(-1).state, 'PREPARED');
});

test('P1-11b a separate process cannot bypass the activation lock', async () => {
  const f = fixture(); f.target.upload(f.plan, f.next.bytes);
  const modules = ['activation-plan', 'fake-target'].map((n) => new URL('../scripts/cms-deploy/release002/' + n + '.mjs', import.meta.url).href);
  let competitor;
  const run = await f.target.activate(f.plan, { onPhase(phase) {
    if (phase !== 'afterPrepared') return;
    const code = 'const [a,b,root,id,request]=process.argv.slice(1);const {createActivationPlan}=await import(a);const {openFakeTarget}=await import(b);console.log(JSON.stringify(await openFakeTarget(root,id).activate(createActivationPlan(JSON.parse(request)).plan)));';
    competitor = spawnSync(process.execPath, ['--input-type=module', '-e', code, ...modules, sandbox.root, f.targetId, JSON.stringify(f.request)], {
      cwd: sandbox.root, env: { SystemRoot: process.env.SystemRoot ?? '', TMP: sandbox.root, TEMP: sandbox.root }, encoding: 'utf8', timeout: 10000,
    });
  } });
  assert.equal(competitor.status, 0, competitor.stderr);
  assert.equal(JSON.parse(competitor.stdout).code, 'LOCK_HELD'); assert.equal(run.ok, true);
});

for (const damage of ['torn-tail', 'hash', 'complete-line-truncation', 'pending-head', 'missing-head', 'duplicate-key']) test('P1-13 journal ' + damage + ' prevents a false recovery success', async () => {
  const f = fixture(); f.target.upload(f.plan, f.next.bytes); await f.target.activate(f.plan, { fault: 'afterCommit' });
  const log = path.join(f.target.root, 'journal.ndjson'), original = fs.readFileSync(log, 'utf8');
  if (damage === 'torn-tail') fs.appendFileSync(log, '{');
  if (damage === 'hash') fs.writeFileSync(log, original.replace('new-release', 'bad-release'));
  if (damage === 'complete-line-truncation') fs.writeFileSync(log, original.slice(0, original.lastIndexOf('\n', original.length - 2) + 1));
  if (damage === 'pending-head') fs.writeFileSync(path.join(f.target.root, 'journal-head.next'), '{}');
  if (damage === 'missing-head') fs.unlinkSync(path.join(f.target.root, 'journal-head.json'));
  if (damage === 'duplicate-key') fs.writeFileSync(log, original.replace('{"version":1,', '{"version":1,"version":1,'));
  assert.equal(readJournal(f.target.root).ok, false);
  const before = treeFingerprint(f.target.root);
  assert.equal(f.target.inspectRecovery(f.plan).state, 'RECOVERY_REQUIRED');
  assert.equal(treeFingerprint(f.target.root), before);
});

test('P1-14 incomplete current/previous and partial prepared tree never gain success', async () => {
  for (const location of ['current', 'previous', 'prepared']) {
    const f = fixture(); f.target.upload(f.plan, f.next.bytes);
    const run = await f.target.activate(f.plan, { onPhase(phase) {
      const at = location === 'previous' ? 'afterCommit' : 'afterPrepared';
      if (phase === at) fs.unlinkSync(path.join(f.target.root, location, 'files/server.js'));
    } });
    assert.equal(run.ok, false); assert.equal(run.retryAllowed, false);
    const recovery = f.target.inspectRecovery(f.plan);
    assert.equal(recovery.state, 'RECOVERY_REQUIRED'); assert.equal(recovery.retryAllowed, false);
  }
});

test('P1-15 pre-existing previous or abandoned preparation is never overwritten', async () => {
  for (const name of ['previous', 'prepared']) {
    const f = fixture(); fs.mkdirSync(path.join(f.target.root, name)); fs.writeFileSync(path.join(f.target.root, name, 'keep'), 'evidence');
    f.target.upload(f.plan, f.next.bytes);
    const before = treeFingerprint(path.join(f.target.root, 'current'));
    assert.equal((await f.target.activate(f.plan)).state, 'RECOVERY_REQUIRED');
    assert.equal(fs.readFileSync(path.join(f.target.root, name, 'keep'), 'utf8'), 'evidence');
    assert.equal(treeFingerprint(path.join(f.target.root, 'current')), before);
  }
});

test('P1-16 plan cannot be forged or changed through caller objects; no credentials needed', async () => {
  const f = fixture();
  f.request.artifact.releaseId = 'tampered'; f.request.expectedCurrent.releaseId = 'tampered';
  assert.equal(f.target.upload({ ...f.plan }, f.next.bytes).ok, false);
  assert.equal(f.target.upload(f.plan, f.next.bytes).ok, true);
  assert.equal((await f.target.activate(f.plan)).ok, true);
});

for (const source of ['RUNTIME_KEYSCAN', 'TOFU', 'PR_BODY', '']) test('P1-17 host key ' + source + ' is not independently verified', () => {
  const f = fixture(); assert.equal(checkHostKeyPolicy({ ...f.request.hostKey, source }).ok, false);
  assert.equal(createActivationPlan({ ...f.request, hostKey: { ...f.request.hostKey, source } }).ok, false);
});
test('P1-17 protected pin metadata is only synthetic evidence, never a live host claim', () => {
  const f = fixture(), checked = checkHostKeyPolicy(f.request.hostKey);
  assert.equal(checked.ok, true); assert.equal(checked.liveHostVerified, false);
  assert.equal(checked.evidence, 'SYNTHETIC_POLICY_ONLY');
});

test('P1-18 journal writes require owner lock; live paths and arbitrary existing roots are rejected', () => {
  const f = fixture(); assert.throws(() => appendJournal(f.target.root, {}, 'COMMITTED'));
  assert.throws(() => createMockSandbox(sandbox.root));
  assert.throws(() => openFakeTarget(path.dirname(sandbox.root), f.targetId));
});

test('P1-19 modules import without target I/O or network/SSH entrypoint', () => {
  const moduleDir = fileURLToPath(new URL('../scripts/cms-deploy/release002/', import.meta.url));
  const imports = ['archive-integrity', 'activation-plan', 'release-journal', 'fake-target'].map((n) => pathToFileURL(path.join(moduleDir, n + '.mjs')).href);
  const before = treeFingerprint(sandbox.root);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', 'for (const p of process.argv.slice(1)) await import(p)', ...imports], {
    cwd: sandbox.root, env: { SystemRoot: process.env.SystemRoot ?? '', TMP: sandbox.root, TEMP: sandbox.root }, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout, '');
  assert.equal(treeFingerprint(sandbox.root), before);
  for (const n of imports) assert.doesNotMatch(fs.readFileSync(fileURLToPath(n), 'utf8'), /from ['"]node:(?:child_process|http|https|net|tls|dgram)['"]|\bfetch\s*\(/);
});

test('P1-20 hash-correct malicious tar is rejected at target before lock/preparation', async () => {
  const f = fixture(), malicious = artifact('new-release', [{ name: 'server.js', type: '2', link: '/outside' }]);
  const made = createActivationPlan({ ...f.request, artifact: malicious.approval });
  assert.equal(made.ok, true); // approved digest is not a license to extract a link
  assert.equal(f.target.upload(made.plan, malicious.bytes).ok, true);
  const before = treeFingerprint(f.target.root);
  assert.equal((await f.target.activate(made.plan)).code, 'UNSUPPORTED_TAR_ENTRY');
  assert.equal(treeFingerprint(f.target.root), before);
  assert.equal(fs.existsSync(path.join(f.target.root, 'prepared')), false);
});

test('BUG001-01 corrupt journal before first acquisition creates no orphan lock or repair', async () => {
  const f = fixture(); f.target.upload(f.plan, f.next.bytes);
  const lock = path.join(f.target.root, 'activation.lock');
  fs.appendFileSync(path.join(f.target.root, 'journal.ndjson'), '{');
  const before = treeFingerprint(f.target.root);
  assert.equal(readJournal(f.target.root).ok, false);
  for (let i = 0; i < 2; i++) {
    const run = await f.target.activate(f.plan);
    assert.equal(run.state, 'RECOVERY_REQUIRED'); assert.equal(run.retryAllowed, false);
    assert.equal(fs.existsSync(lock), false);
    assert.equal(treeFingerprint(f.target.root), before);
  }
});

test('BUG001-02 valid non-ACKNOWLEDGED terminal journal creates no orphan lock', async () => {
  const f = fixture(); f.target.upload(f.plan, f.next.bytes);
  await f.target.activate(f.plan, { fault: 'beforePrepare' });
  const lock = path.join(f.target.root, 'activation.lock');
  assert.equal(readJournal(f.target.root).ok, true);
  assert.equal(readJournal(f.target.root).rows.at(-1).state, 'RECOVERY_REQUIRED');
  // Fixture-only simulate a missing lock; the implementation must not recreate or repair it.
  fs.unlinkSync(path.join(lock, 'owner.json')); fs.rmdirSync(lock);
  const before = treeFingerprint(f.target.root);
  const run = await f.target.activate(f.plan);
  assert.equal(run.state, 'RECOVERY_REQUIRED'); assert.equal(run.retryAllowed, false);
  assert.equal(fs.existsSync(lock), false);
  assert.equal(treeFingerprint(f.target.root), before);
});

// Faults intercept only the named synthetic fixture path/descriptor. Restore even when an
// assertion fails; no production paths, permissions or process-global configuration change.
function mockFs(t, name, replacement) {
  const original = mutableFs[name];
  t.mock.method(mutableFs, name, replacement(original));
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
}

test('BUG001-03 journal is revalidated under lock; precheck cannot authorize changed evidence', async () => {
  const f = fixture(); f.target.upload(f.plan, f.next.bytes);
  const lock = path.join(f.target.root, 'activation.lock'), log = path.join(f.target.root, 'journal.ndjson');
  assert.equal(readJournal(f.target.root).ok, true);
  const beforeCurrent = treeFingerprint(path.join(f.target.root, 'current'));
  let visited = false;
  const run = await f.target.activate(f.plan, { onPhase(phase) {
    if (phase !== 'beforeOwnerPublication') return;
    visited = true; assert.deepEqual(fs.readdirSync(lock), []);
    fs.appendFileSync(log, '{'); // synthetic change after the unlocked precheck
  } });
  assert.equal(visited, true); assert.equal(run.state, 'RECOVERY_REQUIRED');
  assert.equal(run.failurePhase, 'LOCKED_JOURNAL_CHECK'); assert.equal(run.cleanup.status, 'REMOVED');
  assert.equal(fs.existsSync(lock), false); assert.equal(readJournal(f.target.root).ok, false);
  assert.equal(fs.readFileSync(log, 'utf8'), '{');
  assert.equal(treeFingerprint(path.join(f.target.root, 'current')), beforeCurrent);
});

for (const failure of ['hook', 'owner-open']) test('BUG001-04 ' + failure + ' exception before owner creation removes only its empty lock', async (t) => {
  const f = fixture(); f.target.upload(f.plan, f.next.bytes);
  const lock = path.join(f.target.root, 'activation.lock'), owner = path.join(lock, 'owner.json');
  const before = treeFingerprint(f.target.root);
  let faults = 0;
  if (failure === 'owner-open') mockFs(t, 'openSync', (original) => (...args) => {
    if (args[0] === owner && args[1] === 'wx') { faults++; throw Object.assign(Error('synthetic owner-open denial'), { code: 'EACCES' }); }
    return original(...args);
  });
  const run = await f.target.activate(f.plan, { onPhase(phase) {
    if (failure === 'hook' && phase === 'beforeOwnerPublication') { faults++; throw Error('synthetic pre-owner failure'); }
  } });
  assert.equal(faults, 1); assert.equal(run.state, 'RECOVERY_REQUIRED'); assert.equal(run.retryAllowed, false);
  assert.equal(run.cleanup.status, 'REMOVED'); assert.equal(fs.existsSync(lock), false);
  assert.equal(treeFingerprint(f.target.root), before);
});

test('BUG001-05 partial owner-file write is retained as explicit unresolved evidence', async (t) => {
  const f = fixture(); f.target.upload(f.plan, f.next.bytes);
  const lock = path.join(f.target.root, 'activation.lock'), owner = path.join(lock, 'owner.json');
  let ownerFd, faults = 0;
  mockFs(t, 'openSync', (original) => (...args) => {
    const fd = original(...args); if (args[0] === owner && args[1] === 'wx') ownerFd = fd; return fd;
  });
  mockFs(t, 'writeFileSync', (original) => (...args) => {
    if (ownerFd !== undefined && args[0] === ownerFd) {
      faults++; original(ownerFd, '{'); throw Object.assign(Error('synthetic partial write'), { code: 'EIO' });
    }
    return original(...args);
  });
  const run = await f.target.activate(f.plan);
  assert.equal(faults, 1); assert.equal(run.state, 'RECOVERY_REQUIRED');
  assert.equal(run.code, 'PREOWNERSHIP_CLEANUP_UNRESOLVED');
  assert.deepEqual(run.cleanup, { status: 'RETAINED', code: 'LOCK_NOT_EMPTY' });
  assert.equal(fs.readFileSync(owner, 'utf8'), '{'); assert.deepEqual(readJournal(f.target.root).rows, []);
  const before = treeFingerprint(f.target.root), observed = f.target.inspectRecovery(f.plan);
  assert.equal(observed.state, 'RECOVERY_REQUIRED'); assert.equal(observed.lockEvidence.state, 'INVALID_OR_UNREADABLE_LOCK');
  assert.equal((await f.target.activate(f.plan)).code, 'LOCK_HELD');
  assert.equal(treeFingerprint(f.target.root), before);
});

test('BUG001-06 empty-lock cleanup syscall failure is reported, never disguised as successful cleanup', async (t) => {
  const f = fixture(); f.target.upload(f.plan, f.next.bytes);
  const lock = path.join(f.target.root, 'activation.lock');
  let failures = 0;
  mockFs(t, 'rmdirSync', (original) => (...args) => {
    if (args[0] === lock) { failures++; throw Object.assign(Error('synthetic cleanup denial'), { code: 'EACCES' }); }
    return original(...args);
  });
  const run = await f.target.activate(f.plan, { onPhase(phase) { if (phase === 'beforeOwnerPublication') throw Error('pre-owner'); } });
  assert.equal(failures, 1); assert.equal(run.state, 'RECOVERY_REQUIRED'); assert.equal(run.retryAllowed, false);
  assert.equal(run.code, 'PREOWNERSHIP_CLEANUP_UNRESOLVED');
  assert.deepEqual(run.cleanup, { status: 'FAILED', code: 'PREOWNERSHIP_CLEANUP_FAILED', step: 'REMOVE_EMPTY_DIRECTORY', removed: false, systemCode: 'EACCES' });
  assert.deepEqual(fs.readdirSync(lock), []);
  const before = treeFingerprint(f.target.root), observed = f.target.inspectRecovery(f.plan);
  assert.equal(observed.lockEvidence.state, 'EMPTY_OWNERLESS'); assert.equal(observed.state, 'RECOVERY_REQUIRED');
  assert.equal((await f.target.activate(f.plan)).code, 'LOCK_HELD');
  assert.equal(treeFingerprint(f.target.root), before); assert.equal(failures, 1);
});

test('BUG001-07 completed ownership publication is retained even if the next directory sync fails', async (t) => {
  const f = fixture(); f.target.upload(f.plan, f.next.bytes);
  const lock = path.join(f.target.root, 'activation.lock'); let failures = 0;
  mockFs(t, 'openSync', (original) => (...args) => {
    if (args[0] === lock && args[1] === 'r') { failures++; throw Object.assign(Error('synthetic directory I/O'), { code: 'EIO' }); }
    return original(...args);
  });
  const run = await f.target.activate(f.plan);
  assert.equal(failures, 1); assert.equal(run.state, 'RECOVERY_REQUIRED');
  assert.deepEqual(run.cleanup, { status: 'NOT_ATTEMPTED', code: 'OWNERSHIP_PUBLISHED' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'))).operationId, f.request.operationId);
  assert.deepEqual(readJournal(f.target.root).rows, []);
  const before = treeFingerprint(f.target.root), observed = f.target.inspectRecovery(f.plan);
  assert.equal(observed.lockEvidence.state, 'OWNED_OPERATION'); assert.equal(observed.state, 'RECOVERY_REQUIRED');
  assert.equal(treeFingerprint(f.target.root), before);
});

test('BUG001-08 an empty ownerless lock already on entry is never adopted or cleared', async () => {
  const f = fixture(); f.target.upload(f.plan, f.next.bytes);
  const lock = path.join(f.target.root, 'activation.lock'); fs.mkdirSync(lock);
  const before = treeFingerprint(f.target.root);
  const run = await f.target.activate(f.plan, { onPhase() { assert.fail('existing lock must block before phase callbacks'); } });
  assert.equal(run.code, 'LOCK_HELD'); assert.equal(run.retryAllowed, false);
  const observed = openFakeTarget(sandbox.root, f.targetId).inspectRecovery(f.plan);
  assert.equal(observed.state, 'RECOVERY_REQUIRED'); assert.equal(observed.lockEvidence.state, 'EMPTY_OWNERLESS');
  assert.equal(treeFingerprint(f.target.root), before);
});

test('BUG001-09 replacement empty directory is not the invocation lock and cannot be removed', async () => {
  const f = fixture(); f.target.upload(f.plan, f.next.bytes);
  const lock = path.join(f.target.root, 'activation.lock'), held = path.join(f.target.root, 'displaced-lock');
  const run = await f.target.activate(f.plan, { onPhase(phase) {
    if (phase !== 'beforeOwnerPublication') return;
    fs.renameSync(lock, held); fs.mkdirSync(lock); throw Error('synthetic replacement race');
  } });
  assert.equal(run.state, 'RECOVERY_REQUIRED'); assert.equal(run.code, 'PREOWNERSHIP_CLEANUP_UNRESOLVED');
  assert.deepEqual(run.cleanup, { status: 'RETAINED', code: 'LOCK_IDENTITY_NOT_VERIFIED' });
  assert.deepEqual(fs.readdirSync(lock), []); assert.deepEqual(fs.readdirSync(held), []);
});

test('BUG001-10 two competing requests preserve the unpublished lock until its creator unwinds', async () => {
  const f = fixture(); f.target.upload(f.plan, f.next.bytes);
  const lock = path.join(f.target.root, 'activation.lock'); let release, entered;
  const ready = new Promise((r) => { entered = r; }), pause = new Promise((r) => { release = r; });
  const first = f.target.activate(f.plan, { onPhase: async (phase) => {
    if (phase === 'beforeOwnerPublication') { entered(); await pause; throw Error('synthetic pre-owner exception'); }
  } });
  await ready;
  try {
    const before = treeFingerprint(f.target.root);
    const second = await openFakeTarget(sandbox.root, f.targetId).activate(f.plan);
    assert.equal(second.code, 'LOCK_HELD'); assert.equal(treeFingerprint(f.target.root), before);
    assert.equal(f.target.inspectRecovery(f.plan).lockEvidence.state, 'EMPTY_OWNERLESS');
  } finally { release(); }
  const failed = await first;
  assert.equal(failed.state, 'RECOVERY_REQUIRED'); assert.equal(failed.cleanup.status, 'REMOVED');
  assert.equal(failed.retryAllowed, false); assert.equal(fs.existsSync(lock), false);
  assert.deepEqual(readJournal(f.target.root).rows, []);
});

test('BUG001-11 COMMITTED then lost ACK retains owned lock and UNKNOWN_OUTCOME; inspector never retries', async () => {
  const f = fixture(); f.target.upload(f.plan, f.next.bytes);
  const run = await f.target.activate(f.plan, { fault: 'afterCommit' });
  assert.equal(run.state, 'UNKNOWN_OUTCOME'); assert.equal(run.retryAllowed, false);
  assert.deepEqual(run.cleanup, { status: 'NOT_ATTEMPTED', code: 'OWNERSHIP_PUBLISHED' });
  assert.equal(fs.existsSync(path.join(f.target.root, 'activation.lock/owner.json')), true);
  const before = treeFingerprint(f.target.root), observed = f.target.inspectRecovery(f.plan);
  assert.equal(observed.lockEvidence.state, 'OWNED_OPERATION'); assert.equal(observed.state, 'ACTIVATED_OBSERVED');
  assert.equal(observed.retryAllowed, false); assert.equal(run.state, 'UNKNOWN_OUTCOME');
  assert.equal((await f.target.activate(f.plan)).code, 'LOCK_HELD'); assert.equal(treeFingerprint(f.target.root), before);
});

test('BUG001-12 failure to sync after removing an empty lock still reports unresolved cleanup', async (t) => {
  const f = fixture(); f.target.upload(f.plan, f.next.bytes);
  const lock = path.join(f.target.root, 'activation.lock'); let failures = 0;
  mockFs(t, 'openSync', (original) => (...args) => {
    if (args[0] === f.target.root && args[1] === 'r' && !fs.existsSync(lock)) {
      failures++; throw Object.assign(Error('synthetic cleanup sync error'), { code: 'EIO' });
    }
    return original(...args);
  });
  const run = await f.target.activate(f.plan, { onPhase(phase) { if (phase === 'beforeOwnerPublication') throw Error('pre-owner'); } });
  assert.equal(failures, 1); assert.equal(run.state, 'RECOVERY_REQUIRED');
  assert.equal(run.code, 'PREOWNERSHIP_CLEANUP_UNRESOLVED'); assert.equal(run.retryAllowed, false);
  assert.deepEqual(run.cleanup, { status: 'FAILED', code: 'PREOWNERSHIP_CLEANUP_FAILED', step: 'SYNC_PARENT', removed: true, systemCode: 'EIO' });
  assert.equal(fs.existsSync(lock), false); assert.deepEqual(readJournal(f.target.root).rows, []);
});

test('BUG001-13 another operation owns the existing lock; activation and inspection preserve it', async () => {
  const f = fixture(); f.target.upload(f.plan, f.next.bytes);
  await f.target.activate(f.plan, { fault: 'beforePrepare' });
  const otherPlan = createActivationPlan({ ...f.request, operationId: 'different-operation', ownerId: 'other-owner' }).plan;
  assert.equal(f.target.upload(otherPlan, f.next.bytes).ok, true);
  const before = treeFingerprint(f.target.root);
  assert.equal((await f.target.activate(otherPlan)).code, 'LOCK_HELD');
  const observed = f.target.inspectRecovery(otherPlan);
  assert.equal(observed.state, 'RECOVERY_REQUIRED'); assert.equal(observed.lockEvidence.state, 'OWNED_OTHER_OPERATION');
  assert.equal(treeFingerprint(f.target.root), before);
});
