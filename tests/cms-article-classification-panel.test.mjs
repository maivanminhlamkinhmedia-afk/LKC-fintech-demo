import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'
const root = new URL('../src/features/cms/', import.meta.url)
const hook = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.startsWith(root.href) && specifier.startsWith('./') ? next(new URL(`${specifier}.ts`, context.parentURL).href, context) : next(specifier, context)
} })
let createClassificationPanel
try { ({ createClassificationPanel } = await import('../src/features/cms/article-classification-panel.ts')) } finally { hook.deregister() }
const token = '2026-09-28T01:02:03.456Z', nextToken = '2026-09-28T01:02:03.457Z'
const item = (kind = 'topic', id = 'topic-a', changes = {}) => ({ kind, id, name: `Tên ${id}`, slug: id, canonicalKey: null, symbol: null, isActive: true, ...changes })
const snapshot = changes => ({ id: 'article-a', title: 'Bài viết', status: 'DRAFT', updatedAt: token, canMutate: true, readOnlyReason: null,
  category: null, topics: [], tags: [], instruments: [], warnings: [], ...changes })
const success = changes => ({ ok: true, data: snapshot({ updatedAt: nextToken, ...changes }) })
const failure = code => ({ ok: false, error: { code, message: code } })
const hold = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
function setup(initial = snapshot(), save = () => success(), search = async (_id, kind) => ({ ok: true, data: { kind, items: [], page: 1, totalPages: 1, total: 0 } })) {
  const calls = [], reads = []
  const panel = createClassificationPanel(initial, { save: async (...args) => { calls.push(args); return save(...args) }, search: async (...args) => { reads.push(args); return search(...args) } })
  panel.activate(); return { panel, calls, reads }
}

test('TAX-09/21: mount/change/search/undo do not write; selected off-page and metadata survive searches', async () => {
  const { panel, calls } = setup()
  panel.choose(item(), true); assert.equal(panel.getState().dirty, true)
  await panel.search('tag', 'khác', 2); assert.deepEqual(panel.getState().values.topicIds, ['topic-a']); assert.equal(panel.getState().known[0].name, 'Tên topic-a')
  panel.setOnline(false); panel.setOnline(true); assert.equal(calls.length, 0)
  panel.choose(item(), false); assert.equal(panel.getState().dirty, false); assert.equal(panel.shouldWarn(), false)
})
test('TAX-10/21: one synchronous flight, immutable full snapshot and only canonical ACK advances token', async () => {
  const deferred = hold(), { panel, calls } = setup(snapshot(), () => deferred.promise)
  panel.choose(item(), true); panel.choose(item('instrument', 'i'), true); panel.primary('i')
  const saving = panel.save(); panel.choose(item('topic', 'other'), true); panel.primary(null); await panel.save()
  assert.equal(calls.length, 1); assert.equal(panel.getState().pending, true)
  assert.deepEqual(calls[0], ['article-a', { categoryId: null, topicIds: ['topic-a'], tagIds: [], instrumentIds: ['i'], primaryInstrumentId: 'i', expectedUpdatedAt: token }])
  deferred.resolve(success({ topics: [item()], instruments: [{ ...item('instrument', 'i'), isPrimary: true }] })); await saving
  assert.equal(panel.getState().snapshot.updatedAt, nextToken); assert.equal(panel.getState().pending, false); assert.equal(panel.getState().dirty, false)
  assert.equal(panel.getState().values.primaryInstrumentId, 'i')
})
test('TAX-11/24: cancel requires consent, deselect primary clears it, readonly panels never mutate', async () => {
  const { panel, calls } = setup(snapshot({ instruments: [{ ...item('instrument', 'i'), isPrimary: true }] }))
  panel.choose(item('instrument', 'i'), false); assert.equal(panel.getState().values.primaryInstrumentId, null)
  assert.equal(panel.cancel(() => false), false); assert.equal(panel.getState().dirty, true)
  assert.equal(panel.cancel(() => true), true); assert.equal(panel.getState().values.primaryInstrumentId, 'i'); assert.equal(calls.length, 0)
  for (const readOnlyReason of ['NOT_EDITABLE', 'UNSUPPORTED_DOCUMENT']) {
    const { panel, calls } = setup(snapshot({ canMutate: false, readOnlyReason })); panel.choose(item(), true); await panel.save()
    assert.equal(calls.length, 0); assert.deepEqual(panel.getState().values.topicIds, [])
  }
})
test('TAX-23: known offline preserves selection, reconnect does not dispatch, manual retry works', async () => {
  const { panel, calls } = setup(); panel.choose(item(), true); panel.setOnline(false); await panel.save(); panel.setOnline(true)
  assert.equal(calls.length, 0); assert.equal(panel.getState().dirty, true); assert.match(panel.getState().message, /Mất kết nối/)
  await panel.save(); assert.equal(calls.length, 1)
})
for (const code of ['VALIDATION_ERROR', 'INVALID_SELECTION']) test(`TAX-23: ${code} retains input and permits manual retry with unchanged token`, async () => {
  const { panel, calls } = setup(snapshot(), () => failure(code)); panel.choose(item(), true); await panel.save()
  assert.equal(panel.getState().blocked, false); assert.equal(panel.getState().pending, false); assert.deepEqual(panel.getState().values.topicIds, ['topic-a'])
  panel.choose(item('topic', 'other'), true); await panel.save(); assert.equal(calls.length, 2); assert.equal(calls[1][1].expectedUpdatedAt, token)
})
for (const code of ['EDIT_CONFLICT', 'FORBIDDEN', 'NOT_FOUND', 'NOT_EDITABLE', 'UNSUPPORTED_DOCUMENT', 'INTERNAL_ERROR']) test(`TAX-15/19/22: ${code} forms a barrier; no silent token refresh/retry`, async () => {
  const { panel, calls } = setup(snapshot(), () => failure(code)); panel.choose(item(), true); await panel.save()
  assert.equal(panel.getState().blocked, true); assert.deepEqual(panel.getState().values.topicIds, ['topic-a']); assert.equal(panel.shouldWarn(), true)
  panel.sync(snapshot({ updatedAt: nextToken })); panel.setOnline(false); panel.setOnline(true); await panel.save()
  assert.equal(panel.getState().snapshot.updatedAt, token); assert.equal(calls.length, 1)
})
test('TAX-22: throw after dispatch is unknown ACK, while preparation validation safely unlocks', async () => {
  const { panel, calls } = setup(snapshot(), () => { throw Error('network') }); panel.choose(item(), true); await panel.save()
  assert.equal(panel.getState().blocked, true); assert.equal(panel.getState().pending, false); assert.equal(panel.getState().error.code, 'INTERNAL_ERROR'); await panel.save(); assert.equal(calls.length, 1)
  const local = setup(); for (let i = 0; i < 6; i++) local.panel.choose(item('topic', `t${i}`), true)
  await local.panel.save(); assert.equal(local.calls.length, 0); assert.equal(local.panel.getState().pending, false); assert.equal(local.panel.getState().blocked, false)
  local.panel.choose(item('topic', 't5'), false); await local.panel.save(); assert.equal(local.calls.length, 1)
})
test('TAX-29: dirty/pending/older refresh never overwrites selection or token; clean newer refresh syncs', async () => {
  const deferred = hold(), { panel } = setup(snapshot(), () => deferred.promise)
  panel.choose(item(), true); panel.sync(snapshot({ updatedAt: nextToken, topics: [item('topic', 'server')] }))
  assert.deepEqual(panel.getState().values.topicIds, ['topic-a']); assert.equal(panel.getState().snapshot.updatedAt, token)
  const pending = panel.save(); panel.sync(snapshot({ updatedAt: nextToken })); assert.equal(panel.getState().snapshot.updatedAt, token)
  deferred.resolve(success({ topics: [item()] })); await pending; panel.sync(snapshot())
  assert.equal(panel.getState().snapshot.updatedAt, nextToken)
  panel.sync(snapshot({ updatedAt: '2026-09-28T01:02:03.458Z', title: 'Fresh' })); assert.equal(panel.getState().snapshot.title, 'Fresh')
})
test('TAX-29: out-of-order searches cannot overwrite newer results, selections or parent token', async () => {
  const a = hold(), b = hold(), { panel } = setup(snapshot(), undefined, (_id, kind) => kind === 'topic' ? a.promise : b.promise)
  panel.choose(item(), true); const first = panel.search('topic', 'old'), second = panel.search('tag', 'new')
  b.resolve({ ok: true, data: { kind: 'tag', items: [item('tag', 'tag-b')], page: 1, totalPages: 1, total: 1 } }); await second
  a.resolve({ ok: true, data: { kind: 'topic', items: [], page: 1, totalPages: 1, total: 0 } }); await first
  assert.equal(panel.getState().options.kind, 'tag'); assert.deepEqual(panel.getState().values.topicIds, ['topic-a']); assert.equal(panel.getState().snapshot.updatedAt, token)
})
test('TAX-24/29: late ACK after leave/unmount never updates state or permits follow-up', async () => {
  for (const stop of ['leave', 'deactivate']) {
    const deferred = hold(), { panel, calls } = setup(snapshot(), () => deferred.promise); panel.choose(item(), true); const pending = panel.save()
    panel[stop](); deferred.resolve(success()); await pending
    assert.equal(panel.getState().snapshot.updatedAt, token); assert.deepEqual(panel.getState().values.topicIds, ['topic-a']); await panel.save(); assert.equal(calls.length, 1)
  }
})
test('TAX-29: StrictMode lifecycle subscription cleanup and reactivation cannot replay outstanding write', async () => {
  const deferred = hold(), { panel, calls } = setup(snapshot(), () => deferred.promise)
  let updates = 0; const unsubscribe = panel.subscribe(() => updates++)
  panel.deactivate(); panel.activate(); panel.choose(item(), true); const saving = panel.save()
  panel.deactivate(); unsubscribe(); const before = updates; panel.activate()
  deferred.resolve(success()); await saving; await panel.save()
  assert.equal(updates, before); assert.equal(calls.length, 1); assert.equal(panel.getState().blocked, true); assert.equal(panel.getState().pending, false)
})
test('TAX-29: legacy excess selection remains visible, multiple primary requires explicit choice', async () => {
  const { panel, calls } = setup(snapshot({ topics: Array.from({ length: 6 }, (_, i) => item('topic', `t${i}`)),
    instruments: [{ ...item('instrument', 'i1'), isPrimary: true }, { ...item('instrument', 'i2'), isPrimary: true }] }))
  assert.equal(panel.getState().values.topicIds.length, 6); assert.equal(panel.getState().primaryResolved, false)
  panel.choose(item('topic', 't5'), false); await panel.save(); assert.equal(calls.length, 0); assert.equal(panel.getState().error.fieldErrors.primaryInstrumentId.length > 0, true)
  panel.primary(null); await panel.save(); assert.equal(calls.length, 1); assert.equal(calls[0][1].primaryInstrumentId, null)
})
