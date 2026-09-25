import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { Editor, getSchema } from '@tiptap/core'
import ts from 'typescript'

// Execute the actual form and its event callbacks. Only React scheduling,
// framework/action I/O and the editor view are adapted; the shared schema,
// ProseMirror nodes/attrs and TipTap getJSON implementation remain real.
// This is not a browser, hydration, DOM or React Flight integration test.
const sourceRoot = new URL('../src/', import.meta.url)
const formUrl = new URL('features/cms/components/ArticleDraftForm.tsx', sourceRoot).href
const bridge = Symbol.for('cms-draft-form-test-adapter')
let current, rendering

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
  useEffect() { slot(() => ({})) }, // Browser navigation effects are outside this unit boundary.
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
function mount(document, { edit = false, action = () => success } = {}) {
  const instance = { slots: [], cursor: 0 }
  const initial = edit ? { id: 'article-form', updatedAt: originalToken, ...header,
    contentJson: { type: 'doc', content: [{ type: 'paragraph' }] } } : undefined
  const state = { calls: [], replacements: [], action, editable: true, editableCalls: [], getJSON: () => getRealJSON(document) }
  state.router = { replace(path) { state.replacements.push(path) } }
  current = state
  const editor = {
    getJSON() { return state.getJSON() },
    setEditable(value, emitUpdate) { state.editable = value; state.editableCalls.push([value, emitUpdate]) },
  }
  let tree
  function render() {
    instance.cursor = 0
    rendering = instance
    try { tree = ArticleDraftForm({ initial }) } finally { rendering = null }
    return tree
  }
  const find = predicate => {
    const matches = nodes(tree).filter(predicate)
    assert.equal(matches.length, 1, 'Expected one form element')
    return matches[0]
  }
  const input = id => find(node => node.props?.id === id)
  const editorView = () => find(node => node.type === adapter.ArticleEditor)
  const change = (id, value) => { input(id).props.onChange({ target: { value } }); render() }
  render()
  editorView().props.onReady(editor)
  render()
  change('article-title', header.title)
  change('article-slug', header.slug)
  change('article-excerpt', header.excerpt)
  change('article-type', header.articleType)
  editorView().props.onChange(getRealJSON(document))
  render()
  return { state, render, input, editorView,
    submit: () => find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }),
    status: () => find(node => node.props?.role === 'status').props.children,
    error: () => nodes(tree).find(node => node.props?.['data-error-code']),
    locked: () => ({ form: find(node => node.type === 'form').props['aria-busy'],
      fields: find(node => node.type === 'fieldset').props.disabled,
      save: find(node => node.type === 'button' && node.props.type === 'submit').props.disabled,
      editor: editorView().props.disabled }),
  }
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
      assert.deepEqual(call.payload, { ...header, contentJson: { type: 'doc', content: [expectedNode] },
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

test('failed update retains values and its token; explicit retry succeeds and the next update uses the returned token', async () => {
  const error = { code: 'EDIT_CONFLICT', message: 'Bài viết đã thay đổi.' }
  const form = mount(documentFor(paragraph('Nội dung cần giữ')), { edit: true, action: () => ({ ok: false, error }) })
  await form.submit()
  form.render()
  assert.equal(form.status(), 'Lưu thất bại')
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
  assert.equal(form.state.calls[2].payload.expectedUpdatedAt, nextToken)
  assert.equal(form.status(), 'Đã lưu')
})
