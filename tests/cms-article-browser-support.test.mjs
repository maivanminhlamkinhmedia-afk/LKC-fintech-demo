import assert from 'node:assert/strict'
import test from 'node:test'
import { isArticleAction, countArticleActions, holdActionResponses } from './e2e/cms-autosave-support.ts'

// Execute the actual shared matcher/counter/barrier with protocol adapters.
// Synthetic request metadata only: no browser, payload, credential, app or DB.
const request = (path = '/creator/articles/synthetic-article/edit', method = 'POST', action = 'synthetic-draft-update') => ({
  method: () => method,
  headers: () => action === undefined ? {} : { 'next-action': action },
  url: () => `http://127.0.0.1:3001${path}`,
})
const ignored = () => [
  request('/creator/articles/synthetic-article/classification', 'POST', 'synthetic-classification-search'),
  request('/creator/articles/synthetic-article/classification', 'POST', 'synthetic-classification-update'),
  request('/creator/articles/synthetic-article/sources', 'POST', 'synthetic-source-create'),
  request('/creator/articles/synthetic-article/sources', 'POST', 'synthetic-source-update'),
  request('/creator/articles/synthetic-article/sources', 'POST', 'synthetic-source-delete'),
  request('/creator/taxonomy', 'POST', 'synthetic-catalog-create'),
  request('/creator/taxonomy', 'POST', 'synthetic-catalog-search'),
  request('/dang-nhap'), request('/api/auth/callback/credentials'), request('/creator/articles'),
  request('/creator/articles/synthetic-article/edit/history'), request('/creator/articles/new/child'),
  request('/creator/articles//edit'), request('/creator/articles/synthetic-article/classification/edit'),
  request('/creator/articles/synthetic-article/edit', 'GET'), request('/creator/articles/new', 'HEAD'),
  { ...request(), headers: () => ({}) }, request('/creator/articles/synthetic-article/edit', 'POST', ''),
]
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
async function setup(limit = 1) {
  let intercept
  const barrier = await holdActionResponses({ async route(pattern, callback) {
    assert.equal(pattern, '**/creator/articles/**'); intercept = callback
  } }, limit)
  return { barrier, intercept }
}
function route(candidate = request()) {
  const response = Object.freeze({ syntheticOpaqueResponse: true }), calls = []
  return { response, calls, value: {
    request: () => candidate,
    async fetch(...args) { calls.push(['fetch', args]); return response },
    async fulfill(value) { calls.push(['fulfill', value]) },
    async abort(reason) { calls.push(['abort', reason]) },
    async continue() { calls.push(['continue']) },
  } }
}

test('article matcher recognizes manual create and manual/autosave update on their exact routes', () => {
  for (const candidate of [request('/creator/articles/new', 'POST', 'synthetic-draft-create'), request(),
    request('/creator/articles/new?draft=1', 'POST', 'synthetic-draft-create'), request('/creator/articles/synthetic-article/edit?view=editor')]) {
    assert.equal(isArticleAction(candidate), true)
  }
})

test('article matcher excludes sources classification catalog searches login GET and nested routes', () => {
  for (const candidate of ignored()) assert.equal(isArticleAction(candidate), false, candidate.url())
})

test('TAX-24-LINKS counter remains one after editor save followed by classification picker read', () => {
  let listener
  const count = countArticleActions({ on(event, callback) { assert.equal(event, 'request'); listener = callback } })
  listener(request()); assert.equal(count(), 1)
  // The mounted classification panel invokes search('category', '', 1). Its
  // Server Function is a POST on /classification, but it is not a draft save.
  listener(request('/creator/articles/synthetic-article/classification', 'POST', 'synthetic-classification-search'))
  assert.equal(count(), 1)
  for (const candidate of ignored()) listener(candidate)
  assert.equal(count(), 1)
  listener(request('/creator/articles/new', 'POST', 'synthetic-draft-create')); listener(request())
  assert.equal(count(), 3, 'later actual create/update requests must still be counted')
})

test('article barrier excludes other CMS/read requests without consuming its create/update hold limit', async () => {
  const { barrier, intercept } = await setup(2), work = []
  try {
    for (const candidate of ignored()) {
      const entry = route(candidate); work.push(intercept(entry.value)); await flush()
      assert.deepEqual(entry.calls, [['continue']], candidate.url())
      assert.equal(barrier.started(), 0)
    }
    for (const [index, candidate] of [request('/creator/articles/new', 'POST', 'synthetic-draft-create'), request()].entries()) {
      const entry = route(candidate); let settled = false
      const pending = intercept(entry.value).then(() => { settled = true }); work.push(pending); await flush()
      assert.equal(settled, false); assert.equal(barrier.started(), index + 1); assert.deepEqual(entry.calls, [['fetch', []]])
      await barrier.ready(index); barrier.release(index); await pending
      assert.equal(entry.calls[1][1].response, entry.response)
    }
    const overLimit = route(); await intercept(overLimit.value); assert.deepEqual(overLimit.calls, [['continue']])
  } finally { barrier.dispose(); await Promise.allSettled(work) }
})

test('article barrier drops only the real update ACK and dispose releases held responses unchanged', async () => {
  const { barrier, intercept } = await setup(2), first = route(), second = route()
  try {
    const one = intercept(first.value); await flush(); await barrier.ready(); barrier.release(0, true); await one
    assert.deepEqual(first.calls, [['fetch', []], ['abort', 'failed']])
    const two = intercept(second.value); await flush(); barrier.dispose(); await two
    assert.equal(second.calls[1][1].response, second.response)
    const later = route(); await intercept(later.value); assert.deepEqual(later.calls, [['continue']])
  } finally { barrier.dispose() }
})

test('article barrier disposal during fetch still forwards the exact response and fetch failures propagate', async () => {
  const { barrier, intercept } = await setup(), entry = route()
  let resolve
  const held = new Promise(done => { resolve = done })
  entry.value.fetch = async () => { entry.calls.push(['fetch']); return held }
  const pending = intercept(entry.value); await flush(); barrier.dispose(); resolve(entry.response); await pending
  assert.equal(entry.calls[1][1].response, entry.response)
  const failing = await setup(), transportError = Error('Synthetic transport failure'), failed = route()
  failed.value.fetch = async () => { throw transportError }
  try { await assert.rejects(failing.intercept(failed.value), error => error === transportError) }
  finally { failing.barrier.dispose() }
})
