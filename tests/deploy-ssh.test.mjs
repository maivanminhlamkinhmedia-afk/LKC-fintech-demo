import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('../scripts/cms-deploy/upload-and-activate.sh', import.meta.url));
const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
const marker = 'MOCK_SECRET_DO_NOT_LOG';

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

function fixture(t, { scpPlan = '0', remoteStatus = '0', scanStatus = '0' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cms deploy ssh '));
  assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'mock bin');
  mkdirSync(bin);
  const key = join(dir, 'identity with spaces');
  const archive = join(dir, 'archive with spaces.tar.gz');
  const knownHosts = join(dir, 'known hosts');
  writeFileSync(key, marker);
  writeFileSync(archive, 'synthetic archive');

  writeCommand(bin, 'ssh-keyscan', `
    printf 'scan\\n' >> "$EVENT_LOG"
    if [[ "$SCAN_STATUS" != 0 ]]; then exit "$SCAN_STATUS"; fi
    printf 'example.invalid ssh-ed25519 SYNTHETIC_PUBLIC_KEY\\n'
  `);
  writeCommand(bin, 'sleep', `
    printf 'sleep:%s\\n' "$1" >> "$EVENT_LOG"
  `);
  writeCommand(bin, 'scp', `
    printf 'scp\\n' >> "$EVENT_LOG"
    printf '%s\\0' "$@" >> "$SCP_ARGS_FILE"
    count=$(grep -c '^scp$' "$EVENT_LOG")
    IFS=, read -r -a codes <<< "$SCP_PLAN"
    exit "${'${codes[count-1]}'}"
  `);
  writeCommand(bin, 'ssh', `
    printf 'remote\\n' >> "$EVENT_LOG"
    printf '%s\\0' "$@" >> "$SSH_ARGS_FILE"
    exit "$REMOTE_STATUS"
  `);

  const eventLog = join(dir, 'events.txt');
  const scpArgsFile = join(dir, 'scp-args.bin');
  const sshArgsFile = join(dir, 'ssh-args.bin');
  const env = {
    PATH: process.env.PATH ?? '',
    HOME: toBashPath(dir),
    SSH_HOST: 'example.invalid',
    SSH_USER: 'synthetic-user',
    SSH_KEY_FILE: toBashPath(key),
    SSH_KNOWN_HOSTS: toBashPath(knownHosts),
    DEPLOY_ARCHIVE: toBashPath(archive),
    EVENT_LOG: toBashPath(eventLog),
    SCP_ARGS_FILE: toBashPath(scpArgsFile),
    SSH_ARGS_FILE: toBashPath(sshArgsFile),
    SCP_PLAN: scpPlan,
    REMOTE_STATUS: remoteStatus,
    SCAN_STATUS: scanStatus,
    ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' } : {}),
  };
  const result = spawnSync(bash, ['-c', 'export PATH="$1:$PATH"; exec bash "$2"', 'mock-run', toBashPath(bin), toBashPath(helper)], { cwd: dir, env, encoding: 'utf8', timeout: 20_000 });
  assert.equal(result.error, undefined, result.error?.message);
  if (!existsSync(eventLog)) throw new Error(`mock commands were not reached: status=${result.status} stderr=${result.stderr}`);
  const events = readFileSync(eventLog, 'utf8').trim().split(/\r?\n/);
  const args = (file) => {
    try { return readFileSync(file).toString('utf8').split('\0').filter(Boolean); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  return { result, events, scpArgs: args(scpArgsFile), sshArgs: args(sshArgsFile), key: toBashPath(key), archive: toBashPath(archive), knownHosts: toBashPath(knownHosts) };
}

test('temporary upload failure retries once, then invokes the remote command once', (t) => {
  const run = fixture(t, { scpPlan: '255,0' });
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.deepEqual(run.events, ['scan', 'sleep:3', 'scp', 'sleep:5', 'scp', 'remote']);
  assert.equal(run.scpArgs.filter((arg) => arg === run.archive).length, 2);
  assert.equal(run.sshArgs.filter((arg) => arg.includes('rm -rf')).length, 1);
  assert.ok(run.sshArgs.at(-1).includes('restart.txt'));
  for (const args of [run.scpArgs, run.sshArgs]) {
    assert.ok(args.includes(run.key));
    assert.ok(args.includes(`UserKnownHostsFile=${run.knownHosts}`));
    assert.ok(args.includes('StrictHostKeyChecking=yes'));
    assert.ok(args.includes('ConnectTimeout=15'));
    assert.ok(args.includes('ConnectionAttempts=1'));
    assert.ok(!args.includes('StrictHostKeyChecking=no'));
  }
  assert.doesNotMatch(run.result.stdout + run.result.stderr, new RegExp(marker));
});

test('three failed uploads return the last real exit code without invoking remote deploy', (t) => {
  const run = fixture(t, { scpPlan: '255,7,23' });
  assert.equal(run.result.status, 23);
  assert.deepEqual(run.events, ['scan', 'sleep:3', 'scp', 'sleep:5', 'scp', 'sleep:15', 'scp']);
  assert.deepEqual(run.sshArgs, []);
  assert.match(run.result.stderr, /upload exhausted/i);
});

test('failed keyscan does not sleep, upload, or invoke remote deploy', (t) => {
  const run = fixture(t, { scanStatus: '9' });
  assert.equal(run.result.status, 9);
  assert.deepEqual(run.events, ['scan']);
  assert.deepEqual(run.scpArgs, []);
  assert.deepEqual(run.sshArgs, []);
});

for (const remoteStatus of ['42', '255']) {
  test(`remote exit ${remoteStatus} is reported as uncertain and never retried`, (t) => {
    const run = fixture(t, { remoteStatus });
    assert.equal(run.result.status, Number(remoteStatus));
    assert.deepEqual(run.events, ['scan', 'sleep:3', 'scp', 'remote']);
    assert.match(run.result.stderr, /APP state is unknown; no automatic retry/);
    assert.doesNotMatch(run.result.stderr, /upload exhausted/);
  });
}
