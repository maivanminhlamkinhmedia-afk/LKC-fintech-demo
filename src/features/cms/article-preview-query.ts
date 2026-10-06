import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { articleCmsScope, canAccessCms, type CMSUser } from './access'
import { parseArticleId } from './article-draft'
import { classificationTerms } from './article-classification-store'
import { EditorDocumentError, validateStoredEditorDocument } from './editor-schema'
import { MediaError } from './media-contract'
import { managedAsset, readableMedia } from './media-store'
import { safeSourceUrl } from './article-sources'
import type { ArticlePreviewData, PreviewResult, PreviewTerm } from './article-preview'

const articleSelect = {
  id: true, authorId: true, title: true, excerpt: true, articleType: true, status: true, updatedAt: true,
  contentJson: true, editorSchemaVersion: true, categoryId: true, coverMediaId: true,
} as const satisfies Prisma.ArticleSelect

function date(value: Date | null): string | null { return value === null ? null : value.toISOString() }
function term(value: { name: string; isActive: boolean | null }): PreviewTerm {
  return { name: value.name, isActive: value.isActive }
}

// The session guard runs in the page; this read checks the current DB actor again.
// The scoped parent is resolved before any child lookup in one read transaction.
export async function getArticlePreview(sessionActor: CMSUser, input: unknown): Promise<PreviewResult> {
  if (!canAccessCms(sessionActor)) return { ok: false, error: 'FORBIDDEN' }
  let id: string
  try { id = parseArticleId(input) } catch { return { ok: false, error: 'NOT_FOUND' } }
  try {
    const data = await prisma.$transaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: sessionActor.id }, select: { id: true, role: true, status: true } })
      if (!actor || actor.status !== 'ACTIVE' || actor.role !== sessionActor.role || !canAccessCms(actor)) return 'FORBIDDEN' as const
      const article = await tx.article.findFirst({ where: { AND: [{ id }, articleCmsScope(actor)] }, select: articleSelect })
      if (!article) return 'NOT_FOUND' as const
      const document = validateStoredEditorDocument(article.contentJson, article.editorSchemaVersion)
      const profile = await tx.authorProfile.findUnique({
        where: { userId: article.authorId }, select: { displayName: true, jobTitle: true, isPublic: true },
      })
      const topics = await tx.articleTopicMapping.findMany({ where: { articleId: id }, select: { topicId: true } })
      const tags = await tx.articleTagMapping.findMany({ where: { articleId: id }, select: { tagId: true } })
      const instruments = await tx.articleInstrument.findMany({ where: { articleId: id }, select: { instrumentId: true, isPrimary: true } })
      const [categories, topicTerms, tagTerms, instrumentTerms] = await Promise.all([
        classificationTerms(tx, 'category', article.categoryId ? [article.categoryId] : []),
        classificationTerms(tx, 'topic', topics.map(row => row.topicId)),
        classificationTerms(tx, 'tag', tags.map(row => row.tagId)),
        classificationTerms(tx, 'instrument', instruments.map(row => row.instrumentId)),
      ])
      if (categories.length !== (article.categoryId ? 1 : 0) || topicTerms.length !== topics.length
        || tagTerms.length !== tags.length || instrumentTerms.length !== instruments.length) throw new Error('CMS_PREVIEW_RELATION_INVALID')
      const sourceRows = await tx.sourceReference.findMany({ where: { articleId: id },
        select: { title: true, sourceType: true, publisher: true, url: true, publishedAt: true, accessedAt: true, dataTimestamp: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
      let cover: ArticlePreviewData['cover'] = null
      if (article.coverMediaId) {
        try {
          const asset = await readableMedia(tx, actor, article.coverMediaId)
          if (managedAsset(asset)) cover = {
            src: `/api/cms/media/${encodeURIComponent(asset.id)}/content`,
            alt: asset.altText || article.title, caption: asset.caption,
          }
        } catch (error) {
          if (!(error instanceof MediaError) || error.code !== 'MEDIA_NOT_AVAILABLE') throw error
        }
      }
      const result: ArticlePreviewData = {
        id, title: article.title, excerpt: article.excerpt, articleType: article.articleType,
        status: article.status, updatedAt: article.updatedAt.toISOString(), contentJson: document.contentJson,
        author: profile?.isPublic ? { displayName: profile.displayName, jobTitle: profile.jobTitle } : null,
        cover, category: categories[0] ? term(categories[0]) : null,
        topics: topicTerms.map(term), tags: tagTerms.map(term),
        instruments: instrumentTerms.map(value => ({ ...term(value), symbol: value.symbol!,
          isPrimary: instruments.find(row => row.instrumentId === value.id)!.isPrimary })),
        sources: sourceRows.map(row => ({ title: row.title, sourceType: row.sourceType, publisher: row.publisher,
          safeUrl: safeSourceUrl(row.url), publishedAt: date(row.publishedAt), accessedAt: date(row.accessedAt),
          dataTimestamp: date(row.dataTimestamp) })),
      }
      return result
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return typeof data === 'string' ? { ok: false, error: data } : { ok: true, data }
  } catch (error) {
    if (error instanceof EditorDocumentError) return { ok: false, error: 'UNSUPPORTED_DOCUMENT' }
    console.error('CMS_PREVIEW_READ_FAILED')
    return { ok: false, error: 'INTERNAL_ERROR' }
  }
}
