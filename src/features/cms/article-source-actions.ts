'use server'

import { Prisma } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { articleCmsScope, canAccessCms } from './access'
import { nextArticleUpdatedAt } from './article-draft'
import {
  ArticleSourceError, SOURCE_LIMITS, mapSourceError, normalizeSourceDeleteInput, normalizeSourceInput,
  parseSourceId, type ArticleSourcesSnapshot, type SourceActionResult, type SourceMetadata,
} from './article-sources'
import { currentSourceActor, scopedSourceArticle, sourceReadOnlyReason, sourceSnapshot } from './article-source-store'

function writeData(data: SourceMetadata) {
  return { sourceType: data.sourceType, title: data.title, publisher: data.publisher, url: data.url, note: data.note,
    publishedAt: data.publishedAt === null ? null : new Date(data.publishedAt),
    accessedAt: data.accessedAt === null ? null : new Date(data.accessedAt),
    dataTimestamp: data.dataTimestamp === null ? null : new Date(data.dataTimestamp) }
}

function committed(data: ArticleSourcesSnapshot): SourceActionResult {
  let warning = false
  for (const path of ['/creator', '/creator/articles', `/creator/articles/${encodeURIComponent(data.id)}/edit`, `/creator/articles/${encodeURIComponent(data.id)}/sources`]) {
    try { revalidatePath(path) } catch { warning = true }
  }
  if (warning) {
    console.error('CMS_SOURCE_REVALIDATION_FAILED')
    return { ok: true, data, warning: 'Nguồn đã được lưu. Vui lòng tải lại danh sách để xem dữ liệu mới.' }
  }
  return { ok: true, data }
}

async function mutate(operation: 'create' | 'update' | 'delete', articleId: unknown, sourceId: unknown, input: unknown): Promise<SourceActionResult> {
  let saved: ArticleSourcesSnapshot
  try {
    // A lost session returns a safe value; a framework redirect would discard the open form.
    const session = await getServerSession(authOptions)
    const user = session?.user
    if (!canAccessCms(user)) throw new ArticleSourceError('FORBIDDEN')
    const id = parseSourceId(articleId)
    const childId = operation === 'create' ? null : parseSourceId(sourceId)
    const normalized = operation === 'delete' ? { ...normalizeSourceDeleteInput(input), data: null } : normalizeSourceInput(input)
    const { expectedUpdatedAt, data } = normalized
    saved = await prisma.$transaction(async tx => {
      const actor = await currentSourceActor(tx, user)
      const article = await scopedSourceArticle(tx, actor, id)
      const reason = sourceReadOnlyReason(actor, article)
      if (reason) throw new ArticleSourceError(reason)
      if (childId !== null) {
        const child = await tx.sourceReference.findFirst({ where: { id: childId, articleId: article.id }, select: { id: true } })
        if (!child) throw new ArticleSourceError('NOT_FOUND')
      }
      if (article.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new ArticleSourceError('EDIT_CONFLICT')
      const claimed = await tx.article.updateMany({
        where: { AND: [{ id: article.id }, articleCmsScope(actor), { status: { in: ['DRAFT', 'CHANGES_REQUESTED'] } },
          { updatedAt: expectedUpdatedAt }, { authorId: article.authorId, status: article.status, editorSchemaVersion: 1 }] },
        data: { updatedAt: nextArticleUpdatedAt(article.updatedAt) },
      })
      if (claimed.count !== 1) throw new ArticleSourceError('EDIT_CONFLICT')
      if (operation === 'create') {
        if (!data) throw new ArticleSourceError('INTERNAL_ERROR')
        const count = await tx.sourceReference.count({ where: { articleId: article.id } })
        if (count >= SOURCE_LIMITS.perArticle) throw new ArticleSourceError('SOURCE_LIMIT_REACHED')
        await tx.sourceReference.create({ data: { ...writeData(data), articleId: article.id, createdById: actor.id }, select: { id: true } })
      } else if (operation === 'update') {
        if (!data) throw new ArticleSourceError('INTERNAL_ERROR')
        const result = await tx.sourceReference.updateMany({ where: { id: childId!, articleId: article.id }, data: writeData(data) })
        if (result.count !== 1) throw new ArticleSourceError('NOT_FOUND')
      } else {
        const result = await tx.sourceReference.deleteMany({ where: { id: childId!, articleId: article.id } })
        if (result.count !== 1) throw new ArticleSourceError('NOT_FOUND')
      }
      const persisted = await scopedSourceArticle(tx, actor, id)
      if (persisted.updatedAt.getTime() <= article.updatedAt.getTime()) throw new ArticleSourceError('EDIT_CONFLICT')
      return sourceSnapshot(tx, actor, persisted)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) {
    const failure = mapSourceError(error)
    if (failure.code === 'INTERNAL_ERROR') console.error('CMS_SOURCE_WRITE_FAILED')
    return { ok: false, error: failure }
  }
  return committed(saved)
}

export async function createArticleSource(articleId: unknown, input: unknown): Promise<SourceActionResult> {
  return mutate('create', articleId, null, input)
}
export async function updateArticleSource(articleId: unknown, sourceId: unknown, input: unknown): Promise<SourceActionResult> {
  return mutate('update', articleId, sourceId, input)
}
export async function deleteArticleSource(articleId: unknown, sourceId: unknown, input: unknown): Promise<SourceActionResult> {
  return mutate('delete', articleId, sourceId, input)
}
