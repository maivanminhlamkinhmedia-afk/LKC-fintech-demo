import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { canAccessCms, type CMSUser } from './access'
import { ArticleClassificationError, mapClassificationError, parseClassificationId, type ClassificationResult } from './article-classification'
import { currentClassificationActor, scopedClassificationArticle, classificationSnapshot } from './article-classification-store'

export async function getArticleClassification(sessionActor: CMSUser, articleId: unknown): Promise<ClassificationResult> {
  try {
    if (!canAccessCms(sessionActor)) throw new ArticleClassificationError('FORBIDDEN')
    const id = parseClassificationId(articleId)
    const data = await prisma.$transaction(async tx => {
      const actor = await currentClassificationActor(tx, sessionActor)
      const article = await scopedClassificationArticle(tx, actor, id)
      return classificationSnapshot(tx, actor, article)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return { ok: true, data }
  } catch (error) {
    const failure = mapClassificationError(error)
    if (failure.code === 'INTERNAL_ERROR') console.error('CMS_CLASSIFICATION_READ_FAILED')
    return { ok: false, error: failure }
  }
}
