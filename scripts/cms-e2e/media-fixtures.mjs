import { randomBytes, createHash } from 'node:crypto'
import { mkdir, open, readFile, readdir, lstat, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { PNG } from 'pngjs'
import { demand } from './guard.mjs'

const hex24 = value => typeof value === 'string' && /^[a-f0-9]{24}$/.test(value)
const hex32 = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)
const hex64 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const key = value => typeof value === 'string' && /^[a-f0-9]{32}\.(png|jpg)$/.test(value)
const exact = (value, fields) => value && Object.getPrototypeOf(value) === Object.prototype
  && Reflect.ownKeys(value).length === fields.length && fields.every(field => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field)
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
  })
const users = manifest => manifest.users.map(row => row.id)
const articles = manifest => manifest.articles.map(row => row.id)
export function mediaRootPath(manifest, cwd = process.cwd()) {
  demand(hex24(manifest.runId), 'MEDIA_RUN_ID_INVALID')
  return resolve(cwd, '.next', 'cms-e2e-media', manifest.runId)
}
export function mediaPlan() { return { mediaRootIdentity: randomBytes(16).toString('hex'), mediaIntents: [], mediaDeleteIntents: [], mediaAssets: [], legacyMediaAssets: [], coverLinks: [] } }
export function validateMediaManifest(manifest) {
  const fields = ['mediaRootIdentity', 'mediaIntents', 'mediaDeleteIntents', 'mediaAssets', 'legacyMediaAssets', 'coverLinks']
  if (manifest.version !== 4) { demand(fields.every(field => manifest[field] === undefined), 'LEGACY_MEDIA_NOT_AUTHORIZED'); return }
  demand(hex32(manifest.mediaRootIdentity) && Array.isArray(manifest.mediaIntents) && Array.isArray(manifest.mediaDeleteIntents) && Array.isArray(manifest.mediaAssets)
    && Array.isArray(manifest.legacyMediaAssets) && Array.isArray(manifest.coverLinks), 'MANIFEST_MEDIA_INVALID')
  const opIds = new Set(), assetIds = new Set(), keys = new Set()
  for (const intent of manifest.mediaIntents) {
    demand(exact(intent, ['operationId', 'actorId', 'assetId', 'key', 'mimeType', 'originalFilename'])
      && hex32(intent.operationId) && hex32(intent.assetId) && key(intent.key)
      && users(manifest).includes(intent.actorId)
      && ['image/png', 'image/jpeg'].includes(intent.mimeType)
      && typeof intent.originalFilename === 'string' && intent.originalFilename.length <= 180
      && !opIds.has(intent.operationId) && !assetIds.has(intent.assetId) && !keys.has(intent.key), 'MEDIA_INTENT_INVALID')
    opIds.add(intent.operationId); assetIds.add(intent.assetId); keys.add(intent.key)
  }
  const recorded = new Set()
  for (const row of manifest.mediaAssets) {
    const baseFields = ['id', 'uploadedById', 'operationId', 'key', 'digest', 'size']
    demand((exact(row, baseFields) || exact(row, [...baseFields, 'allowedUploaderIds']))
      && hex32(row.id) && hex32(row.operationId) && key(row.key) && hex64(row.digest)
      && Number.isInteger(row.size) && row.size > 0 && row.size <= 5 * 1024 * 1024
      && manifest.mediaIntents.some(op => op.operationId === row.operationId && op.assetId === row.id
        && op.actorId === row.uploadedById && op.key === row.key)
      && (row.allowedUploaderIds === undefined || Array.isArray(row.allowedUploaderIds) && row.allowedUploaderIds.length === 2
        && row.allowedUploaderIds[0] === row.uploadedById && row.allowedUploaderIds[1] !== row.uploadedById
        && manifest.users.some(user => user.id === row.allowedUploaderIds[1] && user.role === 'CREATOR'))
      && !recorded.has(row.id), 'MEDIA_ASSET_JOURNAL_INVALID')
    recorded.add(row.id)
  }
  for (const row of manifest.legacyMediaAssets) {
    demand(exact(row, ['id', 'uploadedById', 'filename', 'url', 'sizeBytes', 'mimeType'])
      && hex32(row.id) && users(manifest).includes(row.uploadedById)
      && row.filename === `legacy-${row.id}.png` && row.url === `https://legacy.invalid/${row.id}.png`
      && row.sizeBytes === 1 && row.mimeType === 'image/png'
      && !assetIds.has(row.id) && !recorded.has(row.id), 'MEDIA_LEGACY_JOURNAL_INVALID')
    recorded.add(row.id)
  }
  const deletes = new Set()
  for (const intent of manifest.mediaDeleteIntents) {
    demand(exact(intent, ['assetId', 'actorId', 'key']) && manifest.mediaAssets.some(row => row.id === intent.assetId && row.key === intent.key)
      && users(manifest).includes(intent.actorId) && !deletes.has(intent.assetId), 'MEDIA_DELETE_INTENT_INVALID')
    deletes.add(intent.assetId)
  }
  const links = new Set()
  for (const edge of manifest.coverLinks) {
    demand(exact(edge, ['articleId', 'mediaId']) && articles(manifest).includes(edge.articleId)
      && (manifest.mediaAssets.some(row => row.id === edge.mediaId) || manifest.legacyMediaAssets.some(row => row.id === edge.mediaId))
      && !links.has(edge.articleId), 'MEDIA_COVER_JOURNAL_INVALID')
    links.add(edge.articleId)
  }
}
export async function provisionRunMediaRoot(manifest, cwd = process.cwd()) {
  validateMediaManifest(manifest)
  const parent = resolve(cwd, '.next', 'cms-e2e-media'), root = mediaRootPath(manifest, cwd)
  await mkdir(parent, { recursive: true })
  await mkdir(root, { mode: 0o700 })
  for (const name of ['objects', 'tmp', 'operations', 'locks']) await mkdir(join(root, name), { mode: 0o700 })
  const handle = await open(join(root, '.cms-media-root.json'), 'wx', 0o600)
  try { await handle.writeFile(JSON.stringify({ version: 1, identity: manifest.mediaRootIdentity, purpose: 'cms-media' })); await handle.sync() }
  finally { await handle.close() }
  return root
}
async function rootAndInventory(manifest, cwd = process.cwd()) {
  const root = mediaRootPath(manifest, cwd)
  const info = await lstat(root)
  demand(info.isDirectory() && !info.isSymbolicLink() && await realpath(root) === root, 'MEDIA_ROOT_INVALID')
  const markerFile = join(root, '.cms-media-root.json')
  const markerInfo = await lstat(markerFile)
  demand(markerInfo.isFile() && markerInfo.nlink === 1 && !markerInfo.isSymbolicLink(), 'MEDIA_MARKER_INVALID')
  const marker = JSON.parse(await readFile(markerFile, 'utf8'))
  demand(exact(marker, ['version', 'identity', 'purpose']) && marker.version === 1
    && marker.identity === manifest.mediaRootIdentity && marker.purpose === 'cms-media', 'MEDIA_MARKER_INVALID')
  const files = {}
  for (const name of ['objects', 'tmp', 'operations', 'locks']) {
    const dir = join(root, name), directory = await lstat(dir)
    demand(directory.isDirectory() && !directory.isSymbolicLink() && await realpath(dir) === dir, 'MEDIA_DIRECTORY_INVALID')
    files[name] = []
    for (const entry of await readdir(dir)) {
      const item = await lstat(join(dir, entry))
      demand(name === 'locks' ? item.isDirectory() && !item.isSymbolicLink()
        : item.isFile() && !item.isSymbolicLink() && item.nlink === 1, 'MEDIA_FILE_TYPE_INVALID')
      files[name].push(entry)
    }
  }
  return { root, files }
}
export async function reserveMediaOperation(manifest, operation, persist) {
  validateMediaManifest(manifest)
  const updated = { ...manifest, mediaIntents: [...manifest.mediaIntents, operation] }
  validateMediaManifest(updated)
  // Persistence must ACK before the intercepted browser POST is continued.
  await persist(updated)
  manifest.mediaIntents = updated.mediaIntents
}
export async function reserveMediaDelete(manifest, assetId, actorId, persist) {
  validateMediaManifest(manifest)
  const asset = manifest.mediaAssets.find(row => row.id === assetId)
  demand(asset && users(manifest).includes(actorId), 'MEDIA_DELETE_NOT_OWNED')
  const updated = { ...manifest, mediaDeleteIntents: [...manifest.mediaDeleteIntents,
    { assetId, actorId, key: asset.key }] }
  validateMediaManifest(updated)
  await persist(updated)
  manifest.mediaDeleteIntents = updated.mediaDeleteIntents
}
// Test-only pagination batch. Persist exact ownership before any FS/DB side
// effect; interrupted writes remain identifiable to guarded graph recovery.
export async function seedManagedMediaBatch(db, manifest, actorId, count, bytes, persist, cwd = process.cwd()) {
  validateMediaManifest(manifest)
  demand(manifest.version === 4 && users(manifest).includes(actorId) && Number.isInteger(count) && count > 0 && count <= 30
    && Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 5 * 1024 * 1024, 'MEDIA_BATCH_INVALID')
  await inspectMediaGraph(db, manifest, cwd, true)
  const { width, height } = PNG.sync.read(bytes)
  demand(width > 0 && height > 0 && width <= 4096 && height <= 4096 && width * height <= 4_194_304, 'MEDIA_BATCH_INVALID')
  const root = mediaRootPath(manifest, cwd)
  const digest = createHash('sha256').update(bytes).digest('hex')
  const entries = Array.from({ length: count }, () => {
    const operationId = randomBytes(16).toString('hex'), assetId = randomBytes(16).toString('hex')
    return { operationId, assetId, actorId, key: `${randomBytes(16).toString('hex')}.png`,
      mimeType: 'image/png', originalFilename: `page-${assetId}.png` }
  })
  const updated = { ...manifest, mediaIntents: [...manifest.mediaIntents, ...entries] }
  validateMediaManifest(updated); await persist(updated); manifest.mediaIntents = updated.mediaIntents
  const rows = [], operations = []
  for (const entry of entries) {
    const operation = { version: 1, kind: 'upload', id: entry.operationId, assetId: entry.assetId, actorId,
      key: entry.key, rootIdentity: manifest.mediaRootIdentity, startedAt: new Date().toISOString(), stage: 'file-ready',
      metadata: { originalFilename: entry.originalFilename, altText: 'Fixture page', caption: null, mimeType: 'image/png' },
      digest, size: bytes.length, width, height }
    await writeFile(join(root, 'operations', `${entry.operationId}.json`), JSON.stringify(operation), { flag: 'wx' })
    await writeFile(join(root, 'objects', entry.key), bytes, { flag: 'wx' })
    operations.push(operation)
    rows.push({ id: entry.assetId, uploadedById: actorId, filename: entry.key,
      originalFilename: entry.originalFilename, url: `/api/cms/media/${entry.assetId}/content`,
      mimeType: 'image/png', sizeBytes: bytes.length, width, height, altText: 'Fixture page', caption: null })
  }
  demand((await db.mediaAsset.createMany({ data: rows })).count === count, 'MEDIA_BATCH_CREATE_COUNT_MISMATCH')
  // Only an acknowledged DB commit releases these test-only receipts from
  // the same pending quota enforced by beginMediaUpload for this actor.
  for (const operation of operations) {
    const temporary = join(root, 'tmp', `${operation.id}.journal`)
    const handle = await open(temporary, 'wx', 0o600)
    try { await handle.writeFile(JSON.stringify({ ...operation, stage: 'committed' })); await handle.sync() }
    finally { await handle.close() }
    await rename(temporary, join(root, 'operations', `${operation.id}.json`))
  }
  return rows
}
export async function inspectMediaGraph(db, manifest, cwd = process.cwd(), recover = false) {
  validateMediaManifest(manifest)
  if (manifest.version !== 4) return null
  const { root, files } = await rootAndInventory(manifest, cwd)
  demand(files.locks.length === 0, 'MEDIA_ACTIVE_LOCK_OR_UNCERTAIN_OWNER')
  const operations = [], recoveredIntents = []
  for (const name of files.operations) {
    demand(/^[a-f0-9]{32}\.json$/.test(name), 'MEDIA_OPERATION_FILE_UNKNOWN')
    const id = name.slice(0, 32)
    const operation = JSON.parse(await readFile(join(root, 'operations', name), 'utf8'))
    demand(operation.kind === 'upload' || operation.kind === 'delete', 'MEDIA_OPERATION_KIND_INVALID')
    let intent = operation.kind === 'upload' ? manifest.mediaIntents.find(row => row.operationId === id)
      : manifest.mediaDeleteIntents.find(row => row.assetId === operation.assetId && row.actorId === operation.actorId && row.key === operation.key)
    if (!intent && recover && operation.kind === 'upload' && users(manifest).includes(operation.actorId)
      && hex32(operation.assetId) && key(operation.key) && ['image/png', 'image/jpeg'].includes(operation.metadata?.mimeType)
      && typeof operation.metadata.originalFilename === 'string'
      && operation.metadata.originalFilename.length > 0 && operation.metadata.originalFilename.length <= 180
      && new Date(operation.startedAt).toISOString() === operation.startedAt) {
      intent = { operationId: id, actorId: operation.actorId, assetId: operation.assetId, key: operation.key,
        mimeType: operation.metadata.mimeType, originalFilename: operation.metadata.originalFilename }
      recoveredIntents.push(intent)
    }
    demand(intent && operation.version === 1 && operation.id === id
      && operation.rootIdentity === manifest.mediaRootIdentity && operation.actorId === intent.actorId
      && operation.assetId === (operation.kind === 'upload' ? intent.assetId : intent.assetId)
      && operation.key === intent.key
      && (operation.kind !== 'delete' || [manifest.mediaAssets.find(row => row.id === operation.assetId)?.uploadedById,
        manifest.mediaAssets.find(row => row.id === operation.assetId)?.allowedUploaderIds?.[1]].includes(operation.uploadedById))
      && (operation.kind !== 'upload' || operation.metadata?.mimeType === intent.mimeType && operation.metadata?.originalFilename === intent.originalFilename),
    'MEDIA_OPERATION_IDENTITY_DRIFT')
    operations.push(operation)
  }
  if (recoveredIntents.length) validateMediaManifest({ ...manifest, mediaIntents: [...manifest.mediaIntents, ...recoveredIntents] })
  demand(manifest.mediaIntents.every(intent => operations.some(op => op.id === intent.operationId)), 'MEDIA_OPERATION_MISSING')
  for (const intent of manifest.mediaDeleteIntents) if (!operations.some(op => op.kind === 'delete' && op.assetId === intent.assetId)) {
    // A cancelled or lock-rejected UI action may never have dispatched. The
    // reserve record grants no deletion authority unless the row is still exact.
    const row = await db.mediaAsset.findUnique({ where: { id: intent.assetId } })
    demand(row && row.filename === intent.key
      && [manifest.mediaAssets.find(asset => asset.id === intent.assetId)?.uploadedById,
        manifest.mediaAssets.find(asset => asset.id === intent.assetId)?.allowedUploaderIds?.[1]].includes(row.uploadedById),
    'MEDIA_DELETE_OPERATION_MISSING')
  }
  const candidates = await db.mediaAsset.findMany({ where: { OR: [
    { uploadedById: { in: users(manifest) } }, { id: { in: [...manifest.mediaAssets, ...manifest.legacyMediaAssets].map(row => row.id) } },
  ] }, select: { id: true, uploadedById: true, filename: true, url: true, sizeBytes: true, mimeType: true } })
  const assets = [], legacyAssets = []
  for (const row of candidates) {
    const legacy = manifest.legacyMediaAssets.find(item => item.id === row.id)
    if (legacy) {
      demand(legacy.uploadedById === row.uploadedById && legacy.filename === row.filename && legacy.url === row.url
        && legacy.sizeBytes === row.sizeBytes && legacy.mimeType === row.mimeType, 'MEDIA_LEGACY_DB_DRIFT')
      legacyAssets.push(legacy)
      continue
    }
    const existing = manifest.mediaAssets.find(item => item.id === row.id)
    const operation = operations.find(op => op.kind === 'upload' && op.assetId === row.id
      && op.actorId === (existing?.uploadedById ?? row.uploadedById) && op.key === row.filename)
    demand(operation && users(manifest).includes(row.uploadedById) && row.url === `/api/cms/media/${row.id}/content`
      && operation.size === row.sizeBytes && operation.metadata.mimeType === row.mimeType
      && hex64(operation.digest) && files.objects.includes(row.filename), 'MEDIA_DB_IDENTITY_DRIFT')
    demand(existing || recover, 'MEDIA_ASSET_NOT_JOURNALED')
    if (existing) demand([existing.uploadedById, existing.allowedUploaderIds?.[1]].includes(row.uploadedById) && existing.operationId === operation.id
      && existing.key === row.filename && existing.digest === operation.digest && existing.size === row.sizeBytes, 'MEDIA_ASSET_JOURNAL_DRIFT')
    const bytes = await readFile(join(root, 'objects', row.filename))
    demand(bytes.length === row.sizeBytes && createHash('sha256').update(bytes).digest('hex') === operation.digest, 'MEDIA_FILE_IDENTITY_DRIFT')
    assets.push({ id: row.id, uploadedById: row.uploadedById, operationId: operation.id, key: row.filename, digest: operation.digest, size: row.sizeBytes })
  }
  for (const item of manifest.mediaAssets) if (!assets.some(row => row.id === item.id)) {
    const deletion = operations.find(op => op.kind === 'delete' && op.assetId === item.id
      && op.key === item.key && ['dispatched', 'db-deleted', 'complete'].includes(op.stage))
    demand(deletion && manifest.mediaDeleteIntents.some(intent => intent.assetId === item.id
      && intent.key === item.key && intent.actorId === deletion.actorId), 'MEDIA_ASSET_DISAPPEARED_WITHOUT_DELETE')
  }
  for (const item of manifest.legacyMediaAssets) {
    // Reservation may precede the test-only INSERT; a committed row must match
    // exactly and a missing row can never authorize file cleanup.
    demand(!candidates.some(row => row.id === item.id) || legacyAssets.some(row => row.id === item.id), 'MEDIA_LEGACY_DB_DRIFT')
  }
  const reverse = await db.article.findMany({ where: { coverMediaId: { in: [...new Set([...assets.map(row => row.id), ...manifest.mediaAssets.map(row => row.id), ...manifest.legacyMediaAssets.map(row => row.id)])] } },
    select: { id: true, coverMediaId: true, authorId: true } })
  for (const edge of reverse) demand(articles(manifest).includes(edge.id) && users(manifest).includes(edge.authorId)
    && [...assets, ...legacyAssets].some(asset => asset.id === edge.coverMediaId), 'MEDIA_FOREIGN_REVERSE_REFERENCE')
  const fixtureArticles = await db.article.findMany({ where: { id: { in: articles(manifest) } }, select: { id: true, coverMediaId: true } })
  for (const article of fixtureArticles) demand(article.coverMediaId === null || [...assets, ...legacyAssets].some(asset => asset.id === article.coverMediaId), 'MEDIA_FIXTURE_ARTICLE_FOREIGN_COVER')
  const coverLinks = fixtureArticles.filter(row => row.coverMediaId !== null).map(row => ({ articleId: row.id, mediaId: row.coverMediaId }))
  const known = manifest.coverLinks
  for (const edge of coverLinks) demand(known.some(item => item.articleId === edge.articleId && item.mediaId === edge.mediaId) || recover, 'MEDIA_COVER_NOT_JOURNALED')
  for (const item of known) demand(coverLinks.some(edge => edge.articleId === item.articleId && edge.mediaId === item.mediaId) || recover, 'MEDIA_COVER_JOURNAL_DRIFT')
  const allowedObjects = new Set(operations.filter(op => op.kind === 'upload' && op.stage !== 'intent' && op.stage !== 'dispatched').map(op => op.key))
  demand(files.objects.every(name => allowedObjects.has(name)), 'MEDIA_UNKNOWN_FILE')
  const allowedTemp = new Set(operations.flatMap(op => [
    `${op.id}.journal`, ...(op.kind === 'upload' && op.stage === 'canonical-ready' ? [`${op.id}.bin`] : []),
  ]))
  demand(files.tmp.every(name => allowedTemp.has(name)), 'MEDIA_UNKNOWN_TEMP_FILE')
  const tempDigests = {}
  for (const name of files.tmp) {
    const operation = operations.find(op => name.startsWith(`${op.id}.`))
    const bytes = await readFile(join(root, 'tmp', name))
    if (name.endsWith('.bin')) demand(operation?.kind === 'upload' && hex64(operation.digest)
      && bytes.length === operation.size && createHash('sha256').update(bytes).digest('hex') === operation.digest,
    'MEDIA_TEMP_IDENTITY_DRIFT')
    else {
      const staged = JSON.parse(bytes.toString('utf8'))
      demand(staged.version === 1 && staged.id === operation?.id && staged.kind === operation.kind
        && staged.rootIdentity === manifest.mediaRootIdentity && staged.actorId === operation.actorId
        && staged.assetId === operation.assetId && staged.key === operation.key,
      'MEDIA_TEMP_JOURNAL_DRIFT')
    }
    tempDigests[name] = createHash('sha256').update(bytes).digest('hex')
  }
  for (const name of files.objects) {
    const operation = operations.find(op => op.kind === 'upload' && op.key === name)
    const bytes = await readFile(join(root, 'objects', name))
    demand(hex64(operation?.digest) && bytes.length === operation.size
      && createHash('sha256').update(bytes).digest('hex') === operation.digest, 'MEDIA_FILE_IDENTITY_DRIFT')
  }
  return { root, files, operations, assets, legacyAssets, coverLinks, recoveredIntents, tempDigests }
}
export async function mediaDbCounts(db, manifest) {
  if (manifest.version !== 4) return {}
  const ids = [...manifest.mediaAssets, ...manifest.legacyMediaAssets].map(row => row.id)
  return { mediaAssets: await db.mediaAsset.count({ where: { OR: [{ uploadedById: { in: users(manifest) } }, { id: { in: ids } }] } }),
    coverLinks: await db.article.count({ where: { OR: [{ AND: [{ id: { in: articles(manifest) } }, { coverMediaId: { not: null } }] },
      { coverMediaId: { in: ids } }] } }) }
}
export async function mediaFsCounts(manifest, cwd = process.cwd()) {
  const { files } = await rootAndInventory(manifest, cwd)
  return { mediaFiles: files.objects.length, mediaTempFiles: files.tmp.length,
    mediaJournals: files.operations.length, mediaLocks: files.locks.length }
}
export async function cleanupMediaFiles(manifest, graph, cwd = process.cwd()) {
  validateMediaManifest(manifest)
  demand(manifest.version === 4 && graph && graph.files.locks.length === 0, 'MEDIA_CLEANUP_NOT_AUTHORIZED')
  // The graph was checked before DB cleanup; re-read and compare exact inventory.
  const current = await rootAndInventory(manifest, cwd)
  for (const field of ['objects', 'tmp', 'operations', 'locks']) demand(JSON.stringify([...current.files[field]].sort()) === JSON.stringify([...graph.files[field]].sort()), 'MEDIA_INVENTORY_CHANGED')
  for (const name of graph.files.objects) {
    const receipt = graph.operations.find(op => op.kind === 'upload' && op.key === name)
    const bytes = await readFile(join(graph.root, 'objects', name))
    demand(receipt && bytes.length === receipt.size && createHash('sha256').update(bytes).digest('hex') === receipt.digest,
      'MEDIA_FILE_IDENTITY_DRIFT')
  }
  for (const name of graph.files.tmp) demand(createHash('sha256').update(await readFile(join(graph.root, 'tmp', name))).digest('hex')
    === graph.tempDigests[name], 'MEDIA_TEMP_IDENTITY_DRIFT')
  for (const name of graph.files.objects) await unlink(join(graph.root, 'objects', name))
  for (const name of graph.files.tmp) await unlink(join(graph.root, 'tmp', name))
  for (const name of graph.files.operations) await unlink(join(graph.root, 'operations', name))
  const counts = await mediaFsCounts(manifest, cwd)
  demand(Object.values(counts).every(count => count === 0), 'MEDIA_FILES_REMAIN')
  return counts
}
