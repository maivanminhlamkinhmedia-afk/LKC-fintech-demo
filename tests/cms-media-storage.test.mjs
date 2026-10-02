import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rm, link } from 'node:fs/promises'
import { join } from 'node:path'
import { registerHooks } from 'node:module'

const rootUrl = new URL('../src/features/cms/', import.meta.url)
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'server-only') return next('data:text/javascript,export {};', context)
  if (context.parentURL?.startsWith(rootUrl.href) && specifier.startsWith('./') && !specifier.endsWith('.ts')) {
    return next(new URL(`${specifier}.ts`, context.parentURL).href, context)
  }
  return next(specifier, context)
} })
const storage = await import('../src/features/cms/media-storage.ts')
after(() => hooks.deregister())
const parent = join(process.cwd(), '.next', 'cms009-local')
function operation(root) {
  const id = randomBytes(16).toString('hex'), assetId = randomBytes(16).toString('hex'), key = `${randomBytes(16).toString('hex')}.png`
  return { version: 1, kind: 'upload', id, assetId, actorId: 'fixture-creator', key, rootIdentity: root.identity,
    startedAt: new Date().toISOString(), stage: 'intent', metadata: { originalFilename: 'synthetic.png', altText: 'Synthetic', caption: null, mimeType: 'image/png' },
    digest: null, size: null, width: null, height: null }
}
async function localRoot(t) {
  await mkdir(parent, { recursive: true })
  const root = join(parent, randomBytes(12).toString('hex'))
  process.env.CMS_MEDIA_ROOT = root; process.env.CMS_MEDIA_ROOT_MODE = 'local'
  t.after(async () => { await rm(root, { recursive: true, force: true }); delete process.env.CMS_MEDIA_ROOT; delete process.env.CMS_MEDIA_ROOT_MODE })
  return root
}
test('missing private root fails closed; explicit local provisioning creates exact marker and folders', async t => {
  const rootPath = await localRoot(t)
  await assert.rejects(() => storage.openMediaRoot(), error => error.code === 'MEDIA_STORAGE_UNAVAILABLE')
  const root = await storage.provisionMediaRoot(rootPath)
  assert.equal(root.path, rootPath)
  assert.equal((await storage.storageInventory(root)).objects.length, 0)
  await assert.rejects(() => storage.provisionMediaRoot(rootPath), error => error.code === 'MEDIA_STORAGE_UNAVAILABLE')
})
test('journal, exact lock, atomic canonical publication and digest-protected read', async t => {
  const root = await storage.provisionMediaRoot(await localRoot(t))
  const op = operation(root)
  await storage.createMediaOperation(root, op)
  assert.equal((await storage.readMediaOperation(root, op.id)).stage, 'intent')
  op.stage = 'canonical-ready'; await storage.advanceMediaOperation(root, op)
  const bytes = Buffer.from('synthetic canonical bytes')
  const result = await storage.withMediaLock(root, 'operation', op.id, async () => {
    await assert.rejects(() => storage.withMediaLock(root, 'operation', op.id, async () => {}), error => error.code === 'MEDIA_BUSY')
    return storage.writeCanonicalFile(root, op.key, bytes, op.id)
  })
  op.digest = result.digest; op.size = result.size; op.width = 1; op.height = 1; op.stage = 'committed'
  await storage.advanceMediaOperation(root, op)
  assert.equal((await storage.readCanonicalFile(root, op.key, bytes.length, result.digest)).toString(), bytes.toString())
  assert.equal((await storage.receiptForAsset(root, op.assetId, op.key)).id, op.id)
  assert.deepEqual((await storage.storageInventory(root)).locks, [])
  await assert.rejects(() => storage.writeCanonicalFile(root, op.key, Buffer.from('overwrite'), randomBytes(16).toString('hex')),
    error => error.code === 'MEDIA_STORAGE_UNAVAILABLE')
  assert.equal((await storage.readCanonicalFile(root, op.key, bytes.length, result.digest)).toString(), bytes.toString())
})
test('bad identity, symlink and hardlink cannot be read or removed by the adapter', async t => {
  const root = await storage.provisionMediaRoot(await localRoot(t))
  const op = operation(root), bytes = Buffer.from('canonical')
  await storage.createMediaOperation(root, op)
  const result = await storage.writeCanonicalFile(root, op.key, bytes, op.id)
  await assert.rejects(() => storage.readCanonicalFile(root, '../outside.png', result.size, result.digest), error => error.code === 'MEDIA_NOT_AVAILABLE')
  await assert.rejects(() => storage.readCanonicalFile(root, op.key, result.size, 'f'.repeat(64)), error => error.code === 'MEDIA_NOT_AVAILABLE')
  const extra = join(root.path, 'objects', `${randomBytes(16).toString('hex')}.png`)
  await link(join(root.path, 'objects', op.key), extra)
  await assert.rejects(() => storage.readCanonicalFile(root, op.key, result.size, result.digest), error => error.code === 'MEDIA_NOT_AVAILABLE')
  await assert.rejects(() => storage.removeCanonicalFile(root, op.key, result.size, result.digest), error => error.code === 'MEDIA_NOT_AVAILABLE')
  assert.equal((await readFile(join(root.path, 'objects', op.key))).toString(), bytes.toString())
})
test('pending quota counts current dispatched/unknown but not expired unused intents', async t => {
  const root = await storage.provisionMediaRoot(await localRoot(t))
  const op = operation(root)
  await storage.createMediaOperation(root, op)
  assert.equal(await storage.countPendingMediaIntents(root, op.actorId), 1)
  op.stage = 'dispatched'; await storage.advanceMediaOperation(root, op)
  assert.equal(await storage.countPendingMediaIntents(root, op.actorId), 1)
  op.stage = 'canonical-ready'; await storage.advanceMediaOperation(root, op)
  assert.equal(await storage.countPendingMediaIntents(root, op.actorId), 1)
  op.stage = 'committed'; await storage.advanceMediaOperation(root, op)
  assert.equal(await storage.countPendingMediaIntents(root, op.actorId), 0)
})
