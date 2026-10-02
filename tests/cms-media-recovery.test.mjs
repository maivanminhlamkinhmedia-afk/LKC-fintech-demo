import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rmdir, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { applyRecovery, inspectRecovery } from '../scripts/cms-media/recover.mjs'

const bytes = Buffer.from('synthetic canonical bytes')
const hash = createHash('sha256').update(bytes).digest('hex')
async function fixture(t, kind = 'upload', stage = 'file-ready', withRow = false) {
  const root = await mkdtemp(join(tmpdir(), 'cms009-recovery-'))
  assert.equal(dirname(resolve(root)), resolve(tmpdir()))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const folder of ['objects', 'tmp', 'operations', 'locks']) await mkdir(join(root, folder))
  const rootIdentity = randomBytes(16).toString('hex'), operationId = randomBytes(16).toString('hex')
  const assetId = randomBytes(16).toString('hex'), key = `${randomBytes(16).toString('hex')}.png`
  const actorId = 'fixture-admin', uploadedById = 'fixture-creator'
  await writeFile(join(root, '.cms-media-root.json'), JSON.stringify({ version: 1, identity: rootIdentity, purpose: 'cms-media' }))
  const operation = { version: 1, kind, id: operationId, rootIdentity, assetId, key, actorId,
    startedAt: new Date().toISOString(), stage, digest: hash, size: bytes.length,
    ...(kind === 'upload' ? { metadata: { mimeType: 'image/png' } } : { uploadedById }) }
  await writeFile(join(root, 'operations', `${operationId}.json`), JSON.stringify(operation))
  await writeFile(join(root, 'objects', key), bytes)
  const row = withRow ? { id: assetId, filename: key, uploadedById, url: `/api/cms/media/${assetId}/content`,
    mimeType: 'image/png', sizeBytes: bytes.length } : null
  const db = { mediaAsset: { async findUnique() { return row } }, article: { async count() { return 0 } } }
  return { db, root, rootIdentity, operationId, operation, expectedAssetId: assetId,
    expectedActorId: actorId, expectedKey: key, confirmation: operationId }
}

test('check-only identifies exact orphan without mutating DB, files or journal', async t => {
  const state = await fixture(t)
  const before = await readFile(join(state.root, 'operations', `${state.operationId}.json`))
  const result = await inspectRecovery(state)
  assert.equal(result.state, 'UPLOAD_ORPHAN')
  assert.equal(result.filePresent, true)
  assert.deepEqual(await readFile(join(state.root, 'operations', `${state.operationId}.json`)), before)
  assert.deepEqual(await readFile(join(state.root, 'objects', state.expectedKey)), bytes)
})
test('apply requires exact identity and removes only proven orphan; repeat is idempotent', async t => {
  const state = await fixture(t)
  await assert.rejects(() => applyRecovery({ ...state, confirmation: 'wrong' }), /RECOVERY_CONFIRMATION_REQUIRED/)
  await assert.rejects(() => applyRecovery({ ...state, expectedKey: `${'f'.repeat(32)}.png` }), /RECOVERY_OPERATION_DRIFT/)
  assert.equal((await applyRecovery(state)).applied, true)
  assert.deepEqual(await readdir(join(state.root, 'objects')), [])
  assert.equal(JSON.parse(await readFile(join(state.root, 'operations', `${state.operationId}.json`))).stage, 'abandoned')
  assert.equal((await applyRecovery(state)).state, 'UPLOAD_ORPHAN')
  assert.equal((await applyRecovery(state)).applied, false)
})
test('delete pending unlinks only after row absence; active asset lock blocks recovery', async t => {
  const state = await fixture(t, 'delete', 'db-deleted')
  await mkdir(join(state.root, 'locks', `asset-${state.expectedAssetId}`))
  await assert.rejects(() => inspectRecovery(state), /RECOVERY_LOCK_PRESENT/)
  await rmdir(join(state.root, 'locks', `asset-${state.expectedAssetId}`))
  assert.equal((await inspectRecovery(state)).state, 'DELETE_FILE_PENDING')
  assert.equal((await applyRecovery(state)).applied, true)
  assert.equal(JSON.parse(await readFile(join(state.root, 'operations', `${state.operationId}.json`))).stage, 'complete')
  assert.equal((await applyRecovery(state)).applied, false)
})
test('temp journal written before rename blocks check-only and apply without consuming evidence', async t => {
  const state = await fixture(t)
  const temporary = join(state.root, 'tmp', `${state.operationId}.journal`)
  const staged = Buffer.from(JSON.stringify({ ...state.operation, stage: 'committed' }))
  await writeFile(temporary, staged)
  const before = await readFile(join(state.root, 'operations', `${state.operationId}.json`))
  await assert.rejects(() => inspectRecovery(state), /RECOVERY_TEMP_JOURNAL_PRESENT/)
  await assert.rejects(() => applyRecovery(state), /RECOVERY_TEMP_JOURNAL_PRESENT/)
  assert.deepEqual(await readFile(temporary), staged)
  assert.deepEqual(await readFile(join(state.root, 'operations', `${state.operationId}.json`)), before)
  assert.deepEqual(await readFile(join(state.root, 'objects', state.expectedKey)), bytes)
})
test('delete file already unlinked before complete journal stage is resumed once', async t => {
  const state = await fixture(t, 'delete', 'db-deleted')
  await unlink(join(state.root, 'objects', state.expectedKey))
  const before = await readFile(join(state.root, 'operations', `${state.operationId}.json`))
  assert.equal((await inspectRecovery(state)).state, 'DELETE_COMPLETE')
  assert.deepEqual(await readFile(join(state.root, 'operations', `${state.operationId}.json`)), before)
  const applied = await applyRecovery(state)
  assert.equal(applied.applied, true)
  assert.equal(JSON.parse(await readFile(join(state.root, 'operations', `${state.operationId}.json`))).stage, 'complete')
  assert.equal((await applyRecovery(state)).applied, false)
})
test('journal/DB boundary matrix retains committed upload bytes and active lock evidence', async t => {
  for (const stage of ['intent', 'dispatched', 'canonical-ready', 'file-ready']) {
    const state = await fixture(t, 'upload', stage)
    const before = await readFile(join(state.root, 'operations', `${state.operationId}.json`))
    assert.equal((await inspectRecovery(state)).state, 'UPLOAD_ORPHAN')
    assert.deepEqual(await readFile(join(state.root, 'operations', `${state.operationId}.json`)), before)
  }
  const committed = await fixture(t, 'upload', 'file-ready')
  committed.db.mediaAsset.findUnique = async () => ({ id: committed.expectedAssetId, uploadedById: committed.expectedActorId,
    filename: committed.expectedKey, url: `/api/cms/media/${committed.expectedAssetId}/content`, sizeBytes: bytes.length, mimeType: 'image/png' })
  assert.equal((await applyRecovery(committed)).applied, false)
  assert.deepEqual(await readFile(join(committed.root, 'objects', committed.expectedKey)), bytes)
  const locked = await fixture(t, 'delete', 'db-deleted')
  await mkdir(join(locked.root, 'locks', `asset-${locked.expectedAssetId}`))
  await assert.rejects(() => applyRecovery(locked), /RECOVERY_LOCK_PRESENT/)
  assert.deepEqual(await readFile(join(locked.root, 'objects', locked.expectedKey)), bytes)
  assert.deepEqual(await readdir(join(locked.root, 'locks')), [`asset-${locked.expectedAssetId}`])
})
test('receipt drift and DB uncertainty refuse destructive recovery', async t => {
  const state = await fixture(t)
  await writeFile(join(state.root, 'objects', state.expectedKey), 'changed')
  await assert.rejects(() => applyRecovery(state), /RECOVERY_FILE_DRIFT/)
  const other = await fixture(t, 'upload', 'file-ready', true)
  await assert.rejects(() => applyRecovery(other), /RECOVERY_DB_DRIFT/)
})
test('unavailable DB and foreign cover evidence retain canonical bytes and journal', async t => {
  const state = await fixture(t)
  const journal = await readFile(join(state.root, 'operations', `${state.operationId}.json`))
  const unavailable = { mediaAsset: { async findUnique() { throw new Error('synthetic DB disconnect') } },
    article: { async count() { return 0 } } }
  await assert.rejects(() => applyRecovery({ ...state, db: unavailable }), /synthetic DB disconnect/)
  const referenced = { mediaAsset: { async findUnique() { return null } }, article: { async count() { return 1 } } }
  await assert.rejects(() => applyRecovery({ ...state, db: referenced }), /RECOVERY_DB_DRIFT/)
  assert.deepEqual(await readFile(join(state.root, 'objects', state.expectedKey)), bytes)
  assert.deepEqual(await readFile(join(state.root, 'operations', `${state.operationId}.json`)), journal)
})
