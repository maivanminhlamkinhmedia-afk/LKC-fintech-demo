import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { flattenExtensions, getSchema } from '@tiptap/core'

const feature = name => new URL(`../src/features/cms/${name}.ts`, import.meta.url).href
const rolesUrl = new URL('../src/lib/roles.ts', import.meta.url).href
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  if ([feature('article-draft'), feature('editor-schema'), feature('access')].includes(context.parentURL)) {
    if (specifier === '@/lib/roles') return nextResolve(rolesUrl, context)
    if (['./editor-schema', './access'].includes(specifier)) return nextResolve(feature(specifier.slice(2)), context)
  }
  return nextResolve(specifier, context)
} })
let editor, draft
try {
  editor = await import(feature('editor-schema'))
  draft = await import(feature('article-draft'))
} finally { hook.deregister() }

const { EDITOR_LIMITS, EDITOR_SCHEMA_VERSION, EMPTY_EDITOR_DOCUMENT, EditorDocumentError, createEditorExtensions,
  validateEditorDocument, validateStoredEditorDocument, isSafeEditorLink } = editor
const { ARTICLE_TYPES, ArticleDraftError, canonicalizeArticleSlug, normalizeCreateDraftInput, normalizeUpdateDraftInput,
  canEditArticleDraft, parseArticleId, parseArticlePage, parseExpectedUpdatedAt, nextArticleUpdatedAt, mapDraftError } = draft
const text = value => ({ type: 'text', text: value })
const paragraph = value => ({ type: 'paragraph', ...(value ? { content: [text(value)] } : {}) })
const document = (...content) => ({ type: 'doc', content })
const input = () => ({ title: ' Bài viết mới ', slug: 'Đánh giá Thị Trường', excerpt: ' Tóm tắt ', articleType: 'NEWS', contentJson: document(paragraph('Xin chào')) })
const rejectsDocument = value => assert.throws(() => validateEditorDocument(value), EditorDocumentError)
const validation = (value, field) => assert.throws(() => normalizeCreateDraftInput(value), error => {
  const mapped = mapDraftError(error)
  return mapped.code === 'VALIDATION_ERROR' && (!field || field in (mapped.fieldErrors ?? {}))
})

test('shared StarterKit schema validates all supported nodes/marks and derives exact Vietnamese/list/code text', () => {
  const value = document(
    { type: 'heading', attrs: { level: 2 }, content: [text('Tiêu đề')] },
    { type: 'paragraph', content: [
      { ...text('Đậm'), marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }, { type: 'strike' }] },
      { type: 'hardBreak' }, { ...text('mã'), marks: [{ type: 'code' }] },
    ] },
    { type: 'bulletList', content: [
      { type: 'listItem', content: [paragraph('Một')] },
      { type: 'listItem', content: [paragraph('Hai')] },
    ] },
    { type: 'orderedList', attrs: { start: 2, type: null }, content: [{ type: 'listItem', content: [paragraph('Ba')] }] },
    { type: 'blockquote', content: [paragraph('Trích dẫn')] },
    { type: 'codeBlock', attrs: { language: null }, content: [text('const x = 1;\n  x++')] },
    { type: 'horizontalRule' },
    { type: 'heading', attrs: { level: 3 }, content: [{ ...text('Liên kết'), marks: [{ type: 'link', attrs: { href: 'https://example.com/vi' } }] }] },
  )
  const validated = validateEditorDocument(value)
  assert.equal(validated.contentText, 'Tiêu đề\nĐậm\nmã\nMột\nHai\nBa\nTrích dẫn\nconst x = 1;\n  x++\nLiên kết')
  assert.deepEqual(validateEditorDocument(validated.contentJson), validated)
  assert.equal(createEditorExtensions().length, 1, 'StarterKit contains Link/Underline; no duplicate registration')
  assert.equal(validated.contentJson.content.at(-1).content[0].marks[0].attrs.target, '_blank')
})

test('blank body canonicalizes to one empty paragraph and stored schema never migrates silently', () => {
  for (const value of [EMPTY_EDITOR_DOCUMENT, { type: 'doc' }, document()]) {
    assert.deepEqual(validateEditorDocument(value), { contentJson: EMPTY_EDITOR_DOCUMENT, contentText: '' })
  }
  assert.deepEqual(validateStoredEditorDocument(EMPTY_EDITOR_DOCUMENT, EDITOR_SCHEMA_VERSION), { contentJson: EMPTY_EDITOR_DOCUMENT, contentText: '' })
  for (const version of [0, 2, '1', null, undefined]) {
    assert.throws(() => validateStoredEditorDocument(EMPTY_EDITOR_DOCUMENT, version), error => error.code === 'UNSUPPORTED_DOCUMENT')
  }
  assert.throws(() => validateStoredEditorDocument(document({ type: 'image' }), 1), error => error.code === 'UNSUPPORTED_DOCUMENT')
})

test('root, structural nesting, node/mark/attribute allowlists and non-JSON values fail closed', () => {
  for (const value of [null, [], '<p>HTML</p>', 1, {}, { type: 'paragraph' }, document(text('bare')),
    document({ type: 'paragraph', content: [paragraph('nested')] }),
    document({ type: 'orderedList', content: [] }), document({ type: 'listItem', content: [paragraph('unwrapped')] }),
    document({ type: 'image', attrs: { src: 'https://example.com/x' } }),
    document({ type: 'heading', attrs: { level: 1 }, content: [text('H1')] }),
    document({ type: 'heading', attrs: { level: '2' } }),
    document({ type: 'paragraph', attrs: { style: 'color:red' } }),
    document({ type: 'paragraph', attrs: undefined }),
    document({ type: 'paragraph', content: [{ ...text('x'), marks: [{ type: 'unknown' }] }] }),
    document({ type: 'paragraph', content: [{ ...text('x'), marks: [{ type: 'bold', attrs: { class: 'x' } }] }] }),
    document({ type: 'paragraph', content: [{ ...text('x'), marks: [{ type: 'bold' }, { type: 'bold' }] }] }),
    document({ type: 'codeBlock', content: [{ ...text('x'), marks: [{ type: 'bold' }] }] }),
    document({ type: 'paragraph', content: [text('')] }), document({ type: 'hardBreak', content: [text('x')] }),
    document({ type: 'codeBlock', attrs: { language: '<script>' } }),
    document({ type: 'orderedList', attrs: { start: NaN }, content: [{ type: 'listItem', content: [paragraph('x')] }] }),
    { ...EMPTY_EDITOR_DOCUMENT, [Symbol('hidden')]: true },
    { ...EMPTY_EDITOR_DOCUMENT, toJSON() { throw new Error('must not execute') } },
    JSON.parse('{"type":"doc","__proto__":{}}'),
    JSON.parse('{"type":"doc","constructor":{}}'),
    document({ type: 'paragraph', attrs: { prototype: {} } }),
  ]) rejectsDocument(value)
  const cyclic = document()
  cyclic.content.push(cyclic)
  rejectsDocument(cyclic)
  const sparse = document()
  sparse.content.length = 2
  rejectsDocument(sparse)
  const inherited = Object.create({ type: 'doc' })
  rejectsDocument(inherited)
  let getterCalls = 0
  const getter = Object.defineProperty({}, 'type', { enumerable: true, get() { getterCalls++; return 'doc' } })
  rejectsDocument(getter)
  assert.equal(getterCalls, 0)
})

test('HTTP(S) links reject parser repair, credentials, controls and arbitrary mark attributes', () => {
  for (const href of ['https://example.com', 'http://example.com/path?q=1#x', 'https://例え.jp/道']) assert.equal(isSafeEditorLink(href), true, href)
  for (const href of ['javascript:alert(1)', 'data:text/html,x', 'file:///x', '//example.com', '/relative', 'http:example.com',
    'https://user:secret@example.com', 'https://@example.com', 'https://example.com/\npath', 'https://example.com/\u0085x', 'https://example.com/ x',
    ' https://example.com', 'https://example.com\\@evil.test', '', null, {}]) {
    assert.equal(isSafeEditorLink(href), false)
    rejectsDocument(document({ type: 'paragraph', content: [{ ...text('link'), marks: [{ type: 'link', attrs: { href } }] }] }))
  }
  for (const attrs of [{ href: 'https://example.com', target: '_self' }, { href: 'https://example.com', rel: 'opener' },
    { href: 'https://example.com', class: 'arbitrary' }, { href: 'https://example.com', title: 'arbitrary' },
    { href: 'https://example.com', onclick: 'alert(1)' }]) {
    rejectsDocument(document({ type: 'paragraph', content: [{ ...text('link'), marks: [{ type: 'link', attrs }] }] }))
  }
})

test('shared link HTML parse rule canonicalizes pasted presentation attributes and preserves URL rejection', () => {
  const extensions = createEditorExtensions()
  assert.equal(flattenExtensions(extensions).filter(extension => extension.name === 'link').length, 1)
  assert.equal(flattenExtensions(extensions).filter(extension => extension.name === 'underline').length, 1)
  const schema = getSchema(extensions)
  const rule = schema.marks.link.spec.parseDOM.find(rule => rule.tag === 'a[href]')
  // Exercise the actual schema parser with only its required Element interface.
  // This is a parse-rule regression test, not a browser clipboard test.
  const pasted = { href: 'https://example.com/vi', target: '_self', rel: 'opener',
    class: 'copied-style', title: 'Copied title', onclick: 'alert(1)' }
  const attrs = rule.getAttrs({ getAttribute: name => pasted[name] ?? null })
  const value = document({ type: 'paragraph', content: [{ ...text('Liên kết'), marks: [{ type: 'link', attrs }] }] })
  const validated = validateEditorDocument(value)
  assert.deepEqual({ ...validated.contentJson.content[0].content[0].marks[0].attrs }, {
    href: 'https://example.com/vi', target: '_blank', rel: 'noopener noreferrer nofollow', class: null, title: null,
  })
  assert.equal(validated.contentText, 'Liên kết')
  assert.deepEqual(validateEditorDocument(validated.contentJson), validated)
  for (const href of ['javascript:alert(1)', 'data:text/html,x', 'http:example.com', 'https://user:secret@example.com']) {
    assert.equal(rule.getAttrs({ getAttribute: name => name === 'href' ? href : null }), false)
  }
})

test('serialized UTF-8 byte limit accepts the exact boundary and rejects the next byte', () => {
  const base = document(paragraph('x'))
  const overhead = Buffer.byteLength(JSON.stringify(base)) - 1
  const remaining = EDITOR_LIMITS.maxBytes - overhead
  const body = 'é'.repeat(Math.floor(remaining / 2)) + (remaining % 2 ? 'a' : '')
  const boundary = document(paragraph(body))
  assert.equal(Buffer.byteLength(JSON.stringify(boundary)), EDITOR_LIMITS.maxBytes)
  validateEditorDocument(boundary)
  rejectsDocument(document(paragraph(body + 'a')))
})

test('node count and content-tree depth accept exact limits and reject one above', () => {
  validateEditorDocument(document(...Array.from({ length: EDITOR_LIMITS.maxNodes - 1 }, () => paragraph(''))))
  rejectsDocument(document(...Array.from({ length: EDITOR_LIMITS.maxNodes }, () => paragraph(''))))
  let content = paragraph('depth')
  for (let i = 0; i < EDITOR_LIMITS.maxDepth - 3; i++) content = { type: 'blockquote', content: [content] }
  validateEditorDocument(document(content))
  rejectsDocument(document({ type: 'blockquote', content: [content] }))
})

test('derived text code-point limit is enforced independently of byte and node limits', () => {
  assert.equal(validateEditorDocument(document(paragraph('a'.repeat(EDITOR_LIMITS.maxTextCodePoints)))).contentText.length, EDITOR_LIMITS.maxTextCodePoints)
  rejectsDocument(document(paragraph('a'.repeat(EDITOR_LIMITS.maxTextCodePoints + 1))))
})

test('draft metadata normalizes Unicode without truncation or implicit article-type defaults', () => {
  const normalized = normalizeCreateDraftInput(input())
  assert.equal(normalized.title, 'Bài viết mới')
  assert.equal(normalized.slug, 'danh-gia-thi-truong')
  assert.equal(normalized.excerpt, 'Tóm tắt')
  assert.equal(normalized.contentText, 'Xin chào')
  assert.equal(canonicalizeArticleSlug('Đỗ Thị Hà'), 'do-thi-ha')
  assert.equal(canonicalizeArticleSlug('a'), 'a')
  assert.equal(canonicalizeArticleSlug('a'.repeat(150)).length, 150)
  for (const slug of ['', '--', '😀', null, 'a'.repeat(151)]) validation({ ...input(), slug }, 'slug')
  for (const articleType of ARTICLE_TYPES) assert.equal(normalizeCreateDraftInput({ ...input(), articleType }).articleType, articleType)
  for (const articleType of ['unknown', 'news', '', undefined, null, {}]) validation({ ...input(), articleType }, 'articleType')
  assert.equal(Array.from(normalizeCreateDraftInput({ ...input(), title: '😀'.repeat(180), excerpt: '😀'.repeat(2000) }).title).length, 180)
  validation({ ...input(), title: '😀'.repeat(181) }, 'title')
  validation({ ...input(), excerpt: '😀'.repeat(2001) }, 'excerpt')
  assert.equal(normalizeCreateDraftInput({ ...input(), excerpt: '  ', contentJson: EMPTY_EDITOR_DOCUMENT }).excerpt, '')
  for (const title of ['', ' ', undefined, null, 1]) validation({ ...input(), title }, 'title')
  for (const excerpt of [undefined, null, 1]) validation({ ...input(), excerpt }, 'excerpt')
})

test('payload exact allowlist rejects ownership/lifecycle/nested writes and read-only derived fields', () => {
  for (const field of ['authorId', 'editorId', 'userId', 'role', 'status', 'contentText', 'editorSchemaVersion', 'publishedAt',
    'submittedAt', 'approvedAt', 'scheduledAt', 'featured', 'categoryId', 'topics', 'coverMediaId', 'seoTitle', 'articleId', 'id', 'expectedUpdatedAt']) {
    validation({ ...input(), [field]: 'forged' })
  }
  for (const value of [null, [], '', Object.create(input())]) validation(value)
  let calls = 0
  const value = input()
  Object.defineProperty(value, 'title', { enumerable: true, get() { calls++; return 'Forged' } })
  validation(value, 'title')
  assert.equal(calls, 0)
})

test('update token is mandatory canonical ISO and never enters write data', () => {
  const token = '2026-09-24T10:00:00.123Z'
  const result = normalizeUpdateDraftInput({ ...input(), expectedUpdatedAt: token })
  assert.equal(result.expectedUpdatedAt.toISOString(), token)
  assert.equal('expectedUpdatedAt' in result.data, false)
  for (const bad of [undefined, null, 1, new Date(token), '2026-09-24T10:00:00Z', '2026-02-30T00:00:00.000Z',
    '2026-09-24T10:00:00.123+00:00', token + ' ']) assert.throws(() => parseExpectedUpdatedAt(bad), ArticleDraftError)
  assert.equal(nextArticleUpdatedAt(new Date(token), Date.parse(token)).toISOString(), '2026-09-24T10:00:00.124Z')
  assert.equal(nextArticleUpdatedAt(new Date(token), Date.parse(token) - 500).getTime(), Date.parse(token) + 1)
})

test('CMS005 restricts both admin roles to editable statuses while preserving creator ownership', () => {
  const statuses = ['DRAFT', 'CHANGES_REQUESTED', 'SUBMITTED', 'EDITORIAL_REVIEW', 'FACT_CHECK', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'CORRECTED', 'ARCHIVED']
  for (const role of ['SUPER_ADMIN', 'ADMIN', 'CREATOR', 'MANAGER', 'SALES_MANAGER', 'SALES', 'ANALYST', 'EMPLOYEE', 'CLIENT']) {
    for (const status of statuses) for (const authorId of ['actor', 'other']) {
      const expected = ['SUPER_ADMIN', 'ADMIN', 'CREATOR'].includes(role) && ['DRAFT', 'CHANGES_REQUESTED'].includes(status)
        && (role !== 'CREATOR' || authorId === 'actor')
      assert.equal(canEditArticleDraft({ id: 'actor', role }, { id: 'article', authorId, status }), expected, `${role}/${status}/${authorId}`)
    }
  }
  assert.equal(canEditArticleDraft(null, { id: 'article', authorId: 'x', status: 'DRAFT' }), false)
})

test('ID and pagination parsing reject unsafe values without revealing article metadata', () => {
  assert.equal(parseArticleId('article_123-abc'), 'article_123-abc')
  for (const value of ['', ' x', 'x ', 'a/b', 'a\nb', null, {}, 'a'.repeat(192)]) assert.throws(() => parseArticleId(value), error => error.code === 'NOT_FOUND')
  assert.equal(parseArticlePage('2'), 2)
  for (const value of [undefined, '0', '-1', '1.5', '01', 'NaN', [], '9007199254740991']) assert.equal(parseArticlePage(value), 1)
})

test('safe errors recognize only Article slug conflicts and real conflict codes without diagnostics', () => {
  const diagnostics = 'SECRET SQL password and article body'
  for (const target of ['slug', ['slug'], 'Article_slug_key']) {
    assert.equal(mapDraftError({ code: 'P2002', message: diagnostics, meta: { modelName: 'Article', target } }).code, 'SLUG_CONFLICT')
  }
  assert.equal(mapDraftError({ code: 'P2002', meta: { driverAdapterError: { cause: { constraint: { index: 'Article_slug_key' } } } } }).code, 'SLUG_CONFLICT')
  assert.equal(mapDraftError({ code: 'P2034', message: diagnostics }).code, 'EDIT_CONFLICT')
  for (const error of [new Error(diagnostics), diagnostics, null, { code: 'P2002', meta: { target: 'userId' } },
    { code: 'P2002', meta: { modelName: 'AuthorProfile', target: 'slug' } }]) assert.equal(mapDraftError(error).code, 'INTERNAL_ERROR')
  const known = new ArticleDraftError('VALIDATION_ERROR', 'title')
  known.message = diagnostics
  assert.equal(mapDraftError(known).fieldErrors.title.includes(diagnostics), false)
  assert.deepEqual(Object.keys(mapDraftError(known)).sort(), ['code', 'fieldErrors', 'message'])
  let calls = 0
  const malicious = Object.defineProperty({}, 'code', { get() { calls++; throw Error(diagnostics) } })
  assert.equal(mapDraftError(malicious).code, 'INTERNAL_ERROR')
  assert.equal(calls, 0)
})
