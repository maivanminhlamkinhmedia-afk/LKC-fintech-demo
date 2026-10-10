import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { CMSUser } from './access'
import type { ReviewQueueErrorCode, ReviewQueuePage } from './article-review-queue-contract'
import { hasReviewQueueScope, planReviewQueue, projectReviewQueuePage } from './article-review-queue-policy'

export type ArticleReviewQueueResult = { ok: true; data: ReviewQueuePage }
  | { ok: false; error: ReviewQueueErrorCode | 'INTERNAL_ERROR' }

// The queue reads captured metadata only. In particular, neither the working
// Article content/audience nor snapshot body/notes enter this query or its DTO.
const queueSelect = {
  id: true, status: true, submittedAt: true, activeReviewVersionId: true,
  activeReviewVersion: { select: {
    id: true, articleId: true, versionNumber: true, basisUpdatedAt: true,
    title: true, accessMode: true, snapshotFormatVersion: true, editorSchemaVersion: true,
    products: { select: { articleId: true, versionId: true, productId: true }, orderBy: { productId: 'asc' } },
  } },
} as const satisfies Prisma.ArticleSelect

type QueueRow = Prisma.ArticleGetPayload<{ select: typeof queueSelect }>

function persistedRow(row: QueueRow): unknown {
  const version = row.activeReviewVersion
  if (!version || version.snapshotFormatVersion !== 1 || version.editorSchemaVersion !== 1
    || !(row.submittedAt instanceof Date) || !(version.basisUpdatedAt instanceof Date)) {
    throw new Error('INVALID_QUEUE_DATA')
  }
  const submittedAt = row.submittedAt.toISOString()
  const basisUpdatedAt = version.basisUpdatedAt.toISOString()
  // Article CAS tokens advance monotonically and may lead the wall clock.
  // Validate timestamps through Q0 without ordering basis against submittedAt.
  if (!Array.isArray(version.products)) throw new Error('INVALID_QUEUE_DATA')
  const productIds = version.products.map(edge => {
    if (edge.articleId !== row.id || edge.versionId !== version.id) throw new Error('INVALID_QUEUE_DATA')
    return edge.productId
  })
  return {
    article: { id: row.id, status: row.status, submittedAt, activeReviewVersionId: row.activeReviewVersionId },
    version: { id: version.id, articleId: version.articleId, versionNumber: version.versionNumber,
      basisUpdatedAt, title: version.title, audience: { accessMode: version.accessMode, productIds } },
  }
}

// Call with the server session actor, never an actor from request parameters.
// A fresh ACTIVE actor and the Q0 plan are checked before any Article read.
export async function getArticleReviewQueue(
  sessionActor: CMSUser, request: unknown = undefined,
): Promise<ArticleReviewQueueResult> {
  let actorId: string, actorRole: CMSUser['role']
  try {
    actorId = sessionActor.id
    actorRole = sessionActor.role
    if (!hasReviewQueueScope({ id: actorId, role: actorRole, status: 'ACTIVE' })) {
      return { ok: false, error: 'FORBIDDEN' }
    }
  } catch { return { ok: false, error: 'FORBIDDEN' } }
  try {
    return await prisma.$transaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: actorId }, select: { id: true, role: true, status: true } })
      if (!actor || actor.id !== actorId || actor.role !== actorRole) return { ok: false, error: 'FORBIDDEN' } as const
      const planned = planReviewQueue(actor, request)
      if (!planned.ok) return planned
      const plan = planned.data
      const cursor = plan.cursor
      const where: Prisma.ArticleWhereInput = { status: plan.filter, ...(cursor ? { OR: [
        { submittedAt: { gt: new Date(cursor.submittedAt) } },
        { submittedAt: new Date(cursor.submittedAt), id: { gt: cursor.id } },
      ] } : {}) }
      const rows = await tx.article.findMany({
        where, select: queueSelect, orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }], take: plan.limit + 1,
      })
      // Do not hide broken submitted rows by filtering null active versions in
      // SQL or discarding ineligible projections. A bad row blocks this page.
      try { return projectReviewQueuePage(plan, rows.map(persistedRow)) }
      catch { return { ok: false, error: 'INVALID_QUEUE_DATA' } as const }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch {
    console.error('CMS_REVIEW_QUEUE_READ_FAILED')
    return { ok: false, error: 'INTERNAL_ERROR' }
  }
}
