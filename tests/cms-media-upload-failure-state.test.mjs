import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { mediaUploadFailureState } from '../scripts/cms-e2e/media-upload-failure-state.ts'

const intent = { operationId: 'a'.repeat(32), assetId: 'b'.repeat(32), actorId: 'fixture-creator', key: `${'c'.repeat(32)}.png` }
test('failure snapshot distinguishes durable journal, DB ACK and exact file evidence without leaking IDs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cms009-failure-state-'))
  assert.equal(dirname(resolve(root)), resolve(tmpdir()))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const folder of ['operations', 'objects', 'tmp']) await mkdir(join(root, folder))
  const operationFile = join(root, 'operations', `${intent.operationId}.json`)
  const journal = stage => writeFile(operationFile, JSON.stringify({ ...intent, id: intent.operationId, kind: 'upload', stage }))
  let count = 0
  const db = { mediaAsset: { async count({ where }) {
    assert.deepEqual(where, { id: intent.assetId, uploadedById: intent.actorId })
    return count
  } } }
  await journal('dispatched')
  assert.deepEqual(await mediaUploadFailureState(db, root, intent), {
    journalStage: 'dispatched', rowPresent: 'absent', objectPresent: 'absent', tempJournalPresent: 'absent',
  })
  await journal('file-ready'); count = 1
  await writeFile(join(root, 'objects', intent.key), 'synthetic')
  await writeFile(join(root, 'tmp', `${intent.operationId}.journal`), 'synthetic')
  const acknowledged = await mediaUploadFailureState(db, root, intent)
  assert.deepEqual(acknowledged, {
    journalStage: 'file-ready', rowPresent: 'present', objectPresent: 'present', tempJournalPresent: 'present',
  })
  assert.equal(JSON.stringify(acknowledged).includes(intent.operationId), false)
  assert.equal(JSON.stringify(acknowledged).includes(intent.assetId), false)
  await writeFile(operationFile, JSON.stringify({ ...intent, id: intent.operationId, kind: 'upload', stage: 'committed', assetId: 'other' }))
  assert.equal((await mediaUploadFailureState(db, root, intent)).journalStage, 'unreadable')
})
