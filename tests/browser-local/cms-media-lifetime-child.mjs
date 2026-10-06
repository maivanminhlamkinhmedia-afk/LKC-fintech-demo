import { createHash } from 'node:crypto'
import { registerHooks } from 'node:module'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const moduleRoot = process.env.CMS009_MEDIA_MODULE_ROOT ? resolve(process.env.CMS009_MEDIA_MODULE_ROOT) : resolve('.')
const rootUrl = pathToFileURL(join(moduleRoot, 'src', 'features', 'cms') + sep)
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'server-only') return next('data:text/javascript,export {};', context)
  if (context.parentURL?.startsWith(rootUrl.href) && specifier.startsWith('./') && !specifier.endsWith('.ts'))
    return next(new URL(`${specifier}.ts`, context.parentURL).href, context)
  return next(specifier, context)
} })
try {
  const storage = await import(pathToFileURL(join(moduleRoot, 'src', 'features', 'cms', 'media-storage.ts')).href)
  const rootPath = process.env.CMS_MEDIA_ROOT
  const id = process.env.CMS009_TEST_OP, assetId = process.env.CMS009_TEST_ASSET, key = process.env.CMS009_TEST_KEY
  const bytes = process.env.CMS009_TEST_PAYLOAD
    ? Buffer.from(process.env.CMS009_TEST_PAYLOAD, 'base64') : Buffer.from('cms009-two-process-canonical-bytes')
  if (process.argv[2] === 'write') {
    const root = await storage.provisionMediaRoot(rootPath)
    const operation = { version: 1, kind: 'upload', id, assetId, key, actorId: 'fixture-creator', rootIdentity: root.identity,
      startedAt: new Date().toISOString(), stage: 'intent', metadata: { originalFilename: 'synthetic.png', altText: 'Synthetic', caption: null,
        mimeType: 'image/png' }, digest: null, size: null, width: null, height: null }
    await storage.createMediaOperation(root, operation)
    const stored = await storage.writeCanonicalFile(root, key, bytes, id)
    Object.assign(operation, stored, { width: 1, height: 1, stage: 'committed' })
    await storage.advanceMediaOperation(root, operation)
    process.stdout.write(JSON.stringify({ pid: process.pid, identity: root.identity, digest: stored.digest, size: stored.size }))
  } else if (process.argv[2] === 'read') {
    const root = await storage.openMediaRoot()
    const operation = await storage.readMediaOperation(root, id)
    const receipt = await storage.receiptForAsset(root, assetId, key)
    const stored = await storage.readCanonicalFile(root, key, receipt.size, receipt.digest)
    if (operation.stage !== 'committed' || !stored.equals(bytes)
      || createHash('sha256').update(stored).digest('hex') !== receipt.digest) throw new Error('LIFETIME_STATE_DRIFT')
    process.stdout.write(JSON.stringify({ pid: process.pid, identity: root.identity, digest: receipt.digest, size: stored.length }))
  } else throw new Error('LIFETIME_MODE_INVALID')
} finally { hooks.deregister() }
