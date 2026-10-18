import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'

const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '../../lib/roles' && context.parentURL?.endsWith('/article-review-policy.ts')) {
    return nextResolve(new URL('../../lib/roles.ts', context.parentURL).href, context)
  }
  return nextResolve(specifier, context)
} })
const { inspectReviewAudience, evaluateReviewTransition, recoveryStepForReviewFailure } =
  await import('../src/features/cms/article-review-policy.ts')
hook.deregister()

const token = '2026-10-08T01:02:03.456Z'
const actor = (id = 'creator-a', role = 'CREATOR', status = 'ACTIVE') => ({ id, role, status })
const audience = (accessMode = 'PUBLIC', productIds = []) => ({ accessMode, productIds })
const revision = (overrides = {}) => ({
  articleId: 'article-a', versionId: 'version-a', versionNumber: 1,
  basisUpdatedAt: token, audience: audience(), ...overrides,
})
const article = (overrides = {}) => ({
  id: 'article-a', authorId: 'creator-a', status: 'DRAFT', updatedAt: token,
  audience: audience(), pendingReview: null, ...overrides,
})
const request = (transition = 'SUBMIT', overrides = {}) => ({
  transition, actor: actor(), article: article(), expectedUpdatedAt: token, ...overrides,
})
const blocked = code => ({ kind: 'blocked', code })

test('audience remains unconfigured without an explicit value; draft shape is retained', () => {
  assert.deepEqual(inspectReviewAudience(audience(null)), {
    kind: 'unconfigured', audience: audience(null),
  })
  assert.deepEqual(evaluateReviewTransition(request('SUBMIT', { article: article({ audience: audience(null) }) })),
    blocked('AUDIENCE_INCOMPLETE'))
  assert.deepEqual(inspectReviewAudience({ productIds: [] }), blocked('VALIDATION_ERROR'))
  assert.deepEqual(inspectReviewAudience(audience('PUBLIC', ['product-a'])), blocked('PRODUCT_INVALID'))
})

test('PAID_PRODUCT is an OR set of stable IDs, but remains gated on C01 validation', () => {
  assert.deepEqual(inspectReviewAudience(audience('PAID_PRODUCT', ['product-b', 'product-a'])), {
    kind: 'requires-product-validation', audience: audience('PAID_PRODUCT', ['product-a', 'product-b']),
  })
  assert.deepEqual(evaluateReviewTransition(request('SUBMIT', {
    article: article({ audience: audience('PAID_PRODUCT', ['product-b', 'product-a']) }),
  })), { kind: 'pending', dependency: 'C01_PRODUCT_VALIDATION' })
  assert.deepEqual(inspectReviewAudience(audience('PAID_PRODUCT', [])), blocked('AUDIENCE_INCOMPLETE'))
  assert.deepEqual(inspectReviewAudience(audience('PAID_PRODUCT', ['product-a', 'product-a'])), blocked('PRODUCT_INVALID'))
  assert.deepEqual(inspectReviewAudience(audience('PAID_PRODUCT', ['../foreign'])), blocked('PRODUCT_INVALID'))
})

test('hostile audience accessors are not called or serialized', () => {
  let calls = 0
  const hostile = {}
  Object.defineProperty(hostile, 'accessMode', { get() { calls++; throw Error('private value') } })
  Object.defineProperty(hostile, 'productIds', { value: [] })
  assert.deepEqual(inspectReviewAudience(hostile), blocked('VALIDATION_ERROR'))
  const ids = []
  Object.defineProperty(ids, '0', { get() { calls++; throw Error('private value') } })
  ids.length = 1
  assert.deepEqual(inspectReviewAudience(audience('PAID_PRODUCT', ids)), blocked('PRODUCT_INVALID'))
  assert.equal(calls, 0)
})

test('submit accepts persisted PUBLIC draft or changes-requested for creator own and admin scope', () => {
  for (const status of ['DRAFT', 'CHANGES_REQUESTED']) {
    assert.deepEqual(evaluateReviewTransition(request('SUBMIT', { article: article({ status }) })), {
      kind: 'eligible', transition: 'SUBMIT', from: status, to: 'SUBMITTED', revision: null,
    })
  }
  assert.equal(evaluateReviewTransition(request('SUBMIT', {
    actor: actor('admin-a', 'ADMIN'), article: article({ authorId: 'foreign' }),
  })).kind, 'eligible')
  assert.deepEqual(evaluateReviewTransition(request('SUBMIT', {
    article: article({ authorId: 'foreign' }),
  })), blocked('NOT_FOUND'))
})

test('inactive, non-CMS and wrong-permission actors fail before transition details', () => {
  for (const status of ['INVITED', 'SUSPENDED', 'DISABLED']) {
    assert.deepEqual(evaluateReviewTransition(request('SUBMIT', { actor: actor('creator-a', 'CREATOR', status) })), blocked('FORBIDDEN'))
  }
  for (const role of ['CLIENT', 'ANALYST', 'MANAGER']) {
    assert.deepEqual(evaluateReviewTransition(request('SUBMIT', { actor: actor('creator-a', role) })), blocked('FORBIDDEN'))
  }
  assert.deepEqual(evaluateReviewTransition(request('TAKE', { actor: actor(),
    article: article({ status: 'SUBMITTED', pendingReview: revision() }), expectedReview: revision(),
  })), blocked('FORBIDDEN'))
})

test('status table excludes premature approval, published states and CMS-012 decisions', () => {
  for (const status of ['SUBMITTED', 'EDITORIAL_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED']) {
    assert.deepEqual(evaluateReviewTransition(request('SUBMIT', { article: article({ status }) })), blocked('NOT_EDITABLE'))
  }
  assert.deepEqual(evaluateReviewTransition(request('APPROVE', { actor: actor('editor-a', 'ADMIN'),
    article: article({ status: 'SUBMITTED', pendingReview: revision() }), expectedReview: revision(),
  })), blocked('NOT_EDITABLE'))
  assert.deepEqual(evaluateReviewTransition(request('REJECT')), blocked('VALIDATION_ERROR'))
})

test('persisted millisecond token is required; mismatch is conflict, not a refreshed token', () => {
  assert.deepEqual(evaluateReviewTransition(request('SUBMIT', { expectedUpdatedAt: '2026-10-08T01:02:03Z' })), blocked('VALIDATION_ERROR'))
  assert.deepEqual(evaluateReviewTransition(request('SUBMIT', { expectedUpdatedAt: '2026-10-08T01:02:03.455Z' })), blocked('EDIT_CONFLICT'))
  assert.deepEqual(evaluateReviewTransition(request('SUBMIT', { article: article({ updatedAt: 'bad token' }) })), blocked('INTERNAL_ERROR'))
})

test('TAKE binds exact pending revision and visible audience but does not decide assignment policy', () => {
  const submitted = article({ status: 'SUBMITTED', pendingReview: revision() })
  const base = request('TAKE', { actor: actor('editor-a', 'ADMIN'), article: submitted, expectedReview: revision() })
  assert.deepEqual(evaluateReviewTransition(base), { kind: 'pending', dependency: 'REVIEW_ASSIGNMENT_POLICY' })
  assert.deepEqual(evaluateReviewTransition({ ...base, expectedReview: revision({ versionId: 'version-old' }) }), blocked('STALE_REVIEW_VERSION'))
  assert.deepEqual(evaluateReviewTransition({ ...base, expectedReview: revision({ basisUpdatedAt: '2026-10-08T01:02:03.455Z' }) }), blocked('STALE_REVIEW_VERSION'))
  assert.deepEqual(evaluateReviewTransition({ ...base, expectedReview: revision({ audience: audience('PAID_PRODUCT', ['product-a']) }) }), blocked('STALE_REVIEW_VERSION'))
  assert.deepEqual(evaluateReviewTransition({ ...base, article: { ...submitted, audience: audience('PAID_PRODUCT', ['product-a']) } }), blocked('STALE_REVIEW_VERSION'))
  assert.deepEqual(evaluateReviewTransition({ ...base, article: { ...submitted, pendingReview: null } }), blocked('STALE_REVIEW_VERSION'))
  assert.deepEqual(evaluateReviewTransition({ ...base, expectedReview: revision({ versionNumber: 0 }) }), blocked('VALIDATION_ERROR'))
})

test('APPROVE of a matching PUBLIC revision is structurally eligible without publication', () => {
  const base = request('APPROVE', {
    actor: actor('editor-a', 'ADMIN'),
    article: article({ status: 'EDITORIAL_REVIEW', pendingReview: revision() }),
    expectedReview: revision(),
  })
  assert.deepEqual(evaluateReviewTransition(base), {
    kind: 'eligible', transition: 'APPROVE', from: 'EDITORIAL_REVIEW', to: 'APPROVED', revision: revision(),
  })
  assert.deepEqual(evaluateReviewTransition({ ...base, actor: actor('creator-a', 'ADMIN') }),
    { kind: 'pending', dependency: 'SELF_APPROVAL_POLICY' })
})

test('PAID approval remains dependent on C01 and cannot be inferred from IDs alone', () => {
  const paid = revision({ audience: audience('PAID_PRODUCT', ['product-a']) })
  const state = article({ status: 'EDITORIAL_REVIEW', audience: paid.audience, pendingReview: paid })
  assert.deepEqual(evaluateReviewTransition(request('APPROVE', {
    actor: actor('editor-a', 'ADMIN'), article: state, expectedReview: paid,
  })), { kind: 'pending', dependency: 'C01_PRODUCT_VALIDATION' })
})

test('invalid identity, version and audience fail closed without echoing data', () => {
  assert.deepEqual(evaluateReviewTransition(request('SUBMIT', { article: article({ id: '../foreign' }) })), blocked('NOT_FOUND'))
  const current = article({ status: 'EDITORIAL_REVIEW', pendingReview: revision({ articleId: 'foreign' }) })
  assert.deepEqual(evaluateReviewTransition(request('APPROVE', {
    actor: actor('editor-a', 'ADMIN'), article: current, expectedReview: revision(),
  })), blocked('INTERNAL_ERROR'))
  const hostile = new Proxy({}, { getOwnPropertyDescriptor() { throw Error('private value') } })
  assert.deepEqual(evaluateReviewTransition(hostile), blocked('INTERNAL_ERROR'))
})

test('lost ACK and stale state require scoped verification, never automatic replay', () => {
  assert.equal(recoveryStepForReviewFailure('UNKNOWN_OUTCOME'), 'VERIFY_SCOPED_VERSION_AND_EVENT')
  assert.equal(recoveryStepForReviewFailure('EDIT_CONFLICT'), 'RELOAD_SCOPED_STATE')
  assert.equal(recoveryStepForReviewFailure('STALE_REVIEW_VERSION'), 'RELOAD_SCOPED_STATE')
  assert.equal(recoveryStepForReviewFailure('FORBIDDEN'), 'STOP_PRESERVE_INPUT')
})
