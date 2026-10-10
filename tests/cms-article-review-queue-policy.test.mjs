import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'

const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '../../lib/roles' && context.parentURL?.endsWith('/article-review-queue-policy.ts')) {
    return nextResolve(new URL('../../lib/roles.ts', context.parentURL).href, context)
  }
  if (specifier === './article-review-policy' && context.parentURL?.endsWith('/article-review-queue-policy.ts')) {
    return nextResolve(new URL('./article-review-policy.ts', context.parentURL).href, context)
  }
  if (specifier === '../../lib/roles' && context.parentURL?.endsWith('/article-review-policy.ts')) {
    return nextResolve(new URL('../../lib/roles.ts', context.parentURL).href, context)
  }
  return nextResolve(specifier, context)
} })
const { hasReviewQueueScope, planReviewQueue, projectReviewQueueItem, projectReviewQueuePage } =
  await import('../src/features/cms/article-review-queue-policy.ts')
hook.deregister()

const time = '2026-10-09T01:02:03.456Z'
const later = '2026-10-09T01:02:04.456Z'
const actor = (role = 'ADMIN', status = 'ACTIVE') => ({ id: 'reviewer-a', role, status })
const article = (overrides = {}) => ({
  id: 'article-a', status: 'SUBMITTED', submittedAt: time, activeReviewVersionId: 'version-a',
  title: 'mutable working title', contentText: 'private working text', privateNote: 'secret',
  ...overrides,
})
const version = (overrides = {}) => ({
  id: 'version-a', articleId: 'article-a', versionNumber: 2, basisUpdatedAt: time,
  title: 'Persisted review title', audience: { accessMode: 'PUBLIC', productIds: [] },
  contentText: 'private version text', privateNote: 'secret', ...overrides,
})
const row = (articleOverrides = {}, versionOverrides = {}) => ({
  article: article(articleOverrides), version: version(versionOverrides),
})
const blocked = error => ({ ok: false, error })
const cursor = value => Buffer.from(JSON.stringify(value)).toString('base64url')

test('scope requires an ACTIVE supplied reviewer with both existing permissions', () => {
  for (const role of ['ADMIN', 'SUPER_ADMIN']) assert.equal(hasReviewQueueScope(actor(role)), true)
  for (const role of ['CREATOR', 'MANAGER', 'CLIENT', 'unknown']) {
    assert.equal(hasReviewQueueScope(actor(role)), false)
    assert.deepEqual(planReviewQueue(actor(role)), blocked('FORBIDDEN'))
  }
  assert.deepEqual(planReviewQueue(actor('ADMIN', 'INACTIVE')), blocked('FORBIDDEN'))
  assert.deepEqual(planReviewQueue({ ...actor(), id: '../unsafe' }), blocked('FORBIDDEN'))
  let calls = 0
  const hostile = {}
  Object.defineProperty(hostile, 'role', { get() { calls++; throw Error('secret') } })
  assert.deepEqual(planReviewQueue(hostile), blocked('FORBIDDEN'))
  assert.equal(calls, 0)
})

test('fixed SUBMITTED filter, default 20, cap 50 and keyset ordering', () => {
  assert.deepEqual(planReviewQueue(actor()), {
    ok: true, data: { filter: 'SUBMITTED', limit: 20, cursor: null,
      orderBy: ['submittedAt:asc', 'id:asc'] },
  })
  assert.equal(planReviewQueue(actor(), { filter: 'SUBMITTED', limit: 50 }).data.limit, 50)
  for (const request of [
    { filter: null }, { filter: 'ALL' }, { limit: 0 }, { limit: 51 },
    { limit: 1.5 }, { limit: '20' }, { offset: 10 }, { cursor: '../unsafe' },
  ]) assert.deepEqual(planReviewQueue(actor(), request), blocked('VALIDATION_ERROR'))
})

test('cursor verifies schema, fixed filter, canonical encoding and timestamp', () => {
  for (const input of [
    { v: 1, filter: 'ALL', submittedAt: time, id: 'article-a' },
    { v: 2, filter: 'SUBMITTED', submittedAt: time, id: 'article-a' },
    { v: 1, filter: 'SUBMITTED', submittedAt: 'not-a-time', id: 'article-a' },
    { v: 1, filter: 'SUBMITTED', submittedAt: time, id: '../unsafe' },
    { v: 1, filter: 'SUBMITTED', submittedAt: time, id: 'article-a', extra: true },
    { id: 'article-a', submittedAt: time, filter: 'SUBMITTED', v: 1 },
  ]) assert.deepEqual(planReviewQueue(actor(), { cursor: cursor(input) }), blocked('VALIDATION_ERROR'))
  assert.deepEqual(planReviewQueue(actor(), { cursor: 'a'.repeat(513) }), blocked('VALIDATION_ERROR'))
})

test('only SUBMITTED rows bound to the same active ArticleVersion are eligible', () => {
  assert.equal(projectReviewQueueItem(row()).kind, 'eligible')
  for (const supplied of [
    row({ status: 'DRAFT' }), row({ status: 'EDITORIAL_REVIEW' }),
    row({ activeReviewVersionId: null }), row({}, { id: 'version-other' }),
    row({}, { articleId: 'article-other' }), { article: article(), version: null },
  ]) assert.deepEqual(projectReviewQueueItem(supplied), { kind: 'ineligible' })
  for (const supplied of [
    row({ submittedAt: null }), row({ submittedAt: '2026-99-99T00:00:00.000Z' }),
    row({ activeReviewVersionId: '../unsafe' }), row({}, { id: '../unsafe' }),
  ]) assert.deepEqual(projectReviewQueueItem(supplied), { kind: 'blocked', error: 'INVALID_QUEUE_DATA' })
})

test('DTO uses supplied version metadata only and never copies working or private fields', () => {
  const supplied = row({ title: 'wrong working title', audience: { accessMode: 'PAID_PRODUCT', productIds: ['other'] } },
    { title: 'Approved snapshot title', audience: { accessMode: 'PAID_PRODUCT', productIds: ['product-b', 'product-a'] } })
  const decision = projectReviewQueueItem(supplied)
  assert.deepEqual(decision, { kind: 'eligible', data: {
    articleId: 'article-a', versionId: 'version-a', versionNumber: 2,
    basisUpdatedAt: time, submittedAt: time, title: 'Approved snapshot title',
    audience: { accessMode: 'PAID_PRODUCT', productIds: ['product-a', 'product-b'] },
  } })
  assert.equal(JSON.stringify(decision).includes('secret'), false)
  assert.equal(JSON.stringify(decision).includes('wrong working title'), false)
  assert.equal(supplied.version.audience.productIds[0], 'product-b')
  assert.equal(Object.isFrozen(decision.data), true)
  assert.equal(Object.isFrozen(decision.data.audience), true)
})

test('missing, malformed, or unconfigured snapshot metadata blocks without a working-copy fallback', () => {
  for (const supplied of [
    row({}, { title: '' }), row({}, { versionNumber: 0 }), row({}, { basisUpdatedAt: null }),
    row({}, { audience: { accessMode: null, productIds: [] } }),
    row({}, { audience: { accessMode: 'PUBLIC', productIds: ['product-a'] } }),
    row({}, { audience: { accessMode: 'PAID_PRODUCT', productIds: [] } }),
    row({}, { audience: undefined }),
  ]) assert.deepEqual(projectReviewQueueItem(supplied), { kind: 'blocked', error: 'INVALID_QUEUE_DATA' })
  let calls = 0
  const badVersion = version()
  Object.defineProperty(badVersion, 'title', { get() { calls++; throw Error('secret') } })
  assert.deepEqual(projectReviewQueueItem({ article: article(), version: badVersion }),
    { kind: 'blocked', error: 'INVALID_QUEUE_DATA' })
  assert.equal(calls, 0)
})

test('keyset paging advances through a timestamp tie without duplicate or omission', () => {
  const firstPlan = planReviewQueue(actor(), { limit: 2 }).data
  const rows = [
    row(),
    row({ id: 'article-b', activeReviewVersionId: 'version-b' }, { id: 'version-b', articleId: 'article-b' }),
    row({ id: 'article-c', submittedAt: later, activeReviewVersionId: 'version-c' },
      { id: 'version-c', articleId: 'article-c' }),
  ]
  const firstPage = projectReviewQueuePage(firstPlan, rows)
  assert.equal(firstPage.ok, true)
  assert.deepEqual(firstPage.data.items.map(item => item.articleId), ['article-a', 'article-b'])
  assert.ok(firstPage.data.nextCursor)
  const secondPlan = planReviewQueue(actor(), { limit: 2, cursor: firstPage.data.nextCursor })
  assert.equal(secondPlan.ok, true)
  assert.deepEqual(secondPlan.data.cursor, { submittedAt: time, id: 'article-b' })
  const secondPage = projectReviewQueuePage(secondPlan.data, [rows[2]])
  assert.deepEqual(secondPage.data.items.map(item => item.articleId), ['article-c'])
  assert.equal(secondPage.data.nextCursor, null)
})

test('page rejects partial output, duplicate/out-of-order keys and rows before cursor', () => {
  const plan = planReviewQueue(actor(), { limit: 2 }).data
  const good = row()
  const bad = row({ id: 'article-b', activeReviewVersionId: 'version-b' },
    { id: 'version-b', articleId: 'article-b', title: '' })
  for (const rows of [
    [good, bad], [good, good],
    [row({ id: 'article-b', activeReviewVersionId: 'version-b' },
      { id: 'version-b', articleId: 'article-b' }), good],
    [good, good, good, good], [row({ status: 'DRAFT' })],
  ]) assert.deepEqual(projectReviewQueuePage(plan, rows), blocked('INVALID_QUEUE_DATA'))
  const after = { ...plan, cursor: { submittedAt: time, id: 'article-a' } }
  assert.deepEqual(projectReviewQueuePage(after, [good]), blocked('INVALID_QUEUE_DATA'))
})

test('the policy does not execute a query or authorize from a cursor', () => {
  const allowed = planReviewQueue(actor(), { cursor: cursor({ v: 1, filter: 'SUBMITTED', submittedAt: time, id: 'article-a' }) })
  assert.equal(allowed.ok, true)
  assert.deepEqual(planReviewQueue(actor('CREATOR'), { cursor: allowed.data.cursor }), blocked('FORBIDDEN'))
  assert.deepEqual(projectReviewQueuePage({ ...allowed.data, filter: 'ALL' }, []), blocked('INVALID_QUEUE_DATA'))
})
