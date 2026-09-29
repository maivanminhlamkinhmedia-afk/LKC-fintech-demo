import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'

const root = new URL('../src/features/cms/', import.meta.url)
const hook = registerHooks({ resolve(specifier, context, next) { if (context.parentURL?.startsWith(root.href) && specifier.startsWith('./')) return next(new URL(`${specifier}.ts`, context.parentURL).href, context); return next(specifier, context) } })
let createTaxonomyPanel
try { ({ createTaxonomyPanel } = await import('../src/features/cms/taxonomy-panel.ts')) } finally { hook.deregister() }
const token = '2026-09-28T00:00:00.001Z', newer = '2026-09-28T00:00:00.002Z', yes = () => true, no = () => false
const item = changes => ({ id: 'tag-a', kind: 'tag', name: 'Tên', slug: 'legacy-slug', canonicalKey: null, symbol: null, isActive: null, description: null, sortOrder: null, instrumentType: null, exchange: null, countryCode: null, currency: null, createdAt: token, updatedAt: token, ...changes })
const page = changes => ({ kind: 'tag', q: '', active: 'all', page: 1, totalPages: 1, total: 1, items: [item()], ...changes })
const ok = (changes = {}) => ({ ok: true, data: { kind: 'tag', item: item({ updatedAt: newer, ...changes }), deletedId: null } })
const fail = code => ({ ok: false, error: { code, message: `Safe ${code}` } })
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
function setup({ initial = page(), result = ok(), searchResult = { ok: true, data: page() } } = {}) {
  const calls = [], run = method => async (...args) => { calls.push({ method, args }); return typeof result === 'function' ? result(...args) : result }
  const panel = createTaxonomyPanel(initial, { create: run('create'), update: run('update'), remove: run('remove'), async search(...args) { calls.push({ method: 'search', args }); return typeof searchResult === 'function' ? searchResult(...args) : searchResult } })
  panel.activate(); return { panel, calls, writes: () => calls.filter(call => call.method !== 'search') }
}
test('TAX-21: mount/read/edit/change/undo/online events never schedule writes', () => {
  const { panel, writes } = setup(); panel.edit('tag-a', yes); panel.setField('name', 'Mới'); assert.equal(panel.shouldWarn(), true)
  panel.setField('name', 'Tên'); assert.equal(panel.getState().dirty, false)
  panel.setOnline(false); panel.setOnline(true); panel.sync(page()); assert.equal(writes().length, 0)
})
test('TAX-03/21: immutable metadata snapshot and synchronous single-flight across create/update/delete', async () => {
  const wait = deferred(), { panel, writes } = setup({ result: () => wait.promise })
  panel.edit('tag-a', yes); panel.setField('name', 'Đổi tên')
  const saving = panel.save(); panel.setField('name', 'Không nhập'); await panel.save(); await panel.remove('tag-a', yes)
  assert.equal(panel.add(yes), false); assert.equal(panel.cancel(yes), false); assert.equal(writes().length, 1)
  assert.deepEqual(writes()[0].args, ['tag', 'tag-a', { name: 'Đổi tên', expectedUpdatedAt: token }])
  wait.resolve(ok({ name: 'Đổi tên' })); assert.equal(await saving, true); assert.equal(panel.getState().selected.updatedAt, newer); assert.equal(panel.getState().pending, false)
})
test('TAX-22: create lost ACK blocks repeat mutations and retains draft through refresh', async () => {
  const { panel, writes } = setup({ result: () => { throw new Error('network') } })
  panel.add(yes); panel.setField('name', 'Mới'); panel.setField('slug', 'moi'); assert.equal(await panel.save(), false)
  assert.equal(panel.getState().blocked, true); assert.equal(panel.getState().pending, false); assert.equal(panel.getState().values.name, 'Mới')
  panel.sync(page({ items: [item({ name: 'Server' })] })); panel.setOnline(true); await panel.save(); await panel.remove('tag-a', yes)
  assert.equal(writes().length, 1); assert.equal(panel.getState().values.name, 'Mới')
})
test('TAX-22/29: INTERNAL_ERROR vs terminal and retryable failures preserve safe recovery policy', async () => {
  for (const code of ['INTERNAL_ERROR', 'EDIT_CONFLICT', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION_ERROR', 'IDENTITY_CONFLICT', 'TAXONOMY_IN_USE']) {
    const { panel, writes } = setup({ result: fail(code) }); panel.edit('tag-a', yes); panel.setField('name', 'Giữ')
    await panel.save(); const retryable = ['VALIDATION_ERROR', 'IDENTITY_CONFLICT', 'TAXONOMY_IN_USE'].includes(code)
    assert.equal(panel.getState().blocked, !retryable); assert.equal(panel.getState().values.name, 'Giữ'); assert.equal(panel.getState().pending, false)
    await panel.save(); assert.equal(writes().length, retryable ? 2 : 1)
  }
})
test('TAX-23: known offline avoids dispatch; reconnect requires manual save', async () => {
  const { panel, writes } = setup(); panel.edit('tag-a', yes); panel.setField('name', 'Mới'); panel.setOnline(false)
  assert.equal(await panel.save(), false); await panel.remove('tag-a', yes); assert.equal(writes().length, 0)
  panel.setOnline(true); assert.equal(writes().length, 0); assert.equal(await panel.save(), true); assert.equal(writes().length, 1)
})
test('TAX-04/29: local payload preparation failure unlocks without unknown ACK', async () => {
  const { panel, writes } = setup(); panel.add(yes); panel.setField('name', 'Mới'); panel.setField('slug', 'bad slug')
  assert.equal(await panel.save(), false); assert.equal(panel.getState().pending, false); assert.equal(panel.getState().blocked, false); assert.equal(writes().length, 0)
  panel.setField('slug', 'valid'); assert.equal(await panel.save(), true)
})
test('TAX-24: dirty cancel/edit/tab/search respect confirmation and do not mutate', async () => {
  const { panel, writes, calls } = setup(); panel.edit('tag-a', yes); panel.setField('name', 'Giữ')
  assert.equal(panel.cancel(no), false); assert.equal(panel.add(no), false); assert.equal(panel.edit('tag-a', no), false)
  assert.equal(await panel.search('topic', { q: 'new', page: 1, active: 'all' }, no), false)
  assert.equal(panel.getState().values.name, 'Giữ'); assert.equal(calls.length, 0); assert.equal(writes().length, 0)
  assert.equal(panel.cancel(yes), true); assert.equal(panel.shouldWarn(), false)
})
test('TAX-29: dirty, pending, older and terminal refreshes cannot replace token or draft', async () => {
  const wait = deferred(), { panel } = setup({ result: () => wait.promise })
  panel.edit('tag-a', yes); panel.setField('name', 'Giữ'); panel.sync(page({ items: [item({ name: 'New', updatedAt: newer })] }))
  assert.equal(panel.getState().selected.updatedAt, token); assert.equal(panel.getState().values.name, 'Giữ')
  const saving = panel.save(); panel.sync(page({ items: [] })); assert.equal(panel.getState().values.name, 'Giữ')
  wait.resolve(ok({ name: 'Saved' })); await saving
  panel.sync(page({ items: [item({ name: 'Old' })] })); assert.equal(panel.getState().selected.updatedAt, newer); assert.equal(panel.getState().values.name, 'Saved')
})
test('TAX-29: late search loses to latest generation and does not overwrite a new form', async () => {
  const first = deferred(), second = deferred(); let n = 0
  const { panel } = setup({ searchResult: () => ++n === 1 ? first.promise : second.promise })
  const a = panel.search('tag', { q: 'first', page: 1, active: 'all' }, yes), b = panel.search('tag', { q: 'second', page: 1, active: 'all' }, yes)
  second.resolve({ ok: true, data: page({ q: 'second' }) }); await b
  first.resolve({ ok: true, data: page({ q: 'first' }) }); await a; assert.equal(panel.getState().snapshot.q, 'second')
  const delayed = deferred(), other = setup({ searchResult: () => delayed.promise }).panel
  const pending = other.search('topic', { q: '', page: 1, active: 'all' }, yes); other.add(yes); other.setField('name', 'Local')
  delayed.resolve({ ok: true, data: page({ kind: 'topic' }) }); await pending
  assert.equal(other.getState().snapshot.kind, 'tag'); assert.equal(other.getState().values.name, 'Local'); assert.equal(other.getState().searching, false)
})
test('TAX-29: StrictMode clean reactivation and pending lifetime use unknown-result barrier', async () => {
  const wait = deferred(), { panel, writes } = setup({ result: () => wait.promise })
  panel.deactivate(); panel.activate(); assert.equal(panel.getState().blocked, false)
  panel.edit('tag-a', yes); panel.setField('name', 'Giữ'); const saving = panel.save(); panel.deactivate(); panel.activate()
  assert.equal(panel.getState().pending, false); assert.equal(panel.getState().blocked, true)
  wait.resolve(ok({ name: 'Late' })); await saving; await panel.save()
  assert.equal(panel.getState().values.name, 'Giữ'); assert.equal(writes().length, 1)
})
test('TAX-24/29: accepted leave ignores late ACK and dispatches no follow-up', async () => {
  const wait = deferred(), { panel, writes } = setup({ result: () => wait.promise })
  panel.edit('tag-a', yes); panel.setField('name', 'Giữ'); const saving = panel.save(); panel.leave()
  wait.resolve(ok({ name: 'Late' })); await saving; await panel.save(); assert.equal(panel.getState().values.name, 'Giữ'); assert.equal(writes().length, 1)
})
test('TAX-28: post-commit list read failure leaves canonical item and success warning; no duplicate create', async () => {
  const { panel, writes } = setup({ result: { ...ok({ id: 'new-id', name: 'Mới' }), warning: 'Cache pending' }, searchResult: () => { throw new Error('read') } })
  panel.add(yes); panel.setField('name', 'Mới'); panel.setField('slug', 'moi'); assert.equal(await panel.save(), true)
  assert.equal(panel.getState().selected.id, 'new-id'); assert.equal(panel.getState().blocked, false); assert.equal(panel.getState().warning, 'Cache pending')
  await panel.save(); assert.equal(writes()[1].method, 'update')
})
