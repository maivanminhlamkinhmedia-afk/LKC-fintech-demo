#!/usr/bin/env node
// Operator-only production storage preparation. Never imported by the application.
import { createHash, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile, readdir, realpath, rename, link, unlink } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const folders = ['objects', 'tmp', 'operations', 'locks']
const markerName = '.cms-media-root.json'
const idPattern = /^[a-f0-9]{32}$/u
const hashPattern = /^[a-f0-9]{64}$/u
const commands = new Set(['inspect', 'provision', 'probe', 'retain', 'verify', 'remove'])

export function validateLayout({ home, app, webroot, root }) {
  for (const value of [home, app, webroot, root]) {
    if (typeof value !== 'string' || !value.startsWith('/') || path.posix.resolve(value) !== value || value.includes('\0')) {
      throw new Error('INVALID_ABSOLUTE_PATH')
    }
  }
  const within = (parent, child) => child === parent || child.startsWith(`${parent}/`)
  if (!within(home, app) || !within(home, webroot) || !within(home, root)
    || within(app, root) || within(webroot, root) || within(root, app) || within(root, webroot)
    || path.posix.dirname(path.posix.dirname(root)) !== home) throw new Error('UNSAFE_ROOT_LAYOUT')
  return { home, app, webroot, root, parent: path.posix.dirname(root) }
}

function args(argv) {
  const [command, ...rest] = argv
  if (!commands.has(command) || rest.length % 2 !== 0) throw new Error('INVALID_COMMAND')
  const flags = {}
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]
    if (!/^--(home|app|webroot|root|uid|gid|identity|id|sha256|confirm)$/u.test(key)
      || flags[key] !== undefined || !rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error('INVALID_ARGUMENT')
    flags[key] = rest[i + 1]
  }
  const layout = validateLayout({ home: flags['--home'], app: flags['--app'], webroot: flags['--webroot'], root: flags['--root'] })
  const uid = Number(flags['--uid']), gid = Number(flags['--gid'])
  if (!Number.isSafeInteger(uid) || uid < 0 || !Number.isSafeInteger(gid) || gid < 0) throw new Error('INVALID_OWNER')
  return { command, flags, layout, uid, gid }
}

function assertService(uid, gid) {
  if (process.platform !== 'linux' || typeof process.getuid !== 'function'
    || process.getuid() !== uid || process.geteuid() !== uid
    || process.getgid() !== gid || process.getegid() !== gid) throw new Error('SERVICE_IDENTITY_MISMATCH')
}

function assertOwned(info, uid, gid, kind, maxMode) {
  const excessMode = (info.mode & 0o777) & ~maxMode
  if ((kind === 'dir' && !info.isDirectory()) || (kind === 'file' && (!info.isFile() || info.nlink !== 1))
    || info.isSymbolicLink() || info.uid !== uid || info.gid !== gid || excessMode !== 0) {
    throw new Error('STORAGE_OWNERSHIP_OR_MODE_MISMATCH')
  }
}

function parseJson(bytes, code) {
  try { return JSON.parse(bytes.toString()) }
  catch { throw new Error(code) }
}

async function directory(p, uid, gid, maxMode = 0o700) {
  const info = await lstat(p)
  assertOwned(info, uid, gid, 'dir', maxMode)
  if (await realpath(p) !== p) throw new Error('SYMLINKED_DIRECTORY')
  return info
}

async function syncDirectory(p) {
  const handle = await open(p, constants.O_RDONLY)
  try { await handle.sync() } finally { await handle.close() }
}

async function boundary(p) {
  const info = await lstat(p)
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(p) !== p) {
    throw new Error('DEPLOY_OR_WEBROOT_BOUNDARY_DRIFT')
  }
}

async function boundaries(layout) {
  await boundary(layout.app)
  await boundary(layout.webroot)
}

async function existingRoot({ layout, uid, gid }, identity) {
  await boundaries(layout)
  await directory(layout.home, uid, gid, 0o711)
  await directory(layout.parent, uid, gid)
  await directory(layout.root, uid, gid)
  const markerPath = path.posix.join(layout.root, markerName)
  const info = await lstat(markerPath)
  assertOwned(info, uid, gid, 'file', 0o600)
  if (info.size < 1 || info.size > 512) throw new Error('INVALID_MARKER')
  const marker = parseJson(await readFile(markerPath), 'INVALID_MARKER')
  if (marker.version !== 1 || marker.purpose !== 'cms-media' || !idPattern.test(marker.identity)) throw new Error('INVALID_MARKER')
  if (identity !== undefined && marker.identity !== identity) throw new Error('ROOT_IDENTITY_MISMATCH')
  for (const name of folders) await directory(path.posix.join(layout.root, name), uid, gid)
  const expected = new Set([...folders, markerName])
  for (const entry of await readdir(layout.root)) {
    if (expected.has(entry)) continue
    const match = /^\.cms-media-persistence-([a-f0-9]{32})\.json$/u.exec(entry)
    if (!match) throw new Error('UNKNOWN_ROOT_ENTRY')
    const sentinel = await lstat(path.posix.join(layout.root, entry))
    assertOwned(sentinel, uid, gid, 'file', 0o600)
    if (sentinel.size < 1 || sentinel.size > 512) throw new Error('UNKNOWN_ROOT_ENTRY')
    const content = parseJson(await readFile(path.posix.join(layout.root, entry)), 'UNKNOWN_ROOT_ENTRY')
    if (content.version !== 1 || content.purpose !== 'cms-media-persistence'
      || content.rootIdentity !== marker.identity || content.id !== match[1]
      || !idPattern.test(content.nonce ?? '')) {
      throw new Error('UNKNOWN_ROOT_ENTRY')
    }
  }
  return marker.identity
}

function requireIdentity(flags) {
  const identity = flags['--identity']
  if (!idPattern.test(identity ?? '')) throw new Error('EXPECTED_ROOT_IDENTITY_REQUIRED')
  return identity
}

function confirm(flags, expected) {
  if (flags['--confirm'] !== expected) throw new Error('EXPLICIT_CONFIRMATION_REQUIRED')
}

async function provision(context) {
  const { layout, uid, gid, flags } = context
  assertService(uid, gid)
  confirm(flags, `provision:${layout.root}`)
  await boundaries(layout)
  await directory(layout.home, uid, gid, 0o711)
  try {
    await lstat(layout.parent)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await mkdir(layout.parent, { mode: 0o700 })
    await syncDirectory(layout.home)
  }
  await directory(layout.parent, uid, gid)
  // mkdir is exclusive: never adopt an existing or partially populated root.
  await mkdir(layout.root, { mode: 0o700 })
  for (const name of folders) await mkdir(path.posix.join(layout.root, name), { mode: 0o700 })
  const identity = randomBytes(16).toString('hex')
  const handle = await open(path.posix.join(layout.root, markerName), 'wx', 0o600)
  try { await handle.writeFile(JSON.stringify({ version: 1, identity, purpose: 'cms-media' })); await handle.sync() }
  finally { await handle.close() }
  await syncDirectory(layout.root)
  await syncDirectory(layout.parent)
  await existingRoot(context, identity)
  return { result: 'PROVISIONED', rootIdentity: identity }
}

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex') }

async function exactFile(p, expected) {
  const info = await lstat(p)
  if (!info.isFile() || info.isSymbolicLink() || info.dev !== expected.dev || info.ino !== expected.ino
    || (expected.nlink !== undefined && info.nlink !== expected.nlink)
    || (expected.size !== undefined && info.size !== expected.size)) throw new Error('SENTINEL_IDENTITY_DRIFT')
  const bytes = await readFile(p)
  if (digest(bytes) !== expected.sha256) throw new Error('SENTINEL_CONTENT_DRIFT')
  return info
}

async function requireAbsent(p) {
  try { await lstat(p); throw new Error('SENTINEL_TARGET_EXISTS') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
}

async function probe(context, identity) {
  const { layout, flags } = context
  confirm(flags, `probe:${identity}`)
  const id = randomBytes(16).toString('hex')
  const bytes = Buffer.from(`cms-media-preflight:${identity}:${id}`, 'utf8')
  const sha256 = digest(bytes)
  const temp = path.posix.join(layout.root, 'tmp', `.cms-preflight-${id}.tmp`)
  const ready = path.posix.join(layout.root, 'tmp', `.cms-preflight-${id}.ready`)
  const object = path.posix.join(layout.root, 'objects', `.cms-preflight-${id}.bin`)
  const owned = { sha256, size: bytes.length }
  let current = temp, linked = false
  const handle = await open(temp, 'wx', 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
    const info = await handle.stat()
    Object.assign(owned, { dev: info.dev, ino: info.ino, nlink: 1 })
  } finally { await handle.close() }
  try {
    await exactFile(temp, owned)
    await requireAbsent(ready)
    await rename(temp, ready)
    current = ready
    await syncDirectory(path.posix.join(layout.root, 'tmp'))
    await exactFile(ready, owned)
    await link(ready, object)
    linked = true
    await syncDirectory(path.posix.join(layout.root, 'objects'))
    await exactFile(object, { ...owned, nlink: 2 })
    await exactFile(ready, { ...owned, nlink: 2 })
    await unlink(object)
    linked = false
    await syncDirectory(path.posix.join(layout.root, 'objects'))
    await exactFile(ready, owned)
    await unlink(ready)
    current = null
    await syncDirectory(path.posix.join(layout.root, 'tmp'))
    return { result: 'PROBE_PASS', sha256 }
  } finally {
    // Only clean up the exact inode/content created here; drift leaves evidence.
    if (linked) { await exactFile(object, { ...owned, nlink: 2 }); await unlink(object) }
    if (current) { await exactFile(current, owned); await unlink(current) }
  }
}

function sentinelPath(root, id) {
  if (!idPattern.test(id ?? '')) throw new Error('INVALID_SENTINEL_ID')
  return path.posix.join(root, `.cms-media-persistence-${id}.json`)
}

async function checkSentinel(context, identity) {
  const { flags, layout, uid, gid } = context
  const id = flags['--id'], sha256 = flags['--sha256']
  if (!hashPattern.test(sha256 ?? '')) throw new Error('EXPECTED_SENTINEL_HASH_REQUIRED')
  const p = sentinelPath(layout.root, id)
  const info = await lstat(p)
  assertOwned(info, uid, gid, 'file', 0o600)
  if (info.size < 1 || info.size > 512) throw new Error('SENTINEL_CONTENT_MISMATCH')
  const bytes = await readFile(p)
  if (digest(bytes) !== sha256) throw new Error('SENTINEL_HASH_MISMATCH')
  const value = parseJson(bytes, 'SENTINEL_CONTENT_MISMATCH')
  if (value.version !== 1 || value.purpose !== 'cms-media-persistence'
    || value.rootIdentity !== identity || value.id !== id || !idPattern.test(value.nonce ?? '')) {
    throw new Error('SENTINEL_CONTENT_MISMATCH')
  }
  return { p, info, sha256 }
}

async function main(argv) {
  const context = args(argv)
  const { command, flags, layout, uid, gid } = context
  // No host write, implicit env lookup, runtime restart, DB call, or recursive cleanup.
  if (command === 'provision') return provision(context)
  const identity = requireIdentity(flags)
  if (command !== 'inspect') assertService(uid, gid)
  const actual = await existingRoot(context, identity)
  if (command === 'inspect') return { result: 'ROOT_VERIFIED', rootIdentity: actual, uid, gid }
  if (command === 'probe') return probe(context, identity)
  if (command === 'retain') {
    confirm(flags, `retain:${identity}`)
    const id = randomBytes(16).toString('hex')
    const bytes = Buffer.from(JSON.stringify({ version: 1, purpose: 'cms-media-persistence', rootIdentity: identity,
      id, nonce: randomBytes(16).toString('hex') }), 'utf8')
    const p = sentinelPath(layout.root, id)
    const handle = await open(p, 'wx', 0o600)
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
    await syncDirectory(layout.root)
    return { result: 'SENTINEL_RETAINED', id, sha256: digest(bytes) }
  }
  const found = await checkSentinel(context, identity)
  if (command === 'verify') return { result: 'SENTINEL_VERIFIED', id: flags['--id'], sha256: found.sha256 }
  confirm(flags, `remove:${identity}`)
  await exactFile(found.p, { dev: found.info.dev, ino: found.info.ino, sha256: found.sha256, nlink: 1 })
  await unlink(found.p)
  await syncDirectory(layout.root)
  return { result: 'SENTINEL_REMOVED', id: flags['--id'] }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result)), error => {
    console.error(`CMS_MEDIA_PREFLIGHT_FAIL ${error.code ?? error.message}`)
    process.exitCode = 1
  })
}
