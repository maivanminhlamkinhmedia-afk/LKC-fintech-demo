import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const helper = fileURLToPath(new URL('../scripts/cms-deploy/upload-and-activate.sh', import.meta.url));
const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
const roots = ['.next', 'public', 'node_modules', 'prisma', 'src', 'server.js', 'package.json', 'prisma.config.ts'];

function toBashPath(file) {
  if (process.platform !== 'win32') return file;
  assert.match(file, /^[A-Za-z]:[\\]/);
  const unix = file.replaceAll('\\', '/');
  return `/${unix[0].toLowerCase()}${unix.slice(2)}`;
}

function writeCommand(bin, name, body) {
  const file = join(bin, name);
  writeFileSync(file, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  chmodSync(file, 0o755);
}

// Build ordinary ustar fixtures directly, including unsafe member types, without
// creating actual links or writing an unsafe archive outside the fixture.
function archiveBytes(entries) {
  const blocks = [];
  for (const [name, value, type = '0', link = '', mode = type === '5' ? 0o755 : 0o644] of entries) {
    const data = Buffer.from(type === '0' ? value : '');
    const header = Buffer.alloc(512);
    const text = (offset, length, value) => header.write(value, offset, length, 'utf8');
    const octal = (offset, length, value) => text(offset, length, `${value.toString(8).padStart(length - 1, '0')}\0`);
    text(0, 100, name);
    octal(100, 8, mode);
    octal(108, 8, 0);
    octal(116, 8, 0);
    octal(124, 12, data.length);
    octal(136, 12, 0);
    header.fill(32, 148, 156);
    text(156, 1, type);
    text(157, 100, link);
    text(257, 6, 'ustar\0');
    text(263, 2, '00');
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    text(148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
    blocks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function bundle(label, includeSrc = true) {
  return [
    ['.next/', '', '5'], ['.next/static/', '', '5'],
    ['.next/BUILD_ID', `${label}-build`], ['.next/static/main.js', `${label}-static`],
    ['public/', '', '5'], ['public/asset.txt', `${label}-public`],
    ['node_modules/', '', '5'], ['node_modules/module.js', `${label}-module`],
    ['node_modules/tool.sh', `${label}-executable`, '0', '', label === 'old' ? 0o750 : 0o755],
    ['prisma/', '', '5'], ['prisma/schema.prisma', `${label}-schema`],
    ['server.js', `${label}-server`], ['package.json', JSON.stringify({ name: label })],
    ['prisma.config.ts', `${label}-config`],
    ...(includeSrc ? [['src/', '', '5'], ['src/entry.ts', `${label}-source`]] : []),
  ];
}

function snapshot(directory, names) {
  const result = {};
  function walk(relative) {
    const file = join(directory, relative);
    if (!existsSync(file)) return;
    const stat = statSync(file);
    // Windows synthesizes POSIX mode bits; compare actual permissions on Linux.
    const permissions = process.platform === 'win32' ? {} : { mode: stat.mode & 0o7777 };
    if (stat.isDirectory()) {
      result[`${relative}/`] = { kind: 'directory', ...permissions };
      for (const child of readdirSync(file).sort()) walk(`${relative}/${child}`);
    } else result[relative] = { hash: createHash('sha256').update(readFileSync(file)).digest('hex'), ...permissions };
  }
  for (const name of names) walk(name);
  return result;
}

// These values are synthetic offline fixtures, never production policy. The
// production functions remain blocked until a separately approved integration
// can supply effective account quota and operational/retention decisions.
const fixturePolicy = {
  capacity_policy_id: 'offline-fixture-policy',
  reserve_bytes: 1_048_576,
  reserve_inodes: 64,
  scratch_bytes: 1_048_576,
  scratch_inodes: 64,
  retention_max_bytes: 1_000_000_000_000,
  retention_max_inodes: 1_000_000_000,
  retention_max_releases: 100,
  quota_max_age_seconds: 60,
};

function shellValue(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function replaceFixtureFunction(payload, name, body) {
  const definition = new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}`, 'gm');
  assert.equal([...payload.matchAll(definition)].length, 1, `replace exactly one ${name} fixture provider`);
  return payload.replace(definition, `${name}() {\n${body}\n}`);
}

let verifiedUtf8Locale;
function utf8Locale() {
  if (verifiedUtf8Locale) return verifiedUtf8Locale;
  const env = { PATH: process.env.PATH ?? '', ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' } : {}) };
  const available = spawnSync(bash, ['-c', 'locale -a'], { env: { ...env, LC_ALL: 'C' }, encoding: 'utf8', timeout: 10_000 });
  assert.equal(available.error, undefined, available.error?.message);
  assert.equal(available.status, 0, available.stderr);
  verifiedUtf8Locale = available.stdout.split(/\r?\n/).find((name) => /^C\.utf-?8$/i.test(name))
    ?? available.stdout.split(/\r?\n/).find((name) => /^en_US\.utf-?8$/i.test(name));
  assert.ok(verifiedUtf8Locale, 'UTF-8 regression requires an installed C.UTF-8 or en_US.UTF-8 locale');
  const probe = spawnSync(bash, ['-c', 'locale charmap'], { env: { ...env, LC_ALL: verifiedUtf8Locale, LANG: verifiedUtf8Locale }, encoding: 'utf8', timeout: 10_000 });
  assert.equal(probe.error, undefined, probe.error?.message);
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stderr, '', 'requested UTF-8 locale must load without a fallback warning');
  assert.match(probe.stdout.trim(), /^UTF-8$/i);
  return verifiedUtf8Locale;
}

function fixture(t, { entries = bundle('new'), health = '200', fault = '', corrupt = false, baselineSrc = false, locked = false, closedStderr = false, existingRestart = false, payloadTransform = (payload) => payload, capacity = {}, oldReleases = [], baselineExtraBytes = 0, locale } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'cms safe activation '));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const app = join(directory, 'deploy');
  const archive = join(directory, 'lkc-deploy.tar.gz');
  const state = join(directory, 'state');
  const bin = join(directory, 'mock bin');
  const eventLog = join(directory, 'events.txt');
  for (const path of [app, bin, state]) mkdirSync(path);
  for (const [name, contents, type, , mode = type === '5' ? 0o755 : 0o644] of bundle('old', baselineSrc)) {
    const file = join(app, name);
    if (type === '5') mkdirSync(file, { recursive: true });
    else writeFileSync(file, contents);
    if (process.platform !== 'win32') chmodSync(file, mode);
  }
  mkdirSync(join(app, 'tmp'));
  if (existingRestart) writeFileSync(join(app, 'tmp', 'restart.txt'), 'existing restart marker must survive incomplete input');
  writeFileSync(join(app, '.env'), 'DO_NOT_CHANGE_OR_LOG');
  writeFileSync(join(app, 'tmp', 'operator.txt'), 'keep operator state');
  writeFileSync(join(app, 'unrelated.txt'), 'keep unrelated file');
  if (baselineExtraBytes) writeFileSync(join(app, 'public', 'large-existing.bin'), Buffer.alloc(baselineExtraBytes, 65));
  mkdirSync(join(directory, 'media'));
  writeFileSync(join(directory, 'media', 'upload.png'), 'keep persistent media');
  writeFileSync(archive, corrupt ? Buffer.from('not a gzip archive') : archiveBytes(entries));
  writeFileSync(eventLog, '');
  for (const [index, status] of oldReleases.entries()) {
    const release = join(state, `release.retained-${index}`);
    mkdirSync(release);
    writeFileSync(join(release, 'status'), status);
    writeFileSync(join(release, 'backup.tar.gz'), `retained ${status} recovery archive`);
    writeFileSync(join(release, 'backup.sha256'), `retained ${status} recovery digest`);
    mkdirSync(join(release, 'restore'));
    writeFileSync(join(release, 'restore', 'operator-evidence'), `retain every byte for ${status}`);
  }
  const retainedNames = readdirSync(state);
  const retainedBaseline = snapshot(state, retainedNames);
  if (locked) {
    mkdirSync(join(state, 'activation.lock'));
    writeFileSync(join(state, 'activation.lock', 'owner'), 'another activation');
  }

  writeCommand(bin, 'df', `
    stage=initial
    for release in "$STATE_FIXTURE"/release.*; do
      if [[ -f "$release/status" && "$(cat "$release/status")" == BACKUP_READY ]]; then stage=ready; fi
      if [[ -f "$release/status" && "$(cat "$release/status")" == ROLLING_BACK ]]; then stage=rollback; fi
    done
    metric=bytes
    [[ " $* " != *' --output=iavail '* ]] || metric=inodes
    printf '%s:%s\\n' "$stage" "$metric" >> "$CAPACITY_PROBES"
    if [[ "$metric" == bytes ]]; then
      value=${shellValue(capacity.fsBytes ?? 1_000_000_000_000)}
      [[ "$stage" != ready ]] || value=${shellValue(capacity.lateFsBytes ?? capacity.fsBytes ?? 1_000_000_000_000)}
      [[ "$stage" != rollback ]] || value=${shellValue(capacity.rollbackFsBytes ?? capacity.fsBytes ?? 1_000_000_000_000)}
    else
      value=${shellValue(capacity.fsInodes ?? 1_000_000_000)}
      [[ "$stage" != ready ]] || value=${shellValue(capacity.lateFsInodes ?? capacity.fsInodes ?? 1_000_000_000)}
      [[ "$stage" != rollback ]] || value=${shellValue(capacity.rollbackFsInodes ?? capacity.fsInodes ?? 1_000_000_000)}
    fi
    [[ "$value" != unavailable ]] || exit 92
    printf 'Available\\n%s\\n' "$value"
  `);
  writeCommand(bin, 'stat', `
    if [[ " $* " == *' -f '* && " $* " == *' %S '* ]]; then
      printf '%s\\n' ${shellValue(capacity.blockBytes ?? 4096)}
      exit 0
    fi
    if [[ "${capacity.differentFilesystem ? 'yes' : 'no'}" == yes && " $* " == *' %d '* ]]; then
      for arg in "$@"; do
        if [[ "$arg" == "$STATE_FIXTURE" ]]; then
          device=$(/usr/bin/stat -c %d -- "$APP_FIXTURE")
          printf '%s\\n' "$((device + 1))"
          exit 0
        fi
      done
    fi
    exec /usr/bin/stat "$@"
  `);
  // Physical allocation cannot be made portable on Windows. This one metric
  // override models retained preallocation while all names/sizes/devices and
  // preservation checks still operate on the real temporary fixture tree.
  if (capacity.preallocatedRetainedBlocks !== undefined) {
    writeCommand(bin, 'find', `
      if [[ " $* " != *' %D %y %s %b %p'* ]]; then exec /usr/bin/find "$@"; fi
      /usr/bin/find "$@" | while IFS= read -r -d '' record; do
        read -r device kind size blocks path <<< "$record"
        if [[ "$path" == "$STATE_FIXTURE/release.retained-0/backup.tar.gz" ]]; then blocks=${shellValue(capacity.preallocatedRetainedBlocks)}; fi
        printf '%s %s %s %s %s\\0' "$device" "$kind" "$size" "$blocks" "$path"
      done
    `);
  }

  writeCommand(bin, 'curl', `
    printf 'curl' >> "$EVENT_LOG"
    printf ' <%s>' "$@" >> "$EVENT_LOG"
    printf '\\n' >> "$EVENT_LOG"
    # A missing mock must never turn this test into a network request.
    [[ " $* " == *"https://example.invalid/login"* ]] || exit 96
    [[ -f "$APP_FIXTURE/tmp/restart.txt" ]] || exit 95
    count=0
    if [[ -f "$CURL_COUNT" ]]; then read -r count < "$CURL_COUNT"; fi
    count=$((count + 1))
    printf '%s\\n' "$count" > "$CURL_COUNT"
    IFS=, read -r -a replies <<< "$HEALTH_PLAN"
    reply="${'${replies[count-1]:-503}'}"
    printf 'health:%s:%s\\n' "$reply" "$(cat "$APP_FIXTURE/server.js")" >> "$EVENT_LOG"
    if [[ "$reply" == exit* ]]; then exit "${'${reply#exit}'}"; fi
    printf '%s' "$reply"
  `);
  writeCommand(bin, 'sleep', `
    printf 'sleep:%s\\n' "$1" >> "$EVENT_LOG"
    if [[ "$FAULT" == restart && "$1" == 1 && ! -e "$FAULT_SEEN" ]]; then
      printf 'restart:fault\\n' >> "$EVENT_LOG"
      printf '1' > "$FAULT_SEEN"
      exit 45
    fi
  `);
  for (const name of ['ssh', 'scp', 'ssh-keyscan']) {
    writeCommand(bin, name, `printf 'FORBIDDEN:${name}\\n' >> "$EVENT_LOG"; exit 99`);
  }
  writeCommand(bin, 'tar', `
    is_backup=0
    create=0
    extract=0
    for arg in "$@"; do
      [[ "$arg" == */backup.tar.gz ]] && is_backup=1
      [[ "$arg" == -*c* ]] && create=1
      [[ "$arg" == -*x* ]] && extract=1
    done
    if (( is_backup && create )); then
      printf 'backup:create\\n' >> "$EVENT_LOG"
      if [[ "$FAULT" == backup ]]; then exit 41; fi
    fi
    if (( is_backup && extract )); then
      printf 'backup:extract\\n' >> "$EVENT_LOG"
      if [[ "$FAULT" == restore ]]; then exit 44; fi
    fi
    exec /usr/bin/tar "$@"
  `);
  writeCommand(bin, 'sha256sum', `
    if [[ "$FAULT" == checksum && " $* " == *" -c "* ]]; then
      printf 'backup:checksum:fault\\n' >> "$EVENT_LOG"
      exit 43
    fi
    exec /usr/bin/sha256sum "$@"
  `);
  writeCommand(bin, 'rmdir', `
    if [[ "$FAULT" == cleanup && " $* " == *"$STATE_FIXTURE/activation.lock"* ]]; then
      printf 'cleanup:fault\\n' >> "$EVENT_LOG"
      exit 47
    fi
    exec /usr/bin/rmdir "$@"
  `);
  for (const name of ['mv', 'rm']) {
    writeCommand(bin, name, `
      touches_app=0
      for arg in "$@"; do
        if [[ "$arg" == "$APP_FIXTURE/"* && "$arg" != "$APP_FIXTURE/tmp/"* ]]; then touches_app=1; fi
      done
      if (( touches_app )); then
        printf '${name}:app' >> "$EVENT_LOG"
        printf ' <%s>' "$@" >> "$EVENT_LOG"
        printf '\\n' >> "$EVENT_LOG"
        # A recoverable copy and checksum must precede the first live mutation.
        # Rollback may subsequently move the verified restore files into APP.
        if [[ ! -f "$BACKUP_READY_SEEN" ]]; then
          ready=0
          for release in "$STATE_FIXTURE"/release.*; do
            if [[ -s "$release/backup.tar.gz" && -s "$release/backup.sha256" && -s "$release/restore/server.js" && -s "$release/restore/.next/BUILD_ID" && "$(cat "$release/status")" == ACTIVATING ]]; then ready=1; fi
          done
          if (( ! ready )); then printf 'MUTATION_WITHOUT_BACKUP\\n' >> "$EVENT_LOG"; exit 94; fi
          printf 'verified' > "$BACKUP_READY_SEEN"
        fi
      fi
      if [[ '${name}' == mv && "$FAULT" == activate && ! -e "$FAULT_SEEN" ]]; then
        for arg in "$@"; do
          if [[ "$arg" == */candidate/public ]]; then
            printf 'activation:fault\\n' >> "$EVENT_LOG"
            printf '1' > "$FAULT_SEEN"
            exit 42
          fi
        done
      fi
      if [[ '${name}' == mv && "$FAULT" == rollback ]]; then
        for arg in "$@"; do
          if [[ "$arg" == */restore/public ]]; then
            printf 'rollback:fault\\n' >> "$EVENT_LOG"
            exit 46
          fi
        done
      fi
      exec /usr/bin/${name} "$@"
    `);
  }

  const source = readFileSync(helper, 'utf8').replaceAll('\r\n', '\n');
  const match = source.match(/remote_command=\$\(cat <<'REMOTE_ACTIVATION'\n([\s\S]*?)\nREMOTE_ACTIVATION\n\)/);
  assert.ok(match, 'test executes the literal production remote payload');
  let payload = match[1];
  const replacements = [
    ['APP="/home/edpmjmha/lkcfintech.com.vn/deploy"', `APP="${toBashPath(app)}"`],
    ['ARCHIVE="/home/edpmjmha/lkc-deploy.tar.gz"', `ARCHIVE="${toBashPath(archive)}"`],
    ['STATE_ROOT="/home/edpmjmha/.lkc-deploy-state"', `STATE_ROOT="${toBashPath(state)}"`],
    ['HEALTH_URL="https://lkcfintech.com.vn/login"', 'HEALTH_URL="https://example.invalid/login"'],
  ];
  for (const [original, replacement] of replacements) {
    assert.equal(payload.split(original).length, 2, `replace exactly one production constant: ${original}`);
    payload = payload.replace(original, replacement);
  }
  if (capacity.policy !== null) {
    const policy = { ...fixturePolicy, ...capacity.policy };
    payload = replaceFixtureFunction(payload, 'load_capacity_policy', Object.entries(policy).map(([key, value]) => `  ${key}=${shellValue(value)}`).join('\n'));
  }
  if (capacity.topology !== null) {
    payload = replaceFixtureFunction(payload, 'verify_capacity_topology', `
  if [[ ${shellValue(capacity.rollbackTopology ?? 'verified')} != verified && -n "$run_dir" && "$(cat "$run_dir/status")" == ROLLING_BACK ]]; then return 1; fi
  return 0
`);
  }
  if (capacity.quota !== null) {
    const quota = capacity.quota ?? {};
    payload = replaceFixtureFunction(payload, 'read_effective_quota', `
  quota_policy_id=${shellValue(quota.quota_policy_id ?? 'offline-fixture-policy')}
  quota_uid=${quota.quota_uid === undefined ? '"$(id -u)"' : shellValue(quota.quota_uid)}
  quota_device=${quota.quota_device === undefined ? '"$(stat -c %d -- "$APP")"' : shellValue(quota.quota_device)}
  quota_sampled_at=${quota.quota_sampled_at === undefined ? '"$(date +%s)"' : shellValue(quota.quota_sampled_at)}
  quota_available_bytes=${shellValue(quota.quota_available_bytes ?? 1_000_000_000_000)}
  quota_available_inodes=${shellValue(quota.quota_available_inodes ?? 1_000_000_000)}
  if [[ -n "$run_dir" && -f "$run_dir/status" && "$(cat "$run_dir/status")" == BACKUP_READY ]]; then
    quota_available_bytes=${shellValue(capacity.lateQuotaBytes ?? quota.quota_available_bytes ?? 1_000_000_000_000)}
    quota_available_inodes=${shellValue(capacity.lateQuotaInodes ?? quota.quota_available_inodes ?? 1_000_000_000)}
  fi
  if [[ -n "$run_dir" && -f "$run_dir/status" && "$(cat "$run_dir/status")" == ROLLING_BACK ]]; then
    if [[ ${shellValue(capacity.rollbackQuotaUnavailable ?? false)} == true ]]; then return 1; fi
    quota_available_bytes=${shellValue(capacity.rollbackQuotaBytes ?? quota.quota_available_bytes ?? 1_000_000_000_000)}
    quota_available_inodes=${shellValue(capacity.rollbackQuotaInodes ?? quota.quota_available_inodes ?? 1_000_000_000)}
  fi
`);
  }
  assert.doesNotMatch(payload, /\/home\/edpmjmha|https:\/\/lkcfintech\.com\.vn/);
  const baseline = snapshot(app, roots);
  const completeBaseline = snapshot(app, readdirSync(app));
  const preserved = snapshot(directory, ['deploy/.env', 'deploy/tmp/operator.txt', 'deploy/unrelated.txt', 'media']);
  const env = {
    PATH: process.env.PATH ?? '',
    HOME: toBashPath(directory),
    APP_FIXTURE: toBashPath(app),
    STATE_FIXTURE: toBashPath(state),
    EVENT_LOG: toBashPath(eventLog),
    CURL_COUNT: toBashPath(join(directory, 'curl-count')),
    FAULT_SEEN: toBashPath(join(directory, 'fault-seen')),
    BACKUP_READY_SEEN: toBashPath(join(directory, 'backup-ready-seen')),
    CAPACITY_PROBES: toBashPath(join(directory, 'capacity-probes')),
    HEALTH_PLAN: health,
    FAULT: fault,
    ...(locale ? { LC_ALL: locale, LANG: locale } : {}),
    ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' } : {}),
  };
  // Production sends this literal payload to bash -s on stdin. A script-file
  // invocation would miss Bash executing complete commands before stdin EOF.
  // Closing stderr reproduces a lost SSH stream without production test hooks.
  const launch = `export PATH="$1:$PATH"; ${closedStderr ? 'exec 2>&-; ' : ''}exec bash -s`;
  const result = spawnSync(bash, ['-c', launch, 'offline-activation-test', toBashPath(bin)], { input: payloadTransform(payload), cwd: directory, env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.error, undefined, result.error?.message);
  const events = readFileSync(eventLog, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  const releases = readdirSync(state).filter((name) => name.startsWith('release.') && !retainedNames.includes(name)).map((name) => join(state, name));
  const receipt = releases.length ? readFileSync(join(releases[0], 'status'), 'utf8').trim() : undefined;
  assert.equal(releases.length <= 1, true);
  assert.deepEqual(snapshot(state, retainedNames), retainedBaseline, 'old release evidence must never be pruned or changed');
  assert.deepEqual(snapshot(directory, ['deploy/.env', 'deploy/tmp/operator.txt', 'deploy/unrelated.txt', 'media']), preserved);
  assert.ok(!events.some((event) => /FORBIDDEN:|MUTATION_WITHOUT_BACKUP/.test(event)), events.join('\n'));
  assert.doesNotMatch(result.stdout + result.stderr, /DO_NOT_CHANGE_OR_LOG/);
  if (result.status !== 0) assert.doesNotMatch(result.stdout, /LKC_RELEASE_HEALTHY_V1/);
  const probes = existsSync(join(directory, 'capacity-probes')) ? readFileSync(join(directory, 'capacity-probes'), 'utf8').trim().split(/\r?\n/) : [];
  return { result, events, app, archive, state, releases, receipt, baseline, completeBaseline, probes };
}

function truncateAt(marker, offset = marker.length) {
  return (payload) => {
    const position = payload.indexOf(marker);
    assert.notEqual(position, -1, `EOF test marker exists: ${marker}`);
    assert.equal(payload.indexOf(marker, position + 1), -1, `EOF test marker is unique: ${marker}`);
    return payload.slice(0, position + offset);
  };
}

function assertPayloadNeverStarted(run) {
  assert.deepEqual(snapshot(run.app, readdirSync(run.app)), run.completeBaseline);
  assert.deepEqual(run.events, [], 'incomplete input cannot back up, remove, move, restart, or health-check APP');
  assert.deepEqual(readdirSync(run.state), [], 'incomplete input cannot acquire a lock or write release receipts');
  assert.equal(run.receipt, undefined);
  assert.ok(existsSync(run.archive));
  assert.doesNotMatch(run.result.stdout + run.result.stderr, /LKC_RELEASE_HEALTHY_V1/);
}

for (const [label, payloadTransform, mayExitZero = false] of [
  ['empty stream', () => '', true],
  ['before the enclosing group', truncateAt('{\nset -euo pipefail\n', 0), true],
  ['after the enclosing group opens', truncateAt('{\nset -euo pipefail\n', 2)],
  ['after initial shell setup', truncateAt('unset TAR_OPTIONS\n')],
  ['before the finish trap definition', truncateAt('finish() {\n', 0)],
  ['inside the finish trap definition', truncateAt('finish() {\n  local status=$?\n')],
  ['inside the healthy ACK string', truncateAt('LKC_RELEASE_HEALTHY_V1', 11)],
  ['after the healthy ACK string', truncateAt('LKC_RELEASE_HEALTHY_V1')],
  ['after EXIT trap installation', truncateAt('trap finish EXIT\n')],
  ['after all signal trap installations', truncateAt("trap 'exit 143' TERM\n")],
  ['after lock acquisition', truncateAt('lock_owned=1\n')],
  ['after release setup', truncateAt('record_state PREPARING\n')],
  ['after candidate copy', truncateAt('cp -- "$ARCHIVE" "$run_dir/candidate.tar.gz"\n')],
  ['after backup creation', truncateAt('tar --format=gnu --blocking-factor=20 -czf "$run_dir/backup.tar.gz" -C "$APP" -- "${previous[@]}"\n')],
  ['after backup verification', truncateAt('record_state BACKUP_READY\n')],
  ['after ACTIVATING receipt', truncateAt('record_state ACTIVATING\n')],
  ['after activation_started', truncateAt('activation_started=1\n')],
  ['after live artifact deletion command', truncateAt('activation_started=1\nclear_artifacts\n')],
  ['inside candidate move command', truncateAt('    mv -- "$run_dir/candidate/$name" "$APP/$name"\n', 39)],
  ['after candidate move before the loop closes', truncateAt('    mv -- "$run_dir/candidate/$name" "$APP/$name"\n')],
  ['after candidate move loop', truncateAt('done\nrestart_app\n', 'done\n'.length)],
  ['after restart', truncateAt('done\nrestart_app\n')],
  ['after health check', truncateAt("health_check || fail 'Activation health check failed'\n")],
  ['after HEALTHY receipt', truncateAt('record_state HEALTHY\n')],
  ['immediately before the final enclosing brace', (payload) => {
    assert.match(payload, /\n}\s*$/);
    return payload.slice(0, payload.lastIndexOf('\n}') + 1);
  }],
]) {
  test(`bash -s EOF ${label} cannot mutate APP or acknowledge HEALTHY`, (t) => {
    const run = fixture(t, { existingRestart: true, payloadTransform });
    if (!mayExitZero) assert.notEqual(run.result.status, 0, run.result.stderr);
    assertPayloadNeverStarted(run);
  });
}

test('bash -s rejects a late syntax error before any earlier activation command executes', (t) => {
  const run = fixture(t, { existingRestart: true, payloadTransform: (payload) => {
    assert.match(payload, /\n}\s*$/);
    return payload.replace(/\n}(\s*)$/, '\n)\n}$1');
  } });
  assert.notEqual(run.result.status, 0, run.result.stderr);
  assertPayloadNeverStarted(run);
});

function assertUnchanged(run, expectedReceipt = 'PREPARING') {
  assert.notEqual(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt ?? null, expectedReceipt, `unexpected setup failure: ${run.result.stderr}`);
  assert.deepEqual(snapshot(run.app, readdirSync(run.app)), run.completeBaseline);
  assert.ok(existsSync(run.archive), 'failed activation preserves the uploaded archive');
  assert.equal(run.events.some((event) => /^(mv|rm):app|^curl|^sleep:1$|^health:|^restart:/.test(event)), false, run.events.join('\n'));
}

function assertRestorePoint(run) {
  assert.equal(run.releases.length, 1);
  const release = run.releases[0];
  const backup = readFileSync(join(release, 'backup.tar.gz'));
  const digest = createHash('sha256').update(backup).digest('hex');
  assert.match(readFileSync(join(release, 'backup.sha256'), 'utf8'), new RegExp(`^${digest}\\s+`));
  const inspection = join(release, 'test-backup-inspection');
  const result = spawnSync(bash, ['-c', 'mkdir -p -- "$1" && tar --same-permissions -xzf "$2" -C "$1"', 'inspect-backup', toBashPath(inspection), toBashPath(join(release, 'backup.tar.gz'))], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(snapshot(inspection, roots), run.baseline);
}

test('complete bash -s input with the production trailing newline reaches HEALTHY and acknowledges once', (t) => {
  const run = fixture(t, { payloadTransform: (payload) => `${payload}\n` });
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt, 'HEALTHY');
  assert.equal(readFileSync(join(run.app, 'server.js'), 'utf8'), 'new-server');
  assert.equal(run.result.stdout.split(/\r?\n/).filter((line) => line === 'LKC_RELEASE_HEALTHY_V1').length, 1);
  assert.equal(run.result.stdout.trimEnd().split(/\r?\n/).at(-1), 'LKC_RELEASE_HEALTHY_V1');
  assert.equal(existsSync(join(run.state, 'activation.lock')), false);
  assertRestorePoint(run);
});

test('complete bash -s input without a trailing newline keeps a restore point and passes only after HTTP 200', (t) => {
  const run = fixture(t, { health: '503,200' });
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.result.stdout.trim().split(/\r?\n/).at(-1), 'LKC_RELEASE_HEALTHY_V1');
  assert.equal(run.receipt, 'HEALTHY');
  assert.equal(readFileSync(join(run.app, 'server.js'), 'utf8'), 'new-server');
  assert.equal(readFileSync(join(run.app, 'src', 'entry.ts'), 'utf8'), 'new-source');
  if (process.platform !== 'win32') {
    assert.equal(statSync(join(run.app, 'node_modules', 'tool.sh')).mode & 0o777, 0o755);
    assert.equal(statSync(join(run.app, 'public')).mode & 0o777, 0o755);
    assert.equal(statSync(run.releases[0]).mode & 0o777, 0o700);
  }
  assertRestorePoint(run);
  assert.equal(existsSync(join(run.state, 'activation.lock')), false);
  assert.deepEqual(run.events.filter((event) => event.startsWith('health:')), ['health:503:new-server', 'health:200:new-server']);
  const requests = run.events.filter((event) => event.startsWith('curl '));
  assert.equal(requests.length, 2);
  for (const request of requests) {
    for (const flags of ['<--disable>', '<--silent>', '<--show-error>', '<--connect-timeout> <5>', '<--max-time> <15>', '<--output> </dev/null>', '<--write-out> <%{http_code}>', '<--header> <Cache-Control: no-cache>', '<--proto> <=https>']) assert.ok(request.includes(flags), request);
    assert.match(request, /https:\/\/example\.invalid\/login\?[^>]+/);
    assert.doesNotMatch(request, /<--location>|<-L>|<--insecure>|<-k>/);
  }
});

test('UTF-8 archive filename survives activation exactly and receives the final HEALTHY ACK', (t) => {
  const name = 'public/ảnh-đẹp.png';
  const contents = 'offline image fixture: ảnh đẹp';
  const run = fixture(t, { locale: utf8Locale(), entries: [...bundle('new'), [name, contents]] });
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt, 'HEALTHY');
  assert.deepEqual(readdirSync(join(run.app, 'public')).sort(), ['asset.txt', 'ảnh-đẹp.png'].sort());
  assert.deepEqual(readFileSync(join(run.app, name)), Buffer.from(contents, 'utf8'));
  assert.equal(run.result.stdout.trimEnd().split(/\r?\n/).at(-1), 'LKC_RELEASE_HEALTHY_V1');
  assert.equal(run.result.stdout.split(/\r?\n/).filter((line) => line === 'LKC_RELEASE_HEALTHY_V1').length, 1);
  assert.equal(existsSync(join(run.state, 'activation.lock')), false);
  assertRestorePoint(run);
});

for (const [label, unsafe, message] of [
  ['parent traversal', ['public/ảnh/../outside.txt', 'escape'], /Unsafe archive member path/],
  ['backslash', ['public/ảnh\\đẹp.png', 'unsafe separator'], /Unsafe archive member path/],
  ['control character', ['public/ảnh\nđẹp.png', 'unsafe newline'], /Unsafe archive member path/],
  ['symlink', ['public/liên-kết', '', '2', '../../outside.txt'], /Archive links and special files are not allowed/],
  ['hardlink', ['public/liên-cứng', '', '1', 'server.js'], /Archive links and special files are not allowed/],
  ['FIFO special file', ['public/đường-ống', '', '6'], /Archive links and special files are not allowed/],
]) {
  test(`UTF-8 mixed with ${label} remains rejected before mutation`, (t) => {
    const run = fixture(t, { locale: utf8Locale(), entries: [...bundle('new'), unsafe] });
    assertUnchanged(run);
    assert.match(run.result.stderr, message);
    assert.ok(!run.events.includes('backup:create'));
  });
}

test('corrupt archive is rejected before backup or live mutation', (t) => {
  const run = fixture(t, { corrupt: true });
  assertUnchanged(run);
  assert.match(run.result.stderr, /not in gzip format|does not look like a tar archive|unrecognized archive format/i);
  assert.ok(!run.events.includes('backup:create'));
});

test('lock cleanup failure cannot emit a healthy ACK despite passing activation health', (t) => {
  const run = fixture(t, { fault: 'cleanup' });
  assert.equal(run.result.status, 70, run.result.stderr);
  assert.equal(run.receipt, 'HEALTHY');
  assert.equal(readFileSync(join(run.app, 'server.js'), 'utf8'), 'new-server');
  assert.deepEqual(run.events.filter((event) => event.startsWith('health:')), ['health:200:new-server']);
  assert.ok(run.events.includes('cleanup:fault'));
  assert.equal(existsSync(join(run.state, 'activation.lock')), true);
  assert.match(run.result.stderr, /Activation lock cleanup failed/);
  assert.doesNotMatch(run.result.stdout, /LKC_RELEASE_HEALTHY_V1/);
  assertRestorePoint(run);
});

for (const missing of ['server.js', 'package.json', '.next/BUILD_ID', '.next/static/', 'public/', 'node_modules/', 'prisma/']) {
  test(`candidate missing ${missing} is rejected before live mutation`, (t) => {
    const run = fixture(t, { entries: bundle('new').filter(([name]) => missing.endsWith('/') ? !name.startsWith(missing) : name !== missing) });
    assertUnchanged(run);
    assert.match(run.result.stderr, /Candidate bundle is incomplete/);
  });
}

for (const [label, unsafe, message] of [
  ['unmanaged root', ['.env', 'candidate must not change environment'], /Archive contains an unmanaged path/],
  ['parent traversal', ['../outside.txt', 'escape'], /Unsafe archive member path/],
  ['absolute path', ['/outside.txt', 'escape'], /Unsafe archive member path/],
  ['symlink', ['public/link', '', '2', '../../outside.txt'], /Archive links and special files are not allowed/],
  ['hardlink', ['public/link', '', '1', 'server.js'], /Archive links and special files are not allowed/],
]) {
  test(`${label} archive member is rejected without touching the live application`, (t) => {
    const run = fixture(t, { entries: [...bundle('new'), unsafe] });
    assertUnchanged(run);
    assert.match(run.result.stderr, message);
  });
}

test('backup creation failure leaves the current release and upload intact', (t) => {
  const run = fixture(t, { fault: 'backup' });
  assertUnchanged(run);
  assert.equal(run.result.status, 41);
  assert.ok(run.events.includes('backup:create'));
  assert.equal(existsSync(join(run.state, 'activation.lock')), false);
});

for (const [fault, status, event] of [
  ['checksum', 43, 'backup:checksum:fault'],
  ['restore', 44, 'backup:extract'],
]) {
  test(`backup ${fault} failure aborts before any live artifact mutation`, (t) => {
    const run = fixture(t, { fault });
    assertUnchanged(run);
    assert.equal(run.result.status, status, run.result.stderr);
    assert.ok(run.events.includes(event), run.events.join('\n'));
    assert.equal(existsSync(join(run.state, 'activation.lock')), false);
  });
}

test('partial activation failure restores every old artifact and removes candidate-only src', (t) => {
  const run = fixture(t, { fault: 'activate', health: '200' });
  assert.notEqual(run.result.status, 0);
  assert.equal(run.receipt, 'ROLLED_BACK');
  assert.ok(run.events.includes('activation:fault'), run.events.join('\n'));
  assert.deepEqual(snapshot(run.app, roots), run.baseline);
  assert.equal(existsSync(join(run.app, 'src')), false);
  assert.ok(existsSync(run.archive));
  assertRestorePoint(run);
  assert.deepEqual(run.events.filter((event) => event.startsWith('health:')), ['health:200:old-server']);
  assert.equal(existsSync(join(run.state, 'activation.lock')), false);
});

test('six unhealthy candidate responses trigger restoration, restart, and rollback health check', (t) => {
  const run = fixture(t, { health: '302,204,503,exit7,2000,500,200', baselineSrc: true });
  assert.notEqual(run.result.status, 0);
  assert.equal(run.receipt, 'ROLLED_BACK');
  assert.deepEqual(snapshot(run.app, roots), run.baseline);
  assert.ok(existsSync(run.archive));
  assertRestorePoint(run);
  const health = run.events.filter((event) => event.startsWith('health:'));
  assert.equal(health.length, 7);
  assert.ok(health.slice(0, 6).every((event) => event.endsWith(':new-server')));
  assert.equal(health.at(-1), 'health:200:old-server');
  assert.equal(existsSync(join(run.state, 'activation.lock')), false);
});

test('candidate restart failure restores the old artifacts and restarts successfully', (t) => {
  const run = fixture(t, { fault: 'restart', health: '200' });
  assert.notEqual(run.result.status, 0);
  assert.equal(run.receipt, 'ROLLED_BACK');
  assert.ok(run.events.includes('restart:fault'));
  assert.equal(run.events.filter((event) => event === 'sleep:1').length, 2);
  assert.deepEqual(snapshot(run.app, roots), run.baseline);
  assert.deepEqual(run.events.filter((event) => event.startsWith('health:')), ['health:200:old-server']);
  assertRestorePoint(run);
  assert.ok(existsSync(run.archive));
  assert.equal(existsSync(join(run.state, 'activation.lock')), false);
});

test('closed stderr cannot prevent rollback or replace the original activation exit code', (t) => {
  const run = fixture(t, { fault: 'activate', health: '200', closedStderr: true });
  assert.equal(run.result.status, 42);
  assert.equal(run.receipt, 'ROLLED_BACK');
  assert.ok(run.events.includes('activation:fault'));
  assert.deepEqual(snapshot(run.app, roots), run.baseline);
  assert.deepEqual(run.events.filter((event) => event.startsWith('health:')), ['health:200:old-server']);
  assertRestorePoint(run);
  assert.ok(existsSync(run.archive));
  assert.equal(existsSync(join(run.state, 'activation.lock')), false);
});

test('rollback move failure retains lock and intact backup and returns 70', (t) => {
  const run = fixture(t, { fault: 'rollback', health: Array(6).fill('503').join(',') });
  assert.equal(run.result.status, 70, run.result.stderr);
  assert.equal(run.receipt, 'ROLLBACK_FAILED');
  assert.ok(run.events.includes('rollback:fault'));
  assert.equal(existsSync(join(run.state, 'activation.lock')), true);
  assert.ok(existsSync(run.archive));
  assertRestorePoint(run);
  assert.equal(run.events.filter((event) => event.startsWith('health:')).length, 6);
  assert.notDeepEqual(snapshot(run.app, roots), run.baseline, 'failed restoration must not be reported as complete');
});

test('failed rollback health check returns 70 and retains lock and restore evidence', (t) => {
  const run = fixture(t, { health: Array(12).fill('503').join(',') });
  assert.equal(run.result.status, 70, run.result.stderr);
  assert.equal(run.receipt, 'ROLLBACK_FAILED');
  assert.deepEqual(snapshot(run.app, roots), run.baseline);
  assert.ok(existsSync(run.archive));
  assertRestorePoint(run);
  assert.equal(existsSync(join(run.state, 'activation.lock')), true);
  const health = run.events.filter((event) => event.startsWith('health:'));
  assert.equal(health.length, 12);
  assert.ok(health.slice(0, 6).every((event) => event.endsWith(':new-server')));
  assert.ok(health.slice(6).every((event) => event.endsWith(':old-server')));
});

test('existing activation lock is never stolen or removed', (t) => {
  const run = fixture(t, { locked: true });
  assertUnchanged(run, null);
  assert.match(run.result.stderr, /Activation is locked/);
  assert.equal(readFileSync(join(run.state, 'activation.lock', 'owner'), 'utf8'), 'another activation');
  assert.equal(run.releases.length, 0);
});

test('unmodified production capacity policy fails closed before lock or release creation', (t) => {
  const run = fixture(t, { capacity: { policy: null } });
  assertUnchanged(run, null);
  assert.match(run.result.stderr, /CAPACITY_POLICY_BLOCKED/);
  assert.deepEqual(readdirSync(run.state), []);
  assert.deepEqual(run.events, []);
});

test('unmodified production quota provider fails closed instead of trusting filesystem df', (t) => {
  const run = fixture(t, { capacity: { quota: null } });
  assertUnchanged(run);
  assert.match(run.result.stderr, /CAPACITY_POLICY_BLOCKED: Effective account quota is not verified/);
  assert.ok(!run.events.includes('backup:create'));
});

test('matching device IDs cannot replace verified production mount topology', (t) => {
  const run = fixture(t, { capacity: { topology: null } });
  assertUnchanged(run);
  assert.match(run.result.stderr, /CAPACITY_POLICY_BLOCKED/);
  assert.ok(!run.events.includes('backup:create'));
});

test('quota provider omitting its policy binding fails closed with a capacity diagnostic', (t) => {
  const run = fixture(t, { payloadTransform: (payload) => {
    const assignment = "  quota_policy_id='offline-fixture-policy'\n";
    assert.equal(payload.split(assignment).length, 2);
    return payload.replace(assignment, '');
  } });
  assertUnchanged(run);
  assert.match(run.result.stderr, /CAPACITY_POLICY_BLOCKED/);
  assert.doesNotMatch(run.result.stderr, /unbound variable/);
  assert.ok(!run.events.includes('backup:create'));
});

for (const field of ['reserve_bytes', 'reserve_inodes', 'scratch_bytes', 'scratch_inodes', 'retention_max_bytes', 'retention_max_inodes', 'retention_max_releases', 'quota_max_age_seconds']) {
  for (const value of ['', 0, 'unapproved']) {
    test(`unapproved capacity policy ${field}=${JSON.stringify(value)} fails before preparing APP`, (t) => {
      const run = fixture(t, { capacity: { policy: { [field]: value } } });
      assertUnchanged(run, null);
      assert.match(run.result.stderr, new RegExp(`CAPACITY_POLICY_BLOCKED:.*${field}`));
      assert.deepEqual(run.events, []);
      assert.deepEqual(readdirSync(run.state), []);
    });
  }
}

for (const [label, capacity, message] of [
  ['filesystem bytes full', { fsBytes: 0 }, /Filesystem free bytes are insufficient/],
  ['filesystem inodes full', { fsInodes: 0 }, /Filesystem free inodes are insufficient/],
  ['filesystem byte measurement unavailable', { fsBytes: 'unavailable' }, /Filesystem free-space probe failed/],
  ['filesystem inode measurement unavailable', { fsInodes: 'unavailable' }, /Filesystem free-space probe failed/],
  ['filesystem bytes nonnumeric', { fsBytes: 'unknown' }, /Unknown filesystem free-space or inode value/],
  ['filesystem inodes unsupported', { fsInodes: '-' }, /Unknown filesystem free-space or inode value/],
  ['effective quota bytes exhausted despite free filesystem', { quota: { quota_available_bytes: 0 } }, /Effective account quota bytes are insufficient/],
  ['effective quota inodes exhausted despite free filesystem', { quota: { quota_available_inodes: 0 } }, /Effective account quota inodes are insufficient/],
  ['effective quota bytes unknown', { quota: { quota_available_bytes: 'unknown' } }, /Unknown effective account quota field: quota_available_bytes/],
  ['effective quota inodes unknown', { quota: { quota_available_inodes: '' } }, /Unknown effective account quota field: quota_available_inodes/],
  ['effective quota bytes negative', { quota: { quota_available_bytes: -1 } }, /Unknown effective account quota field: quota_available_bytes/],
  ['effective quota bytes overflow', { quota: { quota_available_bytes: '9223372036854775808' } }, /Unknown effective account quota field: quota_available_bytes/],
  ['effective quota policy does not bind to approval', { quota: { quota_policy_id: 'another-policy' } }, /Quota evidence does not match policy, account or filesystem/],
  ['effective quota belongs to another UID', { quota: { quota_uid: 987654321 } }, /Quota evidence does not match policy, account or filesystem/],
  ['effective quota belongs to another filesystem', { quota: { quota_device: 987654321 } }, /Quota evidence does not match policy, account or filesystem/],
  ['effective quota sample is stale', { quota: { quota_sampled_at: 1 } }, /Quota evidence is stale or future-dated/],
  ['effective quota sample comes from the future', { quota: { quota_sampled_at: 4_102_444_800 } }, /Quota evidence is stale or future-dated/],
  ['effective quota sample has no timestamp', { quota: { quota_sampled_at: '' } }, /Unknown effective account quota field: quota_sampled_at/],
]) {
  test(`${label} fails before backup or live mutation`, (t) => {
    const run = fixture(t, { capacity });
    assertUnchanged(run);
    assert.ok(!run.events.includes('backup:create'));
    assert.match(run.result.stderr, message);
  });
}

test('APP and STATE_ROOT on different filesystems cannot start replacement', (t) => {
  const run = fixture(t, { capacity: { differentFilesystem: true } });
  assertUnchanged(run);
  assert.match(run.result.stderr, /[Ff]ilesystem|[Dd]evice/);
  assert.deepEqual(run.events, []);
  assert.equal(existsSync(join(run.state, 'activation.lock')), false);
});

test('large existing APP requires backup and restore capacity even for a small candidate', (t) => {
  const run = fixture(t, {
    baselineExtraBytes: 4 * 1_048_576,
    capacity: { fsBytes: 8 * 1_048_576, quota: { quota_available_bytes: 8 * 1_048_576 } },
  });
  assertUnchanged(run);
  assert.ok(!run.events.includes('backup:create'));
  assert.match(run.result.stderr, /[Cc]apacity|[Ss]pace|[Bb]ytes/);
});

test('large filesystem allocation units are included before admitting small artifact files', (t) => {
  const run = fixture(t, { capacity: { blockBytes: 1_048_576, fsBytes: 32 * 1_048_576 } });
  assertUnchanged(run);
  assert.ok(!run.events.includes('backup:create'));
  assert.match(run.result.stderr, /[Ff]ilesystem free bytes/);
});

test('retained preallocation counts against byte retention even when logical file sizes are tiny', (t) => {
  const run = fixture(t, {
    oldReleases: ['UNKNOWN'],
    capacity: { preallocatedRetainedBlocks: 32768, policy: { retention_max_bytes: 8 * 1_048_576 } },
  });
  assertUnchanged(run);
  assert.match(run.result.stderr, /[Rr]etained release byte budget/);
  assert.ok(!run.events.includes('backup:create'));
});

for (const [label, capacity] of [
  ['filesystem bytes consumed after backup', { lateFsBytes: 0 }],
  ['filesystem inodes consumed after backup', { lateFsInodes: 0 }],
  ['quota bytes consumed after backup', { lateQuotaBytes: 0 }],
  ['quota inodes consumed after backup', { lateQuotaInodes: 0 }],
]) {
  test(`${label} is rechecked immediately before mutation`, (t) => {
    const run = fixture(t, { capacity });
    assertUnchanged(run, 'BACKUP_READY');
    assert.ok(run.events.includes('backup:create'));
    assert.ok(run.probes.some((probe) => probe.startsWith('ready:')), run.probes.join('\n'));
    assertRestorePoint(run);
  });
}

for (const [label, policy] of [
  ['count', { retention_max_releases: 3 }],
  ['bytes', { retention_max_bytes: 1 }],
  ['inodes', { retention_max_inodes: 1 }],
]) {
  test(`retention ${label} budget cannot prune old HEALTHY or recovery evidence to permit activation`, (t) => {
    const run = fixture(t, { oldReleases: ['HEALTHY', 'UNKNOWN', 'ROLLBACK_FAILED'], capacity: { policy } });
    assertUnchanged(run);
    assert.match(run.result.stderr, /Retained release .* budget is exhausted/);
    assert.ok(!run.events.includes('backup:create'));
    assert.equal(readdirSync(run.state).filter((name) => name.startsWith('release.retained-')).length, 3);
  });
}

test('successful activation keeps old HEALTHY, UNKNOWN and ROLLBACK_FAILED releases unchanged', (t) => {
  const run = fixture(t, { oldReleases: ['HEALTHY', 'UNKNOWN', 'ROLLBACK_FAILED'] });
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt, 'HEALTHY');
  assert.equal(readdirSync(run.state).filter((name) => name.startsWith('release.retained-')).length, 3);
  assertRestorePoint(run);
});

test('stale activation lock and retained recovery evidence survive capacity exhaustion untouched', (t) => {
  const run = fixture(t, { locked: true, oldReleases: ['UNKNOWN', 'ROLLBACK_FAILED'], capacity: { fsBytes: 0 } });
  assertUnchanged(run, null);
  assert.match(run.result.stderr, /Activation is locked/);
  assert.equal(readFileSync(join(run.state, 'activation.lock', 'owner'), 'utf8'), 'another activation');
  assert.deepEqual(run.events, []);
  assert.equal(run.releases.length, 0);
});

for (const [label, capacity] of [
  ['filesystem bytes exhausted', { rollbackFsBytes: 0 }],
  ['filesystem inodes exhausted', { rollbackFsInodes: 0 }],
  ['account quota bytes exhausted', { rollbackQuotaBytes: 0 }],
  ['account quota inodes exhausted', { rollbackQuotaInodes: 0 }],
  ['quota reader fails after activation', { rollbackQuotaUnavailable: true }],
  ['mount topology becomes unverifiable', { rollbackTopology: 'unverified' }],
]) {
  test(`rollback ${label} preserves current APP, lock and untouched restore evidence`, (t) => {
    const run = fixture(t, { capacity, health: Array(6).fill('503').join(',') });
    assert.equal(run.result.status, 70, run.result.stderr);
    assert.equal(run.receipt, 'ROLLBACK_FAILED');
    assert.equal(existsSync(join(run.state, 'activation.lock')), true);
    assert.equal(run.events.filter((event) => event.startsWith('rm:app')).length, roots.length, 'rollback must not delete any additional APP path');
    assert.equal(run.events.filter((event) => event.startsWith('mv:app')).length, roots.length, 'rollback must not move any additional APP path');
    for (const [name, contents, type] of bundle('new')) {
      if (type === '5') assert.equal(statSync(join(run.app, name)).isDirectory(), true);
      else assert.equal(readFileSync(join(run.app, name), 'utf8'), contents);
    }
    assert.deepEqual(snapshot(join(run.releases[0], 'restore'), roots), run.baseline);
    assert.match(run.result.stderr, /CAPACITY_POLICY_BLOCKED/);
    assert.equal(run.events.filter((event) => event.startsWith('health:')).length, 6);
    assertRestorePoint(run);
  });
}
