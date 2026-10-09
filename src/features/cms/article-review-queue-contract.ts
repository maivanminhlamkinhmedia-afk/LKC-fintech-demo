import type { ReviewAudience } from './article-review-contract'

// CMS-011.2-Q0 only. These shapes describe supplied data and a query plan;
// they do not authorize a database read or establish a live review queue.
export type ReviewQueueFilter = 'SUBMITTED'
export type ReviewQueueKey = Readonly<{ submittedAt: string; id: string }>
export type ReviewQueuePlan = Readonly<{
  filter: ReviewQueueFilter
  limit: number
  cursor: ReviewQueueKey | null
  orderBy: readonly ['submittedAt:asc', 'id:asc']
}>

export type ReviewQueueAudience = Readonly<{
  accessMode: Exclude<ReviewAudience['accessMode'], null>
  productIds: readonly string[]
}>
export type ReviewQueueItem = Readonly<{
  articleId: string
  versionId: string
  versionNumber: number
  basisUpdatedAt: string
  submittedAt: string
  title: string
  audience: ReviewQueueAudience
}>
export type ReviewQueuePage = Readonly<{
  items: readonly ReviewQueueItem[]
  nextCursor: string | null
}>

export type ReviewQueueErrorCode = 'FORBIDDEN' | 'VALIDATION_ERROR' | 'INVALID_QUEUE_DATA'
export type ReviewQueueResult<T> = { ok: true; data: T } | { ok: false; error: ReviewQueueErrorCode }
export type ReviewQueueItemDecision =
  | { kind: 'eligible'; data: ReviewQueueItem }
  | { kind: 'ineligible' }
  | { kind: 'blocked'; error: 'INVALID_QUEUE_DATA' }
