import assert from 'node:assert/strict'
import test from 'node:test'
import { publicActionReferences, isTaxonomyAction, observeTaxonomyActions, holdTaxonomyResponses } from './e2e/cms-taxonomy-support.ts'

const createId = '40' + 'a'.repeat(40), searchId = '40' + 'b'.repeat(40), updateId = '40' + 'c'.repeat(40)
const ids = new Map([['createTaxonomy', createId], ['searchTaxonomy', searchId], ['updateArticleClassification', updateId]])
const request = (path = '/creator/taxonomy', id = createId, method = 'POST') => ({
  method: () => method, headers: () => id ? { 'next-action': id } : {}, url: () => `http://127.0.0.1:3001${path}`,
})
const ref = (id, name) => `(0,r.createServerReference)("${id}",r.callServer,void 0,r.findSourceMapURL,"${name}")`
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
test('TAX protocol reads only exact public action export identities, not unrelated references', () => {
  assert.deepEqual(publicActionReferences(ref(createId, 'createTaxonomy') + ',' + ref(searchId, 'searchTaxonomy') + ',' + ref(updateId, 'unknownSecretName')),
    new Map([['createTaxonomy', createId], ['searchTaxonomy', searchId]]))
  assert.equal(publicActionReferences(ref('bad-id', 'createTaxonomy')).size, 0)
})
test('TAX mutation matcher distinguishes read search, surface, method and next-action identity', () => {
  assert.equal(isTaxonomyAction(request(), ids, ['createTaxonomy']), true)
  for (const entry of [request('/creator/taxonomy', searchId), request('/creator/articles/a/classification'),
    request('/creator/taxonomy', createId, 'GET'), request('/creator/taxonomy', ''), request('/creator/taxonomy/child'), request('/dang-nhap')]) {
    assert.equal(isTaxonomyAction(entry, ids, ['createTaxonomy']), false)
  }
  assert.equal(isTaxonomyAction(request('/creator/articles/a/classification', updateId), ids, ['updateArticleClassification']), true)
  assert.equal(isTaxonomyAction(request('/creator/articles/a/edit', updateId), ids, ['updateArticleClassification']), false)
})
test('TAX public metadata observer counts writes separately from search without logging payloads', async () => {
  const handlers = {}
  const observer = observeTaxonomyActions({ url: () => 'http://127.0.0.1:3001/creator/taxonomy', on(name, fn) { handlers[name] = fn } })
  handlers.response({ url: () => 'https://foreign.example/_next/static/a.js', text() { throw Error('Foreign not read') } })
  handlers.response({ url: () => 'http://127.0.0.1:3001/_next/static/a.js', async text() { return ref(createId, 'createTaxonomy') + ref(searchId, 'searchTaxonomy') } })
  await flush(); await observer.ready('createTaxonomy', 'searchTaxonomy')
  handlers.request(request()); handlers.request(request('/creator/taxonomy', searchId)); handlers.request(request('/dang-nhap'))
  assert.equal(observer.count('createTaxonomy'), 1); assert.equal(observer.count('searchTaxonomy'), 1)
})
test('TAX metadata readiness tolerates unrelated aborted chunks but rejects conflicting action IDs', async () => {
  const handlers = {}
  const observer = observeTaxonomyActions({ url: () => 'http://127.0.0.1:3001/creator/taxonomy', on(name, fn) { handlers[name] = fn } })
  handlers.response({ url: () => 'http://127.0.0.1:3001/_next/static/login.js', async text() { throw Error('unrelated aborted chunk') } })
  handlers.response({ url: () => 'http://127.0.0.1:3001/_next/static/catalog.js', async text() { return ref(createId, 'createTaxonomy') } })
  await flush(); await observer.ready('createTaxonomy')
  handlers.response({ url: () => 'http://127.0.0.1:3001/_next/static/conflict.js', async text() { return ref(updateId, 'createTaxonomy') } })
  await flush()
  await assert.rejects(observer.ready('createTaxonomy'), /AMBIGUOUS_PUBLIC_ACTION_ID/)
})
async function setup() {
  let intercept
  const barrier = await holdTaxonomyResponses({ async route(pattern, callback) { assert.equal(pattern, '**/creator/**'); intercept = callback } }, ids, ['createTaxonomy'], 2)
  return { barrier, intercept }
}
const route = (entry = request()) => {
  const calls = [], response = Object.freeze({ opaqueRealResponse: true })
  return { calls, response, request: () => entry, async fetch() { calls.push('fetch'); return response },
    async fulfill(value) { calls.push(value) }, async abort(reason) { calls.push(['abort', reason]) }, async continue() { calls.push('continue') } }
}
test('TAX response barrier holds actual mutation response, excludes search and drops only real ACK', async () => {
  const { barrier, intercept } = await setup(), first = route(), search = route(request('/creator/taxonomy', searchId))
  await intercept(search); assert.deepEqual(search.calls, ['continue'])
  let settled = false
  const pending = intercept(first).then(() => { settled = true }); await flush()
  assert.equal(settled, false); assert.deepEqual(first.calls, ['fetch'])
  barrier.release(0, true); await pending
  assert.deepEqual(first.calls, ['fetch', ['abort', 'failed']])
  const second = route(), next = intercept(second); await flush(); barrier.dispose(); await next
  assert.equal(second.calls[1].response, second.response)
})
test('TAX response barrier preserves fetch failure rather than inventing success', async () => {
  const { barrier, intercept } = await setup(), entry = route(), failure = new Error('synthetic transport')
  entry.fetch = async () => { throw failure }
  await assert.rejects(intercept(entry), error => error === failure)
  barrier.dispose()
})
