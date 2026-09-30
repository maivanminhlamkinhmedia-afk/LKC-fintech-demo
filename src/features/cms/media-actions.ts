'use server'

import { createHash, randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { articleCmsScope, canAccessCms } from './access'
import { nextArticleUpdatedAt } from './article-draft'
import { MediaError, mediaFailure, mediaIdOrThrow, nextMediaUpdatedAt,
  normalizeCover, normalizeDelete, normalizeMetadataEdit, normalizeUploadDescriptor,
  type MediaFailure } from './media-contract'
import { freshMediaActor, lockMediaRow, managedAsset, mediaAdmin, mediaDTO, scopedCoverArticle,
  scopedMedia, coverReadOnlyReason, coverSnapshot, type CoverSnapshot, type MediaDTO } from './media-store'
import { openMediaRoot, countPendingMediaIntents, createMediaOperation, advanceMediaOperation,
  receiptForAsset, removeCanonicalFile, withMediaLock, type DeleteOperation, type UploadOperation } from './media-storage'
import { getMediaLibrary } from './media-query'

type Result<T> = { ok: true; data: T; warning?: string } | { ok: false; error: MediaFailure }
const randomId = () => randomBytes(16).toString('hex')
const hashId = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32)
function revalidateMedia(articleId?: string): string | undefined {
  let warning = false
  const paths = ['/creator', '/creator/media', '/creator/articles', ...(articleId ? [
    `/creator/articles/${encodeURIComponent(articleId)}/edit`, `/creator/articles/${encodeURIComponent(articleId)}/media`,
  ] : [])]
  for (const pathname of paths) try { revalidatePath(pathname) } catch { warning = true }
  if (warning) { console.error('CMS_MEDIA_REVALIDATION_FAILED'); return 'Đã lưu; vui lòng tải lại để xem dữ liệu mới.' }
}
async function sessionActor() {
  const session = await getServerSession(authOptions)
  if (!canAccessCms(session?.user)) throw new MediaError('FORBIDDEN')
  return session.user
}
export async function searchMediaLibrary(input: unknown) {
  try { return await getMediaLibrary(await sessionActor(), input) }
  catch (error) { return { ok: false as const, error: mediaFailure(error) } }
}
export async function beginMediaUpload(input: unknown): Promise<Result<{ operationId: string; expiresAt: string }>> {
  try {
    const user = await sessionActor()
    const metadata = normalizeUploadDescriptor(input)
    const root = await openMediaRoot()
    await prisma.$transaction(tx => freshMediaActor(tx, user), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    const operation = await withMediaLock(root, 'actor', hashId(user.id), async () => {
      if (await countPendingMediaIntents(root, user.id) >= 4) throw new MediaError('MEDIA_BUSY')
      const id = randomId(), assetId = randomId()
      const data: UploadOperation = { version: 1, kind: 'upload', id, assetId, actorId: user.id,
        key: `${randomId()}${metadata.mimeType === 'image/png' ? '.png' : '.jpg'}`,
        rootIdentity: root.identity, startedAt: new Date().toISOString(), stage: 'intent', metadata,
        digest: null, size: null, width: null, height: null }
      await createMediaOperation(root, data)
      return data
    })
    return { ok: true, data: { operationId: operation.id,
      expiresAt: new Date(Date.parse(operation.startedAt) + 30 * 60_000).toISOString() } }
  } catch (error) { return { ok: false, error: mediaFailure(error) } }
}
export async function updateMediaMetadata(idInput: unknown, input: unknown): Promise<Result<MediaDTO>> {
  let saved: MediaDTO
  try {
    const user = await sessionActor(), id = mediaIdOrThrow(idInput), data = normalizeMetadataEdit(input)
    saved = await prisma.$transaction(async tx => {
      const actor = await freshMediaActor(tx, user)
      const row = await scopedMedia(tx, actor, id)
      if (!managedAsset(row)) throw new MediaError('MEDIA_NOT_AVAILABLE')
      if (row.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()) throw new MediaError('MEDIA_CONFLICT')
      if (row.altText === data.altText && row.caption === data.caption) return mediaDTO(row, actor)
      const result = await tx.mediaAsset.updateMany({ where: { id, uploadedById: row.uploadedById, updatedAt: data.expectedUpdatedAt,
        filename: row.filename, url: row.url }, data: { altText: data.altText, caption: data.caption, updatedAt: nextMediaUpdatedAt(row.updatedAt) } })
      if (result.count !== 1) throw new MediaError('MEDIA_CONFLICT')
      const persisted = await scopedMedia(tx, actor, id)
      return mediaDTO(persisted, actor)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) { return { ok: false, error: mediaFailure(error) } }
  return { ok: true, data: saved, warning: revalidateMedia() }
}
export async function deleteUnusedMedia(idInput: unknown, input: unknown): Promise<Result<{ id: string; storagePending: boolean }>> {
  let id: string, journal: DeleteOperation, root: Awaited<ReturnType<typeof openMediaRoot>>
  try {
    const user = await sessionActor(); id = mediaIdOrThrow(idInput)
    const { expectedUpdatedAt } = normalizeDelete(input)
    root = await openMediaRoot()
    const row = await prisma.$transaction(async tx => scopedMedia(tx, await freshMediaActor(tx, user), id),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    if (!managedAsset(row) || row.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new MediaError('MEDIA_CONFLICT')
    const receipt = await receiptForAsset(root, id, row.filename, ['file-ready', 'committed'])
    journal = { version: 1, kind: 'delete', id: randomId(), actorId: user.id, uploadedById: row.uploadedById, assetId: id, key: row.filename,
      rootIdentity: root.identity, startedAt: new Date().toISOString(), stage: 'intent', digest: receipt.digest!, size: receipt.size! }
    const outcome = await withMediaLock(root, 'asset', id, async () => {
      await createMediaOperation(root, journal)
      journal.stage = 'dispatched'; await advanceMediaOperation(root, journal)
      try {
        await prisma.$transaction(async tx => {
          const actor = await freshMediaActor(tx, user)
          await lockMediaRow(tx, id)
          const current = await scopedMedia(tx, actor, id)
          if (!managedAsset(current) || current.filename !== journal.key || current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new MediaError('MEDIA_CONFLICT')
          const used = await tx.article.count({ where: { coverMediaId: id } })
          if (used !== 0) throw new MediaError('MEDIA_IN_USE')
          const deleted = await tx.mediaAsset.deleteMany({ where: { id, uploadedById: row.uploadedById, filename: row.filename, updatedAt: expectedUpdatedAt } })
          if (deleted.count !== 1) throw new MediaError('MEDIA_CONFLICT')
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      } catch (error) {
        // A failed transaction may have committed before an ACK was lost. Never unlink on this path.
        if (error instanceof MediaError && ['MEDIA_IN_USE', 'MEDIA_CONFLICT', 'FORBIDDEN', 'MEDIA_NOT_AVAILABLE'].includes(error.code)) {
          journal.stage = 'rejected'; await advanceMediaOperation(root, journal)
          throw error
        }
        throw new MediaError('UNKNOWN_OUTCOME')
      }
      journal.stage = 'db-deleted'; await advanceMediaOperation(root, journal)
      try { await removeCanonicalFile(root, journal.key, journal.size, journal.digest)
        journal.stage = 'complete'; await advanceMediaOperation(root, journal)
        return { id, storagePending: false }
      } catch { return { id, storagePending: true } }
    })
    return { ok: true, data: outcome, warning: outcome.storagePending ? 'Bản ghi đã xóa; tệp chờ dọn qua recovery.' : revalidateMedia() }
  } catch (error) { return { ok: false, error: mediaFailure(error) } }
}
export async function saveArticleCover(articleIdInput: unknown, input: unknown): Promise<Result<CoverSnapshot>> {
  let saved: CoverSnapshot
  try {
    const user = await sessionActor(), id = mediaIdOrThrow(articleIdInput), data = normalizeCover(input)
    const root = await openMediaRoot()
    const write = async () => prisma.$transaction(async tx => {
      const actor = await freshMediaActor(tx, user)
      const article = await scopedCoverArticle(tx, actor, id)
      const reason = coverReadOnlyReason(actor, article)
      if (reason) throw new MediaError(reason)
      if (article.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()) throw new MediaError('EDIT_CONFLICT')
      if (data.mediaId !== null) {
        await lockMediaRow(tx, data.mediaId)
        const target = await tx.mediaAsset.findUnique({ where: { id: data.mediaId } })
        if (!target) throw new MediaError('MEDIA_NOT_AVAILABLE')
        if (target.updatedAt.getTime() !== data.expectedMediaUpdatedAt!.getTime()) throw new MediaError('MEDIA_CONFLICT')
        if (article.coverMediaId !== data.mediaId) {
          if (!managedAsset(target) || !(mediaAdmin(actor) || target.uploadedById === actor.id)) throw new MediaError('MEDIA_NOT_AVAILABLE')
          await receiptForAsset(root, target.id, target.filename, ['file-ready', 'committed'])
        }
      }
      if (article.coverMediaId === data.mediaId) return coverSnapshot(tx, actor, article)
      const claimed = await tx.article.updateMany({ where: { AND: [{ id }, articleCmsScope(actor), { authorId: article.authorId,
        status: { in: ['DRAFT', 'CHANGES_REQUESTED'] }, editorSchemaVersion: 1, updatedAt: data.expectedUpdatedAt }] },
        data: { coverMediaId: data.mediaId, updatedAt: nextArticleUpdatedAt(article.updatedAt) } })
      if (claimed.count !== 1) throw new MediaError('EDIT_CONFLICT')
      return coverSnapshot(tx, actor, await scopedCoverArticle(tx, actor, id))
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    saved = data.mediaId ? await withMediaLock(root, 'asset', data.mediaId, write) : await write()
  } catch (error) { return { ok: false, error: mediaFailure(error) } }
  return { ok: true, data: saved, warning: revalidateMedia(saved.id) }
}
