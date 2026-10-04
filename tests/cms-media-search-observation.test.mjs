import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { observeMediaSearch } from '../scripts/cms-e2e/media-search-observation.ts'

class LocalPage extends EventEmitter {
  async exposeBinding() {}
  async evaluate() { return 'BUTTON_READY' }
  mainFrame() { return this }
}
const action = (errorText = null) => ({
  url: () => 'http://127.0.0.1:3001/creator/media', method: () => 'POST',
  isNavigationRequest: () => false,
  failure: () => errorText === null ? null : { errorText },
})
const response = (request, status) => ({ request: () => request, status: () => status })

test('media search accepts only one matching 2xx action after its body finishes', async () => {
  const page = new LocalPage(), records = [], observer = await observeMediaSearch(page, row => records.push(row))
  const first = action()
  page.emit('request', first)
  page.emit('response', response(first, 200))
  assert.equal(observer.actionFinishedOk(), false, 'headers alone do not finish a Server Action')
  page.emit('requestfinished', first)
  assert.equal(observer.actionFinishedOk(), true)
  const second = action()
  page.emit('request', second)
  page.emit('response', response(second, 200))
  page.emit('requestfinished', second)
  assert.equal(observer.actionFinishedOk(), false, 'a second POST cannot satisfy the single search request')
  assert.deepEqual(records.map(row => [row.signal, row.requestOrdinal]), [
    ['BUTTON_READY', 0], ['ACTION_REQUEST', 1], ['ACTION_RESPONSE', 1],
    ['ACTION_FINISHED', 1], ['ACTION_REQUEST', 2], ['ACTION_RESPONSE', 2], ['ACTION_FINISHED', 2],
  ])
  assert.equal(records.every(row => row.failureCode === null), true)
  observer.dispose()
  assert.equal(page.listenerCount('requestfinished'), 0)
})

test('media search keeps a truncated 200 response, a failed action, and unsafe failure text unsuccessful', async () => {
  for (const [status, errorText, expectedCode] of [
    [200, 'net::ERR_ABORTED', 'ABORTED'],
    [500, 'net::ERR_CONNECTION_RESET', 'CONNECTION_RESET'],
    [200, 'private detail from browser', 'OTHER'],
  ]) {
    const page = new LocalPage(), records = [], observer = await observeMediaSearch(page, row => records.push(row))
    const request = action(errorText)
    page.emit('request', request)
    page.emit('response', response(request, status))
    page.emit('requestfailed', request)
    assert.equal(observer.actionFinishedOk(), false)
    assert.equal(observer.saw('ACTION_FAILED'), true)
    assert.deepEqual(records.at(-1), { signal: 'ACTION_FAILED', elapsedMs: records.at(-1).elapsedMs,
      httpStatus: 0, requestOrdinal: 1, failureCode: expectedCode })
    assert.equal(JSON.stringify(records).includes(errorText), false)
    observer.dispose()
  }
  const page = new LocalPage(), observer = await observeMediaSearch(page, () => {})
  const request = action()
  page.emit('request', request)
  page.emit('response', response(request, 500))
  page.emit('requestfinished', request)
  assert.equal(observer.actionFinishedOk(), false, 'completed HTTP 500 is not a successful search')
  observer.dispose()
})
