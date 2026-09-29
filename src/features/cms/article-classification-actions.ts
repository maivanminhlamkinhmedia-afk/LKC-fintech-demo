'use server'

import { Prisma } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { articleCmsScope, canAccessCms } from './access'
import { nextArticleUpdatedAt } from './article-draft'
import { ArticleClassificationError, mapClassificationError, normalizeClassificationInput, parseClassificationId,
  sameClassification, selectionFromSnapshot, type ClassificationResult, type ArticleClassificationSnapshot } from './article-classification'
import { currentClassificationActor, scopedClassificationArticle, classificationReadOnlyReason, classificationSnapshot,
  validateClassificationTargets } from './article-classification-store'

export async function updateArticleClassification(articleId: unknown, input: unknown): Promise<ClassificationResult> {
  let data: ArticleClassificationSnapshot
  try {
    const session = await getServerSession(authOptions)
    const user = session?.user
    if (!canAccessCms(user)) throw new ArticleClassificationError('FORBIDDEN')
    const id = parseClassificationId(articleId)
    const { selection, expectedUpdatedAt } = normalizeClassificationInput(input)
    data = await prisma.$transaction(async tx => {
      const actor = await currentClassificationActor(tx, user)
      const article = await scopedClassificationArticle(tx, actor, id)
      const reason = classificationReadOnlyReason(actor, article)
      if (reason) throw new ArticleClassificationError(reason)
      if (article.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new ArticleClassificationError('EDIT_CONFLICT')
      const current = await classificationSnapshot(tx, actor, article)
      await validateClassificationTargets(tx, selection, current)
      if (current.instruments.filter(item => item.isPrimary).length <= 1 && sameClassification(selection, selectionFromSnapshot(current))) return current
      const claimed = await tx.article.updateMany({
        where: { AND: [{ id }, articleCmsScope(actor), { status: { in: ['DRAFT', 'CHANGES_REQUESTED'] } },
          { updatedAt: expectedUpdatedAt }, { authorId: article.authorId, status: article.status, editorSchemaVersion: 1 }] },
        data: { categoryId: selection.categoryId, updatedAt: nextArticleUpdatedAt(article.updatedAt) },
      })
      if (claimed.count !== 1) throw new ArticleClassificationError('EDIT_CONFLICT')
      // Diff exact composite keys. No cascade, bulk replacement, or mutations outside this parent.
      for (const item of current.topics) if (!selection.topicIds.includes(item.id)) {
        const deleted = await tx.articleTopicMapping.deleteMany({ where: { articleId: id, topicId: item.id } })
        if (deleted.count !== 1) throw new ArticleClassificationError('EDIT_CONFLICT')
      }
      for (const topicId of selection.topicIds) if (!current.topics.some(item => item.id === topicId)) await tx.articleTopicMapping.create({ data: { articleId: id, topicId } })
      for (const item of current.tags) if (!selection.tagIds.includes(item.id)) {
        const deleted = await tx.articleTagMapping.deleteMany({ where: { articleId: id, tagId: item.id } })
        if (deleted.count !== 1) throw new ArticleClassificationError('EDIT_CONFLICT')
      }
      for (const tagId of selection.tagIds) if (!current.tags.some(item => item.id === tagId)) await tx.articleTagMapping.create({ data: { articleId: id, tagId } })
      // Clear previous primaries before promoting the desired one, including malformed legacy sets.
      for (const item of current.instruments) {
        if (!selection.instrumentIds.includes(item.id)) {
          const deleted = await tx.articleInstrument.deleteMany({ where: { articleId: id, instrumentId: item.id } })
          if (deleted.count !== 1) throw new ArticleClassificationError('EDIT_CONFLICT')
        } else if (item.isPrimary && item.id !== selection.primaryInstrumentId) {
          const changed = await tx.articleInstrument.updateMany({ where: { articleId: id, instrumentId: item.id }, data: { isPrimary: false } })
          if (changed.count !== 1) throw new ArticleClassificationError('EDIT_CONFLICT')
        }
      }
      for (const instrumentId of selection.instrumentIds) {
        const previous = current.instruments.find(item => item.id === instrumentId)
        const isPrimary = instrumentId === selection.primaryInstrumentId
        if (!previous) await tx.articleInstrument.create({ data: { articleId: id, instrumentId, isPrimary } })
        else if (isPrimary && !previous.isPrimary) {
          const changed = await tx.articleInstrument.updateMany({ where: { articleId: id, instrumentId }, data: { isPrimary: true } })
          if (changed.count !== 1) throw new ArticleClassificationError('EDIT_CONFLICT')
        }
      }
      const persisted = await scopedClassificationArticle(tx, actor, id)
      if (persisted.updatedAt.getTime() <= article.updatedAt.getTime()) throw new ArticleClassificationError('EDIT_CONFLICT')
      return classificationSnapshot(tx, actor, persisted)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) {
    const failure = mapClassificationError(error)
    if (failure.code === 'INTERNAL_ERROR') console.error('CMS_CLASSIFICATION_WRITE_FAILED')
    return { ok: false, error: failure }
  }
  let warning = false
  for (const path of ['/creator', '/creator/articles', `/creator/articles/${encodeURIComponent(data.id)}/edit`,
    `/creator/articles/${encodeURIComponent(data.id)}/sources`, `/creator/articles/${encodeURIComponent(data.id)}/classification`]) {
    try { revalidatePath(path) } catch { warning = true }
  }
  if (warning) {
    console.error('CMS_CLASSIFICATION_REVALIDATION_FAILED')
    return { ok: true, data, warning: 'Phân loại đã được lưu. Vui lòng tải lại danh sách để xem dữ liệu mới.' }
  }
  return { ok: true, data }
}
