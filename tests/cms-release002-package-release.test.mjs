// Local synthetic P15 tests. Never builds Next, executes an archive, or deploys.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { syncBuiltinESMExports } from 'node:module';
import childProcess from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import { fileURLToPath } from 'node:url';
import {
  SOURCE, PROFILE, SANDBOX_MARKER, validateArchivePath, validateMeasurements,
  fingerprintSyntheticInventory, buildSyntheticPackage, verifySyntheticPackage,
  collectSyntheticFixture, writeSyntheticFixture,
} from '../scripts/cms-deploy/release002/package-release.mjs';

const sourceURL = new URL('../scripts/cms-deploy/release002/package-release.mjs', import.meta.url);
const sha = b => createHash('sha256').update(b).digest('hex');
const toolingSha = sha(fs.readFileSync(sourceURL));
const byteSort = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort(byteSort).map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const json = v => Buffer.from(canonical(v));
const moduleBytes = references => json({ kind: 'P15_SYNTHETIC_MODULE_V1', references });
function fixture() {
  const r = { kind: 'P15_SYNTHETIC_INPUT_V1', sourceSha: SOURCE.sha, sourceTree: SOURCE.tree,
    buildId: 'fixture-review', tooling: { state: 'UNCOMMITTED', sha256: toolingSha },
    target: { platform: 'linux', architecture: 'x64', libc: 'glibc' },
    entries: [], classifications: [], nativeAllowlist: [], requiredPaths: ['runtime/main.fixture.json', 'public/logo.txt'],
    entrypoint: 'runtime/main.fixture.json' };
  add(r, 'public/logo.txt', 'synthetic-logo');
  add(r, 'runtime/main.fixture.json', moduleBytes(['public/logo.txt']), { format: 'fixture-module' }); return r;
}
function add(r, p, bytes, options = {}) {
  const segments = p.split('/'); segments.pop();
  while (segments.length) {
    const parent = segments.join('/');
    if (!r.entries.some(e => e.path === parent)) r.entries.push({ path: parent, type: 'directory', mode: 0o755 }); segments.pop();
  }
  r.entries.push({ path: p, type: 'file', mode: 0o644, bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes) });
  r.classifications.push({ path: p, disposition: 'RUNTIME', format: 'asset', packageName: null, packageVersion: null,
    reason: 'explicit synthetic fixture', ...options }); return r;
}
function addPackage(r, root, name, files = [], version = '1.0.0') {
  add(r, root + '/package.json', json({ name, version }), { format: 'package', packageName: name, packageVersion: version });
  for (const f of files) add(r, root + '/' + f.path, f.bytes ?? 'synthetic package ' + name,
    { packageName: name, packageVersion: version, ...f.options }); return r;
}
function expected(r) {
  // Independent digest construction; do not rely on the implementation's
  // inventory parser to create the expected source binding for negative tests.
  const entries = r.entries.map(e => ({ path: e.path, type: e.type, mode: e.mode,
    size: e.type === 'file' ? e.bytes.length : 0, sha256: e.type === 'file' ? sha(e.bytes) : null })).sort((a, b) => byteSort(a.path, b.path));
  const plan = { classifications: [...r.classifications].sort((a, b) => byteSort(a.path, b.path)),
    nativeAllowlist: [...r.nativeAllowlist].sort((a, b) => byteSort(a.path, b.path)),
    requiredPaths: [...r.requiredPaths].sort(byteSort), entrypoint: r.entrypoint, target: r.target };
  return { sourceSha: SOURCE.sha, sourceTree: SOURCE.tree, buildId: 'fixture-review', toolingSha256: toolingSha,
    inputSha256: sha(json(entries)), planSha256: sha(json(plan)) };
}
function build(r = fixture()) { return buildSyntheticPackage(r, expected(r)); }
function ok(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result; }
function denied(result, code) {
  assert.equal(result.ok, false, `unexpected success for ${code}`); if (code) assert.equal(result.code, code);
  assert.equal(result.authorization, 'NONE'); assert.equal(result.realBuildArchive, 'HOLD'); assert.equal(result.activation, 'NOT_AUTHORIZED'); return result;
}
function verified(c) { return verifySyntheticPackage({ archive: c.archive, manifest: c.manifest }, c.binding); }
function manifest(c) { return JSON.parse(c.manifest.toString('utf8')); }
function decodeTar(archive) {
  // Independent inspection, including payloads, to test actual encoded output.
  const tar = gunzipSync(archive), entries = []; let pos = 0;
  const field = (h, start, length) => h.subarray(start, start + length).toString('utf8').replace(/\0.*$/su, '');
  while (!tar.subarray(pos, pos + 512).every(b => b === 0)) {
    const h = tar.subarray(pos, pos + 512), n = Number.parseInt(field(h, 124, 12), 8), prefix = field(h, 345, 155);
    entries.push({ name: (prefix ? prefix + '/' : '') + field(h, 0, 100), type: String.fromCharCode(h[156]),
      bytes: tar.subarray(pos + 512, pos + 512 + n), offset: pos, header: h }); pos += 512 + Math.ceil(n / 512) * 512;
  }
  assert.equal(tar.length - pos, 1024); return { tar, entries };
}
function tarAttack(c, mutate) {
  const tar = mutate(Buffer.from(gunzipSync(c.archive))), archive = gzipSync(tar, { level: 9, mtime: 0 }); archive[9] = 255;
  const m = manifest(c); m.tarSha256 = sha(tar); m.gzipSha256 = sha(archive); const meta = json(m);
  return { archive, manifest: meta, binding: { ...c.binding, tarSha256: sha(tar), gzipSha256: sha(archive), manifestSha256: sha(meta) } };
}
function checksum(h) {
  h.fill(32, 148, 156); const n = h.reduce((a, b) => a + b, 0); h.write(n.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
}
function elf(arch = 'x64') {
  const b = Buffer.alloc(64); b.set([127, 69, 76, 70, 2, 1, 1, 0]); b.writeUInt16LE(3, 16);
  b.writeUInt16LE(arch === 'x64' ? 62 : 183, 18); b.writeUInt32LE(1, 20); b.writeUInt16LE(64, 52); return b;
}
function nativeFixture() {
  const r = fixture(), p = 'node_modules/synthetic-native/addon.node';
  addPackage(r, 'node_modules/synthetic-native', 'synthetic-native', [{ path: 'addon.node', bytes: elf(), options: { format: 'native' } }]);
  r.nativeAllowlist.push({ path: p, packageName: 'synthetic-native', packageVersion: '1.0.0', ...r.target,
    sha256: sha(elf()), justification: 'synthetic header fixture only; no ABI attestation' });
  r.requiredPaths.push(p); return r;
}

const configured = process.env.P15_TEST_SCRATCH;
if (configured && !path.isAbsolute(configured)) throw new Error('P15_TEST_SCRATCH must be absolute');
const scratchParent = path.resolve(configured ?? tmpdir());
const scratch = path.join(scratchParent, 'p15-synthetic-' + randomUUID());
fs.mkdirSync(scratch, { recursive: false }); fs.writeFileSync(path.join(scratch, '.lkc-p15-sandbox'), SANDBOX_MARKER, { flag: 'wx' });
// Keep synthetic output for independent review; no recursive cleanup of caller paths.
let serial = 0;
function diskFixture() {
  const root = path.join(scratch, 'fixture-' + (++serial)); fs.mkdirSync(root); fs.mkdirSync(path.join(root, 'public'));
  fs.writeFileSync(path.join(root, 'public', 'note.txt'), 'synthetic'); return root;
}
function patchMethods(changes, fn) {
  const saved = changes.map(([o, k, replacement]) => { const v = o[k]; o[k] = replacement; return [o, k, v]; });
  syncBuiltinESMExports();
  try { return fn(); } finally { for (const [o, k, v] of saved) o[k] = v; syncBuiltinESMExports(); }
}

test('P15 provenance: integration source, uncommitted tooling and separate tar/gzip/manifest hashes', () => {
  const c = ok(build()), m = manifest(c); ok(verified(c));
  assert.equal(m.identity.sourceSha, '982a4c6b1a7c97cb997940b3bd8a09efbb8a9275');
  assert.equal(m.identity.sourceTree, '6e9eead6e2ec3add0d12bc7617a250792948037c');
  assert.deepEqual(m.identity.tooling, { state: 'UNCOMMITTED', sha256: toolingSha });
  assert.equal(c.binding.tarSha256, sha(gunzipSync(c.archive))); assert.equal(c.binding.gzipSha256, sha(c.archive));
  assert.equal(c.binding.manifestSha256, sha(c.manifest)); assert.notEqual(c.binding.tarSha256, c.binding.gzipSha256);
  assert.equal(m.identity.authorization, 'NONE'); assert.equal(c.realRuntimeClosure, 'NOT_VERIFIED');
  assert.equal(m.closure.kind, 'DECLARATIVE_SYNTHETIC_GRAPH_ONLY');
});
for (const [name, mutate, code] of [
  ['R1 parent is not build source', r => { r.sourceSha = '5196c90e08eaa2c2d4c76d60e4b990a52c104cb2'; }, 'SOURCE_IDENTITY'],
  ['wrong source tree', r => { r.sourceTree = 'f'.repeat(40); }, 'SOURCE_IDENTITY'],
  ['stale build', r => { r.buildId = 'fixture-stale'; }, 'STALE_BUILD'],
  ['fake tooling commit', r => { r.tooling.state = 'COMMITTED'; }, 'TOOLING_IDENTITY'],
  ['wrong tooling bytes', r => { r.tooling.sha256 = '0'.repeat(64); }, 'TOOLING_IDENTITY'],
  ['real input cannot claim fixture authority', r => { r.kind = 'NEXT_BUILD'; }, 'SOURCE_IDENTITY'],
]) test('P15 identity rejects ' + name, () => { const r = fixture(); mutate(r); denied(build(r), code); });
test('P15 changed input after its independent fingerprint is rejected', () => {
  const r = fixture(), e = expected(r); r.entries.find(e => e.path === 'public/logo.txt').bytes[0] ^= 1;
  denied(buildSyntheticPackage(r, e), 'INPUT_DIGEST_MISMATCH');
});
test('P15 exclusion/native plan is separately digest-bound and visible in manifest', () => {
  const r = nativeFixture(), e = expected(r), c = ok(buildSyntheticPackage(r, e));
  assert.deepEqual(manifest(c).packagingPlan.nativeAllowlist, r.nativeAllowlist);
  assert.equal(sha(json(manifest(c).packagingPlan)), c.binding.planSha256);
  r.nativeAllowlist[0].justification = 'changed plan after independent binding';
  denied(buildSyntheticPackage(r, e), 'PACKAGING_PLAN_DIGEST_MISMATCH');
});
test('P15 plan substitution cannot reuse the unchanged input inventory digest', () => {
  const r = fixture(), e = expected(r); r.classifications[0].disposition = 'EXCLUDE';
  denied(buildSyntheticPackage(r, e), 'PACKAGING_PLAN_DIGEST_MISMATCH');
  const c = ok(build()), m = manifest(c); m.packagingPlan.target.libc = 'musl'; const b = json(m);
  denied(verifySyntheticPackage({ archive: c.archive, manifest: b }, { ...c.binding, manifestSha256: sha(b) }), 'PACKAGING_PLAN_DIGEST_MISMATCH');
});
test('P15 deterministic bytes across inventory/classification order and repeat builds', () => {
  const r = fixture(), a = ok(build(r)); r.entries.reverse(); r.classifications.reverse(); r.requiredPaths.reverse();
  const b = ok(build(r)); assert.deepEqual(a.archive, b.archive); assert.deepEqual(a.manifest, b.manifest);
  assert.deepEqual(a.archive, ok(build(r)).archive);
  const d = decodeTar(a.archive);
  assert.deepEqual(d.entries.map(e => e.name), d.entries.map(e => e.name).sort(byteSort));
  for (const e of d.entries) { assert.equal(e.header.subarray(136, 148).toString('ascii'), '00000000000\0'); assert.ok(['0', '5'].includes(e.type)); }
  assert.equal(d.tar.length, 1024 + d.entries.reduce((n, e) => n + 512 + Math.ceil(e.bytes.length / 512) * 512, 0));
  assert.equal(a.archive[9], 255); assert.equal(a.archive.readUInt32LE(4), 0);
});
test('P15 inventory digest independently agrees with exact output-bound inventory', () => {
  const r = fixture(); assert.equal(ok(fingerprintSyntheticInventory(r.entries)).sha256, expected(r).inputSha256);
});
const caps = { gzip: 134217728, tar: 268435456, file: 16777216, files: 10000, directories: 2000, manifest: 8388608 };
for (const [key, cap] of Object.entries(caps)) {
  test(`P15 numeric ${key}: zero, cap-1, cap and cap+1 / invalid counts`, () => {
    assert.equal(PROFILE[key], cap);
    const measure = value => Object.fromEntries(Object.keys(caps).map(k => [k, k === key ? value : 0]));
    for (const n of [0, cap - 1, cap]) ok(validateMeasurements(measure(n)));
    for (const n of [cap + 1, -1, 0.5, NaN, Infinity, '1']) denied(validateMeasurements(measure(n)));
  });
}
test('P15 real per-file boundary accepts 16 MiB and rejects one extra byte without truncation', () => {
  const r = fixture(); add(r, 'runtime/large.txt', Buffer.alloc(16777216, 97)); const c = ok(build(r));
  assert.equal(decodeTar(c.archive).entries.find(e => e.name === 'runtime/large.txt').bytes.length, 16777216);
  r.entries.find(e => e.path === 'runtime/large.txt').bytes = Buffer.alloc(16777217, 97); denied(build(r), 'FILE_LIMIT');
});
test('P15 real file count includes embedded identity: 10000 allowed, 10001 denied', () => {
  const r = fixture(); for (let i = 0; i < 9997; i++) add(r, `runtime/f${i}.txt`, '');
  const c = ok(build(r)); assert.equal(manifest(c).files.filter(e => e.type === 'file').length, 10000);
  add(r, 'runtime/over.txt', ''); denied(build(r), 'FILES_LIMIT');
});
test('P15 real directory inventory: 2000 allowed, 2001 denied', () => {
  const r = fixture(); for (let i = 0; i < 1998; i++) add(r, `d${i}/note.txt`, '');
  const c = ok(build(r)); assert.equal(manifest(c).files.filter(e => e.type === 'directory').length, 2000);
  add(r, 'over/note.txt', ''); denied(build(r), 'DIRECTORIES_LIMIT');
});
test('P15 container gzip/manifest overcaps rejected before decompression/parsing', () => {
  const c = ok(build());
  denied(verifySyntheticPackage({ archive: Buffer.alloc(134217729), manifest: c.manifest }, c.binding), 'GZIP_LIMIT');
  denied(verifySyntheticPackage({ archive: c.archive, manifest: Buffer.alloc(8388609) }, c.binding), 'MANIFEST_LIMIT');
});
test('P15 exclusions cannot overflow manifest cap: large reasons HOLD instead of truncation', () => {
  const r = fixture();
  for (let i = 0; i < 8500; i++) add(r, `docs/f${i}.txt`, '', { disposition: 'EXCLUDE', reason: 'a'.repeat(1024) });
  denied(build(r), 'MANIFEST_LIMIT');
});
test('P15 USTAR UTF-8 240-byte name/prefix boundary round-trips actual header', () => {
  const p = 'p'.repeat(70) + '/' + 'q'.repeat(68) + '/' + 'é'.repeat(48) + '.txt'; assert.equal(Buffer.byteLength(p), 240);
  const split = ok(validateArchivePath(p)); assert.equal(Buffer.byteLength(split.name), 100); assert.equal(Buffer.byteLength(split.prefix), 139);
  const r = fixture(); add(r, p, 'utf8-fixture'); assert.ok(decodeTar(ok(build(r)).archive).entries.some(e => e.name === p));
  denied(validateArchivePath('p' + p), 'UNSAFE_PATH');
  ok(validateArchivePath('p'.repeat(155) + '/' + 'a'.repeat(80)));
  denied(validateArchivePath('p'.repeat(156) + '/' + 'a'.repeat(80)), 'USTAR_PATH_LIMIT');
  denied(validateArchivePath('a'.repeat(101)), 'USTAR_PATH_LIMIT');
});
for (const p of ['', '/root', '../x', 'a/../x', 'a/./b', 'a//b', 'a/', 'C:/x', 'a\\b', 'a\0b', 'a\nb',
  'a:b', 'a*', 'a?', 'name.', 'con.txt', 'a/aux', 'x\ud800', 'e\u0301.txt', '.env', '.env.local', 'a/.git/config',
  'secret.pem', '.ssh/key.txt', 'uploads/real.txt']) {
  test('P15 unsafe/sensitive path rejects ' + JSON.stringify(p), () => denied(validateArchivePath(p)));
}
test('P15 precise path components allow Next brackets/scopes and non-banned substrings', () => {
  for (const p of ['src/app/[id]/page.txt', 'node_modules/@ok/sharp-tools/note.txt', 'images/sharp-logo.svg']) ok(validateArchivePath(p));
});
for (const variant of ['same', 'case', 'unicode', 'file-parent']) test('P15 collision ' + variant, () => {
  const r = fixture();
  if (variant === 'same') r.entries.push({ ...r.entries.find(e => e.path === 'public/logo.txt') });
  if (variant === 'case') add(r, 'public/LOGO.txt', 'collision');
  if (variant === 'unicode') { add(r, 'public/É.txt', 'first'); add(r, 'public/é.txt', 'second'); }
  if (variant === 'file-parent') add(r, 'public/logo.txt/child.txt', 'bad');
  denied(build(r), variant === 'file-parent' ? 'MISSING_OR_CONFLICTING_PARENT' : 'PATH_COLLISION');
});
for (const type of ['symlink', 'junction', 'reparse', 'hardlink', 'fifo', 'socket', 'device']) test('P15 inventory rejects ' + type, () => {
  const r = fixture(); r.entries[0].type = type; denied(build(r), 'LINK_OR_SPECIAL_FILE');
});
test('P15 parent omission, unsafe permissions and reserved identity are rejected', () => {
  const r = fixture(); r.entries = r.entries.filter(e => e.path !== 'public'); denied(build(r), 'MISSING_OR_CONFLICTING_PARENT');
  const s = fixture(); s.entries.find(e => e.type === 'file').mode = 0o4777; denied(build(s), 'UNSAFE_MODE');
  const u = fixture(); add(u, '__p15_synthetic_identity__.json', '{}'); denied(build(u), 'RESERVED_PATH');
});
test('P15-EX01 root, nested, relocated sharp and @img removed from actual payload by exact identity', () => {
  const r = fixture();
  addPackage(r, 'node_modules/sharp', 'sharp', [{ path: 'index.fixture.json', bytes: moduleBytes([]), options: { format: 'fixture-module' } }]);
  addPackage(r, 'node_modules/outer', 'outer');
  addPackage(r, 'node_modules/outer/node_modules/@img/sharp-linux-x64', '@img/sharp-linux-x64', [{ path: 'native.node', bytes: elf(), options: { format: 'native' } }]);
  addPackage(r, 'vendor/renamed', '@img/sharp-wasm32', [{ path: 'hidden.wasm', bytes: Buffer.from([0, 97, 115, 109]), options: { format: 'native' } }]);
  addPackage(r, 'node_modules/sharp-tools', 'sharp-tools', [{ path: 'note.txt', bytes: 'keep legitimate sharp-tools' }]);
  const c = ok(build(r)), names = decodeTar(c.archive).entries.map(e => e.name);
  assert.equal(names.some(p => /(?:^|\/)node_modules\/(?:sharp(?:\/|$)|@img(?:\/|$))/u.test(p)), false);
  assert.equal(names.some(p => p === 'vendor/renamed' || p.startsWith('vendor/renamed/')), false);
  assert.ok(names.includes('node_modules/sharp-tools/note.txt')); assert.ok(names.includes('node_modules/outer/package.json'));
  assert.equal(manifest(c).excluded.filter(e => e.reason === 'SHARP_OR_IMG_EXCLUDED').length, 6);
});
test('P15-EX01 path exclusion includes nested sharp and root @img independently', () => {
  const r = fixture(); addPackage(r, 'node_modules/@img/anything', '@img/anything');
  addPackage(r, 'node_modules/outer/node_modules/sharp', 'sharp');
  const c = ok(build(r)); assert.equal(manifest(c).excluded.length, 2);
  assert.equal(decodeTar(c.archive).entries.some(e => e.name.includes('node_modules')), false);
});
test('P15-EX01 disguised banned payload hash cannot survive relocation under innocuous package', () => {
  const r = fixture(); addPackage(r, 'node_modules/sharp', 'sharp', [{ path: 'payload.txt', bytes: 'unique banned bytes' }]);
  addPackage(r, 'vendor/innocent', 'innocent', [{ path: 'payload.txt', bytes: 'unique banned bytes' }]);
  denied(build(r), 'AMBIGUOUS_RELOCATED_COPY');
});
test('P15-EX01 package path/name disagreement and unclassified dependency HOLD', () => {
  const r = fixture(); addPackage(r, 'node_modules/innocent', 'sharp'); denied(build(r), 'PACKAGE_IDENTITY');
  const s = fixture(); add(s, 'node_modules/unknown/note.txt', 'unknown'); denied(build(s), 'UNKNOWN_DEPENDENCY');
  const t = fixture(); t.classifications.pop(); denied(build(t), 'UNCLASSIFIED_FILE');
});
test('P15 excludes docs/tests/source by explicit inventory classification, not blind extension purge', () => {
  const r = fixture();
  for (const p of ['docs/design.md', 'tests/unneeded.test.mjs', 'src/unneeded.ts']) add(r, p, 'unneeded synthetic only', { disposition: 'EXCLUDE' });
  addPackage(r, 'node_modules/runtime-helper', 'runtime-helper', [{ path: 'src/live.fixture.json', bytes: moduleBytes(['public/logo.txt']), options: { format: 'fixture-module' } }]);
  r.requiredPaths.push('node_modules/runtime-helper/src/live.fixture.json');
  const c = ok(build(r)), names = decodeTar(c.archive).entries.map(e => e.name);
  assert.ok(names.includes('node_modules/runtime-helper/src/live.fixture.json'));
  assert.equal(names.some(p => /^(?:docs|tests|src)(?:\/|$)/u.test(p)), false); assert.equal(manifest(c).excluded.length, 3);
});
test('P15-CLOSE02 excluded sharp dependency is HOLD after exclusions', () => {
  const r = fixture(); addPackage(r, 'node_modules/sharp', 'sharp');
  r.entries.find(e => e.path === r.entrypoint).bytes = moduleBytes(['node_modules/sharp/package.json']);
  denied(build(r), 'RUNTIME_CLOSURE_HOLD');
});
test('P15-CLOSE02 required data removed by caller classification is HOLD', () => {
  const r = fixture(); r.classifications.find(c => c.path === 'public/logo.txt').disposition = 'EXCLUDE'; denied(build(r), 'RUNTIME_CLOSURE_HOLD');
});
test('P15-CLOSE02 missing transitive/dynamic fixture reference is HOLD even if unreachable', () => {
  const r = fixture(); add(r, 'runtime/dynamic.fixture.json', moduleBytes(['runtime/missing.txt']), { format: 'fixture-module' });
  denied(build(r), 'RUNTIME_CLOSURE_HOLD');
});
test('P15-CLOSE02 traversal refs, duplicate refs and missing entrypoint fail closed', () => {
  for (const refs of [['../escape'], ['public/logo.txt', 'public/logo.txt']]) {
    const r = fixture(); r.entries.find(e => e.path === r.entrypoint).bytes = moduleBytes(refs); denied(build(r));
  }
  const r = fixture(); r.entrypoint = 'runtime/missing.fixture.json'; denied(build(r), 'RUNTIME_CLOSURE_HOLD');
});
test('P15-CLOSE02 cyclic supplied graph terminates; source-labelled runtime asset is retained', () => {
  const r = fixture(); add(r, 'runtime/second.fixture.json', moduleBytes([r.entrypoint]), { format: 'fixture-module' });
  r.entries.find(e => e.path === r.entrypoint).bytes = moduleBytes(['runtime/second.fixture.json', 'public/logo.txt']);
  const c = ok(build(r)); assert.equal(manifest(c).closure.checkedModules, 2); assert.equal(manifest(c).closure.reachable.length, 3);
});
test('P15 actual Next JS and opaque binary asset cannot claim declarative runtime closure', () => {
  const r = fixture(); add(r, 'server.js', 'require("next")'); denied(build(r), 'UNVERIFIED_RUNTIME_FORMAT');
  const s = fixture(); add(s, 'public/opaque.txt', Buffer.from([0xff, 0, 1])); denied(build(s), 'UNVERIFIED_RUNTIME_FORMAT');
});
test('P15-EX02 exact synthetic ELF allowlist kept; no libc/ABI or real runtime proof claimed', () => {
  const c = ok(build(nativeFixture())); ok(verified(c));
  assert.ok(decodeTar(c.archive).entries.some(e => e.name === 'node_modules/synthetic-native/addon.node'));
  assert.equal(manifest(c).closure.nativeBindings, 'SYNTHETIC_ALLOWLIST_AND_HEADER_ONLY_LIBC_NOT_ATTESTED');
  assert.equal(c.realRuntimeClosure, 'NOT_VERIFIED');
});
for (const [key, value] of [['platform', 'win32'], ['architecture', 'arm64'], ['libc', 'musl'], ['sha256', '0'.repeat(64)],
  ['packageName', 'other'], ['packageVersion', '2.0.0'], ['path', 'other.node'], ['justification', '']]) {
  test('P15-EX02 allowlist wrong ' + key + ' rejects native member', () => {
    const r = nativeFixture(); r.nativeAllowlist[0][key] = value; denied(build(r), 'NATIVE_NOT_ALLOWLISTED');
  });
}
test('P15-EX02 hash alone cannot override incompatible inspected ELF architecture', () => {
  const r = nativeFixture(), e = r.entries.find(e => e.path.endsWith('addon.node')); e.bytes = elf('arm64');
  r.nativeAllowlist[0].sha256 = sha(e.bytes); denied(build(r), 'NATIVE_HEADER_MISMATCH');
});
test('P15-EX02 relocated extensionless ELF is detected, unallowlisted variants fail closed', () => {
  const r = fixture(); add(r, 'vendor/payload.txt', elf()); denied(build(r), 'NATIVE_NOT_ALLOWLISTED');
  const s = nativeFixture(); addPackage(s, 'node_modules/second-native', 'second-native', [{ path: 'extra.node', bytes: elf(), options: { format: 'native' } }]);
  denied(build(s), 'NATIVE_NOT_ALLOWLISTED');
});
test('P15-EX02 unsupported WASM, fake native bytes and stale/unused allowlist HOLD', () => {
  for (const bytes of [Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]), Buffer.from('fake native')]) {
    const r = nativeFixture(); r.entries.find(e => e.path.endsWith('addon.node')).bytes = bytes; r.nativeAllowlist[0].sha256 = sha(bytes);
    denied(build(r), 'NATIVE_HEADER_MISMATCH');
  }
  const r = nativeFixture(); r.classifications.find(c => c.path.endsWith('addon.node')).disposition = 'EXCLUDE'; denied(build(r), 'UNUSED_NATIVE_ALLOWLIST');
});
test('P15-EX02 native allowlist cannot authorize sharp package', () => {
  const r = nativeFixture(); r.nativeAllowlist[0].packageName = 'sharp'; denied(build(r), 'NATIVE_NOT_ALLOWLISTED');
});

test('P15 hostile getters/proxies never execute and no raw errors escape', () => {
  const r = fixture(), e = expected(r); let called = 0;
  Object.defineProperty(r, 'entries', { enumerable: true, get() { called++; throw new Error('private'); } });
  denied(buildSyntheticPackage(r, e), 'UNSAFE_OBJECT'); assert.equal(called, 0);
  const p = new Proxy({}, { getPrototypeOf() { called++; throw new Error('private'); } });
  denied(buildSyntheticPackage(p, e), 'UNSAFE_OBJECT'); assert.equal(called, 0);
});
for (const key of ['__proto__', 'constructor', 'prototype']) test('P15 poison key ' + key + ' rejects without pollution', () => {
  const r = fixture(); Object.defineProperty(r, key, { value: { polluted: true }, enumerable: true });
  denied(build(r), 'UNSAFE_OBJECT'); assert.equal({}.polluted, undefined);
});
test('P15 cycles, sparse arrays and extra declarations rejected', () => {
  const r = fixture(); r.extra = r; denied(build(r), 'UNSAFE_OBJECT');
  const s = fixture(); delete s.classifications[0]; denied(build(s), 'METADATA_LIMIT');
  const t = fixture(); t.productionApproved = true; denied(build(t), 'INVALID_METADATA');
});
test('P15 sensitive content rejected even when classified EXCLUDE', () => {
  const r = fixture(); add(r, 'docs/note.txt', '-----BEGIN PRIVATE KEY-----\nsynthetic-marker-only', { disposition: 'EXCLUDE' });
  denied(build(r), 'SENSITIVE_CONTENT');
});
test('P15 duplicate/escaped-equivalent package metadata keys and hostile prototype JSON HOLD', () => {
  for (const bytes of ['{"name":"sharp","name":"innocent","version":"1.0.0"}',
    '{"name":"sharp","na\\u006de":"innocent","version":"1.0.0"}',
    '{"__proto__":{"polluted":true},"name":"innocent","version":"1.0.0"}']) {
    const r = fixture(); add(r, 'node_modules/innocent/package.json', bytes, { format: 'package', packageName: 'innocent', packageVersion: '1.0.0' }); denied(build(r));
  }
  assert.equal({}.polluted, undefined);
});
test('P15 tampered archive/manifest and stale archive substitution reject pinned bindings', () => {
  const c = ok(build()), bad = { archive: Buffer.from(c.archive), manifest: c.manifest }; bad.archive[15] ^= 1;
  denied(verifySyntheticPackage(bad, c.binding), 'ARTIFACT_DIGEST_MISMATCH');
  denied(verifySyntheticPackage({ archive: c.archive, manifest: Buffer.concat([c.manifest, Buffer.from(' ')]) }, c.binding), 'ARTIFACT_DIGEST_MISMATCH');
  const r = fixture(); r.buildId = 'fixture-old'; const e = { ...expected(r), buildId: r.buildId }, old = ok(buildSyntheticPackage(r, e));
  denied(verifySyntheticPackage({ archive: old.archive, manifest: old.manifest }, c.binding), 'ARTIFACT_DIGEST_MISMATCH');
});
test('P15 matching container SHA does not excuse a false tar-payload SHA', () => {
  const c = ok(build()), m = manifest(c); m.tarSha256 = '0'.repeat(64); const b = json(m);
  denied(verifySyntheticPackage({ archive: c.archive, manifest: b }, { ...c.binding, manifestSha256: sha(b), tarSha256: m.tarSha256 }), 'TAR_DIGEST_MISMATCH');
});
test('P15 manifest duplicate keys fail even after rebinding its hash', () => {
  const c = ok(build()), m = Buffer.from(c.manifest.toString('utf8').replace('{', '{"files":[],'));
  denied(verifySyntheticPackage({ archive: c.archive, manifest: m }, { ...c.binding, manifestSha256: sha(m) }), 'NON_CANONICAL_JSON');
});
for (const mode of ['missing', 'extra', 'tampered']) test('P15 ' + mode + ' tar member fails even with updated container hashes', () => {
  const c = ok(build()), d = decodeTar(c.archive), e = d.entries.find(e => e.name === 'public/logo.txt');
  const a = tarAttack(c, tar => {
    if (mode === 'missing') return Buffer.concat([tar.subarray(0, e.offset), tar.subarray(e.offset + 1024)]);
    if (mode === 'extra') return Buffer.concat([tar.subarray(0, e.offset), tar.subarray(e.offset, e.offset + 1024), tar.subarray(e.offset)]);
    tar[e.offset + 512] ^= 1; return tar;
  }); denied(verified(a), mode === 'extra' ? 'PATH_COLLISION' : 'MEMBER_MISMATCH');
});
for (const [name, mutate, code] of [
  ['traversal', h => { h.fill(0, 0, 100); h.write('../outside'); }, 'UNSAFE_PATH'],
  ['hardlink', h => { h[156] = 49; }, 'LINK_OR_SPECIAL_FILE'],
  ['symlink', h => { h[156] = 50; }, 'LINK_OR_SPECIAL_FILE'],
  ['pax', h => { h[156] = 120; }, 'LINK_OR_SPECIAL_FILE'],
  ['device', h => { h[156] = 51; }, 'LINK_OR_SPECIAL_FILE'],
  ['wrong owner', h => { h.write('0000001\0', 108, 'ascii'); }, 'NON_CANONICAL_TAR_HEADER'],
  ['oversized member', h => { h.write((16777217).toString(8).padStart(11, '0') + '\0', 124, 'ascii'); }, 'FILE_LIMIT'],
  ['invalid UTF8', h => { h[0] = 255; }, 'INVALID_UTF8'],
]) test('P15 strict tar rejects ' + name, () => {
  const c = ok(build()), a = tarAttack(c, tar => { const h = tar.subarray(0, 512); mutate(h); checksum(h); return tar; }); denied(verified(a), code);
});
test('P15 nonzero payload padding and extra tar trailer reject ambiguity', () => {
  const c = ok(build()), d = decodeTar(c.archive), e = d.entries.find(e => e.name === 'public/logo.txt');
  denied(verified(tarAttack(c, tar => { tar[e.offset + 512 + e.bytes.length] = 1; return tar; })), 'INVALID_TAR_PAYLOAD');
  denied(verified(tarAttack(c, tar => Buffer.concat([tar, Buffer.alloc(512)]))), 'INVALID_TAR_END');
});
test('P15 gzip filename/mtime and concatenated stream are not accepted as deterministic output', () => {
  const c = ok(build());
  for (const archive of [Buffer.from(c.archive), Buffer.concat([c.archive, gzipSync(Buffer.alloc(0))])]) {
    if (archive.length === c.archive.length) archive[4] = 1;
    const m = manifest(c); m.gzipSha256 = sha(archive); const b = json(m);
    denied(verifySyntheticPackage({ archive, manifest: b }, { ...c.binding, gzipSha256: sha(archive), manifestSha256: sha(b) }), 'NON_CANONICAL_GZIP');
  }
});
test('P15 verifier hostile accessor is never evaluated', () => {
  const c = ok(build()); let calls = 0;
  denied(verifySyntheticPackage({ get archive() { calls++; throw new Error('secret'); }, manifest: c.manifest }, c.binding), 'UNSAFE_OBJECT'); assert.equal(calls, 0);
});

test('P15 collector reads only marked isolated synthetic target and preserves input bytes', () => {
  const root = diskFixture(), before = sha(fs.readFileSync(path.join(root, 'public', 'note.txt'))), r = ok(collectSyntheticFixture(scratch, root));
  assert.deepEqual(r.entries.map(e => e.path), ['public', 'public/note.txt']); assert.equal(r.entries[1].bytes.toString(), 'synthetic');
  assert.equal(sha(fs.readFileSync(path.join(root, 'public', 'note.txt'))), before); assert.equal(r.realBuildArchive, 'HOLD');
  denied(collectSyntheticFixture(root, root)); denied(collectSyntheticFixture(scratch, path.dirname(scratch)), 'SCRATCH_REQUIRED');
});
test('P15 filesystem hardlink rejected without reading/dereferencing it', () => {
  const root = diskFixture(); fs.linkSync(path.join(root, 'public', 'note.txt'), path.join(root, 'public', 'linked.txt'));
  denied(collectSyntheticFixture(scratch, root), 'LINK_OR_SPECIAL_FILE');
});
test('P15 filesystem junction/symlink to sibling target rejected, not materialized', () => {
  const root = diskFixture(), target = diskFixture(); fs.symlinkSync(target, path.join(root, 'linked-dir'), process.platform === 'win32' ? 'junction' : 'dir');
  denied(collectSyntheticFixture(scratch, root), 'LINK_OR_SPECIAL_FILE'); assert.equal(fs.lstatSync(path.join(root, 'linked-dir')).isSymbolicLink(), true);
});
test('P15 Linux FIFO special-file collector check', { skip: process.platform !== 'linux' ? 'Linux FIFO creation not authorized/available in this Windows offline run' : false }, () => {
  const root = diskFixture(), result = childProcess.spawnSync('mkfifo', [path.join(root, 'pipe')], { shell: false });
  assert.equal(result.status, 0); denied(collectSyntheticFixture(scratch, root), 'LINK_OR_SPECIAL_FILE');
});
test('P15 collector detects file changed during read', () => {
  const root = diskFixture(), read = fs.readSync; let changed = false;
  const r = patchMethods([[fs, 'readSync', (...args) => { const n = read(...args); if (!changed && args[1].length === 9) {
    changed = true; fs.appendFileSync(path.join(root, 'public', 'note.txt'), 'changed'); } return n; }]], () => collectSyntheticFixture(scratch, root));
  assert.equal(changed, true); denied(r, 'INPUT_CHANGED');
});
test('P15 writer preserves verified synthetic bytes and completes last, without activation authority', () => {
  const c = ok(build()), name = 'fixture-output-' + (++serial), r = ok(writeSyntheticFixture(c, scratch, name));
  assert.equal(r.durability, 'NOT_VERIFIED'); const root = path.join(scratch, name);
  assert.deepEqual(fs.readFileSync(path.join(root, 'offline-synthetic.tar.gz')), c.archive);
  const done = JSON.parse(fs.readFileSync(path.join(root, 'offline-synthetic.complete.json'))); assert.equal(done.authorization, 'NONE');
  assert.equal(done.binding.manifestSha256, sha(c.manifest)); denied(writeSyntheticFixture(c, scratch, name), 'OUTPUT_EXISTS');
});
for (const fault of ['after-directory', 'partial-archive', 'after-archive', 'after-manifest', 'before-completion']) test('P15 interrupted output ' + fault + ' retains incomplete evidence / no blind retry', () => {
  const c = ok(build()), name = 'fixture-output-' + (++serial), r = denied(writeSyntheticFixture(c, scratch, name, fault), 'PARTIAL_OUTPUT_HOLD');
  assert.equal(r.partialOutputRetained, true); assert.equal(r.retryAllowed, false); assert.equal(r.cleanupAllowed, false);
  assert.equal(fs.existsSync(path.join(scratch, name, 'offline-synthetic.complete.json')), false);
  denied(writeSyntheticFixture(c, scratch, name), 'OUTPUT_EXISTS');
});
test('P15 injected partial write/fsync failure cannot publish completion', () => {
  const c = ok(build()), name = 'fixture-output-' + (++serial);
  const r = patchMethods([[fs, 'fsyncSync', () => { throw new Error('synthetic disk error'); }]], () => writeSyntheticFixture(c, scratch, name));
  denied(r, 'PARTIAL_OUTPUT_HOLD'); assert.equal(fs.existsSync(path.join(scratch, name, 'offline-synthetic.complete.json')), false);
  assert.equal(JSON.stringify(r).includes('disk error'), false);
});
test('P15 caller cannot forge a candidate, overwrite or choose an arbitrary output path', () => {
  const c = ok(build()); denied(writeSyntheticFixture({ ...c }, scratch, 'fixture-output-forged'), 'UNBRANDED_CANDIDATE');
  denied(writeSyntheticFixture(c, scratch, '../outside'), 'SCRATCH_REQUIRED');
  const name = 'fixture-output-' + (++serial); fs.mkdirSync(path.join(scratch, name)); fs.writeFileSync(path.join(scratch, name, 'keep.txt'), 'unchanged');
  denied(writeSyntheticFixture(c, scratch, name), 'OUTPUT_EXISTS'); assert.equal(fs.readFileSync(path.join(scratch, name, 'keep.txt'), 'utf8'), 'unchanged');
});
test('P15 exposed Buffer mutations cannot replace private verified output bytes', () => {
  const c = ok(build()), original = Buffer.from(c.archive), name = 'fixture-output-' + (++serial); c.archive.fill(0); c.manifest.fill(0);
  ok(writeSyntheticFixture(c, scratch, name)); assert.deepEqual(fs.readFileSync(path.join(scratch, name, 'offline-synthetic.tar.gz')), original);
});
test('P15 import-only and pure build perform no filesystem/network/process execution', async () => {
  const objects = [[fs, ['openSync', 'readFileSync', 'writeFileSync', 'mkdirSync', 'statSync', 'lstatSync', 'readdirSync']],
    [childProcess, ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']],
    [http, ['get', 'request']], [https, ['get', 'request']], [net, ['connect', 'createConnection']],
    [tls, ['connect']], [dgram, ['createSocket']]];
  let calls = 0; const saved = [];
  for (const [o, names] of objects) for (const n of names) {
    const original = o[n]; saved.push([o, n, original]);
    o[n] = (...args) => {
      // Node 24's ESM loader itself must read the module; this is not module
      // execution I/O. Only that exact loader stack and source file may read.
      if (o === fs && ['readFileSync', 'openSync'].includes(n) && (args[0] instanceof URL ? fileURLToPath(args[0]) : String(args[0])) === fileURLToPath(sourceURL)
        && new Error().stack.includes('node:internal/modules/esm/load')) return original(...args);
      calls++; throw new Error('side effect forbidden');
    };
  }
  const fetch = globalThis.fetch; globalThis.fetch = () => { calls++; throw new Error('fetch forbidden'); }; syncBuiltinESMExports();
  try {
    const m = await import(sourceURL.href + '?import-safety=synthetic'); const r = fixture(); ok(m.buildSyntheticPackage(r, expected(r))); assert.equal(calls, 0);
  } finally { globalThis.fetch = fetch; for (const [o, n, fn] of saved) o[n] = fn; syncBuiltinESMExports(); }
  const code = fs.readFileSync(fileURLToPath(sourceURL), 'utf8');
  assert.equal(/from ['"]node:(?:child_process|http|https|net|tls|dgram)['"]/u.test(code), false);
});
