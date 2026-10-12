/** Pure, offline consistency checks. Supplied observations are never execution authority. */
import { createHash } from 'node:crypto';

export const LOCAL_PLATFORM = 'linux/amd64';
export const LOCAL_DOCKER_CONTEXT = 'desktop-linux';
export const LOCAL_DOCKER_ENDPOINT = 'npipe:////./pipe/dockerDesktopLinuxEngine';
export const SOCKET_PATH = '/run/cms-s1/mysqld.sock';
export const SOURCE_IDENTITIES = Object.freeze({
  harness: '17ffb61232de69f1be41ab61f44dc6246328b22c',
  application: '61c5591bb875bffaeb3d71d2f734d39d1e87faf7',
  oldApplication: '5e6b14f006453da7f9b1554c210e9ad85a9f8c0c',
});
export const PINNED_IMAGES = Object.freeze({
  mariadb: 'mariadb:10.11.14@sha256:3a7d3cbc8b6fddf66433d80dc124c1e4e75a73ebab9c6e137529cc270bdadfc0',
  node: 'node:22-bookworm@sha256:c4d5523090a817b7aa86d2111241fdd4f66d1e27782b44160e6aa63b357ecb2d',
});
export const PROFILE_CANONICAL_SHA256 = '204af2361d5e4a5aced1f4cdc1d133f3775b65f0538a3047772711f5d54753d4';
const HASH = /^[a-f0-9]{64}$/;
const NONCE = /^[a-f0-9]{22}$/;
const DAEMON = /^[a-zA-Z0-9_-]{8,128}$/;
const OWNER = 'cms-release-s1-local';
const PROFILE_PATH = '/inputs/seccomp-unix-only.json';
const fail = (code) => Object.freeze({ ok: false, code });
function requireTrue(value, code) { if (!value) throw new Error(code); }
function safe(fn, code = 'RESOURCE_IDENTITY_INVALID') {
  try { return fn(); } catch { return fail(code); }
}
function data(value, depth = 0, budget = { count: 0 }) {
  requireTrue(++budget.count <= 8000 && depth <= 16, 'INPUT_INVALID');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') { requireTrue(Number.isSafeInteger(value), 'INPUT_INVALID'); return value; }
  if (typeof value === 'string') { requireTrue(value.length <= 8192 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value), 'INPUT_INVALID'); return value; }
  requireTrue(typeof value === 'object', 'INPUT_INVALID');
  const proto = Object.getPrototypeOf(value);
  requireTrue(proto === Object.prototype || proto === null || (Array.isArray(value) && proto === Array.prototype), 'INPUT_INVALID');
  const result = Array.isArray(value) ? [] : {};
  const descriptors = Object.getOwnPropertyDescriptors(value);
  requireTrue(Reflect.ownKeys(descriptors).every((key) => typeof key === 'string'), 'INPUT_INVALID');
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (Array.isArray(value) && key === 'length') continue;
    requireTrue(descriptor.enumerable && Object.hasOwn(descriptor, 'value') && !['__proto__', 'constructor', 'prototype'].includes(key), 'INPUT_INVALID');
    if (Array.isArray(value)) requireTrue(/^(0|[1-9][0-9]*)$/.test(key), 'INPUT_INVALID');
    result[key] = data(descriptor.value, depth + 1, budget);
  }
  if (Array.isArray(value)) requireTrue(result.length === value.length && Object.keys(result).length === value.length, 'INPUT_INVALID');
  return result;
}
function keys(record, expected) {
  requireTrue(record && !Array.isArray(record) && typeof record === 'object', 'INPUT_INVALID');
  requireTrue(JSON.stringify(Object.keys(record).sort()) === JSON.stringify([...expected].sort()), 'INPUT_INVALID');
}
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
const equal = (a, b) => canonical(a) === canonical(b);
const digest = (value) => createHash('sha256').update(canonical(value)).digest('hex');
function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function labels(runNonce, role) { return { 'cms.s1.owner': OWNER, 'cms.s1.run': runNonce, 'cms.s1.role': role, 'cms.s1.source': SOURCE_IDENTITIES.harness }; }
function numericIdentity(uid) { return Number.isSafeInteger(uid) && uid > 0 && uid <= 2147483647; }

export function validateLocalContext(observation, expectedDaemonId) {
  return safe(() => {
    const value = data(observation);
    keys(value, ['contextName', 'endpoint', 'daemonId', 'operatingSystem', 'architecture', 'overrides']);
    requireTrue(DAEMON.test(expectedDaemonId) && value.daemonId === expectedDaemonId, 'CONTEXT_INVALID');
    requireTrue(value.contextName === LOCAL_DOCKER_CONTEXT && value.endpoint === LOCAL_DOCKER_ENDPOINT, 'CONTEXT_INVALID');
    requireTrue(value.operatingSystem === 'linux' && value.architecture === 'x86_64', 'CONTEXT_INVALID');
    requireTrue(equal(value.overrides, {}), 'CONTEXT_INVALID');
    return freeze({ ok: true, daemonId: value.daemonId, executionAuthorized: false });
  }, 'LOCAL_CONTEXT_REJECTED');
}

/** Even a well-shaped approval object cannot unlock this offline candidate. */
export function validateLocalGrant() { return fail('LOCAL_EXECUTION_NOT_AUTHORIZED'); }

export function createResourcePlan(input) {
  return safe(() => {
    const value = data(input);
    keys(value, ['runNonce', 'daemonId', 'seccompSha256', 'nodeUid', 'nodeGid', 'mariaDbUid', 'mariaDbGid']);
    requireTrue(NONCE.test(value.runNonce) && DAEMON.test(value.daemonId) && HASH.test(value.seccompSha256), 'PLAN_INVALID');
    requireTrue(['nodeUid', 'nodeGid', 'mariaDbUid', 'mariaDbGid'].every((key) => numericIdentity(value[key])), 'PLAN_INVALID');
    requireTrue(value.nodeGid === value.mariaDbGid, 'SHARED_SOCKET_GROUP_REQUIRED');
    const prefix = 'cms-s1-local-' + value.runNonce + '-';
    const network = { name: prefix + 'network', driver: 'bridge', internal: true, ipv6: false, options: {}, labels: labels(value.runNonce, 'network') };
    const volumes = ['inputs', 'work', 'evidence', 'data', 'socket'].map((role) => ({ name: prefix + role, role, driver: 'local', options: {}, labels: labels(value.runNonce, role) }));
    const mount = (role, target, readOnly) => ({ type: 'volume', source: prefix + role, target, readOnly });
    const security = {
      readOnlyRootfs: true, privileged: false, capDrop: ['ALL'], capAdd: [],
      noNewPrivileges: true, seccompSha256: value.seccompSha256, seccompPath: PROFILE_PATH,
      pidMode: 'private', ipcMode: 'private', usernsMode: 'private', devices: [], extraHosts: [],
      portBindings: {}, publishAllPorts: false, binds: [], environment: ['TZ=UTC'], logDriver: 'none',
      restartPolicy: 'no', autoRemove: false, platform: LOCAL_PLATFORM,
    };
    const containers = ['db', 'node', 'db-canary', 'node-canary'].map((role) => {
      const db = role.startsWith('db'); const canary = role.endsWith('-canary');
      return {
        name: prefix + role, role, labels: labels(value.runNonce, role),
        image: db ? PINNED_IMAGES.mariadb : PINNED_IMAGES.node,
        user: db ? value.mariaDbUid + ':' + value.mariaDbGid : value.nodeUid + ':' + value.nodeGid,
        networkName: network.name, security,
        memoryBytes: db ? 2147483648 : 6442450944, nanoCpus: db ? 2000000000 : 4000000000, pidsLimit: 256,
        tmpfs: { '/tmp': 'rw,nosuid,nodev,noexec,size=268435456', '/run/cms-s1-private': 'rw,nosuid,nodev,noexec,size=1048576,mode=0700' },
        mounts: canary ? [mount('inputs', '/inputs', true)] : db
          ? [mount('inputs', '/inputs', true), mount('data', '/var/lib/mysql', false), mount('socket', '/run/cms-s1', false)]
          : [mount('inputs', '/inputs', true), mount('work', '/work', false), mount('evidence', '/evidence', false), mount('socket', '/run/cms-s1', false)],
        command: canary ? ['/inputs/network-canary'] : db
          ? ['mariadbd', '--skip-networking', '--socket=' + SOCKET_PATH, '--datadir=/var/lib/mysql', '--pid-file=/tmp/mariadb.pid', '--sql-mode=ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION', '--character-set-server=latin1', '--collation-server=latin1_swedish_ci', '--default-time-zone=SYSTEM']
          : ['node', '/inputs/local/run-local.mjs'],
      };
    });
    return freeze({ ok: true, plan: { kind: 'CMS_S1_LOCAL_PLAN_V1', input: value, network, volumes, containers, databaseNames: ['lf', 'crlf', 'fault', 'recovery'].map((variant) => 's1_' + value.runNonce + '_' + variant), executionAuthorized: false } });
  }, 'RESOURCE_PLAN_REJECTED');
}
function verifiedPlan(plan) {
  const value = data(plan); const built = createResourcePlan(value.input);
  requireTrue(built.ok && equal(built.plan, value), 'PLAN_INVALID'); return value;
}

/** JSON parsing alone is insufficient: compare the complete reviewed syscall policy AND its critical semantics. */
export function validateSeccompProfile(profile) {
  return safe(() => {
    const value = data(profile);
    keys(value, ['defaultAction', 'defaultErrnoRet', 'architectures', 'syscalls']);
    requireTrue(value.defaultAction === 'SCMP_ACT_ERRNO' && value.defaultErrnoRet === 1, 'PROFILE_INVALID');
    requireTrue(equal(value.architectures, ['SCMP_ARCH_X86_64']) && value.syscalls.length === 4, 'PROFILE_INVALID');
    for (const forbidden of ['socketcall', 'io_uring_setup', 'io_uring_enter', 'io_uring_register', 'bpf', 'ptrace', 'process_vm_readv', 'process_vm_writev', 'setns', 'unshare']) {
      requireTrue(!value.syscalls.some((rule) => rule.action === 'SCMP_ACT_ALLOW' && rule.names.includes(forbidden)), 'PROFILE_INVALID');
    }
    requireTrue(equal(value.syscalls[1], { names: ['socket', 'socketpair'], action: 'SCMP_ACT_ALLOW', args: [{ index: 0, value: 1, op: 'SCMP_CMP_EQ' }] }), 'PROFILE_INVALID');
    requireTrue(!value.syscalls[0].names.includes('socket') && !value.syscalls[0].names.includes('socketpair'), 'PROFILE_INVALID');
    const canonicalSha256 = createHash('sha256').update(JSON.stringify(value)).digest('hex');
    requireTrue(canonicalSha256 === PROFILE_CANONICAL_SHA256, 'PROFILE_INVALID');
    return freeze({ ok: true, canonicalSha256, runtimeIsolation: 'NOT_VERIFIED' });
  }, 'SECCOMP_PROFILE_REJECTED');
}

function verifyInventory(plan, observation, phase) {
  const value = data(observation);
  keys(value, ['context', 'network', 'volumes', 'containers', 'ledger']);
  requireTrue(validateLocalContext(value.context, plan.input.daemonId).ok, 'CONTEXT_INVALID');
  requireTrue(['ABSENT', 'CREATED', 'STOPPED'].includes(phase), 'PHASE_INVALID');
  if (phase === 'ABSENT') {
    requireTrue(value.network === null && equal(value.volumes, []) && equal(value.containers, []) && equal(value.ledger, []), 'ALREADY_EXISTS');
    return value;
  }
  const net = value.network;
  keys(net, ['id', 'spec', 'attachedContainerIds']);
  requireTrue(HASH.test(net.id) && equal(net.spec, plan.network), 'NETWORK_INVALID');
  requireTrue(value.containers.length === plan.containers.length && value.volumes.length === plan.volumes.length, 'INVENTORY_INVALID');
  const ids = new Set(); const names = new Set();
  for (const container of value.containers) {
    keys(container, ['id', 'spec', 'state', 'networkIds']);
    requireTrue(HASH.test(container.id) && !ids.has(container.id) && !names.has(container.spec.name), 'CONTAINER_INVALID');
    ids.add(container.id); names.add(container.spec.name);
    requireTrue(equal(container.spec, plan.containers.find((entry) => entry.name === container.spec.name)), 'CONTAINER_INVALID');
    requireTrue(equal(container.networkIds, [net.id]), 'CONTAINER_INVALID');
    requireTrue(phase === 'STOPPED' ? container.state === 'exited' : ['created', 'running', 'exited'].includes(container.state), 'CONTAINER_INVALID');
  }
  requireTrue(equal([...net.attachedContainerIds].sort(), [...ids].sort()), 'NETWORK_INVALID');
  for (const expected of plan.volumes) {
    const matching = value.volumes.filter((entry) => entry.name === expected.name);
    requireTrue(matching.length === 1, 'VOLUME_INVALID'); const volume = matching[0];
    keys(volume, ['daemonId', 'name', 'createdAt', 'driver', 'options', 'labels', 'consumers']);
    requireTrue(volume.daemonId === plan.input.daemonId && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(volume.createdAt), 'VOLUME_INVALID');
    requireTrue(volume.driver === 'local' && equal(volume.options, {}) && equal(volume.labels, expected.labels), 'VOLUME_INVALID');
    const consumers = value.containers.filter((entry) => entry.spec.mounts.some((mount) => mount.source === volume.name)).map((entry) => entry.id).sort();
    requireTrue(equal([...volume.consumers].sort(), consumers), 'UNEXPECTED_CONSUMER');
  }
  const expectedLedger = [{ kind: 'network', name: net.spec.name, id: net.id }, ...value.containers.map((entry) => ({ kind: 'container', name: entry.spec.name, id: entry.id })), ...value.volumes.map((entry) => ({ kind: 'volume', name: entry.name, id: volumeIdentityHash(entry).sha256 }))];
  requireTrue(value.ledger.length === expectedLedger.length && value.ledger.every((entry) => expectedLedger.filter((expected) => equal(entry, expected)).length === 1), 'LEDGER_INVALID');
  requireTrue(new Set(value.ledger.map((entry) => entry.kind + ':' + entry.name)).size === expectedLedger.length, 'LEDGER_INVALID');
  return value;
}
export function validateResourceObservations(plan, observation, options = { phase: 'CREATED' }) {
  return safe(() => { const p = verifiedPlan(plan); const o = data(options); keys(o, ['phase']); verifyInventory(p, observation, o.phase); return freeze({ ok: true, phase: o.phase, runtimeIsolation: 'NOT_VERIFIED' }); });
}
export function volumeIdentityHash(observation) {
  return safe(() => {
    const value = data(observation); keys(value, ['daemonId', 'name', 'createdAt', 'driver', 'options', 'labels', 'consumers']);
    const identity = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'consumers'));
    requireTrue(DAEMON.test(identity.daemonId) && /^cms-s1-local-[a-f0-9]{22}-(inputs|work|evidence|data|socket)$/.test(identity.name), 'VOLUME_INVALID');
    requireTrue(identity.driver === 'local' && equal(identity.options, {}), 'VOLUME_INVALID');
    return freeze({ ok: true, sha256: digest(identity) });
  });
}

/** Plans deletion only; a caller boolean never performs or authorizes an effect. Revalidate immediately before each future deletion. */
export function planExactOwnedCleanup(plan, observation, options) {
  return safe(() => {
    const p = verifiedPlan(plan); const o = data(options);
    keys(o, ['outcome', 'ledgerComplete', 'cleanupApproved']);
    requireTrue(['PASS', 'STOPPED'].includes(o.outcome) && o.ledgerComplete === true && o.cleanupApproved === true, 'CLEANUP_NOT_ALLOWED');
    const value = verifyInventory(p, observation, 'STOPPED');
    const actions = [
      ...value.containers.map((entry) => ({ operation: 'REMOVE_CONTAINER', kind: 'container', name: entry.spec.name, id: entry.id })),
      { operation: 'REMOVE_NETWORK_AFTER_DETACH', kind: 'network', name: value.network.spec.name, id: value.network.id },
      ...value.volumes.map((entry) => ({ operation: 'REMOVE_VOLUME_AFTER_CONSUMER_RECHECK', kind: 'volume', name: entry.name, id: volumeIdentityHash(entry).sha256 })),
    ];
    return freeze({ ok: true, actions, executionAuthorized: false, revalidationRequiredBeforeEachAction: true });
  }, 'CLEANUP_REFUSED');
}

export function validateLocalTarget(plan, observation) {
  return safe(() => {
    const p = verifiedPlan(plan); const value = data(observation);
    keys(value, ['resources', 'databaseName', 'socket']);
    verifyInventory(p, value.resources, 'CREATED');
    requireTrue(p.databaseNames.includes(value.databaseName), 'TARGET_INVALID');
    keys(value.socket, ['path', 'type', 'isSymlink', 'volumeName', 'device', 'inode', 'uid', 'gid', 'mode', 'serverContainerId']);
    requireTrue(value.socket.path === SOCKET_PATH && value.socket.type === 'socket' && value.socket.isSymlink === false, 'SOCKET_INVALID');
    requireTrue(value.socket.volumeName === p.volumes.find((entry) => entry.role === 'socket').name, 'SOCKET_INVALID');
    requireTrue([value.socket.device, value.socket.inode].every((entry) => Number.isSafeInteger(entry) && entry > 0), 'SOCKET_INVALID');
    requireTrue(value.socket.uid === p.input.mariaDbUid && value.socket.gid === p.input.nodeGid && p.input.nodeGid === p.input.mariaDbGid && value.socket.mode === 432, 'SOCKET_INVALID');
    requireTrue(value.socket.serverContainerId === value.resources.containers.find((entry) => entry.spec.role === 'db').id, 'SOCKET_INVALID');
    return freeze({ ok: true, databaseName: value.databaseName, socketPath: SOCKET_PATH, runtimeIdentity: 'SUPPLIED_OBSERVATION_ONLY' });
  }, 'LOCAL_TARGET_REJECTED');
}

export function validateCanaryEvidence(plan, evidence, resources, expectedBinarySha256) {
  return safe(() => {
    const p = verifiedPlan(plan); const value = data(evidence);
    const inventory = verifyInventory(p, resources, 'CREATED');
    requireTrue(HASH.test(expectedBinarySha256), 'CANARY_INVALID');
    requireTrue(Array.isArray(value) && value.length === 2, 'CANARY_INVALID');
    const expectedImages = Object.values(PINNED_IMAGES);
    requireTrue(new Set(value.map((entry) => entry.image)).size === 2, 'CANARY_INVALID');
    for (const entry of value) {
      keys(entry, ['image', 'containerId', 'profileSha256', 'binarySha256', 'user', 'result']);
      const expected = p.containers.find((container) => container.role.endsWith('-canary') && container.image === entry.image);
      requireTrue(expectedImages.includes(entry.image) && HASH.test(entry.containerId) && entry.binarySha256 === expectedBinarySha256, 'CANARY_INVALID');
      const actualContainer = inventory.containers.find((container) => container.spec.name === expected.name);
      requireTrue(entry.containerId === actualContainer.id && actualContainer.state === 'exited', 'CANARY_INVALID');
      requireTrue(entry.profileSha256 === p.input.seccompSha256 && entry.user === expected.user, 'CANARY_INVALID');
      keys(entry.result, ['kind', 'architecture', 'seccomp', 'noNewPrivileges', 'capEffZero', 'capBndZero', 'inheritedInetZero', 'unixPass', 'deniedFamilies', 'alternateAbiDenied', 'ioUringDenied', 'pass']);
      requireTrue(equal(entry.result, { kind: 'CMS_S1_NETWORK_CANARY_V1', architecture: 'x86_64', seccomp: 2, noNewPrivileges: 1, capEffZero: true, capBndZero: true, inheritedInetZero: true, unixPass: true, deniedFamilies: 45, alternateAbiDenied: true, ioUringDenied: true, pass: true }), 'CANARY_INVALID');
    }
    return freeze({ ok: true, claim: 'EVIDENCE_STRUCTURE_ONLY_NOT_RUNTIME_ATTESTATION' });
  }, 'NETWORK_CANARY_REJECTED');
}
