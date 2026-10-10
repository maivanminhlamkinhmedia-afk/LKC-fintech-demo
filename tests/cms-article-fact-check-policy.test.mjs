import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'

const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '../../lib/roles'
    && /\/article-(?:fact-check|review)-policy\.ts$/.test(context.parentURL ?? '')) {
    return nextResolve(new URL('../../lib/roles.ts', context.parentURL).href, context)
  }
  if (specifier === './article-review-policy' && context.parentURL?.endsWith('/article-fact-check-policy.ts')) {
    return nextResolve(new URL('./article-review-policy.ts', context.parentURL).href, context)
  }
  return nextResolve(specifier, context)
} })
let evaluateFactCheckPolicy, recoveryStepForFactCheckFailure
try {
  ({ evaluateFactCheckPolicy, recoveryStepForFactCheckFailure } =
    await import('../src/features/cms/article-fact-check-policy.ts'))
} finally { hook.deregister() }

// Real pure policy/role definitions; synthetic supplied DTOs, no runtime adapter.
// AC 01-09/11/13/19-20/23: only structural, pending and safe-output portions.
const basis = '2026-10-08T01:02:03.456Z'
const current = '2026-10-08T01:02:04.789Z'
function fixture(operation = 'FACT_CHECK') {
  return {
    operation,
    actor: { id: 'reviewer-a', role: 'ADMIN', status: 'ACTIVE' },
    article: {
      id: 'article-a', authorId: 'creator-a', status: 'EDITORIAL_REVIEW',
      updatedAt: current, activeReviewVersionId: 'version-a',
    },
    version: {
      id: 'version-a', articleId: 'article-a', versionNumber: 2,
      basisUpdatedAt: basis, snapshotFormatVersion: 1, editorSchemaVersion: 1,
    },
    expectedUpdatedAt: current,
    expectedVersion: { articleId: 'article-a', versionId: 'version-a', versionNumber: 2, basisUpdatedAt: basis },
  }
}
const blocked = code => ({ kind: 'blocked', code })
const pending = operation => ({ kind: 'pending', code: 'POLICY_UNRESOLVED', dependency: operation + '_POLICY' })
function freeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child)
  return Object.freeze(value)
}

test('CMS012-P valid FACT_CHECK, REQUEST_CHANGES and REJECT never authorize a transition', () => {
  for (const operation of ['FACT_CHECK', 'REQUEST_CHANGES', 'REJECT']) {
    const result = evaluateFactCheckPolicy(fixture(operation))
    assert.deepEqual(result, pending(operation))
    assert.equal(Object.isFrozen(result), true)
    assert.deepEqual(Object.keys(result).sort(), ['code', 'dependency', 'kind'])
  }
})

test('CMS012-P known statuses and self-review remain unresolved without selecting business policy', () => {
  for (const status of ['DRAFT', 'SUBMITTED', 'EDITORIAL_REVIEW', 'CHANGES_REQUESTED', 'FACT_CHECK',
    'APPROVED', 'SCHEDULED', 'PUBLISHED', 'CORRECTED', 'ARCHIVED']) {
    for (const role of ['ADMIN', 'SUPER_ADMIN']) {
      const input = fixture('REQUEST_CHANGES')
      Object.assign(input.actor, { role, id: input.article.authorId })
      input.article.status = status
      assert.deepEqual(evaluateFactCheckPolicy(input), pending('REQUEST_CHANGES'))
    }
  }
  const input = fixture()
  input.article.status = 'toString'
  assert.deepEqual(evaluateFactCheckPolicy(input), blocked('VALIDATION_ERROR'))
})

test('CMS012-P guest, inactive and non-CMS actors fail before private Article fields are inspected', () => {
  const actors = [null, undefined, { id: 'actor-a', role: 'UNKNOWN', status: 'ACTIVE' }]
  for (const role of ['CLIENT', 'ANALYST', 'MANAGER', 'EMPLOYEE', 'SALES', 'SALES_MANAGER']) {
    actors.push({ id: 'actor-a', role, status: 'ACTIVE' })
  }
  for (const status of ['INVITED', 'SUSPENDED', 'DISABLED', null]) {
    actors.push({ id: 'actor-a', role: 'ADMIN', status })
  }
  let calls = 0
  for (const actor of actors) {
    const input = { actor }
    Object.defineProperty(input, 'article', { get() { calls++; throw Error('private Article') } })
    assert.deepEqual(evaluateFactCheckPolicy(input), blocked('FORBIDDEN'))
  }
  assert.equal(calls, 0)
})

test('CMS012-P current shared permissions preserve own-scope privacy and reviewer capability boundary', () => {
  const input = fixture()
  input.actor = { id: 'creator-a', role: 'CREATOR', status: 'ACTIVE' }
  assert.deepEqual(evaluateFactCheckPolicy(input), blocked('FORBIDDEN'))
  input.article.authorId = 'creator-b'
  assert.deepEqual(evaluateFactCheckPolicy(input), blocked('NOT_FOUND'))
  input.actor = { id: 'admin-b', role: 'ADMIN', status: 'ACTIVE' }
  assert.deepEqual(evaluateFactCheckPolicy(input), pending('FACT_CHECK'))
  input.article = null
  assert.deepEqual(evaluateFactCheckPolicy(input), blocked('NOT_FOUND'))
})

test('CMS012-P invalid input, operations and malformed identities fail safely', () => {
  for (const input of [null, undefined, true, 1, 'secret', [], () => 'secret']) {
    assert.deepEqual(evaluateFactCheckPolicy(input), blocked('VALIDATION_ERROR'))
  }
  for (const operation of ['APPROVE', 'SUBMIT', '', null, {}, 'FACT_CHECK ']) {
    assert.deepEqual(evaluateFactCheckPolicy({ ...fixture(), operation }), blocked('VALIDATION_ERROR'))
  }
  for (const id of ['', '../article', 'with space', 'a'.repeat(192), 12, null]) {
    const input = fixture()
    input.actor.id = id
    assert.deepEqual(evaluateFactCheckPolicy(input), blocked('FORBIDDEN'))
    const articleInput = fixture()
    articleInput.article.id = id
    assert.deepEqual(evaluateFactCheckPolicy(articleInput), blocked('VALIDATION_ERROR'))
    const authorInput = fixture()
    authorInput.article.authorId = id
    assert.deepEqual(evaluateFactCheckPolicy(authorInput), blocked('VALIDATION_ERROR'))
  }
})

test('CMS012-P null legacy version, pointer, format and basis cannot proceed', () => {
  const input = fixture()
  input.version = null
  assert.deepEqual(evaluateFactCheckPolicy(input), blocked('INCOMPLETE_SNAPSHOT'))
  const pointer = fixture()
  pointer.article.activeReviewVersionId = null
  assert.deepEqual(evaluateFactCheckPolicy(pointer), blocked('STALE_REVIEW_VERSION'))
  for (const key of ['snapshotFormatVersion', 'basisUpdatedAt']) {
    const legacy = fixture()
    legacy.version[key] = null
    assert.deepEqual(evaluateFactCheckPolicy(legacy), blocked('INCOMPLETE_SNAPSHOT'))
  }
  const missing = fixture()
  delete missing.version
  assert.deepEqual(evaluateFactCheckPolicy(missing), blocked('VALIDATION_ERROR'))
})

test('CMS012-P malformed version metadata differs from structurally valid unsupported schema', () => {
  for (const key of ['versionNumber', 'snapshotFormatVersion', 'editorSchemaVersion']) {
    for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', undefined]) {
      const input = fixture()
      input.version[key] = value
      assert.deepEqual(evaluateFactCheckPolicy(input), blocked('VALIDATION_ERROR'))
    }
  }
  for (const key of ['snapshotFormatVersion', 'editorSchemaVersion']) {
    const input = fixture()
    input.version[key] = 2
    assert.deepEqual(evaluateFactCheckPolicy(input), blocked('UNSUPPORTED_SNAPSHOT'))
  }
  for (const key of ['id', 'articleId']) {
    const input = fixture()
    input.version[key] = '../foreign'
    assert.deepEqual(evaluateFactCheckPolicy(input), blocked('VALIDATION_ERROR'))
  }
})

test('CMS012-P cross-Article version and changed active pointer reject exact-identity mismatch', () => {
  const foreign = fixture()
  foreign.version.articleId = 'article-b'
  foreign.expectedVersion.articleId = 'article-b'
  assert.deepEqual(evaluateFactCheckPolicy(foreign), blocked('STALE_REVIEW_VERSION'))
  const stale = fixture()
  stale.article.activeReviewVersionId = 'version-b'
  assert.deepEqual(evaluateFactCheckPolicy(stale), blocked('STALE_REVIEW_VERSION'))
  stale.article.activeReviewVersionId = '../version'
  assert.deepEqual(evaluateFactCheckPolicy(stale), blocked('VALIDATION_ERROR'))
})

test('CMS012-P exact millisecond working CAS rejects stale and noncanonical tokens', () => {
  const stale = fixture()
  stale.expectedUpdatedAt = basis
  assert.deepEqual(evaluateFactCheckPolicy(stale), blocked('EDIT_CONFLICT'))
  for (const value of ['', '2026-02-30T01:02:03.456Z', '2026-10-08T01:02:03Z',
    '2026-10-08T01:02:03.456+00:00', '2026-10-08T01:02:03.4567Z', new Date(current), 0]) {
    for (const location of ['article', 'expected', 'basis']) {
      const input = fixture()
      if (location === 'article') input.article.updatedAt = value
      else if (location === 'expected') input.expectedUpdatedAt = value
      else input.version.basisUpdatedAt = value
      assert.deepEqual(evaluateFactCheckPolicy(input), blocked('VALIDATION_ERROR'))
    }
  }
})

test('CMS012-P stale expected version components and malformed expectations fail closed', () => {
  for (const [key, value] of Object.entries({
    articleId: 'article-b', versionId: 'version-b', versionNumber: 3, basisUpdatedAt: current,
  })) {
    const input = fixture()
    input.expectedVersion[key] = value
    assert.deepEqual(evaluateFactCheckPolicy(input), blocked('STALE_REVIEW_VERSION'))
  }
  for (const key of ['articleId', 'versionId', 'versionNumber', 'basisUpdatedAt']) {
    const input = fixture()
    delete input.expectedVersion[key]
    assert.deepEqual(evaluateFactCheckPolicy(input), blocked('VALIDATION_ERROR'))
  }
  assert.deepEqual(evaluateFactCheckPolicy({ ...fixture(), expectedVersion: null }), blocked('VALIDATION_ERROR'))
})

test('CMS012-P version capture token need not equal current Article CAS after a review transition', () => {
  const input = fixture()
  assert.notEqual(input.version.basisUpdatedAt, input.article.updatedAt)
  assert.deepEqual(evaluateFactCheckPolicy(input), pending('FACT_CHECK'))
  input.article.updatedAt = '2026-10-09T01:02:04.789Z'
  input.expectedUpdatedAt = input.article.updatedAt
  assert.deepEqual(evaluateFactCheckPolicy(input), pending('FACT_CHECK'))
})

test('CMS012-P required own getters are rejected without invocation at every DTO level', () => {
  let calls = 0
  for (const [parent, key] of [[null, 'actor'], ['actor', 'role'], ['article', 'updatedAt'],
    ['version', 'basisUpdatedAt'], ['expectedVersion', 'versionId']]) {
    const input = fixture()
    const target = parent === null ? input : input[parent]
    Object.defineProperty(target, key, { enumerable: true, get() { calls++; throw Error('private getter') } })
    assert.deepEqual(evaluateFactCheckPolicy(input), blocked('VALIDATION_ERROR'))
  }
  assert.equal(calls, 0)
})

test('CMS012-P throwing and revoked proxies return fixed safe errors without raw exception text', () => {
  for (const trap of ['getPrototypeOf', 'getOwnPropertyDescriptor']) {
    for (const key of [null, 'actor', 'article', 'version', 'expectedVersion']) {
      const input = fixture()
      const target = key === null ? input : input[key]
      const hostile = new Proxy(target, { [trap]() { throw Error('secret receipt/body/path') } })
      const supplied = key === null ? hostile : { ...input, [key]: hostile }
      assert.deepEqual(evaluateFactCheckPolicy(supplied), blocked('VALIDATION_ERROR'))
    }
  }
  const { proxy, revoke } = Proxy.revocable(fixture(), {})
  revoke()
  assert.deepEqual(evaluateFactCheckPolicy(proxy), blocked('VALIDATION_ERROR'))
})

test('CMS012-P inherited, nonenumerable and nonrecord fields cannot supply trusted DTO values', () => {
  let calls = 0
  const inherited = fixture()
  inherited.version = Object.create({ get id() { calls++; return 'version-a' } })
  assert.deepEqual(evaluateFactCheckPolicy(inherited), blocked('VALIDATION_ERROR'))
  assert.equal(calls, 0)
  const hidden = fixture()
  Object.defineProperty(hidden.version, 'id', { value: 'version-a', enumerable: false })
  assert.deepEqual(evaluateFactCheckPolicy(hidden), blocked('VALIDATION_ERROR'))
  const nullPrototype = fixture()
  nullPrototype.version = Object.assign(Object.create(null), nullPrototype.version)
  assert.deepEqual(evaluateFactCheckPolicy(nullPrototype), pending('FACT_CHECK'))
})

test('CMS012-P body, notes, paths and toJSON extras are neither read nor returned on pending/blocked outcomes', () => {
  let calls = 0
  const input = fixture()
  for (const target of [input, input.actor, input.article, input.version, input.expectedVersion]) {
    for (const key of ['body', 'privateNote', 'receipt', 'url', 'toJSON']) {
      Object.defineProperty(target, key, { enumerable: true, get() { calls++; throw Error('paid private data') } })
    }
  }
  assert.deepEqual(evaluateFactCheckPolicy(input), pending('FACT_CHECK'))
  input.expectedUpdatedAt = basis
  assert.deepEqual(evaluateFactCheckPolicy(input), blocked('EDIT_CONFLICT'))
  assert.equal(calls, 0)
})

test('CMS012-P frozen inputs are unchanged and repeated evaluation is deterministic', () => {
  const input = fixture('REJECT')
  const before = structuredClone(input)
  freeze(input)
  assert.deepEqual(evaluateFactCheckPolicy(input), pending('REJECT'))
  assert.deepEqual(evaluateFactCheckPolicy(input), pending('REJECT'))
  assert.deepEqual(input, before)
})

test('CMS012-P UNKNOWN_OUTCOME requires scoped verification and never instructs mutation replay', () => {
  assert.equal(recoveryStepForFactCheckFailure('UNKNOWN_OUTCOME'), 'VERIFY_SCOPED_VERSION_AND_EVENT')
  for (const code of ['EDIT_CONFLICT', 'STALE_REVIEW_VERSION']) {
    assert.equal(recoveryStepForFactCheckFailure(code), 'RELOAD_SCOPED_STATE')
  }
  for (const code of ['FORBIDDEN', 'NOT_FOUND', 'VALIDATION_ERROR', 'INCOMPLETE_SNAPSHOT',
    'UNSUPPORTED_SNAPSHOT', 'POLICY_UNRESOLVED', 'INTERNAL_ERROR']) {
    assert.equal(recoveryStepForFactCheckFailure(code), 'STOP_PRESERVE_INPUT')
  }
})
