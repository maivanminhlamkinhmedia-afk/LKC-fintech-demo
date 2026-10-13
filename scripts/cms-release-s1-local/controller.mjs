// Dormant local orchestration. This source candidate contains NO execution authority.
import { createHash } from 'node:crypto';
import { createResourcePlan, validateLocalContext, validateResourceObservations,
  validateSeccompProfile, validateCanaryEvidence, volumeIdentityHash, LOCAL_DOCKER_ENDPOINT } from './resource-policy.mjs';
import { verifyPinnedInputs, verifyRuntimeSeal, bytesSha256, HARNESS_SHA } from './prepare-inputs.mjs';
import { openEvidenceLedger, createFileLedgerAdapter } from './evidence-ledger.mjs';

export const LOCAL_EXECUTION_GRANT = null;
const DOCKER_EXECUTABLE = 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe';
const HEX = /^[a-f0-9]{64}$/;
function fail(code) { throw Object.assign(new Error(code), { code }); }
function check(ok, code = 'LOCAL_PREFLIGHT_REFUSED') { if (!ok) fail(code); }
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
const digest = (value) => createHash('sha256').update(canonical(value)).digest('hex');

/** Offline consistency only; caller claims (including a perfect fake) grant nothing. */
export function assessLocalPreflight(input) {
  try {
    const built = createResourcePlan(input.resourceInput);
    check(built.ok && validateLocalContext(input.context, built.plan.input.daemonId).ok);
    check(validateSeccompProfile(input.profile).ok);
    const source = verifyPinnedInputs(input.inputs);
    check(validateResourceObservations(built.plan, input.inventory, { phase: 'ABSENT' }).ok);
    return Object.freeze({ consistent: true, executionAuthorized: false, code: 'LOCAL_EXECUTION_HOLD',
      sourceSha256: source.inputSha256, resourcePlanSha256: digest(built.plan) });
  } catch { return Object.freeze({ consistent: false, executionAuthorized: false, code: 'LOCAL_PREFLIGHT_REFUSED' }); }
}

/** Argv is generated ONLY from a plan rebuilt by resource-policy, never shell text.
 * No subprocess is run here. profileFile/configDirectory are derived from the
 * separately attested local run root in the dormant executor, not CLI options.
 */
export function buildDockerCreateCommands(plan, paths) {
  try {
    const built = createResourcePlan(plan.input);
    check(built.ok && canonical(plan) === canonical(built.plan));
    check(paths && Object.keys(paths).sort().join('|') === 'configDirectory|profileFile');
    for (const value of Object.values(paths)) check(typeof value === 'string'
      && /^[A-Za-z]:[\\/]/.test(value) && !/[\r\n\0]/.test(value)
      && !value.split(/[\\/]/).includes('..'));
    const prefix = ['--config', paths.configDirectory, '--host', LOCAL_DOCKER_ENDPOINT];
    const labels = (entries) => Object.entries(entries).flatMap(([key, value]) => ['--label', key + '=' + value]);
    const network = { action: 'CREATE_NETWORK', name: plan.network.name,
      argv: [...prefix, 'network', 'create', '--driver', 'bridge', '--internal', ...labels(plan.network.labels), plan.network.name] };
    const volumes = plan.volumes.map((volume) => ({ action: 'CREATE_VOLUME', name: volume.name,
      argv: [...prefix, 'volume', 'create', '--driver', 'local', ...labels(volume.labels), volume.name] }));
    const containers = plan.containers.map((container) => ({ action: 'CREATE_CONTAINER', name: container.name,
      argv: [...prefix, 'create', '--pull', 'never', '--platform', 'linux/amd64', '--name', container.name,
        '--network', plan.network.name, '--user', container.user, '--read-only', '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges=true', '--security-opt', 'seccomp=' + paths.profileFile,
        '--ipc', 'private', '--pids-limit', String(container.pidsLimit), '--memory', String(container.memoryBytes),
        '--cpus', String(container.nanoCpus / 1e9), '--restart', 'no', '--log-driver', 'none',
        ...labels(container.labels), ...container.security.environment.flatMap((entry) => ['--env', entry]), ...Object.entries(container.tmpfs).flatMap(([target, options]) => ['--tmpfs', target + ':' + options]),
        ...container.mounts.flatMap((mount) => ['--mount', 'type=volume,source=' + mount.source + ',target=' + mount.target + (mount.readOnly ? ',readonly' : '')]),
        '--entrypoint', container.command[0], container.image, ...container.command.slice(1)] }));
    return Object.freeze([network, ...volumes, ...containers].map((entry) => Object.freeze({ ...entry, argv: Object.freeze(entry.argv) })));
  } catch { fail('LOCAL_COMMAND_PLAN_REFUSED'); }
}

/** The only public effectful entry point. Denial precedes getters/imports/IO.
 * A future grant requires a reviewed source change and operator attestation;
 * no env, argument, JSON or REAL_DRIVER flag is consulted as authority here.
 */
export async function executeLocal(request) {
  if (LOCAL_EXECUTION_GRANT === null) fail('LOCAL_EXECUTION_NOT_AUTHORIZED');
  return executeAdmittedLocal(request, LOCAL_EXECUTION_GRANT);
}

/** No cleanup execution API is exposed. Resource policy returns plans only. */
export async function prepareLocalInputs() {
  if (LOCAL_EXECUTION_GRANT === null) fail('LOCAL_EXECUTION_NOT_AUTHORIZED');
  // Bootstrap includes package acquisition, compiler and volume initialization.
  // Its separate authority is deliberately absent even from an eventual DB grant.
  fail('LOCAL_BOOTSTRAP_REQUIRES_SEPARATE_REVIEWED_GRANT');
}

// The following functions are dormant implementation, not adapters accessible
// to caller JSON. Every process operation requires the internal reviewed grant.
async function executeAdmittedLocal(request, authority) {
  check(authority !== null && authority === LOCAL_EXECUTION_GRANT, 'LOCAL_EXECUTION_NOT_AUTHORIZED');
  const { readFileSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  // These observations must be supplied by a separately reviewed trusted local
  // admission bridge. Neither request nor its supplied JSON can be that bridge.
  check(authority.trustedLocalAdmission !== undefined && authority.bootstrapComplete === true,
    'LOCAL_ADMISSION_NOT_IMPLEMENTED');
  const admitted = await authority.trustedLocalAdmission.observe(request);
  const plan = createResourcePlan(admitted.resourceInput);
  check(plan.ok && validateLocalContext(admitted.context, plan.plan.input.daemonId).ok);
  check(validateSeccompProfile(admitted.profile).ok);
  const seal = verifyRuntimeSeal(admitted.inputsRoot, readFileSync(admitted.sealFile), authority.sealSha256);
  check(seal.harnessSha === HARNESS_SHA && seal.runNonce === plan.plan.input.runNonce
    && seal.resourcePlanSha256 === digest(plan.plan)
    && seal.seccompSha256 === bytesSha256(readFileSync(admitted.profileFile)));
  // Never adopt resources by prefix or reconstruct ownership from labels alone.
  check(validateResourceObservations(plan.plan, admitted.inventory, { phase: 'ABSENT' }).ok);
  const ledger = openEvidenceLedger({ adapter: createFileLedgerAdapter({ root: admitted.evidenceRoot,
    directoryName: 'cms-s1-local-' + seal.runNonce }), identity: { runId: seal.runNonce, sourceSha: HARNESS_SHA,
    inputSha256: seal.inputSha256, daemonSha256: seal.daemonSha256,
    resourcePlanSha256: seal.resourcePlanSha256, seccompSha256: seal.seccompSha256 } });
  const base = ['--config', admitted.configDirectory, '--host', LOCAL_DOCKER_ENDPOINT];
  const processEnv = { SystemRoot: 'C:\\Windows', PATH: 'C:\\Windows\\System32',
    TEMP: admitted.privateTemp, TMP: admitted.privateTemp };
  let pending = null; let sequence = 0;
  const owned = [];
  const nextOperation = () => 'op-' + String(++sequence).padStart(4, '0');
  function command(argv, alreadyPrefixed = false) {
    // No shell; no inherited environment; raw streams never reach evidence.
    try {
      return execFileSync(DOCKER_EXECUTABLE, (alreadyPrefixed ? argv : [...base, ...argv]), { shell: false,
        windowsHide: true, env: processEnv, timeout: 120000, maxBuffer: 1048576,
        encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { fail('LOCAL_PROCESS_UNKNOWN_OUTCOME'); }
  }
  function operate(action, resource, argv) {
    const id = nextOperation();
    ledger.intent({ operationId: id, action, inputSha256: digest(argv), resource }); pending = id;
    const bytes = command(argv);
    ledger.ack(id, { code: 'OK', evidenceSha256: bytesSha256(bytes), resource }); pending = null;
    return bytes;
  }
  try {
    // Durable create intents precede all Docker resource creation. Never accept
    // an existing resource merely because its labels resemble this run.
    const creates = buildDockerCreateCommands(plan.plan, {
      configDirectory: admitted.configDirectory, profileFile: admitted.profileFile,
    });
    for (const operation of creates) {
      const kind = { CREATE_NETWORK: 'network', CREATE_VOLUME: 'volume', CREATE_CONTAINER: 'container' }[operation.action];
      const id = nextOperation(), resource = { kind, name: operation.name };
      ledger.intent({ operationId: id, action: operation.action, inputSha256: digest(operation.argv), resource }); pending = id;
      const bytes = command(operation.argv, true);
      let resourceId;
      if (kind === 'volume') {
        check(bytes.toString('utf8').trim() === resource.name, 'LOCAL_CREATE_ACK_REFUSED');
        const tuple = await authority.trustedLocalAdmission.observeVolume(resource.name);
        check(tuple.name === resource.name && tuple.daemonId === plan.plan.input.daemonId
          && tuple.driver === 'local' && canonical(tuple.options) === '{}'
          && canonical(tuple.labels) === canonical(plan.plan.volumes.find((v) => v.name === resource.name).labels)
          && tuple.consumers.length === 0, 'LOCAL_CREATE_ACK_REFUSED');
        const identity = volumeIdentityHash(tuple); check(identity.ok); resourceId = identity.sha256;
      } else { resourceId = bytes.toString('utf8').trim(); check(HEX.test(resourceId), 'LOCAL_CREATE_ACK_REFUSED'); }
      const actual = { ...resource, id: resourceId };
      ledger.ack(id, { code: 'OK', evidenceSha256: bytesSha256(bytes), resource: actual }); pending = null; owned.push(actual);
    }
    let inventory = await authority.trustedLocalAdmission.observeResources();
    check(canonical([...inventory.ledger].sort((a,b) => a.name.localeCompare(b.name)))
      === canonical([...owned].sort((a,b) => a.name.localeCompare(b.name))), 'LOCAL_OWNERSHIP_REFUSED');
    check(validateResourceObservations(plan.plan, inventory, { phase: 'CREATED' }).ok);
    // Volume population/rootless initialization requires the separately reviewed
    // bootstrap bridge. This candidate does not supply or fabricate that authority.
    const inputResource = owned.find((x) => x.kind === 'volume' && x.name.endsWith('-inputs'));
    const transferId = nextOperation();
    ledger.intent({ operationId: transferId, action: 'TRANSFER_INPUTS', inputSha256: seal.inputSha256, resource: inputResource }); pending = transferId;
    const transfer = await authority.trustedLocalAdmission.populateOwnedVolumesFromSealedBundle(seal, owned);
    check(transfer.verified === true && HEX.test(transfer.sha256), 'LOCAL_BOOTSTRAP_EVIDENCE_MISSING');
    ledger.ack(transferId, { code: 'OK', evidenceSha256: transfer.sha256, resource: inputResource }); pending = null;
    inventory = await authority.trustedLocalAdmission.observeResources();
    check(validateResourceObservations(plan.plan, inventory, { phase: 'CREATED' }).ok);
    const canaries = [];
    for (const spec of plan.plan.containers.filter((x) => x.role.endsWith('-canary'))) {
      const observed = inventory.containers.find((x) => x.spec.name === spec.name);
      check(observed && HEX.test(observed.id));
      const resource = { kind: 'container', name: spec.name, id: observed.id };
      const bytes = operate('RUN_CANARY', resource, ['start', '--attach', observed.id]);
      check(bytes.length <= 4096, 'LOCAL_CANARY_OUTPUT_REFUSED');
      let result; try { result = JSON.parse(bytes.toString('utf8')); } catch { fail('LOCAL_CANARY_OUTPUT_REFUSED'); }
      canaries.push({ image: spec.image, containerId: observed.id, profileSha256: seal.seccompSha256,
        binarySha256: seal.canarySha256, user: spec.user, result });
    }
    check(validateCanaryEvidence(plan.plan, canaries, await authority.trustedLocalAdmission.observeResources(), seal.canarySha256).ok, 'LOCAL_CANARY_REFUSED');
    // Bridge must re-read exact IDs, volumes, networks, mounts and profile before
    // EACH phase; stale plan alone is not a live Docker attestation.
    check(validateResourceObservations(plan.plan, await authority.trustedLocalAdmission.observeResources(), { phase: 'CREATED' }).ok);
    for (const role of ['db', 'node']) {
      const spec = plan.plan.containers.find((x) => x.role === role);
      const item = inventory.containers.find((x) => x.spec.name === spec.name);
      check(item && HEX.test(item.id));
      operate(role === 'node' ? 'RUN_MATRIX' : 'START_CONTAINER',
        { kind: 'container', name: spec.name, id: item.id }, ['start', ...(role === 'node' ? ['--attach'] : []), item.id]);
      // Rootless initialization, secret tmpfs injection and socket/UID admission
      // must be positively observed by trusted bridge, never inferred from exit0.
      if (role === 'db') await authority.trustedLocalAdmission.attestUnixServerBeforeRunner();
    }
    const result = await authority.trustedLocalAdmission.readAndVerifySealedEvidence();
    check(result.complete === true && HEX.test(result.sha256), 'LOCAL_MATRIX_EVIDENCE_INCOMPLETE');
    ledger.seal(); return Object.freeze({ status: 'COMPLETE', evidenceSha256: result.sha256, cleanup: 'NOT_AUTHORIZED' });
  } catch {
    if (pending !== null) { try { ledger.unknown(pending, 'LOST_ACK'); } catch { /* persisted INTENT is sufficient to prohibit replay */ } }
    else { try { ledger.stop('KNOWN_FAILURE'); } catch { /* no recovery or replay */ } }
    fail(pending === null ? 'LOCAL_EXECUTION_STOPPED' : 'LOCAL_UNKNOWN_OUTCOME');
  } finally { ledger.close(); }
}
