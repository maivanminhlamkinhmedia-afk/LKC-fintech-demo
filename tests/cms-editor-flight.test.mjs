import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import test from 'node:test'
import { Editor, getSchema } from '@tiptap/core'
import { createEditorExtensions, EditorDocumentError, validateEditorDocument,
  validateStoredEditorDocument } from '../src/features/cms/editor-schema.ts'

// Exercise Next's installed production Flight codecs in memory, with the React
// aliases its bundler supplies. No mocked codec, HTTP, DOM, browser or database.
const require = createRequire(import.meta.url)
const compiled = new URL('../node_modules/next/dist/compiled/', import.meta.url)
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.startsWith(new URL('react-server-dom-turbopack/', compiled).href)) {
    const target = specifier === 'react' ? 'react/cjs/react.react-server.production.js'
      : specifier === 'react-dom' ? 'react-dom/cjs/react-dom.production.js' : null
    if (target) return { url: new URL(target, compiled).href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
} })
let client, server
try {
  client = require('next/dist/compiled/react-server-dom-turbopack/cjs/react-server-dom-turbopack-client.browser.production.js')
  server = require('next/dist/compiled/react-server-dom-turbopack/cjs/react-server-dom-turbopack-server.node.production.js')
} finally { hook.deregister() }

const schema = getSchema(createEditorExtensions())
const paragraph = text => schema.nodes.paragraph.createChecked(null, schema.text(text))
const samples = [
  ['paragraph', () => paragraph('Nội dung tiếng Việt: cổ phiếu và rủi ro.')],
  ['codeBlock', () => schema.nodes.codeBlock.createChecked({ language: null }, schema.text('const tiếngViệt = "an toàn";\nconsole.log(tiếngViệt)'))],
  ['link', () => schema.nodes.paragraph.createChecked(null,
    schema.text('Liên kết an toàn', [schema.marks.link.create({ href: 'https://example.com/vi' })]))],
  ['heading', () => schema.nodes.heading.createChecked({ level: 3 }, schema.text('Tiêu đề tiếng Việt'))],
  ['orderedList', () => schema.nodes.orderedList.createChecked({ start: 3, type: 'a' },
    schema.nodes.listItem.createChecked(null, paragraph('Mục thứ ba')))],
]
function editorOutput(makeNode) {
  const doc = schema.nodes.doc.createChecked(null, makeNode())
  // The actual Editor.getJSON implementation reads state.doc; a view is not
  // needed. attrs originate in ProseMirror, not hand-built JSON test fixtures.
  return Editor.prototype.getJSON.call({ state: { doc } })
}
function assertPlainJson(value) {
  if (value === null || typeof value !== 'object') return
  assert.equal(Object.getPrototypeOf(value), Array.isArray(value) ? Array.prototype : Object.prototype)
  for (const child of Object.values(value)) assertPlainJson(child)
}
function attrsIn(value) {
  if (!value || typeof value !== 'object') return []
  return [...(Object.hasOwn(value, 'attrs') ? [value.attrs] : []), ...Object.values(value).flatMap(attrsIn)]
}
async function actionRoundTrip(contentJson) {
  // Next uses distinct client Map / server WeakMap temporary-reference sets.
  const wire = await client.encodeReply([{ contentJson }], { temporaryReferences: client.createTemporaryReferenceSet() })
  const [received] = await server.decodeReply(wire, {}, { temporaryReferences: server.createTemporaryReferenceSet() })
  return { wire, contentJson: received.contentJson }
}
async function serverRoundTrip(contentJson, errors = []) {
  const stream = server.renderToReadableStream({ contentJson }, {}, { onError(error) {
    errors.push(error)
    return 'synthetic-editor-transport-error'
  } })
  return await client.createFromReadableStream(stream, {})
}

test('installed Flight reproduces opaque attrs for real editor output while plain paragraphs transmit normally', async () => {
  for (const [name, makeNode] of samples) {
    const raw = editorOutput(makeNode)
    validateEditorDocument(raw)
    const attrs = attrsIn(raw)
    const transmitted = await actionRoundTrip(raw)
    if (name === 'paragraph') {
      assert.equal(attrs.length, 0)
      assert.deepEqual(transmitted.contentJson, raw)
      validateEditorDocument(transmitted.contentJson)
      assert.deepEqual((await serverRoundTrip(raw)).contentJson, raw)
    } else {
      assert.ok(attrs.length > 0)
      for (const attr of attrs) assert.equal(Object.getPrototypeOf(attr), null)
      assert.equal(typeof transmitted.wire, 'string')
      assert.match(transmitted.wire, /"\$T"/)
      for (const attr of attrsIn(transmitted.contentJson)) assert.equal(typeof attr, 'function')
      assert.throws(() => validateEditorDocument(transmitted.contentJson), error => error.code === 'VALIDATION_ERROR')
      const errors = []
      await assert.rejects(serverRoundTrip(raw, errors))
      assert.ok(errors.some(error => /null prototypes/.test(error.message)))
    }
    // A clone of the trusted editor-produced JSON preserves every value while
    // replacing only object prototypes, before the action serializer sees it.
    const plain = JSON.parse(JSON.stringify(raw))
    const preserved = await actionRoundTrip(plain)
    assertPlainJson(preserved.contentJson)
    assert.deepEqual(preserved.contentJson, plain)
    assert.deepEqual((await serverRoundTrip(plain)).contentJson, plain)
    assert.equal(validateEditorDocument(preserved.contentJson).contentText, validateEditorDocument(raw).contentText)
  }
})

for (const [name, makeNode] of samples) {
  test(`canonical ${name} output and reopened stored content survive both real Flight directions`, async () => {
    const raw = editorOutput(makeNode)
    const expected = JSON.parse(JSON.stringify(raw))
    const validated = validateEditorDocument(raw)
    // Inspect BEFORE any JSON/structured clone: previous tests could otherwise
    // conceal the null-prototype attributes regenerated by the validator.
    assertPlainJson(validated.contentJson)
    assert.deepEqual(validated.contentJson, expected)
    const decoded = await actionRoundTrip(validated.contentJson)
    assert.deepEqual(decoded.contentJson, expected)
    assert.deepEqual(validateEditorDocument(decoded.contentJson), validated)
    assert.deepEqual((await serverRoundTrip(validated.contentJson)).contentJson, expected)

    const reopened = validateStoredEditorDocument(JSON.parse(JSON.stringify(validated.contentJson)), 1)
    assertPlainJson(reopened.contentJson)
    assert.deepEqual(reopened, validated)
    const received = await serverRoundTrip(reopened.contentJson)
    assert.deepEqual(received.contentJson, expected)
    const rebuilt = schema.nodeFromJSON(received.contentJson)
    assert.deepEqual(JSON.parse(JSON.stringify(Editor.prototype.getJSON.call({ state: { doc: rebuilt } }))), expected)
  })
}

test('canonical output normalization never sanitizes untrusted values before strict validation', () => {
  let hooksCalled = 0
  const doc = attrs => ({ type: 'doc', content: [{ type: 'codeBlock', attrs }] })
  const accessor = Object.defineProperty({}, 'language', { enumerable: true, get() { hooksCalled++; return null } })
  const toJSON = { type: 'doc', toJSON() { hooksCalled++; return { type: 'doc' } } }
  const cyclic = { type: 'doc', content: [] }
  cyclic.content.push(cyclic)
  class Untrusted { type = 'doc' }
  for (const bad of [doc({ language: NaN }), doc({ language: undefined }), doc({ unknown: undefined }),
    doc(accessor), toJSON, cyclic, new Untrusted(), doc({ language: null, [Symbol('unknown')]: true }),
    { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 } }] },
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'unsafe',
      marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] }]) {
    assert.throws(() => validateEditorDocument(bad), EditorDocumentError)
    assert.throws(() => validateStoredEditorDocument(bad, 1), error => error.code === 'UNSUPPORTED_DOCUMENT')
  }
  assert.equal(hooksCalled, 0)
})
