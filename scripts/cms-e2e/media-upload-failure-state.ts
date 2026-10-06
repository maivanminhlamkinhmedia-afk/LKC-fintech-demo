import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const UPLOAD_STAGES = Object.freeze([
  'intent', 'dispatched', 'canonical-ready', 'file-ready', 'committed', 'abandoned', 'unreadable',
])

type Intent = { operationId: string; assetId: string; actorId: string; key: string }
type Db = { mediaAsset: { count(args: { where: { id: string; uploadedById: string } }): Promise<number> } }

async function fileState(path: string) {
  try {
    const info = await lstat(path)
    return info.isFile() && !info.isSymbolicLink() ? 'present' : 'unknown'
  } catch (error) { return (error as { code?: string })?.code === 'ENOENT' ? 'absent' : 'unknown' }
}

// Read only the already-reserved exact operation. Do not recover or retry here.
export async function mediaUploadFailureState(db: Db, root: string, intent: Intent) {
  let journalStage = 'unreadable'
  try {
    const raw = JSON.parse(await readFile(join(root, 'operations', `${intent.operationId}.json`), 'utf8'))
    if (raw?.kind === 'upload' && raw.id === intent.operationId && raw.assetId === intent.assetId
      && raw.actorId === intent.actorId && raw.key === intent.key && UPLOAD_STAGES.includes(raw.stage)) {
      journalStage = raw.stage
    }
  } catch { /* An unreadable receipt is itself a bounded observation. */ }
  let rowPresent = 'unknown'
  try {
    const count = await db.mediaAsset.count({ where: { id: intent.assetId, uploadedById: intent.actorId } })
    if (count === 0 || count === 1) rowPresent = count === 1 ? 'present' : 'absent'
  } catch { /* Do not replace the original upload assertion with a probe error. */ }
  return {
    journalStage, rowPresent,
    objectPresent: await fileState(join(root, 'objects', intent.key)),
    tempJournalPresent: await fileState(join(root, 'tmp', `${intent.operationId}.journal`)),
  }
}
