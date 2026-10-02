import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { canAccessCms, type CMSUser } from './access'
import { MediaError, mediaFailure, mediaSearch, type MediaFailure } from './media-contract'
import { coverSnapshot, freshMediaActor, mediaAdmin, mediaDTO, scopedCoverArticle, type CoverSnapshot, type MediaDTO } from './media-store'

export type MediaListResult = { ok: true; data: { items: MediaDTO[]; page: number; totalPages: number; total: number; q: string } } | { ok: false; error: MediaFailure }
export type CoverResult = { ok: true; data: CoverSnapshot; warning?: string } | { ok: false; error: MediaFailure }
export async function getMediaLibrary(sessionActor: CMSUser, search: unknown): Promise<MediaListResult> {
  try {
    if (!canAccessCms(sessionActor)) throw new MediaError('FORBIDDEN')
    const { q, page } = mediaSearch(search)
    const data = await prisma.$transaction(async tx => {
      const actor = await freshMediaActor(tx, sessionActor)
      const where = { AND: [mediaAdmin(actor) ? {} : { uploadedById: actor.id }, q ? { OR: [
        { originalFilename: { contains: q } }, { altText: { contains: q } }, { caption: { contains: q } },
      ] } : {}] }
      const total = await tx.mediaAsset.count({ where })
      const items = await tx.mediaAsset.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * 20, take: 20 })
      return { items: items.map(row => mediaDTO(row, actor)), page, totalPages: Math.max(1, Math.ceil(total / 20)), total, q }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return { ok: true, data }
  } catch (error) { return { ok: false, error: mediaFailure(error) } }
}
export async function getArticleCover(sessionActor: CMSUser, articleId: unknown): Promise<CoverResult> {
  try {
    if (!canAccessCms(sessionActor)) throw new MediaError('FORBIDDEN')
    const data = await prisma.$transaction(async tx => {
      const actor = await freshMediaActor(tx, sessionActor)
      const article = await scopedCoverArticle(tx, actor, articleId)
      return coverSnapshot(tx, actor, article)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return { ok: true, data }
  } catch (error) { return { ok: false, error: mediaFailure(error) } }
}
