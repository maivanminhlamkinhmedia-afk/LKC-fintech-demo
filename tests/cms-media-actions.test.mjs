import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { registerHooks } from 'node:module'

const inheritedNextAuthUrl = process.env.NEXTAUTH_URL
const date = new Date('2099-09-30T01:02:03.456Z')
const mediaId = 'a'.repeat(32), key = `${'b'.repeat(32)}.png`, articleId = 'draft-fixture'
const actor = { id: 'fixture-creator', role: 'CREATOR', status: 'ACTIVE' }
const baseMedia = () => ({ id: mediaId, filename: key, url: `/api/cms/media/${mediaId}/content`,
  mimeType: 'image/png', sizeBytes: 70, width: 1, height: 1, altText: 'Ảnh cũ', caption: null,
  originalFilename: 'synthetic.png', uploadedById: actor.id, createdAt: new Date(date), updatedAt: new Date(date) })
const baseArticle = () => ({ id: articleId, title: 'Bài mẫu', authorId: actor.id, status: 'DRAFT',
  updatedAt: new Date(date), editorSchemaVersion: 1, contentJson: { type: 'doc', content: [{ type: 'paragraph' }] }, coverMediaId: null })
let state, tail = Promise.resolve()
const clone = value => structuredClone(value)
function scenario(changes = {}) { tail = Promise.resolve(); state = { session: { user: clone(actor) }, fresh: clone(actor), media: baseMedia(), article: baseArticle(), calls: [], writes: [], inTransaction: false, used: 0, versionUsed: 0, ...changes } }
const log = (name, args) => state.calls.push({ name, args: clone(args) })
function rowMatches(row, where) {
  if (!where) return true
  if (where.AND) return where.AND.every(part => rowMatches(row, part))
  return Object.entries(where).every(([name, value]) => value instanceof Date ? row[name]?.getTime() === value.getTime()
    : value && typeof value === 'object' ? true : row[name] === value)
}
const tx = {
  user: { async findUnique(args) { log('actor', args); return clone(state.fresh) } },
  mediaAsset: {
    async findFirst(args) { log('mediaRead', args); return rowMatches(state.media, args.where) ? clone(state.media) : null },
    async findUnique(args) { log('mediaUnique', args); return state.media?.id === args.where.id ? clone(state.media) : null },
    async updateMany(args) { log('mediaUpdate', args); if (!rowMatches(state.media, args.where)) return { count: 0 }; Object.assign(state.media, clone(args.data)); state.writes.push('media'); return { count: 1 } },
    async deleteMany(args) { log('mediaDelete', args); if (!rowMatches(state.media, args.where)) return { count: 0 }; state.media = null; state.writes.push('media-delete'); return { count: 1 } },
    async count(args) { log('mediaCount', args); return state.media ? 1 : 0 },
    async findMany(args) { log('mediaList', args); return state.media ? [clone(state.media)] : [] },
  },
  article: {
    async findFirst(args) { log('articleRead', args); return rowMatches(state.article, args.where) ? clone(state.article) : null },
    async updateMany(args) { log('articleUpdate', args); if (!rowMatches(state.article, args.where)) return { count: 0 }; Object.assign(state.article, clone(args.data)); state.writes.push('article'); return { count: 1 } },
    async count(args) { log('coverCount', args); return state.used },
  },
  articleVersionMedia: {
    async count(args) {
      log('versionCount', args)
      if (state.versionCountError) throw new Error('synthetic version-reference query failure')
      return state.versionUsed
    },
  },
  async $queryRaw() { log('rowLock', {}); return state.media ? [{ id: state.media.id }] : [] },
}
const adapter = {
  getServerSession: async () => clone(state.session), authOptions: {},
  prisma: { async $transaction(callback, options) {
    log('transaction', options); assert.equal(options.isolationLevel, 'Serializable')
    const previous = tail; let release
    tail = new Promise(resolve => { release = resolve }); await previous
    const before = clone({ media: state.media, article: state.article })
    state.inTransaction = true
    try { return await callback(tx) }
    catch (error) { state.media = before.media; state.article = before.article; throw error }
    finally { state.inTransaction = false; release() }
  } },
  revalidatePath(path) { assert.equal(state.inTransaction, false); log('revalidate', { path }) },
  root: { path: 'synthetic', identity: 'c'.repeat(32) },
  async openMediaRoot() { log('openRoot', {}); return this.root },
  async withMediaLock(_root, kind, id, run) { log('fsLock', { kind, id }); return run() },
  async receiptForAsset(_root, id, filename) { log('receipt', { id, filename }); return { digest: 'd'.repeat(64), size: 70 } },
  async createMediaOperation(_root, journal) {
    log('journalCreate', { kind: journal.kind, uploadedById: journal.uploadedById })
    if (state.writeDenied) throw Object.assign(new Error('synthetic permission denial'), { code: 'EACCES' })
  },
  async advanceMediaOperation(_root, journal) { log('journalStage', { stage: journal.stage }) },
  async removeCanonicalFile() { log('unlink', {}); if (state.unlinkDenied) throw Object.assign(new Error('synthetic unlink failure'), { code: 'EACCES' }) },
  async countPendingMediaIntents() { return 0 },
}
globalThis[Symbol.for('cms-media-test')] = adapter
const data = code => `data:text/javascript,${encodeURIComponent(`const a=globalThis[Symbol.for('cms-media-test')];${code}`)}`
const root = new URL('../src/', import.meta.url)
const replacements = new Map([
  ['next-auth', data('export const getServerSession=a.getServerSession;')],
  ['@/lib/auth', data('export const authOptions=a.authOptions;')],
  ['@/lib/prisma', data('export const prisma=a.prisma;')],
  ['next/cache', data('export const revalidatePath=a.revalidatePath;')],
  ['server-only', 'data:text/javascript,export {};'],
  ['./media-storage', data('export const openMediaRoot=(...x)=>a.openMediaRoot(...x);export const withMediaLock=(...x)=>a.withMediaLock(...x);export const receiptForAsset=(...x)=>a.receiptForAsset(...x);export const createMediaOperation=(...x)=>a.createMediaOperation(...x);export const advanceMediaOperation=(...x)=>a.advanceMediaOperation(...x);export const removeCanonicalFile=(...x)=>a.removeCanonicalFile(...x);export const countPendingMediaIntents=(...x)=>a.countPendingMediaIntents(...x);')],
])
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (replacements.has(specifier)) return next(replacements.get(specifier), context)
  if (specifier.startsWith('@/')) return next(new URL(`${specifier.slice(2)}.ts`, root).href, context)
  if (context.parentURL?.startsWith(root.href) && specifier.startsWith('./') && !/\.(ts|cjs)$/u.test(specifier)) return next(new URL(`${specifier}.ts`, context.parentURL).href, context)
  return next(specifier, context)
} })
let actions, queries, http
try { actions = await import('../src/features/cms/media-actions.ts'); queries = await import('../src/features/cms/media-query.ts');
  http = await import('../src/features/cms/media-http.ts') }
finally { hooks.deregister() }
after(() => { delete globalThis[Symbol.for('cms-media-test')] })
const failure = (result, code) => { assert.equal(result.ok, false); assert.equal(result.error.code, code) }

test('fresh actor gates metadata before asset read; own scope excludes foreign', async () => {
  scenario({ fresh: { ...actor, status: 'SUSPENDED' } })
  failure(await actions.updateMediaMetadata(mediaId, { altText: 'Mới', caption: null, expectedUpdatedAt: date.toISOString() }), 'FORBIDDEN')
  assert.equal(state.calls.some(call => call.name === 'mediaRead'), false)
  scenario({ media: { ...baseMedia(), uploadedById: 'foreign' } })
  failure(await actions.updateMediaMetadata(mediaId, { altText: 'Mới', caption: null, expectedUpdatedAt: date.toISOString() }), 'MEDIA_NOT_AVAILABLE')
  assert.deepEqual(state.writes, [])
})
test('fresh role mismatch and changed uploader both deny a preloaded metadata mutation', async () => {
  scenario({ fresh: { ...actor, role: 'CLIENT' } })
  failure(await actions.updateMediaMetadata(mediaId, { altText: 'Denied', caption: null, expectedUpdatedAt: date.toISOString() }), 'FORBIDDEN')
  assert.equal(state.calls.some(call => call.name === 'mediaRead'), false)
  assert.deepEqual(state.writes, [])
  scenario()
  const preloaded = clone(state.media)
  state.media.uploadedById = 'fixture-other'
  failure(await actions.updateMediaMetadata(preloaded.id, { altText: 'Denied', caption: null, expectedUpdatedAt: preloaded.updatedAt.toISOString() }), 'MEDIA_NOT_AVAILABLE')
  assert.deepEqual(state.writes, [])
  assert.equal(state.media.altText, preloaded.altText)
})
test('metadata CAS and no-op retain binary, uploader and Article token; persisted +1ms', async () => {
  scenario()
  const initial = clone(state.media), articleToken = state.article.updatedAt.getTime()
  const saved = await actions.updateMediaMetadata(mediaId, { altText: 'Ảnh mới', caption: 'Mô tả', expectedUpdatedAt: date.toISOString() })
  assert.equal(saved.ok, true)
  assert.equal(saved.data.updatedAt, '2099-09-30T01:02:03.457Z')
  for (const field of ['id', 'filename', 'url', 'mimeType', 'sizeBytes', 'width', 'height', 'uploadedById', 'createdAt']) assert.deepEqual(state.media[field], initial[field])
  assert.equal(state.article.updatedAt.getTime(), articleToken)
  assert.deepEqual(state.writes, ['media'])
  failure(await actions.updateMediaMetadata(mediaId, { altText: 'Stale', caption: null, expectedUpdatedAt: date.toISOString() }), 'MEDIA_CONFLICT')
  const noOp = await actions.updateMediaMetadata(mediaId, { altText: 'Ảnh mới', caption: 'Mô tả', expectedUpdatedAt: saved.data.updatedAt })
  assert.equal(noOp.ok, true); assert.deepEqual(state.writes, ['media'])
})
test('cover uses shared Article CAS, locks asset first, preserves fields and rejects stale token', async () => {
  scenario()
  const before = clone(state.article)
  const result = await actions.saveArticleCover(articleId, { mediaId, expectedUpdatedAt: date.toISOString(), expectedMediaUpdatedAt: date.toISOString() })
  assert.equal(result.ok, true, result.error?.code)
  assert.equal(result.data.updatedAt, '2099-09-30T01:02:03.457Z')
  assert.equal(state.article.coverMediaId, mediaId)
  assert.deepEqual(state.article.contentJson, before.contentJson)
  for (const field of ['title', 'authorId', 'status', 'editorSchemaVersion']) assert.deepEqual(state.article[field], before[field])
  assert.ok(state.calls.findIndex(call => call.name === 'rowLock') < state.calls.findIndex(call => call.name === 'articleUpdate'))
  failure(await actions.saveArticleCover(articleId, { mediaId: null, expectedUpdatedAt: date.toISOString(), expectedMediaUpdatedAt: null }), 'EDIT_CONFLICT')
})
test('delete-used rejects a current cover reference after the asset row lock', async () => {
  scenario({ used: 1 })
  failure(await actions.deleteUnusedMedia(mediaId, { expectedUpdatedAt: date.toISOString() }), 'MEDIA_IN_USE')
  assert.equal(state.media.id, mediaId)
  assert.equal(state.calls.some(call => call.name === 'mediaDelete' || call.name === 'unlink'), false)
  assert.ok(state.calls.findIndex(call => call.name === 'rowLock') < state.calls.findIndex(call => call.name === 'coverCount'))
  assert.deepEqual(state.calls.find(call => call.name === 'coverCount').args, { where: { coverMediaId: mediaId } })
  assert.equal(state.calls.some(call => call.name === 'versionCount'), false)
  assert.equal(state.calls.some(call => call.name === 'journalStage' && call.args.stage === 'rejected'), true)
  assert.deepEqual(state.writes, [])
})

test('delete-used rejects a historical version reference after the current cover is cleared', async () => {
  scenario({ used: 0, versionUsed: 1 })
  failure(await actions.deleteUnusedMedia(mediaId, { expectedUpdatedAt: date.toISOString() }), 'MEDIA_IN_USE')
  assert.equal(state.media.id, mediaId)
  assert.deepEqual(state.writes, [])
  assert.equal(state.calls.some(call => call.name === 'mediaDelete' || call.name === 'unlink'), false)
  assert.ok(state.calls.findIndex(call => call.name === 'rowLock') < state.calls.findIndex(call => call.name === 'versionCount'))
  assert.deepEqual(state.calls.find(call => call.name === 'versionCount').args, { where: { assetId: mediaId } })
})

test('delete-used rejects an asset referenced by both current Article and historical version', async () => {
  scenario({ used: 1, versionUsed: 1 })
  failure(await actions.deleteUnusedMedia(mediaId, { expectedUpdatedAt: date.toISOString() }), 'MEDIA_IN_USE')
  assert.equal(state.media.id, mediaId)
  assert.deepEqual(state.writes, [])
  assert.equal(state.calls.some(call => call.name === 'mediaDelete' || call.name === 'unlink'), false)
  assert.equal(state.calls.filter(call => call.name === 'coverCount').length, 1)
  assert.equal(state.calls.filter(call => call.name === 'versionCount').length, 0)
})

test('known current cover reference returns MEDIA_IN_USE without relying on a later version query', async () => {
  scenario({ used: 1, versionCountError: true })
  failure(await actions.deleteUnusedMedia(mediaId, { expectedUpdatedAt: date.toISOString() }), 'MEDIA_IN_USE')
  assert.equal(state.calls.some(call => call.name === 'versionCount' || call.name === 'mediaDelete' || call.name === 'unlink'), false)
  assert.deepEqual(state.writes, [])
})

test('delete-used with no current or historical reference completes the existing delete journal', async () => {
  scenario({ used: 0, versionUsed: 0 })
  const result = await actions.deleteUnusedMedia(mediaId, { expectedUpdatedAt: date.toISOString() })
  assert.equal(result.ok, true, result.error?.code)
  assert.deepEqual(result.data, { id: mediaId, storagePending: false })
  assert.equal(state.media, null)
  assert.deepEqual(state.writes, ['media-delete'])
  assert.equal(state.calls.filter(call => call.name === 'unlink').length, 1)
  assert.equal(state.calls.some(call => call.name === 'journalStage' && call.args.stage === 'complete'), true)
  assert.ok(state.calls.findIndex(call => call.name === 'versionCount') < state.calls.findIndex(call => call.name === 'mediaDelete'))
})

test('version-reference query failure fails closed before DB delete or unlink', async () => {
  scenario({ used: 0, versionUsed: 0, versionCountError: true })
  failure(await actions.deleteUnusedMedia(mediaId, { expectedUpdatedAt: date.toISOString() }), 'UNKNOWN_OUTCOME')
  assert.equal(state.media.id, mediaId)
  assert.deepEqual(state.writes, [])
  assert.equal(state.calls.some(call => call.name === 'mediaDelete' || call.name === 'unlink'), false)
  assert.ok(state.calls.findIndex(call => call.name === 'rowLock') < state.calls.findIndex(call => call.name === 'versionCount'))
  assert.equal(state.calls.some(call => call.name === 'journalStage' && call.args.stage === 'db-deleted'), false)
  assert.deepEqual(state.calls.filter(call => call.name === 'journalStage').map(call => call.args.stage), ['dispatched'])
})
test('delete committed in DB with failed unlink reports storagePending without restoring row', async () => {
  scenario({ unlinkDenied: true })
  const result = await actions.deleteUnusedMedia(mediaId, { expectedUpdatedAt: date.toISOString() })
  assert.equal(result.ok, true, result.error?.code)
  assert.deepEqual(result.data, { id: mediaId, storagePending: true })
  assert.match(result.warning, /chờ dọn/u)
  assert.equal(state.media, null)
  assert.deepEqual(state.writes, ['media-delete'])
  assert.equal(state.calls.filter(call => call.name === 'unlink').length, 1)
  assert.equal(state.calls.some(call => call.name === 'journalStage' && call.args.stage === 'complete'), false)
})
test('library query orders deterministically and scopes own uploader after fresh actor', async () => {
  scenario()
  const result = await queries.getMediaLibrary(actor, { q: 'Ảnh', page: 2 })
  assert.equal(result.ok, true)
  const list = state.calls.find(call => call.name === 'mediaList').args
  assert.deepEqual(list.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }])
  assert.equal(list.skip, 20); assert.equal(list.take, 20)
  assert.equal(list.where.AND[0].uploadedById, actor.id)
})
test('existing private root with denied journal write returns safe error without DB writes or fallback', async () => {
  scenario({ writeDenied: true })
  const result = await actions.beginMediaUpload({ originalFilename: 'fixture.png', altText: 'Fixture', caption: null, mimeType: 'image/png' })
  failure(result, 'INTERNAL_ERROR')
  assert.deepEqual(state.writes, [])
  assert.equal(state.calls.filter(call => call.name === 'openRoot').length, 1)
  assert.equal(state.calls.filter(call => call.name === 'journalCreate').length, 1)
  assert.equal(state.calls.some(call => call.name === 'mediaDelete' || call.name === 'mediaUpdate' || call.name === 'articleUpdate'), false)
})
test('raw upload checks configured origin rather than Host and limits actual stream bytes', { concurrency: false }, async () => {
  const priorUrl = process.env.NEXTAUTH_URL
  process.env.NEXTAUTH_URL = 'http://127.0.0.1:3001'
  try {
  const valid = new Request('http://attacker.invalid/api/cms/media/uploads/id', { method: 'POST',
    headers: { origin: 'http://127.0.0.1:3001', host: 'attacker.invalid', 'content-length': '3' }, body: Buffer.from('abc') })
  assert.doesNotThrow(() => http.requireUploadOrigin(valid))
  assert.equal((await http.boundedImageBody(valid)).toString(), 'abc')
  for (const origin of [null, 'null', 'http://attacker.invalid']) {
    const request = new Request('http://127.0.0.1:3001/api/cms/media/uploads/id', { method: 'POST',
      headers: origin ? { origin } : {}, body: Buffer.from('abc') })
    assert.throws(() => http.requireUploadOrigin(request), error => error.code === 'FORBIDDEN')
  }
  const oversized = new Request('http://127.0.0.1:3001/', { method: 'POST',
    body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5 * 1024 * 1024 + 1)) } }),
    duplex: 'half' })
  await assert.rejects(() => http.boundedImageBody(oversized), error => error.code === 'FILE_TOO_LARGE')
  } finally {
    if (priorUrl === undefined) delete process.env.NEXTAUTH_URL
    else process.env.NEXTAUTH_URL = priorUrl
  }
})
test('raw upload origin test restores inherited or absent configuration', { concurrency: false }, () => {
  assert.equal(process.env.NEXTAUTH_URL, inheritedNextAuthUrl)
})
test('same-token cover race has one Article CAS winner and no second write', async () => {
  scenario()
  const input = { mediaId, expectedUpdatedAt: date.toISOString(), expectedMediaUpdatedAt: date.toISOString() }
  const outcomes = await Promise.all([actions.saveArticleCover(articleId, input), actions.saveArticleCover(articleId, input)])
  assert.equal(outcomes.filter(result => result.ok).length, 1)
  assert.equal(outcomes.filter(result => !result.ok && result.error.code === 'EDIT_CONFLICT').length, 1)
  assert.deepEqual(state.writes, ['article'])
  assert.equal(state.article.coverMediaId, mediaId)
})
test('legacy unmanaged media has no content URL or binary mutation; current cover may stay or clear', async () => {
  const legacy = { ...baseMedia(), filename: 'old-photo.png', url: 'https://legacy.invalid/image.png' }
  scenario({ media: legacy, article: { ...baseArticle(), coverMediaId: mediaId } })
  const list = await queries.getMediaLibrary(actor, { q: '', page: 1 })
  assert.equal(list.ok, true)
  assert.equal(list.data.items[0].managed, false)
  assert.equal(list.data.items[0].contentUrl, null)
  failure(await actions.updateMediaMetadata(mediaId, { altText: 'Changed', caption: null, expectedUpdatedAt: date.toISOString() }), 'MEDIA_NOT_AVAILABLE')
  const retained = await actions.saveArticleCover(articleId, { mediaId, expectedUpdatedAt: date.toISOString(), expectedMediaUpdatedAt: date.toISOString() })
  assert.equal(retained.ok, true)
  assert.equal(state.article.updatedAt.getTime(), date.getTime())
  const cleared = await actions.saveArticleCover(articleId, { mediaId: null, expectedUpdatedAt: date.toISOString(), expectedMediaUpdatedAt: null })
  assert.equal(cleared.ok, true)
  assert.equal(state.article.coverMediaId, null)
})
