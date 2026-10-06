import 'server-only'
import { Prisma, type MediaAsset } from '@prisma/client'
import { hasPermission } from '@/lib/roles'
import { articleCmsScope, canAccessCms, type CMSUser } from './access'
import { canEditArticleDraft } from './article-draft'
import { validateStoredEditorDocument } from './editor-schema'
import { MediaError, mediaIdOrThrow, MEDIA_LIMITS } from './media-contract'

export type MediaActor = CMSUser
export type MediaDTO = { id: string; originalFilename: string; mimeType: string; sizeBytes: number; width: number | null; height: number | null;
  altText: string | null; caption: string | null; updatedAt: string; createdAt: string; contentUrl: string | null; managed: boolean; uploadedByMe: boolean }
export function mediaAdmin(actor: CMSUser) { return hasPermission(actor.role, 'cms:admin') }
export function managedAsset(row: MediaAsset) {
  return /^[a-f0-9]{32}$/u.test(row.id) && /^[a-f0-9]{32}\.(png|jpg)$/u.test(row.filename)
    && row.url === `/api/cms/media/${row.id}/content`
    && ((row.mimeType === 'image/png' && row.filename.endsWith('.png')) || (row.mimeType === 'image/jpeg' && row.filename.endsWith('.jpg')))
    && Number.isInteger(row.width) && Number.isInteger(row.height) && row.width! > 0 && row.height! > 0
    && row.width! <= MEDIA_LIMITS.dimension && row.height! <= MEDIA_LIMITS.dimension
    && row.width! * row.height! <= MEDIA_LIMITS.pixels && row.sizeBytes > 0 && row.sizeBytes <= MEDIA_LIMITS.bytes
}
export function mediaDTO(row: MediaAsset, actor: CMSUser): MediaDTO {
  const managed = managedAsset(row)
  return { id: row.id, originalFilename: row.originalFilename, mimeType: row.mimeType, sizeBytes: row.sizeBytes,
    width: row.width, height: row.height, altText: row.altText, caption: row.caption,
    updatedAt: row.updatedAt.toISOString(), createdAt: row.createdAt.toISOString(),
    contentUrl: managed ? `/api/cms/media/${encodeURIComponent(row.id)}/content` : null,
    managed, uploadedByMe: row.uploadedById === actor.id }
}
export async function freshMediaActor(tx: Prisma.TransactionClient, sessionActor: CMSUser): Promise<CMSUser> {
  if (!canAccessCms(sessionActor)) throw new MediaError('FORBIDDEN')
  const actor = await tx.user.findUnique({ where: { id: sessionActor.id }, select: { id: true, role: true, status: true } })
  if (!actor || actor.status !== 'ACTIVE' || actor.role !== sessionActor.role || !canAccessCms(actor)) throw new MediaError('FORBIDDEN')
  return actor
}
export async function scopedMedia(tx: Prisma.TransactionClient, actor: CMSUser, input: unknown): Promise<MediaAsset> {
  const id = mediaIdOrThrow(input)
  const row = await tx.mediaAsset.findFirst({ where: { id, ...(mediaAdmin(actor) ? {} : { uploadedById: actor.id }) } })
  if (!row) throw new MediaError('MEDIA_NOT_AVAILABLE')
  return row
}
export async function readableMedia(tx: Prisma.TransactionClient, actor: CMSUser, input: unknown): Promise<MediaAsset> {
  const id = mediaIdOrThrow(input)
  const row = await tx.mediaAsset.findUnique({ where: { id } })
  if (!row) throw new MediaError('MEDIA_NOT_AVAILABLE')
  if (mediaAdmin(actor) || row.uploadedById === actor.id) return row
  const cover = await tx.article.findFirst({ where: { AND: [{ coverMediaId: id }, articleCmsScope(actor)] }, select: { id: true } })
  if (!cover) throw new MediaError('MEDIA_NOT_AVAILABLE')
  return row
}
export async function lockMediaRow(tx: Prisma.TransactionClient, id: string) {
  // The same lock order is used by cover attach and deletion. Exact static SQL; no client SQL fragments.
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM MediaAsset WHERE id = ${id} FOR UPDATE`)
  if (rows.length !== 1) throw new MediaError('MEDIA_NOT_AVAILABLE')
}
export const coverArticleSelect = { id: true, title: true, authorId: true, status: true, updatedAt: true,
  editorSchemaVersion: true, contentJson: true, coverMediaId: true } as const satisfies Prisma.ArticleSelect
export type CoverArticle = Prisma.ArticleGetPayload<{ select: typeof coverArticleSelect }>
export async function scopedCoverArticle(tx: Prisma.TransactionClient, actor: CMSUser, input: unknown): Promise<CoverArticle> {
  const id = mediaIdOrThrow(input)
  const article = await tx.article.findFirst({ where: { AND: [{ id }, articleCmsScope(actor)] }, select: coverArticleSelect })
  if (!article) throw new MediaError('NOT_FOUND')
  return article
}
export function coverReadOnlyReason(actor: CMSUser, article: CoverArticle) {
  if (!canEditArticleDraft(actor, article)) return 'NOT_EDITABLE' as const
  try { validateStoredEditorDocument(article.contentJson, article.editorSchemaVersion) }
  catch { return 'UNSUPPORTED_DOCUMENT' as const }
  return null
}
export type CoverSnapshot = { id: string; title: string; status: string; updatedAt: string; cover: MediaDTO | null;
  canMutate: boolean; readOnlyReason: 'NOT_EDITABLE' | 'UNSUPPORTED_DOCUMENT' | null }
export async function coverSnapshot(tx: Prisma.TransactionClient, actor: CMSUser, article: CoverArticle): Promise<CoverSnapshot> {
  const cover = article.coverMediaId ? await tx.mediaAsset.findUnique({ where: { id: article.coverMediaId } }) : null
  return { id: article.id, title: article.title, status: article.status, updatedAt: article.updatedAt.toISOString(),
    cover: cover ? mediaDTO(cover, actor) : null, canMutate: coverReadOnlyReason(actor, article) === null,
    readOnlyReason: coverReadOnlyReason(actor, article) }
}
