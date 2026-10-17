// P15: synthetic, offline packaging only. No CLI, import-time I/O, application
// execution, network, deployment or trust authority. The declarative fixture
// graph below is NOT a JavaScript dependency analyser or real runtime proof.
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { gzipSync, gunzipSync } from 'node:zlib';
import * as fs from 'node:fs';
import path from 'node:path';

export const SOURCE = Object.freeze({ sha: '982a4c6b1a7c97cb997940b3bd8a09efbb8a9275', tree: '6e9eead6e2ec3add0d12bc7617a250792948037c' });
export const PROFILE = Object.freeze({ id: 'p15-synthetic-ustar-v1', gzip: 134217728, tar: 268435456,
  file: 16777216, files: 10000, directories: 2000, manifest: 8388608, path: 240 });
export const SANDBOX_MARKER = 'P15_OFFLINE_SYNTHETIC_SANDBOX_V1\n';
const IDENTITY = '__p15_synthetic_identity__.json';
const products = new WeakMap();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const byteSort = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
class Denied extends Error { constructor(code) { super(code); this.code = code; } }
function need(ok, code) { if (!ok) throw new Denied(code); }
function report(ok, code, extra = {}) {
  return { ok, code, mode: 'OFFLINE_SYNTHETIC', authorization: 'NONE',
    realBuildArchive: 'HOLD', realRuntimeClosure: 'NOT_VERIFIED', activation: 'NOT_AUTHORIZED', ...extra };
}
function failure(error) { return report(false, error instanceof Denied ? error.code : 'INVALID_OR_UNAVAILABLE_INPUT'); }
function exact(value, keys, code = 'INVALID_METADATA') {
  need(value && !Array.isArray(value) && typeof value === 'object'
    && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)), code);
}
const typedArrayLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'length').get;
const typedArraySet = Uint8Array.prototype.set;
const bufferHooks = ['length', 'byteLength', 'byteOffset', 'buffer', 'offset', 'parent',
  'valueOf', 'toString', 'toJSON', 'constructor', Symbol.toPrimitive, Symbol.iterator, Symbol.toStringTag];
function copyInertBuffer(value, limit, limitCode, remaining = Infinity) {
  need(!types.isProxy(value) && types.isUint8Array(value)
    && Object.getPrototypeOf(value) === Buffer.prototype, 'UNSAFE_OBJECT');
  // Inspect descriptors without reading shadowed metadata or conversion hooks.
  // Do not enumerate byte-index properties: archives may contain 128 MiB.
  for (const key of bufferHooks) need(!Object.getOwnPropertyDescriptor(value, key), 'UNSAFE_OBJECT');
  const length = Reflect.apply(typedArrayLength, value, []);
  need(length <= limit, limitCode); need(length <= remaining, 'TAR_LIMIT');
  const bytes = Buffer.alloc(length);
  // The intrinsic typed-array source path copies internal byte storage; it does
  // not consult value.length, valueOf, Symbol.iterator or Buffer.from hooks.
  Reflect.apply(typedArraySet, bytes, [value]); return bytes;
}
// Snapshot only own inert data. Buffers are copied before hashing; proxies and
// accessors are rejected without calling their traps/getters/toJSON hooks.
function snapshot(input) {
  const seen = new Set(); let nodes = 0, textBytes = 0, binaryBytes = 0;
  function copy(v, depth) {
    need(++nodes <= 600000 && depth <= 24, 'METADATA_LIMIT');
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') { need(Number.isSafeInteger(v), 'INVALID_NUMBER'); return v; }
    if (typeof v === 'string') {
      textBytes += Buffer.byteLength(v); need(textBytes <= PROFILE.manifest * 2, 'METADATA_LIMIT'); return v;
    }
    need(v && typeof v === 'object' && !types.isProxy(v) && !seen.has(v), 'UNSAFE_OBJECT');
    const proto = Object.getPrototypeOf(v);
    if (proto === Buffer.prototype) {
      const bytes = copyInertBuffer(v, PROFILE.file, 'FILE_LIMIT', PROFILE.tar - binaryBytes);
      binaryBytes += bytes.length; return bytes;
    }
    const array = Array.isArray(v);
    need(array ? proto === Array.prototype : proto === Object.prototype || proto === null, 'UNSAFE_OBJECT');
    const ds = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(ds);
    need(keys.length <= 15001 && keys.every(k => typeof k === 'string'
      && !['__proto__', 'constructor', 'prototype'].includes(k)
      && Object.hasOwn(ds[k], 'value') && (ds[k].enumerable || array && k === 'length')), 'UNSAFE_OBJECT');
    seen.add(v); let result;
    if (array) {
      const n = ds.length.value;
      need(n <= 15000 && keys.length === n + 1, 'METADATA_LIMIT'); result = [];
      for (let i = 0; i < n; i++) { need(Object.hasOwn(ds, String(i)), 'UNSAFE_OBJECT'); result.push(copy(ds[i].value, depth + 1)); }
    } else {
      result = Object.create(null);
      for (const k of keys.sort(byteSort)) result[k] = copy(ds[k].value, depth + 1);
    }
    seen.delete(v); return result;
  }
  return copy(input, 0);
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort(byteSort)
    .map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function jsonBytes(value) { return Buffer.from(canonical(value), 'utf8'); }
function parseCanonical(bytes) {
  need(Buffer.isBuffer(bytes) && bytes.length <= PROFILE.manifest, 'MANIFEST_LIMIT');
  let value;
  try { value = snapshot(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); }
  catch { throw new Denied('INVALID_CANONICAL_JSON'); }
  // This deliberately narrow synthetic format also rejects duplicate and
  // escaped-equivalent keys; no generic shared JSON/trust parser is introduced.
  need(jsonBytes(value).equals(bytes), 'NON_CANONICAL_JSON'); return value;
}
function cleanText(s) { return typeof s === 'string' && s.length > 0 && s.length <= 1024 && !/[\u0000-\u001f\u007f]/u.test(s); }
function validName(s) { return typeof s === 'string' && /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/u.test(s); }
function bannedName(s) { return s === 'sharp' || /^@img\/[^/]+$/u.test(s); }
function bannedPath(s) {
  const c = s.split('/');
  return c.some((p, i) => p.toLowerCase() === 'node_modules' && ['sharp', '@img'].includes(c[i + 1]?.toLowerCase()));
}
function sensitivePath(s) {
  return s.split('/').some(p => /^\.env/iu.test(p) || /^(?:\.git|\.ssh|\.aws|\.npmrc|\.netrc|credentials|secrets|uploads|data example)$/iu.test(p)
    || /(?:\.(?:pem|key|p12|pfx)|^id_(?:rsa|ed25519))$/iu.test(p));
}
function splitPath(s) {
  need(typeof s === 'string' && s.length > 0 && s.normalize('NFC') === s
    && !/[\u0000-\u0020\u007f\\:*?"<>|]/u.test(s)
    && Buffer.from(s).toString('utf8') === s && Buffer.byteLength(s) <= PROFILE.path, 'UNSAFE_PATH');
  const segments = s.split('/');
  need(segments.every(p => p && p !== '.' && p !== '..' && !/[. ]$/u.test(p)
    && !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(p)), 'UNSAFE_PATH');
  need(!sensitivePath(s), 'SENSITIVE_PATH');
  if (Buffer.byteLength(s) <= 100) return { name: s, prefix: '' };
  for (let i = s.lastIndexOf('/'); i > 0; i = s.lastIndexOf('/', i - 1)) {
    const prefix = s.slice(0, i), name = s.slice(i + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
  }
  throw new Denied('USTAR_PATH_LIMIT');
}
export function validateArchivePath(value) {
  try { return report(true, 'PATH_VALID', splitPath(value)); } catch (e) { return failure(e); }
}
function measurements(value) {
  exact(value, ['gzip', 'tar', 'file', 'files', 'directories', 'manifest']);
  for (const key of Object.keys(value)) need(Number.isSafeInteger(value[key]) && value[key] >= 0
    && value[key] <= PROFILE[key], `${key.toUpperCase()}_LIMIT`);
}
export function validateMeasurements(value) {
  try { measurements(snapshot(value)); return report(true, 'WITHIN_CAPS'); } catch (e) { return failure(e); }
}
function inventory(entries, reserveIdentity = true) {
  need(Array.isArray(entries), 'INVALID_INVENTORY');
  const map = new Map(), folded = new Set(); let files = 0, directories = 0, tar = 1024;
  for (const e of entries) {
    need(e && ['file', 'directory'].includes(e.type), 'LINK_OR_SPECIAL_FILE');
    exact(e, e.type === 'file' ? ['path', 'type', 'mode', 'bytes'] : ['path', 'type', 'mode']);
    splitPath(e.path); need(!reserveIdentity || e.path !== IDENTITY, 'RESERVED_PATH');
    const fold = e.path.normalize('NFC').toLowerCase();
    need(!folded.has(fold), 'PATH_COLLISION'); folded.add(fold); map.set(e.path, e);
    need(e.mode === (e.type === 'directory' ? 0o755 : 0o644) || e.type === 'file' && e.mode === 0o755, 'UNSAFE_MODE');
    if (e.type === 'file') {
      need(Buffer.isBuffer(e.bytes), 'INVALID_BYTES'); files++;
      need(e.bytes.length <= PROFILE.file, 'FILE_LIMIT'); tar += 512 + Math.ceil(e.bytes.length / 512) * 512;
    } else { directories++; tar += 512; }
  }
  measurements({ gzip: 0, tar, file: 0, files, directories, manifest: 0 });
  for (const e of entries) {
    const parts = e.path.split('/'); parts.pop();
    while (parts.length) {
      need(map.get(parts.join('/'))?.type === 'directory', 'MISSING_OR_CONFLICTING_PARENT'); parts.pop();
    }
  }
  return [...map.values()].sort((a, b) => byteSort(a.path, b.path));
}
function entryManifest(e) { return { path: e.path, type: e.type, mode: e.mode,
  size: e.type === 'file' ? e.bytes.length : 0, sha256: e.type === 'file' ? digest(e.bytes) : null }; }
export function fingerprintSyntheticInventory(entries) {
  try { return report(true, 'INVENTORY_FINGERPRINT_ONLY', { sha256: digest(jsonBytes(inventory(snapshot(entries)).map(entryManifest))) }); }
  catch (e) { return failure(e); }
}
function isNative(e) {
  if (e.type !== 'file') return false;
  const b = e.bytes, prefix = b.subarray(0, 4).toString('hex');
  return /\.(?:node|dll|exe|wasm|dylib|a|lib|so(?:\.\d+)*)$/iu.test(e.path)
    || ['7f454c46', '0061736d', 'feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca'].includes(prefix)
    || b.subarray(0, 2).toString('ascii') === 'MZ';
}
function nativeHeaderMatches(bytes, target) {
  // Header cross-check only, not loader/ABI/libc or vendor attestation. Unknown
  // formats (including WASM/Mach-O/archive containers) HOLD in this slice.
  if (bytes.length >= 64 && bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70]))) {
    return target.platform === 'linux' && bytes[4] === 2 && bytes[5] === 1 && bytes[6] === 1
      && [0, 3].includes(bytes[7]) && [2, 3].includes(bytes.readUInt16LE(16))
      && bytes.readUInt16LE(18) === (target.architecture === 'x64' ? 62 : 183)
      && bytes.readUInt32LE(20) === 1 && bytes.readUInt16LE(52) === 64;
  }
  if (bytes.length >= 64 && bytes.subarray(0, 2).toString('ascii') === 'MZ') {
    const pe = bytes.readUInt32LE(60);
    return target.platform === 'win32' && pe >= 64 && pe + 26 <= bytes.length
      && bytes.subarray(pe, pe + 4).equals(Buffer.from([80, 69, 0, 0]))
      && bytes.readUInt16LE(pe + 4) === (target.architecture === 'x64' ? 0x8664 : 0xaa64)
      && bytes.readUInt16LE(pe + 24) === 0x20b;
  }
  return false;
}
function textAsset(bytes) {
  try {
    const s = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s)
      && !/^#!|\b(?:require\s*\(|import\s|process\.|eval\s*\()/u.test(s);
  } catch { return false; }
}
function moduleReferences(e) {
  const d = parseCanonical(e.bytes);
  exact(d, ['kind', 'references']);
  need(d.kind === 'P15_SYNTHETIC_MODULE_V1' && Array.isArray(d.references)
    && d.references.length <= PROFILE.files, 'UNVERIFIED_RUNTIME_FORMAT');
  for (const ref of d.references) splitPath(ref);
  need(new Set(d.references).size === d.references.length, 'DUPLICATE_REFERENCE');
  return d.references;
}
function runtimeEntries(input, entries) {
  const fileMap = new Map(entries.filter(e => e.type === 'file').map(e => [e.path, e]));
  const packages = [];
  for (const e of fileMap.values()) if (e.path.endsWith('/package.json') || e.path === 'package.json') {
    const p = parseCanonical(e.bytes); exact(p, ['name', 'version']);
    need(validName(p.name) && typeof p.version === 'string' && /^\d+\.\d+\.\d+$/u.test(p.version), 'PACKAGE_IDENTITY');
    const root = e.path === 'package.json' ? '' : e.path.slice(0, -13);
    // A package in node_modules must agree with its package path. Relocated
    // package roots still carry identity; sharp/@img cannot escape by renaming.
    const parts = root.split('/'), n = parts.lastIndexOf('node_modules');
    if (n >= 0) need(parts.slice(n + 1).join('/') === p.name, 'PACKAGE_IDENTITY');
    packages.push({ root, name: p.name, version: p.version });
  }
  packages.sort((a, b) => b.root.length - a.root.length);
  const within = (s, root) => root === '' || s === root || s.startsWith(root + '/');
  const banned = entries.filter(e => bannedPath(e.path) || packages.some(p => bannedName(p.name) && within(e.path, p.root)));
  const bannedSet = new Set(banned.map(e => e.path));
  const bannedDigests = new Set(banned.filter(e => e.type === 'file' && e.bytes.length).map(e => digest(e.bytes)));
  const policies = new Map();
  need(Array.isArray(input.classifications), 'UNCLASSIFIED_FILE');
  for (const c of input.classifications) {
    exact(c, ['path', 'disposition', 'format', 'packageName', 'packageVersion', 'reason']);
    need(fileMap.has(c.path) && !policies.has(c.path) && ['RUNTIME', 'EXCLUDE'].includes(c.disposition)
      && ['asset', 'package', 'fixture-module', 'native'].includes(c.format) && cleanText(c.reason), 'INVALID_CLASSIFICATION');
    const p = packages.find(p => within(c.path, p.root));
    need(c.packageName === (p?.name ?? null) && c.packageVersion === (p?.version ?? null), 'PACKAGE_IDENTITY');
    if (c.path.split('/').includes('node_modules')) need(p && p.root !== '', 'UNKNOWN_DEPENDENCY');
    policies.set(c.path, c);
  }
  need(policies.size === fileMap.size, 'UNCLASSIFIED_FILE');
  exact(input.target, ['platform', 'architecture', 'libc']);
  need(['linux', 'win32'].includes(input.target.platform) && ['x64', 'arm64'].includes(input.target.architecture)
    && (input.target.platform === 'linux' ? ['glibc', 'musl'].includes(input.target.libc) : input.target.libc === 'none'), 'TARGET_IDENTITY');
  const natives = new Map();
  need(Array.isArray(input.nativeAllowlist), 'NATIVE_NOT_ALLOWLISTED');
  for (const a of input.nativeAllowlist) {
    exact(a, ['path', 'packageName', 'packageVersion', 'platform', 'architecture', 'libc', 'sha256', 'justification']);
    need(fileMap.has(a.path) && !natives.has(a.path) && hash(a.sha256) && cleanText(a.justification)
      && validName(a.packageName) && !bannedName(a.packageName), 'NATIVE_NOT_ALLOWLISTED'); natives.set(a.path, a);
  }
  const kept = [], excluded = [], usedNative = new Set(), references = new Map();
  for (const e of fileMap.values()) {
    const c = policies.get(e.path);
    // Even excluded files may not hide secrets or unsafe filesystem members.
    need(!/-----BEGIN (?:[A-Z0-9 ]*PRIVATE KEY|CERTIFICATE)-----|(?:gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})/u.test(e.bytes.toString('utf8')), 'SENSITIVE_CONTENT');
    if (bannedSet.has(e.path) || c.disposition === 'EXCLUDE') {
      excluded.push({ ...entryManifest(e), reason: bannedSet.has(e.path) ? 'SHARP_OR_IMG_EXCLUDED' : c.reason }); continue;
    }
    need(!bannedDigests.has(digest(e.bytes)), 'AMBIGUOUS_RELOCATED_COPY');
    const native = isNative(e);
    if (native || c.format === 'native') {
      const a = natives.get(e.path);
      need(native && c.format === 'native' && a && a.sha256 === digest(e.bytes)
        && a.packageName === c.packageName && a.packageVersion === c.packageVersion
        && a.platform === input.target.platform && a.architecture === input.target.architecture
        && a.libc === input.target.libc, 'NATIVE_NOT_ALLOWLISTED');
      need(nativeHeaderMatches(e.bytes, input.target), 'NATIVE_HEADER_MISMATCH'); usedNative.add(e.path);
    } else if (c.format === 'fixture-module') references.set(e.path, moduleReferences(e));
    else if (c.format === 'package') need(e.path.endsWith('/package.json') || e.path === 'package.json', 'UNVERIFIED_RUNTIME_FORMAT');
    else {
      // Never pretend arbitrary JS/TS or a renamed executable is proven closed.
      const kind = e.path.split('.').at(-1).toLowerCase();
      need(c.format === 'asset' && ['txt', 'css', 'html', 'svg'].includes(kind)
        && textAsset(e.bytes), 'UNVERIFIED_RUNTIME_FORMAT');
    }
    kept.push(e);
  }
  need(usedNative.size === natives.size, 'UNUSED_NATIVE_ALLOWLIST');
  const retained = new Set(kept.map(e => e.path));
  need(Array.isArray(input.requiredPaths) && input.requiredPaths.length > 0
    && new Set(input.requiredPaths).size === input.requiredPaths.length, 'INVALID_REQUIRED_PATHS');
  for (const p of input.requiredPaths) need(retained.has(p), 'RUNTIME_CLOSURE_HOLD');
  need(references.has(input.entrypoint) && retained.has(input.entrypoint), 'RUNTIME_CLOSURE_HOLD');
  for (const refs of references.values()) for (const ref of refs) need(retained.has(ref), 'RUNTIME_CLOSURE_HOLD');
  // Verify all modelled modules, including unreachable/dynamically selected ones.
  const reachable = new Set(), queue = [input.entrypoint, ...input.requiredPaths];
  while (queue.length) { const p = queue.pop(); if (reachable.has(p)) continue;
    reachable.add(p); for (const ref of references.get(p) ?? []) if (!reachable.has(ref)) queue.push(ref); }
  const directories = entries.filter(e => e.type === 'directory' && kept.some(f => f.path.startsWith(e.path + '/')));
  return { entries: [...directories, ...kept].sort((a, b) => byteSort(a.path, b.path)), excluded,
    closure: { kind: 'DECLARATIVE_SYNTHETIC_GRAPH_ONLY', checkedModules: references.size,
      nativeBindings: 'SYNTHETIC_ALLOWLIST_AND_HEADER_ONLY_LIBC_NOT_ATTESTED',
      requiredPaths: [...input.requiredPaths].sort(byteSort), entrypoint: input.entrypoint, reachable: [...reachable].sort(byteSort) } };
}
function octal(buffer, at, size, value) {
  const s = value.toString(8); need(s.length < size, 'USTAR_NUMBER_LIMIT'); buffer.write(s.padStart(size - 1, '0') + '\0', at, size, 'ascii');
}
function header(e) {
  const h = Buffer.alloc(512), p = splitPath(e.path);
  h.write(p.name, 0, 100, 'utf8'); h.write(p.prefix, 345, 155, 'utf8');
  octal(h, 100, 8, e.mode); octal(h, 108, 8, 0); octal(h, 116, 8, 0);
  octal(h, 124, 12, e.type === 'file' ? e.bytes.length : 0); octal(h, 136, 12, 0);
  h.fill(32, 148, 156); h[156] = e.type === 'file' ? 48 : 53;
  h.write('ustar\0', 257, 'ascii'); h.write('00', 263, 'ascii'); octal(h, 329, 8, 0); octal(h, 337, 8, 0);
  const sum = h.reduce((a, b) => a + b, 0); h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii'); return h;
}
function makeTar(entries) {
  const parts = []; let total = 1024;
  for (const e of entries) {
    const size = e.type === 'file' ? e.bytes.length : 0; total += 512 + Math.ceil(size / 512) * 512;
    need(total <= PROFILE.tar, 'TAR_LIMIT'); parts.push(header(e));
    if (size) parts.push(e.bytes, Buffer.alloc((512 - size % 512) % 512));
  }
  parts.push(Buffer.alloc(1024)); return Buffer.concat(parts, total);
}
function sourceIdentity(input, expected) {
  exact(input, ['kind', 'sourceSha', 'sourceTree', 'buildId', 'tooling', 'target', 'entries', 'classifications', 'nativeAllowlist', 'requiredPaths', 'entrypoint']);
  exact(expected, ['sourceSha', 'sourceTree', 'buildId', 'toolingSha256', 'inputSha256', 'planSha256']);
  exact(input.tooling, ['state', 'sha256']);
  need(input.kind === 'P15_SYNTHETIC_INPUT_V1' && input.sourceSha === SOURCE.sha && input.sourceTree === SOURCE.tree
    && expected.sourceSha === SOURCE.sha && expected.sourceTree === SOURCE.tree, 'SOURCE_IDENTITY');
  need(typeof input.buildId === 'string' && /^fixture-[a-z0-9-]{1,48}$/u.test(input.buildId)
    && input.buildId === expected.buildId, 'STALE_BUILD');
  need(input.tooling.state === 'UNCOMMITTED' && hash(input.tooling.sha256)
    && input.tooling.sha256 === expected.toolingSha256 && hash(expected.inputSha256) && hash(expected.planSha256), 'TOOLING_IDENTITY');
}
function packagingPlan(input) {
  need(Array.isArray(input.classifications) && Array.isArray(input.nativeAllowlist)
    && Array.isArray(input.requiredPaths), 'INVALID_PACKAGING_PLAN');
  return { classifications: [...input.classifications].sort((a, b) => byteSort(a.path, b.path)),
    nativeAllowlist: [...input.nativeAllowlist].sort((a, b) => byteSort(a.path, b.path)),
    requiredPaths: [...input.requiredPaths].sort(byteSort), entrypoint: input.entrypoint, target: input.target };
}
export function buildSyntheticPackage(request, expectations) {
  try {
    const input = snapshot(request), expected = snapshot(expectations); sourceIdentity(input, expected);
    const entries = inventory(input.entries);
    need(digest(jsonBytes(entries.map(entryManifest))) === expected.inputSha256, 'INPUT_DIGEST_MISMATCH');
    const plan = packagingPlan(input);
    need(digest(jsonBytes(plan)) === expected.planSha256, 'PACKAGING_PLAN_DIGEST_MISMATCH');
    const runtime = runtimeEntries(input, entries);
    const identity = { kind: 'P15_SYNTHETIC_ARTIFACT_ONLY', sourceSha: input.sourceSha, sourceTree: input.sourceTree,
      buildId: input.buildId, tooling: input.tooling, profile: PROFILE, target: input.target,
      toolchain: { node: process.versions.node, zlib: process.versions.zlib }, authorization: 'NONE' };
    const packed = inventory([...runtime.entries, { path: IDENTITY, type: 'file', mode: 0o644, bytes: jsonBytes(identity) }], false);
    const tar = makeTar(packed), archive = gzipSync(tar, { level: 9, mtime: 0 });
    // Fixed gzip header: no original filename/mtime, OS=unknown. Deflate bytes
    // are deterministic within the recorded Node/zlib toolchain, not all zlibs.
    archive[9] = 255;
    const manifestValue = { identity, inputSha256: expected.inputSha256, tarSha256: digest(tar), gzipSha256: digest(archive),
      files: packed.map(entryManifest), excluded: runtime.excluded.sort((a, b) => byteSort(a.path, b.path)), closure: runtime.closure,
      packagingPlan: plan };
    const manifest = jsonBytes(manifestValue);
    measurements({ gzip: archive.length, tar: tar.length, file: Math.max(...packed.filter(e => e.type === 'file').map(e => e.bytes.length)),
      files: packed.filter(e => e.type === 'file').length, directories: packed.filter(e => e.type === 'directory').length, manifest: manifest.length });
    const binding = { ...expected, manifestSha256: digest(manifest), tarSha256: digest(tar), gzipSha256: digest(archive) };
    const result = report(true, 'PURE_PACKAGER_LOCAL_CANDIDATE', { archive, manifest, binding, syntheticClosure: 'PASS' });
    products.set(result, { archive: Buffer.from(archive), manifest: Buffer.from(manifest), binding: { ...binding } }); return result;
  } catch (e) { return failure(e); }
}
function readTar(tar) {
  need(tar.length <= PROFILE.tar && tar.length >= 1024 && tar.length % 512 === 0, 'INVALID_TAR');
  const entries = []; let offset = 0;
  function text(h, from, n) {
    const b = h.subarray(from, from + n), end = b.indexOf(0), content = end < 0 ? b : b.subarray(0, end);
    need(end < 0 || b.subarray(end).every(x => x === 0), 'INVALID_TAR_FIELD');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(content); } catch { throw new Denied('INVALID_UTF8'); }
  }
  function number(h, from, n) {
    const s = h.subarray(from, from + n).toString('latin1'); need(/^[0-7]+[\0 ]+$/u.test(s), 'INVALID_TAR_NUMBER');
    return Number.parseInt(s, 8);
  }
  while (offset < tar.length) {
    const h = tar.subarray(offset, offset + 512);
    if (h.every(b => b === 0)) { need(tar.length - offset === 1024 && tar.subarray(offset).every(b => b === 0), 'INVALID_TAR_END'); return inventory(entries, false); }
    const size = number(h, 124, 12), prefix = text(h, 345, 155), name = text(h, 0, 100), type = h[156];
    need([48, 53].includes(type) && (type !== 53 || size === 0), 'LINK_OR_SPECIAL_FILE');
    need(size <= PROFILE.file, 'FILE_LIMIT');
    const end = offset + 512 + Math.ceil(size / 512) * 512;
    need(end <= tar.length && tar.subarray(offset + 512 + size, end).every(b => b === 0), 'INVALID_TAR_PAYLOAD');
    const e = { path: prefix ? prefix + '/' + name : name, type: type === 48 ? 'file' : 'directory', mode: number(h, 100, 8) };
    if (e.type === 'file') e.bytes = tar.subarray(offset + 512, offset + 512 + size);
    need(h.equals(header(e)), 'NON_CANONICAL_TAR_HEADER'); entries.push(e);
    need(entries.length <= PROFILE.files + PROFILE.directories, 'ENTRY_LIMIT'); offset = end;
  }
  throw new Denied('INVALID_TAR_END');
}
export function verifySyntheticPackage(candidate, expectations) {
  try {
    // Larger container buffers are validated separately, never run through the
    // per-file metadata snapshot cap.
    need(candidate && !types.isProxy(candidate) && Object.getPrototypeOf(candidate) === Object.prototype, 'UNSAFE_OBJECT');
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    need(Reflect.ownKeys(descriptors).length === 2 && ['archive', 'manifest'].every(k => descriptors[k] && Object.hasOwn(descriptors[k], 'value')), 'UNSAFE_OBJECT');
    const raw = descriptors.archive.value, meta = descriptors.manifest.value;
    const archive = copyInertBuffer(raw, PROFILE.gzip, 'GZIP_LIMIT');
    const manifest = copyInertBuffer(meta, PROFILE.manifest, 'MANIFEST_LIMIT'), expected = snapshot(expectations);
    exact(expected, ['sourceSha', 'sourceTree', 'buildId', 'toolingSha256', 'inputSha256', 'planSha256', 'manifestSha256', 'tarSha256', 'gzipSha256']);
    need(expected.sourceSha === SOURCE.sha && expected.sourceTree === SOURCE.tree, 'SOURCE_IDENTITY');
    need(digest(archive) === expected.gzipSha256 && digest(manifest) === expected.manifestSha256, 'ARTIFACT_DIGEST_MISMATCH');
    const m = parseCanonical(manifest); exact(m, ['identity', 'inputSha256', 'tarSha256', 'gzipSha256', 'files', 'excluded', 'closure', 'packagingPlan']);
    need(digest(jsonBytes(m.packagingPlan)) === expected.planSha256, 'PACKAGING_PLAN_DIGEST_MISMATCH');
    need(m.identity?.kind === 'P15_SYNTHETIC_ARTIFACT_ONLY' && m.identity.authorization === 'NONE'
      && m.identity.sourceSha === SOURCE.sha && m.identity.sourceTree === SOURCE.tree && m.identity.buildId === expected.buildId
      && m.identity.tooling?.state === 'UNCOMMITTED' && m.identity.tooling.sha256 === expected.toolingSha256
      && canonical(m.identity.profile) === canonical(PROFILE) && m.inputSha256 === expected.inputSha256
      && m.gzipSha256 === expected.gzipSha256 && m.tarSha256 === expected.tarSha256, 'MANIFEST_BINDING');
    need(archive.length >= 18 && archive.subarray(0, 10).equals(Buffer.from([31, 139, 8, 0, 0, 0, 0, 0, 2, 255])), 'NON_CANONICAL_GZIP');
    let tar; try { tar = gunzipSync(archive, { maxOutputLength: PROFILE.tar }); } catch { throw new Denied('INVALID_OR_OVERSIZED_GZIP'); }
    need(digest(tar) === expected.tarSha256, 'TAR_DIGEST_MISMATCH');
    const entries = readTar(tar);
    need(makeTar(entries).equals(tar), 'NON_CANONICAL_TAR_ORDER');
    const recompressed = gzipSync(tar, { level: 9, mtime: 0 }); recompressed[9] = 255;
    need(recompressed.equals(archive), 'NON_CANONICAL_GZIP');
    need(canonical(entries.map(entryManifest)) === canonical(m.files), 'MEMBER_MISMATCH');
    const embedded = entries.find(e => e.path === IDENTITY);
    need(embedded?.type === 'file' && embedded.bytes.equals(jsonBytes(m.identity)), 'IDENTITY_MISMATCH');
    for (const e of entries) need(!bannedPath(e.path), 'FORBIDDEN_PACKAGE');
    return report(true, 'SYNTHETIC_BYTES_VERIFIED', { fileCount: entries.filter(e => e.type === 'file').length,
      directoryCount: entries.filter(e => e.type === 'directory').length, integrityOnly: true });
  } catch (e) { return failure(e); }
}
// Fixture-only filesystem boundary. Caller owns an isolated synthetic scratch
// root marked below. Never materializes links. Metadata/rechecks do not claim
// protection against an adversary controlling the host kernel or all ancestors.
function realDirectory(directory) {
  need(typeof directory === 'string' && path.isAbsolute(directory), 'SCRATCH_REQUIRED');
  const resolved = path.resolve(directory), parsed = path.parse(resolved); let at = parsed.root;
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    at = path.join(at, segment); const s = fs.lstatSync(at);
    need(s.isDirectory() && !s.isSymbolicLink(), 'LINK_OR_SPECIAL_FILE');
  }
  const actual = fs.realpathSync(resolved);
  need(process.platform === 'win32' ? actual.toLowerCase() === resolved.toLowerCase() : actual === resolved, 'LINK_OR_SPECIAL_FILE'); return resolved;
}
function signature(s) { return [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs, s.nlink].join(':'); }
function readFile(file, max) {
  const before = fs.lstatSync(file); need(before.isFile() && !before.isSymbolicLink() && before.nlink === 1, 'LINK_OR_SPECIAL_FILE');
  need(before.size <= max, 'FILE_LIMIT');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    need(signature(fs.fstatSync(fd)) === signature(before), 'INPUT_CHANGED');
    const b = Buffer.alloc(before.size); let n = 0;
    while (n < b.length) { const read = fs.readSync(fd, b, n, b.length - n, n); need(read > 0, 'INPUT_CHANGED'); n += read; }
    need(signature(fs.fstatSync(fd)) === signature(before) && signature(fs.lstatSync(file)) === signature(before), 'INPUT_CHANGED'); return b;
  } finally { fs.closeSync(fd); }
}
function sandbox(root) {
  const r = realDirectory(root);
  need(readFile(path.join(r, '.lkc-p15-sandbox'), 128).toString('utf8') === SANDBOX_MARKER, 'SCRATCH_REQUIRED'); return r;
}
export function collectSyntheticFixture(scratchRoot, fixtureRoot) {
  try {
    const scratch = sandbox(scratchRoot), root = realDirectory(fixtureRoot);
    need(path.dirname(root) === scratch && /^fixture-[a-z0-9-]+$/u.test(path.basename(root)), 'SCRATCH_REQUIRED');
    const entries = []; let directories = 0, files = 0, total = 1024;
    function walk(directory, prefix = '') {
      const before = fs.lstatSync(directory), children = fs.readdirSync(directory).sort(byteSort);
      for (const name of children) {
        const p = prefix ? prefix + '/' + name : name; splitPath(p);
        const full = path.join(directory, name), s = fs.lstatSync(full); need(!s.isSymbolicLink(), 'LINK_OR_SPECIAL_FILE');
        if (s.isDirectory()) {
          need(++directories <= PROFILE.directories, 'DIRECTORIES_LIMIT'); total += 512;
          entries.push({ path: p, type: 'directory', mode: 0o755 }); realDirectory(full); walk(full, p);
        } else {
          need(s.isFile() && s.nlink === 1, 'LINK_OR_SPECIAL_FILE'); need(++files <= PROFILE.files && s.size <= PROFILE.file, 'FILE_LIMIT');
          total += 512 + Math.ceil(s.size / 512) * 512; need(total <= PROFILE.tar, 'TAR_LIMIT');
          entries.push({ path: p, type: 'file', mode: s.mode & 0o111 ? 0o755 : 0o644, bytes: readFile(full, PROFILE.file) });
        }
        need(total <= PROFILE.tar, 'TAR_LIMIT');
      }
      need(signature(fs.lstatSync(directory)) === signature(before), 'INPUT_CHANGED');
    }
    walk(root); return report(true, 'SYNTHETIC_INVENTORY_ONLY', { entries: inventory(entries) });
  } catch (e) { return failure(e); }
}
export function writeSyntheticFixture(candidate, scratchRoot, outputName, fault = null) {
  let created = false;
  try {
    const saved = products.get(candidate); need(saved, 'UNBRANDED_CANDIDATE');
    const checked = verifySyntheticPackage({ archive: saved.archive, manifest: saved.manifest }, saved.binding); need(checked.ok, 'INVALID_CANDIDATE');
    const scratch = sandbox(scratchRoot);
    need(typeof outputName === 'string' && /^fixture-output-[a-z0-9-]+$/u.test(outputName), 'SCRATCH_REQUIRED');
    need([null, 'after-directory', 'partial-archive', 'after-archive', 'after-manifest', 'before-completion'].includes(fault), 'INVALID_FAULT');
    const output = path.join(scratch, outputName); need(!fs.existsSync(output), 'OUTPUT_EXISTS');
    fs.mkdirSync(output, { mode: 0o700 }); created = true; realDirectory(output);
    const trip = stage => { if (fault === stage) throw new Denied('INJECTED_WRITE_FAILURE'); };
    const write = (name, bytes, partial = false) => {
      realDirectory(output);
      const fd = fs.openSync(path.join(output, name), 'wx', 0o600);
      try {
        if (partial) { fs.writeSync(fd, bytes.subarray(0, Math.max(1, Math.floor(bytes.length / 2)))); trip('partial-archive'); }
        let at = 0; while (at < bytes.length) { const n = fs.writeSync(fd, bytes, at, bytes.length - at); need(n > 0, 'WRITE_FAILED'); at += n; }
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
    };
    trip('after-directory'); write('offline-synthetic.tar.gz', saved.archive, fault === 'partial-archive'); trip('after-archive');
    write('offline-synthetic-manifest.json', saved.manifest); trip('after-manifest');
    const disk = verifySyntheticPackage({ archive: readFile(path.join(output, 'offline-synthetic.tar.gz'), PROFILE.gzip),
      manifest: readFile(path.join(output, 'offline-synthetic-manifest.json'), PROFILE.manifest) }, saved.binding);
    need(disk.ok, 'OUTPUT_VERIFICATION_FAILED'); trip('before-completion');
    write('offline-synthetic.complete.json', jsonBytes({ kind: 'P15_SYNTHETIC_COMPLETION_ONLY', authorization: 'NONE', binding: saved.binding }));
    return report(true, 'SYNTHETIC_OUTPUT_COMPLETE', { durability: 'NOT_VERIFIED' });
  } catch (e) {
    return report(false, created ? 'PARTIAL_OUTPUT_HOLD' : e instanceof Denied ? e.code : 'OUTPUT_UNAVAILABLE',
      { partialOutputRetained: created, retryAllowed: false, cleanupAllowed: false });
  }
}
