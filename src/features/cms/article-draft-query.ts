import 'server-only'

import type { Article, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { articleCmsScope, canAccessCms, type CMSUser } from '@/features/cms/access'
import {
  ArticleDraftError,
  canEditArticleDraft,
  mapDraftError,
  parseArticleId,
  parseArticlePage,
  type DraftFailure,
  type NormalizedDraftData,
} from '@/features/cms/article-draft'
import { validateStoredEditorDocument } from '@/features/cms/editor-schema'

export type DraftEditorData = Pick<NormalizedDraftData, 'title' | 'slug' | 'excerpt' | 'articleType' | 'contentJson'> & {
  id: string
  updatedAt: string
}
export type DraftEditorReadResult =
  | { ok: true; data: DraftEditorData }
  | { ok: false; error: DraftFailure }

const listSelect = {
  id: true, title: true, slug: true, authorId: true, status: true,
  articleType: true, updatedAt: true, publishedAt: true,
} as const satisfies Prisma.ArticleSelect
export type ArticleDraftListRow = Pick<Article, keyof typeof listSelect>
export type ArticleDraftList = { articles: ArticleDraftListRow[]; page: number; total: number; pageCount: number }

// Server Components call requirePermission('cms:access') before supplying the
// authenticated session actor. This module is server-only, never a public action.
export async function getArticleDraftForEdit(actor: CMSUser, articleId: unknown): Promise<DraftEditorReadResult> {
  if (!canAccessCms(actor)) return { ok: false, error: mapDraftError(new ArticleDraftError('FORBIDDEN')) }
  try {
    const id = parseArticleId(articleId)
    const article = await prisma.article.findFirst({
      where: { AND: [{ id }, articleCmsScope(actor)] },
      select: {
        id: true, authorId: true, status: true, updatedAt: true, title: true, slug: true,
        excerpt: true, articleType: true, contentJson: true, editorSchemaVersion: true,
      },
    })
    if (!article) throw new ArticleDraftError('NOT_FOUND')
    if (!canEditArticleDraft(actor, article)) throw new ArticleDraftError('NOT_EDITABLE')
    const document = validateStoredEditorDocument(article.contentJson, article.editorSchemaVersion)
    return { ok: true, data: {
      id: article.id, title: article.title, slug: article.slug, excerpt: article.excerpt,
      articleType: article.articleType, contentJson: document.contentJson, updatedAt: article.updatedAt.toISOString(),
    } }
  } catch (error) {
    const failure = mapDraftError(error)
    if (failure.code === 'INTERNAL_ERROR') console.error('CMS_DRAFT_READ_FAILED')
    return { ok: false, error: failure }
  }
}

export async function getArticleDraftList(actor: CMSUser, pageInput: unknown): Promise<ArticleDraftList> {
  if (!canAccessCms(actor)) return { articles: [], page: 1, total: 0, pageCount: 1 }
  const requestedPage = parseArticlePage(pageInput)
  const where = { AND: [articleCmsScope(actor)] }
  try {
    const total = await prisma.article.count({ where })
    if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid article count')
    const pageCount = Math.max(1, Math.ceil(total / 20))
    const page = Math.min(requestedPage, pageCount)
    const articles = await prisma.article.findMany({
      where,
      select: listSelect,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * 20,
      take: 20,
    })
    return { articles, page, total, pageCount }
  } catch {
    console.error('CMS_DRAFT_LIST_FAILED')
    throw new Error('Không thể tải danh sách bài viết. Vui lòng thử lại.')
  }
}
