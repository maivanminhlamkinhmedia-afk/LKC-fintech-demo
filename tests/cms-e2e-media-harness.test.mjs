import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerHooks } from 'node:module'
import { PNG } from 'pngjs'
import { createFixturePlan, validateManifest } from '../scripts/cms-e2e/fixtures.mjs'
import { mediaRootPath, provisionRunMediaRoot, validateMediaManifest, reserveMediaOperation,
  inspectMediaGraph, mediaFsCounts, cleanupMediaFiles, seedManagedMediaBatch } from '../scripts/cms-e2e/media-fixtures.mjs'

const rootUrl = new URL('../src/features/cms/', import.meta.url)
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'server-only') return next('data:text/javascript,export {};', context)
  if (context.parentURL?.startsWith(rootUrl.href) && specifier.startsWith('./') && !specifier.endsWith('.ts')) {
    return next(new URL(`${specifier}.ts`, context.parentURL).href, context)
  }
  return next(specifier, context)
} })
const { countPendingMediaIntents } = await import('../src/features/cms/media-storage.ts')
after(() => hooks.deregister())

const scratch = []
afterEach(async () => { while (scratch.length) await rm(scratch.pop(), { recursive: true, force: true }) })
async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), 'cms009-media-harness-')); scratch.push(cwd)
  const manifest = createFixturePlan('abcdef0123456789abcdef01', 4)
  const root = await provisionRunMediaRoot(manifest, cwd)
  return { cwd, manifest, root }
}
function db(rows = [], covers = [], foreign = []) {
  return { mediaAsset: { async findMany() { return rows }, async count() { return rows.length } },
    article: { async findMany(args) { return args.select?.authorId ? foreign : covers }, async count() { return covers.length } } }
}
test('v4 requires exact root marker and empty fresh private inventory', async () => {
  const { cwd, manifest, root } = await setup()
  validateManifest(manifest)
  assert.equal(mediaRootPath(manifest, cwd), root)
  assert.deepEqual(await mediaFsCounts(manifest, cwd), { mediaFiles: 0, mediaTempFiles: 0, mediaJournals: 0, mediaLocks: 0 })
  assert.deepEqual((await inspectMediaGraph(db(), manifest, cwd)).assets, [])
  assert.deepEqual(await cleanupMediaFiles(manifest, await inspectMediaGraph(db(), manifest, cwd), cwd),
    { mediaFiles: 0, mediaTempFiles: 0, mediaJournals: 0, mediaLocks: 0 })
})
test('legacy manifests cannot acquire media cleanup authority by adding fields', () => {
  for (const version of [1, 2, 3]) {
    const manifest = createFixturePlan('abcdef0123456789abcdef01', version)
    manifest.mediaAssets = []
    assert.throws(() => validateManifest(manifest), /LEGACY_MEDIA_NOT_AUTHORIZED|MANIFEST_V3_KEYS_INVALID/)
    delete manifest.mediaAssets
    manifest.legacyMediaAssets = []
    assert.throws(() => validateManifest(manifest), /LEGACY_MEDIA_NOT_AUTHORIZED|MANIFEST_V3_KEYS_INVALID/)
  }
})
test('v4 legacy row is exact DB-only fixture authority, never a private file claim', async () => {
  const { cwd, manifest } = await setup()
  const id = '9'.repeat(32)
  const entry = { id, uploadedById: manifest.users[0].id, filename: `legacy-${id}.png`,
    url: `https://legacy.invalid/${id}.png`, sizeBytes: 1, mimeType: 'image/png' }
  manifest.legacyMediaAssets.push(entry)
  validateManifest(manifest)
  const row = { ...entry }
  assert.deepEqual((await inspectMediaGraph(db([row]), manifest, cwd)).legacyAssets, [entry])
  await assert.rejects(() => inspectMediaGraph(db([{ ...row, url: 'https://foreign.invalid/file.png' }]), manifest, cwd), /MEDIA_LEGACY_DB_DRIFT/)
  await assert.rejects(() => inspectMediaGraph(db([row], [], [{ id: 'foreign', coverMediaId: id, authorId: 'other' }]), manifest, cwd),
    /MEDIA_FOREIGN_REVERSE_REFERENCE/)
  manifest.legacyMediaAssets[0] = { ...entry, uploadedById: 'foreign' }
  assert.throws(() => validateManifest(manifest), /MEDIA_LEGACY_JOURNAL_INVALID/)
  manifest.legacyMediaAssets[0] = { ...entry, url: 'https://foreign.invalid/file.png' }
  assert.throws(() => validateManifest(manifest), /MEDIA_LEGACY_JOURNAL_INVALID/)
})
test('managed pagination batch rejects foreign actor and invalid count before DB or FS writes', async () => {
  const { cwd, manifest } = await setup()
  const before = JSON.stringify(manifest)
  await assert.rejects(() => seedManagedMediaBatch(db(), manifest, 'foreign', 21, Buffer.from('image'), async () => {}), /MEDIA_BATCH_INVALID/)
  await assert.rejects(() => seedManagedMediaBatch(db(), manifest, manifest.users[0].id, 31, Buffer.from('image'), async () => {}), /MEDIA_BATCH_INVALID/)
  assert.equal(JSON.stringify(manifest), before)
  assert.deepEqual(await mediaFsCounts(manifest, cwd), { mediaFiles: 0, mediaTempFiles: 0, mediaJournals: 0, mediaLocks: 0 })
})
test('committed pagination batch does not consume the creator upload quota', async () => {
  const { cwd, manifest, root } = await setup()
  const rows = []
  const fixtureDb = db(rows)
  fixtureDb.mediaAsset.createMany = async ({ data }) => { rows.push(...data); return { count: data.length } }
  const image = new PNG({ width: 1, height: 1 })
  image.data = Buffer.from([1, 2, 3, 255])
  const actorId = manifest.users[0].id
  const created = await seedManagedMediaBatch(fixtureDb, manifest, actorId, 4, PNG.sync.write(image), async () => {}, cwd)
  assert.equal(created.length, 4)
  assert.equal(rows.length, 4)
  assert.equal(await countPendingMediaIntents({ path: root, identity: manifest.mediaRootIdentity }, actorId), 0)
  for (const intent of manifest.mediaIntents) {
    const receipt = JSON.parse(await readFile(join(root, 'operations', `${intent.operationId}.json`), 'utf8'))
    assert.equal(receipt.stage, 'committed')
  }
})
test('pagination batch with unacknowledged DB write retains pending receipt for recovery', async () => {
  const { cwd, manifest, root } = await setup()
  const fixtureDb = db()
  fixtureDb.mediaAsset.createMany = async () => { throw new Error('synthetic DB ACK loss') }
  const image = new PNG({ width: 1, height: 1 })
  image.data = Buffer.from([1, 2, 3, 255])
  const actorId = manifest.users[0].id
  await assert.rejects(() => seedManagedMediaBatch(fixtureDb, manifest, actorId, 1, PNG.sync.write(image), async () => {}, cwd),
    /synthetic DB ACK loss/)
  assert.equal(await countPendingMediaIntents({ path: root, identity: manifest.mediaRootIdentity }, actorId), 1)
  const intent = manifest.mediaIntents[0]
  const receipt = JSON.parse(await readFile(join(root, 'operations', `${intent.operationId}.json`), 'utf8'))
  assert.equal(receipt.stage, 'file-ready')
})
test('reserved operation and DB/file exact identity admit one managed asset', async () => {
  const { cwd, manifest, root } = await setup()
  const intent = { operationId: 'a'.repeat(32), assetId: 'b'.repeat(32), actorId: manifest.users[0].id,
    key: `${'c'.repeat(32)}.png`, mimeType: 'image/png', originalFilename: 'synthetic.png' }
  let persisted = 0
  await reserveMediaOperation(manifest, intent, async updated => { validateManifest(updated); persisted++ })
  assert.equal(persisted, 1)
  const bytes = Buffer.from('synthetic-canonical-image')
  const digest = createHash('sha256').update(bytes).digest('hex')
  await writeFile(join(root, 'objects', intent.key), bytes)
  await writeFile(join(root, 'operations', `${intent.operationId}.json`), JSON.stringify({ version: 1, kind: 'upload',
    id: intent.operationId, actorId: intent.actorId, assetId: intent.assetId, key: intent.key, rootIdentity: manifest.mediaRootIdentity,
    stage: 'committed', metadata: { mimeType: intent.mimeType, originalFilename: intent.originalFilename }, digest, size: bytes.length }))
  const row = { id: intent.assetId, uploadedById: intent.actorId, filename: intent.key,
    url: `/api/cms/media/${intent.assetId}/content`, sizeBytes: bytes.length, mimeType: intent.mimeType }
  await assert.rejects(() => inspectMediaGraph(db([row]), manifest, cwd), /MEDIA_ASSET_NOT_JOURNALED/)
  manifest.mediaAssets.push({ id: row.id, uploadedById: row.uploadedById, operationId: intent.operationId,
    key: intent.key, digest, size: bytes.length })
  const beforeManifest = JSON.stringify(manifest)
  const beforeJournal = await readFile(join(root, 'operations', `${intent.operationId}.json`))
  const beforeBytes = await readFile(join(root, 'objects', intent.key))
  const inventory = await mediaFsCounts(manifest, cwd)
  const readOnlyDb = db([row]) // Only read methods exist; a mutation would throw.
  assert.equal((await inspectMediaGraph(readOnlyDb, manifest, cwd)).assets.length, 1)
  assert.deepEqual(await mediaFsCounts(manifest, cwd), inventory)
  assert.equal(JSON.stringify(manifest), beforeManifest)
  assert.deepEqual(await readFile(join(root, 'operations', `${intent.operationId}.json`)), beforeJournal)
  assert.deepEqual(await readFile(join(root, 'objects', intent.key)), beforeBytes)
  await assert.rejects(() => inspectMediaGraph(db(), manifest, cwd), /MEDIA_ASSET_DISAPPEARED_WITHOUT_DELETE/)
  await assert.rejects(() => inspectMediaGraph(db([row], [], [{ id: 'foreign', coverMediaId: row.id, authorId: 'other' }]), manifest, cwd),
    /MEDIA_FOREIGN_REVERSE_REFERENCE/)
  const other = manifest.users.find(user => user.key === 'other').id
  manifest.mediaAssets[0].allowedUploaderIds = [row.uploadedById, other]
  validateMediaManifest(manifest)
  assert.equal((await inspectMediaGraph(db([{ ...row, uploadedById: other }]), manifest, cwd)).assets[0].uploadedById, other)
  await assert.rejects(() => inspectMediaGraph(db([{ ...row, uploadedById: manifest.users[2].id }]), manifest, cwd),
    /MEDIA_DB_IDENTITY_DRIFT|MEDIA_ASSET_JOURNAL_DRIFT/)
  manifest.mediaAssets[0].allowedUploaderIds = [row.uploadedById, manifest.users[2].id]
  assert.throws(() => validateMediaManifest(manifest), /MEDIA_ASSET_JOURNAL_INVALID/)
  manifest.mediaAssets[0].allowedUploaderIds = [row.uploadedById, other]
  await writeFile(join(root, 'objects', `${'d'.repeat(32)}.png`), bytes)
  await assert.rejects(() => inspectMediaGraph(db([row]), manifest, cwd), /MEDIA_UNKNOWN_FILE/)
})
test('invalid media batch, unknown files and marker drift fail closed before cleanup', async () => {
  const { cwd, manifest, root } = await setup()
  manifest.mediaAssets.push({ id: 'b'.repeat(32), uploadedById: manifest.users[0].id,
    operationId: 'a'.repeat(32), key: `${'c'.repeat(32)}.png`, digest: 'd'.repeat(64), size: 1 })
  assert.throws(() => validateMediaManifest(manifest), /MEDIA_ASSET_JOURNAL_INVALID/)
  manifest.mediaAssets = []
  await writeFile(join(root, 'objects', `${'e'.repeat(32)}.png`), 'foreign')
  await assert.rejects(() => inspectMediaGraph(db(), manifest, cwd), /MEDIA_UNKNOWN_FILE/)
  await writeFile(join(root, '.cms-media-root.json'), JSON.stringify({ version: 1, identity: 'f'.repeat(32), purpose: 'cms-media' }))
  await assert.rejects(() => mediaFsCounts(manifest, cwd), /MEDIA_MARKER_INVALID/)
})
test('lost begin-upload ACK admits only a fresh-root fixture actor intent during guarded recovery', async () => {
  const { cwd, manifest, root } = await setup()
  const operationId = 'e'.repeat(32), assetId = 'f'.repeat(32), fileKey = `${'a'.repeat(32)}.png`
  const operation = { version: 1, kind: 'upload', id: operationId, actorId: manifest.users[0].id,
    assetId, key: fileKey, rootIdentity: manifest.mediaRootIdentity, startedAt: new Date().toISOString(),
    stage: 'intent', metadata: { mimeType: 'image/png', originalFilename: 'synthetic.png' },
    digest: null, size: null, width: null, height: null }
  await writeFile(join(root, 'operations', `${operationId}.json`), JSON.stringify(operation))
  await assert.rejects(() => inspectMediaGraph(db(), manifest, cwd), /MEDIA_OPERATION_IDENTITY_DRIFT/)
  const recovered = await inspectMediaGraph(db(), manifest, cwd, true)
  assert.deepEqual(recovered.recoveredIntents, [{ operationId, actorId: operation.actorId, assetId,
    key: fileKey, mimeType: 'image/png', originalFilename: 'synthetic.png' }])
  operation.actorId = 'foreign'
  await writeFile(join(root, 'operations', `${operationId}.json`), JSON.stringify(operation))
  await assert.rejects(() => inspectMediaGraph(db(), manifest, cwd, true), /MEDIA_OPERATION_IDENTITY_DRIFT/)
})
test('crashed atomic journal temp is tied to one operation and rechecked before cleanup', async () => {
  const { cwd, manifest, root } = await setup()
  const intent = { operationId: '1'.repeat(32), actorId: manifest.users[0].id,
    assetId: '2'.repeat(32), key: `${'3'.repeat(32)}.png`, mimeType: 'image/png', originalFilename: 'synthetic.png' }
  await reserveMediaOperation(manifest, intent, async () => {})
  const journal = { version: 1, kind: 'upload', id: intent.operationId, actorId: intent.actorId,
    assetId: intent.assetId, key: intent.key, rootIdentity: manifest.mediaRootIdentity,
    startedAt: new Date().toISOString(), stage: 'intent', metadata: { mimeType: intent.mimeType, originalFilename: intent.originalFilename },
    digest: null, size: null }
  await writeFile(join(root, 'operations', `${intent.operationId}.json`), JSON.stringify(journal))
  await writeFile(join(root, 'tmp', `${intent.operationId}.journal`), JSON.stringify({ ...journal, stage: 'dispatched' }))
  const graph = await inspectMediaGraph(db(), manifest, cwd)
  assert.equal(graph.files.tmp.length, 1)
  await writeFile(join(root, 'tmp', `${intent.operationId}.journal`), JSON.stringify({ ...journal, stage: 'dispatched', key: 'f'.repeat(32) + '.png' }))
  await assert.rejects(() => cleanupMediaFiles(manifest, graph, cwd), /MEDIA_TEMP_IDENTITY_DRIFT/)
  await assert.rejects(() => inspectMediaGraph(db(), manifest, cwd), /MEDIA_TEMP_JOURNAL_DRIFT/)
})
