import { Buffer } from 'node:buffer'
import { APP_ROLES, hasPermission, type AppRole } from '../../lib/roles'
import { inspectReviewAudience } from './article-review-policy'
import type {
  ReviewQueueItem, ReviewQueueItemDecision, ReviewQueueKey, ReviewQueuePage,
  ReviewQueuePlan, ReviewQueueResult,
} from './article-review-queue-contract'

const ID = /^[A-Za-z0-9_-]{1,191}$/u
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const CURSOR = /^[A-Za-z0-9_-]+$/u
const ORDER = Object.freeze(['submittedAt:asc', 'id:asc'] as const)

function record(input: unknown): object {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid record')
  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) throw new Error('invalid record')
  return input
}

function value(input: unknown, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record(input), key)
  if (!descriptor) return undefined
  if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('invalid field')
  return descriptor.value
}

function exactKeys(input: unknown, allowed: readonly string[]): void {
  const keys = Reflect.ownKeys(record(input))
  if (keys.some(key => typeof key !== 'string' || !allowed.includes(key))) throw new Error('invalid keys')
  for (const key of keys) value(input, key as string)
}

function validId(input: unknown): input is string {
  return typeof input === 'string' && ID.test(input)
}

function validTime(input: unknown): input is string {
  if (typeof input !== 'string' || !TIME.test(input)) return false
  const date = new Date(input)
  return Number.isFinite(date.getTime()) && date.toISOString() === input
}

function key(input: unknown): ReviewQueueKey {
  const submittedAt = value(input, 'submittedAt')
  const id = value(input, 'id')
  if (!validTime(submittedAt) || !validId(id)) throw new Error('invalid key')
  return Object.freeze({ submittedAt, id })
}

function compareKeys(left: ReviewQueueKey, right: ReviewQueueKey): number {
  if (left.submittedAt < right.submittedAt) return -1
  if (left.submittedAt > right.submittedAt) return 1
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

function encodeCursor(cursor: ReviewQueueKey): string {
  return Buffer.from(JSON.stringify({ v: 1, filter: 'SUBMITTED', submittedAt: cursor.submittedAt, id: cursor.id }), 'utf8')
    .toString('base64url')
}

function decodeCursor(input: unknown): ReviewQueueKey {
  if (typeof input !== 'string' || input.length === 0 || input.length > 512 || !CURSOR.test(input)) {
    throw new Error('invalid cursor')
  }
  const decoded: unknown = JSON.parse(Buffer.from(input, 'base64url').toString('utf8'))
  exactKeys(decoded, ['v', 'filter', 'submittedAt', 'id'])
  if (Reflect.ownKeys(decoded as object).length !== 4 || value(decoded, 'v') !== 1
    || value(decoded, 'filter') !== 'SUBMITTED') throw new Error('invalid cursor')
  const parsed = key(decoded)
  // Reject alternate JSON/key orderings and non-canonical base64 encodings.
  if (encodeCursor(parsed) !== input) throw new Error('invalid cursor')
  return parsed
}

// This checks a supplied actor only. The runtime query must reload an ACTIVE
// actor from the server database before using the resulting plan.
export function hasReviewQueueScope(actor: unknown): boolean {
  try {
    const id = value(actor, 'id'), role = value(actor, 'role'), status = value(actor, 'status')
    return validId(id) && APP_ROLES.includes(role as AppRole) && status === 'ACTIVE'
      && hasPermission(role as AppRole, 'cms:article:read:any')
      && hasPermission(role as AppRole, 'cms:article:review')
  } catch { return false }
}

// A pure plan: no database query, session lookup, or claim of a stable snapshot
// across requests. The future adapter must AND this filter with its own scope.
export function planReviewQueue(actor: unknown, request: unknown = undefined): ReviewQueueResult<ReviewQueuePlan> {
  if (!hasReviewQueueScope(actor)) return { ok: false, error: 'FORBIDDEN' }
  try {
    const input = request === undefined ? {} : request
    exactKeys(input, ['filter', 'limit', 'cursor'])
    const requestedFilter = value(input, 'filter')
    const filter = requestedFilter === undefined ? 'SUBMITTED' : requestedFilter
    const requestedLimit = value(input, 'limit')
    const limit = requestedLimit === undefined ? 20 : requestedLimit
    if (filter !== 'SUBMITTED' || !Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 50) {
      return { ok: false, error: 'VALIDATION_ERROR' }
    }
    const rawCursor = value(input, 'cursor')
    const cursor = rawCursor === undefined || rawCursor === null ? null : decodeCursor(rawCursor)
    return { ok: true, data: Object.freeze({ filter, limit: limit as number, cursor, orderBy: ORDER }) }
  } catch { return { ok: false, error: 'VALIDATION_ERROR' } }
}

// Only the supplied version contributes display data. An absent/mismatched
// active version is not eligible; malformed submitted data blocks the page.
export function projectReviewQueueItem(input: unknown): ReviewQueueItemDecision {
  try {
    const article = value(input, 'article')
    const articleId = value(article, 'id')
    const status = value(article, 'status')
    if (!validId(articleId) || typeof status !== 'string') throw new Error('invalid article')
    if (status !== 'SUBMITTED') return { kind: 'ineligible' }
    const submittedAt = value(article, 'submittedAt')
    if (!validTime(submittedAt)) throw new Error('invalid submittedAt')
    const activeVersionId = value(article, 'activeReviewVersionId')
    if (activeVersionId === null || activeVersionId === undefined) return { kind: 'ineligible' }
    if (!validId(activeVersionId)) throw new Error('invalid active version')
    const version = value(input, 'version')
    if (version === null || version === undefined) return { kind: 'ineligible' }
    const versionId = value(version, 'id')
    const versionArticleId = value(version, 'articleId')
    if (!validId(versionId) || !validId(versionArticleId)) throw new Error('invalid version')
    if (versionId !== activeVersionId || versionArticleId !== articleId) return { kind: 'ineligible' }
    const versionNumber = value(version, 'versionNumber')
    const basisUpdatedAt = value(version, 'basisUpdatedAt')
    const title = value(version, 'title')
    if (!Number.isSafeInteger(versionNumber) || (versionNumber as number) < 1 || !validTime(basisUpdatedAt)
      || typeof title !== 'string' || !title.trim() || Array.from(title).length > 180) {
      throw new Error('invalid version metadata')
    }
    const inspected = inspectReviewAudience(value(version, 'audience'))
    if (inspected.kind !== 'configured' && inspected.kind !== 'requires-product-validation') {
      throw new Error('invalid version audience')
    }
    const accessMode = inspected.audience.accessMode
    if (accessMode !== 'PUBLIC' && accessMode !== 'PAID_PRODUCT') throw new Error('invalid version audience')
    const data: ReviewQueueItem = Object.freeze({
      articleId, versionId, versionNumber: versionNumber as number, basisUpdatedAt, submittedAt, title,
      audience: Object.freeze({ accessMode, productIds: inspected.audience.productIds }),
    })
    return { kind: 'eligible', data }
  } catch { return { kind: 'blocked', error: 'INVALID_QUEUE_DATA' } }
}

export function projectReviewQueuePage(plan: ReviewQueuePlan, suppliedRows: unknown): ReviewQueueResult<ReviewQueuePage> {
  try {
    if (value(plan, 'filter') !== 'SUBMITTED') throw new Error('invalid plan')
    const limit = value(plan, 'limit')
    const orderBy = value(plan, 'orderBy')
    if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 50
      || !Array.isArray(orderBy) || orderBy.length !== 2
      || orderBy[0] !== ORDER[0] || orderBy[1] !== ORDER[1]) throw new Error('invalid plan')
    const cursorInput = value(plan, 'cursor')
    let previous = cursorInput === null ? null : key(cursorInput)
    if (!Array.isArray(suppliedRows) || Object.getPrototypeOf(suppliedRows) !== Array.prototype
      || suppliedRows.length > (limit as number) + 1) throw new Error('invalid rows')
    const items: ReviewQueueItem[] = []
    for (let index = 0; index < suppliedRows.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(suppliedRows, String(index))
      if (!descriptor || !('value' in descriptor)) throw new Error('invalid row')
      const projected = projectReviewQueueItem(descriptor.value)
      if (projected.kind !== 'eligible') throw new Error('ineligible or invalid row')
      const current = { submittedAt: projected.data.submittedAt, id: projected.data.articleId }
      if (previous && compareKeys(previous, current) >= 0) throw new Error('unordered rows')
      previous = current
      items.push(projected.data)
    }
    const hasMore = items.length > (limit as number)
    const pageItems = Object.freeze(items.slice(0, limit as number))
    const last = pageItems.at(-1)
    const nextCursor = hasMore && last ? encodeCursor({ submittedAt: last.submittedAt, id: last.articleId }) : null
    return { ok: true, data: Object.freeze({ items: pageItems, nextCursor }) }
  } catch { return { ok: false, error: 'INVALID_QUEUE_DATA' } }
}
