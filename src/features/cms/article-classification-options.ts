'use server'

import { Prisma } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessCms } from './access'
import { parseTaxonomyKind, TaxonomyError, mapTaxonomyError } from './taxonomy'
import { queryTaxonomyOptions } from './taxonomy-store'
import { ArticleClassificationError, mapClassificationError, parseClassificationId, type ClassificationOptionsResult } from './article-classification'
import { currentClassificationActor, scopedClassificationArticle } from './article-classification-store'

// This is a read-only Server Function (POST transport), not a catalog mutation.
// No caller-supplied actor identity and no option lookup before fresh parent scope.
export async function searchArticleClassificationOptions(articleId: unknown, kind: unknown, input: unknown): Promise<ClassificationOptionsResult> {
  try {
    const session = await getServerSession(authOptions)
    const user = session?.user
    if (!canAccessCms(user)) throw new ArticleClassificationError('FORBIDDEN')
    const id = parseClassificationId(articleId)
    const parsedKind = parseTaxonomyKind(kind)
    const data = await prisma.$transaction(async tx => {
      const actor = await currentClassificationActor(tx, user)
      await scopedClassificationArticle(tx, actor, id)
      return queryTaxonomyOptions(tx, parsedKind, input)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return { ok: true, data }
  } catch (error) {
    try {
      if (error instanceof TaxonomyError) {
        const code = mapTaxonomyError(error).code
        return { ok: false, error: mapClassificationError(new ArticleClassificationError(code === 'VALIDATION_ERROR' ? code : 'INTERNAL_ERROR')) }
      }
    } catch { /* A hostile error prototype must also become a safe failure. */ }
    const failure = mapClassificationError(error)
    if (failure.code === 'INTERNAL_ERROR') console.error('CMS_CLASSIFICATION_OPTIONS_FAILED')
    return { ok: false, error: failure }
  }
}
