'use server'

import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requirePermission } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { articleCmsScope, canAccessCms, canCreateArticle, type CMSUser } from '@/features/cms/access'
import {
  ArticleDraftError,
  canEditArticleDraft,
  mapDraftError,
  nextArticleUpdatedAt,
  normalizeCreateDraftInput,
  normalizeUpdateDraftInput,
  parseArticleId,
  type DraftFailure,
  type NormalizedDraftData,
} from '@/features/cms/article-draft'
import { validateStoredEditorDocument } from '@/features/cms/editor-schema'

export type SavedArticleDraft = { id: string; slug: string; updatedAt: string }
export type ArticleDraftActionResult =
  | { ok: true; data: SavedArticleDraft; warning?: string }
  | { ok: false; error: DraftFailure }

const savedSelect = { id: true, slug: true, updatedAt: true } as const

function writeData(data: NormalizedDraftData) {
  // Never spread request input or write ownership, lifecycle or relation fields.
  return {
    title: data.title,
    slug: data.slug,
    excerpt: data.excerpt,
    articleType: data.articleType,
    contentJson: data.contentJson as Prisma.InputJsonValue,
    contentText: data.contentText,
  }
}

async function currentActor(tx: Prisma.TransactionClient, sessionActor: CMSUser) {
  const actor = await tx.user.findUnique({
    where: { id: sessionActor.id },
    select: { id: true, role: true, status: true },
  })
  if (!actor || actor.status !== 'ACTIVE' || actor.role !== sessionActor.role || !canAccessCms(actor)) {
    throw new ArticleDraftError('FORBIDDEN')
  }
  return actor
}

function failed(error: unknown): ArticleDraftActionResult {
  const failure = mapDraftError(error)
  if (failure.code === 'INTERNAL_ERROR') console.error('CMS_DRAFT_WRITE_FAILED')
  return { ok: false, error: failure }
}

function committed(data: SavedArticleDraft): ArticleDraftActionResult {
  let refreshFailed = false
  for (const path of ['/creator', '/creator/articles', `/creator/articles/${encodeURIComponent(data.id)}/edit`]) {
    try {
      revalidatePath(path)
    } catch {
      refreshFailed = true
    }
  }
  // Persistence already committed. A cache failure must not invite a second
  // create or misrepresent a successful write as a transaction rollback.
  if (refreshFailed) {
    console.error('CMS_DRAFT_REVALIDATION_FAILED')
    return { ok: true, data, warning: 'Bài nháp đã được lưu. Vui lòng tải lại danh sách để xem dữ liệu mới.' }
  }
  return { ok: true, data }
}

export async function createArticleDraft(input: unknown): Promise<ArticleDraftActionResult> {
  // Preserve Next authentication redirects outside the persistence catch.
  const { user } = await requirePermission('cms:access')
  if (!canCreateArticle(user)) return failed(new ArticleDraftError('FORBIDDEN'))

  let saved: SavedArticleDraft
  try {
    const data = normalizeCreateDraftInput(input)
    saved = await prisma.$transaction(async (tx) => {
      const actor = await currentActor(tx, user)
      if (!canCreateArticle(actor)) throw new ArticleDraftError('FORBIDDEN')
      const article = await tx.article.create({
        data: { ...writeData(data), authorId: actor.id, status: 'DRAFT', editorSchemaVersion: 1 },
        select: savedSelect,
      })
      return { id: article.id, slug: article.slug, updatedAt: article.updatedAt.toISOString() }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) {
    return failed(error)
  }
  return committed(saved)
}

export async function updateArticleDraft(articleId: unknown, input: unknown): Promise<ArticleDraftActionResult> {
  let saved: SavedArticleDraft
  try {
    // Autosave must retain the open draft when the session expires. Reuse the
    // existing session and policy without the route/create redirect guard.
    const session = await getServerSession(authOptions)
    const user = session?.user
    if (!canAccessCms(user)) return failed(new ArticleDraftError('FORBIDDEN'))

    const id = parseArticleId(articleId)
    const { data, expectedUpdatedAt } = normalizeUpdateDraftInput(input)
    saved = await prisma.$transaction(async (tx) => {
      const actor = await currentActor(tx, user)
      const scope = articleCmsScope(actor)
      const article = await tx.article.findFirst({
        where: { AND: [{ id }, scope] },
        select: { id: true, authorId: true, status: true, updatedAt: true, editorSchemaVersion: true, contentJson: true },
      })
      if (!article) throw new ArticleDraftError('NOT_FOUND')
      if (!canEditArticleDraft(actor, article)) throw new ArticleDraftError('NOT_EDITABLE')
      validateStoredEditorDocument(article.contentJson, article.editorSchemaVersion)
      if (article.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new ArticleDraftError('EDIT_CONFLICT')

      const nextUpdatedAt = nextArticleUpdatedAt(article.updatedAt)
      const updated = await tx.article.updateMany({
        where: { AND: [
          { id: article.id },
          scope,
          { status: { in: ['DRAFT', 'CHANGES_REQUESTED'] } },
          { updatedAt: expectedUpdatedAt },
          { authorId: article.authorId, status: article.status, editorSchemaVersion: 1 },
        ] },
        data: { ...writeData(data), updatedAt: nextUpdatedAt },
      })
      if (updated.count !== 1) throw new ArticleDraftError('EDIT_CONFLICT')

      const version = await tx.article.findFirst({
        where: { AND: [{ id: article.id }, scope] },
        select: savedSelect,
      })
      // Return the persisted token, and fail/roll back if database precision did
      // not advance it. DATETIME(3) and concurrent locking still need staging QA.
      if (!version || version.updatedAt.getTime() <= article.updatedAt.getTime()) {
        throw new ArticleDraftError('EDIT_CONFLICT')
      }
      return { id: version.id, slug: version.slug, updatedAt: version.updatedAt.toISOString() }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) {
    return failed(error)
  }
  return committed(saved)
}
