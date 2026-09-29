import assert from 'node:assert/strict'
import test, { beforeEach, afterEach } from 'node:test'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

// Real component/controller/effects with controlled hook and DOM event adapters.
// Layout/native keyboard and real Server Action/MariaDB remain browser evidence.
const sourceRoot = new URL('../src/', import.meta.url)
const formUrl = new URL('features/cms/components/ArticleClassificationPanel.tsx', sourceRoot).href
let rendering, current, originals, mounted
const events = () => {
  const handlers = new Map()
  return { addEventListener(key, callback) { if (!handlers.has(key)) handlers.set(key, new Set()); handlers.get(key).add(callback) },
    removeEventListener(key, callback) { handlers.get(key)?.delete(callback) },
    emit(key, value) { for (const callback of [...(handlers.get(key) ?? [])]) callback(value) }, count: key => handlers.get(key)?.size ?? 0 }
}
beforeEach(() => {
  mounted = []; originals = new Map(['window', 'document', 'Element', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  class Element { closest() { return this.anchor } }
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: { ...events(), confirm(question) { current.questions.push(question); return current.confirm },
      location: { href: 'https://example.com/creator/articles/article-a/classification', origin: 'https://example.com', pathname: '/creator/articles/article-a/classification', search: '', reload() { current.reloads++ } } } },
    document: { configurable: true, value: events() }, Element: { configurable: true, value: Element }, navigator: { configurable: true, value: { onLine: true } },
  })
})
afterEach(() => { for (const form of mounted) form.unmount(); for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] } })
function slot(initialize) { const index = rendering.cursor++; if (!(index in rendering.slots)) rendering.slots[index] = initialize(); return rendering.slots[index] }
const adapter = {
  useState(initial) { const state = slot(() => ({ value: typeof initial === 'function' ? initial() : initial })); return [state.value, value => { state.value = typeof value === 'function' ? value(state.value) : value }] },
  useRef(initial) { return slot(() => ({ current: initial })) },
  useEffect(effect, dependencies) { const entry = slot(() => ({ dependencies: null, cleanup: null })); if (!entry.dependencies || dependencies.some((value, index) => !Object.is(value, entry.dependencies[index]))) { entry.effect = effect; entry.dependencies = dependencies; entry.pending = true } },
  Link({ children, ...props }) { return createElement('a', props, children) },
  async updateArticleClassification(...args) { current.calls.push(args); return current.action(...args) },
  async searchArticleClassificationOptions(...args) { current.reads.push(args); return current.search(...args) },
}
globalThis[Symbol.for('cms-classification-form')] = adapter
const mod = exports => `data:text/javascript,${encodeURIComponent(`const a=globalThis[Symbol.for('cms-classification-form')];${exports}`)}`
const replacements = new Map([['react', mod('export const {useState,useRef,useEffect}=a;')], ['next/link', mod('export default a.Link;')],
  ['../article-classification-actions', mod('export const {updateArticleClassification}=a;')], ['../article-classification-options', mod('export const {searchArticleClassificationOptions}=a;')]])
const hook = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL === formUrl && replacements.has(specifier)) return next(replacements.get(specifier), context)
  if (context.parentURL?.startsWith(sourceRoot.href) && specifier.startsWith('.')) return next(new URL(`${specifier}.ts`, context.parentURL).href, context)
  return next(specifier, context)
}, load(url, context, next) {
  if (url === formUrl) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText }
  return next(url, context)
} })
let ArticleClassificationPanel
try { ({ ArticleClassificationPanel } = await import(formUrl)) } finally { hook.deregister(); delete globalThis[Symbol.for('cms-classification-form')] }
const token = '2026-09-28T01:02:03.456Z', nextToken = '2026-09-28T01:02:03.457Z'
const item = (kind = 'category', changes = {}) => ({ id: `${kind}-a`, kind, name: `Tên ${kind}`, slug: `${kind}-a`, canonicalKey: null, symbol: null, isActive: true, ...changes })
const snapshot = changes => ({ id: 'article-a', title: 'Bài Việt', status: 'DRAFT', updatedAt: token, canMutate: true, readOnlyReason: null,
  category: null, topics: [], tags: [], instruments: [], warnings: [], ...changes })
const success = { ok: true, data: snapshot({ updatedAt: nextToken, category: item() }) }
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : []
async function mount(initial = snapshot(), action = () => success, search = (_id, kind) => ({ ok: true, data: { kind, items: [item(kind)], page: 1, totalPages: 1, total: 1 } })) {
  let instance = { slots: [], cursor: 0 }, tree, key, live = true
  const state = { calls: [], reads: [], questions: [], confirm: false, reloads: 0, focus: [], action, search }
  function cleanup() { for (const entry of instance.slots) if (entry.cleanup) { entry.cleanup(); entry.cleanup = null } }
  function render() {
    if (!live) return
    current = state; const wrapper = ArticleClassificationPanel({ initial })
    if (key !== undefined && key !== wrapper.key) { cleanup(); instance = { slots: [], cursor: 0 } }
    key = wrapper.key; instance.cursor = 0; rendering = instance
    try { tree = wrapper.type(wrapper.props) } finally { rendering = null }
    for (const node of nodes(tree)) if (node.props?.ref && typeof node.props.ref === 'object') node.props.ref.current = { querySelector: selector => ({ focus: () => state.focus.push(selector) }) }
    for (const entry of instance.slots) if (entry.pending) { entry.pending = false; entry.cleanup?.(); entry.cleanup = entry.effect() }
  }
  async function flush() { await Promise.resolve(); await Promise.resolve(); render() }
  const find = predicate => { const matches = nodes(tree).filter(predicate); assert.equal(matches.length, 1); return matches[0] }
  const button = text => find(node => node.type === 'button' && (node.props.children === text || node.props['aria-label'] === text))
  const form = { state, render, flush, button, nodes: () => nodes(tree), html: () => renderToStaticMarkup(tree),
    async click(text, accept = false) { current = state; state.confirm = accept; const pending = button(text).props.onClick(); render(); await pending; await flush() },
    choose(id, checked = true) { current = state; find(node => node.type === 'input' && node.props['data-taxonomy-id'] === id).props.onChange({ target: { checked } }); render() },
    async submit() { current = state; const pending = find(node => node.type === 'form' && node.props['aria-label'] === 'Lưu phân loại bài viết').props.onSubmit({ preventDefault() {} }); render(); await pending; render() },
    update(next) { initial = next; render(); render() },
    unload() { current = state; let prevented = false; window.emit('beforeunload', { preventDefault() { prevented = true } }); return prevented },
    navigate(accept, extra = {}) { current = state; state.confirm = accept; let prevented = false
      const target = new Element(); target.anchor = { href: 'https://example.com/creator/articles/article-a/sources', target: '', hasAttribute: () => false }
      document.emit('click', { target, button: 0, preventDefault() { prevented = true }, stopPropagation() {}, stopImmediatePropagation() {}, ...extra }); render(); return prevented },
    online(value) { current = state; navigator.onLine = value; window.emit(value ? 'online' : 'offline'); render() },
    unmount() { if (!live) return; cleanup(); live = false },
  }
  render(); await flush(); mounted.push(form); return form
}

test('TAX-09/10/21/26: actual form exposes native labels/manual save and read-only searches preserve selections', async () => {
  const form = await mount(); assert.equal(form.state.calls.length, 0); assert.equal(form.state.reads.length, 1)
  assert.match(form.html(), /Phân loại bài viết/); assert.match(form.html(), /for="classification-search"/)
  form.choose('category-a'); await form.click('Chủ đề'); form.choose('topic-a')
  assert.match(form.html(), /data-selected-kind="category"/); assert.match(form.html(), /data-selected-kind="topic"/)
  assert.equal(form.state.calls.length, 0); await form.submit()
  assert.deepEqual(form.state.calls[0], ['article-a', { categoryId: 'category-a', topicIds: ['topic-a'], tagIds: [], instrumentIds: [], primaryInstrumentId: null, expectedUpdatedAt: token }])
  assert.match(form.html(), /Đã lưu phân loại/)
})
test('TAX-07/14/25: selected inactive/legacy HTML text is escaped and readonly has no mutation controls', async () => {
  const form = await mount(snapshot({ canMutate: false, readOnlyReason: 'NOT_EDITABLE', status: 'PUBLISHED', category: item('category', { name: '<script>x()</script>', slug: 'Legacy / unsafe', isActive: false }) }))
  const html = form.html(); assert.match(html, /&lt;script&gt;/); assert.equal(html.includes('<script>'), false); assert.match(html, /Không hoạt động/)
  assert.match(html, /data-read-only-reason="NOT_EDITABLE"/); assert.equal(html.includes('/article-a/edit'), false)
  assert.equal(form.nodes().some(node => node.type === 'button' || node.type === 'input'), false); assert.equal(form.state.reads.length, 0)
  assert.equal(form.state.calls.length, 0)
})
test('TAX-24: native unload handler and app-link cancellation keep choice; confirmed leave blocks later writes', async () => {
  const form = await mount(); form.choose('category-a'); assert.equal(form.unload(), true); assert.equal(form.navigate(false), true)
  assert.match(form.html(), /data-selected-kind="category"/); assert.equal(form.navigate(true), false); assert.equal(form.unload(), false)
  await form.submit(); assert.equal(form.state.calls.length, 0)
})
test('TAX-24: cancel consent protects draft; link exceptions do not accidentally discard it', async () => {
  const form = await mount(); form.choose('category-a'); await form.click('Hủy', false); assert.match(form.html(), /data-selected-kind="category"/)
  assert.equal(form.navigate(true, { ctrlKey: true }), false); assert.equal(form.unload(), true)
  await form.click('Hủy', true); assert.equal(form.html().includes('data-selected-kind='), false); assert.equal(form.unload(), false)
})
test('TAX-22/23: offline avoids dispatch; conflict/unknown holds selection and confirmed reload is explicit', async () => {
  for (const code of ['EDIT_CONFLICT', 'INTERNAL_ERROR']) {
    const form = await mount(snapshot(), () => ({ ok: false, error: { code, message: 'Giữ lựa chọn.' } }))
    form.choose('category-a'); form.online(false); await form.submit(); form.online(true); assert.equal(form.state.calls.length, 0)
    await form.submit(); assert.equal(form.state.calls.length, 1); assert.equal(form.button('Lưu phân loại').props.disabled, true)
    assert.match(form.html(), /data-selected-kind="category"/); assert.equal(form.unload(), true)
    await form.click('Tải lại bản mới nhất', false); assert.equal(form.state.reloads, 0)
    await form.click('Tải lại bản mới nhất', true); assert.equal(form.state.reloads, 1); form.unmount()
  }
})
test('TAX-29: dirty refresh and late ACK cannot modify a different keyed article; effect cleanup exact', async () => {
  let resolve; const held = new Promise(done => { resolve = done })
  const form = await mount(snapshot(), () => held); form.choose('category-a')
  form.update(snapshot({ updatedAt: nextToken })); const save = form.submit(); assert.equal(form.state.calls[0][1].expectedUpdatedAt, token)
  form.update(snapshot({ id: 'article-b', title: 'Bài B' })); resolve(success); await save; await form.flush()
  assert.match(form.html(), /Bài B/); assert.equal(form.html().includes('data-selected-kind='), false)
  assert.equal(window.count('beforeunload'), 1); assert.equal(document.count('click'), 1)
  form.unmount(); assert.equal(window.count('beforeunload'), 0); assert.equal(document.count('click'), 0)
})
test('TAX-29: multiple primary legacy requires explicit choice and focuses visible error instead of writing', async () => {
  const form = await mount(snapshot({ instruments: [{ ...item('instrument'), isPrimary: true }, { ...item('instrument', { id: 'instrument-b' }), isPrimary: true }], warnings: ['Dữ liệu cũ có nhiều công cụ chính.'] }))
  await form.submit(); assert.equal(form.state.calls.length, 0); assert.match(form.html(), /data-error-code="VALIDATION_ERROR"/)
  assert.ok(form.state.focus.includes('[aria-invalid="true"]')); assert.match(form.html(), /Không chọn công cụ chính/)
})
test('TAX-12/26: selection limit errors are associated with a focusable group and retain all choices', async () => {
  const form = await mount(snapshot({ topics: Array.from({ length: 6 }, (_, i) => item('topic', { id: `topic-${i}` })) }))
  await form.submit(); assert.equal(form.state.calls.length, 0)
  const group = form.nodes().find(node => node.type === 'fieldset' && node.props['aria-describedby'] === 'classification-topic-error')
  assert.equal(group.props['aria-invalid'], true); assert.equal(group.props.tabIndex, -1)
  assert.equal(form.nodes().filter(node => node.props?.['data-selected-kind'] === 'topic').length, 6)
  assert.ok(form.state.focus.includes('[aria-invalid="true"]'))
})
