import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createRequire, registerHooks } from 'node:module'
import { APP_ROLES } from '../src/lib/roles.ts'

const token = new Date('2099-09-28T01:02:03.456Z'), actor = { id: 'admin-a', role: 'ADMIN', status: 'ACTIVE' }
const kinds = ['category', 'topic', 'tag', 'instrument'], delegates = { category: 'articleCategory', topic: 'articleTopic', tag: 'articleTag', instrument: 'financialInstrument' }
const clone = value => structuredClone(value)
let state, tail
const input = (kind, update = false, changes = {}) => ({ name: 'Tên mới', ...(kind === 'instrument' ? { countryCode: 'VN', currency: 'VND', isActive: true, ...(!update ? { instrumentType: 'EQUITY', exchange: 'HOSE', symbol: 'VNM' } : {}) } : { ...(kind !== 'tag' ? { description: 'Mô tả', isActive: true } : {}), ...(kind === 'category' ? { sortOrder: 1 } : {}), ...(!update ? { slug: 'ten-moi' } : {}) }), ...(update ? { expectedUpdatedAt: token.toISOString() } : {}), ...changes })
const row = (kind, changes = {}) => ({ id: `${kind}-a`, name: 'Tên cũ', ...(kind === 'instrument' ? { canonicalKey: 'LEGACY-key', symbol: 'legacy symbol', instrumentType: 'EQUITY', exchange: 'old venue', countryCode: 'VN', currency: 'VND', isActive: true } : { slug: 'LEGACY slug', ...(kind !== 'tag' ? { description: 'Mô tả', isActive: true } : {}), ...(kind === 'category' ? { sortOrder: 1 } : {}) }), createdAt: new Date(token), updatedAt: new Date(token), ...changes })
const record = (kind, args) => state.calls.push({ kind, args: clone(args) })
const calls = kind => state.calls.filter(call => call.kind === kind)
function scenario(changes = {}) { state = { session: { user: clone(actor) }, actor: clone(actor), rows: Object.fromEntries(kinds.map(kind => [kind, [row(kind)]])), refs: {}, calls: [], logs: [], transaction: false, nextId: 0, ...changes }; tail = Promise.resolve() }
function matches(item, where = {}) {
  return Object.entries(where).every(([key, value]) => key === 'OR' ? value.some(part => matches(item, part)) : key === 'AND' ? value.every(part => matches(item, part))
    : value instanceof Date ? item[key]?.getTime() === value.getTime() : value && typeof value === 'object' ? typeof value.contains === 'string' && String(item[key] ?? '').includes(value.contains) : item[key] === value)
}
const select = (item, fields) => item ? clone(Object.fromEntries(Object.keys(fields).map(key => [key, item[key]]))) : null
const adapter = {
  async getServerSession() { record('session'); return clone(state.session) }, authOptions: {},
  revalidatePath(path, type) { assert.equal(state.transaction, false); record('revalidate', { path, type }); if (state.cacheError) throw new Error('SECRET') },
  prisma: { async $transaction(callback, options) {
    record('transaction', options)
    const previous = tail; let release; tail = new Promise(resolve => { release = resolve }); await previous
    const before = clone(state.rows); state.transaction = true
    const tx = { user: { async findUnique(args) { record('actor', args); return clone(state.actor) } } }
    for (const kind of kinds) {
      tx[delegates[kind]] = {
        async findUnique(args) { record('read', { kind, ...args }); if (state.readError) throw state.readError; return select(state.rows[kind].find(item => matches(item, args.where)), args.select) },
        async count(args) { record('count', { kind, ...args }); return state.rows[kind].filter(item => matches(item, args.where)).length },
        async findMany(args) {
          record('list', { kind, ...args }); const sorted = state.rows[kind].filter(item => matches(item, args.where)).sort((a, b) => (kind === 'category' ? a.sortOrder - b.sortOrder : 0) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
          return sorted.slice(args.skip, args.skip + args.take).map(item => select(item, args.select))
        },
        async create(args) {
          record('create', { kind, ...args }); if (state.writeError) throw state.writeError
          const identity = kind === 'instrument' ? 'canonicalKey' : 'slug'
          if (state.rows[kind].some(item => item[identity] === args.data[identity])) throw { code: 'P2002', message: 'SECRET' }
          const created = row(kind, { ...args.data, id: `new-${++state.nextId}` }); state.rows[kind].push(created); return select(created, args.select)
        },
        async updateMany(args) { record('update', { kind, ...args }); if (state.writeError) throw state.writeError; if (state.casCountZero) return { count: 0 }; const rows = state.rows[kind].filter(item => matches(item, args.where)); rows.forEach(item => Object.assign(item, clone(args.data))); if (state.stuckToken) rows.forEach(item => { item.updatedAt = new Date(token) }); return { count: rows.length } },
        async deleteMany(args) { record('delete', { kind, ...args }); if (state.writeError) throw state.writeError; if (state.casCountZero) return { count: 0 }; const before = state.rows[kind].length; state.rows[kind] = state.rows[kind].filter(item => !matches(item, args.where)); return { count: before - state.rows[kind].length } },
      }
    }
    for (const [kind, model, key] of [['category', 'article', 'categoryId'], ['topic', 'articleTopicMapping', 'topicId'], ['tag', 'articleTagMapping', 'tagId'], ['instrument', 'articleInstrument', 'instrumentId']]) tx[model] = { async count(args) { record('references', { kind, ...args }); assert.deepEqual(args.where, { [key]: `${kind}-a` }); return state.refs[kind] ?? 0 } }
    try { if (state.txError) throw state.txError; const result = await callback(tx); if (state.commitError) throw state.commitError; record('commit'); return result }
    catch (error) { state.rows = before; record('rollback'); throw error }
    finally { state.transaction = false; release() }
  } },
}
const originalError = console.error
console.error = (...args) => state.logs.push(args)
after(() => { console.error = originalError })
globalThis[Symbol.for('taxonomy-test')] = adapter
const dataModule = code => `data:text/javascript,${encodeURIComponent(`const a=globalThis[Symbol.for('taxonomy-test')];${code}`)}`
const root = new URL('../src/', import.meta.url)
const compiled = new URL('../node_modules/next/dist/compiled/', import.meta.url)
const replacements = new Map([['next-auth', dataModule('export const getServerSession=a.getServerSession;')], ['@/lib/auth', dataModule('export const authOptions=a.authOptions;')], ['@/lib/prisma', dataModule('export const prisma=a.prisma;')], ['next/cache', dataModule('export const revalidatePath=a.revalidatePath;')], ['server-only', 'data:text/javascript,export {};']])
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (replacements.has(specifier)) return next(replacements.get(specifier), context)
  if (specifier.startsWith('@/')) return next(new URL(`${specifier.slice(2)}.ts`, root).href, context)
  if (context.parentURL?.startsWith(root.href) && specifier.startsWith('./') && !specifier.endsWith('.ts')) return next(new URL(`${specifier}.ts`, context.parentURL).href, context)
  if (context.parentURL?.startsWith(new URL('react-server-dom-turbopack/', compiled).href)) {
    const target = specifier === 'react' ? 'react/cjs/react.react-server.production.js' : specifier === 'react-dom' ? 'react-dom/cjs/react-dom.production.js' : null
    if (target) return { url: new URL(target, compiled).href, shortCircuit: true }
  }
  return next(specifier, context)
} })
let createTaxonomy, updateTaxonomy, deleteTaxonomy, searchTaxonomy, getTaxonomyCatalog, queryTaxonomyOptions, client, server
try {
  ;({ createTaxonomy, updateTaxonomy, deleteTaxonomy, searchTaxonomy } = await import('../src/features/cms/taxonomy-actions.ts'))
  ;({ getTaxonomyCatalog } = await import('../src/features/cms/taxonomy-query.ts'))
  ;({ queryTaxonomyOptions } = await import('../src/features/cms/taxonomy-store.ts'))
  const require = createRequire(import.meta.url)
  client = require('next/dist/compiled/react-server-dom-turbopack/cjs/react-server-dom-turbopack-client.browser.production.js')
  server = require('next/dist/compiled/react-server-dom-turbopack/cjs/react-server-dom-turbopack-server.node.production.js')
} finally { hooks.deregister(); delete globalThis[Symbol.for('taxonomy-test')] }
const fail = (result, code) => { assert.equal(result.ok, false); assert.equal(result.error.code, code); assert.equal(JSON.stringify(result).includes('SECRET'), false) }
const writes = () => state.calls.filter(call => ['create', 'update', 'delete'].includes(call.kind))

test('TAX-01/20: session and fresh role/status gate every catalog operation before data access', async () => {
  const operations = [() => createTaxonomy('tag', input('tag')), () => updateTaxonomy('tag', 'tag-a', input('tag', true)), () => deleteTaxonomy('tag', 'tag-a', { expectedUpdatedAt: token.toISOString() }), () => searchTaxonomy('tag', { q: '', page: 1, active: 'all' })]
  for (const role of APP_ROLES.filter(role => !['ADMIN', 'SUPER_ADMIN'].includes(role))) for (const operation of operations) { scenario({ session: { user: { ...actor, role } } }); fail(await operation(), 'FORBIDDEN'); assert.equal(calls('transaction').length, 0) }
  for (const session of [null, {}]) for (const operation of operations) { scenario({ session }); fail(await operation(), 'FORBIDDEN') }
  for (const fresh of [null, { ...actor, status: 'SUSPENDED' }, { ...actor, role: 'SUPER_ADMIN' }, { ...actor, role: 'CREATOR' }]) for (const operation of [...operations, () => getTaxonomyCatalog(actor, 'tag', { q: '', page: 1, active: 'all' })]) { scenario({ actor: fresh }); fail(await operation(), 'FORBIDDEN'); assert.equal(calls('read').length + calls('list').length + writes().length, 0) }
})
for (const kind of kinds) {
  test(`TAX-02/03/06: ${kind} create/update preserve identity/createdAt, CAS exact row and persisted future +1ms`, async () => {
    scenario()
    const initial = clone(state.rows[kind][0])
    const result = await updateTaxonomy(kind, `${kind}-a`, input(kind, true))
    assert.equal(result.ok, true)
    assert.equal(result.data.item.updatedAt, '2099-09-28T01:02:03.457Z')
    assert.equal(result.data.item.createdAt, initial.createdAt.toISOString())
    for (const key of kind === 'instrument' ? ['canonicalKey', 'instrumentType', 'symbol', 'exchange'] : ['slug']) assert.equal(state.rows[kind][0][key], initial[key])
    assert.deepEqual(calls('update')[0].args.where, { id: `${kind}-a`, updatedAt: token })
    assert.equal(calls('transaction')[0].args.isolationLevel, 'Serializable')
    assert.ok(state.calls.findIndex(c => c.kind === 'actor') < state.calls.findIndex(c => c.kind === 'read'))
    assert.equal((await createTaxonomy(kind, input(kind))).ok, true)
    assert.equal(state.rows[kind].length, 2)
    if (kind === 'instrument') assert.equal(state.rows[kind][1].canonicalKey, 'HOSE:VNM')
  })
  test(`TAX-03/06: ${kind} canonical no-op keeps token; stale no-op still conflicts`, async () => {
    scenario(); const same = input(kind, true, { name: 'Tên cũ' })
    const result = await updateTaxonomy(kind, `${kind}-a`, same)
    assert.equal(result.ok, true); assert.equal(result.data.item.updatedAt, token.toISOString()); assert.equal(writes().length, 0)
    fail(await updateTaxonomy(kind, `${kind}-a`, { ...same, expectedUpdatedAt: '2099-09-28T01:02:03.455Z' }), 'EDIT_CONFLICT'); assert.equal(writes().length, 0)
  })
  test(`TAX-08/30: ${kind} delete guards all references before exact delete, preserves used rows`, async () => {
    scenario({ refs: { [kind]: 1 } }); const before = clone(state.rows)
    fail(await deleteTaxonomy(kind, `${kind}-a`, { expectedUpdatedAt: token.toISOString() }), 'TAXONOMY_IN_USE')
    assert.deepEqual(state.rows, before); assert.equal(calls('delete').length, 0)
    state.refs = {}; assert.equal((await deleteTaxonomy(kind, `${kind}-a`, { expectedUpdatedAt: token.toISOString() })).ok, true)
    assert.deepEqual(calls('delete')[0].args.where, { id: `${kind}-a`, updatedAt: token })
    assert.equal(state.rows[kind].length, 0)
  })
  test(`TAX-06/27: ${kind} write/commit failures roll back and return controlled errors`, async () => {
    for (const changes of [{ writeError: { code: 'P2034' } }, { casCountZero: true }, { stuckToken: true }, { commitError: { code: 'P2034' } }]) {
      scenario(changes); const before = clone(state.rows); fail(await updateTaxonomy(kind, `${kind}-a`, input(kind, true)), 'EDIT_CONFLICT'); assert.deepEqual(state.rows, before); assert.equal(calls('revalidate').length, 0)
    }
  })
}
test('TAX-05/27: duplicate identity and delete FK collision map safely', async () => {
  scenario(); assert.equal((await createTaxonomy('instrument', input('instrument'))).ok, true)
  fail(await createTaxonomy('instrument', input('instrument', false, { instrumentType: 'FUND' })), 'IDENTITY_CONFLICT')
  scenario({ writeError: { code: 'P2003' } }); fail(await deleteTaxonomy('category', 'category-a', { expectedUpdatedAt: token.toISOString() }), 'TAXONOMY_IN_USE')
})
test('TAX-06: simultaneous same-token metadata writes have one winner, no hidden retry', async () => {
  scenario()
  const results = await Promise.all([updateTaxonomy('category', 'category-a', input('category', true)), updateTaxonomy('category', 'category-a', input('category', true, { name: 'Loser' }))])
  assert.equal(results.filter(result => result.ok).length, 1); fail(results.find(result => !result.ok), 'EDIT_CONFLICT'); assert.equal(calls('update').length, 1)
})
test('TAX-09: bounded deterministic count/list query with clamped page and Tag no fake active', async () => {
  scenario(); state.rows.category = Array.from({ length: 60 }, (_, index) => row('category', { id: `category-${String(index).padStart(2, '0')}`, name: `Term ${String(index).padStart(2, '0')}`, sortOrder: index % 3 }))
  const result = await getTaxonomyCatalog(actor, 'category', { q: 'Term', page: 100000, active: 'active' })
  assert.equal(result.ok, true); assert.equal(result.data.page, 3); assert.equal(result.data.items.length, 10)
  const list = calls('list')[0].args, count = calls('count')[0].args
  assert.deepEqual(list.where, count.where); assert.equal(list.take, 25); assert.equal(list.skip, 50)
  assert.deepEqual(list.orderBy, [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }])
  await searchTaxonomy('tag', { q: '', page: 1, active: 'active' }); assert.equal(Object.hasOwn(calls('list').at(-1).args.where, 'isActive'), false)
})
test('TAX-07/09: internal options active-only with strict input and explicit metadata DTO', async () => {
  scenario(); state.rows.topic.push(row('topic', { id: 'inactive', isActive: false }))
  const page = await adapter.prisma.$transaction(tx => queryTaxonomyOptions(tx, 'topic', { q: '', page: 1 }), {})
  assert.equal(page.items.length, 1); assert.deepEqual(Object.keys(page.items[0]).sort(), ['id', 'kind', 'name', 'slug', 'canonicalKey', 'symbol', 'isActive'].sort())
  await assert.rejects(adapter.prisma.$transaction(tx => queryTaxonomyOptions(tx, 'tag', { q: '', page: 0 }), {}))
})
test('TAX-28: cache failures after commit preserve canonical success/warning', async () => {
  scenario({ cacheError: true }); const result = await createTaxonomy('tag', input('tag'))
  assert.equal(result.ok, true); assert.ok(result.warning); assert.equal(state.rows.tag.length, 2)
  assert.equal(calls('create').length, 1); assert.deepEqual(state.logs, [['CMS_TAXONOMY_REVALIDATION_FAILED']])
})
test('TAX-29: malformed stored row/date fail safely; legacy identity accepted unchanged', async () => {
  scenario(); state.rows.tag[0].updatedAt = new Date('invalid')
  fail(await getTaxonomyCatalog(actor, 'tag', { q: '', page: 1, active: 'all' }), 'INTERNAL_ERROR')
  scenario(); const result = await getTaxonomyCatalog(actor, 'instrument', { q: '', page: 1, active: 'all' })
  assert.equal(result.data.items[0].canonicalKey, 'LEGACY-key'); assert.equal(result.data.items[0].symbol, 'legacy symbol')
  assert.equal(result.data.items[0].updatedAt, token.toISOString())
})
test('TAX-29: real query and ACK DTO survive installed Flight codec with temporary references', async () => {
  scenario()
  const query = await getTaxonomyCatalog(actor, 'instrument', { q: '', page: 1, active: 'all' })
  const ack = await updateTaxonomy('instrument', 'instrument-a', input('instrument', true, { name: 'Tên tiếng Việt <b>text</b>' }))
  for (const value of [query, ack]) {
    assert.equal(value.ok, true)
    const wire = await client.encodeReply(value, { temporaryReferences: client.createTemporaryReferenceSet() })
    const decoded = await server.decodeReply(wire, {}, { temporaryReferences: server.createTemporaryReferenceSet() })
    assert.deepEqual(decoded, value)
  }
})
