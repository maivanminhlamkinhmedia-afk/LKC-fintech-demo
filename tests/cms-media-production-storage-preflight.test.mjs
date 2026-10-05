import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { validateLayout } from '../scripts/cms-media/production-storage-preflight.mjs'

const base = {
  home: '/home/edpmjmha',
  app: '/home/edpmjmha/lkcfintech.com.vn/deploy',
  webroot: '/home/edpmjmha/public_html',
  root: '/home/edpmjmha/private/cms-media',
}
const script = fileURLToPath(new URL('../scripts/cms-media/production-storage-preflight.mjs', import.meta.url))
const linuxOnly = process.platform === 'linux' ? false : 'requires real Linux UID/GID and filesystem semantics'
const windowsOnly = process.platform === 'linux' ? 'non-Linux guard' : false

function invoke(command, layout, { uid, gid, identity, id, sha256, confirm } = {}) {
  const options = { uid: uid ?? process.getuid?.() ?? 0, gid: gid ?? process.getgid?.() ?? 0 }
  const flags = Object.entries({ ...layout, ...options, identity, id, sha256, confirm })
    .filter(([, value]) => value !== undefined)
    .flatMap(([key, value]) => [`--${key}`, String(value)])
  // No inherited CMS_MEDIA_ROOT, DATABASE_URL, credentials, or staging config.
  return spawnSync(process.execPath, [script, command, ...flags], {
    encoding: 'utf8', timeout: 10000, env: { NODE_ENV: 'test' },
  })
}

function passed(result) {
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  return JSON.parse(result.stdout)
}

function rejected(result, code) {
  assert.equal(result.status, 1, result.stdout)
  assert.match(result.stderr, new RegExp(`CMS_MEDIA_PREFLIGHT_FAIL ${code}`, 'u'))
  assert.equal(result.stdout, '')
}

async function fixture(t) {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'cms009-preflight-test-'))
  assert.equal(path.dirname(sandbox), tmpdir())
  t.after(async () => {
    const info = await lstat(sandbox)
    assert.ok(info.isDirectory() && !info.isSymbolicLink())
    await rm(sandbox, { recursive: true, force: true })
  })
  const home = path.join(sandbox, 'account')
  const app = path.join(home, 'site', 'deploy')
  const webroot = path.join(home, 'public_html')
  const root = path.join(home, 'private', 'cms-media')
  await mkdir(home, { mode: 0o700 })
  await mkdir(path.dirname(app), { mode: 0o700 })
  await mkdir(app, { mode: 0o700 })
  await mkdir(webroot, { mode: 0o700 })
  return { sandbox, layout: { home, app, webroot, root } }
}

async function tree(directory) {
  const result = {}
  async function visit(p) {
    for (const name of (await readdir(p)).sort()) {
      const child = path.join(p, name)
      const relative = path.relative(directory, child)
      const info = await lstat(child)
      const common = { mode: info.mode & 0o777, uid: info.uid, gid: info.gid }
      if (info.isSymbolicLink()) result[relative] = { ...common, kind: 'symlink', target: await readlink(child) }
      else if (info.isDirectory()) { result[relative] = { ...common, kind: 'dir' }; await visit(child) }
      else if (info.isFile()) result[relative] = { ...common, kind: 'file',
        sha256: createHash('sha256').update(await readFile(child)).digest('hex') }
      else result[relative] = { ...common, kind: 'other' }
    }
  }
  await visit(directory)
  return result
}

function provision(layout) {
  return passed(invoke('provision', layout, { confirm: `provision:${layout.root}` })).rootIdentity
}

test('production root is a direct grandchild of home, outside deploy and webroot', () => {
  assert.equal(validateLayout(base).parent, '/home/edpmjmha/private')
  for (const root of [base.home, base.app, `${base.app}/media`, base.webroot,
    `${base.webroot}/media`, '/home/edpmjmha/private', '/tmp/media',
    '/home/edpmjmha/private/../public_html/media', '/home/edpmjmha/private/media/deep']) {
    assert.throws(() => validateLayout({ ...base, root }), /UNSAFE_ROOT_LAYOUT|INVALID_ABSOLUTE_PATH/u, root)
  }
})

test('path and CLI guards reject a missing expected identity', () => {
  const flags = Object.entries(base).flatMap(([key, value]) => [`--${key}`, value])
  const common = [...flags, '--uid', '2789', '--gid', '2794']
  rejected(spawnSync(process.execPath, [script, 'inspect', ...common],
    { encoding: 'utf8', timeout: 5000, env: { NODE_ENV: 'test' } }), 'EXPECTED_ROOT_IDENTITY_REQUIRED')
})

test('non-Linux rejects provisioning before any filesystem access', { skip: windowsOnly }, () => {
  rejected(invoke('provision', base, { uid: 2789, gid: 2794, confirm: `provision:${base.root}` }),
    'SERVICE_IDENTITY_MISMATCH')
})

test('Linux provisions the exact marker/layout and probes without residue', { skip: linuxOnly }, async t => {
  const { sandbox, layout } = await fixture(t)
  const identity = provision(layout)
  assert.match(identity, /^[a-f0-9]{32}$/u)
  const marker = JSON.parse(await readFile(path.join(layout.root, '.cms-media-root.json'), 'utf8'))
  assert.deepEqual(marker, { version: 1, identity, purpose: 'cms-media' })
  assert.deepEqual((await readdir(layout.root)).sort(), ['.cms-media-root.json', 'locks', 'objects', 'operations', 'tmp'])
  for (const name of ['', 'objects', 'tmp', 'operations', 'locks']) {
    assert.equal((await lstat(path.join(layout.root, name))).mode & 0o777, 0o700)
  }
  assert.equal((await lstat(path.join(layout.root, '.cms-media-root.json'))).mode & 0o777, 0o600)
  assert.equal(passed(invoke('inspect', layout, { identity })).rootIdentity, identity)
  const before = await tree(sandbox)
  assert.equal(passed(invoke('probe', layout, { identity, confirm: `probe:${identity}` })).result, 'PROBE_PASS')
  assert.deepEqual(await tree(sandbox), before)
  assert.deepEqual(await readdir(path.join(layout.root, 'tmp')), [])
  assert.deepEqual(await readdir(path.join(layout.root, 'objects')), [])
})

test('Linux rejects wrong UID and GID before writing', { skip: linuxOnly }, async t => {
  const { sandbox, layout } = await fixture(t)
  const before = await tree(sandbox)
  const uid = process.getuid(), gid = process.getgid()
  rejected(invoke('provision', layout, { uid: uid + 1, gid, confirm: `provision:${layout.root}` }),
    'SERVICE_IDENTITY_MISMATCH')
  assert.deepEqual(await tree(sandbox), before)
  rejected(invoke('provision', layout, { uid, gid: gid + 1, confirm: `provision:${layout.root}` }),
    'SERVICE_IDENTITY_MISMATCH')
  assert.deepEqual(await tree(sandbox), before)
})

test('Linux refuses existing or foreign-populated roots without changing their bytes', { skip: linuxOnly }, async t => {
  const { sandbox, layout } = await fixture(t)
  await mkdir(path.dirname(layout.root), { mode: 0o700 })
  await mkdir(layout.root, { mode: 0o700 })
  await writeFile(path.join(layout.root, 'foreign.bin'), Buffer.from('foreign data'))
  const before = await tree(sandbox)
  rejected(invoke('provision', layout, { confirm: `provision:${layout.root}` }), 'EEXIST')
  assert.deepEqual(await tree(sandbox), before)
})

test('Linux refuses unknown entries, symlinks, and wrong root identity without cleanup', { skip: linuxOnly }, async t => {
  const { sandbox, layout } = await fixture(t)
  const identity = provision(layout)
  const foreign = path.join(layout.root, 'foreign.bin')
  await writeFile(foreign, Buffer.from('must survive'))
  let before = await tree(sandbox)
  rejected(invoke('probe', layout, { identity, confirm: `probe:${identity}` }), 'UNKNOWN_ROOT_ENTRY')
  assert.deepEqual(await tree(sandbox), before)
  await rm(foreign)
  const other = identity === 'f'.repeat(32) ? 'e'.repeat(32) : 'f'.repeat(32)
  before = await tree(sandbox)
  rejected(invoke('probe', layout, { identity: other, confirm: `probe:${other}` }), 'ROOT_IDENTITY_MISMATCH')
  assert.deepEqual(await tree(sandbox), before)
  await mkdir(path.join(layout.root, 'tmp-target'), { mode: 0o700 })
  await writeFile(path.join(layout.root, 'tmp-target', 'keep.bin'), Buffer.from('symlink target data'))
  await rm(path.join(layout.root, 'tmp'), { recursive: true })
  await symlink('tmp-target', path.join(layout.root, 'tmp'))
  before = await tree(sandbox)
  rejected(invoke('probe', layout, { identity, confirm: `probe:${identity}` }),
    'STORAGE_OWNERSHIP_OR_MODE_MISMATCH')
  assert.deepEqual(await tree(sandbox), before)
})

test('Linux rejects marker identity drift and preserves the altered marker bytes', { skip: linuxOnly }, async t => {
  const { sandbox, layout } = await fixture(t)
  const identity = provision(layout)
  const markerPath = path.join(layout.root, '.cms-media-root.json')
  const marker = JSON.parse(await readFile(markerPath, 'utf8'))
  marker.identity = identity === 'f'.repeat(32) ? 'e'.repeat(32) : 'f'.repeat(32)
  await writeFile(markerPath, JSON.stringify(marker))
  const before = await tree(sandbox)
  rejected(invoke('inspect', layout, { identity }), 'ROOT_IDENTITY_MISMATCH')
  rejected(invoke('probe', layout, { identity, confirm: `probe:${identity}` }), 'ROOT_IDENTITY_MISMATCH')
  assert.deepEqual(await tree(sandbox), before)
})

test('Linux retains, verifies, and removes only the exact persistence sentinel', { skip: linuxOnly }, async t => {
  const { sandbox, layout } = await fixture(t)
  const identity = provision(layout)
  const baseline = await tree(sandbox)
  const retained = passed(invoke('retain', layout, { identity, confirm: `retain:${identity}` }))
  assert.equal(retained.result, 'SENTINEL_RETAINED')
  assert.match(retained.id, /^[a-f0-9]{32}$/u)
  assert.match(retained.sha256, /^[a-f0-9]{64}$/u)
  const sentinel = path.join(layout.root, `.cms-media-persistence-${retained.id}.json`)
  assert.equal(createHash('sha256').update(await readFile(sentinel)).digest('hex'), retained.sha256)
  assert.equal(passed(invoke('verify', layout, { identity, id: retained.id, sha256: retained.sha256 })).result,
    'SENTINEL_VERIFIED')
  const before = await tree(sandbox)
  rejected(invoke('remove', layout, { identity, id: retained.id, sha256: '0'.repeat(64),
    confirm: `remove:${identity}` }), 'SENTINEL_HASH_MISMATCH')
  assert.deepEqual(await tree(sandbox), before)
  assert.equal(passed(invoke('remove', layout, { identity, id: retained.id, sha256: retained.sha256,
    confirm: `remove:${identity}` })).result, 'SENTINEL_REMOVED')
  assert.deepEqual(await tree(sandbox), baseline)
})

test('Linux preserves a tampered sentinel when original hash or identity no longer proves ownership',
  { skip: linuxOnly }, async t => {
    const { sandbox, layout } = await fixture(t)
    const identity = provision(layout)
    const retained = passed(invoke('retain', layout, { identity, confirm: `retain:${identity}` }))
    const sentinel = path.join(layout.root, `.cms-media-persistence-${retained.id}.json`)
    const value = JSON.parse(await readFile(sentinel, 'utf8'))
    value.nonce = value.nonce === '0'.repeat(32) ? '1'.repeat(32) : '0'.repeat(32)
    await writeFile(sentinel, JSON.stringify(value))
    const before = await tree(sandbox)
    rejected(invoke('verify', layout, { identity, id: retained.id, sha256: retained.sha256 }),
      'SENTINEL_HASH_MISMATCH')
    rejected(invoke('remove', layout, { identity, id: retained.id, sha256: retained.sha256,
      confirm: `remove:${identity}` }), 'SENTINEL_HASH_MISMATCH')
    const other = identity === 'f'.repeat(32) ? 'e'.repeat(32) : 'f'.repeat(32)
    rejected(invoke('remove', layout, { identity: other, id: retained.id, sha256: retained.sha256,
      confirm: `remove:${other}` }), 'ROOT_IDENTITY_MISMATCH')
    assert.deepEqual(await tree(sandbox), before)
})
