import type { ArticleStatus } from '@prisma/client'
import { APP_ROLES, hasPermission, type AppRole } from '../../lib/roles'
import { recoveryStepForReviewFailure } from './article-review-policy'
import type { ReviewRecoveryStep } from './article-review-contract'
import type {
  FactCheckErrorCode, FactCheckPendingDependency, FactCheckPolicyDecision,
} from './article-fact-check-contract'

const ID = /^[A-Za-z0-9_-]{1,191}$/u
const TOKEN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
// Structural enum check, NOT an allowed source-state or transition table.
const STATUSES = {
  DRAFT: true, SUBMITTED: true, EDITORIAL_REVIEW: true, CHANGES_REQUESTED: true,
  FACT_CHECK: true, APPROVED: true, SCHEDULED: true, PUBLISHED: true,
  CORRECTED: true, ARCHIVED: true,
} as const satisfies Record<ArticleStatus, true>

function field(input: unknown, key: string): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid DTO')
  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) throw new Error('invalid DTO')
  const descriptor = Object.getOwnPropertyDescriptor(input, key)
  if (!descriptor) return undefined
  if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('invalid DTO')
  return descriptor.value
}
function validId(input: unknown): input is string {
  return typeof input === 'string' && ID.test(input)
}
function validToken(input: unknown): input is string {
  if (typeof input !== 'string' || !TOKEN.test(input)) return false
  const date = new Date(input)
  return Number.isFinite(date.getTime()) && date.toISOString() === input
}
function positiveInteger(input: unknown): input is number {
  return Number.isSafeInteger(input) && (input as number) > 0
}
function blocked(code: Exclude<FactCheckErrorCode, 'POLICY_UNRESOLVED'>): FactCheckPolicyDecision {
  return Object.freeze({ kind: 'blocked', code })
}
function pending(dependency: FactCheckPendingDependency): FactCheckPolicyDecision {
  return Object.freeze({ kind: 'pending', code: 'POLICY_UNRESOLVED', dependency })
}

// No note/body/audience projection. Only allowlisted scalar fields are inspected;
// unrelated fields (including getters/toJSON) are neither evaluated nor echoed.
export function evaluateFactCheckPolicy(input: unknown): FactCheckPolicyDecision {
  try {
    const actor = field(input, 'actor')
    if (actor === null || actor === undefined) return blocked('FORBIDDEN')
    const actorId = field(actor, 'id'), role = field(actor, 'role')
    if (!validId(actorId) || !APP_ROLES.includes(role as AppRole)
      || field(actor, 'status') !== 'ACTIVE'
      || !hasPermission(role as AppRole, 'cms:access')) return blocked('FORBIDDEN')

    const operation = field(input, 'operation')
    if (operation !== 'FACT_CHECK' && operation !== 'REQUEST_CHANGES' && operation !== 'REJECT') {
      return blocked('VALIDATION_ERROR')
    }
    const article = field(input, 'article')
    if (article === null || article === undefined) return blocked('NOT_FOUND')
    const articleId = field(article, 'id'), authorId = field(article, 'authorId')
    if (!validId(articleId) || !validId(authorId)) return blocked('VALIDATION_ERROR')
    const readAny = hasPermission(role as AppRole, 'cms:article:read:any')
    const readOwn = hasPermission(role as AppRole, 'cms:article:read:own') && actorId === authorId
    if (!readAny && !readOwn) return blocked('NOT_FOUND')
    // Existing review capability is necessary, never authority for an OPEN action.
    if (!readAny || !hasPermission(role as AppRole, 'cms:article:review')) return blocked('FORBIDDEN')

    const status = field(article, 'status')
    const updatedAt = field(article, 'updatedAt')
    const expectedUpdatedAt = field(input, 'expectedUpdatedAt')
    if (typeof status !== 'string' || !Object.hasOwn(STATUSES, status)
      || !validToken(updatedAt) || !validToken(expectedUpdatedAt)) return blocked('VALIDATION_ERROR')
    if (updatedAt !== expectedUpdatedAt) return blocked('EDIT_CONFLICT')

    const pointer = field(article, 'activeReviewVersionId')
    if (pointer === null) return blocked('STALE_REVIEW_VERSION')
    if (!validId(pointer)) return blocked('VALIDATION_ERROR')
    const version = field(input, 'version')
    if (version === null) return blocked('INCOMPLETE_SNAPSHOT')
    const versionId = field(version, 'id'), versionArticleId = field(version, 'articleId')
    const versionNumber = field(version, 'versionNumber')
    if (!validId(versionId) || !validId(versionArticleId) || !positiveInteger(versionNumber)) {
      return blocked('VALIDATION_ERROR')
    }
    if (versionArticleId !== articleId || versionId !== pointer) return blocked('STALE_REVIEW_VERSION')
    const basis = field(version, 'basisUpdatedAt')
    const format = field(version, 'snapshotFormatVersion'), schema = field(version, 'editorSchemaVersion')
    if (basis === null || format === null) return blocked('INCOMPLETE_SNAPSHOT')
    if (!validToken(basis) || !positiveInteger(format) || !positiveInteger(schema)) return blocked('VALIDATION_ERROR')
    if (format !== 1 || schema !== 1) return blocked('UNSUPPORTED_SNAPSHOT')

    const expected = field(input, 'expectedVersion')
    const expectedArticleId = field(expected, 'articleId'), expectedVersionId = field(expected, 'versionId')
    const expectedNumber = field(expected, 'versionNumber'), expectedBasis = field(expected, 'basisUpdatedAt')
    if (!validId(expectedArticleId) || !validId(expectedVersionId)
      || !positiveInteger(expectedNumber) || !validToken(expectedBasis)) return blocked('VALIDATION_ERROR')
    if (expectedArticleId !== articleId || expectedVersionId !== versionId
      || expectedNumber !== versionNumber || expectedBasis !== basis) return blocked('STALE_REVIEW_VERSION')

    // basisUpdatedAt is the version capture token, not the current working CAS.
    // Even structurally valid, self-authored or any known-status input is pending.
    if (operation === 'FACT_CHECK') return pending('FACT_CHECK_POLICY')
    if (operation === 'REQUEST_CHANGES') return pending('REQUEST_CHANGES_POLICY')
    return pending('REJECT_POLICY')
  } catch {
    // Hostile accessors/proxy traps may throw; never return their error text/data.
    return blocked('VALIDATION_ERROR')
  }
}

// Read-only guidance only. No verification, clock, retry, DB or filesystem call.
export function recoveryStepForFactCheckFailure(code: FactCheckErrorCode): ReviewRecoveryStep {
  if (code === 'UNKNOWN_OUTCOME' || code === 'EDIT_CONFLICT' || code === 'STALE_REVIEW_VERSION') {
    return recoveryStepForReviewFailure(code)
  }
  return 'STOP_PRESERVE_INPUT'
}
