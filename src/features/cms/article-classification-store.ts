import 'server-only'

import type { Prisma } from '@prisma/client'
import { articleCmsScope, canAccessCms, type CMSUser } from './access'
import { canEditArticleDraft } from './article-draft'
import { validateStoredEditorDocument } from './editor-schema'
import { ArticleClassificationError, CLASSIFICATION_LIMITS, classificationTimestamp, parseClassificationId,
  type ArticleClassificationSnapshot, type ClassificationSelection } from './article-classification'
import type { TaxonomyKind, TaxonomyOption } from './taxonomy'

export const classificationArticleSelect = {
  id: true, authorId: true, title: true, status: true, updatedAt: true, contentJson: true, editorSchemaVersion: true, categoryId: true,
} as const satisfies Prisma.ArticleSelect
export type ClassificationArticle = Prisma.ArticleGetPayload<{ select: typeof classificationArticleSelect }>
const termSelect = { id: true, name: true, slug: true, isActive: true } as const
const tagSelect = { id: true, name: true, slug: true } as const
const instrumentSelect = { id: true, name: true, canonicalKey: true, symbol: true, isActive: true } as const

export async function currentClassificationActor(tx: Prisma.TransactionClient, sessionActor: CMSUser): Promise<CMSUser> {
  const actor = await tx.user.findUnique({ where: { id: sessionActor.id }, select: { id: true, role: true, status: true } })
  if (!actor || actor.status !== 'ACTIVE' || actor.role !== sessionActor.role || !canAccessCms(actor)) throw new ArticleClassificationError('FORBIDDEN')
  return actor
}
export async function scopedClassificationArticle(tx: Prisma.TransactionClient, actor: CMSUser, id: string): Promise<ClassificationArticle> {
  const article = await tx.article.findFirst({ where: { AND: [{ id }, articleCmsScope(actor)] }, select: classificationArticleSelect })
  if (!article) throw new ArticleClassificationError('NOT_FOUND')
  return article
}
export function classificationReadOnlyReason(actor: CMSUser, article: ClassificationArticle) {
  if (!canEditArticleDraft(actor, article)) return 'NOT_EDITABLE' as const
  try { validateStoredEditorDocument(article.contentJson, article.editorSchemaVersion) }
  catch { return 'UNSUPPORTED_DOCUMENT' as const }
  return null
}
type StoredOption = { id: string; name: string; slug?: string; canonicalKey?: string; symbol?: string; isActive?: boolean }
function option(kind: TaxonomyKind, row: StoredOption): TaxonomyOption {
  // Legacy identity is displayed verbatim, never passed through create rules or re-keyed.
  try { parseClassificationId(row.id) } catch { throw new ArticleClassificationError('INTERNAL_ERROR') }
  if (typeof row.name !== 'string' || (kind === 'instrument' ? typeof row.canonicalKey !== 'string' || typeof row.symbol !== 'string' : typeof row.slug !== 'string')
    || (kind !== 'tag' && typeof row.isActive !== 'boolean')) throw new ArticleClassificationError('INTERNAL_ERROR')
  return { id: row.id, kind, name: row.name, slug: kind === 'instrument' ? null : row.slug!,
    canonicalKey: kind === 'instrument' ? row.canonicalKey! : null, symbol: kind === 'instrument' ? row.symbol! : null,
    isActive: kind === 'tag' ? null : row.isActive! }
}
export async function classificationTerms(tx: Prisma.TransactionClient, kind: TaxonomyKind, ids: string[]): Promise<TaxonomyOption[]> {
  if (ids.length === 0) return []
  const where = { id: { in: ids } }, orderBy = [{ name: 'asc' as const }, { id: 'asc' as const }]
  // Static delegate branches: never select an arbitrary Prisma model from user input.
  const rows = kind === 'category' ? await tx.articleCategory.findMany({ where, select: termSelect, orderBy })
    : kind === 'topic' ? await tx.articleTopic.findMany({ where, select: termSelect, orderBy })
      : kind === 'tag' ? await tx.articleTag.findMany({ where, select: tagSelect, orderBy })
        : await tx.financialInstrument.findMany({ where, select: instrumentSelect, orderBy })
  return rows.map(row => option(kind, row))
}
export async function classificationSnapshot(tx: Prisma.TransactionClient, actor: CMSUser, article: ClassificationArticle): Promise<ArticleClassificationSnapshot> {
  const topics = await tx.articleTopicMapping.findMany({ where: { articleId: article.id }, select: { topicId: true } })
  const tags = await tx.articleTagMapping.findMany({ where: { articleId: article.id }, select: { tagId: true } })
  const instruments = await tx.articleInstrument.findMany({ where: { articleId: article.id }, select: { instrumentId: true, isPrimary: true } })
  const categoryRows = await classificationTerms(tx, 'category', article.categoryId === null ? [] : [article.categoryId])
  const topicRows = await classificationTerms(tx, 'topic', topics.map(item => item.topicId))
  const tagRows = await classificationTerms(tx, 'tag', tags.map(item => item.tagId))
  const instrumentRows = await classificationTerms(tx, 'instrument', instruments.map(item => item.instrumentId))
  if (categoryRows.length !== (article.categoryId === null ? 0 : 1) || topicRows.length !== topics.length || tagRows.length !== tags.length
    || instrumentRows.length !== instruments.length || instruments.some(item => typeof item.isPrimary !== 'boolean')) throw new ArticleClassificationError('INTERNAL_ERROR')
  const warnings: string[] = []
  if (topics.length > CLASSIFICATION_LIMITS.topicIds || tags.length > CLASSIFICATION_LIMITS.tagIds || instruments.length > CLASSIFICATION_LIMITS.instrumentIds) {
    warnings.push('Lựa chọn cũ vượt giới hạn. Hãy gỡ bớt để còn tối đa 5 chủ đề, 10 thẻ và 10 công cụ trước khi lưu.')
  }
  if (instruments.filter(item => item.isPrimary).length > 1) warnings.push('Dữ liệu cũ có nhiều công cụ chính. Hãy chọn rõ một công cụ chính hoặc Không chọn trước khi lưu.')
  let updatedAt: string
  try { updatedAt = classificationTimestamp(article.updatedAt.toISOString()).toISOString() }
  catch { throw new ArticleClassificationError('INTERNAL_ERROR') }
  if (typeof article.title !== 'string') throw new ArticleClassificationError('INTERNAL_ERROR')
  const reason = classificationReadOnlyReason(actor, article)
  return { id: article.id, title: article.title, status: article.status, updatedAt, canMutate: reason === null, readOnlyReason: reason,
    category: categoryRows[0] ?? null, topics: topicRows, tags: tagRows,
    instruments: instrumentRows.map(item => ({ ...item, isPrimary: instruments.find(row => row.instrumentId === item.id)!.isPrimary })), warnings }
}
export async function validateClassificationTargets(tx: Prisma.TransactionClient, desired: ClassificationSelection, current: ArticleClassificationSnapshot) {
  const groups: [TaxonomyKind, string[], string[]][] = [
    ['category', desired.categoryId === null ? [] : [desired.categoryId], current.category === null ? [] : [current.category.id]],
    ['topic', desired.topicIds, current.topics.map(item => item.id)], ['tag', desired.tagIds, current.tags.map(item => item.id)],
    ['instrument', desired.instrumentIds, current.instruments.map(item => item.id)],
  ]
  for (const [kind, ids, retained] of groups) {
    const rows = await classificationTerms(tx, kind, ids)
    if (rows.length !== ids.length || rows.some(row => !ids.includes(row.id) || (row.isActive === false && !retained.includes(row.id)))) {
      throw new ArticleClassificationError('INVALID_SELECTION')
    }
  }
}
