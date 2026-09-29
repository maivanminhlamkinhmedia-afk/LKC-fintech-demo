import assert from 'node:assert/strict'
import { test, beforeEach, afterEach } from 'node:test'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

// Real component/controller, with hook lifecycle and event adapters. This is
// not browser focus/layout or hydration evidence.
const root = new URL('../src/', import.meta.url), url = new URL('features/cms/components/TaxonomyCatalog.tsx', root).href
let current, rendering, original, mounted
const events = () => { const handlers = new Map(); return {
  addEventListener(type, callback) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(callback) },
  removeEventListener(type, callback) { handlers.get(type)?.delete(callback) },
  emit(type, event) { for (const callback of handlers.get(type) ?? []) callback(event) }, count(type) { return handlers.get(type)?.size ?? 0 },
} }
beforeEach(() => {
  mounted = []; original = new Map(['window', 'document', 'navigator', 'Element'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  class Element { closest() { return this.anchor } }
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: { ...events(), confirm() { return current.accept }, history: { replaceState(_state, _title, target) { current.urls.push(target) } }, location: { href: 'https://example.com/creator/taxonomy', origin: 'https://example.com', pathname: '/creator/taxonomy', search: '', reload() { current.reloads++ } } } },
    document: { configurable: true, value: events() }, navigator: { configurable: true, value: { onLine: true } }, Element: { configurable: true, value: Element },
  })
})
afterEach(() => { for (const form of mounted) form.unmount(); for (const [key, descriptor] of original) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] })
const slot = initialize => { const index = rendering.cursor++; if (!(index in rendering.slots)) rendering.slots[index] = initialize(); return rendering.slots[index] }
const adapter = {
  useState(initial) { const entry = slot(() => ({ value: typeof initial === 'function' ? initial() : initial })); return [entry.value, value => { entry.value = typeof value === 'function' ? value(entry.value) : value }] },
  useRef(initial) { return slot(() => ({ current: initial })) },
  useEffect(effect, dependencies) { const entry = slot(() => ({ dependencies: null })); if (!entry.dependencies || dependencies.some((value, i) => !Object.is(value, entry.dependencies[i]))) { entry.dependencies = dependencies; entry.effect = effect; entry.pending = true } },
  Link({ children, ...props }) { return createElement('a', props, children) },
  async createTaxonomy(...args) { current.calls.push(['create', ...args]); return current.result },
  async updateTaxonomy(...args) { current.calls.push(['update', ...args]); return current.result },
  async deleteTaxonomy(...args) { current.calls.push(['delete', ...args]); return current.result },
  async searchTaxonomy(...args) { current.calls.push(['search', ...args]); return { ok: true, data: current.initial } },
}
globalThis[Symbol.for('taxonomy-form')] = adapter
const dataModule = text => `data:text/javascript,${encodeURIComponent(`const a=globalThis[Symbol.for('taxonomy-form')];${text}`)}`
const replacements = new Map([['react', dataModule('export const {useState,useRef,useEffect}=a;')], ['next/link', dataModule('export default a.Link;')], ['../taxonomy-actions', dataModule('export const {createTaxonomy,updateTaxonomy,deleteTaxonomy,searchTaxonomy}=a;')]])
const hook = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL === url && replacements.has(specifier)) return next(replacements.get(specifier), context)
  if (context.parentURL?.startsWith(root.href) && specifier.startsWith('.')) return next(new URL(`${specifier}.ts`, context.parentURL).href, context)
  return next(specifier, context)
}, load(target, context, next) { if (target === url) return { shortCircuit: true, format: 'module', source: ts.transpileModule(readFileSync(new URL(target), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText }; return next(target, context) } })
let TaxonomyCatalog
try { ({ TaxonomyCatalog } = await import(url)) } finally { hook.deregister(); delete globalThis[Symbol.for('taxonomy-form')] }
const token = '2026-09-28T00:00:00.001Z'
const item = changes => ({ id: 'tag-a', kind: 'tag', name: 'Tên', slug: 'legacy-slug', canonicalKey: null, symbol: null, isActive: null, description: null, sortOrder: null, instrumentType: null, exchange: null, countryCode: null, currency: null, createdAt: token, updatedAt: token, ...changes })
const page = changes => ({ kind: 'tag', q: '', active: 'all', page: 1, totalPages: 1, total: 1, items: [item()], ...changes })
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : []
function mount(initial = page(), result = { ok: true, data: { kind: initial.kind, item: initial.items[0], deletedId: null } }) {
  const instance = { cursor: 0, slots: [] }, state = { initial, result, calls: [], accept: false, urls: [], reloads: 0, focus: [] }; let tree, live = true
  const render = () => {
    current = state; rendering = instance; instance.cursor = 0; tree = TaxonomyCatalog({ initial: state.initial }); rendering = null
    for (const node of nodes(tree)) if (node.props?.ref && typeof node.props.ref === 'object') node.props.ref.current = { focus() { state.focus.push(node.props.id) }, querySelector(selector) { return { focus() { state.focus.push(selector) } } } }
    for (const entry of instance.slots) if (entry.pending) { entry.pending = false; entry.cleanup?.(); entry.cleanup = entry.effect() }
  }
  const find = predicate => { const found = nodes(tree).filter(predicate); assert.equal(found.length, 1); return found[0] }
  const button = label => find(node => node.type === 'button' && (node.props.children === label || node.props['aria-label'] === label))
  const form = { state, nodes: () => nodes(tree), render, html: () => renderToStaticMarkup(tree),
    input: id => find(node => node.props?.id === id),
    async click(label, accept = false) { current = state; state.accept = accept; const pending = button(label).props.onClick(); render(); await pending; render() },
    change(id, value) { current = state; find(node => node.props?.id === id).props.onChange({ target: { value, checked: value } }); render() },
    async submit() { current = state; const pending = find(node => node.type === 'form' && ['Sửa danh mục', 'Thêm danh mục'].includes(node.props['aria-label'])).props.onSubmit({ preventDefault() {} }); render(); await pending; render() },
    unload() { current = state; let prevented = false; window.emit('beforeunload', { preventDefault() { prevented = true } }); return prevented },
    navigate(accept) { current = state; state.accept = accept; let prevented = false; const target = new Element(); target.anchor = { href: 'https://example.com/creator', target: '', hasAttribute: () => false }; document.emit('click', { target, button: 0, preventDefault() { prevented = true }, stopPropagation() {}, stopImmediatePropagation() {} }); render(); return prevented },
    unmount() { if (!live) return; live = false; for (const entry of instance.slots) entry.cleanup?.() },
  }
  render(); render(); mounted.push(form); return form
}
test('TAX-02/25/26: actual catalog labels, text escaping, no arbitrary links and Tag no active control', async () => {
  const form = mount(page({ items: [item({ name: '<script>x()</script>', slug: '<b>legacy</b>' })] }))
  const html = form.html(); assert.equal(html.includes('<script>'), false); assert.match(html, /&lt;script&gt;/)
  assert.equal(form.nodes().some(node => node.type === 'input' && node.props.type === 'checkbox'), false)
  await form.click('Thêm danh mục'); assert.ok(form.nodes().some(node => node.type === 'label' && node.props.htmlFor === 'taxonomy-name'))
  assert.ok(form.nodes().some(node => node.type === 'label' && node.props.htmlFor === 'taxonomy-slug'))
  assert.equal(form.state.calls.length, 0)
})
test('TAX-03/05: immutable existing instrument identity is text; editable fields omit identity payload', async () => {
  const instrument = item({ kind: 'instrument', canonicalKey: 'LEGACY:<x>', slug: null, symbol: 'VN', instrumentType: 'INDEX', exchange: null, isActive: true })
  const form = mount(page({ kind: 'instrument', items: [instrument] })); await form.click('Sửa Tên')
  assert.match(form.html(), /LEGACY:&lt;x&gt;/)
  assert.equal(form.nodes().some(node => node.type === 'input' && ['taxonomy-symbol', 'taxonomy-slug', 'taxonomy-exchange'].includes(node.props.id)), false)
  form.change('taxonomy-name', 'Đổi'); await form.submit()
  const payload = form.state.calls.find(call => call[0] === 'update')[3]
  assert.deepEqual(Object.keys(payload).sort(), ['name', 'countryCode', 'currency', 'isActive', 'expectedUpdatedAt'].sort())
})
test('TAX-24/29: actual effects retain dirty input on native/app-link cancellation and clean listeners', async () => {
  const form = mount(); await form.click('Thêm danh mục'); form.change('taxonomy-name', 'Giữ')
  assert.equal(form.unload(), true); assert.equal(form.navigate(false), true); assert.equal(form.input('taxonomy-name').props.value, 'Giữ')
  assert.equal(form.state.calls.length, 0); assert.equal(form.navigate(true), false); assert.equal(form.unload(), false)
  form.unmount(); assert.equal(window.count('beforeunload'), 0); assert.equal(window.count('offline'), 0); assert.equal(document.count('click'), 0)
})
test('TAX-23: actual submit consults navigator immediately and reconnection does not write', async () => {
  const form = mount(); await form.click('Thêm danh mục'); form.change('taxonomy-name', 'Mới'); form.change('taxonomy-slug', 'moi')
  navigator.onLine = false; await form.submit(); assert.equal(form.state.calls.length, 0)
  navigator.onLine = true; window.emit('online'); form.render(); assert.equal(form.state.calls.length, 0)
  await form.submit(); assert.equal(form.state.calls.filter(call => call[0] === 'create').length, 1)
})
test('TAX-22/26: safe unknown outcome exposes explicit reload and alert without raw details', async () => {
  const form = mount(page(), { ok: false, error: { code: 'INTERNAL_ERROR', message: 'SECRET' } }); await form.click('Sửa Tên'); form.change('taxonomy-name', 'Giữ'); await form.submit()
  const html = form.html(); assert.equal(html.includes('SECRET'), false); assert.match(html, /data-error-code="INTERNAL_ERROR"/); assert.match(html, /Tải lại bản mới nhất/)
  await form.click('Tải lại bản mới nhất', false); assert.equal(form.state.reloads, 0); await form.click('Tải lại bản mới nhất', true); assert.equal(form.state.reloads, 1)
})
