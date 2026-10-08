import type { ArticleStatus } from '@prisma/client'
import { APP_ROLES, hasPermission, type AppRole } from '../../lib/roles'
import type {
  ReviewAccessMode, ReviewAudience, ReviewAudienceInspection, ReviewErrorCode,
  ReviewPolicyDecision, ReviewRecoveryStep, ReviewRevision,
} from './article-review-contract'

const ID = /^[A-Za-z0-9_-]{1,191}$/u
const TOKEN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u

function own(input: unknown, key: string): unknown {
  if (!input || typeof input !== 'object') return undefined
  const descriptor = Object.getOwnPropertyDescriptor(input, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}

function validId(input: unknown): input is string {
  return typeof input === 'string' && ID.test(input)
}

function validToken(input: unknown): input is string {
  if (typeof input !== 'string' || !TOKEN.test(input)) return false
  const date = new Date(input)
  return Number.isFinite(date.getTime()) && date.toISOString() === input
}

function blocked(code: ReviewErrorCode): ReviewPolicyDecision {
  return { kind: 'blocked', code }
}

function productIds(input: unknown): string[] | null {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) return null
  const values: string[] = []
  for (let index = 0; index < input.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index))
    if (!descriptor || !('value' in descriptor) || !validId(descriptor.value)) return null
    values.push(descriptor.value)
  }
  values.sort()
  return values.some((value, index) => index > 0 && value === values[index - 1]) ? null : values
}

// Structural only: PAID_PRODUCT still needs the C01 producer to verify that
// these IDs are selectable. NULL never becomes PUBLIC, even for an empty set.
export function inspectReviewAudience(input: unknown): ReviewAudienceInspection {
  try {
    const mode = own(input, 'accessMode')
    const ids = productIds(own(input, 'productIds'))
    if (ids === null) return { kind: 'blocked', code: 'PRODUCT_INVALID' }
    if (mode !== null && mode !== 'PUBLIC' && mode !== 'PAID_PRODUCT') {
      return { kind: 'blocked', code: 'VALIDATION_ERROR' }
    }
    if (mode === 'PAID_PRODUCT' && ids.length === 0) {
      return { kind: 'blocked', code: 'AUDIENCE_INCOMPLETE' }
    }
    if (mode !== 'PAID_PRODUCT' && ids.length !== 0) {
      return { kind: 'blocked', code: 'PRODUCT_INVALID' }
    }
    const audience: ReviewAudience = Object.freeze({
      accessMode: mode as ReviewAccessMode,
      productIds: Object.freeze(ids),
    })
    if (mode === null) return { kind: 'unconfigured', audience }
    if (mode === 'PAID_PRODUCT') return { kind: 'requires-product-validation', audience }
    return { kind: 'configured', audience }
  } catch {
    return { kind: 'blocked', code: 'VALIDATION_ERROR' }
  }
}

function revision(input: unknown): ReviewRevision | null {
  const articleId = own(input, 'articleId')
  const versionId = own(input, 'versionId')
  if (!validId(articleId) || !validId(versionId)) return null
  const versionNumber = own(input, 'versionNumber')
  const basisUpdatedAt = own(input, 'basisUpdatedAt')
  if (!Number.isSafeInteger(versionNumber) || (versionNumber as number) < 1 || !validToken(basisUpdatedAt)) return null
  const checkedAudience = inspectReviewAudience(own(input, 'audience'))
  if (checkedAudience.kind === 'blocked' || checkedAudience.kind === 'unconfigured') return null
  return Object.freeze({
    articleId,
    versionId,
    versionNumber: versionNumber as number,
    basisUpdatedAt,
    audience: checkedAudience.audience,
  })
}

function sameAudience(left: ReviewAudience, right: ReviewAudience): boolean {
  return left.accessMode === right.accessMode
    && left.productIds.length === right.productIds.length
    && left.productIds.every((id, index) => id === right.productIds[index])
}

function sameRevision(left: ReviewRevision, right: ReviewRevision): boolean {
  return left.articleId === right.articleId
    && left.versionId === right.versionId
    && left.versionNumber === right.versionNumber
    && left.basisUpdatedAt === right.basisUpdatedAt
    && sameAudience(left.audience, right.audience)
}

const TARGET = { SUBMIT: 'SUBMITTED', TAKE: 'EDITORIAL_REVIEW', APPROVE: 'APPROVED' } as const
const SOURCE = { SUBMIT: ['DRAFT', 'CHANGES_REQUESTED'], TAKE: ['SUBMITTED'], APPROVE: ['EDITORIAL_REVIEW'] } as const

// This evaluates supplied persisted-state DTOs. It cannot prove that the actor
// was freshly read, enforce CAS, or perform an atomic version-bound write.
export function evaluateReviewTransition(input: unknown): ReviewPolicyDecision {
  try {
    const transition = own(input, 'transition')
    if (transition !== 'SUBMIT' && transition !== 'TAKE' && transition !== 'APPROVE') return blocked('VALIDATION_ERROR')
    const actor = own(input, 'actor')
    const role = own(actor, 'role')
    const actorId = own(actor, 'id')
    if (!validId(actorId) || !APP_ROLES.includes(role as AppRole)
      || own(actor, 'status') !== 'ACTIVE' || !hasPermission(role as AppRole, 'cms:access')) return blocked('FORBIDDEN')

    const article = own(input, 'article')
    const articleId = own(article, 'id')
    const authorId = own(article, 'authorId')
    if (!validId(articleId) || !validId(authorId)) return blocked('NOT_FOUND')
    const permission = transition === 'SUBMIT' ? 'cms:article:submit'
      : transition === 'TAKE' ? 'cms:article:review' : 'cms:article:approve'
    if (!hasPermission(role as AppRole, permission)) return blocked('FORBIDDEN')
    if (transition === 'SUBMIT') {
      if (!hasPermission(role as AppRole, 'cms:admin') && authorId !== actorId) return blocked('NOT_FOUND')
    } else if (!hasPermission(role as AppRole, 'cms:article:read:any')) return blocked('FORBIDDEN')

    const status = own(article, 'status')
    if (!(SOURCE[transition] as readonly unknown[]).includes(status)) return blocked('NOT_EDITABLE')
    const expectedUpdatedAt = own(input, 'expectedUpdatedAt')
    if (!validToken(expectedUpdatedAt)) return blocked('VALIDATION_ERROR')
    const currentUpdatedAt = own(article, 'updatedAt')
    if (!validToken(currentUpdatedAt)) return blocked('INTERNAL_ERROR')
    if (expectedUpdatedAt !== currentUpdatedAt) return blocked('EDIT_CONFLICT')

    const audience = inspectReviewAudience(own(article, 'audience'))
    if (audience.kind === 'blocked') return blocked(audience.code)
    if (audience.kind === 'unconfigured') return blocked('AUDIENCE_INCOMPLETE')

    let review: ReviewRevision | null = null
    if (transition !== 'SUBMIT') {
      const pendingInput = own(article, 'pendingReview')
      if (pendingInput === null) return blocked('STALE_REVIEW_VERSION')
      review = revision(pendingInput)
      if (!review || review.articleId !== articleId) return blocked('INTERNAL_ERROR')
      const expected = revision(own(input, 'expectedReview'))
      if (!expected) return blocked('VALIDATION_ERROR')
      if (!sameRevision(review, expected) || !sameAudience(review.audience, audience.audience)) {
        return blocked('STALE_REVIEW_VERSION')
      }
    }

    if (transition === 'TAKE') return { kind: 'pending', dependency: 'REVIEW_ASSIGNMENT_POLICY' }
    if (transition === 'APPROVE' && actorId === authorId) {
      return { kind: 'pending', dependency: 'SELF_APPROVAL_POLICY' }
    }
    if (audience.kind === 'requires-product-validation') {
      return { kind: 'pending', dependency: 'C01_PRODUCT_VALIDATION' }
    }
    return { kind: 'eligible', transition, from: status as ArticleStatus, to: TARGET[transition], revision: review }
  } catch {
    // A malformed/hostile DTO must not leak its properties or error text.
    return blocked('INTERNAL_ERROR')
  }
}

// Lost ACK never authorizes another write. A later adapter must do an
// authorized read of the same Article/version/event before choosing next steps.
export function recoveryStepForReviewFailure(code: ReviewErrorCode): ReviewRecoveryStep {
  if (code === 'UNKNOWN_OUTCOME') return 'VERIFY_SCOPED_VERSION_AND_EVENT'
  if (code === 'EDIT_CONFLICT' || code === 'STALE_REVIEW_VERSION') return 'RELOAD_SCOPED_STATE'
  return 'STOP_PRESERVE_INPUT'
}
