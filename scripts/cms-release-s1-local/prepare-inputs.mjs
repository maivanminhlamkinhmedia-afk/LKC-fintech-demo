// Exact-byte input verification only. Caller-provided metadata is never authority.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, openSync, closeSync, fstatSync, readdirSync, constants } from 'node:fs';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { MIGRATIONS, SOURCE_SHA, BASELINE_SHA, SCHEMA_SHA256 } from '../cms-release-s1/fixture-plan.mjs';
import { deriveMigrationBytes } from '../cms-release-s1/run.mjs';

export const HARNESS_SHA = '17ffb61232de69f1be41ab61f44dc6246328b22c';
export const IMAGES = Object.freeze({
  node: 'node:22-bookworm@sha256:c4d5523090a817b7aa86d2111241fdd4f66d1e27782b44160e6aa63b357ecb2d',
  mariadb: 'mariadb:10.11.14@sha256:3a7d3cbc8b6fddf66433d80dc124c1e4e75a73ebab9c6e137529cc270bdadfc0',
  platform: 'linux/amd64',
});
const LOCK = Object.freeze({ path: 'package-lock.json', gitBlob: 'db8ad34550e320fee8ff49abcddee77b8a5aa1f0',
  sha256: '4cac08c47dab4658df87a6a5cdbb05bd50fb6df0823eeda16fb8652bb4cb024a' });
const Q1_SCHEMA = Object.freeze({ path: 'prisma/schema.prisma', gitBlob: '2ac6b2c9688ddac6dcd20f1c0ec9f47007314858', sha256: SCHEMA_SHA256 });
const OLD_SCHEMA = Object.freeze({ path: 'prisma/schema.prisma', gitBlob: '2be88572eceb986cfa59f0f09f3d1f9924d24b7f',
  sha256: '15c3a302d833bbbecaf59df15ab81c501d50eb37e001e6e823137e6a9c84eb1a' });
export const INPUT_IDENTITIES = Object.freeze([
  ...[LOCK, Q1_SCHEMA].map((x) => Object.freeze({ source: 'q1', ...x })),
  ...[LOCK, OLD_SCHEMA].map((x) => Object.freeze({ source: 'old', ...x })),
  ...[
    { path: 'scripts/cms-release-s1/run.mjs', gitBlob: 'e9726058e9a88530cb9f601bb484adc2450497cb', sha256: '975860d4a3a5d174ebe8b6fd745586f9eeabdad1a3afb02b76e62e3615dea669' },
    { path: 'scripts/cms-release-s1/fixture-plan.mjs', gitBlob: '212a80b44fc33cccfbaaf5f083eb1394cce97eda', sha256: '3c3ee56768e4359e97904719665747ddfaef4e0d40d3b74ff41457ac62527fd1' },
    { path: 'scripts/cms-release-s1/metadata.mjs', gitBlob: 'd9f83e1e18b077271a237b3d2200ee0e1f35538a', sha256: 'cbe361703406125fb9dd527f0e8f6a74fc8703006193ada266bfd2082f7d2255' },
  ].map((x) => Object.freeze({ source: 'harness', ...x })),
  ...MIGRATIONS.map((x) => Object.freeze({ source: 'q1', path: 'prisma/migrations/' + x.name + '/migration.sql',
    gitBlob: x.gitBlob, sha256: x.lfSha256 })),
]);
const MAX_FILE = 64 * 1024 * 1024;
function fail() { throw Object.assign(new Error('LOCAL_INPUT_REFUSED'), { code: 'LOCAL_INPUT_REFUSED' }); }
function check(value) { if (!value) fail(); }
export function bytesSha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
export function blobIdentity(bytes) {
  return createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
}
function fields(value, expected) {
  check(value && Object.getPrototypeOf(value) === Object.prototype);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  check(Reflect.ownKeys(descriptors).length === expected.length);
  for (const key of expected) check(Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key], 'value'));
}
function freeze(value) {
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
function canonical(value) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return JSON.stringify(value);
  if (typeof value === 'number') { check(Number.isSafeInteger(value)); return String(value); }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  fields(value, Object.keys(value));
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
/** Reject secrets by PATH before any file read; no arbitrary archive member accepted. */
export function validateInputPath(path) {
  try {
    check(typeof path === 'string' && path.length > 0 && path.length <= 512 && !isAbsolute(path)
      && !/[\\:\0\r\n]/.test(path) && !path.split('/').some((p) => !p || p === '.' || p === '..'
      || /^\.env/i.test(p) || ['.git', '.ssh', '.aws', '.npmrc', '.netrc', '.docker'].includes(p.toLowerCase())
      || /^(id_rsa|id_ed25519|credentials)$/i.test(p)));
    return path;
  } catch { fail(); }
}
/** Read-only bounded regular files; never follows known links/hardlinks.
 * Trusted local filesystem still required: this is not an OS race-proof sandbox.
 */
export function readRegularInput(root, path) {
  let fd;
  try {
    validateInputPath(path);
    check(typeof root === 'string' && isAbsolute(root));
    const base = resolve(root), full = resolve(base, path), rel = relative(base, full);
    check(rel && !rel.startsWith('..') && !isAbsolute(rel));
    let current = full;
    for (;;) {
      const stat = lstatSync(current);
      check(!stat.isSymbolicLink());
      const parent = dirname(current); if (parent === current) break; current = parent;
    }
    check(realpathSync(full) === full);
    const before = lstatSync(full);
    check(before.isFile() && before.nlink === 1 && before.size >= 0 && before.size <= MAX_FILE);
    fd = openSync(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const after = fstatSync(fd);
    check(after.isFile() && after.ino === before.ino && after.dev === before.dev && after.nlink === 1);
    const bytes = readFileSync(fd);
    check(bytes.length === before.size && bytes.length <= MAX_FILE);
    return bytes;
  } catch { fail(); } finally { if (fd !== undefined) closeSync(fd); }
}

/** In-memory, exact Git-payload verification. No Git subprocess, DB, .env or writes. */
export function verifyPinnedInputs(input) {
  try {
    fields(input, ['commits', 'images', 'entries']);
    fields(input.commits, ['harness', 'q1', 'old']); fields(input.images, ['node', 'mariadb', 'platform']);
    check(input.commits.harness === HARNESS_SHA && input.commits.q1 === SOURCE_SHA && input.commits.old === BASELINE_SHA);
    for (const key of Object.keys(IMAGES)) check(input.images[key] === IMAGES[key]);
    check(Array.isArray(input.entries) && input.entries.length === INPUT_IDENTITIES.length);
    const inventory = input.entries.map((entry, i) => {
      fields(entry, ['source', 'path', 'bytes']);
      const expected = INPUT_IDENTITIES[i]; validateInputPath(entry.path);
      check(entry.source === expected.source && entry.path === expected.path && Buffer.isBuffer(entry.bytes)
        && entry.bytes.length > 0 && entry.bytes.length <= MAX_FILE);
      const bytes = Buffer.from(entry.bytes); // detach caller mutation
      check(bytesSha256(bytes) === expected.sha256 && blobIdentity(bytes) === expected.gitBlob);
      return { source: entry.source, path: entry.path, gitBlob: expected.gitBlob,
        gitPayloadSha256: expected.sha256, rawSha256: bytesSha256(bytes), bytes: bytes.length };
    });
    for (const role of ['q1', 'old']) {
      const lockEntry = input.entries.find((x) => x.source === role && x.path === LOCK.path);
      const lock = JSON.parse(lockEntry.bytes.toString('utf8'));
      for (const name of ['prisma', '@prisma/client', '@prisma/adapter-mariadb']) check(lock.packages['node_modules/' + name].version === '7.8.0');
      check(lock.packages['node_modules/mariadb'].version === '3.4.5');
    }
    const value = { schema: 'cms-s1-local-input/v1', commits: { ...input.commits }, images: { ...IMAGES }, inventory,
      executionAuthorized: false };
    return freeze({ ...value, inputSha256: bytesSha256(canonical(value)) });
  } catch { fail(); }
}

export function readPinnedInputs(root) {
  return {
    commits: { harness: HARNESS_SHA, q1: SOURCE_SHA, old: BASELINE_SHA }, images: { ...IMAGES },
    entries: INPUT_IDENTITIES.map((x) => ({ source: x.source, path: x.path, bytes: readRegularInput(root, x.source + '/' + x.path) })),
  };
}

/** Derived copies only; originals remain immutable. CRLF applies to FIRST THREE only. */
export function prepareMigrationVariants(input) {
  const provenance = verifyPinnedInputs(input);
  const variants = {};
  for (const variant of ['lf', 'crlf', 'fault', 'recovery']) {
    variants[variant] = MIGRATIONS.map((migration, i) => {
      const original = input.entries.find((x) => x.source === 'q1' && x.path === 'prisma/migrations/' + migration.name + '/migration.sql').bytes;
      const eol = variant === 'crlf' && i < 3 ? 'CRLF' : 'LF';
      const bytes = deriveMigrationBytes(original, eol);
      const sha256 = bytesSha256(bytes);
      check(sha256 === (eol === 'CRLF' ? migration.crlfSha256 : migration.lfSha256));
      return Object.freeze({ name: migration.name, eol, sha256, gitBlob: migration.gitBlob, bytes });
    });
    Object.freeze(variants[variant]);
  }
  return Object.freeze({ provenance, variants: Object.freeze(variants) });
}

/** Fixed bootstrap instructions, NOT executable approval. No runtime installation. */
export function planLinuxPreparation() {
  return freeze({ executionAuthorized: false, bootstrapPermissionRequired: true, image: IMAGES.node,
    platform: IMAGES.platform, independentClients: ['old', 'q1'],
    commands: ['npm ci --ignore-scripts', 'node node_modules/prisma/build/index.js generate --config prisma.config.mjs'],
    canaryCompiler: ['cc', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-o', 'network-canary', 'network-canary.c'],
    consumer: { method: 'typescript-ordinary-compilation', source: SOURCE_SHA, output: 'q1/compiled-consumer.mjs', hooks: false },
    requiredPackages: { prisma: '7.8.0', client: '7.8.0', adapter: '7.8.0', mariadb: '3.4.5' },
    stages: ['SEPARATE_BOOTSTRAP_GRANT', 'PREPARE_TWO_LINUX_CLIENTS', 'COMPILE_CANARY', 'COMPILE_CONSUMER_CLOSURE', 'HASH_ALL_FILES', 'DETACH_BOOTSTRAP_NETWORK'],
  });
}

/** Sealed artifact digest checks are consistency evidence, not authority/attestation.
 * expectedSealSha256 must eventually come from separately reviewed trusted grant.
 */
export function verifyRuntimeSeal(root, sealBytes, expectedSealSha256) {
  try {
    check(Buffer.isBuffer(sealBytes) && sealBytes.length > 0 && sealBytes.length <= 32 * 1024 * 1024
      && typeof expectedSealSha256 === 'string' && /^[a-f0-9]{64}$/.test(expectedSealSha256)
      && bytesSha256(sealBytes) === expectedSealSha256);
    check(readRegularInput(root, 'local-seal.json').equals(sealBytes));
    const seal = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(sealBytes));
    fields(seal, ['schema', 'harnessSha', 'sourceSha', 'baselineSha', 'runNonce', 'attempt', 'images', 'inputSha256',
      'seccompSha256', 'canarySha256', 'resourcePlanSha256', 'daemonSha256', 'files']);
    check(seal.schema === 'cms-s1-local-seal/v1' && seal.harnessSha === HARNESS_SHA && seal.sourceSha === SOURCE_SHA
      && seal.baselineSha === BASELINE_SHA && /^[a-f0-9]{22}$/.test(seal.runNonce) && seal.attempt === 1);
    fields(seal.images, ['node', 'mariadb', 'platform']);
    for (const key of Object.keys(IMAGES)) check(seal.images[key] === IMAGES[key]);
    for (const key of ['inputSha256', 'seccompSha256', 'canarySha256', 'resourcePlanSha256', 'daemonSha256']) check(/^[a-f0-9]{64}$/.test(seal[key]));
    check(Array.isArray(seal.files) && seal.files.length > 0 && seal.files.length <= 100000);
    const seen = new Set();
    for (const file of seal.files) {
      fields(file, ['path', 'sha256']); validateInputPath(file.path);
      check(!seen.has(file.path) && /^[a-f0-9]{64}$/.test(file.sha256)); seen.add(file.path);
      check(bytesSha256(readRegularInput(root, file.path)) === file.sha256);
    }
    // Enumerate the complete sealed tree: no undeclared executable, empty file,
    // dependency or extra member can be silently loaded outside the hash manifest.
    let entriesSeen = 0;
    function walk(relativeDirectory = '') {
      for (const name of readdirSync(resolve(root, relativeDirectory))) {
        const member = relativeDirectory ? relativeDirectory + '/' + name : name;
        validateInputPath(member); check(++entriesSeen <= 150000);
        const stat = lstatSync(resolve(root, member)); check(!stat.isSymbolicLink());
        if (stat.isDirectory()) walk(member);
        else { check(stat.isFile() && stat.nlink === 1 && (member === 'local-seal.json' || seen.has(member))); }
      }
    }
    walk();
    const inputs = readPinnedInputs(root), verified = verifyPinnedInputs(inputs);
    check(verified.inputSha256 === seal.inputSha256);
    for (const item of INPUT_IDENTITIES) check(seen.has(item.source + '/' + item.path));
    for (const required of ['old/package.json', 'q1/package.json', 'old/node_modules/.prisma/client/index.js', 'q1/node_modules/.prisma/client/index.js',
      'old/node_modules/.prisma/client/schema.prisma', 'q1/node_modules/.prisma/client/schema.prisma',
      'old/node_modules/@prisma/client/package.json', 'q1/node_modules/@prisma/client/package.json',
      'old/node_modules/@prisma/adapter-mariadb/package.json', 'q1/node_modules/@prisma/adapter-mariadb/package.json',
      'old/node_modules/prisma/package.json', 'q1/node_modules/prisma/package.json',
      'old/node_modules/mariadb/package.json', 'q1/node_modules/mariadb/package.json',
      'q1/node_modules/prisma/config.js', 'q1/node_modules/prisma/build/index.js',
      'network-canary', 'seccomp-unix-only.json', 'q1/compiled-consumer.mjs']) check(seen.has(required));
    for (const file of ['run.mjs', 'fixture-plan.mjs', 'metadata.mjs']) {
      const expected = INPUT_IDENTITIES.find((x) => x.path === 'scripts/cms-release-s1/' + file);
      check(seen.has('cms-release-s1/' + file)
        && bytesSha256(readRegularInput(root, 'cms-release-s1/' + file)) === expected.sha256);
    }
    for (const file of ['run-local.mjs', 'resource-policy.mjs', 'prepare-inputs.mjs', 'evidence-ledger.mjs']) check(seen.has('local/' + file));
    check(bytesSha256(readRegularInput(root, 'network-canary')) === seal.canarySha256
      && bytesSha256(readRegularInput(root, 'seccomp-unix-only.json')) === seal.seccompSha256);
    // Check exact derived migration bytes, not just caller-declared digests.
    const derived = prepareMigrationVariants(inputs);
    for (const variant of ['lf', 'crlf']) for (const count of [4, 7]) for (const item of derived.variants[variant].slice(0, count)) {
      const path = 'migrations/' + variant + '/' + count + '/migrations/' + item.name + '/migration.sql';
      check(seen.has(path) && bytesSha256(readRegularInput(root, path)) === item.sha256);
    }
    for (const variant of ['lf', 'crlf']) for (const count of [4, 7]) {
      const member = 'migrations/' + variant + '/' + count + '/prisma.config.mjs';
      check(seen.has(member) && readRegularInput(root, member).equals(Buffer.from(migrationConfigSource(variant, count))));
    }
    return freeze({ ...seal, sealSha256: expectedSealSha256, executionAuthorized: false, provenanceVerified: true });
  } catch { fail(); }
}

// Fixed runtime secret location is intentionally NOT read by this module.
export const RUNTIME_LAYOUT = Object.freeze({ inputs: '/inputs', work: '/work', evidence: '/evidence',
  socket: '/run/cms-s1/mysqld.sock', credentialFile: '/run/cms-s1-private/runtime-credentials.json' });

/** Deterministic config text for sealed disposable artifacts only; not executed
 * by preparation/tests. It reads synthetic private tmpfs, never dotenv or DSN env.
 */
export function migrationConfigSource(variant, count) {
  check(['lf', 'crlf'].includes(variant) && [4, 7].includes(count));
  const allowed = variant === 'crlf' ? ['crlf'] : ['lf', 'fault', 'recovery'];
  return [
    "import { defineConfig } from '/inputs/q1/node_modules/prisma/config.js';",
    "import { readFileSync, lstatSync } from 'node:fs';",
    "const stop = () => { throw new Error('LOCAL_CONFIG_REFUSED'); };",
    'const variant = process.env.S1_VARIANT;',
    'if (!' + JSON.stringify(allowed) + '.includes(variant)) stop();',
    "const seal = JSON.parse(readFileSync('/inputs/local-seal.json', 'utf8'));",
    "if (seal.sourceSha !== '" + SOURCE_SHA + "' || seal.harnessSha !== '" + HARNESS_SHA + "' || !/^[a-f0-9]{22}$/.test(seal.runNonce) || seal.attempt !== 1) stop();",
    "const file = '/run/cms-s1-private/runtime-credentials.json';",
    "for (const p of ['/run', '/run/cms-s1-private', file]) if (lstatSync(p).isSymbolicLink()) stop();",
    'const stat = lstatSync(file);',
    'if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096 || (stat.mode & 63) !== 0 || stat.uid !== process.getuid()) stop();',
    "const credentials = JSON.parse(readFileSync(file, 'utf8'));",
    'const password = credentials.variants?.[variant]?.ddl;',
    "if (typeof password !== 'string' || !/^[a-f0-9]{64}$/.test(password)) stop();",
    "const database = 's1_' + seal.runNonce + '_' + variant;",
    "const url = 'mysql://' + database + '_ddl:' + encodeURIComponent(password) + '@localhost/' + database + '?socket=/run/cms-s1/mysqld.sock';",
    'export default defineConfig({ schema: ' + JSON.stringify('/inputs/' + (count === 4 ? 'old' : 'q1') + '/prisma/schema.prisma') + ',',
    '  migrations: { path: ' + JSON.stringify('/inputs/migrations/' + variant + '/' + count + '/migrations') + ' }, datasource: { url } });',
    '',
  ].join('\n');
}
