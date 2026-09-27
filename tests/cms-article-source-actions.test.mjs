import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createRequire, registerHooks } from 'node:module'
import { APP_ROLES } from '../src/lib/roles.ts'

// Execute the real source actions/query and existing draft UPDATE against a
// predicate-aware, rollback-capable serial transaction adapter. This proves
// orchestration/arguments, not MariaDB locks or actual DATETIME(3) persistence.
let state
let tail = Promise.resolve()
const clone = value => structuredClone(value)
const calls = kind => state.calls.filter(call => call.kind === kind)
const record = (kind, args) => state.calls.push({ kind, args: clone(args) })
const base = new Date('2026-09-27T01:02:03.456Z')
const actor = { id: 'creator-a', role: 'CREATOR', status: 'ACTIVE' }
const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nội dung tiếng Việt' }] }] }
function article(overrides = {}) { return { id: 'article-a', authorId: actor.id, status: 'DRAFT', title: 'Bài viết', slug: 'bai-viet',
  contentJson: clone(doc), contentText: 'Nội dung tiếng Việt', editorSchemaVersion: 1, updatedAt: new Date(base), ...overrides } }
function row(overrides = {}) { return { id: 'source-a', articleId: 'article-a', createdById: actor.id, sourceType: 'REPORT', title: 'Báo cáo',
  publisher: null, url: null, publishedAt: null, accessedAt: null, dataTimestamp: null, note: null,
  createdAt: new Date(base), updatedAt: new Date(base), ...overrides } }
function scenario(overrides = {}) {
  state = { session: { user: clone(actor) }, freshActor: clone(actor), article: article(), sources: [row()], calls: [], logs: [],
    serial: 1, inTransaction: false, ...overrides }
  tail = Promise.resolve()
}
const input = changes => ({ sourceType: 'WEBSITE', title: '  Nguồn mới tiếng Việt  ', url: 'HTTPS://EXAMPLE.COM:443/x?q=1#z',
  expectedUpdatedAt: base.toISOString(), publishedAt: '2026-09-26T00:00:00.123Z', ...changes })
function matches(value, where) {
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'AND') return expected.every(condition => matches(value, condition))
    if (expected instanceof Date) return value[key]?.getTime() === expected.getTime()
    if (expected && typeof expected === 'object') return expected.in?.includes(value[key]) ?? false
    return value[key] === expected
  })
}
const select = (value, fields) => value === null ? null : clone(Object.fromEntries(Object.keys(fields).filter(key => fields[key]).map(key => [key, value[key]])))
const adapter = {
  authOptions: {},
  async getServerSession() { record('session'); if (state.sessionError) throw state.sessionError; return clone(state.session) },
  async requirePermission() { throw new Error('SOURCE MUST NOT USE REDIRECT GUARD') },
  revalidatePath(path) { assert.equal(state.inTransaction, false); record('revalidate', path); if (state.cacheError) throw state.cacheError },
  prisma: { async $transaction(callback, options) {
    record('transaction', options)
    const previous = tail
    let release
    tail = new Promise(resolve => { release = resolve })
    await previous
    const before = clone({ article: state.article, sources: state.sources })
    state.inTransaction = true
    let reads = 0
    const fail = name => { if (state[name]) throw state[name] }
    const tx = {
      user: { async findUnique(args) { record('actor', args); return clone(state.freshActor) } },
      article: {
        async findFirst(args) {
          record('parent', args); reads++
          if (reads > 1) { fail('persistedError'); if (state.persistedMissing) return null }
          return state.article && matches(state.article, args.where) ? select(state.article, args.select) : null
        },
        async updateMany(args) {
          record('claim', args); fail('claimError')
          if (state.beforeClaim) state.beforeClaim(state)
          if (state.claimCount === 0 || !matches(state.article, args.where)) return { count: 0 }
          Object.assign(state.article, clone(args.data))
          if (state.persistedTimestamp) state.article.updatedAt = clone(state.persistedTimestamp)
          return { count: 1 }
        },
      },
      sourceReference: {
        async findFirst(args) { record('child', args); const found = state.sources.find(item => matches(item, args.where)); return found ? select(found, args.select) : null },
        async findMany(args) {
          record('list', args); fail('listError')
          return state.sources.filter(item => matches(item, args.where))
            .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).map(item => select(item, args.select))
        },
        async count(args) { record('count', args); return state.sources.filter(item => matches(item, args.where)).length },
        async create(args) { record('create', args); fail('childError'); const child = row({ ...clone(args.data), id: `new-${state.serial++}` }); state.sources.push(child); return select(child, args.select) },
        async updateMany(args) {
          record('update', args); fail('childError')
          const children = state.sources.filter(item => matches(item, args.where))
          if (state.childCount === 0) return { count: 0 }
          children.forEach(item => Object.assign(item, clone(args.data), { updatedAt: new Date() }))
          return { count: children.length }
        },
        async deleteMany(args) {
          record('delete', args); fail('childError')
          if (state.childCount === 0) return { count: 0 }
          const previousLength = state.sources.length
          state.sources = state.sources.filter(item => !matches(item, args.where))
          return { count: previousLength - state.sources.length }
        },
      },
    }
    try { fail('transactionError'); const result = await callback(tx); fail('commitError'); record('commit'); return result }
    catch (error) { Object.assign(state, before); record('rollback'); throw error }
    finally { state.inTransaction = false; release() }
  } },
}
const originalError = console.error
console.error = (...args) => state.logs.push(args)
after(() => { console.error = originalError })
globalThis[Symbol.for('cms-source-test')] = adapter
const dataModule = code => `data:text/javascript,${encodeURIComponent(`const a=globalThis[Symbol.for('cms-source-test')];${code}`)}`
const sourceRoot = new URL('../src/', import.meta.url)
const compiled = new URL('../node_modules/next/dist/compiled/', import.meta.url)
const replacements = new Map([
  ['next-auth', dataModule('export const getServerSession=a.getServerSession;')], ['@/lib/auth', dataModule('export const authOptions=a.authOptions;')],
  ['@/lib/authz', dataModule('export const requirePermission=a.requirePermission;')], ['@/lib/prisma', dataModule('export const prisma=a.prisma;')],
  ['next/cache', dataModule('export const revalidatePath=a.revalidatePath;')], ['server-only', 'data:text/javascript,export {};'],
])
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (replacements.has(specifier)) return nextResolve(replacements.get(specifier), context)
  if (specifier.startsWith('@/')) return nextResolve(new URL(`${specifier.slice(2)}.ts`, sourceRoot).href, context)
  if (context.parentURL?.startsWith(sourceRoot.href) && specifier.startsWith('./') && !specifier.endsWith('.ts')) return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context)
  if (context.parentURL?.startsWith(new URL('react-server-dom-turbopack/', compiled).href)) {
    const target = specifier === 'react' ? 'react/cjs/react.react-server.production.js' : specifier === 'react-dom' ? 'react-dom/cjs/react-dom.production.js' : null
    if (target) return { url: new URL(target, compiled).href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
} })
let createArticleSource, updateArticleSource, deleteArticleSource, getArticleSources, updateArticleDraft, client, server
try {
  ;({ createArticleSource, updateArticleSource, deleteArticleSource } = await import('../src/features/cms/article-source-actions.ts'))
  ;({ getArticleSources } = await import('../src/features/cms/article-source-query.ts'))
  ;({ updateArticleDraft } = await import('../src/features/cms/article-draft-actions.ts'))
  const require = createRequire(import.meta.url)
  client = require('next/dist/compiled/react-server-dom-turbopack/cjs/react-server-dom-turbopack-client.browser.production.js')
  server = require('next/dist/compiled/react-server-dom-turbopack/cjs/react-server-dom-turbopack-server.node.production.js')
} finally { hooks.deregister(); delete globalThis[Symbol.for('cms-source-test')] }
const operations = {
  create: (payload = input()) => createArticleSource('article-a', payload),
  update: (payload = input()) => updateArticleSource('article-a', 'source-a', payload),
  delete: (payload = { expectedUpdatedAt: base.toISOString() }) => deleteArticleSource('article-a', 'source-a', payload),
}
function failure(result, code) { assert.equal(result.ok, false); assert.equal(result.error.code, code); assert.equal(JSON.stringify(result).includes('SECRET'), false) }
const unchanged = before => { assert.deepEqual(state.article, before.article); assert.deepEqual(state.sources, before.sources) }
const stored = () => clone({ article: state.article, sources: state.sources })

test('SRC-01/14: every mutation denies missing sessions and non-CMS roles before validation/transaction', async () => {
  for (const session of [null, {}, { user: {} }, ...APP_ROLES.filter(role => !['CREATOR', 'ADMIN', 'SUPER_ADMIN'].includes(role)).map(role => ({ user: { id: actor.id, role } }))]) {
    for (const mutate of Object.values(operations)) { scenario({ session }); failure(await mutate(null), 'FORBIDDEN'); assert.deepEqual(state.calls.map(c => c.kind), ['session']) }
  }
})
test('SRC-14: fresh actor absent/inactive/changed role blocks both read and writes before parent access', async () => {
  for (const freshActor of [null, { ...actor, status: 'INACTIVE' }, { ...actor, role: 'ADMIN' }, { ...actor, role: 'ANALYST' }]) {
    for (const invoke of [...Object.values(operations), () => getArticleSources(actor, 'article-a')]) {
      scenario({ freshActor }); failure(await invoke(), 'FORBIDDEN'); assert.equal(calls('parent').length, 0)
    }
  }
})
test('SRC-01/03: parent scope gates read/child lookup, ownership is Article not source creator', async () => {
  for (const invoke of [...Object.values(operations), () => getArticleSources(actor, 'article-a')]) {
    scenario({ article: article({ authorId: 'other' }) }); failure(await invoke(), 'NOT_FOUND'); assert.equal(calls('child').length + calls('list').length, 0)
  }
  for (const role of ['CREATOR', 'ADMIN', 'SUPER_ADMIN']) {
    scenario({ session: { user: { ...actor, role } }, freshActor: { ...actor, role }, sources: [row({ createdById: 'other-creator' })] })
    if (role !== 'CREATOR') state.article.authorId = 'other-owner'
    assert.equal((await operations.update()).ok, true)
    assert.equal(state.sources[0].createdById, 'other-creator')
  }
})
test('SRC-04: noneditable states are read-only for admins too; unsupported content fails closed', async () => {
  for (const changes of [...['SUBMITTED', 'EDITORIAL_REVIEW', 'FACT_CHECK', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'CORRECTED', 'ARCHIVED'].map(status => ({ status })),
    { editorSchemaVersion: 2 }, { contentJson: { type: 'doc', content: [{ type: 'image' }] } }]) {
    scenario({ article: article(changes) }); const read = await getArticleSources(actor, 'article-a')
    assert.equal(read.ok, true); assert.equal(read.data.canMutate, false)
    const expected = changes.status ? 'NOT_EDITABLE' : 'UNSUPPORTED_DOCUMENT'
    assert.equal(read.data.readOnlyReason, expected)
    for (const mutate of Object.values(operations)) {
      scenario({ article: article(changes), freshActor: { ...actor, role: 'ADMIN' }, session: { user: { ...actor, role: 'ADMIN' } } })
      failure(await mutate(), expected); assert.equal(calls('claim').length, 0)
    }
  }
  scenario({ article: article({ status: 'CHANGES_REQUESTED' }) }); assert.equal((await operations.create()).ok, true)
})
test('SRC-01/05: malformed IDs and mismatched parent/child fail without global child existence disclosure', async () => {
  for (const bad of [null, 'a/b', '', 'a'.repeat(192)]) { scenario(); failure(await updateArticleSource('article-a', bad, input()), 'NOT_FOUND'); assert.equal(calls('transaction').length, 0) }
  scenario({ sources: [row({ articleId: 'other-article' })] }); failure(await operations.update(), 'NOT_FOUND')
  assert.deepEqual(calls('child')[0].args.where, { id: 'source-a', articleId: 'article-a' }); assert.equal(calls('claim').length, 0)
})
test('SRC-02/03/15: create/update/delete use explicit fields; immutable child fields and parent content survive', async () => {
  for (const [name, mutate] of Object.entries(operations)) {
    scenario(); const before = stored(); const result = await mutate()
    assert.equal(result.ok, true); assert.ok(new Date(result.data.updatedAt) > base)
    assert.deepEqual(Object.keys(calls('claim')[0].args.data), ['updatedAt'])
    assert.deepEqual({ ...state.article, updatedAt: base }, before.article)
    const claimed = calls('claim')[0].args.where.AND
    assert.deepEqual(claimed, [{ id: 'article-a' }, { authorId: actor.id }, { status: { in: ['DRAFT', 'CHANGES_REQUESTED'] } },
      { updatedAt: base }, { authorId: actor.id, status: 'DRAFT', editorSchemaVersion: 1 }])
    assert.equal(calls('transaction')[0].args.isolationLevel, 'Serializable')
    assert.equal(result.data.updatedAt, state.article.updatedAt.toISOString())
    if (name === 'create') { assert.equal(state.sources[1].articleId, 'article-a'); assert.equal(state.sources[1].createdById, actor.id) }
    if (name === 'update') {
      assert.equal(state.sources[0].title, 'Nguồn mới tiếng Việt'); assert.equal(state.sources[0].publishedAt.toISOString(), '2026-09-26T00:00:00.123Z')
      for (const field of ['id', 'articleId', 'createdById', 'createdAt']) assert.deepEqual(state.sources[0][field], before.sources[0][field])
      assert.deepEqual(Object.keys(calls('update')[0].args.data).sort(), ['accessedAt', 'dataTimestamp', 'note', 'publishedAt', 'publisher', 'sourceType', 'title', 'url'])
    }
    if (name === 'delete') assert.equal(state.sources.length, 0)
    assert.deepEqual(calls('revalidate').map(c => c.args), ['/creator', '/creator/articles', '/creator/articles/article-a/edit', '/creator/articles/article-a/sources'])
  }
})
test('SRC-12: stale source token conflicts; new successful ACK token enables the next explicit operation', async () => {
  scenario(); const first = await operations.create(); assert.equal(first.ok, true)
  const before = stored(); failure(await operations.update(), 'EDIT_CONFLICT'); unchanged(before)
  assert.equal((await operations.update(input({ expectedUpdatedAt: first.data.updatedAt }))).ok, true)
})
test('SRC-06: 100-source cap checked inside transaction, duplicate metadata allowed below cap, cap rollback restores token', async () => {
  scenario({ sources: Array.from({ length: 100 }, (_, index) => row({ id: `s-${index}` })) }); const before = stored()
  failure(await operations.create(), 'SOURCE_LIMIT_REACHED'); unchanged(before); assert.equal(calls('rollback').length, 1)
  scenario({ sources: [row({ title: 'Nguồn mới tiếng Việt' })] }); assert.equal((await operations.create()).ok, true)
  assert.equal(state.sources.length, 2)
})
test('SRC-06/12: two source operations from same token produce exactly one winner; cap 99 cannot become 101', async () => {
  for (const other of [operations.create, operations.update, operations.delete]) {
    scenario(); const results = await Promise.all([operations.create(), other()])
    assert.equal(results.filter(r => r.ok).length, 1); failure(results.find(r => !r.ok), 'EDIT_CONFLICT')
  }
  scenario({ sources: Array.from({ length: 99 }, (_, index) => row({ id: `s-${index}` })) })
  const results = await Promise.all([operations.create(), operations.create()])
  assert.equal(results.filter(r => r.ok).length, 1); assert.equal(state.sources.length, 100)
})
test('SRC-13: real draft UPDATE and source mutation share the token in both winner orders', async () => {
  const updateDraft = () => updateArticleDraft('article-a', { title: 'Thay đổi', slug: 'thay-doi', excerpt: '', articleType: 'NEWS', contentJson: doc, expectedUpdatedAt: base.toISOString() })
  for (const order of [[operations.create, updateDraft], [updateDraft, operations.create]]) {
    scenario(); const results = await Promise.all(order.map(invoke => invoke()))
    assert.equal(results[0].ok, true); failure(results[1], 'EDIT_CONFLICT')
    if (order[0] === updateDraft) { assert.equal(state.article.title, 'Thay đổi'); assert.equal(state.sources.length, 1) }
    else { assert.equal(state.article.title, 'Bài viết'); assert.equal(state.sources.length, 2) }
  }
})
test('SRC-14/16: conditional claim rechecks owner/status/schema and rolls back a failed race', async () => {
  for (const changes of [{ authorId: 'other' }, { status: 'PUBLISHED' }, { editorSchemaVersion: 2 }, { updatedAt: new Date(base.getTime() + 1) }]) {
    scenario({ beforeClaim(value) { Object.assign(value.article, changes) } }); const before = stored()
    failure(await operations.create(), 'EDIT_CONFLICT'); unchanged(before); assert.equal(calls('create').length, 0)
  }
})
for (const [injection, expected] of [['childError', 'INTERNAL_ERROR'], ['listError', 'INTERNAL_ERROR'], ['persistedError', 'INTERNAL_ERROR'],
  ['commitError', 'INTERNAL_ERROR'], ['persistedMissing', 'NOT_FOUND'], ['persistedTimestamp', 'EDIT_CONFLICT'], ['claimCount', 'EDIT_CONFLICT']]) {
  test(`SRC-16: ${injection} rolls back parent token and child mutation together`, async () => {
    for (const mutate of Object.values(operations)) {
      scenario({ [injection]: injection === 'persistedTimestamp' ? base : injection === 'claimCount' ? 0 : injection === 'persistedMissing' ? true : new Error('SECRET') })
      const before = stored(); failure(await mutate(), expected); unchanged(before); assert.equal(calls('revalidate').length, 0)
    }
  })
}
test('SRC-16: zero child update/delete counts roll back the already claimed parent', async () => {
  for (const mutate of [operations.update, operations.delete]) { scenario({ childCount: 0 }); const before = stored(); failure(await mutate(), 'NOT_FOUND'); unchanged(before) }
})
test('SRC-16/19: Prisma conflict errors safe-map without retry; unique/FK are generic and cache failure stays successful', async () => {
  for (const error of [{ code: 'P2034' }, { code: 'P2010', meta: { driverAdapterError: { cause: { kind: 'TransactionWriteConflict' } } } }, { code: 'P2002' }, { code: 'P2003' }]) {
    scenario({ childError: error }); const before = stored(); failure(await operations.create(), ['P2034', 'P2010'].includes(error.code) ? 'EDIT_CONFLICT' : 'INTERNAL_ERROR'); unchanged(before)
    assert.equal(calls('transaction').length, 1)
  }
  scenario({ cacheError: new Error('SECRET') }); const result = await operations.create()
  assert.equal(result.ok, true); assert.ok(result.warning); assert.equal(state.sources.length, 2); assert.equal(calls('commit').length, 1)
})
test('SRC-18: a lost ACK followed by a stale manual request cannot duplicate a committed source', async () => {
  scenario(); await operations.create() // response deliberately discarded
  const persisted = stored(); failure(await operations.create(), 'EDIT_CONFLICT'); unchanged(persisted); assert.equal(state.sources.length, 2)
})
test('SRC-10/22: read snapshot scopes parent before stable source ordering; explicit DTO has no content/parent objects', async () => {
  scenario({ sources: [row({ id: 'z', url: 'javascript:alert(1)' }), row({ id: 'a', createdAt: new Date(base.getTime() - 1), url: 'https://EXAMPLE.com' }), row({ id: 'outside', articleId: 'other' })] })
  const result = await getArticleSources(actor, 'article-a'); assert.equal(result.ok, true)
  assert.deepEqual(result.data.sources.map(item => item.id), ['a', 'z'])
  assert.equal(result.data.sources[0].safeUrl, 'https://example.com/'); assert.equal(result.data.sources[1].safeUrl, null)
  assert.equal(result.data.sources[1].url, 'javascript:alert(1)')
  assert.equal('contentJson' in result.data, false); assert.equal('authorId' in result.data, false)
  assert.equal('articleId' in result.data.sources[0], false)
  assert.deepEqual(calls('list')[0].args.orderBy, [{ createdAt: 'asc' }, { id: 'asc' }])
  assert.equal(calls('claim').length, 0); assert.equal(calls('transaction')[0].args.isolationLevel, 'Serializable')
})
test('SRC-22: actual query and mutation ACK DTOs survive installed Flight both directions without loss', async () => {
  scenario(); const saved = await operations.create(); const read = await getArticleSources(actor, 'article-a')
  assert.deepEqual(saved.data, read.data)
  for (const value of [saved, read]) {
    const errors = []
    const stream = server.renderToReadableStream(value, {}, { onError(error) { errors.push(error); return 'source-test' } })
    const decoded = await client.createFromReadableStream(stream, {})
    assert.deepEqual(decoded, value); assert.equal(errors.length, 0)
    const wire = await client.encodeReply(value, { temporaryReferences: client.createTemporaryReferenceSet() })
    const received = await server.decodeReply(wire, {}, { temporaryReferences: server.createTemporaryReferenceSet() })
    assert.deepEqual(received, value)
  }
})

test('SRC-22: malformed stored dates return safe failures and roll back source mutation before ACK', async () => {
  for (const field of ['publishedAt', 'accessedAt', 'dataTimestamp', 'createdAt', 'updatedAt']) {
    for (const date of [new Date(NaN), new Date('0999-12-31T00:00:00.000Z')]) {
      scenario({ sources: [row({ [field]: date })] })
      failure(await getArticleSources(actor, 'article-a'), 'INTERNAL_ERROR')
      const before = stored(); failure(await operations.create(), 'INTERNAL_ERROR')
      assert.deepEqual(state.article, before.article)
      // Node22 deepStrictEqual treats distinct Invalid Dates as unequal; compare
      // the malformed timestamp numerically (NaN included) and every other field.
      assert.deepEqual(state.sources.map(source => ({ ...source, [field]: source[field].getTime() })),
        before.sources.map(source => ({ ...source, [field]: source[field].getTime() })))
    }
  }
})

test('SRC-03/05/06: creator/admin/super create identity is server-owned; hostile metadata never reaches transaction', async () => {
  for (const role of ['CREATOR', 'ADMIN', 'SUPER_ADMIN']) {
    scenario({ freshActor: { ...actor, role }, session: { user: { ...actor, role } }, article: article({ authorId: role === 'CREATOR' ? actor.id : 'other' }) })
    assert.equal((await operations.create()).ok, true)
    assert.equal(state.sources[1].createdById, actor.id); assert.equal(state.sources[1].articleId, 'article-a')
  }
  let getterCalls = 0
  const hostile = Object.defineProperty(input(), 'note', { enumerable: true, get() { getterCalls++; return 'bad' } })
  for (const payload of [hostile, input({ createdById: 'other' }), input({ updatedAt: base.toISOString() }), input({ title: ' ' }), input({ sourceType: 'FAKE' })]) {
    scenario(); failure(await operations.create(payload), 'VALIDATION_ERROR'); assert.equal(calls('transaction').length, 0)
  }
  assert.equal(getterCalls, 0)
  scenario({ sources: Array.from({ length: 100 }, (_, index) => row({ id: index === 0 ? 'source-a' : `s-${index}` })) })
  const updated = await operations.update(); assert.equal(updated.ok, true); assert.equal(state.sources.length, 100)
  assert.equal((await operations.delete({ expectedUpdatedAt: updated.data.updatedAt })).ok, true); assert.equal(state.sources.length, 99)
})
test('SRC-17: future parent clock advances exactly +1ms for each source operation and persisted ACK', async () => {
  const future = new Date(Date.now() + 3_600_000)
  scenario({ article: article({ updatedAt: future }) })
  const created = await operations.create(input({ expectedUpdatedAt: future.toISOString() }))
  assert.equal(created.ok, true); assert.equal(new Date(created.data.updatedAt).getTime(), future.getTime() + 1)
  const updated = await operations.update(input({ expectedUpdatedAt: created.data.updatedAt }))
  assert.equal(updated.ok, true); assert.equal(new Date(updated.data.updatedAt).getTime(), future.getTime() + 2)
  const deleted = await operations.delete({ expectedUpdatedAt: updated.data.updatedAt })
  assert.equal(deleted.ok, true); assert.equal(new Date(deleted.data.updatedAt).getTime(), future.getTime() + 3)
})
