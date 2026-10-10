import type { ArticleStatus } from '@prisma/client'
import type { ReviewActor, ReviewErrorCode, ReviewRevision } from './article-review-contract'

// Supplied server DTOs only. This module does not load or authorize a session,
// inspect body/audience, verify persisted bytes, or perform a database CAS.
export type FactCheckOperation = 'FACT_CHECK' | 'REQUEST_CHANGES' | 'REJECT'
export type FactCheckArticle = Readonly<{
  id: string
  authorId: string
  status: ArticleStatus
  updatedAt: string
  activeReviewVersionId: string | null
}>
export type FactCheckVersion = Readonly<{
  id: string
  articleId: string
  versionNumber: number
  basisUpdatedAt: string | null
  snapshotFormatVersion: number | null
  editorSchemaVersion: number
}>
export type FactCheckExpectedVersion = Pick<ReviewRevision,
  'articleId' | 'versionId' | 'versionNumber' | 'basisUpdatedAt'>
export type FactCheckPolicyInput = Readonly<{
  operation: FactCheckOperation
  actor: ReviewActor
  article: FactCheckArticle
  version: FactCheckVersion | null
  expectedUpdatedAt: string
  expectedVersion: FactCheckExpectedVersion
}>
export type FactCheckErrorCode = Extract<ReviewErrorCode,
  'VALIDATION_ERROR' | 'NOT_FOUND' | 'FORBIDDEN' | 'EDIT_CONFLICT'
  | 'STALE_REVIEW_VERSION' | 'UNKNOWN_OUTCOME' | 'INTERNAL_ERROR'>
  | 'INCOMPLETE_SNAPSHOT' | 'UNSUPPORTED_SNAPSHOT' | 'POLICY_UNRESOLVED'
export type FactCheckPendingDependency =
  | 'FACT_CHECK_POLICY' | 'REQUEST_CHANGES_POLICY' | 'REJECT_POLICY'

// Deliberately no success, transition, nextStatus, note, body, or input identity.
// These dependencies include unresolved assignment, self-review, source-status,
// visibility and lifecycle policy; passing structure never grants a write.
export type FactCheckPolicyDecision =
  | Readonly<{ kind: 'blocked'; code: Exclude<FactCheckErrorCode, 'POLICY_UNRESOLVED'> }>
  | Readonly<{ kind: 'pending'; code: 'POLICY_UNRESOLVED'; dependency: FactCheckPendingDependency }>
