import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'

const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.endsWith('/article-review-snapshot.ts')
    && (specifier === './editor-schema' || specifier === './article-sources')) {
    return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context)
  }
  return nextResolve(specifier, context)
} })
const { inspectReviewSnapshot } = await import('../src/features/cms/article-review-snapshot.ts')
hook.deregister()

const basis = '2026-10-08T01:02:03.456Z'
const scoped = { articleId: 'article-a', versionId: 'version-a' }
function fixture() {
  return {
    version: {
      id: 'version-a', articleId: 'article-a', versionNumber: 2,
      snapshotFormatVersion: 1, basisUpdatedAt: new Date(basis),
      title: 'Saved title', slug: 'saved-slug', excerpt: '', articleType: 'NEWS',
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Saved body' }] }] },
      contentText: 'Saved body', editorSchemaVersion: 1, seoTitle: null, seoDescription: null,
      featured: false, privateNote: 'never serialize',
    },
    categories: [{ ...scoped, categoryId: 'category-a', nameAtCapture: 'Original category' }],
    topics: [{ ...scoped, topicId: 'topic-a', nameAtCapture: 'Original topic' }],
    tags: [{ ...scoped, tagId: 'tag-a', nameAtCapture: 'Original tag' }],
    instruments: [{ ...scoped, instrumentId: 'instrument-a', nameAtCapture: 'Original instrument',
      symbolAtCapture: 'AAA', isPrimary: true }],
    sources: [{ ...scoped, position: 0, sourceIdAtCapture: 'source-a', sourceType: 'REPORT',
      title: 'Original source', publisher: null, url: 'https://example.test/report',
      publishedAt: null, accessedAt: null, dataTimestamp: null, note: 'private note' }],
    disclosures: [{ ...scoped, position: 0, disclosureIdAtCapture: 'disclosure-a',
      statement: 'Public disclosure', conflictType: null, privateNote: 'hidden' }],
    media: [{ ...scoped, assetId: 'asset-a', context: 'COVER', altTextAtCapture: 'Original alt',
      captionAtCapture: null, filename: '/private/storage/never-serialize' }],
  }
}
const failure = (input, error) => assert.deepEqual(inspectReviewSnapshot(input), { ok: false, error })

test('projects a complete supplied version without live data, private fields or filesystem paths', () => {
  const input = fixture()
  const result = inspectReviewSnapshot(input)
  assert.equal(result.ok, true)
  assert.equal(result.data.activation, 'FOUNDATION_ONLY')
  assert.equal(result.data.basisUpdatedAt, basis)
  assert.equal(result.data.contentText, 'Saved body')
  assert.deepEqual(result.data.cover, { assetId: 'asset-a', altText: 'Original alt', caption: null })
  assert.deepEqual(result.data.sources[0], { id: 'source-a', sourceType: 'REPORT', title: 'Original source',
    publisher: null, safeUrl: 'https://example.test/report', publishedAt: null, accessedAt: null, dataTimestamp: null })
  assert.deepEqual(result.data.category, { id: 'category-a', name: 'Original category' })
  assert.equal(JSON.stringify(result).includes('private note'), false)
  assert.equal(JSON.stringify(result).includes('/private/storage'), false)
  assert.equal('audience' in result.data, false)
  assert.equal('approved' in result.data, false)
})

test('projection remains independent when supplied version and children mutate later', () => {
  const input = fixture()
  const result = inspectReviewSnapshot(input)
  assert.equal(result.ok, true)
  input.version.contentJson.content[0].content[0].text = 'Changed draft'
  input.categories[0].nameAtCapture = 'Renamed category'
  input.sources[0].title = 'Changed source'
  input.media[0].altTextAtCapture = 'Changed alt'
  assert.equal(result.data.contentJson.content[0].content[0].text, 'Saved body')
  assert.equal(result.data.category.name, 'Original category')
  assert.equal(result.data.sources[0].title, 'Original source')
  assert.equal(result.data.cover.altText, 'Original alt')
})

test('legacy and unknown snapshot markers fail closed, without filling from Article', () => {
  const input = fixture()
  input.version.snapshotFormatVersion = null
  failure(input, 'UNSUPPORTED_SNAPSHOT')
  input.version.snapshotFormatVersion = 2
  failure(input, 'UNSUPPORTED_SNAPSHOT')
  delete input.version.snapshotFormatVersion
  failure(input, 'INCOMPLETE_SNAPSHOT')
})

test('missing metadata, typed child rows or basis token fail closed', () => {
  const input = fixture()
  delete input.version.slug
  failure(input, 'INCOMPLETE_SNAPSHOT')
  const missingChild = fixture()
  delete missingChild.sources
  failure(missingChild, 'INCOMPLETE_SNAPSHOT')
  const badBasis = fixture()
  badBasis.version.basisUpdatedAt = '2026-10-08T01:02:03Z'
  failure(badBasis, 'INVALID_SNAPSHOT')
})

test('cross-Article edge and duplicate/invalid positions cannot enter one snapshot', () => {
  const foreign = fixture()
  foreign.media[0].articleId = 'article-foreign'
  failure(foreign, 'INVALID_SNAPSHOT')
  const gap = fixture()
  gap.sources[0].position = 1
  failure(gap, 'INVALID_SNAPSHOT')
  const duplicate = fixture()
  duplicate.topics.push({ ...scoped, topicId: 'topic-a', nameAtCapture: 'Duplicate' })
  failure(duplicate, 'INVALID_SNAPSHOT')
})

test('document drift, unsupported editor document and unsafe source URL are rejected', () => {
  const drift = fixture()
  drift.version.contentText = 'unsaved draft'
  failure(drift, 'INVALID_SNAPSHOT')
  const editor = fixture()
  editor.version.editorSchemaVersion = 2
  failure(editor, 'INVALID_SNAPSHOT')
  const url = fixture()
  url.sources[0].url = 'javascript:alert(1)'
  failure(url, 'INVALID_SNAPSHOT')
})

test('hostile accessors and unsupported inline-media context return safe codes', () => {
  const hostile = fixture()
  Object.defineProperty(hostile.version, 'title', { get() { throw Error('secret') } })
  failure(hostile, 'INVALID_SNAPSHOT')
  const inline = fixture()
  inline.media[0].context = 'INLINE'
  failure(inline, 'UNSUPPORTED_SNAPSHOT')
})
