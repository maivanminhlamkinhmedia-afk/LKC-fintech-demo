import assert from 'node:assert/strict'
import test from 'node:test'
import { isSourceAction, countSourceActions, holdSourceResponses } from './e2e/cms-sources-support.ts'

// Protocol-only mock callbacks: no browser, action, credential or DB is started.
const request = (path = '/creator/articles/own/sources', method = 'POST', action = true) => ({
  method: () => method, headers: () => action ? { 'next-action': 'synthetic-action' } : {},
  url: () => `http://127.0.0.1:3001${path}`,
})
test('source request matcher excludes login GET editor autosave and nested paths', () => {
  assert.equal(isSourceAction(request()), true)
  for (const candidate of [request('/dang-nhap'), request('/creator/articles/own/edit'), request('/creator/articles/new'),
    request('/creator/articles/own/sources', 'GET'), request('/creator/articles/own/sources', 'POST', false),
    request('/creator/articles/own/sources/child'), request('/creator/articles//sources')]) assert.equal(isSourceAction(candidate), false)
  assert.equal(isSourceAction(request('/creator/articles/own/sources?view=all')), true)
})

test('source request counter records only real source action request events', () => {
  let listener
  const count = countSourceActions({ on(event, callback) { assert.equal(event, 'request'); listener = callback } })
  for (const candidate of [request('/dang-nhap'), request(), request('/creator/articles/own/sources', 'GET'), request()]) listener(candidate)
  assert.equal(count(), 2)
})

async function setup(limit = 1) {
  let intercept
  const helper = await holdSourceResponses({ async route(pattern, callback) {
    assert.equal(pattern, '**/creator/articles/**/sources'); intercept = callback
  } }, limit)
  return { helper, intercept }
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
function route(candidate = request()) {
  const response = Object.freeze({ syntheticOpaqueResponse: true }), calls = []
  return { calls, response, value: {
    request: () => candidate,
    async fetch(...args) { calls.push(['fetch', args]); return response },
    async fulfill(value) { calls.push(['fulfill', value]) },
    async abort(reason) { calls.push(['abort', reason]) },
    async continue() { calls.push(['continue']) },
  } }
}

test('source barrier holds the exact fetched response until release without fabricating success', async () => {
  const { helper, intercept } = await setup(), first = route()
  let settled = false
  const pending = intercept(first.value).then(() => { settled = true })
  await flush()
  assert.equal(helper.started(), 1); assert.equal(settled, false)
  assert.deepEqual(first.calls, [['fetch', []]])
  helper.release(); await pending
  assert.equal(first.calls[1][1].response, first.response)
  const second = route(); await intercept(second.value)
  assert.deepEqual(second.calls, [['continue']])
  helper.dispose()
})

test('lost source ACK aborts only after the real response and dispose releases held work', async () => {
  const { helper, intercept } = await setup(2), first = route(), second = route()
  const one = intercept(first.value); await flush(); helper.release(0, true); await one
  assert.deepEqual(first.calls, [['fetch', []], ['abort', 'failed']])
  const two = intercept(second.value); await flush(); helper.dispose(); await two
  assert.equal(second.calls[1][1].response, second.response)
  const later = route(); await intercept(later.value); assert.deepEqual(later.calls, [['continue']])
})

test('source barrier propagates fetch failures and does not swallow them as a safe ACK', async () => {
  const { helper, intercept } = await setup(), entry = route()
  const failure = new Error('Synthetic transport failure')
  entry.value.fetch = async () => { throw failure }
  await assert.rejects(intercept(entry.value), error => error === failure)
  assert.deepEqual(entry.calls, []); helper.dispose()
})
