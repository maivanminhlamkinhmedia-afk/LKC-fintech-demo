// Offline fixture archive profile only. No transport, shell or extraction side effects.
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export const LIMITS = Object.freeze({ compressed: 4 * 1024 * 1024, expanded: 8 * 1024 * 1024, files: 64, file: 1024 * 1024 });
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const isDigest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const isId = (value) => typeof value === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(value);
const fail = (code) => { throw new Error(code); };

// Reject accessors rather than invoking code while parsing fixture metadata.
export function dataRecord(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail('INVALID_METADATA');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length) fail('INVALID_METADATA');
  for (const key of keys) if (!descriptors[key] || !Object.hasOwn(descriptors[key], 'value')) fail('INVALID_METADATA');
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}

export function exactArchivePath(value) {
  if (typeof value !== 'string' || value.length > 180 || !/^[A-Za-z0-9._/-]+$/.test(value)) return false;
  return value.split('/').every((s) => s && s !== '.' && s !== '..' && !s.endsWith('.')
    && !/^\.env/i.test(s) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(s));
}

export function normalizeApproval(input) {
  const a = dataRecord(input, ['releaseId', 'sourceSha', 'archiveSha256', 'files']);
  if (!isId(a.releaseId) || typeof a.sourceSha !== 'string' || !/^[a-f0-9]{40}$/.test(a.sourceSha)
    || !isDigest(a.archiveSha256) || !Array.isArray(a.files) || a.files.length < 1 || a.files.length > LIMITS.files) fail('INVALID_APPROVAL');
  const files = [];
  for (let i = 0; i < a.files.length; i++) {
    const d = Object.getOwnPropertyDescriptor(a.files, String(i));
    if (!d || !Object.hasOwn(d, 'value')) fail('INVALID_APPROVAL');
    const f = dataRecord(d.value, ['path', 'size', 'sha256']);
    if (!exactArchivePath(f.path) || !Number.isSafeInteger(f.size) || f.size < 0 || f.size > LIMITS.file || !isDigest(f.sha256)) fail('INVALID_MANIFEST');
    files.push(f);
  }
  files.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  for (let i = 0; i < files.length; i++) for (let j = i + 1; j < files.length; j++) {
    const a = files[i].path.toLowerCase(), b = files[j].path.toLowerCase();
    if (a === b || a.startsWith(b + '/') || b.startsWith(a + '/')) fail('PATH_COLLISION');
  }
  return { releaseId: a.releaseId, sourceSha: a.sourceSha, archiveSha256: a.archiveSha256, files };
}

function field(header, start, length) {
  const bytes = header.subarray(start, start + length);
  const end = bytes.indexOf(0);
  if (end >= 0 && bytes.subarray(end).some((v) => v !== 0)) fail('INVALID_TAR_FIELD');
  const content = end < 0 ? bytes : bytes.subarray(0, end);
  if (content.some((v) => v < 32 || v > 126)) fail('INVALID_TAR_FIELD');
  return content.toString('ascii');
}

function octal(header, start, length) {
  const raw = header.subarray(start, start + length).toString('latin1');
  if (!/^[0-7]+[\0 ]*$/.test(raw)) fail('INVALID_TAR_NUMBER');
  const value = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(value)) fail('INVALID_TAR_NUMBER');
  return value;
}

export function verifyArchive(bytes, approved) {
  try {
    const identity = normalizeApproval(approved);
    if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > LIMITS.compressed) fail('ARCHIVE_SIZE');
    const archive = Buffer.from(bytes); // inspect exactly the bytes whose digest was checked
    if (sha256(archive) !== identity.archiveSha256) fail('ARTIFACT_SHA_MISMATCH');
    let tar;
    try { tar = gunzipSync(archive, { maxOutputLength: LIMITS.expanded }); }
    catch { fail('INVALID_OR_OVERSIZED_GZIP'); }
    if (tar.length < 1024 || tar.length % 512) fail('INVALID_TAR');
    const entries = [], names = new Set();
    let offset = 0, ended = false;
    while (offset < tar.length) {
      const header = tar.subarray(offset, offset + 512);
      if (header.every((v) => v === 0)) {
        if (tar.length - offset < 1024 || tar.subarray(offset).some((v) => v !== 0)) fail('INVALID_TAR_END');
        ended = true;
        break;
      }
      let checksum = 0;
      for (let i = 0; i < 512; i++) checksum += i >= 148 && i < 156 ? 32 : header[i];
      if (checksum !== octal(header, 148, 8)) fail('TAR_CHECKSUM');
      // Explicit narrow POSIX ustar profile: regular files only; no PAX/GNU/link/device entries.
      if (field(header, 257, 6) !== 'ustar' || header.subarray(263, 265).toString('ascii') !== '00'
        || ![0, 48].includes(header[156]) || field(header, 157, 100) !== '') fail('UNSUPPORTED_TAR_ENTRY');
      if (octal(header, 100, 8) > 0o777) fail('UNSAFE_MODE');
      const prefix = field(header, 345, 155), name = field(header, 0, 100);
      const filePath = prefix ? prefix + '/' + name : name;
      if (!exactArchivePath(filePath)) fail('UNSAFE_ARCHIVE_PATH');
      if (names.has(filePath.toLowerCase())) fail('PATH_COLLISION');
      names.add(filePath.toLowerCase());
      const size = octal(header, 124, 12);
      if (size > LIMITS.file || entries.length >= LIMITS.files) fail('ARCHIVE_SIZE');
      const start = offset + 512, next = start + Math.ceil(size / 512) * 512;
      if (next > tar.length || tar.subarray(start + size, next).some((v) => v !== 0)) fail('INVALID_TAR_PAYLOAD');
      entries.push({ path: filePath, bytes: Buffer.from(tar.subarray(start, start + size)) });
      offset = next;
    }
    if (!ended || entries.length !== identity.files.length) fail('MANIFEST_MISMATCH');
    for (const entry of entries) {
      const f = identity.files.find((f) => f.path === entry.path);
      if (!f || f.size !== entry.bytes.length || f.sha256 !== sha256(entry.bytes)) fail('MANIFEST_MISMATCH');
    }
    return { ok: true, identity, receiptSha256: sha256(JSON.stringify(identity)), entries };
  } catch (error) {
    const known = /^(INVALID_[A-Z_]+|UNSAFE_[A-Z_]+|UNSUPPORTED_TAR_ENTRY|ARTIFACT_SHA_MISMATCH|ARCHIVE_SIZE|PATH_COLLISION|MANIFEST_MISMATCH|TAR_CHECKSUM)$/;
    return { ok: false, code: known.test(error?.message ?? '') ? error.message : 'INVALID_ARCHIVE_INPUT' };
  }
}
