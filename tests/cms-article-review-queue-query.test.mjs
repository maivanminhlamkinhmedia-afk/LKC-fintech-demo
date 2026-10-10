import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { APP_ROLES, hasPermission } from '../src/lib/roles.ts'

// Real DAL, Q0 planner/projector and role policy. Only Prisma is adapted; these
// tests do not prove SQL isolation, database collation, or production access.
const sourceRoot = new URL('../src/', import.meta.url)
const bridge = Symbol.for('cms-review-queue-query-test-adapter')
let state
const copy = input => structuredClone(input)
const trace = (kind, args) => state.calls.push({ kind, ...(args === undefined ? {} : { args: copy(args) }) })
const noWrite = () => { throw new Error('read-only queue attempted a mutation or unrelated lookup') }
const expectedSelect = {
  id: true, status: true, submittedAt: true, activeReviewVersionId: true,
  activeReviewVersion: { select: {
    id: true, articleId: true, versionNumber: true, basisUpdatedAt: true,
    title: true, accessMode: true, snapshotFormatVersion: true, editorSchemaVersion: true,
    products: { select: { articleId: true, versionId: true, productId: true }, orderBy: { productId: 'asc' } },
  } },
}
const tx = {
  user: {
    async findUnique(args) {
      trace('actor', args)
      assert.deepEqual(args, { where: { id: 'reviewer-a' }, select: { id: true, role: true, status: true } })
      if (state.failure === 'actor') throw Error('PRIVATE_DATABASE_DETAIL')
      return copy(state.freshActor)
    },
    create: noWrite, update: noWrite, delete: noWrite,
  },
  article: {
    async findMany(args) {
      trace('queue', args)
      assert.deepEqual(args.select, expectedSelect)
      assert.deepEqual(args.orderBy, [{ submittedAt: 'asc' }, { id: 'asc' }])
      assert.equal(args.skip, undefined)
      assert.equal(args.cursor, undefined)
      assert.equal(args.where.status, 'SUBMITTED')
      assert.equal(args.where.activeReviewVersionId, undefined)
      assert.ok(args.take >= 2 && args.take <= 51)
      if (state.failure === 'queue') throw Error('PRIVATE_QUERY_URL mysql://private')
      if (!state.applyQuery) return copy(state.rows)
      // A bounded keyset adapter, not an alternate queue policy. Structural
      // assertions below separately check the actual Prisma predicate.
      const after = args.where.OR?.[1]
      return copy(state.rows.filter(row => row.status === args.where.status
        && (!after || row.submittedAt > after.submittedAt
          || (+row.submittedAt === +after.submittedAt && row.id > after.id.gt)))
        .sort((left, right) => +left.submittedAt - +right.submittedAt || (left.id < right.id ? -1 : 1))
        .slice(0, args.take))
    },
    create: noWrite, update: noWrite, updateMany: noWrite, delete: noWrite, deleteMany: noWrite,
  },
  product: new Proxy({}, { get: noWrite }),
  articleVersion: new Proxy({}, { get: noWrite }),
  articleReview: new Proxy({}, { get: noWrite }),
  mediaAsset: new Proxy({}, { get: noWrite }),
}
const prisma = {
  async $transaction(callback, options) {
    trace('transaction', options)
    assert.deepEqual(options, { isolationLevel: 'Serializable' })
    if (state.failure === 'transaction') throw Error('PRIVATE_CONNECTION_STRING')
    const result = await callback(tx)
    if (state.failure === 'completion') throw Error('PRIVATE_TRANSACTION_DETAIL')
    return result
  },
  article: new Proxy({}, { get: noWrite }),
}
globalThis[bridge] = { prisma }
const replacements = new Map([
  ['server-only', 'data:text/javascript,export {};'],
  ['@prisma/client', 'data:text/javascript,export const Prisma={TransactionIsolationLevel:{Serializable:"Serializable"}};'],
  ['@/lib/prisma', `data:text/javascript,${encodeURIComponent(`export const prisma=globalThis[Symbol.for('cms-review-queue-query-test-adapter')].prisma;`)}`],
])
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  if (replacements.has(specifier)) return nextResolve(replacements.get(specifier), context)
  if (specifier === '@/lib/roles') return nextResolve(new URL('lib/roles.ts', sourceRoot).href, context)
  if (specifier.startsWith('.') && context.parentURL?.startsWith(sourceRoot.href)) {
    const url = new URL(`${specifier}.ts`, context.parentURL)
    if (existsSync(url)) return nextResolve(url.href, context)
  }
  return nextResolve(specifier, context)
} })
let getArticleReviewQueue, nextArticleUpdatedAt
try {
  ({ getArticleReviewQueue } = await import('../src/features/cms/article-review-queue-query.ts'))
  const draft = await import('../src/features/cms/article-draft.ts')
  nextArticleUpdatedAt = draft.nextArticleUpdatedAt
}
finally { hook.deregister(); delete globalThis[bridge] }
const originalError = console.error
console.error = (...args) => state.logs.push(args)
after(() => { console.error = originalError })

const submittedAt = '2026-10-10T07:00:00.000Z'
const basisUpdatedAt = '2026-10-10T06:59:58.123Z'
const session = (role = 'ADMIN') => ({ id: 'reviewer-a', role })
function row(id = 'article-a', overrides = {}, versionOverrides = {}) {
  return {
    id, status: 'SUBMITTED', submittedAt: new Date(submittedAt), activeReviewVersionId: `version-${id}`,
    title: 'PRIVATE_WORKING_TITLE', contentText: 'PRIVATE_WORKING_BODY', internalNote: 'PRIVATE_NOTE',
    accessMode: 'PUBLIC', updatedAt: new Date('2026-10-10T07:00:01.000Z'),
    activeReviewVersion: {
      id: `version-${id}`, articleId: id, versionNumber: 2, basisUpdatedAt: new Date(basisUpdatedAt),
      title: 'Captured metadata', accessMode: 'PUBLIC', snapshotFormatVersion: 1, editorSchemaVersion: 1, products: [],
      contentText: 'PRIVATE_PAID_BODY', contentJson: { secret: 'PRIVATE_EDITOR_JSON' }, changeSummary: 'PRIVATE_REVIEW_NOTE',
      ...versionOverrides,
    }, ...overrides,
  }
}
function reset(overrides = {}) {
  state = { freshActor: { ...session(), status: 'ACTIVE' }, rows: [row()], calls: [], logs: [], ...overrides }
  return state
}
const failed = error => ({ ok: false, error })
const phases = () => state.calls.map(call => call.kind)
const query = () => state.calls.find(call => call.kind === 'queue').args
const paidEdges = (articleId = 'article-a', ids = ['product-b', 'product-a']) => ids.map(productId => ({
  articleId, versionId: `version-${articleId}`, productId,
}))

test('queue role matrix requires both existing permissions and rejects before any data read', async () => {
  for (const role of [...APP_ROLES, 'unknown']) {
    reset({ freshActor: { ...session(role), status: 'ACTIVE' } })
    const result = await getArticleReviewQueue(session(role))
    const permitted = hasPermission(role, 'cms:article:read:any') && hasPermission(role, 'cms:article:review')
    assert.equal(result.ok, permitted, role)
    if (permitted) assert.deepEqual(phases(), ['transaction', 'actor', 'queue'])
    else { assert.deepEqual(result, failed('FORBIDDEN')); assert.deepEqual(phases(), []) }
  }
  for (const actor of [null, {}, { id: '../unsafe', role: 'ADMIN' }]) {
    reset()
    assert.deepEqual(await getArticleReviewQueue(actor), failed('FORBIDDEN'))
    assert.deepEqual(phases(), [])
  }
})

test('fresh ACTIVE actor must match server session identity and role before planning or querying', async () => {
  for (const freshActor of [null, { ...session(), status: 'INACTIVE' }, { ...session(), status: 'SUSPENDED' },
    { ...session('SUPER_ADMIN'), status: 'ACTIVE' }, { ...session('CREATOR'), status: 'ACTIVE' },
    { ...session(), id: 'another-actor', status: 'ACTIVE' }, { ...session() }]) {
    reset({ freshActor })
    assert.deepEqual(await getArticleReviewQueue(session(), { cursor: 'malformed' }), failed('FORBIDDEN'))
    assert.deepEqual(phases(), ['transaction', 'actor'])
  }
})

test('Q0 validates malformed requests after fresh authorization but before Article access', async () => {
  for (const request of [{ cursor: '../bad' }, { filter: 'ALL' }, { limit: 0 }, { limit: 51 }, { limit: '20' },
    { limit: 1.5 }, { offset: 1 }, { actor: session() }, { authorId: 'foreign' }, null]) {
    reset()
    assert.deepEqual(await getArticleReviewQueue(session(), request), failed('VALIDATION_ERROR'))
    assert.deepEqual(phases(), ['transaction', 'actor'])
  }
  reset()
  let getterCalls = 0
  const hostile = { get cursor() { getterCalls++; throw Error('PRIVATE_CURSOR') } }
  assert.deepEqual(await getArticleReviewQueue(session(), hostile), failed('VALIDATION_ERROR'))
  assert.equal(getterCalls, 0)
  assert.deepEqual(phases(), ['transaction', 'actor'])
})

test('empty queue succeeds and limits are bounded at default 20 / requested 50 plus one', async () => {
  for (const [request, take] of [[undefined, 21], [{ limit: 50 }, 51], [{ limit: 1 }, 2]]) {
    reset({ rows: [] })
    assert.deepEqual(await getArticleReviewQueue(session(), request), { ok: true, data: { items: [], nextCursor: null } })
    assert.equal(query().take, take)
    assert.deepEqual(query().where, { status: 'SUBMITTED' })
  }
})

test('actual keyset query walks submittedAt ties by id with Q0 opaque cursors and limit plus one', async () => {
  const rows = [row('article-d', { submittedAt: new Date('2026-10-10T07:01:00.000Z') }),
    row('article-c'), row('article-a'), row('article-b'), row('article-0', { status: 'DRAFT' })]
  reset({ rows, applyQuery: true })
  const first = await getArticleReviewQueue(session(), { limit: 2 })
  assert.equal(first.ok, true)
  assert.deepEqual(first.data.items.map(item => item.articleId), ['article-a', 'article-b'])
  assert.equal(typeof first.data.nextCursor, 'string')
  reset({ rows, applyQuery: true })
  const second = await getArticleReviewQueue(session(), { limit: 2, cursor: first.data.nextCursor })
  assert.equal(second.ok, true)
  assert.deepEqual(second.data.items.map(item => item.articleId), ['article-c', 'article-d'])
  assert.equal(second.data.nextCursor, null)
  assert.deepEqual(query().where, { status: 'SUBMITTED', OR: [
    { submittedAt: { gt: new Date(submittedAt) } },
    { submittedAt: new Date(submittedAt), id: { gt: 'article-b' } },
  ] })
  assert.equal(query().take, 3)
})

test('allowlisted DTO uses persisted captured metadata without selecting working content or private snapshot data', async () => {
  reset()
  const result = await getArticleReviewQueue(session())
  assert.deepEqual(result, { ok: true, data: { items: [{
    articleId: 'article-a', versionId: 'version-article-a', versionNumber: 2,
    basisUpdatedAt, submittedAt, title: 'Captured metadata', audience: { accessMode: 'PUBLIC', productIds: [] },
  }], nextCursor: null } })
  assert.equal(JSON.stringify(result).includes('PRIVATE_'), false)
  assert.deepEqual(query().select, expectedSelect)
  // Article.updatedAt has advanced since capture: this does not invalidate a
  // correctly bound active snapshot or cause a fallback to working metadata.
  assert.notEqual(+state.rows[0].updatedAt, +state.rows[0].activeReviewVersion.basisUpdatedAt)
})

test('PAID_PRODUCT metadata is readable from bound captured IDs without Product eligibility or entitlement lookup', async () => {
  reset({ rows: [row('article-a', {}, { accessMode: 'PAID_PRODUCT', products: paidEdges() })] })
  const result = await getArticleReviewQueue(session())
  assert.equal(result.ok, true)
  assert.deepEqual(result.data.items[0].audience, { accessMode: 'PAID_PRODUCT', productIds: ['product-a', 'product-b'] })
  assert.deepEqual(phases(), ['transaction', 'actor', 'queue'])
  assert.equal(JSON.stringify(result).includes('PRIVATE_'), false)
})

test('null or malformed captured audience and missing/duplicate Product edges fail closed', async () => {
  for (const change of [{ accessMode: null }, { accessMode: 'UNKNOWN' },
    { accessMode: 'PUBLIC', products: paidEdges() }, { accessMode: 'PAID_PRODUCT', products: [] },
    { accessMode: 'PAID_PRODUCT', products: undefined },
    { accessMode: 'PAID_PRODUCT', products: paidEdges('article-a', ['product-a', 'product-a']) },
    { accessMode: 'PAID_PRODUCT', products: paidEdges('article-a', ['../unsafe']) }]) {
    reset({ rows: [row('article-a', {}, change)] })
    assert.deepEqual(await getArticleReviewQueue(session()), failed('INVALID_QUEUE_DATA'))
  }
})

test('Product edges must belong to both the same Article and active ArticleVersion', async () => {
  for (const change of [{ articleId: 'other-article' }, { versionId: 'old-version' }, { productId: null }]) {
    const products = [{ ...paidEdges()[0], ...change }]
    reset({ rows: [row('article-a', {}, { accessMode: 'PAID_PRODUCT', products })] })
    assert.deepEqual(await getArticleReviewQueue(session()), failed('INVALID_QUEUE_DATA'))
  }
})

test('missing, stale or cross-Article active version blocks the page rather than disappearing from it', async () => {
  for (const badRow of [row('article-a', { activeReviewVersionId: null }),
    row('article-a', { activeReviewVersion: null }), row('article-a', { activeReviewVersionId: 'old-version' }),
    row('article-a', {}, { id: 'old-version' }), row('article-a', {}, { articleId: 'another-article' }),
    row('article-a', { status: 'DRAFT' })]) {
    reset({ rows: [badRow] })
    assert.deepEqual(await getArticleReviewQueue(session()), failed('INVALID_QUEUE_DATA'))
    assert.deepEqual(query().where, { status: 'SUBMITTED' })
  }
})

test('legacy snapshot markers, unsupported schemas and invalid basis/submission metadata fail safely', async () => {
  for (const change of [{ snapshotFormatVersion: null }, { snapshotFormatVersion: 2 }, { editorSchemaVersion: 2 },
    { basisUpdatedAt: null }, { basisUpdatedAt: new Date(NaN) },
    { versionNumber: 0 }, { title: '' }]) {
    reset({ rows: [row('article-a', {}, change)] })
    assert.deepEqual(await getArticleReviewQueue(session()), failed('INVALID_QUEUE_DATA'))
  }
  for (const value of [null, new Date(NaN), submittedAt]) {
    reset({ rows: [row('article-a', { submittedAt: value })] })
    assert.deepEqual(await getArticleReviewQueue(session()), failed('INVALID_QUEUE_DATA'))
  }
})

test('invalid lookahead and unordered/duplicate rows cannot yield a successful partial page', async () => {
  for (const rows of [[row('article-a'), row('article-b', { activeReviewVersion: null })],
    [row('article-b'), row('article-a')], [row('article-a'), row('article-a')],
    [row('article-a'), row('article-b'), row('article-c')]]) {
    reset({ rows })
    assert.deepEqual(await getArticleReviewQueue(session(), { limit: 1 }), failed('INVALID_QUEUE_DATA'))
  }
})

test('database, query and transaction completion failures return only a safe error and never retry', async () => {
  for (const failure of ['transaction', 'actor', 'queue', 'completion']) {
    reset({ failure })
    const result = await getArticleReviewQueue(session())
    assert.deepEqual(result, failed('INTERNAL_ERROR'))
    assert.equal(state.calls.filter(call => call.kind === 'transaction').length, 1)
    assert.ok(state.calls.filter(call => call.kind === 'queue').length <= 1)
    assert.deepEqual(state.logs, [['CMS_REVIEW_QUEUE_READ_FAILED']])
    assert.equal(JSON.stringify({ result, logs: state.logs }).includes('PRIVATE_'), false)
  }
})
test('monotonic captured Article CAS token may be ahead of the submission wall clock', async () => {
  const submissionWallClock = Date.parse(submittedAt)
  const capturedBasis = nextArticleUpdatedAt(new Date(submissionWallClock + 500), submissionWallClock)
  assert.equal(capturedBasis.getTime(), submissionWallClock + 501)
  reset({ rows: [row('article-a', {}, { basisUpdatedAt: capturedBasis })] })
  const result = await getArticleReviewQueue(session())
  assert.equal(result.ok, true)
  assert.equal(result.data.items[0].basisUpdatedAt, capturedBasis.toISOString())
  assert.equal(result.data.items[0].submittedAt, submittedAt)
})
