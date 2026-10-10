import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const { planArticleVersionMediaCapture: plan } =
  await import('../src/features/cms/article-version-media-capture-policy.ts')

const article = (overrides = {}) => ({
  id: 'article-a', coverMediaId: 'asset-a', title: 'mutable working title',
  contentText: 'private article body', ...overrides,
})
const version = (overrides = {}) => ({
  id: 'version-a', articleId: 'article-a', contentJson: { private: 'version body' }, ...overrides,
})
const evidence = (overrides = {}) => ({
  assetId: 'asset-a', context: 'COVER', altText: 'Server alt', caption: 'Server caption',
  path: '/private/media/object', url: '/internal/media', receipt: { digest: 'secret' },
  ...overrides,
})
const request = (overrides = {}) => ({
  article: article(), version: version(), evidence: evidence(), ...overrides,
})
const failure = error => ({ ok: false, error })

test('M0-01: valid persisted Article and same-Article version produce one typed COVER edge', () => {
  const result = plan(request())
  assert.deepEqual(result, { ok: true, data: { edges: [{
    articleId: 'article-a', versionId: 'version-a', assetId: 'asset-a', context: 'COVER',
    altTextAtCapture: 'Server alt', captionAtCapture: 'Server caption',
  }] } })
  assert.equal(Object.isFrozen(result.data), true)
  assert.equal(Object.isFrozen(result.data.edges), true)
  assert.equal(Object.isFrozen(result.data.edges[0]), true)
})

test('M0-01: identity and context mismatches fail closed', () => {
  assert.deepEqual(plan(request({ version: version({ articleId: 'article-other' }) })), failure('VERSION_MISMATCH'))
  assert.deepEqual(plan(request({ evidence: evidence({ assetId: 'asset-other' }) })), failure('MEDIA_EVIDENCE_INVALID'))
  assert.deepEqual(plan(request({ evidence: evidence({ context: 'INLINE' }) })), failure('UNSUPPORTED_MEDIA_CONTEXT'))
  assert.deepEqual(plan(request({ evidence: evidence({ context: null }) })), failure('UNSUPPORTED_MEDIA_CONTEXT'))
})

test('M0-02: explicit no-cover returns an empty plan only with a valid matching version', () => {
  assert.deepEqual(plan(request({ article: article({ coverMediaId: null }), evidence: null })),
    { ok: true, data: { edges: [] } })
  assert.deepEqual(plan({ article: article({ coverMediaId: null }), version: version() }),
    { ok: true, data: { edges: [] } })
  assert.deepEqual(plan(request({ article: article({ coverMediaId: null }) })),
    failure('MEDIA_EVIDENCE_INVALID'))
  assert.deepEqual(plan({ article: article({ coverMediaId: null }), version: version({ articleId: 'other' }) }),
    failure('VERSION_MISMATCH'))
})

test('M0-02: missing cover field is not mistaken for explicit no-cover', () => {
  const missingCover = article()
  delete missingCover.coverMediaId
  assert.deepEqual(plan({ article: missingCover, version: version() }), failure('INVALID_CAPTURE_INPUT'))
  assert.deepEqual(plan(request({ article: article({ coverMediaId: undefined }) })),
    failure('INVALID_CAPTURE_INPUT'))
  assert.deepEqual(plan(request({ evidence: undefined })), failure('MEDIA_EVIDENCE_REQUIRED'))
  assert.deepEqual(plan(request({ evidence: null })), failure('MEDIA_EVIDENCE_REQUIRED'))
})

test('M0-03: metadata is captured only from the supplied evidence, preserving string and null', () => {
  const supplied = request({
    article: article({ altText: 'browser alternative', caption: 'working-copy caption' }),
    evidence: evidence({ altText: null, caption: ' Server caption ' }),
    form: { altText: 'unpersisted form value', caption: 'unpersisted form caption' },
  })
  assert.deepEqual(plan(supplied).data.edges[0], {
    articleId: 'article-a', versionId: 'version-a', assetId: 'asset-a', context: 'COVER',
    altTextAtCapture: null, captionAtCapture: ' Server caption ',
  })
  assert.deepEqual(plan(request({ evidence: evidence({ altText: ' Server alt ', caption: null }) })).data.edges[0], {
    articleId: 'article-a', versionId: 'version-a', assetId: 'asset-a', context: 'COVER',
    altTextAtCapture: ' Server alt ', captionAtCapture: null,
  })
})

test('M0-04: missing or malformed required identities and metadata return safe errors', () => {
  for (const supplied of [
    null, {}, request({ article: article({ id: '' }) }),
    request({ article: article({ coverMediaId: '../unsafe' }) }),
    request({ version: version({ id: undefined }) }),
    request({ version: version({ articleId: '../unsafe' }) }),
    request({ version: null }),
  ]) assert.deepEqual(plan(supplied), failure('INVALID_CAPTURE_INPUT'))
  for (const supplied of [
    request({ evidence: evidence({ assetId: '../unsafe' }) }),
    request({ evidence: evidence({ altText: undefined }) }),
    request({ evidence: evidence({ caption: 12 }) }),
    request({ evidence: evidence({ altText: { text: 'wrong' } }) }),
    request({ evidence: evidence({ altText: '' }) }),
    request({ evidence: evidence({ caption: '   ' }) }),
    request({ evidence: new Date() }),
    request({ evidence: [] }),
  ]) assert.deepEqual(plan(supplied), failure('MEDIA_EVIDENCE_INVALID'))
  const missingCaption = evidence()
  delete missingCaption.caption
  assert.deepEqual(plan(request({ evidence: missingCaption })), failure('MEDIA_EVIDENCE_INVALID'))
})

test('M0-04: hostile getters and proxies are never surfaced or serialized', () => {
  let calls = 0
  const hostileArticle = article()
  Object.defineProperty(hostileArticle, 'coverMediaId', { enumerable: true, get() {
    calls++
    throw new Error('private article body')
  } })
  assert.deepEqual(plan(request({ article: hostileArticle })), failure('INVALID_CAPTURE_INPUT'))
  const hostileEvidence = evidence()
  Object.defineProperty(hostileEvidence, 'altText', { enumerable: true, get() {
    calls++
    throw new Error('storage secret')
  } })
  assert.deepEqual(plan(request({ evidence: hostileEvidence })), failure('MEDIA_EVIDENCE_INVALID'))
  const proxy = new Proxy(evidence(), { getPrototypeOf() { throw new Error('raw filesystem path') } })
  const proxyResult = plan(request({ evidence: proxy }))
  assert.equal(proxyResult.ok, false)
  assert.ok(['INVALID_CAPTURE_INPUT', 'MEDIA_EVIDENCE_INVALID'].includes(proxyResult.error))
  assert.equal(JSON.stringify(proxyResult).includes('filesystem'), false)
  const thrownProxy = new Proxy({}, { getPrototypeOf() { throw new Error('private path') } })
  const proxyThrowingProxy = new Proxy(evidence(), {
    getPrototypeOf() { throw thrownProxy },
  })
  assert.deepEqual(plan(request({ evidence: proxyThrowingProxy })), failure('INVALID_CAPTURE_INPUT'))
  assert.equal(calls, 0)
})

test('M0-04: success and failure DTOs exclude body, private, URL, path and receipt data', () => {
  const success = plan(request())
  assert.deepEqual(Object.keys(success), ['ok', 'data'])
  assert.deepEqual(Object.keys(success.data), ['edges'])
  assert.deepEqual(Object.keys(success.data.edges[0]), [
    'articleId', 'versionId', 'assetId', 'context', 'altTextAtCapture', 'captionAtCapture',
  ])
  for (const privateValue of ['private article body', 'version body', '/private/media/object',
    '/internal/media', 'secret']) assert.equal(JSON.stringify(success).includes(privateValue), false)
  const denied = plan(request({ evidence: evidence({ assetId: 'asset-other' }) }))
  assert.deepEqual(Object.keys(denied), ['ok', 'error'])
  assert.equal(JSON.stringify(denied).includes('asset-other'), false)
})

test('M0-05: frozen inputs are unchanged and repeated calls are deterministic', () => {
  const supplied = Object.freeze({
    article: Object.freeze(article()), version: Object.freeze(version()),
    evidence: Object.freeze(evidence()),
  })
  const before = structuredClone(supplied)
  const first = plan(supplied)
  assert.deepEqual(first, plan(supplied))
  assert.deepEqual(supplied, before)
  assert.equal(Object.isFrozen(first.data.edges[0]), true)
  const mutable = request()
  const projected = plan(mutable)
  mutable.evidence.altText = 'later mutation'
  assert.equal(projected.data.edges[0].altTextAtCapture, 'Server alt')
})

test('M0-06: the pure module has no DB, FS, network, writer or Product value imports', () => {
  const source = readFileSync(new URL('../src/features/cms/article-version-media-capture-policy.ts', import.meta.url), 'utf8')
  assert.deepEqual([...source.matchAll(/^import\s+.*$/gmu)].map(match => match[0]), [
    'import type {',
  ])
  assert.doesNotMatch(source, /\b(?:fetch|prisma|\.\$transaction|Math\.random|Date\.now|readFileSync|writeFileSync)\s*\(/u)
  assert.doesNotMatch(source, /(?:media-actions|media-store|node:fs|node:net|@\/lib\/prisma)/u)
})
