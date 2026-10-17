import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createRequire, registerHooks } from 'node:module'
import { APP_ROLES } from '../src/lib/roles.ts'

// Actual classification/query/search, draft, source and catalog actions against
// one predicate-aware rollback adapter. This tests contracts/serial outcomes;
// MariaDB locks, FK behavior and DATETIME(3) remain guarded staging evidence.
let state, tail = Promise.resolve()
const copy = value => structuredClone(value)
const token = '2026-09-28T01:02:03.456Z', base = new Date(token)
const actor = { id: 'creator-a', role: 'CREATOR', status: 'ACTIVE' }
const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nội dung tiếng Việt' }] }] }
const record = (kind, args) => state.calls.push({ kind, args: copy(args) })
const calls = kind => state.calls.filter(call => call.kind === kind)
const term = (id, changes = {}) => ({ id, name: `Tên ${id}`, slug: id, description: null, sortOrder: 0, isActive: true,
  canonicalKey: id.toUpperCase(), symbol: id.toUpperCase(), instrumentType: 'EQUITY', exchange: null, countryCode: null, currency: null,
  createdAt: new Date(base), updatedAt: new Date(base), ...changes })
const source = () => ({ id: 'source-a', articleId: 'article-a', createdById: actor.id, sourceType: 'REPORT', title: 'Báo cáo', publisher: null, url: null,
  note: null, publishedAt: null, accessedAt: null, dataTimestamp: null, createdAt: new Date(base), updatedAt: new Date(base) })
function scenario(overrides = {}) {
  state = { session: { user: copy(actor) }, freshActor: copy(actor), calls: [], logs: [], inTransaction: false,
    article: { id: 'article-a', title: 'Bài viết', slug: 'bai-viet', excerpt: '', articleType: 'NEWS', authorId: actor.id, status: 'DRAFT',
      accessMode: null, _count: { products: 0 },
      contentJson: copy(doc), contentText: 'Nội dung tiếng Việt', editorSchemaVersion: 1, updatedAt: new Date(base), categoryId: null,
      editorId: 'editor-original', coverMediaId: 'cover-original', seoTitle: 'SEO', publishedAt: null, createdAt: new Date(base) },
    categories: [term('category-a'), term('category-b')], topics: [term('topic-a'), term('topic-b')], tags: [term('tag-a'), term('tag-b')],
    instruments: [term('instrument-a'), term('instrument-b')], topicMappings: [], tagMappings: [], articleInstruments: [], sources: [source()], ...overrides }
  tail = Promise.resolve()
}
const dataKeys = ['article', 'categories', 'topics', 'tags', 'instruments', 'topicMappings', 'tagMappings', 'articleInstruments', 'sources']
const stored = () => copy(Object.fromEntries(dataKeys.map(key => [key, state[key]])))
function matches(value, where = {}) {
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'AND') return expected.every(condition => matches(value, condition))
    if (key === 'OR') return expected.some(condition => matches(value, condition))
    if (expected instanceof Date) return value[key]?.getTime() === expected.getTime()
    if (expected && typeof expected === 'object') {
      if ('in' in expected) return expected.in.includes(value[key])
      if ('contains' in expected) return value[key]?.includes(expected.contains) ?? false
      return false
    }
    return value[key] === expected
  })
}
const select = (value, fields) => value === null ? null : copy(fields ? Object.fromEntries(Object.keys(fields).filter(key => fields[key]).map(key => [key, value[key]])) : value)
function fail(kind) { if (state.inject === kind) throw state.injectError ?? Error('SECRET'); if (state.inject === 'any-child' && /Mapping\.|Instrument\./.test(kind) && !/find|count/.test(kind)) throw state.injectError ?? Error('SECRET') }
function delegate(name, key) {
  return {
    async findMany(args) {
      record(`${name}.findMany`, args); fail(`${name}.findMany`)
      let rows = state[key].filter(item => matches(item, args.where))
      for (const order of [...(args.orderBy ?? [])].reverse()) { const [field] = Object.keys(order); rows = rows.sort((a, b) => typeof a[field] === 'string' ? a[field].localeCompare(b[field]) : a[field] - b[field]) }
      return rows.slice(args.skip ?? 0, args.take === undefined ? undefined : (args.skip ?? 0) + args.take).map(item => select(item, args.select))
    },
    async findUnique(args) { record(`${name}.findUnique`, args); return select(state[key].find(item => matches(item, args.where)) ?? null, args.select) },
    async findFirst(args) { record(`${name}.findFirst`, args); return select(state[key].find(item => matches(item, args.where)) ?? null, args.select) },
    async count(args) { record(`${name}.count`, args); return state[key].filter(item => matches(item, args.where)).length },
    async create(args) {
      record(`${name}.create`, args); fail(`${name}.create`)
      const row = name === 'sourceReference' ? { ...source(), id: `source-${state.sources.length}`, ...copy(args.data) } : copy(args.data)
      state[key].push(row); return select(row, args.select)
    },
    async updateMany(args) {
      record(`${name}.updateMany`, args); fail(`${name}.updateMany`)
      const rows = state[key].filter(item => matches(item, args.where))
      if (state.zeroChild) return { count: 0 }
      rows.forEach(row => Object.assign(row, copy(args.data)))
      if (key === 'articleInstruments') assert.ok(state.articleInstruments.filter(row => row.isPrimary).length <= 1, 'never promote a second primary')
      return { count: rows.length }
    },
    async deleteMany(args) {
      record(`${name}.deleteMany`, args); fail(`${name}.deleteMany`)
      if (state.zeroChild) return { count: 0 }
      const previous = state[key].length; state[key] = state[key].filter(item => !matches(item, args.where)); return { count: previous - state[key].length }
    },
  }
}
const adapter = {
  authOptions: {}, async getServerSession() { record('session'); return copy(state.session) },
  async requirePermission() { throw Error('MUTATION MUST NOT REDIRECT') },
  revalidatePath(path) { assert.equal(state.inTransaction, false); record('revalidate', path); if (state.cacheError) throw Error('SECRET') },
  prisma: { async $transaction(callback, options) {
    record('transaction', options)
    const previous = tail; let release; tail = new Promise(resolve => { release = resolve }); await previous
    const before = stored(); state.inTransaction = true; let parentReads = 0
    const tx = { user: { async findUnique(args) { record('actor', args); return copy(state.freshActor) } },
      article: {
        async findFirst(args) { record('parent', args); parentReads++; if (parentReads > 1) fail('persisted'); return state.article && matches(state.article, args.where) ? select(state.article, args.select) : null },
        async count(args) { record('article.count', args); return state.article && matches(state.article, args.where) ? 1 : 0 },
        async updateMany(args) {
          record('claim', args); fail('claim'); state.beforeClaim?.(state)
          if (state.claimZero || !matches(state.article, args.where)) return { count: 0 }
          Object.assign(state.article, copy(args.data)); if (state.persistedToken) state.article.updatedAt = new Date(state.persistedToken)
          return { count: 1 }
        },
      },
      articleCategory: delegate('articleCategory', 'categories'), articleTopic: delegate('articleTopic', 'topics'), articleTag: delegate('articleTag', 'tags'),
      financialInstrument: delegate('financialInstrument', 'instruments'), articleTopicMapping: delegate('articleTopicMapping', 'topicMappings'),
      articleTagMapping: delegate('articleTagMapping', 'tagMappings'), articleInstrument: delegate('articleInstrument', 'articleInstruments'), sourceReference: delegate('sourceReference', 'sources'),
    }
    try { fail('transaction'); const result = await callback(tx); fail('commit'); record('commit'); return result }
    catch (error) { Object.assign(state, before); record('rollback'); throw error }
    finally { state.inTransaction = false; release() }
  } },
}
const originalError = console.error
console.error = (...args) => state.logs.push(args)
after(() => { console.error = originalError })
globalThis[Symbol.for('cms-classification-adapter')] = adapter
const moduleFor = code => `data:text/javascript,${encodeURIComponent(`const a=globalThis[Symbol.for('cms-classification-adapter')];${code}`)}`
const root = new URL('../src/', import.meta.url), compiled = new URL('../node_modules/next/dist/compiled/', import.meta.url)
const replacements = new Map([['server-only', 'data:text/javascript,export {};'], ['next-auth', moduleFor('export const getServerSession=a.getServerSession;')],
  ['@/lib/auth', moduleFor('export const authOptions=a.authOptions;')], ['@/lib/authz', moduleFor('export const requirePermission=a.requirePermission;')],
  ['@/lib/prisma', moduleFor('export const prisma=a.prisma;')], ['next/cache', moduleFor('export const revalidatePath=a.revalidatePath;')]])
const hook = registerHooks({ resolve(specifier, context, next) {
  if (replacements.has(specifier)) return next(replacements.get(specifier), context)
  if (specifier.startsWith('@/')) return next(new URL(`${specifier.slice(2)}.ts`, root).href, context)
  if (context.parentURL?.startsWith(root.href) && specifier.startsWith('./') && !specifier.endsWith('.ts')) return next(new URL(`${specifier}.ts`, context.parentURL).href, context)
  if (context.parentURL?.startsWith(new URL('react-server-dom-turbopack/', compiled).href)) {
    const target = specifier === 'react' ? 'react/cjs/react.react-server.production.js' : specifier === 'react-dom' ? 'react-dom/cjs/react-dom.production.js' : null
    if (target) return { url: new URL(target, compiled).href, shortCircuit: true }
  }
  return next(specifier, context)
} })
let updateArticleClassification, getArticleClassification, searchArticleClassificationOptions, updateArticleDraft, createArticleSource, updateArticleSource, deleteArticleSource, updateTaxonomy, deleteTaxonomy, client, server
try {
  ;({ updateArticleClassification } = await import('../src/features/cms/article-classification-actions.ts'))
  ;({ getArticleClassification } = await import('../src/features/cms/article-classification-query.ts'))
  ;({ searchArticleClassificationOptions } = await import('../src/features/cms/article-classification-options.ts'))
  ;({ updateArticleDraft } = await import('../src/features/cms/article-draft-actions.ts'))
  ;({ createArticleSource, updateArticleSource, deleteArticleSource } = await import('../src/features/cms/article-source-actions.ts'))
  ;({ updateTaxonomy, deleteTaxonomy } = await import('../src/features/cms/taxonomy-actions.ts'))
  const require = createRequire(import.meta.url)
  client = require('next/dist/compiled/react-server-dom-turbopack/cjs/react-server-dom-turbopack-client.browser.production.js')
  server = require('next/dist/compiled/react-server-dom-turbopack/cjs/react-server-dom-turbopack-server.node.production.js')
} finally { hook.deregister(); delete globalThis[Symbol.for('cms-classification-adapter')] }
const input = changes => ({ categoryId: 'category-a', topicIds: ['topic-a'], tagIds: ['tag-a'], instrumentIds: ['instrument-a', 'instrument-b'], primaryInstrumentId: 'instrument-a', expectedUpdatedAt: token, ...changes })
const mutate = (changes = {}) => updateArticleClassification('article-a', input(changes))
const read = () => getArticleClassification(state.session.user, 'article-a')
const search = () => searchArticleClassificationOptions('article-a', 'topic', { q: '', page: 1 })
function failure(result, code) { assert.equal(result.ok, false); assert.equal(result.error.code, code); assert.equal(JSON.stringify(result).includes('SECRET'), false) }
const empty = { categoryId: null, topicIds: [], tagIds: [], instrumentIds: [], primaryInstrumentId: null }

test('TAX-01/13/19: missing/non-CMS session denied before transaction; fresh roles and status checked before parent', async () => {
  for (const session of [null, {}, ...APP_ROLES.filter(role => !['CREATOR', 'ADMIN', 'SUPER_ADMIN'].includes(role)).map(role => ({ user: { ...actor, role } }))]) {
    for (const invoke of [mutate, search]) { scenario({ session }); failure(await invoke(), 'FORBIDDEN'); assert.equal(calls('transaction').length, 0) }
  }
  for (const freshActor of [null, { ...actor, status: 'SUSPENDED' }, { ...actor, role: 'ADMIN' }, { ...actor, role: 'ANALYST' }]) {
    for (const invoke of [mutate, read, search]) { scenario({ freshActor }); failure(await invoke(), 'FORBIDDEN'); assert.equal(calls('parent').length, 0) }
  }
})
test('TAX-01/13: scope precedes mappings/options and supports creator own/admin any without exposing owner', async () => {
  for (const invoke of [mutate, read, search]) {
    scenario(); state.article.authorId = 'foreign'; failure(await invoke(), 'NOT_FOUND')
    assert.equal(state.calls.some(call => /Mapping.findMany|Instrument.findMany|Topic.count/.test(call.kind)), false)
  }
  for (const role of ['CREATOR', 'ADMIN', 'SUPER_ADMIN']) {
    scenario({ session: { user: { ...actor, role } }, freshActor: { ...actor, role } }); if (role !== 'CREATOR') state.article.authorId = 'foreign'
    const before = state.article.authorId; const result = await mutate(); assert.equal(result.ok, true); assert.equal(state.article.authorId, before)
    assert.equal('authorId' in result.data, false); assert.equal('contentJson' in result.data, false)
  }
})
test('TAX-12: action rejects malformed parent ID and hostile selection before transaction', async () => {
  for (const id of [null, '', 'a/b', 'a'.repeat(192)]) { scenario(); failure(await updateArticleClassification(id, input()), 'NOT_FOUND'); assert.equal(calls('transaction').length, 0) }
  let getters = 0
  const hostile = Object.defineProperty(input(), 'topicIds', { enumerable: true, get() { getters++; return [] } })
  for (const value of [hostile, input({ authorId: 'foreign' }), input({ topicIds: ['topic-a', 'topic-a'] })]) {
    scenario(); failure(await updateArticleClassification('article-a', value), 'VALIDATION_ERROR'); assert.equal(calls('transaction').length, 0)
  }
  assert.equal(getters, 0)
})
test('TAX-14: all eight noneditable statuses and unsupported schema stay read-only, including admin', async () => {
  for (const changes of [...['SUBMITTED', 'EDITORIAL_REVIEW', 'FACT_CHECK', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'CORRECTED', 'ARCHIVED'].map(status => ({ status })),
    { editorSchemaVersion: 2 }, { contentJson: { type: 'doc', content: [{ type: 'image' }] } }]) {
    scenario({ session: { user: { ...actor, role: 'ADMIN' } }, freshActor: { ...actor, role: 'ADMIN' } }); Object.assign(state.article, changes)
    const result = await read(); assert.equal(result.ok, true); assert.equal(result.data.canMutate, false)
    failure(await mutate(), changes.status ? 'NOT_EDITABLE' : 'UNSUPPORTED_DOCUMENT'); assert.equal(calls('claim').length, 0)
  }
  scenario(); state.article.status = 'CHANGES_REQUESTED'; assert.equal((await mutate()).ok, true)
})
test('TAX-10/11/27: atomic exact diff, primary switch/clear, preserved content/source/catalog and persisted ACK', async () => {
  scenario(); const before = stored(); const result = await mutate(); assert.equal(result.ok, true)
  assert.equal(calls('transaction')[0].args.isolationLevel, 'Serializable')
  assert.deepEqual(Object.keys(calls('claim')[0].args.data), ['categoryId', 'updatedAt'])
  assert.deepEqual({ ...state.article, categoryId: before.article.categoryId, updatedAt: base }, before.article)
  for (const key of ['categories', 'topics', 'tags', 'instruments', 'sources']) assert.deepEqual(state[key], before[key])
  assert.equal(result.data.updatedAt, state.article.updatedAt.toISOString())
  assert.equal(result.data.instruments.filter(row => row.isPrimary).length, 1)
  const switched = await mutate({ primaryInstrumentId: 'instrument-b', expectedUpdatedAt: result.data.updatedAt }); assert.equal(switched.ok, true)
  const updates = calls('articleInstrument.updateMany'); assert.deepEqual(updates.map(c => c.args.data.isPrimary), [false, true])
  const cleared = await mutate({ ...empty, expectedUpdatedAt: switched.data.updatedAt }); assert.equal(cleared.ok, true)
  assert.equal(state.article.categoryId, null); assert.deepEqual(state.topicMappings, []); assert.deepEqual(state.tagMappings, []); assert.deepEqual(state.articleInstruments, [])
  for (const call of state.calls.filter(call => /Mapping.deleteMany|Instrument.deleteMany/.test(call.kind))) assert.equal(Object.keys(call.args.where).length, 2)
})
test('TAX-11: no-op is authorized and token-checked before success, with no writes/token bump', async () => {
  scenario(); const first = await mutate(); state.calls = []; const before = stored()
  const result = await mutate({ instrumentIds: ['instrument-b', 'instrument-a'], expectedUpdatedAt: first.data.updatedAt })
  assert.equal(result.ok, true); assert.deepEqual(stored(), before); assert.equal(calls('claim').length, 0)
  assert.equal(state.calls.some(c => /create|updateMany|deleteMany/.test(c.kind)), false)
  failure(await mutate(), 'EDIT_CONFLICT'); assert.deepEqual(stored(), before)
})
test('TAX-07/12: exact-kind/existence and active retention are checked inside transaction before claim', async () => {
  for (const changes of [{ categoryId: 'topic-a' }, { topicIds: ['category-a'] }, { tagIds: ['absent'] }, { instrumentIds: ['absent'], primaryInstrumentId: null }]) {
    scenario(); const before = stored(); failure(await mutate(changes), 'INVALID_SELECTION'); assert.deepEqual(stored(), before); assert.equal(calls('claim').length, 0)
  }
  for (const key of ['categories', 'topics', 'instruments']) {
    scenario(); state[key][0].isActive = false; failure(await mutate(), 'INVALID_SELECTION'); assert.equal(calls('claim').length, 0)
  }
  scenario(); let saved = await mutate(); for (const key of ['categories', 'topics', 'instruments']) state[key][0].isActive = false
  const result = await read(); assert.equal(result.ok, true); assert.equal(result.data.category.isActive, false); assert.equal(result.data.topics[0].isActive, false)
  saved = await mutate({ primaryInstrumentId: 'instrument-b', expectedUpdatedAt: saved.data.updatedAt }); assert.equal(saved.ok, true)
  saved = await mutate({ primaryInstrumentId: 'instrument-a', expectedUpdatedAt: saved.data.updatedAt }); assert.equal(saved.ok, true)
  saved = await mutate({ ...empty, expectedUpdatedAt: saved.data.updatedAt }); assert.equal(saved.ok, true)
  failure(await mutate({ expectedUpdatedAt: saved.data.updatedAt }), 'INVALID_SELECTION')
  for (const key of ['categories', 'topics', 'instruments']) state[key][0].isActive = true
  assert.equal((await mutate({ expectedUpdatedAt: saved.data.updatedAt })).ok, true)
})
test('TAX-09: read options are bounded/active sorted, scoped first, and never alter parent token', async () => {
  scenario({ topics: Array.from({ length: 31 }, (_, i) => term(`topic-${String(i).padStart(2, '0')}`)) })
  state.topics[0].isActive = false
  const before = stored(); const result = await searchArticleClassificationOptions('article-a', 'topic', { q: '', page: 99999 })
  assert.equal(result.ok, true); assert.equal(result.data.page, 2); assert.equal(result.data.total, 30); assert.equal(result.data.items.length, 5)
  assert.deepEqual(calls('articleTopic.count')[0].args.where, { isActive: true }); assert.equal(calls('articleTopic.findMany')[0].args.take, 25)
  assert.ok(state.calls.findIndex(c => c.kind === 'parent') < state.calls.findIndex(c => c.kind === 'articleTopic.count'))
  assert.deepEqual(stored(), before); assert.equal(calls('claim').length, 0)
  for (const params of [{ q: 'x'.repeat(101), page: 1 }, { q: '', page: 1, actorId: 'foreign' }]) failure(await searchArticleClassificationOptions('article-a', 'topic', params), 'VALIDATION_ERROR')
})
test('TAX-04/29: malformed stored picker metadata and hostile thrown errors remain INTERNAL_ERROR', async () => {
  scenario(); state.topics[0].name = null; failure(await search(), 'INTERNAL_ERROR')
  const hostile = new Proxy({}, { getPrototypeOf() { throw Error('SECRET') }, getOwnPropertyDescriptor() { throw Error('SECRET') } })
  scenario({ inject: 'articleTopic.findMany', injectError: hostile }); failure(await search(), 'INTERNAL_ERROR')
})
test('TAX-15/22: two same-token classification saves have one winner; lost ACK cannot replay a write', async () => {
  scenario(); const results = await Promise.all([mutate(), mutate({ categoryId: 'category-b' })])
  assert.equal(results[0].ok, true); failure(results[1], 'EDIT_CONFLICT'); assert.equal(state.article.categoryId, 'category-a')
  const before = stored(); failure(await mutate(), 'EDIT_CONFLICT'); assert.deepEqual(stored(), before)
})
test('TAX-16: actual draft UPDATE and classification share one token in both winner orders', async () => {
  const body = () => updateArticleDraft('article-a', { title: 'Đổi nội dung', slug: 'doi-noi-dung', excerpt: '', articleType: 'NEWS', contentJson: doc, expectedUpdatedAt: token })
  for (const order of [[mutate, body], [body, mutate]]) {
    scenario(); const results = await Promise.all(order.map(invoke => invoke())); assert.equal(results[0].ok, true); failure(results[1], 'EDIT_CONFLICT')
    assert.equal(state.article.title, order[0] === body ? 'Đổi nội dung' : 'Bài viết'); assert.equal(state.article.categoryId, order[0] === mutate ? 'category-a' : null)
    assert.equal(state.topicMappings.length, order[0] === mutate ? 1 : 0)
  }
})
test('TAX-17: actual source create/update/delete and classification use shared token in both orders', async () => {
  const data = { sourceType: 'WEBSITE', title: 'Nguồn đổi', expectedUpdatedAt: token }
  const operations = [() => createArticleSource('article-a', data), () => updateArticleSource('article-a', 'source-a', data), () => deleteArticleSource('article-a', 'source-a', { expectedUpdatedAt: token })]
  for (const sourceWrite of operations) for (const order of [[mutate, sourceWrite], [sourceWrite, mutate]]) {
    scenario(); const before = copy(state.sources); const results = await Promise.all(order.map(invoke => invoke()))
    assert.equal(results[0].ok, true); failure(results[1], 'EDIT_CONFLICT'); assert.equal(state.article.categoryId, order[0] === mutate ? 'category-a' : null)
    if (order[0] === mutate) assert.deepEqual(state.sources, before)
    else assert.notDeepEqual(state.sources, before)
  }
})
test('TAX-18: future timestamp advances exactly +1ms for successive classification saves and stale conflicts', async () => {
  scenario(); const future = new Date(Date.now() + 3600000); state.article.updatedAt = future
  const first = await mutate({ expectedUpdatedAt: future.toISOString() }); assert.equal(first.ok, true); assert.equal(new Date(first.data.updatedAt).getTime(), future.getTime() + 1)
  const next = await mutate({ categoryId: 'category-b', expectedUpdatedAt: first.data.updatedAt }); assert.equal(next.ok, true); assert.equal(new Date(next.data.updatedAt).getTime(), future.getTime() + 2)
  failure(await mutate({ expectedUpdatedAt: first.data.updatedAt }), 'EDIT_CONFLICT')
})
test('TAX-19/27: conditional parent claim rechecks owner/status/schema and rollback retains all fields', async () => {
  for (const change of [{ authorId: 'foreign' }, { status: 'PUBLISHED' }, { editorSchemaVersion: 2 }, { updatedAt: new Date(base.getTime() + 1) }]) {
    scenario({ beforeClaim(value) { Object.assign(value.article, change) } }); const before = stored()
    failure(await mutate(), 'EDIT_CONFLICT'); assert.deepEqual(stored(), before); assert.equal(calls('articleTopicMapping.create').length, 0)
  }
})
for (const inject of ['claim', 'articleTopicMapping.create', 'articleTagMapping.create', 'articleInstrument.create', 'persisted', 'commit']) {
  test(`TAX-27: ${inject} failure rolls back parent/category and every child together`, async () => {
    scenario({ inject }); const before = stored(); failure(await mutate(), 'INTERNAL_ERROR'); assert.deepEqual(stored(), before); assert.equal(calls('revalidate').length, 0)
  })
}
test('TAX-27: delete/update count mismatch, persisted precision and safe Prisma errors cannot partially commit', async () => {
  scenario(); const saved = await mutate(); state.zeroChild = true; const before = stored()
  failure(await mutate({ ...empty, expectedUpdatedAt: saved.data.updatedAt }), 'EDIT_CONFLICT'); assert.deepEqual(stored(), before)
  for (const args of [{ claimZero: true }, { persistedToken: token }]) {
    scenario(args); const before = stored(); failure(await mutate(), 'EDIT_CONFLICT'); assert.deepEqual(stored(), before)
  }
  for (const [error, code] of [[{ code: 'P2034' }, 'EDIT_CONFLICT'], [{ code: 'P2002' }, 'INTERNAL_ERROR'], [{ code: 'P2003' }, 'INVALID_SELECTION']]) {
    scenario({ inject: 'articleTagMapping.create', injectError: error }); const before = stored(); failure(await mutate(), code); assert.deepEqual(stored(), before); assert.equal(calls('transaction').length, 1)
  }
})
test('TAX-28: cache failure follows committed canonical success with warning, never another write', async () => {
  scenario({ cacheError: true }); const result = await mutate(); assert.equal(result.ok, true); assert.ok(result.warning)
  assert.equal(state.article.categoryId, 'category-a'); assert.equal(result.data.updatedAt, state.article.updatedAt.toISOString()); assert.equal(calls('commit').length, 1)
  assert.deepEqual(calls('revalidate').map(c => c.args), ['/creator', '/creator/articles', '/creator/articles/article-a/edit', '/creator/articles/article-a/sources', '/creator/articles/article-a/classification'])
})
test('TAX-29: excess selections and legacy identities preserved; multiple primary warns until explicit repair', async () => {
  scenario({ topics: Array.from({ length: 6 }, (_, i) => term(`topic-${i}`, { slug: 'Legacy / identity' })),
    topicMappings: Array.from({ length: 6 }, (_, i) => ({ articleId: 'article-a', topicId: `topic-${i}` })),
    articleInstruments: [{ articleId: 'article-a', instrumentId: 'instrument-a', isPrimary: true }, { articleId: 'article-a', instrumentId: 'instrument-b', isPrimary: true }] })
  const before = stored(), result = await read(); assert.equal(result.ok, true); assert.equal(result.data.topics.length, 6); assert.equal(result.data.warnings.length, 2)
  assert.equal(result.data.topics[0].slug, 'Legacy / identity'); assert.deepEqual(stored(), before)
  const repair = await mutate({ topicIds: ['topic-0'], primaryInstrumentId: null }); assert.equal(repair.ok, true); assert.equal(repair.data.instruments.filter(row => row.isPrimary).length, 0)
})
test('TAX-29: dangling rows, malformed metadata and dates return safe read errors without repairs', async () => {
  for (const corrupt of [() => { state.article.categoryId = 'missing' }, () => { state.topicMappings.push({ articleId: 'article-a', topicId: 'missing' }) },
    () => { state.article.categoryId = 'category-a'; state.categories[0].name = null }, () => { state.article.updatedAt = new Date('0999-01-01T00:00:00.000Z') }]) {
    scenario(); corrupt(); const before = stored(); failure(await read(), 'INTERNAL_ERROR'); assert.deepEqual(stored(), before); assert.equal(calls('claim').length, 0)
  }
})
test('TAX-29: actual query/ACK/option DTO survive installed Flight both directions', async () => {
  scenario(); const saved = await mutate(), result = await read(), options = await search(); assert.deepEqual(saved.data, result.data)
  for (const value of [saved, result, options]) {
    const errors = [], stream = server.renderToReadableStream(value, {}, { onError(error) { errors.push(error); return 'classification-test' } })
    assert.deepEqual(await client.createFromReadableStream(stream, {}), value); assert.deepEqual(errors, [])
    const wire = await client.encodeReply(value, { temporaryReferences: client.createTemporaryReferenceSet() })
    assert.deepEqual(await server.decodeReply(wire, {}, { temporaryReferences: server.createTemporaryReferenceSet() }), value)
  }
})
test('TAX-30: real catalog deactivate/delete and assignment serialize in both commit orders', async () => {
  const setup = () => scenario({ session: { user: { ...actor, role: 'ADMIN' } }, freshActor: { ...actor, role: 'ADMIN' } })
  const deactivate = () => updateTaxonomy('category', 'category-a', { name: 'Tên category-a', description: null, sortOrder: 0, isActive: false, expectedUpdatedAt: token })
  const remove = () => deleteTaxonomy('category', 'category-a', { expectedUpdatedAt: token })
  for (const order of [[mutate, deactivate], [deactivate, mutate]]) {
    setup(); const result = await Promise.all(order.map(invoke => invoke())); assert.equal(result[0].ok, true)
    if (order[0] === mutate) { assert.equal(result[1].ok, true); assert.equal(state.article.categoryId, 'category-a') }
    else { failure(result[1], 'INVALID_SELECTION'); assert.equal(state.article.categoryId, null) }
    assert.equal(state.categories[0].isActive, false)
  }
  for (const order of [[mutate, remove], [remove, mutate]]) {
    setup(); const result = await Promise.all(order.map(invoke => invoke())); assert.equal(result[0].ok, true)
    failure(result[1], order[0] === mutate ? 'TAXONOMY_IN_USE' : 'INVALID_SELECTION')
    assert.equal(state.article.categoryId, order[0] === mutate ? 'category-a' : null)
    assert.equal(state.categories.some(row => row.id === 'category-a'), order[0] === mutate)
  }
})
