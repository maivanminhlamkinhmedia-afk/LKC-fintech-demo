import assert from 'node:assert/strict'
import { after } from 'node:test'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { createFixturePlan } from '../scripts/cms-e2e/fixtures.mjs'

const root = new URL('../src/', import.meta.url)
const queryUrl = new URL('features/cms/article-preview-query.ts', root).href
const richUrl = new URL('features/cms/components/PreviewRichText.tsx', root).href
const previewUrl = new URL('features/cms/components/ArticlePreview.tsx', root).href
const bridge = Symbol.for('cms-preview-test-adapter')
const calls = []
const noWrite = () => { throw new Error('preview attempted a write') }
let scenario
const tx = {
  user: { async findUnique() { calls.push('actor'); return scenario.actor } },
  article: { async findFirst(args) {
    calls.push(args.where.AND[0].coverMediaId ? 'coverScope' : 'parent')
    if (args.where.AND[0].coverMediaId) return scenario.coverArticle ?? { id: 'article-a' }
    const scope = args.where.AND[1]
    return scenario.article && (!scope.authorId || scope.authorId === scenario.article.authorId) ? scenario.article : null
  }, update: noWrite, updateMany: noWrite, create: noWrite, delete: noWrite },
  authorProfile: { async findUnique(args) { calls.push('profile'); assert.deepEqual(Object.keys(args.select), ['displayName', 'jobTitle', 'isPublic']); return scenario.profile } },
  articleTopicMapping: { async findMany() { calls.push('topics'); return scenario.topicMappings } },
  articleTagMapping: { async findMany() { calls.push('tags'); return scenario.tagMappings } },
  articleInstrument: { async findMany() { calls.push('instruments'); return scenario.instrumentMappings } },
  articleCategory: { async findMany() { calls.push('categories'); return scenario.categories } },
  articleTopic: { async findMany() { calls.push('topicTerms'); return scenario.topicTerms } },
  articleTag: { async findMany() { calls.push('tagTerms'); return scenario.tagTerms } },
  financialInstrument: { async findMany() { calls.push('instrumentTerms'); return scenario.instrumentTerms } },
  sourceReference: { async findMany(args) {
    calls.push('sources')
    assert.equal(args.select.note, undefined)
    assert.equal(args.select.createdById, undefined)
    assert.deepEqual(args.orderBy, [{ createdAt: 'asc' }, { id: 'asc' }])
    return scenario.sources
  } },
  mediaAsset: { async findUnique() { calls.push('asset'); return scenario.asset } },
}
const prisma = { async $transaction(callback, options) {
  calls.push('transaction')
  assert.equal(options.isolationLevel, 'Serializable')
  return callback(tx)
} }
globalThis[bridge] = { prisma, Link: ({ children, prefetch, ...props }) => {
  void prefetch
  return createElement('a', props, children)
} }
const adapter = `data:text/javascript,${encodeURIComponent(`const adapter = globalThis[Symbol.for('cms-preview-test-adapter')]; export const prisma = adapter.prisma; export default adapter.Link;`)}`
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return nextResolve('data:text/javascript,export {};', context)
    if (specifier === '@/lib/prisma' || specifier === 'next/link') return nextResolve(adapter, context)
    if (specifier.startsWith('@/')) return nextResolve(new URL(`${specifier.slice(2)}.ts`, root).href, context)
    if (context.parentURL?.startsWith(root.href) && specifier.startsWith('.') && !/\.[mc]?[jt]sx?$/.test(specifier)) {
      const base = new URL(specifier, context.parentURL)
      const extension = existsSync(new URL(`${base.href}.tsx`)) ? '.tsx' : '.ts'
      return nextResolve(`${base.href}${extension}`, context)
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.startsWith(root.href) && /\.tsx?$/.test(url)) return {
      format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
      } }).outputText,
    }
    return nextLoad(url, context)
  },
})
let getArticlePreview, PreviewRichText, ArticlePreview, validateStoredEditorDocument
try {
  ;({ getArticlePreview } = await import(queryUrl))
  ;({ PreviewRichText } = await import(richUrl))
  ;({ ArticlePreview } = await import(previewUrl))
  ;({ validateStoredEditorDocument } = await import(new URL('features/cms/editor-schema.ts', root).href))
} finally { hook.deregister(); delete globalThis[bridge] }
after(() => { calls.length = 0 })

const simple = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Đã lưu' }] }] }
function reset(overrides = {}) {
  calls.length = 0
  scenario = {
    actor: { id: 'creator-a', role: 'CREATOR', status: 'ACTIVE' },
    article: { id: 'article-a', authorId: 'creator-a', title: 'Tiêu đề <script>', excerpt: 'Tóm tắt',
      articleType: 'NEWS', status: 'DRAFT', updatedAt: new Date('2026-10-05T17:00:00.123Z'),
      contentJson: simple, editorSchemaVersion: 1, categoryId: null, coverMediaId: null },
    profile: null, topicMappings: [], tagMappings: [], instrumentMappings: [],
    categories: [], topicTerms: [], tagTerms: [], instrumentTerms: [], sources: [], asset: null,
    ...overrides,
  }
  return scenario
}
const actor = (id = 'creator-a', role = 'CREATOR') => ({ id, role })

test('fresh actor and scoped parent precede every child; invalid/foreign/missing return same code', async () => {
  reset()
  assert.equal((await getArticlePreview(actor(), '../foreign')).error, 'NOT_FOUND')
  assert.deepEqual(calls, [])
  for (const change of [{ article: null }, { article: { ...scenario.article, authorId: 'other' } }]) {
    reset(change)
    assert.equal((await getArticlePreview(actor(), 'article-a')).error, 'NOT_FOUND')
    assert.deepEqual(calls, ['transaction', 'actor', 'parent'])
  }
  reset({ actor: { id: 'creator-a', role: 'CLIENT', status: 'ACTIVE' } })
  assert.equal((await getArticlePreview(actor(), 'article-a')).error, 'FORBIDDEN')
  assert.deepEqual(calls, ['transaction', 'actor'])
  reset({ actor: { id: 'creator-a', role: 'CREATOR', status: 'SUSPENDED' } })
  assert.equal((await getArticlePreview(actor(), 'article-a')).error, 'FORBIDDEN')
  assert.deepEqual(calls, ['transaction', 'actor'])
})

test('all stored statuses are readable, including foreign articles for admin and super', async () => {
  for (const role of ['ADMIN', 'SUPER_ADMIN']) for (const status of [
    'DRAFT', 'CHANGES_REQUESTED', 'SUBMITTED', 'EDITORIAL_REVIEW', 'FACT_CHECK', 'APPROVED',
    'SCHEDULED', 'PUBLISHED', 'CORRECTED', 'ARCHIVED',
  ]) {
    reset({ actor: { id: 'admin-a', role, status: 'ACTIVE' }, article: { ...reset().article, authorId: 'other', status } })
    const result = await getArticlePreview(actor('admin-a', role), 'article-a')
    assert.equal(result.ok, true, `${role}/${status}`)
    assert.equal(result.data.status, status)
    assert.deepEqual(calls.slice(0, 3), ['transaction', 'actor', 'parent'])
  }
})

test('snapshot projects public profile, retained taxonomy, safe ordered sources and foreign-uploader cover', async () => {
  const base = reset().article
  reset({ article: { ...base, categoryId: 'cat-a', coverMediaId: 'a'.repeat(32) },
    profile: { displayName: 'Tên <b>', jobTitle: 'Chuyên gia', isPublic: true, publicEmail: 'PRIVATE_EMAIL' },
    categories: [{ id: 'cat-a', name: 'Chứng khoán', slug: 'co-phieu', isActive: false }],
    topicMappings: [{ topicId: 'topic-a' }], topicTerms: [{ id: 'topic-a', name: 'Thị trường', slug: 'thi-truong', isActive: true }],
    tagMappings: [{ tagId: 'tag-a' }], tagTerms: [{ id: 'tag-a', name: 'Việt Nam', slug: 'viet-nam' }],
    instrumentMappings: [{ instrumentId: 'instrument-a', isPrimary: true }],
    instrumentTerms: [{ id: 'instrument-a', name: 'VNM', canonicalKey: 'HOSE:VNM', symbol: 'VNM', isActive: false }],
    sources: [{ title: 'Báo cáo', sourceType: 'REPORT', publisher: 'Sở', url: 'https://example.com/report',
      publishedAt: null, accessedAt: null, dataTimestamp: null, note: 'PRIVATE_NOTE', createdById: 'PRIVATE_ACTOR' }],
    asset: { id: 'a'.repeat(32), filename: `${'a'.repeat(32)}.png`, url: `/api/cms/media/${'a'.repeat(32)}/content`,
      mimeType: 'image/png', width: 16, height: 16, sizeBytes: 50, uploadedById: 'other', altText: 'Ảnh', caption: 'Bìa' },
  })
  const result = await getArticlePreview(actor(), 'article-a')
  assert.equal(result.ok, true)
  assert.deepEqual(result.data.author, { displayName: 'Tên <b>', jobTitle: 'Chuyên gia' })
  assert.deepEqual(result.data.category, { name: 'Chứng khoán', isActive: false })
  assert.equal(result.data.instruments[0].isPrimary, true)
  assert.equal(result.data.cover.src, `/api/cms/media/${'a'.repeat(32)}/content`)
  assert.equal(result.data.sources[0].safeUrl, 'https://example.com/report')
  assert.equal(JSON.stringify(result.data).includes('PRIVATE_'), false)
  assert.ok(calls.indexOf('parent') < calls.indexOf('sources'))
  assert.ok(calls.includes('coverScope'))
  const jpeg = { ...scenario.asset, filename: `${'a'.repeat(32)}.jpg`, mimeType: 'image/jpeg' }
  scenario.asset = jpeg
  assert.equal((await getArticlePreview(actor(), 'article-a')).data.cover.src, `/api/cms/media/${'a'.repeat(32)}/content`)
  reset({ profile: { displayName: 'Hidden', jobTitle: null, isPublic: false } })
  assert.equal((await getArticlePreview(actor(), 'article-a')).data.author, null)
})

test('legacy/missing cover and unsafe source URL have safe fallbacks; unsupported content fails closed', async () => {
  const base = reset().article
  reset({ article: { ...base, coverMediaId: 'a'.repeat(32) }, asset: null,
    sources: [{ title: '<img>', sourceType: 'OTHER', publisher: null, url: 'javascript:alert(1)',
      publishedAt: null, accessedAt: null, dataTimestamp: null }] })
  let result = await getArticlePreview(actor(), 'article-a')
  assert.equal(result.ok, true)
  assert.equal(result.data.cover, null)
  assert.equal(result.data.sources[0].safeUrl, null)
  reset({ article: { ...base, editorSchemaVersion: 2 } })
  result = await getArticlePreview(actor(), 'article-a')
  assert.deepEqual(result, { ok: false, error: 'UNSUPPORTED_DOCUMENT' })
  assert.deepEqual(calls, ['transaction', 'actor', 'parent'])
})

test('real stored schema and React renderer retain rich nodes, marks, escaping and code whitespace', () => {
  const document = validateStoredEditorDocument({ type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Tiếng Việt <script>' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Liên kết', marks: [{ type: 'bold' }, { type: 'link',
      attrs: { href: 'https://example.com/', target: '_blank', rel: 'noopener noreferrer nofollow', class: null, title: null } }] },
    { type: 'text', text: ' nghiêng', marks: [{ type: 'italic' }] },
    { type: 'text', text: ' gạch dưới', marks: [{ type: 'underline' }] },
    { type: 'text', text: ' gạch ngang', marks: [{ type: 'strike' }] },
    { type: 'text', text: ' inline()', marks: [{ type: 'code' }] }, { type: 'hardBreak' },
    { type: 'text', text: 'xuống dòng' }] },
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Tiêu đề ba' }] },
    { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'trích dẫn' }] }] },
    { type: 'orderedList', attrs: { start: 3, type: 'a' }, content: [{ type: 'listItem', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'mục' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'lồng' }] }] }] },
    ] }] },
    { type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: 'const tiếngViệt = 1;\n  dòng 2' }] },
    { type: 'horizontalRule' },
  ] }, 1).contentJson
  const html = renderToStaticMarkup(createElement(PreviewRichText, { document }))
  assert.match(html, /<h2[^>]*>Tiếng Việt &lt;script&gt;<\/h2>/)
  assert.match(html, /<ol[^>]*start="3"[^>]*type="a"/)
  assert.match(html, /<h3[^>]*>Tiêu đề ba<\/h3>/)
  for (const tag of ['em', 'u', 's', 'blockquote', 'br']) assert.match(html, new RegExp(`<${tag}\\b`))
  assert.match(html, /const tiếngViệt = 1;\n  dòng 2/)
  assert.match(html, /rel="noopener noreferrer nofollow"/)
  assert.match(html, /referrerPolicy="no-referrer"|referrerpolicy="no-referrer"/i)
  assert.equal(html.includes('<script>'), false)
  assert.match(html, /<hr/)
  const empty = renderToStaticMarkup(createElement(PreviewRichText, { document: validateStoredEditorDocument({ type: 'doc', content: [{ type: 'paragraph' }] }, 1).contentJson }))
  assert.match(empty, /chưa có nội dung đã lưu/)
  for (const bad of [
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] },
    { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 } }] },
  ]) assert.throws(() => validateStoredEditorDocument(bad, 1), { code: 'UNSUPPORTED_DOCUMENT' })
})

test('article shell escapes metadata and renders only the saved DTO', async () => {
  reset()
  const result = await getArticlePreview(actor(), 'article-a')
  assert.equal(result.ok, true)
  const html = renderToStaticMarkup(createElement(ArticlePreview, { article: result.data }))
  assert.match(html, /Bản xem trước nội bộ/)
  assert.match(html, /Tiêu đề &lt;script&gt;/)
  assert.match(html, /Bản lưu cập nhật/)
  assert.equal(html.includes('<script>'), false)
  assert.equal(html.includes('PRIVATE_'), false)
})

test('a journal DRAFT key does not preserve seed title, empty cover or empty sources after earlier cases', async () => {
  const manifest = createFixturePlan('abcdef0123456789abcdef01', 4)
  const seedTitle = `${manifest.namespace} DRAFT`
  const coverId = 'a'.repeat(32)
  const changed = reset().article
  reset({ article: { ...changed, title: `${manifest.namespace} precision 2`, coverMediaId: coverId },
    sources: [{ title: 'Nguồn cạnh tranh ảnh bìa', sourceType: 'REPORT', publisher: null,
      url: null, publishedAt: null, accessedAt: null, dataTimestamp: null, note: null }],
    asset: { id: coverId, filename: `${coverId}.png`, url: `/api/cms/media/${coverId}/content`,
      mimeType: 'image/png', width: 16, height: 16, sizeBytes: 50, uploadedById: 'other', altText: 'Bìa', caption: null },
  })
  const changedResult = await getArticlePreview(actor(), 'article-a')
  assert.equal(changedResult.ok, true)
  const changedHtml = renderToStaticMarkup(createElement(ArticlePreview, { article: changedResult.data }))
  // The old E2E assertions would fail against the real query/renderer on this synthetic post-EDIT/MED state.
  assert.throws(() => assert.match(changedHtml, new RegExp(seedTitle)))
  assert.throws(() => assert.match(changedHtml, /Bài viết chưa có ảnh bìa khả dụng/))
  assert.throws(() => assert.match(changedHtml, /Chưa có nguồn tham khảo/))
  assert.match(changedHtml, /precision 2/)
  assert.match(changedHtml, /Nguồn cạnh tranh ảnh bìa/)

  const isolated = reset().article
  reset({ article: { ...isolated, title: `${manifest.namespace} preview empty-header`, excerpt: '',
    contentJson: { type: 'doc', content: [{ type: 'paragraph' }] }, coverMediaId: null },
    sources: [], asset: null })
  const isolatedResult = await getArticlePreview(actor(), 'article-a')
  assert.equal(isolatedResult.ok, true)
  const isolatedHtml = renderToStaticMarkup(createElement(ArticlePreview, { article: isolatedResult.data }))
  assert.match(isolatedHtml, /preview empty-header/)
  assert.match(isolatedHtml, /Bài viết chưa có ảnh bìa khả dụng/)
  assert.match(isolatedHtml, /Chưa có nguồn tham khảo/)
})
