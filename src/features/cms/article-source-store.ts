import 'server-only'

import type { Prisma } from '@prisma/client'
import { articleCmsScope, canAccessCms, type CMSUser } from './access'
import { canEditArticleDraft } from './article-draft'
import { validateStoredEditorDocument } from './editor-schema'
import { ArticleSourceError, parseSourceTimestamp, safeSourceUrl, type ArticleSourcesSnapshot, type SourceItem } from './article-sources'

export const sourceArticleSelect = {
  id: true, authorId: true, title: true, status: true, updatedAt: true, contentJson: true, editorSchemaVersion: true,
} as const satisfies Prisma.ArticleSelect
type SourceArticle = Prisma.ArticleGetPayload<{ select: typeof sourceArticleSelect }>
export const sourceSelect = {
  id: true, sourceType: true, title: true, publisher: true, url: true,
  publishedAt: true, accessedAt: true, dataTimestamp: true, note: true,
  createdById: true, createdAt: true, updatedAt: true,
} as const satisfies Prisma.SourceReferenceSelect

export async function currentSourceActor(tx: Prisma.TransactionClient, sessionActor: CMSUser): Promise<CMSUser> {
  const actor = await tx.user.findUnique({ where: { id: sessionActor.id }, select: { id: true, role: true, status: true } })
  if (!actor || actor.status !== 'ACTIVE' || actor.role !== sessionActor.role || !canAccessCms(actor)) {
    throw new ArticleSourceError('FORBIDDEN')
  }
  return actor
}

export async function scopedSourceArticle(tx: Prisma.TransactionClient, actor: CMSUser, id: string): Promise<SourceArticle> {
  const article = await tx.article.findFirst({ where: { AND: [{ id }, articleCmsScope(actor)] }, select: sourceArticleSelect })
  if (!article) throw new ArticleSourceError('NOT_FOUND')
  return article
}

export function sourceReadOnlyReason(actor: CMSUser, article: SourceArticle) {
  if (!canEditArticleDraft(actor, article)) return 'NOT_EDITABLE' as const
  try { validateStoredEditorDocument(article.contentJson, article.editorSchemaVersion) }
  catch { return 'UNSUPPORTED_DOCUMENT' as const }
  return null
}

function storedDate(value: Date): string {
  // Malformed legacy dates must fail safely on the server, before the client
  // timezone codec can encounter them. This is not a user validation failure.
  try { return parseSourceTimestamp(value.toISOString()).toISOString() }
  catch { throw new Error('CMS_SOURCE_STORED_DATE_INVALID') }
}

// The parent and children are always read inside the caller's transaction.
// Select and construct DTO fields explicitly: never send contentJson or Prisma objects to the panel.
export async function sourceSnapshot(tx: Prisma.TransactionClient, actor: CMSUser, article: SourceArticle): Promise<ArticleSourcesSnapshot> {
  const rows = await tx.sourceReference.findMany({
    where: { articleId: article.id }, select: sourceSelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  const sources: SourceItem[] = rows.map(row => ({
    id: row.id, sourceType: row.sourceType, title: row.title, publisher: row.publisher, url: row.url,
    publishedAt: row.publishedAt === null ? null : storedDate(row.publishedAt), accessedAt: row.accessedAt === null ? null : storedDate(row.accessedAt),
    dataTimestamp: row.dataTimestamp === null ? null : storedDate(row.dataTimestamp), note: row.note,
    createdById: row.createdById, createdAt: storedDate(row.createdAt), updatedAt: storedDate(row.updatedAt),
    safeUrl: safeSourceUrl(row.url),
  }))
  const readOnlyReason = sourceReadOnlyReason(actor, article)
  return { id: article.id, title: article.title, status: article.status, updatedAt: storedDate(article.updatedAt),
    canMutate: readOnlyReason === null, readOnlyReason, sources }
}
