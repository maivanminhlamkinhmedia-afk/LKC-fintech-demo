import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm, rmdir, symlink, link, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import ts from 'typescript'

const cms = new URL('../src/features/cms/', import.meta.url)
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'server-only') return next('data:text/javascript,export {};', context)
  if (context.parentURL?.startsWith(cms.href) && specifier.startsWith('./') && !specifier.endsWith('.ts')) {
    return next(new URL(`${specifier}.ts`, context.parentURL).href, context)
  }
  return next(specifier, context)
} })
const storage = await import('../src/features/cms/media-storage.ts')
after(() => hooks.deregister())

const mediaUnavailable = error => error.code === 'MEDIA_NOT_AVAILABLE'
const storageUnavailable = error => error.code === 'MEDIA_STORAGE_UNAVAILABLE'
const envKeys = ['CMS_MEDIA_ROOT', 'CMS_MEDIA_ROOT_MODE', 'CMS_E2E_WORKSPACE', 'CMS_E2E_RUN_ID']
const id = 'a'.repeat(32), assetId = 'b'.repeat(32), key = `${assetId}.png`
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
async function sandbox(t) {
  const saved = Object.fromEntries(envKeys.map(k => [k, process.env[k]]))
  for (const k of envKeys) delete process.env[k]
  const parent = await mkdtemp(path.join(tmpdir(), 'cms-trace-synthetic-'))
  t.after(async () => {
    // Only the uniquely created synthetic parent, never configured/operator media roots.
    assert.equal(path.dirname(parent), path.resolve(tmpdir()))
    assert.ok(path.basename(parent).startsWith('cms-trace-synthetic-'))
    await rm(parent, { recursive: true, force: true })
    for (const k of envKeys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  })
  process.env.CMS_MEDIA_ROOT = path.join(parent, 'private')
  process.env.CMS_MEDIA_ROOT_MODE = 'local'
  return parent
}
async function provision(t) {
  await sandbox(t)
  return storage.provisionMediaRoot(process.env.CMS_MEDIA_ROOT)
}
function operation(root) {
  return { version: 1, kind: 'upload', id, assetId, actorId: 'synthetic-creator', key,
    rootIdentity: root.identity, startedAt: new Date().toISOString(), stage: 'intent',
    metadata: { originalFilename: 'synthetic.png', altText: 'Synthetic only', caption: null, mimeType: 'image/png' },
    digest: null, size: null, width: null, height: null }
}

test('tracing annotations leave emitted runtime code identical to the reviewed base', async () => {
  const source = await readFile(new URL('media-storage.ts', cms), 'utf8')
  const emitted = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true,
  } }).outputText
  // Base 70ce157... under lockfile TypeScript 5.9.3. This pins runtime semantics,
  // while real filesystem tests below check the private-storage boundaries.
  assert.equal(createHash('sha256').update(emitted).digest('hex'), 'b895f6de459074a93cb92aa7011fde017e696ff01febe7b7cec7957ca03c8781')
})

test('missing, relative, repository and public roots fail closed before provisioning', async t => {
  await sandbox(t)
  for (const value of ['', 'relative/media', process.cwd(), path.join(process.cwd(), 'public', 'media'), path.join(process.cwd(), '.next', 'unapproved')]) {
    process.env.CMS_MEDIA_ROOT = value
    await assert.rejects(storage.openMediaRoot, storageUnavailable)
    await assert.rejects(() => storage.provisionMediaRoot(value), storageUnavailable)
  }
})

test('explicit local path exception permits only descendants of cms009-local', async t => {
  await sandbox(t)
  const parent = path.join(process.cwd(), '.next', 'cms009-local')
  await mkdir(parent, { recursive: true })
  const owned = await mkdtemp(path.join(parent, 'trace-'))
  t.after(async () => { assert.equal(path.dirname(owned), parent); await rm(owned, { recursive: true, force: true }) })
  const target = path.join(owned, 'private')
  process.env.CMS_MEDIA_ROOT = target
  const root = await storage.provisionMediaRoot(target)
  assert.equal((await storage.openMediaRoot()).identity, root.identity)
  for (const bad of [parent, path.join(process.cwd(), '.next', 'cms009-local-escape', 'private')]) {
    process.env.CMS_MEDIA_ROOT = bad
    await assert.rejects(storage.openMediaRoot, storageUnavailable)
  }
})

test('staging exception requires exact workspace/run path and valid run identity', async t => {
  const parent = await sandbox(t), run = 'c'.repeat(24)
  const staging = path.join(parent, '.next', 'cms-e2e-media')
  await mkdir(staging, { recursive: true })
  process.env.CMS_E2E_WORKSPACE = parent
  process.env.CMS_E2E_RUN_ID = run
  process.env.CMS_MEDIA_ROOT_MODE = 'staging'
  process.env.CMS_MEDIA_ROOT = path.join(staging, run)
  const root = await storage.provisionMediaRoot(process.env.CMS_MEDIA_ROOT)
  assert.equal((await storage.openMediaRoot()).identity, root.identity)
  for (const wrong of ['', '../escape', 'd'.repeat(24)]) {
    process.env.CMS_E2E_RUN_ID = wrong
    await assert.rejects(storage.openMediaRoot, storageUnavailable)
  }
})

test('unavailable root remains safe and production mode cannot provision it', async t => {
  await sandbox(t)
  delete process.env.CMS_MEDIA_ROOT_MODE
  await assert.rejects(storage.openMediaRoot, storageUnavailable)
  await assert.rejects(() => storage.provisionMediaRoot(process.env.CMS_MEDIA_ROOT), storageUnavailable)
  await assert.rejects(() => lstat(process.env.CMS_MEDIA_ROOT), { code: 'ENOENT' })
})

test('marker identity, purpose, version and malformed JSON remain guarded', async t => {
  const root = await provision(t), marker = path.join(root.path, '.cms-media-root.json')
  for (const value of [
    { version: 1, identity: '../escape', purpose: 'cms-media' },
    { version: 1, identity: 'a'.repeat(32), purpose: 'public-media' },
    { version: 2, identity: 'a'.repeat(32), purpose: 'cms-media' },
    { version: 1, purpose: 'cms-media' },
  ]) {
    await writeFile(marker, JSON.stringify(value))
    await assert.rejects(storage.openMediaRoot, storageUnavailable)
  }
  await writeFile(marker, '{broken synthetic marker')
  await assert.rejects(storage.openMediaRoot, storageUnavailable)
})

test('root symlink/junction is rejected without following it into private storage', async t => {
  const root = await provision(t), alias = path.join(path.dirname(root.path), 'alias')
  await symlink(root.path, alias, process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal((await lstat(alias)).isSymbolicLink(), true)
  process.env.CMS_MEDIA_ROOT = alias
  await assert.rejects(storage.openMediaRoot, storageUnavailable)
  assert.equal((await readFile(path.join(root.path, '.cms-media-root.json'), 'utf8')).includes(root.identity), true)
})

test('folder junction and inventory symlink cannot escape the checked private root', async t => {
  const root = await provision(t), outside = path.join(path.dirname(root.path), 'outside')
  await mkdir(outside)
  await writeFile(path.join(outside, 'private-canary'), 'synthetic-private-canary')
  await rmdir(path.join(root.path, 'objects'))
  await symlink(outside, path.join(root.path, 'objects'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(storage.openMediaRoot, storageUnavailable)
  await assert.rejects(() => storage.storageInventory(root), storageUnavailable)
  assert.equal(await readFile(path.join(outside, 'private-canary'), 'utf8'), 'synthetic-private-canary')
})

test('real file symlink is rejected for canonical reads and removal', async t => {
  const root = await provision(t), target = path.join(path.dirname(root.path), 'synthetic.png')
  await writeFile(target, png)
  try { await symlink(target, path.join(root.path, 'objects', key), 'file') }
  catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') { t.skip('Windows file symlink privilege unavailable; junction tests still execute'); return }
    throw error
  }
  const digest = createHash('sha256').update(png).digest('hex')
  await assert.rejects(() => storage.readCanonicalFile(root, key, png.length, digest), mediaUnavailable)
  await assert.rejects(() => storage.removeCanonicalFile(root, key, png.length, digest), mediaUnavailable)
  assert.deepEqual(await readFile(target), png)
})

test('canonical media bytes, size and digest survive publication and checked deletion', async t => {
  const root = await provision(t), result = await storage.writeCanonicalFile(root, key, png, id)
  assert.deepEqual(await storage.readCanonicalFile(root, key, result.size, result.digest), png)
  assert.deepEqual((await storage.storageInventory(root)).objects, [key])
  for (const [size, digest] of [[result.size + 1, result.digest], [result.size, 'f'.repeat(64)]]) {
    await assert.rejects(() => storage.removeCanonicalFile(root, key, size, digest), mediaUnavailable)
    assert.deepEqual(await readFile(path.join(root.path, 'objects', key)), png)
  }
  await storage.removeCanonicalFile(root, key, result.size, result.digest)
  await assert.rejects(() => storage.readCanonicalFile(root, key, result.size, result.digest), mediaUnavailable)
})

test('path escape, blank bytes and overwrite attempts cannot alter private data', async t => {
  const root = await provision(t), result = await storage.writeCanonicalFile(root, key, png, id)
  for (const bad of ['../outside.png', '/private.png', '..\\private.png', 'a.png', key + '/suffix']) {
    await assert.rejects(() => storage.readCanonicalFile(root, bad, result.size, result.digest), mediaUnavailable)
    await assert.rejects(() => storage.writeCanonicalFile(root, bad, png, 'd'.repeat(32)), storageUnavailable)
  }
  await assert.rejects(() => storage.writeCanonicalFile(root, 'e'.repeat(32) + '.png', Buffer.alloc(0), 'f'.repeat(32)), storageUnavailable)
  await assert.rejects(() => storage.writeCanonicalFile(root, key, Buffer.from('replacement'), 'e'.repeat(32)), storageUnavailable)
  assert.deepEqual(await readFile(path.join(root.path, 'objects', key)), png)
})

test('hardlinked media cannot be read, inventoried or removed', async t => {
  const root = await provision(t), result = await storage.writeCanonicalFile(root, key, png, id)
  await link(path.join(root.path, 'objects', key), path.join(root.path, 'objects', 'e'.repeat(32) + '.png'))
  await assert.rejects(() => storage.readCanonicalFile(root, key, result.size, result.digest), mediaUnavailable)
  await assert.rejects(() => storage.removeCanonicalFile(root, key, result.size, result.digest), mediaUnavailable)
  await assert.rejects(() => storage.storageInventory(root), storageUnavailable)
  assert.deepEqual(await readFile(path.join(root.path, 'objects', key)), png)
})

test('journal identity, atomic advancement and lock ownership remain unchanged', async t => {
  const root = await provision(t), op = operation(root)
  await storage.createMediaOperation(root, op)
  await assert.rejects(() => storage.advanceMediaOperation(root, { ...op, rootIdentity: 'f'.repeat(32) }), storageUnavailable)
  assert.deepEqual(await storage.readMediaOperation(root, id), op)
  await storage.withMediaLock(root, 'operation', id, async () => {
    await assert.rejects(() => storage.withMediaLock(root, 'operation', id, async () => assert.fail('must not run')), error => error.code === 'MEDIA_BUSY')
    op.stage = 'dispatched'
    await storage.advanceMediaOperation(root, op)
  })
  assert.deepEqual(await storage.readMediaOperation(root, id), op)
  assert.equal(await storage.countPendingMediaIntents(root, op.actorId), 1)
  assert.deepEqual((await storage.storageInventory(root)).locks, [])
  await writeFile(path.join(root.path, 'operations', `${id}.json`), JSON.stringify({ ...op, rootIdentity: 'f'.repeat(32) }))
  await assert.rejects(() => storage.readMediaOperation(root, id), error => error.code === 'NOT_FOUND')
})
