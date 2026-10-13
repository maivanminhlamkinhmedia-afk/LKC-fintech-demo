import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  createResourcePlan, validateLocalContext, validateLocalGrant, validateSeccompProfile,
  validateResourceObservations, volumeIdentityHash, planExactOwnedCleanup, validateLocalTarget,
  validateCanaryEvidence, LOCAL_DOCKER_CONTEXT, LOCAL_DOCKER_ENDPOINT, PINNED_IMAGES, SOCKET_PATH,
} from '../scripts/cms-release-s1-local/resource-policy.mjs';

const clone = (value) => JSON.parse(JSON.stringify(value));
const id = (digit) => digit.repeat(64);
const profileBytes = readFileSync(new URL('../scripts/cms-release-s1-local/seccomp-unix-only.json', import.meta.url));
const profile = JSON.parse(profileBytes);
const input = { runNonce: '0123456789abcdefabcdef', daemonId: 'docker_local_test_01',
  seccompSha256: createHash('sha256').update(profileBytes).digest('hex'), nodeUid: 1000, nodeGid: 1001, mariaDbUid: 999, mariaDbGid: 1001 };
const plan = createResourcePlan(input).plan;
function context() { return { contextName: LOCAL_DOCKER_CONTEXT, endpoint: LOCAL_DOCKER_ENDPOINT,
  daemonId: input.daemonId, operatingSystem: 'linux', architecture: 'x86_64', overrides: {} }; }
function observation() {
  const containers = plan.containers.map((spec, index) => ({ id: id(String(index + 1)), spec: clone(spec), state: 'exited', networkIds: [id('9')] }));
  const volumes = plan.volumes.map((spec) => ({ daemonId: input.daemonId, name: spec.name,
    createdAt: '2026-10-12T01:00:00Z', driver: 'local', options: {}, labels: clone(spec.labels),
    consumers: containers.filter((container) => container.spec.mounts.some((mount) => mount.source === spec.name)).map((container) => container.id) }));
  const network = { id: id('9'), spec: clone(plan.network), attachedContainerIds: containers.map((container) => container.id) };
  const ledger = [{ kind: 'network', name: network.spec.name, id: network.id },
    ...containers.map((entry) => ({ kind: 'container', name: entry.spec.name, id: entry.id })),
    ...volumes.map((entry) => ({ kind: 'volume', name: entry.name, id: volumeIdentityHash(entry).sha256 }))];
  return { context: context(), network, containers, volumes, ledger };
}
function target() { return { resources: observation(), databaseName: plan.databaseNames[0],
  socket: { path: SOCKET_PATH, type: 'socket', isSymlink: false, volumeName: plan.volumes.find((v) => v.role === 'socket').name,
    device: 12, inode: 43, uid: 999, gid: 1001, mode: 432, serverContainerId: id('1') } }; }
function canaries() {
  return plan.containers.filter((entry) => entry.role.endsWith('-canary')).map((entry, index) => ({
    image: entry.image, containerId: id(String(index + 3)), profileSha256: input.seccompSha256, binarySha256: id('a'), user: entry.user,
    result: { kind: 'CMS_S1_NETWORK_CANARY_V1', architecture: 'x86_64', seccomp: 2, noNewPrivileges: 1,
      capEffZero: true, capBndZero: true, inheritedInetZero: true, unixPass: true, deniedFamilies: 45,
      alternateAbiDenied: true, ioUringDenied: true, pass: true },
  }));
}

test('B1 boundary: missing, JSON-forged, environment-shaped and label authority never authorize', () => {
  for (const authority of [null, {}, { approved: true }, { LOCAL_EXECUTION_GRANT: 'true' }, { label: 'REAL_DRIVER' }]) {
    assert.deepEqual(validateLocalGrant(authority), { ok: false, code: 'LOCAL_EXECUTION_NOT_AUTHORIZED' });
  }
});
test('B1 boundary: exact local named-pipe context is consistency only', () => {
  assert.deepEqual(validateLocalContext(context(), input.daemonId), { ok: true, daemonId: input.daemonId, executionAuthorized: false });
});
for (const [name, patch] of [
  ['remote TCP endpoint', { endpoint: 'tcp://example.invalid:2376' }], ['SSH endpoint', { endpoint: 'ssh://example.invalid' }],
  ['unknown local pipe', { endpoint: 'npipe:////./pipe/docker_engine' }], ['host context', { contextName: 'default' }],
  ['wrong daemon', { daemonId: 'other_daemon' }], ['wrong architecture', { architecture: 'aarch64' }],
  ['inherited host override', { overrides: { DOCKER_HOST: 'tcp://localhost:2375' } }],
]) test('B1 boundary: refuses ' + name, () => assert.equal(validateLocalContext({ ...context(), ...patch }, input.daemonId).ok, false));

test('B1 boundary: resource plan is deterministic, immutable, nonce22, network internal and images pinned', () => {
  assert.equal(createResourcePlan(input).ok, true); assert.deepEqual(createResourcePlan(input).plan, plan);
  assert.equal(plan.executionAuthorized, false); assert.equal(plan.network.internal, true); assert.equal(plan.network.ipv6, false);
  assert.equal(plan.containers.length, 4); assert.equal(plan.volumes.length, 5);
  assert.equal(Object.isFrozen(plan.containers[0].security), true);
  for (const container of plan.containers) {
    assert.ok(Object.values(PINNED_IMAGES).includes(container.image));
    assert.deepEqual(container.security.capDrop, ['ALL']); assert.equal(container.security.noNewPrivileges, true);
    assert.deepEqual(container.security.portBindings, {}); assert.deepEqual(container.security.binds, []);
    assert.equal(container.security.seccompSha256, input.seccompSha256); assert.equal(container.security.logDriver, 'none');
    assert.equal(container.mounts.some((mount) => mount.source.includes('docker.sock') || mount.type !== 'volume'), false);
  }
});
test('B1 boundary: wrong nonce, root identity, different socket group, image injection or profile digest rejected', () => {
  for (const patch of [{ runNonce: 'a'.repeat(24) }, { runNonce: '../root' }, { nodeUid: 0 }, { mariaDbGid: 5 }, { seccompSha256: 'bad' }, { image: 'mariadb:latest' }]) {
    assert.equal(createResourcePlan({ ...input, ...patch }).ok, false);
  }
});
test('B1 boundary: validates reviewed seccomp semantics without claiming kernel enforcement', () => {
  const result = validateSeccompProfile(profile); assert.equal(result.ok, true); assert.equal(result.runtimeIsolation, 'NOT_VERIFIED');
});
for (const [name, mutate] of [
  ['default allow', (p) => { p.defaultAction = 'SCMP_ACT_ALLOW'; }],
  ['alternate ABI', (p) => p.architectures.push('SCMP_ARCH_X86')],
  ['unfiltered socket', (p) => p.syscalls[0].names.push('socket')],
  ['INET family', (p) => { p.syscalls[1].args[0].value = 2; }],
  ['socketpair unrestricted', (p) => { p.syscalls[1].args = []; }],
  ['io_uring allowed', (p) => p.syscalls[0].names.push('io_uring_setup')],
  ['socketcall allowed', (p) => p.syscalls[0].names.push('socketcall')],
  ['namespace clone mask removed', (p) => { p.syscalls[2].args = []; }],
  ['unknown profile option', (p) => { p.listenerPath = '/tmp/broker'; }],
]) test('B1 boundary: rejects seccomp ' + name, () => { const candidate = clone(profile); mutate(candidate); assert.equal(validateSeccompProfile(candidate).ok, false); });

test('B1 boundary: absent preflight rejects existing resources even with matching names', () => {
  const empty = { context: context(), network: null, volumes: [], containers: [], ledger: [] };
  assert.equal(validateResourceObservations(plan, empty, { phase: 'ABSENT' }).ok, true);
  assert.equal(validateResourceObservations(plan, observation(), { phase: 'ABSENT' }).ok, false);
});
test('B1 boundary: exact resource inventory and immutable ledger identities verify', () => {
  assert.equal(validateResourceObservations(plan, observation()).ok, true);
});
for (const [name, mutate] of [
  ['owner mismatch', (o) => { o.volumes[0].labels['cms.s1.owner'] = 'other'; }],
  ['stale run', (o) => { o.network.spec.labels['cms.s1.run'] = 'f'.repeat(22); }],
  ['network not internal', (o) => { o.network.spec.internal = false; }],
  ['unexpected network attachment', (o) => o.containers[0].networkIds.push(id('a'))],
  ['published port', (o) => { o.containers[0].spec.security.portBindings = { '3306/tcp': [{ HostPort: '3306' }] }; }],
  ['unconfined seccomp', (o) => { o.containers[0].spec.security.seccompPath = 'unconfined'; }],
  ['unowned consumer', (o) => o.volumes[0].consumers.push(id('b'))],
  ['host bind volume', (o) => { o.volumes[0].options = { type: 'none', o: 'bind', device: '/etc' }; }],
  ['volume recreated', (o) => { o.volumes[0].createdAt = '2026-10-13T01:00:00Z'; }],
  ['missing ACK ledger', (o) => o.ledger.pop()],
  ['duplicate resource', (o) => { o.containers[1].id = o.containers[0].id; }],
  ['duplicate ledger ACK', (o) => { o.ledger[1] = o.ledger[0]; }],
]) test('B1 boundary: refuses resource ' + name, () => { const value = observation(); mutate(value); assert.equal(validateResourceObservations(plan, value).ok, false); });

test('B1 boundary: cleanup plan is bounded exact-owned, containers before network before volumes, never execution', () => {
  const result = planExactOwnedCleanup(plan, observation(), { outcome: 'PASS', ledgerComplete: true, cleanupApproved: true });
  assert.equal(result.ok, true); assert.equal(result.executionAuthorized, false); assert.equal(result.actions.length, 10);
  assert.deepEqual(result.actions.map((entry) => entry.kind), ['container', 'container', 'container', 'container', 'network', 'volume', 'volume', 'volume', 'volume', 'volume']);
  assert.equal(result.revalidationRequiredBeforeEachAction, true);
});
test('B1 boundary: unknown outcome, missing cleanup approval, incomplete ledger and running resources refuse cleanup', () => {
  for (const patch of [{ outcome: 'UNKNOWN_OUTCOME' }, { ledgerComplete: false }, { cleanupApproved: false }]) {
    assert.equal(planExactOwnedCleanup(plan, observation(), { outcome: 'PASS', ledgerComplete: true, cleanupApproved: true, ...patch }).ok, false);
  }
  const active = observation(); active.containers[0].state = 'running';
  assert.equal(planExactOwnedCleanup(plan, active, { outcome: 'PASS', ledgerComplete: true, cleanupApproved: true }).ok, false);
});
test('B1 boundary: Unix target linked to exact server and socket ownership, with no runtime attestation claim', () => {
  assert.equal(validateLocalTarget(plan, target()).ok, true);
  for (const mutate of [(o) => { o.databaseName = 'edpmjmha_lkcstage'; }, (o) => { o.socket.path = '/tmp/mysql.sock'; },
    (o) => { o.socket.isSymlink = true; }, (o) => { o.socket.serverContainerId = id('2'); },
    (o) => { o.socket.type = 'file'; }, (o) => { o.socket.mode = 511; }, (o) => { o.socket.gid = 7; }]) {
    const value = target(); mutate(value); assert.equal(validateLocalTarget(plan, value).ok, false);
  }
});
test('B1 boundary: both runtime images need complete syscall-denial evidence, labels alone fail', () => {
  assert.equal(validateCanaryEvidence(plan, canaries(), observation(), id('a')).ok, true);
  assert.equal(validateCanaryEvidence(plan, [{ driver: 'REAL_DRIVER' }], observation(), id('a')).ok, false);
  for (const mutate of [(v) => v.pop(), (v) => { v[1] = v[0]; }, (v) => { v[0].result.deniedFamilies = 44; },
    (v) => { v[0].result.ioUringDenied = false; }, (v) => { v[0].result.inheritedInetZero = false; },
    (v) => { v[0].result.alternateAbiDenied = false; }, (v) => { v[0].profileSha256 = id('c'); },
    (v) => { v[0].image = 'mariadb:latest'; }, (v) => { v[0].containerId = id('f'); }, (v) => { v[0].binarySha256 = id('b'); }, (v) => { v[0].result.rawError = 'credential canary'; }]) {
    const value = canaries(); mutate(value); assert.equal(validateCanaryEvidence(plan, value, observation(), id('a')).ok, false);
  }
});
test('B1 boundary: hostile accessors and proxies produce fixed safe refusals without getter execution', () => {
  let calls = 0; const hostile = Object.defineProperty({}, 'daemonId', { enumerable: true, get() { calls++; throw new Error('private canary'); } });
  assert.deepEqual(validateLocalContext(hostile, input.daemonId), { ok: false, code: 'LOCAL_CONTEXT_REJECTED' });
  assert.equal(calls, 0);
  const proxy = new Proxy({}, { ownKeys() { throw new Error('private canary'); } });
  assert.equal(createResourcePlan(proxy).ok, false); assert.equal(validateResourceObservations(plan, observation(), proxy).ok, false);
  assert.equal(validateSeccompProfile(proxy).ok, false); assert.equal(validateLocalTarget(plan, proxy).ok, false);
});
test('B1 boundary: native canary source rejects EAFNOSUPPORT and probes alternate ABI and io_uring', () => {
  const source = readFileSync(new URL('../scripts/cms-release-s1-local/network-canary.c', import.meta.url), 'utf8');
  assert.match(source, /code == EPERM \|\| code == EACCES/);
  assert.match(source, /EAFNOSUPPORT \/ ENOSYS never count/);
  assert.match(source, /int \$0x80/); assert.match(source, /0x40000000UL \+ SYS_socket/);
  assert.match(source, /syscall\(425/); assert.match(source, /syscall\(426/); assert.match(source, /syscall\(427/);
  assert.match(source, /getsockopt\(\(int\)value, SOL_SOCKET, SO_DOMAIN/);
  assert.doesNotMatch(source, /\b(connect|sendto|getenv|system|popen)\s*\(/);
});


test('B1 boundary: controller grant is closed before forged request access or supplied capabilities', async () => {
  const { LOCAL_EXECUTION_GRANT, executeLocal, prepareLocalInputs } = await import('../scripts/cms-release-s1-local/controller.mjs');
  assert.equal(LOCAL_EXECUTION_GRANT, null);
  let touched = 0;
  const hostile = new Proxy({}, { get() { touched++; throw new Error('must not read request'); }, ownKeys() { touched++; throw new Error('must not inspect request'); } });
  for (const request of [hostile, { approved: true, operator: 'REAL_DRIVER', LOCAL_EXECUTION_GRANT: true }, { env: { LOCAL_EXECUTION_GRANT: 'yes' }, argv: ['--approved'], execute: () => { touched++; } }]) {
    await assert.rejects(executeLocal(request), { code: 'LOCAL_EXECUTION_NOT_AUTHORIZED' });
  }
  await assert.rejects(prepareLocalInputs({ approved: true }), { code: 'LOCAL_EXECUTION_NOT_AUTHORIZED' });
  assert.equal(touched, 0);
});
test('B1 boundary: Docker command plans use exact argv, pinned images, no ports or shell, spaces preserved', async () => {
  const { buildDockerCreateCommands } = await import('../scripts/cms-release-s1-local/controller.mjs');
  const paths = { configDirectory: 'D:\\isolated evidence\\docker-config', profileFile: 'D:\\isolated evidence\\seccomp-unix-only.json' };
  const commands = buildDockerCreateCommands(plan, paths);
  assert.equal(commands.length, 10);
  for (const command of commands) {
    assert.equal(Array.isArray(command.argv), true);
    assert.deepEqual(command.argv.slice(0, 4), ['--config', paths.configDirectory, '--host', LOCAL_DOCKER_ENDPOINT]);
    assert.equal(command.argv.includes('--publish'), false); assert.equal(command.argv.includes('-p'), false);
    assert.equal(command.argv.includes('--privileged'), false);
    assert.equal(command.argv.includes('--rm'), false);
    if (command.action === 'CREATE_CONTAINER') {
      assert.equal(command.argv[command.argv.indexOf('--pull') + 1], 'never');
      assert.ok(command.argv.includes('seccomp=' + paths.profileFile));
      assert.ok(Object.values(PINNED_IMAGES).some((image) => command.argv.includes(image)));
      assert.ok(command.argv.includes('--entrypoint'));
    }
  }
  for (const bad of [{ ...paths, profileFile: '../profile.json' }, { ...paths, configDirectory: 'D:\\safe\\..\\other' }, { ...paths, profileFile: 'D:\\safe\n--privileged' }]) {
    assert.throws(() => buildDockerCreateCommands(plan, bad), { code: 'LOCAL_COMMAND_PLAN_REFUSED' });
  }
});
test('B1 boundary: import audit traps FS mutation, subprocess, network, DB, random and timers (VM flag required)', async () => {
  const vm = await import('node:vm');
  assert.equal(typeof vm.SourceTextModule, 'function', 'Run with --experimental-vm-modules; do not skip this audit.');
  const calls = []; const blocked = (label) => () => { calls.push(label); throw new Error('IMPORT_SIDE_EFFECT_BLOCKED'); };
  const context = vm.createContext({ Buffer, TextEncoder, TextDecoder, URL,
    process: { argv: ['node', 'offline-import-audit'], env: new Proxy({}, { get: blocked('environment read') }), platform: process.platform, arch: process.arch, versions: process.versions },
    console: { log: blocked('console'), error: blocked('console') },
    setTimeout: blocked('timer'), setInterval: blocked('timer'), setImmediate: blocked('timer'), fetch: blocked('network'),
  });
  const modules = new Map();
  async function load(identifier) {
    if (modules.has(identifier)) return modules.get(identifier);
    if (identifier.startsWith('node:')) {
      const actual = await import(identifier);
      const pure = ['node:path', 'node:url', 'node:buffer'].includes(identifier);
      const project = (value, name) => {
        if (typeof value === 'function') return pure || (identifier === 'node:crypto' && name === 'createHash') ? value : blocked(identifier + ':' + name);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, typeof child === 'function' ? (pure || (identifier === 'node:crypto' && key === 'createHash') ? child : blocked(identifier + ':' + key)) : child]));
        return value;
      };
      const names = Object.keys(actual);
      const auditModule = new vm.SyntheticModule(names, function() { for (const name of names) this.setExport(name, project(actual[name], name)); }, { context, identifier });
      modules.set(identifier, auditModule); return auditModule;
    }
    assert.ok(identifier.startsWith(new URL('../scripts/', import.meta.url).href), 'Only reviewed local scripts may be imported.');
    const code = readFileSync(new URL(identifier), 'utf8');
    const auditModule = new vm.SourceTextModule(code, { context, identifier, initializeImportMeta(meta) { meta.url = identifier; }, importModuleDynamically: blocked('dynamic import during evaluation') });
    modules.set(identifier, auditModule); return auditModule;
  }
  const linker = (specifier, referencing) => {
    if (specifier.startsWith('node:')) return load(specifier);
    assert.ok(specifier.startsWith('.'), 'No DB/package import permitted during module evaluation.');
    return load(new URL(specifier, referencing.identifier).href);
  };
  for (const name of ['resource-policy', 'controller', 'prepare-inputs', 'run-local', 'evidence-ledger']) {
    const auditModule = await load(new URL('../scripts/cms-release-s1-local/' + name + '.mjs', import.meta.url).href);
    if (auditModule.status === 'unlinked') await auditModule.link(linker);
    if (auditModule.status !== 'evaluated') await auditModule.evaluate();
  }
  assert.deepEqual(calls, []);
  for (const code of [
    "import {writeFileSync} from 'node:fs'; writeFileSync('forbidden', 'never');",
    "import {spawn} from 'node:child_process'; spawn('forbidden');",
    "import {connect} from 'node:net'; connect(3306);",
    "import {randomBytes} from 'node:crypto'; randomBytes(22);",
  ]) {
    const control = new vm.SourceTextModule(code, { context }); await control.link(linker);
    await assert.rejects(control.evaluate(), /IMPORT_SIDE_EFFECT_BLOCKED/);
  }
  assert.equal(calls.length, 4, 'Negative controls prove effect traps were exercised.');
});

import { execFileSync as gitReadOnly } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { fileURLToPath as toPath } from 'node:url';
import { HARNESS_SHA, INPUT_IDENTITIES, IMAGES, verifyPinnedInputs, prepareMigrationVariants,
  bytesSha256, blobIdentity, validateInputPath, readRegularInput, migrationConfigSource,
  verifyRuntimeSeal, planLinuxPreparation } from '../scripts/cms-release-s1-local/prepare-inputs.mjs';
import { SOURCE_SHA, BASELINE_SHA, MIGRATIONS } from '../scripts/cms-release-s1/fixture-plan.mjs';

// Read-only Git payloads are real local source bytes, not DB/runtime evidence.
let cachedInputs;
function pinnedInputs() {
  if (!cachedInputs) {
    const root = toPath(new URL('../', import.meta.url));
    const commits = { harness: HARNESS_SHA, q1: SOURCE_SHA, old: BASELINE_SHA };
    cachedInputs = { commits, images: { ...IMAGES }, entries: INPUT_IDENTITIES.map((entry) => ({ source: entry.source,
      path: entry.path, bytes: gitReadOnly('git', ['-C', root, 'show', commits[entry.source] + ':' + entry.path],
        { shell: false, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024 }) })) };
  }
  return { commits: { ...cachedInputs.commits }, images: { ...cachedInputs.images },
    entries: cachedInputs.entries.map((entry) => ({ ...entry, bytes: Buffer.from(entry.bytes) })) };
}
test('B1 input: pinned old/Q1/P7 Git bytes, schema, migrations and lock packages verify independently', () => {
  const inputs = pinnedInputs(); const value = verifyPinnedInputs(inputs);
  assert.equal(value.executionAuthorized, false); assert.equal(value.inventory.length, INPUT_IDENTITIES.length);
  for (const [i, entry] of value.inventory.entries()) {
    assert.equal(entry.gitBlob, blobIdentity(inputs.entries[i].bytes));
    assert.equal(entry.rawSha256, bytesSha256(inputs.entries[i].bytes));
    assert.equal(entry.gitPayloadSha256, entry.rawSha256);
  }
  assert.deepEqual(verifyPinnedInputs(inputs), value);
});
for (const [name, mutate] of [
  ['source SHA', (v) => { v.commits.q1 = '0'.repeat(40); }],
  ['baseline SHA', (v) => { v.commits.old = SOURCE_SHA; }],
  ['harness SHA', (v) => { v.commits.harness = SOURCE_SHA; }],
  ['image digest', (v) => { v.images.node = v.images.node.replace(/.$/, '0'); }],
  ['floating image tag', (v) => { v.images.mariadb = 'mariadb:10.11.14'; }],
  ['platform', (v) => { v.images.platform = 'linux/arm64'; }],
  ['schema bytes', (v) => { v.entries[1].bytes[0] ^= 1; }],
  ['lock bytes', (v) => { v.entries[0].bytes[0] ^= 1; }],
  ['duplicate member', (v) => { v.entries[1] = v.entries[0]; }],
  ['extra secret file', (v) => { v.entries.push({ source: 'q1', path: '.env', bytes: Buffer.from('MUST_NOT_READ') }); }],
  ['missing migration', (v) => { v.entries.pop(); }],
  ['working CRLF passed as Git LF', (v) => { v.entries.at(-1).bytes = Buffer.from(v.entries.at(-1).bytes.toString('utf8').replaceAll('\n', '\r\n')); }],
]) test('B1 input: refuses wrong ' + name, () => {
  const value = pinnedInputs(); mutate(value); assert.throws(() => verifyPinnedInputs(value), /^Error: LOCAL_INPUT_REFUSED$/);
});
test('B1 input: exact LF/CRLF controls derive separate hashes without mutating original buffers', () => {
  const input = pinnedInputs(), before = input.entries.map((entry) => bytesSha256(entry.bytes));
  const result = prepareMigrationVariants(input);
  for (const variant of ['lf', 'crlf', 'fault', 'recovery']) result.variants[variant].forEach((entry, index) => {
    assert.equal(entry.sha256, variant === 'crlf' && index < 3 ? MIGRATIONS[index].crlfSha256 : MIGRATIONS[index].lfSha256);
    assert.equal(entry.eol, variant === 'crlf' && index < 3 ? 'CRLF' : 'LF');
  });
  result.variants.lf[0].bytes[0] ^= 1;
  assert.deepEqual(input.entries.map((entry) => bytesSha256(entry.bytes)), before);
});
test('B1 input: secret/traversal/absolute paths are refused before reading files', () => {
  for (const member of ['.env', 'old/.env.local', 'old/.ssh/id_rsa', '../secret', '/absolute', 'C:/secret',
    'q1\\package.json', 'q1//package.json', 'q1/.git/config', 'q1/.npmrc']) {
    assert.throws(() => validateInputPath(member), /LOCAL_INPUT_REFUSED/);
    assert.throws(() => readRegularInput('Z:/does-not-exist', member), /LOCAL_INPUT_REFUSED/);
  }
});
test('B1 input: bounded real reads reject hardlinks and preserve bytes', () => {
  const scratch = mkdtempSync(pathJoin(tmpdir(), 'cms-s1-input-test-'));
  try {
    mkdirSync(pathJoin(scratch, 'q1')); writeFileSync(pathJoin(scratch, 'q1/payload'), 'a\r\nb\n');
    assert.equal(readRegularInput(scratch, 'q1/payload').toString(), 'a\r\nb\n');
    linkSync(pathJoin(scratch, 'q1/payload'), pathJoin(scratch, 'q1/alias'));
    assert.throws(() => readRegularInput(scratch, 'q1/payload'), /LOCAL_INPUT_REFUSED/);
  } finally { assert.match(scratch, /cms-s1-input-test-/); rmSync(scratch, { recursive: true }); }
});
test('B1 input: missing/wrong seal digest fails before attempting filesystem reads', () => {
  for (const hash of [undefined, '', '0'.repeat(64)]) assert.throws(() => verifyRuntimeSeal('Z:/absent', Buffer.from('{}'), hash), /LOCAL_INPUT_REFUSED/);
});
test('B1 input: hostile accessors/proxies do not leak raw errors or run bytes getters', () => {
  let reads = 0; const value = pinnedInputs(); Object.defineProperty(value.entries[0], 'bytes', { get() { reads++; throw Error('credential-canary'); }, enumerable: true });
  assert.throws(() => verifyPinnedInputs(value), /^Error: LOCAL_INPUT_REFUSED$/); assert.equal(reads, 0);
  assert.throws(() => verifyPinnedInputs(new Proxy({}, { getPrototypeOf() { throw Error('credential-canary'); } })), /^Error: LOCAL_INPUT_REFUSED$/);
});
test('B1 input: sealed config generation fixes Unix target and does not inherit DSNs or dotenv', () => {
  for (const variant of ['lf', 'crlf']) for (const count of [4, 7]) {
    const text = migrationConfigSource(variant, count);
    assert.match(text, /socket=\/run\/cms-s1\/mysqld.sock/);
    assert.match(text, /runtime-credentials.json/); assert.doesNotMatch(text, /DATABASE_URL|dotenv|process\.env\.(HOST|PASSWORD|URL)/);
    assert.match(text, new RegExp('/inputs/' + (count === 4 ? 'old' : 'q1') + '/prisma/schema.prisma'));
  }
  assert.throws(() => migrationConfigSource('external', 7)); assert.throws(() => migrationConfigSource('lf', 5));
  assert.equal(planLinuxPreparation().executionAuthorized, false);
});

// Minimal synthetic sealed bundle tests hashing/closure only. Placeholder modules
// here are NEVER imported or used as evidence that Linux clients were generated.
function sealedFixture() {
  const root = mkdtempSync(pathJoin(tmpdir(), 'cms-s1-seal-test-'));
  const members = new Map(); const inputs = pinnedInputs();
  function put(path, bytes) { members.set(path, Buffer.from(bytes)); }
  for (const entry of inputs.entries) put(entry.source + '/' + entry.path, entry.bytes);
  for (const role of ['old', 'q1']) {
    put(role + '/package.json', '{"name":"synthetic"}');
    for (const pkg of ['prisma', '@prisma/client', '@prisma/adapter-mariadb', 'mariadb']) put(role + '/node_modules/' + pkg + '/package.json', JSON.stringify({ version: pkg === 'mariadb' ? '3.4.5' : '7.8.0' }));
    put(role + '/node_modules/.prisma/client/index.js', '// Offline placeholder, never executed\n');
    put(role + '/node_modules/.prisma/client/schema.prisma', inputs.entries.find((x) => x.source === role && x.path === 'prisma/schema.prisma').bytes);
  }
  for (const file of ['run-local.mjs', 'resource-policy.mjs', 'prepare-inputs.mjs', 'evidence-ledger.mjs']) put('local/' + file, '// Offline placeholder, never executed\n');
  for (const entry of inputs.entries.filter((x) => x.source === 'harness')) put('cms-release-s1/' + entry.path.split('/').at(-1), entry.bytes);
  put('q1/node_modules/prisma/config.js', '// Offline placeholder\n'); put('q1/node_modules/prisma/build/index.js', '// Offline placeholder\n');
  put('q1/compiled-consumer.mjs', '// Offline placeholder\n'); put('network-canary', 'OFFLINE-NOT-A-BINARY'); put('seccomp-unix-only.json', profileBytes);
  const derived = prepareMigrationVariants(inputs);
  for (const variant of ['lf', 'crlf']) for (const count of [4, 7]) {
    put('migrations/' + variant + '/' + count + '/prisma.config.mjs', migrationConfigSource(variant, count));
    for (const item of derived.variants[variant].slice(0, count)) put('migrations/' + variant + '/' + count + '/migrations/' + item.name + '/migration.sql', item.bytes);
  }
  for (const [name, bytes] of members) { const parts = name.split('/'); parts.pop(); mkdirSync(pathJoin(root, ...parts), { recursive: true }); writeFileSync(pathJoin(root, name), bytes); }
  const seal = { schema: 'cms-s1-local-seal/v1', harnessSha: HARNESS_SHA, sourceSha: SOURCE_SHA, baselineSha: BASELINE_SHA,
    runNonce: input.runNonce, attempt: 1, images: { ...IMAGES }, inputSha256: verifyPinnedInputs(inputs).inputSha256,
    seccompSha256: bytesSha256(profileBytes), canarySha256: bytesSha256(members.get('network-canary')),
    resourcePlanSha256: id('a'), daemonSha256: id('b'), files: [...members].map(([path, bytes]) => ({ path, sha256: bytesSha256(bytes) })) };
  const bytes = Buffer.from(JSON.stringify(seal)); writeFileSync(pathJoin(root, 'local-seal.json'), bytes);
  return { root, bytes, hash: bytesSha256(bytes), seal };
}
function withSeal(fn) {
  const fixture = sealedFixture();
  try { fn(fixture); } finally { assert.match(fixture.root, /cms-s1-seal-test-/); rmSync(fixture.root, { recursive: true }); }
}
test('B1 seal: complete byte inventory is consistency only, never Linux client or native-canary proof', () => withSeal(({ root, bytes, hash }) => {
  const result = verifyRuntimeSeal(root, bytes, hash); assert.equal(result.provenanceVerified, true);
  assert.equal(result.executionAuthorized, false); assert.equal(result.sealSha256, hash);
}));
test('B1 seal: mismatched in-root seal rejected even when supplied external seal hashes correctly', () => withSeal(({ root, bytes, hash }) => {
  writeFileSync(pathJoin(root, 'local-seal.json'), '{}'); assert.throws(() => verifyRuntimeSeal(root, bytes, hash), /LOCAL_INPUT_REFUSED/);
}));
test('B1 seal: undeclared executable closure member rejected', () => withSeal(({ root, bytes, hash }) => {
  writeFileSync(pathJoin(root, 'q1/unhashed.mjs'), 'throw 0;'); assert.throws(() => verifyRuntimeSeal(root, bytes, hash), /LOCAL_INPUT_REFUSED/);
}));
test('B1 seal: omitted required client member rejected even when manifest and hash are self-consistent', () => withSeal(({ root, seal }) => {
  const missing = 'q1/node_modules/.prisma/client/index.js'; rmSync(pathJoin(root, missing));
  seal.files = seal.files.filter((f) => f.path !== missing); const bytes = Buffer.from(JSON.stringify(seal)); writeFileSync(pathJoin(root, 'local-seal.json'), bytes);
  assert.throws(() => verifyRuntimeSeal(root, bytes, bytesSha256(bytes)), /LOCAL_INPUT_REFUSED/);
}));
test('B1 seal: altered derived migration/config rejected despite caller recomputing manifest digest', () => {
  for (const member of ['migrations/crlf/7/prisma.config.mjs', 'migrations/crlf/7/migrations/' + MIGRATIONS[0].name + '/migration.sql']) withSeal(({ root, seal }) => {
    const corrupt = Buffer.from('/* changed */\n'); writeFileSync(pathJoin(root, member), corrupt);
    seal.files.find((f) => f.path === member).sha256 = bytesSha256(corrupt);
    const bytes = Buffer.from(JSON.stringify(seal)); writeFileSync(pathJoin(root, 'local-seal.json'), bytes);
    assert.throws(() => verifyRuntimeSeal(root, bytes, bytesSha256(bytes)), /LOCAL_INPUT_REFUSED/);
  });
});
test('B1 input: Windows case-insensitive secret names are rejected', () => {
  for (const member of ['.SSH/id_rsa', '.NPMRC', '.NETRC', '.GIT/config', '.DoCkEr/config.json', '.AWS/credentials']) assert.throws(() => validateInputPath(member), /LOCAL_INPUT_REFUSED/);
});
