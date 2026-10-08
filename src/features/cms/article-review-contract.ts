import type { ArticleStatus, UserStatus } from '@prisma/client'
import type { AppRole } from '../../lib/roles'

// CMS-011.0 semantic DTOs only. No physical version, approval, or publication
// pointer exists on main. Callers must load the actor and Article authoritatively.
export type ReviewTransition = 'SUBMIT' | 'TAKE' | 'APPROVE'
export type ReviewAccessMode = null | 'PUBLIC' | 'PAID_PRODUCT'
export type ReviewAudience = Readonly<{
  accessMode: ReviewAccessMode
  productIds: readonly string[] // Stable C01 Product IDs; OR semantics, no catalog data.
}>

export type ReviewRevision = Readonly<{
  articleId: string
  versionId: string
  versionNumber: number
  basisUpdatedAt: string // Exact UTC millisecond Article CAS token at capture.
  audience: ReviewAudience // Audience bound to this immutable proposed version.
}>

export type ReviewActor = Readonly<{ id: string; role: AppRole; status: UserStatus }>
export type ReviewArticleState = Readonly<{
  id: string
  authorId: string
  status: ArticleStatus
  updatedAt: string // Serialized persisted Article.updatedAt, never a client clock.
  audience: ReviewAudience // Persisted working audience, not unsaved form input.
  pendingReview: ReviewRevision | null
}>

export type ReviewPolicyInput = Readonly<{
  transition: ReviewTransition
  actor: ReviewActor
  article: ReviewArticleState
  expectedUpdatedAt: string
  expectedReview?: ReviewRevision // Required for TAKE/APPROVE.
}>

export type ReviewErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUDIENCE_INCOMPLETE'
  | 'PRODUCT_INVALID'
  | 'PRODUCT_UNAVAILABLE'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'NOT_EDITABLE'
  | 'EDIT_CONFLICT'
  | 'STALE_REVIEW_VERSION'
  | 'UNKNOWN_OUTCOME'
  | 'INTERNAL_ERROR'

export type ReviewAudienceInspection =
  | { kind: 'unconfigured'; audience: ReviewAudience }
  | { kind: 'configured'; audience: ReviewAudience }
  | { kind: 'requires-product-validation'; audience: ReviewAudience }
  | { kind: 'blocked'; code: ReviewErrorCode }

export type ReviewPendingDependency =
  | 'C01_PRODUCT_VALIDATION'
  | 'REVIEW_ASSIGNMENT_POLICY'
  | 'SELF_APPROVAL_POLICY'

// Eligible is only a structural pure-policy result, never a write authorization.
// Pending has no nextStatus: an unresolved decision must not mutate Article.
export type ReviewPolicyDecision =
  | { kind: 'eligible'; transition: ReviewTransition; from: ArticleStatus; to: ArticleStatus; revision: ReviewRevision | null }
  | { kind: 'pending'; dependency: ReviewPendingDependency }
  | { kind: 'blocked'; code: ReviewErrorCode }

export type ReviewRecoveryStep = 'VERIFY_SCOPED_VERSION_AND_EVENT' | 'RELOAD_SCOPED_STATE' | 'STOP_PRESERVE_INPUT'
