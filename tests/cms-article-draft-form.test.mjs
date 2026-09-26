import assert from 'node:assert/strict'
import test, { beforeEach, afterEach } from 'node:test'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { Editor, getSchema } from '@tiptap/core'
import ts from 'typescript'

// Execute the actual form, controller, subscriptions and effect setup/cleanup.
// React scheduling/framework I/O/editor view are adapted; schema, ProseMirror,
// TipTap getJSON and autosave scheduling remain real. Not browser/hydration proof.
const sourceRoot = new URL('../src/', import.meta.url)
const formUrl = new URL('features/cms/components/ArticleDraftForm.tsx', sourceRoot).href
const bridge = Symbol.for('cms-draft-form-test-adapter')
let current, rendering
let clock, mounted, originals
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
beforeEach(() => {
  let now = 0, next = 1
  const timers = new Map()
  mounted = []
  originals = new Map(['window', 'document', 'Element', 'navigator', 'setTimeout', 'clearTimeout'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  originals.set('now', Date.now)
  const events = () => {
    const listeners = new Map()
    return {
      addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn) },
      removeEventListener(type, fn) { listeners.get(type)?.delete(fn) },
      emit(type, event = {}) { for (const fn of [...(listeners.get(type) ?? [])]) fn(event) },
      count: type => listeners.get(type)?.size ?? 0,
    }
  }
  class SyntheticElement { closest() { return this.anchor ?? null } }
  const win = { ...events(), confirm: () => current.confirm,
    location: { href: 'https://example.com/creator/articles/article-form/edit', origin: 'https://example.com', pathname: '/creator/articles/article-form/edit', search: '', reload() { current.reloads++ } } }
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: win }, document: { configurable: true, value: events() },
    Element: { configurable: true, value: SyntheticElement }, navigator: { configurable: true, value: { onLine: true } },
    setTimeout: { configurable: true, value(fn, delay = 0, ...args) { const id = next++; const owner = current; timers.set(id, { at: now + delay, fn: () => { current = owner; fn(...args) } }); return id } },
    clearTimeout: { configurable: true, value: id => timers.delete(id) },
  })
  Date.now = () => now
  clock = { get pending() { return timers.size }, async tick(ms) {
    const end = now + ms
    while (true) {
      const nextTimer = [...timers].sort((a, b) => a[1].at - b[1].at)[0]
      if (!nextTimer || nextTimer[1].at > end) break
      now = nextTimer[1].at
      timers.delete(nextTimer[0]); nextTimer[1].fn()
      await flush()
      for (const form of mounted) form.render()
    }
    now = end
    await flush()
    for (const form of mounted) form.render()
  } }
})
afterEach(() => {
  for (const form of mounted) form.unmount()
  for (const [key, descriptor] of originals) {
    if (key === 'now') Date.now = descriptor
    else if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }
})

function slot(initialize) {
  assert.ok(rendering, 'Hooks must run during an explicit form render')
  const index = rendering.cursor++
  if (!(index in rendering.slots)) rendering.slots[index] = initialize()
  return rendering.slots[index]
}
const adapter = {
  useState(initial) {
    const state = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }))
    return [state.value, value => { state.value = typeof value === 'function' ? value(state.value) : value }]
  },
  useRef(initial) { return slot(() => ({ current: initial })) },
  useCallback(callback, dependencies) {
    const memo = slot(() => ({ callback, dependencies }))
    if (dependencies.length !== memo.dependencies.length || dependencies.some((value, index) => !Object.is(value, memo.dependencies[index]))) {
      memo.callback = callback
      memo.dependencies = dependencies
    }
    return memo.callback
  },
  useEffect(effect, dependencies) {
    const entry = slot(() => ({ dependencies: null, cleanup: null }))
    if (!entry.dependencies || dependencies.some((value, index) => !Object.is(value, entry.dependencies[index]))) {
      entry.effect = effect
      entry.dependencies = dependencies
      entry.pending = true
    }
  },
  useRouter() { return current.router },
  Link() {},
  ArticleEditor() {},
  async createArticleDraft(payload) {
    current.calls.push({ kind: 'create', payload }) // Keep original references/prototypes for transport assertions.
    return current.action({ kind: 'create', payload })
  },
  async updateArticleDraft(id, payload) {
    current.calls.push({ kind: 'update', id, payload })
    return current.action({ kind: 'update', id, payload })
  },
}
globalThis[bridge] = adapter
const moduleFor = exports => `data:text/javascript,${encodeURIComponent(
  `const adapter = globalThis[Symbol.for('cms-draft-form-test-adapter')]; ${exports}`,
)}`
const replacements = new Map([
  ['react', moduleFor('export const { useState, useRef, useCallback, useEffect } = adapter;')],
  ['next/navigation', moduleFor('export const useRouter = adapter.useRouter;')],
  ['next/link', moduleFor('export default adapter.Link;')],
  ['./ArticleEditor', moduleFor('export const ArticleEditor = adapter.ArticleEditor;')],
  ['@/features/cms/article-draft-actions', moduleFor('export const { createArticleDraft, updateArticleDraft } = adapter;')],
])
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === formUrl && replacements.has(specifier)) return nextResolve(replacements.get(specifier), context)
    if (specifier.startsWith('@/')) return nextResolve(new URL(`${specifier.slice(2)}.ts`, sourceRoot).href, context)
    if (context.parentURL?.startsWith(sourceRoot.href) && specifier.startsWith('./') && !/\.[mc]?ts$/.test(specifier)) {
      return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context)
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url === formUrl) {
      const source = ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
      } }).outputText
      return { format: 'module', shortCircuit: true, source }
    }
    return nextLoad(url, context)
  },
})
let ArticleDraftForm, createEditorExtensions
try {
  ;({ ArticleDraftForm } = await import(formUrl))
  ;({ createEditorExtensions } = await import(new URL('features/cms/editor-schema.ts', sourceRoot).href))
} finally { hook.deregister(); delete globalThis[bridge] }

const schema = getSchema(createEditorExtensions())
const paragraph = value => schema.nodes.paragraph.createChecked(null, schema.text(value))
const fixtures = [
  ['paragraph', paragraph('Nội dung tiếng Việt'), { type: 'paragraph', content: [{ type: 'text', text: 'Nội dung tiếng Việt' }] }],
  ['code block', schema.nodes.codeBlock.createChecked({ language: 'javascript' }, schema.text('const tiếngViệt = "an toàn";\n  x++')),
    { type: 'codeBlock', attrs: { language: 'javascript' }, content: [{ type: 'text', text: 'const tiếngViệt = "an toàn";\n  x++' }] }],
  ['link', schema.nodes.paragraph.createChecked(null, schema.text('Liên kết an toàn', [schema.marks.link.create({ href: 'https://example.com/vi' })])),
    { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'link', attrs: {
      href: 'https://example.com/vi', target: '_blank', rel: 'noopener noreferrer nofollow', class: null, title: null,
    } }], text: 'Liên kết an toàn' }] }],
  ['heading', schema.nodes.heading.createChecked({ level: 2 }, schema.text('Tiêu đề tiếng Việt')),
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Tiêu đề tiếng Việt' }] }],
  ['ordered list', schema.nodes.orderedList.createChecked({ start: 3, type: 'A' }, [schema.nodes.listItem.createChecked(null, paragraph('Mục thứ ba'))]),
    { type: 'orderedList', attrs: { start: 3, type: 'A' }, content: [{ type: 'listItem', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Mục thứ ba' }] },
    ] }] }],
]
const documentFor = node => schema.nodes.doc.createChecked(null, node)
const getRealJSON = document => Editor.prototype.getJSON.call({ state: { doc: document } })
const originalToken = '2026-09-25T01:02:03.456Z'
const nextToken = '2026-09-25T01:02:03.457Z'
const header = { title: '  Tiêu đề kiểm tra  ', slug: 'ban-nhap-thu', excerpt: ' Tóm tắt Việt ', articleType: 'ANALYSIS' }
const success = { ok: true, data: { id: 'article-form', slug: header.slug, updatedAt: nextToken } }

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...nodes(tree.props?.children)]
}
function plainJson(value, path = 'payload') {
  if (value === null || typeof value !== 'object') {
    assert.ok(['string', 'boolean', 'number'].includes(typeof value) || value === null, `${path} must contain JSON values`)
    if (typeof value === 'number') assert.ok(Number.isFinite(value))
    return
  }
  assert.equal(Object.getPrototypeOf(value), Array.isArray(value) ? Array.prototype : Object.prototype, `${path} must be transport-safe plain JSON`)
  for (const [key, child] of Object.entries(value)) plainJson(child, `${path}.${key}`)
}
function mount(document, { edit = false, action = () => success, pristine = false, initial: suppliedInitial } = {}) {
  let instance = { slots: [], cursor: 0 }, live = true, lastKey
  let initial = suppliedInitial ?? (edit ? { id: 'article-form', updatedAt: originalToken, ...header,
    contentJson: { type: 'doc', content: [{ type: 'paragraph' }] } } : undefined)
  const state = { calls: [], replacements: [], action, editable: true, editableCalls: [], confirm: false, reloads: 0, getJSON: () => getRealJSON(document) }
  state.router = { replace(path) { state.replacements.push(path) } }
  current = state
  const editor = {
    getJSON() { return state.getJSON() },
    setEditable(value, emitUpdate) { state.editable = value; state.editableCalls.push([value, emitUpdate]) },
  }
  let tree
  function cleanup() { for (const entry of instance.slots) if (entry.cleanup) { entry.cleanup(); entry.cleanup = null } }
  function render() {
    if (!live) return tree
    current = state
    const wrapper = ArticleDraftForm({ initial })
    if (lastKey !== undefined && wrapper.key !== lastKey) { cleanup(); instance = { slots: [], cursor: 0 } }
    lastKey = wrapper.key
    instance.cursor = 0
    rendering = instance
    try { tree = wrapper.type(wrapper.props) } finally { rendering = null }
    for (const entry of instance.slots) if (entry.pending) {
      entry.pending = false; entry.cleanup?.(); entry.cleanup = entry.effect()
    }
    return tree
  }
  const find = predicate => {
    const matches = nodes(tree).filter(predicate)
    assert.equal(matches.length, 1, 'Expected one form element')
    return matches[0]
  }
  const input = id => find(node => node.props?.id === id)
  const editorView = () => find(node => node.type === adapter.ArticleEditor)
  const change = (id, value) => { current = state; input(id).props.onChange({ target: { value } }); render() }
  render()
  editorView().props.onReady(editor)
  render()
  if (!pristine) {
    change('article-title', header.title)
    change('article-slug', header.slug)
    change('article-excerpt', header.excerpt)
    change('article-type', header.articleType)
    editorView().props.onChange(getRealJSON(document))
  }
  render()
  const form = { state, render, input, editorView, change,
    document(value) { current = state; state.getJSON = () => value; editorView().props.onChange(value); render() },
    submit: () => { current = state; return find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }) },
    status: () => find(node => node.props?.role === 'status').props.children,
    error: () => nodes(tree).find(node => node.props?.['data-error-code']),
    locked: () => ({ form: find(node => node.type === 'form').props['aria-busy'],
      fields: find(node => node.type === 'fieldset').props.disabled,
      save: find(node => node.type === 'button' && node.props.type === 'submit').props.disabled,
      editor: editorView().props.disabled }),
    composition(start) { current = state; find(node => node.type === 'form').props[start ? 'onCompositionStartCapture' : 'onCompositionEndCapture']() },
    online(value) { current = state; navigator.onLine = value; window.emit(value ? 'online' : 'offline'); render() },
    unload() { let prevented = false; const event = { preventDefault() { prevented = true } }; window.emit('beforeunload', event); return prevented },
    navigate(accept) {
      current = state; state.confirm = accept
      const target = new Element(); target.anchor = { href: 'https://example.com/creator/articles', target: '', hasAttribute: () => false }
      let prevented = false
      globalThis.document.emit('click', { target, button: 0, preventDefault() { prevented = true }, stopPropagation() {}, stopImmediatePropagation() {} })
      render(); return prevented
    },
    reload(accept) {
      current = state; state.confirm = accept
      find(node => node.type === 'button' && node.props.children === 'Tải lại bản mới nhất').props.onClick()
      render()
    },
    replayEffects() {
      current = state; cleanup()
      for (const entry of instance.slots) if (entry.effect) entry.cleanup = entry.effect()
      render()
    },
    rerenderInitial(next) { initial = next; render(); editorView().props.onReady(editor); render() },
    unmount() { if (!live) return; current = state; cleanup(); live = false },
  }
  mounted.push(form)
  return form
}

for (const [name, node, expectedNode] of fixtures) {
  for (const edit of [false, true]) {
    test(`actual draft form sends plain ${name} JSON with intact metadata on ${edit ? 'update' : 'create'}`, async () => {
      const form = mount(documentFor(node), { edit })
      await form.submit()
      form.render()
      assert.equal(form.state.calls.length, 1)
      const call = form.state.calls[0]
      assert.equal(call.kind, edit ? 'update' : 'create')
      if (edit) assert.equal(call.id, 'article-form')
      plainJson(call.payload)
      assert.deepEqual(call.payload, { ...header, ...(edit ? { title: header.title.trim(), excerpt: header.excerpt.trim() } : {}), contentJson: { type: 'doc', content: [expectedNode] },
        ...(edit ? { expectedUpdatedAt: originalToken } : {}) })
      assert.equal(form.status(), 'Đã lưu')
      assert.equal(form.error(), undefined)
      assert.equal(form.state.editable, edit)
      assert.deepEqual(form.state.replacements, edit ? [] : ['/creator/articles/article-form/edit'])
    })
  }
}

for (const failure of ['getJSON throws', 'cyclic JSON']) {
  test(`draft preparation ${failure} is safe, unlocks and permits an explicit retry`, async () => {
    const form = mount(documentFor(paragraph('Bản nháp cần giữ lại')))
    if (failure === 'getJSON throws') form.state.getJSON = () => { throw new Error('SYNTHETIC_PRIVATE_EDITOR_ERROR') }
    else {
      const cyclic = { type: 'doc', content: [] }
      cyclic.content.push(cyclic)
      form.state.getJSON = () => cyclic
    }
    await assert.doesNotReject(form.submit())
    form.render()
    assert.equal(form.state.calls.length, 0, 'Preparation failure must not invoke an action')
    assert.equal(form.status(), 'Lưu thất bại')
    assert.equal(form.error()?.props['data-error-code'], 'INTERNAL_ERROR')
    assert.equal(form.error().props.children.includes('SYNTHETIC_PRIVATE'), false)
    assert.deepEqual(form.locked(), { form: false, fields: false, save: false, editor: false })
    assert.equal(form.state.editable, true)
    assert.equal(form.input('article-title').props.value, header.title)
    assert.equal(form.input('article-excerpt').props.value, header.excerpt)
    assert.deepEqual(form.state.replacements, [])
    form.state.getJSON = () => getRealJSON(documentFor(paragraph('Bản nháp cần giữ lại')))
    await form.submit()
    form.render()
    assert.equal(form.state.calls.length, 1)
    assert.equal(form.status(), 'Đã lưu')
    assert.equal(form.error(), undefined)
  })
}

test('pending create blocks concurrent submits and retains its lock until successful route navigation', async () => {
  let resolveAction
  const form = mount(documentFor(paragraph('Bản nháp đang lưu')), {
    action: () => new Promise(resolve => { resolveAction = resolve }),
  })
  const first = form.submit()
  await form.submit() // Before a render: the synchronous ref must prevent a duplicate.
  form.render()
  assert.equal(form.state.calls.length, 1)
  assert.equal(form.status(), 'Đang lưu…')
  assert.deepEqual(form.locked(), { form: true, fields: true, save: true, editor: true })
  assert.equal(form.state.editable, false)
  resolveAction(success)
  await first
  form.render()
  assert.equal(form.status(), 'Đã lưu')
  assert.deepEqual(form.state.replacements, ['/creator/articles/article-form/edit'])
  assert.deepEqual(form.locked(), { form: true, fields: true, save: true, editor: true })
  assert.equal(form.state.editable, false)
  await form.submit()
  assert.equal(form.state.calls.length, 1, 'A saved create must not submit again during route transition')
})

test('known rejected update retains values/token; explicit valid retry succeeds and clean manual is a no-op', async () => {
  const error = { code: 'VALIDATION_ERROR', message: 'Vui lòng kiểm tra dữ liệu bài viết.' }
  const form = mount(documentFor(paragraph('Nội dung cần giữ')), { edit: true, action: () => ({ ok: false, error }) })
  await form.submit()
  form.render()
  assert.equal(form.status(), 'Tự động lưu tạm dừng…')
  assert.equal(form.error()?.props['data-error-code'], error.code)
  assert.equal(form.input('article-title').props.value, header.title)
  assert.deepEqual(form.locked(), { form: false, fields: false, save: false, editor: false })
  assert.equal(form.state.editable, true)
  form.state.action = () => success
  await form.submit()
  form.render()
  assert.equal(form.state.calls[1].payload.expectedUpdatedAt, originalToken)
  assert.deepEqual(form.state.calls[1].payload.contentJson, form.state.calls[0].payload.contentJson)
  assert.equal(form.status(), 'Đã lưu')
  assert.equal(form.error(), undefined)
  assert.equal(form.state.editable, true)
  assert.deepEqual(form.state.replacements, [])
  await form.submit()
  form.render()
  assert.equal(form.state.calls.length, 2, 'A clean manual save must not advance updatedAt')
  form.change('article-excerpt', 'Nội dung mới sau ACK')
  form.state.action = () => ({ ...success, data: { ...success.data, updatedAt: '2026-09-25T01:02:03.458Z' } })
  await form.submit()
  form.render()
  assert.equal(form.state.calls[2].payload.expectedUpdatedAt, nextToken)
  assert.equal(form.status(), 'Đã lưu')
})

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const ack = (payload, warning) => ({ ok: true, data: { id: 'article-form', slug: payload.slug,
  updatedAt: new Date(new Date(payload.expectedUpdatedAt).getTime() + 1).toISOString() }, ...(warning ? { warning } : {}) })
const editInitial = { id: 'article-form', updatedAt: originalToken, ...header,
  contentJson: getRealJSON(documentFor(paragraph('Nội dung đã lưu'))) }
const editForm = (options = {}) => mount(documentFor(paragraph('Nội dung đã lưu')),
  { edit: true, pristine: true, initial: editInitial, action: ({ payload }) => ack(payload), ...options })

test('edit mount, editor readiness, StrictMode replay and same-article revalidation stay clean without writes', async () => {
  const form = editForm()
  const originalDocument = form.editorView().props.initialContent
  form.replayEffects()
  assert.equal(window.count('online'), 1)
  assert.equal(window.count('beforeunload'), 1)
  assert.equal(document.count('click'), 1)
  form.rerenderInitial({ ...editInitial, title: 'Remote title', updatedAt: nextToken,
    contentJson: getRealJSON(documentFor(paragraph('Remote content'))) })
  await clock.tick(10000)
  await form.submit()
  assert.equal(form.state.calls.length, 0)
  assert.equal(form.status(), 'Đã lưu')
  assert.equal(form.unload(), false)
  assert.equal(form.input('article-title').props.value, editInitial.title)
  assert.equal(form.editorView().props.initialContent, originalDocument)
})

test('all five fields feed one latest snapshot after 2000 ms and UPDATE stays editable during the real promise', async () => {
  const first = deferred()
  const form = editForm({ action: () => first.promise })
  form.change('article-title', 'S1 tiêu đề')
  await clock.tick(1500)
  form.change('article-slug', 's1-moi')
  form.change('article-excerpt', 'S1 tóm tắt')
  form.change('article-type', 'RESEARCH')
  form.document(getRealJSON(documentFor(fixtures[1][1])))
  await clock.tick(1999)
  assert.equal(form.state.calls.length, 0)
  await clock.tick(1)
  assert.equal(form.state.calls.length, 1)
  const sent = form.state.calls[0].payload
  assert.equal(sent.title, 'S1 tiêu đề')
  assert.equal(sent.slug, 's1-moi')
  assert.equal(sent.excerpt, 'S1 tóm tắt')
  assert.equal(sent.articleType, 'RESEARCH')
  assert.equal(sent.contentJson.content[0].type, 'codeBlock')
  plainJson(sent)
  assert.deepEqual(form.locked(), { form: true, fields: false, save: false, editor: false })
  assert.equal(form.state.editable, true)
  assert.equal(form.unload(), true)
  form.change('article-title', 'S2 gõ tiếp trong khi lưu')
  form.change('article-slug', 's2-moi')
  const editorDocument = form.editorView().props.initialContent
  await clock.tick(1000)
  form.state.action = ({ payload }) => ack(payload)
  first.resolve(ack(sent))
  await flush(); form.render()
  assert.equal(form.input('article-title').props.value, 'S2 gõ tiếp trong khi lưu')
  assert.equal(form.input('article-slug').props.value, 's2-moi')
  assert.equal(form.editorView().props.initialContent, editorDocument)
  assert.equal(form.status(), 'Chưa lưu')
  assert.equal(form.unload(), true)
  await clock.tick(999)
  assert.equal(form.state.calls.length, 1)
  await clock.tick(1)
  assert.equal(form.state.calls.length, 2)
  assert.equal(form.state.calls[1].payload.title, 'S2 gõ tiếp trong khi lưu')
  assert.equal(form.state.calls[1].payload.expectedUpdatedAt, nextToken)
  assert.equal(form.status(), 'Đã lưu')
})

test('manual flush before deadline and repeated clicks during flight coalesce to one latest follow-up', async () => {
  const first = deferred()
  const form = editForm({ action: () => first.promise })
  form.change('article-title', 'S1')
  const pending = form.submit()
  form.change('article-title', 'S2')
  const second = form.submit()
  const third = form.submit()
  form.change('article-title', 'S3')
  form.render()
  assert.equal(form.state.calls.length, 1)
  assert.equal(form.locked().save, false)
  form.state.action = ({ payload }) => ack(payload)
  first.resolve(ack(form.state.calls[0].payload))
  await Promise.all([pending, second, third]); await flush(); form.render()
  assert.equal(form.state.calls.length, 2)
  assert.equal(form.state.calls[1].payload.title, 'S3')
  await clock.tick(5000)
  await form.submit()
  assert.equal(form.state.calls.length, 2)
})

test('new article never autosaves and a successful create stays locked even when navigation throws', async () => {
  const form = mount(documentFor(paragraph('Chỉ tạo bằng nút Lưu nháp')))
  await clock.tick(10000)
  assert.equal(form.state.calls.length, 0)
  form.state.router.replace = () => { throw new Error('synthetic navigation interruption') }
  await form.submit(); form.render()
  assert.equal(form.state.calls.length, 1)
  assert.equal(form.state.calls[0].kind, 'create')
  assert.equal(form.status(), 'Đã lưu')
  assert.equal(form.locked().save, true)
  await form.submit(); await clock.tick(10000)
  assert.equal(form.state.calls.length, 1)
})

test('form validation blocks invalid drafts and resumes only after valid values change', async () => {
  const form = editForm()
  form.change('article-title', '')
  await form.submit(); await clock.tick(10000)
  assert.equal(form.state.calls.length, 0)
  assert.equal(form.error()?.props['data-error-code'], 'VALIDATION_ERROR')
  assert.equal(form.input('article-title').props['aria-invalid'], true)
  form.change('article-title', 'Tiêu đề hợp lệ')
  await clock.tick(1999)
  assert.equal(form.state.calls.length, 0)
  await clock.tick(1)
  assert.equal(form.state.calls.length, 1)
  assert.equal(form.status(), 'Đã lưu')
})

test('slug collision pauses that canonical slug across body edits; a changed slug rearms autosave', async () => {
  const form = editForm({ action: () => ({ ok: false, error: { code: 'SLUG_CONFLICT', message: 'Slug đã tồn tại.' } }) })
  form.change('article-slug', 'Slug Trùng')
  await clock.tick(2000)
  form.document(getRealJSON(documentFor(paragraph('Chỉnh nội dung nhưng giữ slug trùng'))))
  form.change('article-slug', 'slug-trung')
  await clock.tick(10000)
  assert.equal(form.state.calls.length, 1)
  assert.equal(form.status(), 'Tự động lưu tạm dừng…')
  form.state.action = ({ payload }) => ack(payload)
  form.change('article-slug', 'slug-khac')
  await clock.tick(2000)
  assert.equal(form.state.calls.length, 2)
  assert.equal(form.state.calls[1].payload.expectedUpdatedAt, originalToken)
  assert.equal(form.status(), 'Đã lưu')
})

test('known offline prevents all dispatches; online event schedules one latest draft after a new debounce', async () => {
  const form = editForm()
  form.online(false)
  form.change('article-title', 'Ngoại tuyến S1')
  await clock.tick(3000)
  form.change('article-title', 'Ngoại tuyến S2')
  await form.submit()
  assert.equal(form.state.calls.length, 0)
  assert.equal(form.status(), 'Mất kết nối — thay đổi chưa được lưu')
  assert.equal(form.unload(), true)
  form.online(true)
  await clock.tick(1999)
  assert.equal(form.state.calls.length, 0)
  await clock.tick(1)
  assert.equal(form.state.calls.length, 1)
  assert.equal(form.state.calls[0].payload.title, 'Ngoại tuyến S2')
})

for (const code of ['EDIT_CONFLICT', 'FORBIDDEN', 'NOT_FOUND', 'NOT_EDITABLE', 'UNSUPPORTED_DOCUMENT']) {
  test(`${code} retains the form, blocks manual/auto updates and never refreshes its token`, async () => {
    const form = editForm({ action: () => ({ ok: false, error: { code, message: 'Lỗi an toàn.' } }) })
    form.change('article-title', 'Bản đang nhập phải giữ')
    await clock.tick(2000)
    form.change('article-excerpt', 'Gõ tiếp sau lỗi')
    await form.submit(); form.online(false); form.online(true); await clock.tick(10000)
    assert.equal(form.state.calls.length, 1)
    assert.equal(form.error()?.props['data-error-code'], code)
    assert.equal(form.input('article-title').props.value, 'Bản đang nhập phải giữ')
    assert.equal(form.input('article-excerpt').props.value, 'Gõ tiếp sau lỗi')
    assert.equal(form.locked().save, true)
    assert.equal(form.locked().editor, false)
    assert.equal(form.unload(), true)
    assert.deepEqual(form.state.replacements, [])
  })
}

test('unknown result pauses automatic/online retries; fresh manual uses the old token and respects resulting conflict', async () => {
  const form = editForm({ action: () => { throw new Error('SYNTHETIC_SECRET') } })
  form.change('article-title', 'Kết quả chưa xác nhận')
  await clock.tick(2000)
  assert.equal(form.error()?.props['data-error-code'], 'INTERNAL_ERROR')
  assert.equal(form.error().props.children.includes('SYNTHETIC_SECRET'), false)
  form.change('article-title', 'Tiếp tục nhập sau lỗi mạng')
  form.online(false); form.online(true); await clock.tick(10000)
  assert.equal(form.state.calls.length, 1)
  form.state.action = () => ({ ok: false, error: { code: 'EDIT_CONFLICT', message: 'Bài viết đã thay đổi.' } })
  await form.submit(); form.render()
  assert.equal(form.state.calls[1].payload.expectedUpdatedAt, originalToken)
  await form.submit(); await clock.tick(5000)
  assert.equal(form.state.calls.length, 2)
  assert.equal(form.input('article-title').props.value, 'Tiếp tục nhập sau lỗi mạng')
})

for (const target of ['metadata', 'contenteditable']) {
  test(`form capture gates ${target} IME, including manual save, until final input plus 2000 ms`, async () => {
    const form = editForm()
    form.composition(true)
    if (target === 'metadata') form.change('article-title', 'Tiếng Việ')
    else form.document(getRealJSON(documentFor(paragraph('Tiếng Việ'))))
    await clock.tick(3000); await form.submit()
    assert.equal(form.state.calls.length, 0)
    form.composition(false)
    if (target === 'metadata') form.change('article-title', 'Tiếng Việt hoàn chỉnh')
    else form.document(getRealJSON(documentFor(paragraph('Tiếng Việt hoàn chỉnh'))))
    await flush(); await clock.tick(1999)
    assert.equal(form.state.calls.length, 0)
    await clock.tick(1)
    assert.equal(form.state.calls.length, 1)
    assert.equal(target === 'metadata' ? form.state.calls[0].payload.title
      : form.state.calls[0].payload.contentJson.content[0].content[0].text, 'Tiếng Việt hoàn chỉnh')
  })
}

test('cancelled dirty navigation preserves debounce; accepted navigation cancels follow-ups after late ACK', async () => {
  const first = deferred()
  const form = editForm({ action: () => first.promise })
  form.change('article-title', 'Không rời trang')
  assert.equal(form.navigate(false), true)
  await clock.tick(2000)
  assert.equal(form.state.calls.length, 1)
  form.change('article-title', 'S2 bỏ khi rời trang')
  assert.equal(form.navigate(true), false)
  assert.equal(form.unload(), false, 'Accepted leave must not prompt again via beforeunload')
  first.resolve(ack(form.state.calls[0].payload)); await flush(); await clock.tick(10000)
  assert.equal(form.state.calls.length, 1)
  assert.equal(form.input('article-title').props.value, 'S2 bỏ khi rời trang')
})

test('conflict reload needs confirmation; accepted reload suppresses the second native unload prompt', async () => {
  const form = editForm({ action: () => ({ ok: false, error: { code: 'EDIT_CONFLICT', message: 'Bài viết đã thay đổi.' } }) })
  form.change('article-title', 'Bản xung đột phải giữ')
  await clock.tick(2000)
  form.reload(false)
  assert.equal(form.state.reloads, 0)
  assert.equal(form.unload(), true)
  assert.equal(form.input('article-title').props.value, 'Bản xung đột phải giữ')
  form.reload(true)
  assert.equal(form.state.reloads, 1)
  assert.equal(form.unload(), false)
})

test('effect cleanup removes listeners/timers; a different article ignores the previous instance ACK', async () => {
  const first = deferred()
  const form = editForm({ action: () => first.promise })
  form.change('article-slug', 'Slug đang lưu')
  await clock.tick(2000)
  form.change('article-title', 'Follow-up phải hủy')
  const other = { ...editInitial, id: 'article-other', title: 'Bài khác', slug: 'bai-khac' }
  form.rerenderInitial(other)
  first.resolve(ack(form.state.calls[0].payload)); await flush(); await clock.tick(5000)
  assert.equal(form.state.calls.length, 1)
  assert.equal(form.input('article-title').props.value, other.title)
  assert.equal(form.input('article-slug').props.value, other.slug)
  assert.equal(form.status(), 'Đã lưu')
  form.change('article-title', 'Hủy timer lúc unmount')
  form.unmount()
  assert.equal(window.count('online'), 0)
  assert.equal(window.count('beforeunload'), 0)
  assert.equal(document.count('click'), 0)
  assert.equal(clock.pending, 0)
  await clock.tick(5000)
  assert.equal(form.state.calls.length, 1)
})

test('canonical ACK updates only the submitted raw slug and cache warning never resends a committed snapshot', async () => {
  const form = editForm({ action: ({ payload }) => ack(payload, 'Đã lưu; bộ nhớ đệm chưa cập nhật.') })
  form.change('article-slug', 'Tiêu Đề Việt')
  await clock.tick(2000)
  assert.equal(form.input('article-slug').props.value, 'tieu-de-viet')
  assert.equal(form.status(), 'Đã lưu')
  assert.equal(form.unload(), false)
  await clock.tick(10000); await form.submit()
  assert.equal(form.state.calls.length, 1)
})
