import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'

const root = new URL('../src/features/cms/', import.meta.url)
const hook = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.startsWith(root.href) && specifier.startsWith('./')) return next(new URL(`${specifier}.ts`, context.parentURL).href, context)
  return next(specifier, context)
} })
let createSourcePanel
try { ({ createSourcePanel } = await import(new URL('article-source-panel.ts', root).href)) } finally { hook.deregister() }
const token = '2026-09-27T02:00:00.001Z', nextToken = '2026-09-27T02:00:00.002Z'
const item = (id = 'source-a', overrides = {}) => ({ id, sourceType: 'REPORT', title: 'Báo cáo tiếng Việt', publisher: null, url: null,
  publishedAt: '2026-09-27T02:03:04.567Z', accessedAt: null, dataTimestamp: null, note: 'Trang 3\nMục I',
  createdAt: token, updatedAt: token, createdById: 'admin-a', safeUrl: null, ...overrides })
const snapshot = (overrides = {}) => ({ id: 'article-a', title: 'Bài viết', status: 'DRAFT', updatedAt: token, canMutate: true, readOnlyReason: null, sources: [item()], ...overrides })
const fail = code => ({ ok: false, error: { code, message: `Safe ${code}` } })
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
function setup(initial = snapshot(), result = { ok: true, data: snapshot({ updatedAt: nextToken }) }) {
  const calls = []
  const action = kind => async (...args) => { calls.push({ kind, args }); return typeof result === 'function' ? result(...args) : result }
  const panel = createSourcePanel(initial, { create: action('create'), update: action('update'), remove: action('delete') })
  panel.activate()
  return { panel, calls }
}
const yes = () => true, no = () => false

test('SRC-10/11: mount, read, edit, field changes, undo, online events and sync never dispatch', () => {
  const { panel, calls } = setup()
  assert.equal(panel.getState().selected, undefined)
  panel.edit('source-a', yes)
  assert.equal(panel.getState().values.publishedAt, '2026-09-27T09:03:04.567')
  panel.setField('title', 'Tạm sửa'); assert.equal(panel.shouldWarn(), true)
  panel.setField('title', 'Báo cáo tiếng Việt'); assert.equal(panel.getState().dirty, false)
  panel.setOnline(false); panel.setOnline(true); panel.sync(snapshot())
  assert.equal(panel.shouldWarn(), false); assert.equal(calls.length, 0)
})

test('SRC-02/09: update dispatches exact fields, fixed UTC+7 milliseconds and original parent token', async () => {
  const { panel, calls } = setup()
  panel.edit('source-a', yes); panel.setField('title', 'Tiêu đề mới')
  await panel.save()
  assert.deepEqual(calls, [{ kind: 'update', args: ['article-a', 'source-a', {
    sourceType: 'REPORT', title: 'Tiêu đề mới', publisher: '', url: '', publishedAt: '2026-09-27T02:03:04.567Z',
    accessedAt: null, dataTimestamp: null, note: 'Trang 3\nMục I', expectedUpdatedAt: token,
  }] }])
  assert.equal(panel.getState().snapshot.updatedAt, nextToken)
  assert.equal(panel.getState().values.title, 'Báo cáo tiếng Việt', 'canonical ACK resets baseline')
  assert.equal(panel.getState().dirty, false)
})

test('SRC-06/11: all create/update/delete share a synchronous pending gate and immutable dispatch values', async () => {
  const hold = deferred(), { panel, calls } = setup(snapshot(), () => hold.promise)
  panel.add(yes); panel.setField('title', 'Nguồn mới')
  const pending = panel.save()
  panel.setField('title', 'Không được đổi khi pending')
  await panel.save(); await panel.remove('source-a', yes)
  assert.equal(panel.edit('source-a', yes), false); assert.equal(panel.cancel(yes), false)
  assert.equal(panel.add(yes), false); assert.equal(calls.length, 1)
  assert.equal(calls[0].args[1].title, 'Nguồn mới')
  hold.resolve({ ok: true, data: snapshot({ updatedAt: nextToken, sources: [item(), item('new-id', { title: 'Nguồn mới' })] }) })
  await pending
  assert.equal(panel.getState().selected, 'new-id'); assert.equal(panel.getState().pending, false)
  assert.equal(panel.shouldWarn(), false)
})

test('SRC-10/20: dirty/pending snapshot cannot rebase token; clean snapshot may update without writes', async () => {
  const hold = deferred(), { panel, calls } = setup(snapshot(), () => hold.promise)
  panel.edit('source-a', yes); panel.setField('title', 'Giữ input')
  panel.sync(snapshot({ updatedAt: nextToken, sources: [] }))
  assert.equal(panel.getState().snapshot.updatedAt, token)
  assert.equal(panel.getState().values.title, 'Giữ input')
  const pending = panel.save(); panel.sync(snapshot({ updatedAt: nextToken, sources: [] }))
  assert.equal(panel.getState().snapshot.updatedAt, token)
  hold.resolve({ ok: true, data: snapshot({ updatedAt: nextToken }) }); await pending
  panel.sync(snapshot({ updatedAt: token, title: 'Old revalidation' }))
  assert.equal(panel.getState().snapshot.updatedAt, nextToken)
  panel.sync(snapshot({ updatedAt: '2026-09-27T02:00:00.003Z', title: 'Fresh snapshot' }))
  assert.equal(panel.getState().snapshot.title, 'Fresh snapshot'); assert.equal(calls.length, 1)
})

for (const code of ['VALIDATION_ERROR', 'SOURCE_LIMIT_REACHED']) test(`SRC-18: ${code} retains input and permits only explicit retry with same token`, async () => {
  const { panel, calls } = setup(snapshot(), fail(code))
  panel.add(yes); panel.setField('title', 'Giữ nguồn'); await panel.save()
  assert.equal(panel.getState().blocked, false); assert.equal(panel.getState().values.title, 'Giữ nguồn')
  assert.equal(panel.getState().pending, false); assert.equal(calls.length, 1)
  panel.setField('title', 'Sửa nguồn'); await panel.save()
  assert.equal(calls.length, 2); assert.equal(calls[1].args[1].expectedUpdatedAt, token)
})

test('SRC-18: offline before dispatch sends no request, retains form and online never resubmits', async () => {
  const { panel, calls } = setup(); panel.add(yes); panel.setField('title', 'Ngoại tuyến')
  panel.setOnline(false); await panel.save()
  assert.equal(calls.length, 0); assert.equal(panel.getState().values.title, 'Ngoại tuyến')
  assert.match(panel.getState().message, /Mất kết nối/)
  panel.setOnline(true); assert.equal(calls.length, 0)
  await panel.save(); assert.equal(calls.length, 1)
})

test('SRC-18: offline delete does not discard the active dirty form or send a request', async () => {
  const { panel, calls } = setup(); panel.add(yes); panel.setField('title', 'Giữ khi offline')
  panel.setOnline(false)
  let confirmations = 0
  await panel.remove('source-a', () => { confirmations++; return true })
  assert.equal(calls.length, 0); assert.equal(confirmations, 0)
  assert.equal(panel.getState().values.title, 'Giữ khi offline'); assert.equal(panel.getState().dirty, true)
})

for (const code of ['EDIT_CONFLICT', 'FORBIDDEN', 'NOT_FOUND', 'NOT_EDITABLE', 'UNSUPPORTED_DOCUMENT', 'INTERNAL_ERROR']) {
  test(`SRC-12/14/18: ${code} blocks all mutations and revalidation without losing input`, async () => {
    const { panel, calls } = setup(snapshot(), fail(code))
    panel.add(yes); panel.setField('title', 'Bản giữ lại'); await panel.save()
    assert.equal(panel.getState().blocked, true); assert.equal(panel.shouldWarn(), true)
    panel.sync(snapshot({ updatedAt: nextToken })); panel.setOnline(true)
    await panel.save(); await panel.remove('source-a', yes)
    assert.equal(panel.add(yes), false); assert.equal(panel.edit('source-a', yes), false)
    assert.equal(panel.getState().snapshot.updatedAt, token)
    assert.equal(panel.getState().values.title, 'Bản giữ lại'); assert.equal(calls.length, 1)
  })
}

test('SRC-18: thrown response/lost ACK remains uncertain, never duplicate create, retains input', async () => {
  const { panel, calls } = setup(snapshot(), () => { throw Error('private transport diagnostic') })
  panel.add(yes); panel.setField('title', 'Đã có thể lưu'); await panel.save()
  assert.equal(panel.getState().error.code, 'INTERNAL_ERROR'); assert.equal(panel.getState().blocked, true)
  assert.equal(JSON.stringify(panel.getState()).includes('private transport'), false)
  await panel.save(); assert.equal(calls.length, 1); assert.equal(panel.getState().values.title, 'Đã có thể lưu')
})

test('SRC-09/18: client date preparation failure unlocks and does not dispatch; corrected value can submit', async () => {
  const { panel, calls } = setup(); panel.add(yes); panel.setField('title', 'Ngày cần sửa')
  panel.setField('publishedAt', '2026-02-30T09:00'); await panel.save()
  assert.equal(calls.length, 0); assert.equal(panel.getState().error.code, 'VALIDATION_ERROR')
  assert.ok(panel.getState().error.fieldErrors.publishedAt)
  assert.equal(panel.getState().pending, false); assert.equal(panel.getState().blocked, false)
  panel.setField('publishedAt', '2026-02-28T09:00'); await panel.save(); assert.equal(calls.length, 1)
})

test('SRC-19: committed success with revalidation warning advances canonical token exactly once', async () => {
  const { panel, calls } = setup(snapshot(), { ok: true, data: snapshot({ updatedAt: nextToken }), warning: 'Đã lưu, tải lại danh sách khi cần.' })
  panel.edit('source-a', yes); panel.setField('note', 'mới'); await panel.save()
  assert.match(panel.getState().message, /Đã lưu/); assert.match(panel.getState().warning, /Đã lưu/)
  assert.equal(panel.getState().snapshot.updatedAt, nextToken); assert.equal(calls.length, 1)
})

test('SRC-15/20: dirty switching/cancel/delete must confirm; delete cancel sends nothing and preserves form', async () => {
  const { panel, calls } = setup(); panel.add(yes); panel.setField('title', 'Giữ input')
  assert.equal(panel.edit('source-a', no), false); assert.equal(panel.add(no), false); assert.equal(panel.cancel(no), false)
  await panel.remove('source-a', no); assert.equal(calls.length, 0)
  const questions = []
  await panel.remove('source-a', question => { questions.push(question); return questions.length === 1 })
  assert.equal(questions.length, 2); assert.match(questions[1], /Báo cáo tiếng Việt/)
  assert.equal(panel.getState().values.title, 'Giữ input'); assert.equal(calls.length, 0)
  await panel.remove('source-a', yes)
  assert.deepEqual(calls, [{ kind: 'delete', args: ['article-a', 'source-a', { expectedUpdatedAt: token }] }])
  assert.equal(panel.getState().selected, undefined)
})

test('SRC-20: accepted cancel discards source draft without refreshing token or writing', () => {
  const { panel, calls } = setup(); panel.add(yes); panel.setField('title', 'Bỏ bản này')
  assert.equal(panel.cancel(yes), true); assert.equal(panel.shouldWarn(), false)
  assert.equal(panel.getState().snapshot.updatedAt, token); assert.equal(calls.length, 0)
})

for (const operation of ['deactivate', 'leave']) test(`SRC-20: ${operation} blocks late ACK and subsequent requests`, async () => {
  const hold = deferred(), { panel, calls } = setup(snapshot(), () => hold.promise)
  panel.add(yes); panel.setField('title', 'Giữ phiên cũ'); const pending = panel.save()
  panel[operation](); hold.resolve({ ok: true, data: snapshot({ updatedAt: nextToken, title: 'Late response' }) }); await pending
  assert.equal(panel.getState().snapshot.updatedAt, token); assert.equal(panel.getState().values.title, 'Giữ phiên cũ')
  await panel.save(); assert.equal(calls.length, 1)
})

test('SRC-04: read-only panel cannot open mutation forms or dispatch actions', async () => {
  const { panel, calls } = setup(snapshot({ canMutate: false, readOnlyReason: 'NOT_EDITABLE', status: 'PUBLISHED' }))
  assert.equal(panel.add(yes), false); assert.equal(panel.edit('source-a', yes), false)
  await panel.save(); await panel.remove('source-a', yes); assert.equal(calls.length, 0)
})

test('SRC-04/20: clean revalidation into read-only closes its clean form; dirty instance keeps its original snapshot', () => {
  const { panel } = setup(); panel.edit('source-a', yes)
  panel.sync(snapshot({ updatedAt: nextToken, canMutate: false, readOnlyReason: 'NOT_EDITABLE' }))
  assert.equal(panel.getState().selected, undefined); assert.equal(panel.getState().snapshot.canMutate, false)
  const other = setup().panel; other.edit('source-a', yes); other.setField('title', 'Giữ bản stale')
  other.sync(snapshot({ updatedAt: nextToken, canMutate: false, readOnlyReason: 'NOT_EDITABLE' }))
  assert.equal(other.getState().selected, 'source-a'); assert.equal(other.getState().values.title, 'Giữ bản stale')
  assert.equal(other.getState().snapshot.updatedAt, token)
})
