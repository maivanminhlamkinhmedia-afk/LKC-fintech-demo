import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { canAccessCms, type CMSUser } from './access'
import { ArticleSourceError, mapSourceError, parseSourceId, type SourceActionResult } from './article-sources'
import { currentSourceActor, scopedSourceArticle, sourceSnapshot } from './article-source-store'

// The protected page calls requirePermission first; this uncached read also
// checks the current database actor and scopes the parent before listing children.
export async function getArticleSources(sessionActor: CMSUser, articleId: unknown): Promise<SourceActionResult> {
  try {
    if (!canAccessCms(sessionActor)) throw new ArticleSourceError('FORBIDDEN')
    const id = parseSourceId(articleId)
    const data = await prisma.$transaction(async tx => {
      const actor = await currentSourceActor(tx, sessionActor)
      const article = await scopedSourceArticle(tx, actor, id)
      return sourceSnapshot(tx, actor, article)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return { ok: true, data }
  } catch (error) {
    const failure = mapSourceError(error)
    if (failure.code === 'INTERNAL_ERROR') console.error('CMS_SOURCE_READ_FAILED')
    return { ok: false, error: failure }
  }
}
