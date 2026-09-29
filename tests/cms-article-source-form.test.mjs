import assert from 'node:assert/strict'
import test, { beforeEach, afterEach } from 'node:test'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

// Execute the real component/controller/effects with hook scheduling and DOM
// event adapters. Keyboard/layout/hydration remain separate browser evidence.
const sourceRoot = new URL('../src/', import.meta.url)
const formUrl = new URL('features/cms/components/ArticleSources.tsx', sourceRoot).href
const bridge = Symbol.for('cms-source-form-adapter')
let rendering, current, originals, mounted
const events = () => {
  const handlers = new Map()
  return { addEventListener(key, callback) { if (!handlers.has(key)) handlers.set(key, new Set()); handlers.get(key).add(callback) },
    removeEventListener(key, callback) { handlers.get(key)?.delete(callback) },
    emit(key, value) { for (const callback of [...(handlers.get(key) ?? [])]) callback(value) },
    count: key => handlers.get(key)?.size ?? 0 }
}
beforeEach(() => {
  mounted = []
  originals = new Map(['window', 'document', 'Element', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  class Element { closest() { return this.anchor } }
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: { ...events(), confirm(question) { current.questions.push(question); return current.confirm },
      location: { href: 'https://example.com/creator/articles/article-a/sources', origin: 'https://example.com', pathname: '/creator/articles/article-a/sources', search: '', reload() { current.reloads++ } } } },
    document: { configurable: true, value: events() }, Element: { configurable: true, value: Element },
    navigator: { configurable: true, value: { onLine: true } },
  })
})
afterEach(() => {
  for (const form of mounted) form.unmount()
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] }
})
function slot(initialize) {
  const index = rendering.cursor++
  if (!(index in rendering.slots)) rendering.slots[index] = initialize()
  return rendering.slots[index]
}
const adapter = {
  useState(initial) { const state = slot(() => ({ value: typeof initial === 'function' ? initial() : initial })); return [state.value, value => { state.value = typeof value === 'function' ? value(state.value) : value }] },
  useRef(initial) { return slot(() => ({ current: initial })) },
  useEffect(effect, dependencies) {
    const entry = slot(() => ({ dependencies: null, cleanup: null }))
    if (!entry.dependencies || dependencies.some((value, index) => !Object.is(value, entry.dependencies[index]))) {
      entry.effect = effect; entry.dependencies = dependencies; entry.pending = true
    }
  },
  Link({ children, ...props }) { return createElement('a', props, children) },
  async createArticleSource(...args) { current.calls.push({ kind: 'create', args }); return current.action('create', args) },
  async updateArticleSource(...args) { current.calls.push({ kind: 'update', args }); return current.action('update', args) },
  async deleteArticleSource(...args) { current.calls.push({ kind: 'delete', args }); return current.action('delete', args) },
}
globalThis[bridge] = adapter
const mod = exports => `data:text/javascript,${encodeURIComponent(`const a = globalThis[Symbol.for('cms-source-form-adapter')]; ${exports}`)}`
const replacements = new Map([
  ['react', mod('export const { useState, useRef, useEffect } = a;')],
  ['next/link', mod('export default a.Link;')],
  ['@/features/cms/article-source-actions', mod('export const { createArticleSource, updateArticleSource, deleteArticleSource } = a;')],
])
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === formUrl && replacements.has(specifier)) return next(replacements.get(specifier), context)
    if (specifier.startsWith('@/')) return next(new URL(`${specifier.slice(2)}.ts`, sourceRoot).href, context)
    if (context.parentURL?.startsWith(sourceRoot.href) && specifier.startsWith('./')) return next(new URL(`${specifier}.ts`, context.parentURL).href, context)
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url === formUrl) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText }
    return next(url, context)
  },
})
let ArticleSources
try { ({ ArticleSources } = await import(formUrl)) } finally { hook.deregister(); delete globalThis[bridge] }
const token = '2026-09-27T01:02:03.456Z'
const source = (overrides = {}) => ({ id: 'source-a', sourceType: 'REPORT', title: 'Nguồn Việt', publisher: 'Đơn vị', url: 'https://example.com/report', safeUrl: 'https://example.com/report', publishedAt: '2026-09-27T01:02:03.456Z', accessedAt: null, dataTimestamp: null, note: 'Trang 2\nMục 3', createdAt: token, updatedAt: token, createdById: 'admin-a', ...overrides })
const snapshot = (overrides = {}) => ({ id: 'article-a', title: 'Bài thử nghiệm', status: 'DRAFT', canMutate: true, readOnlyReason: null, updatedAt: token, sources: [source()], ...overrides })
const success = { ok: true, data: snapshot({ updatedAt: '2026-09-27T01:02:03.457Z' }) }
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : []
function mount(initial = snapshot(), action = () => success) {
  let instance = { slots: [], cursor: 0 }, tree, key, live = true
  const state = { calls: [], questions: [], confirm: false, reloads: 0, focus: [], action }
  function cleanup() { for (const entry of instance.slots) if (entry.cleanup) { entry.cleanup(); entry.cleanup = null } }
  function render() {
    if (!live) return
    current = state
    const wrapper = ArticleSources({ initial })
    if (key !== undefined && key !== wrapper.key) { cleanup(); instance = { slots: [], cursor: 0 } }
    key = wrapper.key; instance.cursor = 0; rendering = instance
    try { tree = wrapper.type(wrapper.props) } finally { rendering = null }
    for (const node of nodes(tree)) if (node.props?.ref && typeof node.props.ref === 'object') node.props.ref.current = {
      focus: () => state.focus.push(node.props.id ?? node.props.children),
      querySelector: selector => ({ focus: () => state.focus.push(selector) }),
    }
    for (const entry of instance.slots) if (entry.pending) { entry.pending = false; entry.cleanup?.(); entry.cleanup = entry.effect() }
  }
  const find = predicate => { const matches = nodes(tree).filter(predicate); assert.equal(matches.length, 1); return matches[0] }
  const input = id => find(node => node.props?.id === id)
  const button = text => find(node => node.type === 'button' && (node.props.children === text || node.props['aria-label'] === text))
  const form = { state, render, input, button, nodes: () => nodes(tree), html: () => renderToStaticMarkup(tree),
    async click(text, accept = false) { current = state; state.confirm = accept; const pending = button(text).props.onClick(); render(); await pending; render() },
    change(id, value) { current = state; input(id).props.onChange({ target: { value } }); render() },
    async submit() { current = state; const result = find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); render(); await result; render() },
    update(next) { initial = next; render(); render() },
    unload() { current = state; let prevented = false; window.emit('beforeunload', { preventDefault() { prevented = true } }); return prevented },
    navigate(accept, extra = {}) { current = state; state.confirm = accept; let prevented = false;
      const target = new Element(); target.anchor = { href: 'https://example.com/creator/articles', target: '', hasAttribute: () => false }
      document.emit('click', { target, button: 0, preventDefault() { prevented = true }, stopPropagation() {}, stopImmediatePropagation() {}, ...extra }); render(); return prevented },
    online(value) { current = state; navigator.onLine = value; window.emit(value ? 'online' : 'offline'); render() },
    unmount() { if (!live) return; cleanup(); live = false },
  }
  render(); render(); mounted.push(form); return form
}

test('SRC-02/09/23: actual form exposes labels, eight enum choices, UTC+7 precision and manual controls', async () => {
  const form = mount(); await form.click('Sửa nguồn Nguồn Việt')
  const html = form.html()
  assert.equal(form.nodes().filter(node => node.type === 'option').length, 8)
  for (const field of ['title', 'publisher', 'url', 'publishedAt', 'accessedAt', 'dataTimestamp', 'note']) {
    assert.ok(form.nodes().some(node => node.type === 'label' && node.props.htmlFor === `source-${field}`))
  }
  assert.equal(form.input('source-publishedAt').props.step, '0.001')
  assert.equal(form.input('source-publishedAt').props.value, '2026-09-27T08:02:03.456')
  assert.match(html, /UTC\+7/); assert.match(html, /Nguồn tham khảo được lưu riêng/)
  assert.equal(form.state.calls.length, 0)
  form.change('source-title', 'Sửa tiếng Việt'); await form.submit()
  assert.equal(form.state.calls.length, 1); assert.equal(form.state.calls[0].kind, 'update')
  assert.equal(form.state.calls[0].args[2].publishedAt, '2026-09-27T01:02:03.456Z')
})

test('SRC-07/08: unsafe stored URL is text, HTML-like fields are escaped and safe links are isolated', () => {
  const form = mount(snapshot({ sources: [source({ title: '<script>x()</script>', publisher: '<b>publisher</b>', note: '<img src=x onerror=x()>', url: 'javascript:alert(1)', safeUrl: null }), source({ id: 'safe-b' })] }))
  const html = form.html()
  assert.equal(html.includes('href="javascript:'), false); assert.equal(html.includes('<script>'), false)
  assert.match(html, /&lt;script&gt;/); assert.match(html, /&lt;img/); assert.match(html, /rel="noopener noreferrer"/)
  assert.match(html, /target="_blank"/); assert.match(html, /chỉ hiển thị văn bản/)
  assert.equal(form.state.calls.length, 0)
})

test('SRC-04/10: readonly and empty states show context and no edit route or mutation controls', () => {
  const form = mount(snapshot({ status: 'PUBLISHED', canMutate: false, readOnlyReason: 'NOT_EDITABLE', sources: [] }))
  const html = form.html()
  assert.match(html, /Chưa có nguồn tham khảo/); assert.match(html, /Chỉ đọc/); assert.match(html, /PUBLISHED/)
  assert.equal(form.nodes().some(node => node.type === 'button'), false)
  assert.equal(html.includes('/article-a/edit'), false); assert.match(html, /href="\/creator\/articles"/)
})

test('TAX-24: classification link preserves the actual source dirty navigation guard', async () => {
  const form = mount()
  const link = form.nodes().find(node => node.props?.children === 'Phân loại')
  assert.equal(link.props.href, '/creator/articles/article-a/classification')
  await form.click('Sửa nguồn Nguồn Việt')
  form.change('source-title', 'Nguồn giữ khi hủy phân loại')
  const target = new Element()
  target.anchor = { href: `https://example.com${link.props.href}`, target: '', hasAttribute: () => false }
  assert.equal(form.navigate(false, { target }), true)
  assert.equal(form.input('source-title').props.value, 'Nguồn giữ khi hủy phân loại')
  assert.equal(form.state.calls.length, 0)
  assert.equal(form.navigate(true, { target }), false)
  assert.equal(form.unload(), false)
})

test('SRC-20: beforeunload and internal-link cancellation retain source input; acceptance prevents follow-up', async () => {
  const form = mount(); await form.click('Thêm nguồn'); form.change('source-title', 'Giữ nội dung')
  assert.equal(form.unload(), true); assert.equal(form.navigate(false), true)
  assert.equal(form.input('source-title').props.value, 'Giữ nội dung')
  assert.equal(form.navigate(true), false); assert.equal(form.unload(), false)
  await form.submit(); assert.equal(form.state.calls.length, 0)
})

test('SRC-20: cancel form and switching sources ask before discarding, focus returns to add control', async () => {
  const form = mount(); await form.click('Thêm nguồn'); form.change('source-title', 'Giữ nội dung')
  await form.click('Hủy', false); assert.equal(form.input('source-title').props.value, 'Giữ nội dung')
  await form.click('Sửa nguồn Nguồn Việt', false); assert.equal(form.input('source-title').props.value, 'Giữ nội dung')
  await form.click('Hủy', true)
  assert.equal(form.nodes().some(node => node.type === 'form'), false); assert.ok(form.state.focus.includes('Thêm nguồn'))
  assert.equal(form.state.calls.length, 0)
})

test('SRC-18: browser offline signal preserves input and does not submit when online returns', async () => {
  const form = mount(); await form.click('Thêm nguồn'); form.change('source-title', 'Ngoại tuyến')
  form.online(false); await form.submit(); form.online(true)
  assert.equal(form.state.calls.length, 0); assert.equal(form.input('source-title').props.value, 'Ngoại tuyến')
  await form.submit(); assert.equal(form.state.calls.length, 1)
})

test('SRC-18/23: validation errors associate with fields and focus invalid control; input survives', async () => {
  const form = mount(snapshot(), () => ({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Kiểm tra URL.', fieldErrors: { url: 'URL không hợp lệ' } } }))
  await form.click('Thêm nguồn'); form.change('source-title', 'Giữ bản'); form.change('source-url', 'javascript:x()')
  await form.submit()
  assert.equal(form.input('source-url').props['aria-invalid'], true)
  assert.equal(form.input('source-url').props['aria-describedby'], 'source-url-error')
  assert.equal(form.input('source-title').props.value, 'Giữ bản')
  assert.ok(form.state.focus.includes('[aria-invalid="true"]'))
  assert.match(form.html(), /data-error-code="VALIDATION_ERROR"/)
})

test('SRC-12/18: conflict and unknown results keep input, guard navigation, and require confirmed reload', async () => {
  for (const code of ['EDIT_CONFLICT', 'INTERNAL_ERROR']) {
    const form = mount(snapshot(), () => ({ ok: false, error: { code, message: 'Giữ input.' } }))
    await form.click('Thêm nguồn'); form.change('source-title', 'Cần giữ'); await form.submit()
    assert.equal(form.button('Lưu nguồn').props.disabled, true); assert.equal(form.unload(), true)
    await form.click('Tải lại bản mới nhất', false); assert.equal(form.state.reloads, 0)
    assert.equal(form.input('source-title').props.value, 'Cần giữ')
    await form.click('Tải lại bản mới nhất', true); assert.equal(form.state.reloads, 1)
    assert.equal(form.state.calls.length, 1); form.unmount()
  }
})

test('SRC-20: same article revalidation keeps dirty input and token; new article and late ACK are isolated', async () => {
  let resolve
  const held = new Promise(done => { resolve = done })
  const form = mount(snapshot(), () => held)
  await form.click('Thêm nguồn'); form.change('source-title', 'Giữ bản cũ')
  form.update(snapshot({ updatedAt: '2026-09-27T01:02:03.900Z' }))
  assert.equal(form.input('source-title').props.value, 'Giữ bản cũ')
  const submit = form.submit()
  assert.equal(form.state.calls[0].args[1].expectedUpdatedAt, token)
  form.update(snapshot({ id: 'article-b', title: 'Bài B' }))
  resolve(success); await submit
  assert.match(form.html(), /Bài B/); assert.equal(form.nodes().some(node => node.type === 'form'), false)
  assert.equal(window.count('beforeunload'), 1); assert.equal(document.count('click'), 1)
  form.unmount(); assert.equal(window.count('beforeunload'), 0); assert.equal(document.count('click'), 0)
})
