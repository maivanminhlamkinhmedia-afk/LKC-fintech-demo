import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { Editor, getSchema } from '@tiptap/core'

// Pure controller + real strict validators/PM output, injected clocks/promises.
// No React scheduling, browser, app, credentials, environment files or database.
const feature = name => new URL(`../src/features/cms/${name}.ts`, import.meta.url).href
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.startsWith(new URL('../src/', import.meta.url).href)) {
    if (specifier === '@/lib/roles') return nextResolve(new URL('../src/lib/roles.ts', import.meta.url).href, context)
    if (specifier.startsWith('./')) return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context)
  }
  return nextResolve(specifier, context)
} })
let createArticleAutosave, AUTOSAVE_DELAY_MS, createEditorExtensions
try {
  ;({ createArticleAutosave, AUTOSAVE_DELAY_MS } = await import(feature('article-autosave')))
  ;({ createEditorExtensions } = await import(feature('editor-schema')))
} finally { hook.deregister() }

const schema = getSchema(createEditorExtensions())
const initialToken = '2026-09-26T01:00:00.000Z'
const token = number => `2026-09-26T01:00:00.${String(number).padStart(3, '0')}Z`
const paragraph = text => ({ type: 'doc', content: [{ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) }] })
const values = (patch = {}) => ({ title: 'Bài nháp', slug: 'bai-nhap', excerpt: '', articleType: 'NEWS', contentJson: paragraph('Tiếng Việt'), ...patch })
const ok = (number = 1, slug = 'bai-nhap', patch = {}) => ({ ok: true, data: { id: 'article-a', slug, updatedAt: token(number) }, ...patch })
const fail = code => ({ ok: false, error: { code, message: 'Lỗi an toàn.' } })
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve() }
function fakeClock() {
  let now = 0, sequence = 0
  const timers = new Map()
  return {
    now: () => now,
    setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { at: now + delay, callback }); return id },
    clearTimeout(id) { timers.delete(id) },
    advance(milliseconds) {
      const end = now + milliseconds
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
        if (!next) break
        timers.delete(next[0]); now = next[1].at; next[1].callback()
      }
      now = end
    },
    count: () => timers.size,
  }
}
function setup(options = {}) {
  const clock = fakeClock(), calls = [], slugs = [], states = []
  let concurrent = 0, maxConcurrent = 0
  const update = (id, payload) => {
    let resolve, reject
    const promise = new Promise((yes, no) => { resolve = yes; reject = no })
    concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent)
    calls.push({ id, payload, resolve, reject })
    return promise.finally(() => { concurrent-- })
  }
  const controller = createArticleAutosave({ id: 'article-a', initial: values(), updatedAt: initialToken,
    clock, update, onCanonicalSlug: (from, to) => slugs.push([from, to]), ...options })
  controller.subscribe(state => states.push(state))
  controller.activate()
  return { controller, clock, calls, slugs, states, maxConcurrent: () => maxConcurrent,
    async tick(milliseconds) { clock.advance(milliseconds); await flush() },
    async ack(index, result = ok(index + 1)) { calls[index].resolve(result); await flush(); clock.advance(0); await flush() },
    async reject(index) { calls[index].reject(new Error('SYNTHETIC_PRIVATE_TRANSPORT_ERROR')); await flush(); clock.advance(0); await flush() },
  }
}
function plain(value) {
  if (!value || typeof value !== 'object') return
  assert.equal(Object.getPrototypeOf(value), Array.isArray(value) ? Array.prototype : Object.prototype)
  for (const child of Object.values(value)) plain(child)
}

test('AUTO-02/20 initial baseline, repeat activation and StrictMode cleanup/setup have no writes and stable state', async () => {
  const h = setup()
  assert.equal(AUTOSAVE_DELAY_MS, 2000)
  assert.equal(h.states.length, 1, 'initial activation must publish to a mounted subscriber')
  assert.equal(h.controller.getState(), h.controller.getState())
  assert.equal(h.controller.getState().phase, 'clean')
  assert.equal(h.controller.shouldWarn(), false)
  h.controller.activate(); h.controller.setValues(values())
  await h.tick(50000)
  h.controller.deactivate(); h.controller.activate()
  await h.tick(50000)
  assert.equal(h.calls.length, 0)
  assert.equal(h.clock.count(), 0)
})

test('AUTO-03/04 debounce coalesces all five fields, validates/canonicalizes and permits blank body', async () => {
  const h = setup()
  h.controller.setValues(values({ title: 'Tiêu đề một' }))
  await h.tick(1999)
  assert.equal(h.calls.length, 0)
  h.controller.setValues(values({ title: ' Tiêu đề hai ', slug: 'Đường Dẫn Mới', excerpt: ' Tóm tắt ', articleType: 'ANALYSIS', contentJson: paragraph('') }))
  await h.tick(1999)
  assert.equal(h.calls.length, 0)
  await h.tick(1)
  assert.equal(h.calls.length, 1)
  assert.deepEqual(h.calls[0].payload, { title: 'Tiêu đề hai', slug: 'duong-dan-moi', excerpt: 'Tóm tắt', articleType: 'ANALYSIS', contentJson: paragraph(''), expectedUpdatedAt: initialToken })
  assert.equal(h.controller.getState().phase, 'saving')
  assert.equal(h.controller.shouldWarn(), true)
  await h.ack(0, ok(1, 'duong-dan-moi'))
  assert.equal(h.controller.getState().phase, 'clean')
  assert.equal(h.controller.shouldWarn(), false)
})

test('AUTO-04/18 immutable snapshots carry real PM attrs as plain JSON and exclude derived text', async () => {
  const h = setup()
  const doc = schema.nodes.doc.createChecked(null, [
    schema.nodes.heading.createChecked({ level: 2 }, schema.text('Tiếng Việt')),
    schema.nodes.codeBlock.createChecked({ language: 'javascript' }, schema.text('const x = 1;\n  x++')),
    schema.nodes.paragraph.createChecked(null, schema.text('Liên kết', [schema.marks.link.create({ href: 'https://example.com/vi' })])),
    schema.nodes.orderedList.createChecked({ start: 2 }, schema.nodes.listItem.createChecked(null, schema.nodes.paragraph.createChecked(null, schema.text('Mục')))),
  ])
  const raw = Editor.prototype.getJSON.call({ state: { doc } })
  assert.equal(Object.getPrototypeOf(raw.content[0].attrs), null)
  const input = values({ contentJson: raw })
  h.controller.setValues(input)
  input.title = 'Mutated after capture'
  await h.tick(2000)
  const sent = h.calls[0].payload
  plain(sent)
  assert.equal(sent.title, 'Bài nháp')
  assert.equal('contentText' in sent, false)
  assert.deepEqual(sent.contentJson, JSON.parse(JSON.stringify(raw)))
  assert.throws(() => { sent.contentJson.content[0].attrs.level = 3 }, TypeError)
  await h.ack(0)
})

test('AUTO-05/06/23 old ACK preserves latest edits and only one overdue follow-up uses its persisted token', async () => {
  const h = setup()
  h.controller.setValues(values({ title: 'S1' })); await h.tick(2000)
  h.controller.setValues(values({ title: 'S2' })); await h.tick(900)
  h.controller.setValues(values({ title: 'S3' })); await h.tick(2200)
  assert.equal(h.calls.length, 1)
  assert.equal(h.controller.getState().dirty, true)
  await h.ack(0, ok(7))
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[1].payload.title, 'S3')
  assert.equal(h.calls[1].payload.expectedUpdatedAt, token(7))
  assert.equal(h.controller.getState().phase, 'saving')
  await h.ack(1, ok(9))
  assert.equal(h.controller.getState().phase, 'clean')
  assert.equal(h.maxConcurrent(), 1)
})

test('AUTO-06 ACK does not reset the newest edit deadline; only its remaining interval is waited', async () => {
  const h = setup()
  h.controller.setValues(values({ title: 'S1' })); await h.tick(2000)
  await h.tick(300); h.controller.setValues(values({ title: 'S2' }))
  await h.tick(400); await h.ack(0)
  await h.tick(1599)
  assert.equal(h.calls.length, 1)
  await h.tick(1)
  assert.equal(h.calls.length, 2)
  await h.ack(1)
})

test('AUTO-08 reverting to the confirmed document before dispatch cancels a no-op write', async () => {
  const h = setup()
  h.controller.setValues(values({ title: 'Changed' })); await h.tick(1500)
  h.controller.setValues(values())
  await h.tick(9000); await h.controller.manualSave()
  assert.equal(h.calls.length, 0)
  assert.equal(h.controller.shouldWarn(), false)
})

test('AUTO-08 undo to S0 during S1 in-flight remains dirty and persists S0 after S1 ACK', async () => {
  const h = setup()
  h.controller.setValues(values({ title: 'S1' })); await h.tick(2000)
  h.controller.setValues(values())
  assert.equal(h.controller.getState().dirty, true)
  await h.tick(2000); await h.ack(0)
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[1].payload.title, 'Bài nháp')
  assert.equal(h.calls[1].payload.expectedUpdatedAt, token(1))
  await h.ack(1)
  assert.equal(h.controller.shouldWarn(), false)
})

test('AUTO-07 manual flush cancels its timer and repeated submits coalesce with an active update', async () => {
  const h = setup()
  h.controller.setValues(values({ title: 'Manual' }))
  const first = h.controller.manualSave()
  const second = h.controller.manualSave()
  await h.tick(5000)
  assert.equal(h.calls.length, 1)
  await h.ack(0); await Promise.all([first, second])
  await h.controller.manualSave(); await h.tick(5000)
  assert.equal(h.calls.length, 1)
  assert.equal(h.maxConcurrent(), 1)
})

test('AUTO-07 manual intent while saving flushes only the latest snapshot immediately after success', async () => {
  const h = setup()
  h.controller.setValues(values({ title: 'S1' })); await h.tick(2000)
  h.controller.setValues(values({ title: 'S2' }))
  const manual = h.controller.manualSave()
  h.controller.setValues(values({ title: 'S3' }))
  await h.ack(0); await manual
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[1].payload.title, 'S3')
  assert.equal(h.calls[1].payload.expectedUpdatedAt, token(1))
  await h.ack(1)
})

test('AUTO-05 canonical slug ACK updates only an unchanged raw slug and causes no extra normalization write', async () => {
  const h = setup()
  h.controller.setValues(values({ slug: 'Đường Dẫn' })); await h.tick(2000)
  h.controller.setValues(values({ slug: 'Đường Dẫn', title: 'New typing' }))
  await h.ack(0, ok(1, 'duong-dan'))
  assert.deepEqual(h.slugs, [['Đường Dẫn', 'duong-dan']])
  await h.tick(2000)
  assert.equal(h.calls[1].payload.title, 'New typing')
  assert.equal(h.calls[1].payload.slug, 'duong-dan')
  await h.ack(1, ok(2, 'duong-dan')); await h.tick(5000)
  assert.equal(h.calls.length, 2)
  const other = setup()
  other.controller.setValues(values({ slug: 'Cũ' })); await other.tick(2000)
  other.controller.setValues(values({ slug: 'Mới' }))
  await other.ack(0, ok(1, 'cu'))
  assert.deepEqual(other.slugs, [])
  await other.tick(2000)
  assert.equal(other.calls[1].payload.slug, 'moi')
  await other.ack(1, ok(2, 'moi'))
})

test('AUTO-09 strict capture rejects malicious/invalid input before stringify and resumes after correction', async () => {
  let invoked = 0
  const getter = Object.defineProperty(values(), 'title', { enumerable: true, get() { invoked++; return 'getter' } })
  const attrs = Object.defineProperty({}, 'language', { enumerable: true, get() { invoked++; return null } })
  const toJSON = values({ toJSON() { invoked++; return values() } })
  const bad = [getter, toJSON, values({ authorId: 'forged' }), values({ title: '' }), values({ excerpt: 'x'.repeat(2001) }),
    values({ contentJson: { type: 'doc', content: [{ type: 'codeBlock', attrs }] } }),
    values({ contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] } })]
  const h = setup()
  for (const input of bad) {
    h.controller.setValues(input); await h.tick(5000); await h.controller.manualSave()
    assert.equal(h.controller.getState().phase, 'validation-blocked')
    assert.equal(h.controller.shouldWarn(), true)
    assert.equal(h.calls.length, 0)
  }
  assert.equal(invoked, 0)
  h.controller.setValues(values({ title: 'Corrected' })); await h.tick(1999)
  assert.equal(h.calls.length, 0)
  await h.tick(1); await h.ack(0)
  assert.equal(h.controller.getState().phase, 'clean')
})

test('AUTO-09 server validation blocks the failed fingerprint until changed or a fresh manual retry', async () => {
  const h = setup()
  const failed = values({ title: 'Rejected' })
  h.controller.setValues(failed); await h.tick(2000); await h.ack(0, fail('VALIDATION_ERROR'))
  h.controller.setValues(failed); h.controller.setOnline(false); h.controller.setOnline(true)
  await h.tick(10000)
  assert.equal(h.calls.length, 1)
  assert.equal(h.controller.getState().phase, 'validation-blocked')
  const retry = h.controller.manualSave(); await h.ack(1, fail('VALIDATION_ERROR')); await retry
  h.controller.setValues(values({ title: 'Fixed' })); await h.tick(2000)
  assert.equal(h.calls.length, 3)
  await h.ack(2, ok(3))
})

test('AUTO-10 slug conflict suppresses the same canonical slug across body edits and online events', async () => {
  const h = setup()
  h.controller.setValues(values({ slug: 'Đụng Slug' })); await h.tick(2000); await h.ack(0, fail('SLUG_CONFLICT'))
  h.controller.setValues(values({ slug: 'DUNG SLUG', contentJson: paragraph('New body') }))
  h.controller.setOnline(false); h.controller.setOnline(true); await h.tick(20000)
  assert.equal(h.calls.length, 1)
  assert.equal(h.controller.getState().error.code, 'SLUG_CONFLICT')
  const retry = h.controller.manualSave(); await h.ack(1, fail('SLUG_CONFLICT')); await retry
  h.controller.setValues(values({ slug: 'unique-slug' })); await h.tick(2000)
  assert.equal(h.calls.length, 3)
  await h.ack(2, ok(3, 'unique-slug'))
})

test('AUTO-11 offline before dispatch keeps latest changes and reconnect rearms one full debounce', async () => {
  const h = setup()
  h.controller.setOnline(false)
  h.controller.setValues(values({ title: 'S1' })); await h.tick(8000)
  h.controller.setValues(values({ title: 'S2' })); await h.controller.manualSave()
  assert.equal(h.calls.length, 0)
  assert.equal(h.controller.getState().phase, 'offline')
  h.controller.setOnline(true); h.controller.setOnline(true)
  await h.tick(1999); assert.equal(h.calls.length, 0)
  await h.tick(1); assert.equal(h.calls[0].payload.title, 'S2')
  await h.ack(0)
})

test('AUTO-12 unknown response cancels preexisting queued manual intent and only fresh manual uses the old token', async () => {
  const h = setup()
  h.controller.setValues(values({ title: 'Maybe committed' })); await h.tick(2000)
  h.controller.setValues(values({ title: 'Keep newest' }))
  const queued = h.controller.manualSave()
  await h.reject(0); await queued
  assert.equal(h.controller.getState().phase, 'uncertain')
  h.controller.setValues(values({ title: 'Still keep newest' }))
  h.controller.setOnline(false); h.controller.setOnline(true); await h.tick(20000)
  assert.equal(h.calls.length, 1)
  assert.equal(h.controller.shouldWarn(), true)
  const retry = h.controller.manualSave()
  assert.equal(h.calls[1].payload.expectedUpdatedAt, initialToken)
  await h.ack(1, fail('EDIT_CONFLICT')); await retry
  await h.controller.manualSave(); await h.tick(10000)
  assert.equal(h.calls.length, 2)
  assert.equal(h.controller.getState().phase, 'conflict')
})

test('AUTO-12 INTERNAL_ERROR and synchronous transport throws never cause automatic retries or permanent pending locks', async () => {
  const h = setup()
  h.controller.setValues(values({ title: 'Unknown' })); await h.tick(2000); await h.ack(0, fail('INTERNAL_ERROR'))
  await h.tick(10000)
  assert.equal(h.calls.length, 1)
  assert.equal(h.controller.getState().phase, 'uncertain')
  assert.equal(h.controller.getState().pending, false)
  const throwing = setup({ update() { throw new Error('SYNTHETIC_PRIVATE_SYNC_ERROR') } })
  throwing.controller.setValues(values({ title: 'Throw' })); await throwing.controller.manualSave()
  assert.equal(throwing.controller.getState().phase, 'uncertain')
  assert.equal(throwing.controller.getState().pending, false)
  assert.equal(JSON.stringify(throwing.controller.getState()).includes('SYNTHETIC_PRIVATE'), false)
})

for (const code of ['EDIT_CONFLICT', 'FORBIDDEN', 'NOT_FOUND', 'NOT_EDITABLE', 'UNSUPPORTED_DOCUMENT']) {
  test(`AUTO-13/14/15/16/17 ${code} stops queued and future mutations while preserving dirty navigation warning`, async () => {
    const h = setup()
    h.controller.setValues(values({ title: 'S1' })); await h.tick(2000)
    h.controller.setValues(values({ title: 'S2' }))
    const queued = h.controller.manualSave()
    await h.ack(0, fail(code)); await queued
    h.controller.setValues(values({ title: 'S3' }))
    h.controller.setOnline(false); h.controller.setOnline(true)
    await h.controller.manualSave(); await h.tick(20000)
    assert.equal(h.calls.length, 1)
    assert.equal(h.controller.getState().phase, code === 'EDIT_CONFLICT' ? 'conflict' : 'terminal')
    assert.equal(h.controller.getState().error.code, code)
    assert.equal(h.controller.shouldWarn(), true)
  })
}

test('AUTO-19 composition blocks timers and manual flush until complete, then waits a fresh debounce', async () => {
  const h = setup()
  h.controller.setComposing(true)
  h.controller.setValues(values({ title: 'Tiếng Việt đang gõ' })); await h.tick(10000)
  await h.controller.manualSave()
  assert.equal(h.calls.length, 0)
  h.controller.setValues(values({ title: 'Tiếng Việt hoàn chỉnh' }))
  h.controller.setComposing(false)
  await h.tick(1999); assert.equal(h.calls.length, 0)
  await h.tick(1); assert.equal(h.calls[0].payload.title, 'Tiếng Việt hoàn chỉnh')
  await h.ack(0)
  h.controller.setComposing(true); h.controller.setComposing(false); await h.tick(4000)
  assert.equal(h.calls.length, 1)
})

test('AUTO-20 lifecycle deactivation cancels timers and late ACK cannot update token or slug after reactivation', async () => {
  const h = setup()
  h.controller.setValues(values({ title: 'First' })); h.controller.deactivate(); await h.tick(5000)
  assert.equal(h.calls.length, 0)
  h.controller.activate(); await h.tick(2000)
  h.controller.setValues(values({ slug: 'Mới', title: 'Second' }))
  h.controller.deactivate(); const statesAtCleanup = h.states.length
  await h.ack(0)
  assert.equal(h.states.length, statesAtCleanup)
  assert.deepEqual(h.slugs, [])
  h.controller.activate(); await h.tick(10000)
  assert.equal(h.controller.getState().phase, 'uncertain')
  assert.equal(h.calls.length, 1)
  const retry = h.controller.manualSave()
  assert.equal(h.calls[1].payload.expectedUpdatedAt, initialToken)
  await h.ack(1, fail('EDIT_CONFLICT')); await retry
})

test('AUTO-20/21 accepted navigation is irreversible and article A ACK never touches a new B controller', async () => {
  const a = setup()
  a.controller.setValues(values({ slug: 'Article A' })); await a.tick(2000)
  a.controller.setValues(values({ title: 'Queued A', slug: 'Article A' }))
  const manual = a.controller.manualSave()
  assert.equal(a.controller.shouldWarn(), true)
  a.controller.leave()
  assert.equal(a.controller.shouldWarn(), false, 'accepted navigation must not prompt again at beforeunload')
  const b = setup({ id: 'article-b', initial: values({ title: 'Article B' }) })
  await a.ack(0, ok(1, 'article-a')); await manual
  a.controller.activate(); a.controller.setValues(values({ title: 'Ignored' })); await a.controller.manualSave(); await a.tick(9000)
  assert.equal(a.calls.length, 1)
  assert.equal(a.controller.getState().phase, 'leaving')
  assert.equal(a.controller.shouldWarn(), false, 'late ACK must not reactivate navigation warnings')
  assert.deepEqual(a.slugs, [])
  assert.equal(b.controller.getState().phase, 'clean')
  assert.equal(b.calls.length, 0)
})

test('AUTO-22 committed cache warning confirms data and token without resending the same snapshot', async () => {
  const h = setup()
  h.controller.setValues(values({ title: 'Saved' })); await h.tick(2000)
  await h.ack(0, ok(4, 'bai-nhap', { warning: 'Vui lòng tải lại danh sách.' }))
  assert.equal(h.controller.getState().phase, 'clean')
  assert.equal(h.controller.getState().warning, 'Vui lòng tải lại danh sách.')
  await h.controller.manualSave(); await h.tick(10000)
  assert.equal(h.calls.length, 1)
  h.controller.setValues(values({ title: 'New data' })); await h.tick(2000)
  assert.equal(h.calls[1].payload.expectedUpdatedAt, token(4))
  await h.ack(1, ok(5))
})

test('invalid ACK identity/token cannot advance the confirmed baseline or trigger a follow-up', async () => {
  for (const data of [{ id: 'wrong-article', slug: 'bai-nhap', updatedAt: token(1) },
    { id: 'article-a', slug: 'bai-nhap', updatedAt: initialToken },
    { id: 'article-a', slug: 'not canonical!', updatedAt: token(1) }]) {
    const h = setup()
    h.controller.setValues(values({ title: 'S1' })); await h.tick(2000)
    h.controller.setValues(values({ title: 'S2' })); await h.ack(0, { ok: true, data })
    await h.tick(9000)
    assert.equal(h.calls.length, 1)
    assert.equal(h.controller.getState().phase, 'uncertain')
  }
})
