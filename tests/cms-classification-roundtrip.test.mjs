import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { holdTaxonomyResponses, observeTaxonomyActions } from './e2e/cms-taxonomy-support.ts'

// Local protocol/controller/action integration, using actual application modules.
// Only session/cache/Prisma and the browser transport are synthetic adapters.
// This cannot identify the missing staging checkpoint or prove MariaDB/browser behavior.
const copy = value => structuredClone(value)
const actor = { id: 'creator-a', role: 'CREATOR', status: 'ACTIVE' }
const initialDate = new Date('2099-01-01T00:00:00.123Z')
const term = (kind, n) => ({ id: `${kind}-${n}`, name: `Tên ${kind} ${n}`, slug: `${kind}-${n}`,
  isActive: true, sortOrder: 0, canonicalKey: `LOCAL:${n}`, symbol: `LOCAL${n}`,
  createdAt: initialDate, updatedAt: initialDate })
const initial = {
  article: { id: 'article-a', authorId: actor.id, title: 'Bài viết cần giữ', slug: 'bai-viet-can-giu', status: 'DRAFT',
    excerpt: 'Tóm tắt', articleType: 'NEWS', editorId: 'editor-a', coverMediaId: 'media-a', seoTitle: 'SEO',
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nội dung tiếng Việt' }] }] },
    contentText: 'Nội dung tiếng Việt', editorSchemaVersion: 1, categoryId: null,
    updatedAt: initialDate, createdAt: new Date('2026-01-01T00:00:00.001Z'), publishedAt: null },
  categories: [1, 7].map(n => term('category', n)), topics: [1, 7].map(n => term('topic', n)),
  tags: [1, 7].map(n => term('tag', n)), instruments: [1, 7, 8].map(n => term('instrument', n)),
  topicMappings: [], tagMappings: [], articleInstruments: [],
  sources: [{ id: 'source-a', articleId: 'article-a', title: 'Nguồn cần giữ', createdById: actor.id,
    createdAt: initialDate, updatedAt: initialDate }],
}
let state = copy(initial), inTransaction = false, claims = 0, transactions = 0
const cachePaths = []
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return value.every(item => matches(row, item))
    if (key === 'OR') return value.some(item => matches(row, item))
    if (value instanceof Date) return row[key]?.getTime() === value.getTime()
    if (value && typeof value === 'object') {
      if ('in' in value) return value.in.includes(row[key])
      if ('contains' in value) return row[key]?.includes(value.contains) ?? false
      throw new Error(`Unimplemented predicate: ${key}`)
    }
    return row[key] === value
  })
}
const selected = (row, select) => row === null ? null : copy(select
  ? Object.fromEntries(Object.keys(select).filter(key => select[key]).map(key => [key, row[key]])) : row)
function delegate(key) {
  return {
    async findMany(args) {
      let rows = state[key].filter(row => matches(row, args.where))
      for (const order of [...(args.orderBy ?? [])].reverse()) {
        const [field] = Object.keys(order)
        rows = rows.sort((a, b) => typeof a[field] === 'string' ? a[field].localeCompare(b[field]) : a[field] - b[field])
      }
      return rows.slice(args.skip ?? 0, args.take === undefined ? undefined : (args.skip ?? 0) + args.take).map(row => selected(row, args.select))
    },
    async count(args) { return state[key].filter(row => matches(row, args.where)).length },
    async create(args) { state[key].push(copy(args.data)); return selected(args.data, args.select) },
    async deleteMany(args) {
      const count = state[key].filter(row => matches(row, args.where)).length
      state[key] = state[key].filter(row => !matches(row, args.where)); return { count }
    },
    async updateMany(args) {
      const rows = state[key].filter(row => matches(row, args.where)); rows.forEach(row => Object.assign(row, copy(args.data)))
      assert.ok(state.articleInstruments.filter(row => row.isPrimary).length <= 1)
      return { count: rows.length }
    },
  }
}
const adapter = {
  async getServerSession() { return { user: copy(actor) } },
  revalidatePath(path) { assert.equal(inTransaction, false); cachePaths.push(path) },
  prisma: { async $transaction(callback, options) {
    assert.equal(options.isolationLevel, 'Serializable'); assert.equal(inTransaction, false)
    const before = copy(state); inTransaction = true; transactions++
    const tx = {
      user: { async findUnique(args) { assert.equal(args.where.id, actor.id); return copy(actor) } },
      article: {
        async findFirst(args) { return matches(state.article, args.where) ? selected(state.article, args.select) : null },
        async updateMany(args) {
          if (!matches(state.article, args.where)) return { count: 0 }
          assert.deepEqual(Object.keys(args.data).sort(), ['categoryId', 'updatedAt'])
          Object.assign(state.article, copy(args.data)); claims++; return { count: 1 }
        },
      },
      articleCategory: delegate('categories'), articleTopic: delegate('topics'), articleTag: delegate('tags'),
      financialInstrument: delegate('instruments'), articleTopicMapping: delegate('topicMappings'),
      articleTagMapping: delegate('tagMappings'), articleInstrument: delegate('articleInstruments'),
    }
    try { return await callback(tx) } catch (error) { state = before; throw error } finally { inTransaction = false }
  } },
}
const adapterKey = Symbol.for('cms-classification-roundtrip-adapter')
globalThis[adapterKey] = adapter
const moduleFor = code => `data:text/javascript,${encodeURIComponent(`const a=globalThis[Symbol.for('cms-classification-roundtrip-adapter')];${code}`)}`
const root = new URL('../src/', import.meta.url)
const replacements = new Map([
  ['server-only', 'data:text/javascript,export {};'], ['next-auth', moduleFor('export const getServerSession=a.getServerSession;')],
  ['@/lib/auth', 'data:text/javascript,export const authOptions={};'], ['@/lib/prisma', moduleFor('export const prisma=a.prisma;')],
  ['next/cache', moduleFor('export const revalidatePath=a.revalidatePath;')],
])
const hook = registerHooks({ resolve(specifier, context, next) {
  if (replacements.has(specifier)) return next(replacements.get(specifier), context)
  if (specifier.startsWith('@/')) return next(new URL(`${specifier.slice(2)}.ts`, root).href, context)
  if (context.parentURL?.startsWith(root.href) && specifier.startsWith('./') && !specifier.endsWith('.ts')) return next(new URL(`${specifier}.ts`, context.parentURL).href, context)
  return next(specifier, context)
} })
let updateArticleClassification, getArticleClassification, searchArticleClassificationOptions, createClassificationPanel, selectionFromSnapshot
try {
  ;({ updateArticleClassification } = await import('../src/features/cms/article-classification-actions.ts'))
  ;({ getArticleClassification } = await import('../src/features/cms/article-classification-query.ts'))
  ;({ searchArticleClassificationOptions } = await import('../src/features/cms/article-classification-options.ts'))
  ;({ createClassificationPanel } = await import('../src/features/cms/article-classification-panel.ts'))
  ;({ selectionFromSnapshot } = await import('../src/features/cms/article-classification.ts'))
} finally { hook.deregister(); delete globalThis[adapterKey] }

function browserAdapter() {
  const handlers = {}, routes = [], path = 'http://127.0.0.1:3001/creator/articles/article-a/classification'
  const ids = new Map([['updateArticleClassification', '40' + 'a'.repeat(40)], ['searchArticleClassificationOptions', '40' + 'b'.repeat(40)]])
  const page = { url: () => path, on(event, callback) { handlers[event] = callback },
    async route(pattern, callback) { assert.equal(pattern, '**/creator/**'); routes.push(callback) } }
  const observer = observeTaxonomyActions(page)
  handlers.response({ url: () => 'http://127.0.0.1:3001/_next/static/classification.js', async text() {
    return [...ids].map(([name, id]) => `(0,r.createServerReference)("${id}",r.callServer,void 0,r.findSourceMapURL,"${name}")`).join(';')
  } })
  async function dispatch(name, invoke) {
    const request = { method: () => 'POST', headers: () => ({ 'next-action': ids.get(name) }), url: () => path }
    handlers.request(request)
    let response, fulfilled = false
    const fetch = async () => { assert.equal(response, undefined, 'one action execution per request'); response = { result: await invoke() }; return response }
    const visit = async index => {
      if (index < 0) { await fetch(); fulfilled = true; return }
      // Playwright continue sends directly; only fallback would traverse older handlers.
      await routes[index]({ request: () => request, fetch, async continue() { await fetch(); fulfilled = true },
        async fulfill(input) { assert.equal(input.response, response); fulfilled = true }, async abort() { throw Error('Unexpected dropped ACK') } })
    }
    await visit(routes.length - 1); assert.equal(fulfilled, true); return response.result
  }
  return { page, observer, actions: {
    save: (id, input) => dispatch('updateArticleClassification', () => updateArticleClassification(id, input)),
    search: (id, kind, input) => dispatch('searchArticleClassificationOptions', () => searchArticleClassificationOptions(id, kind, input)),
  } }
}
const preserved = article => Object.fromEntries(Object.entries(article).filter(([field]) => !['categoryId', 'updatedAt'].includes(field)))
const empty = { categoryId: null, topicIds: [], tagIds: [], instrumentIds: [], primaryInstrumentId: null }
function assertGraph(expected) {
  assert.equal(state.article.categoryId, expected.categoryId)
  assert.deepEqual(state.topicMappings.map(row => row.topicId).sort(), expected.topicIds)
  assert.deepEqual(state.tagMappings.map(row => row.tagId).sort(), expected.tagIds)
  assert.deepEqual(state.articleInstruments.map(row => row.instrumentId).sort(), expected.instrumentIds)
  assert.deepEqual(state.articleInstruments.filter(row => row.isPrimary).map(row => row.instrumentId), expected.primaryInstrumentId ? [expected.primaryInstrumentId] : [])
  for (const row of [...state.topicMappings, ...state.tagMappings, ...state.articleInstruments]) assert.equal(row.articleId, initial.article.id)
  assert.deepEqual(preserved(state.article), preserved(initial.article)); assert.deepEqual(state.sources, initial.sources)
  for (const key of ['categories', 'topics', 'tags', 'instruments']) assert.deepEqual(state[key], initial[key])
}

test('TAX-10/11 six saves integrate real panel/actions/query/options with stacked response barriers and reload snapshots', async t => {
  const { page, observer, actions } = browserAdapter(), barriers = []
  await observer.ready('updateArticleClassification', 'searchArticleClassificationOptions')
  let panel, completed = 0
  async function reload(expected) {
    panel?.deactivate()
    const result = await getArticleClassification(actor, initial.article.id); assert.equal(result.ok, true)
    assert.deepEqual(selectionFromSnapshot(result.data), expected)
    panel = createClassificationPanel(result.data, actions); panel.activate()
    const before = copy(state), token = panel.getState().snapshot.updatedAt
    assert.equal(await panel.search('category', '', 1), true)
    assert.deepEqual(state, before); assert.equal(panel.getState().snapshot.updatedAt, token)
    assert.deepEqual(panel.getState().values, expected); assert.equal(panel.getState().pending, false)
  }
  async function choose(kind, id, checked = true) {
    assert.equal(await panel.search(kind, '', 1), true)
    const option = panel.getState().options.items.find(item => item.id === id); assert.ok(option)
    panel.choose(option, checked)
  }
  async function save(label, expected, changed = true) {
    const before = copy(state), oldToken = panel.getState().snapshot.updatedAt
    const barrier = await holdTaxonomyResponses(page, observer.ids, ['updateArticleClassification']); barriers.push(barrier)
    let settled = false
    const pending = panel.save().then(result => { settled = true; return result })
    await barrier.ready()
    assert.equal(settled, false); assert.equal(panel.getState().pending, true); assert.equal(barrier.started(), 1)
    assert.equal(panel.getState().snapshot.updatedAt, oldToken, 'held ACK cannot update the client token')
    assertGraph(expected)
    assert.equal(state.article.updatedAt.getTime(), new Date(oldToken).getTime() + (changed ? 1 : 0))
    if (!changed) assert.deepEqual(state, before)
    assert.equal(await panel.save(), false, 'single-flight suppresses a second click')
    barrier.release(); assert.equal(await pending, true)
    completed++; assert.equal(observer.count('updateArticleClassification'), completed)
    assert.equal(panel.getState().snapshot.updatedAt, state.article.updatedAt.toISOString())
    assert.equal(panel.getState().dirty, false); assert.equal(panel.getState().pending, false)
    assert.equal(panel.getState().message, 'Đã lưu phân loại.')
    await reload(expected)
    t.diagnostic(`${label}: held committed snapshot, exact ACK/token and fresh readonly reload PASS`)
  }
  try {
    await reload(empty)
    for (const kind of ['category', 'topic', 'tag', 'instrument']) await choose(kind, `${kind}-1`)
    await choose('instrument', 'instrument-7'); panel.primary('instrument-7')
    const assigned = { categoryId: 'category-1', topicIds: ['topic-1'], tagIds: ['tag-1'], instrumentIds: ['instrument-1', 'instrument-7'], primaryInstrumentId: 'instrument-7' }
    await save('assign', assigned)
    assert.equal(panel.getState().dirty, false); await save('clean/no-op', assigned, false)
    panel.primary('instrument-1'); const switched = { ...assigned, primaryInstrumentId: 'instrument-1' }
    await save('primary switch with both instruments retained', switched)
    panel.primary(null); const noPrimary = { ...switched, primaryInstrumentId: null }
    await save('primary null with both instruments retained', noPrimary)
    for (const kind of ['topic', 'tag', 'instrument']) await choose(kind, `${kind}-1`, false)
    for (const kind of ['category', 'topic', 'tag']) await choose(kind, `${kind}-7`)
    await choose('instrument', 'instrument-8')
    const replaced = { categoryId: 'category-7', topicIds: ['topic-7'], tagIds: ['tag-7'], instrumentIds: ['instrument-7', 'instrument-8'], primaryInstrumentId: null }
    await save('nonempty replacement', replaced)
    for (const kind of ['category', 'topic', 'tag', 'instrument']) await choose(kind, `${kind}-7`, false)
    await choose('instrument', 'instrument-8', false); await save('clear', empty)
    assert.equal(claims, 5); assert.equal(completed, 6); assert.equal(barriers.length, 6)
    assert.equal(cachePaths.length, 30); assert.equal(observer.count('searchArticleClassificationOptions'), 24)
    assert.equal(transactions, 37) // 6 saves + 7 selected queries + 24 readonly option searches.
  } finally { panel?.deactivate(); barriers.forEach(barrier => barrier.dispose()) }
})
