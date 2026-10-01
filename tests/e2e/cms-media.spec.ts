import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { randomBytes, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import jpeg from 'jpeg-js'
import { connectStaging, demand, STAGING_BASE_URL } from '../../scripts/cms-e2e/guard.mjs'
import { loadManifest, saveManifest, discoverFixtureGraph, fixtureArticle, alterFixture,
  createLegacyMediaFixture, attachLegacyCoverFixture, attachFixtureCoverMatrix, clearFixtureCoverMatrix,
  reserveFixtureMediaUploaderTransfer, transferFixtureMediaUploader } from '../../scripts/cms-e2e/fixtures.mjs'
import { mediaRootPath, reserveMediaOperation, reserveMediaDelete, inspectMediaGraph, seedManagedMediaBatch } from '../../scripts/cms-e2e/media-fixtures.mjs'

type Actor = 'creator' | 'other' | 'admin' | 'super' | 'analyst' | 'client'
type Intent = { operationId: string; assetId: string; actorId: string; key: string; mimeType: string; originalFilename: string }
type Asset = { id: string; uploadedById: string; filename: string; originalFilename: string; url: string; mimeType: string; sizeBytes: number;
  width: number | null; height: number | null; altText: string | null; caption: string | null; updatedAt: Date }
type Manifest = { version: number; runId: string; namespace: string; mediaRootIdentity: string; mediaIntents: Intent[];
  mediaDeleteIntents: { assetId: string; actorId: string; key: string }[]; mediaAssets: { id: string; uploadedById: string; operationId: string; key: string; digest: string; size: number }[];
  legacyMediaAssets: { id: string; uploadedById: string; filename: string; url: string; sizeBytes: number; mimeType: string }[];
  users: { key: Actor; id: string; email: string }[]; articles: { id: string; key: string; authorId: string }[];
  catalogs: { kind: string; id: string; seedKey: string | null; identity: { slug?: string; canonicalKey?: string } }[] }
let manifest: Manifest, db: Awaited<ReturnType<typeof connectStaging>>
let credentials: Record<Actor, { email: string; password: string }>
const contexts: BrowserContext[] = []
const persist = (value: unknown) => saveManifest(process.env.CMS_E2E_MANIFEST, value)
const recover = () => discoverFixtureGraph(db, process.env, manifest, persist)
const actorId = (actor: Actor) => manifest.users.find(user => user.key === actor)!.id
const draftId = () => manifest.articles.find(row => row.key === 'DRAFT')!.id
const png = () => { const image = new PNG({ width: 2, height: 1 }); image.data = Buffer.from([255, 0, 0, 255, 0, 255, 0, 128]); return PNG.sync.write(image) }
const jpg = () => jpeg.encode({ width: 2, height: 1, data: Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]) }, 90).data
const failed = (page: Page, code: string) => page.locator(`[data-error-code="${code}"]`)
const uploadErrorCodes = new Set(['VALIDATION_ERROR', 'UNSUPPORTED_MEDIA', 'FILE_TOO_LARGE', 'IMAGE_LIMIT_EXCEEDED',
  'MEDIA_BUSY', 'MEDIA_STORAGE_UNAVAILABLE', 'MEDIA_NOT_AVAILABLE', 'FORBIDDEN', 'NOT_FOUND', 'UNKNOWN_OUTCOME', 'INTERNAL_ERROR'])
async function login(browser: Browser, actor: Actor = 'creator') {
  const context = await browser.newContext({ baseURL: STAGING_BASE_URL }); contexts.push(context)
  const page = await context.newPage()
  try {
    await page.goto('/dang-nhap'); await page.getByLabel('Email', { exact: true }).fill(credentials[actor].email)
    await page.getByLabel('Mật khẩu', { exact: true }).fill(credentials[actor].password)
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard$/)
  } catch { throw new Error(`Fixture login failed for ${actor}; details suppressed`) }
  return { page, context }
}
async function registerUpload(page: Page, actor: Actor, name: string, mimeType: 'image/png' | 'image/jpeg', dropAck = false,
  observe?: (phase: 'INTENT_RESERVED' | 'POST_FORWARDED') => void) {
  const captured: Intent[] = []
  const handler = async (route: import('@playwright/test').Route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    const pathname = new URL(route.request().url()).pathname
    const operationId = pathname.split('/').at(-1)!
    const raw = JSON.parse(await readFile(join(mediaRootPath(manifest), 'operations', `${operationId}.json`), 'utf8'))
    demand(raw.kind === 'upload' && raw.stage === 'intent' && raw.actorId === actorId(actor)
      && raw.metadata.originalFilename === name && raw.metadata.mimeType === mimeType, 'MEDIA_UPLOAD_INTENT_MISMATCH')
    const intent = { operationId, actorId: raw.actorId, assetId: raw.assetId, key: raw.key,
      mimeType: raw.metadata.mimeType, originalFilename: raw.metadata.originalFilename }
    await reserveMediaOperation(manifest, intent, persist)
    captured.push(intent)
    observe?.('INTENT_RESERVED')
    if (dropAck) {
      const response = await route.fetch()
      demand(response.ok(), 'MEDIA_LOST_ACK_SERVER_WRITE_FAILED')
      await route.abort('failed')
    } else { await route.continue(); observe?.('POST_FORWARDED') }
  }
  await page.route('**/api/cms/media/uploads/*', handler)
  return { captured, dispose: () => page.unroute('**/api/cms/media/uploads/*', handler) }
}
async function upload(page: Page, actor: Actor, name: string, mimeType: 'image/png' | 'image/jpeg', bytes: Buffer) {
  const annotations = test.info().annotations, origin = performance.now()
  let intentCount = 0
  const note = (phase: string, status: 'started' | 'passed' | 'failed', durationMs = 0, httpStatus = 0, errorCode: string | null = null) => {
    const entry = { type: 'cms-media-observation', description: JSON.stringify({ phase, status,
      elapsedMs: Math.round(performance.now() - origin), durationMs, httpStatus, errorCode, intentCount }) }
    annotations.push(entry)
    return entry
  }
  const observed = async <T,>(phase: string, run: () => Promise<T>): Promise<T> => {
    const start = performance.now(); note(phase, 'started')
    try { const result = await run(); note(phase, 'passed', Math.round(performance.now() - start)); return result }
    catch (error) { note(phase, 'failed', Math.round(performance.now() - start)); throw error }
  }
  await observed('PAGE', async () => {
    await page.goto('/creator/media')
    await expect(page.getByRole('heading', { name: 'Thư viện ảnh' })).toBeVisible()
  })
  const interception = await registerUpload(page, actor, name, mimeType, false, phase => { intentCount = 1; note(phase, 'passed') })
  const responseObserver = (response: import('@playwright/test').Response) => {
    if (response.request().method() !== 'POST' || !/^\/api\/cms\/media\/uploads\/[a-f0-9]{32}$/u.test(new URL(response.url()).pathname)) return
    const httpStatus = response.status()
    const observation = note('POST_RESPONSE', httpStatus >= 200 && httpStatus < 300 ? 'passed' : 'failed', 0, httpStatus)
    if (httpStatus >= 400) void response.json().then(data => {
      const code = data?.error?.code
      if (typeof code === 'string' && uploadErrorCodes.has(code)) {
        const safe = JSON.parse(observation.description)
        observation.description = JSON.stringify({ ...safe, errorCode: code })
      }
    }).catch(() => {}) // Response observation never changes request handling or the assertion.
  }
  const failureObserver = (request: import('@playwright/test').Request) => {
    if (request.method() === 'POST' && /^\/api\/cms\/media\/uploads\/[a-f0-9]{32}$/u.test(new URL(request.url()).pathname)) {
      note('POST_FAILURE', 'failed')
    }
  }
  page.on('response', responseObserver)
  page.on('requestfailed', failureObserver)
  try {
    await observed('INPUT', async () => {
      await page.getByLabel('Tệp PNG/JPEG').setInputFiles({ name, mimeType, buffer: bytes })
      await expect(page.getByLabel('Tên tệp')).toHaveValue(name)
      await page.getByLabel('Văn bản thay thế').fill(`Ảnh ${name}`)
    })
    await observed('SUBMIT', () => page.getByRole('button', { name: 'Tải ảnh lên', exact: true }).click())
    await observed('SUCCESS_UI', async () => {
      try { await expect(page.getByRole('status').filter({ hasText: 'Ảnh đã được lưu.' })).toBeVisible() }
      catch (error) {
        try {
          const code = await page.evaluate(() => document.querySelector('[data-error-code]')?.getAttribute('data-error-code') ?? null)
          if (code && uploadErrorCodes.has(code)) note('UI_ERROR_CODE', 'failed', 0, 0, code)
        } catch { /* Preserve the original assertion failure if the page is already closed. */ }
        throw error
      }
    })
    demand(interception.captured.length === 1, 'MEDIA_UPLOAD_OPERATION_NOT_CAPTURED')
  } finally { page.off('response', responseObserver); page.off('requestfailed', failureObserver); await interception.dispose() }
  await observed('RECOVER', recover)
  const intent = interception.captured[0]
  return observed('DB_CHECK', async () => {
    const asset = await db.mediaAsset.findUnique({ where: { id: intent.assetId } }) as Asset | null
    demand(asset && asset.uploadedById === actorId(actor) && asset.filename === intent.key && asset.originalFilename === name,
      'MEDIA_UPLOAD_ROW_IDENTITY_MISMATCH')
    return asset!
  })
}
async function cover(page: Page, articleId: string, asset: Asset) {
  await page.goto(`/creator/articles/${articleId}/media`)
  await expect(page.getByRole('heading', { name: 'Ảnh bìa bài viết' })).toBeVisible()
  await page.getByLabel('Tìm trong thư viện').fill(asset.originalFilename)
  await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
  await expect(page.locator(`input[name="cover"][data-media-id="${asset.id}"]`)).toBeVisible()
  await page.locator(`input[name="cover"][data-media-id="${asset.id}"]`).check()
  await page.getByRole('button', { name: 'Lưu ảnh bìa', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Ảnh bìa đã được lưu.' })).toBeVisible()
  await recover()
}
test.beforeAll(async () => {
  demand(process.env.CMS_E2E_RUNNING === 'YES', 'USE_GUARDED_STAGING_RUNNER')
  manifest = await loadManifest(process.env.CMS_E2E_MANIFEST) as Manifest
  demand(manifest.version === 4 && manifest.runId === process.env.CMS_E2E_RUN_ID, 'MEDIA_RUN_PROVENANCE_MISMATCH')
  credentials = JSON.parse(process.env.CMS_E2E_CREDENTIALS ?? '{}')
  db = await connectStaging(process.env)
})
test.afterEach(async () => {
  await test.step('MED_TEARDOWN_CONTEXT_CLOSE', async () => { await Promise.all(contexts.splice(0).map(context => context.close())) })
  await test.step('MED_TEARDOWN_RECOVER', async () => { if (db) await recover() })
})
test.afterAll(async () => { await test.step('MED_TEARDOWN_DISCONNECT', async () => { if (db) await db.$disconnect() }) })

test('MED-01 protected media routes and bytes enforce role and article scope', async ({ browser }) => {
  await test.step('MED_ACCESS', async () => {
    const anonymous = await browser.newContext({ baseURL: STAGING_BASE_URL }); contexts.push(anonymous)
    const page = await anonymous.newPage()
    for (const url of ['/creator/media', `/creator/articles/${draftId()}/media`]) { await page.goto(url); await expect(page).toHaveURL(/\/dang-nhap(?:\?|$)/) }
    const response = await anonymous.request.get(`/api/cms/media/${'a'.repeat(32)}/content`)
    expect(response.status()).toBe(403)
    for (const role of ['analyst', 'client'] as const) {
      const session = await login(browser, role); await session.page.goto('/creator/media'); await expect(session.page).toHaveURL(/\/dashboard$/)
    }
    const own = await login(browser); await own.page.goto(`/creator/articles/${draftId()}/media`)
    await expect(own.page.getByRole('heading', { name: 'Ảnh bìa bài viết' })).toBeVisible()
    const foreign = await login(browser, 'other'); await foreign.page.goto(`/creator/articles/${draftId()}/media`)
    await expect(foreign.page.getByRole('heading', { name: 'Ảnh bìa bài viết' })).toHaveCount(0)
  })
})
test('MED-02/05/10 PNG and JPEG upload persist canonical private bytes and protected GET HEAD', async ({ browser }) => {
  await test.step('MED_UPLOAD_CANONICAL', async () => {
    const { page, context } = await login(browser)
    for (const [name, mime, bytes] of [['synthetic-alpha.png', 'image/png', png()], ['synthetic-photo.jpg', 'image/jpeg', jpg()]] as const) {
      const marker = Buffer.from('SYNTHETIC_PRIVATE_METADATA')
      const asset = await upload(page, 'creator', name, mime, Buffer.concat([bytes, marker]))
      expect([asset.width, asset.height]).toEqual([2, 1]); expect(asset.mimeType).toBe(mime)
      const content = await context.request.get(asset.url)
      expect(content.status()).toBe(200); expect(content.headers()['content-type']).toBe(mime)
      expect(content.headers()['cache-control']).toContain('no-store')
      expect(content.headers()['x-content-type-options']).toBe('nosniff')
      const head = await context.request.head(asset.url)
      expect(head.status()).toBe(200); expect((await head.body()).length).toBe(0)
      const canonical = await readFile(join(mediaRootPath(manifest), 'objects', asset.filename))
      expect(canonical.includes(marker)).toBe(false)
      expect(createHash('sha256').update(canonical).digest('hex')).toBe(manifest.mediaAssets.find(row => row.id === asset.id)?.digest)
      expect(asset.sizeBytes).toBe(canonical.length)
      const wrongOrigin = await context.request.post(`/api/cms/media/uploads/${manifest.mediaIntents.find(row => row.assetId === asset.id)!.operationId}`,
        { data: bytes, headers: { Origin: 'https://forbidden.invalid', 'Content-Type': mime } })
      expect(wrongOrigin.status()).toBe(403)
    }
    await page.reload(); await expect(page.getByRole('list', { name: 'Danh sách ảnh' }).locator('li')).toHaveCount(2)
  })
})
test('MED-03/24 invalid files and origin leave no media row or canonical residue', async ({ browser }) => {
  await test.step('MED_VALIDATION', async () => {
    const { page, context } = await login(browser); await page.goto('/creator/media')
    const before = await db.mediaAsset.count({ where: { uploadedById: actorId('creator') } })
    const beforeObjects = ((await inspectMediaGraph(db, manifest, process.cwd(), true)) as { files: { objects: string[] } } | null)?.files.objects.length
    await page.getByLabel('Tệp PNG/JPEG').setInputFiles({ name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) })
    await page.getByLabel('Văn bản thay thế').fill('Empty')
    await page.getByRole('button', { name: 'Tải ảnh lên', exact: true }).click()
    await expect(failed(page, 'VALIDATION_ERROR')).toBeVisible()
    await page.getByLabel('Tệp PNG/JPEG').setInputFiles({ name: 'oversize.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) })
    await page.getByLabel('Văn bản thay thế').fill('Oversize')
    await page.getByRole('button', { name: 'Tải ảnh lên', exact: true }).click()
    await expect(failed(page, 'VALIDATION_ERROR')).toBeVisible()
    expect(await db.mediaAsset.count({ where: { uploadedById: actorId('creator') } })).toBe(before)
    await expect(page.getByLabel('Tên tệp')).toHaveValue('oversize.png')
    await page.getByLabel('Tệp PNG/JPEG').setInputFiles({ name: 'fake.jpg', mimeType: 'image/png', buffer: png() })
    await page.getByRole('button', { name: 'Tải ảnh lên', exact: true }).click()
    await expect(failed(page, 'VALIDATION_ERROR')).toBeVisible()
    await page.getByLabel('Tệp PNG/JPEG').setInputFiles({ name: 'unsupported.bin', mimeType: 'application/octet-stream', buffer: Buffer.from('synthetic') })
    await page.getByRole('button', { name: 'Tải ảnh lên', exact: true }).click()
    await expect(failed(page, 'VALIDATION_ERROR')).toBeVisible()
    const bad = await registerUpload(page, 'creator', 'malformed.png', 'image/png')
    try {
      await page.getByLabel('Tệp PNG/JPEG').setInputFiles({ name: 'malformed.png', mimeType: 'image/png', buffer: Buffer.from('not-png') })
      await page.getByRole('button', { name: 'Tải ảnh lên', exact: true }).click()
      await expect(failed(page, 'UNSUPPORTED_MEDIA')).toBeVisible()
    } finally { await bad.dispose() }
    demand(bad.captured.length === 1, 'MEDIA_MALFORMED_INTENT_NOT_CAPTURED')
    await recover()
    const intent = bad.captured[0]
    expect(await db.mediaAsset.count({ where: { id: intent.assetId } })).toBe(0)
    const journal = JSON.parse(await readFile(join(mediaRootPath(manifest), 'operations', `${intent.operationId}.json`), 'utf8'))
    expect(journal.stage).toBe('abandoned')
    const wrongOrigin = await context.request.post(`/api/cms/media/uploads/${intent.operationId}`,
      { data: png(), headers: { Origin: 'https://forbidden.invalid', 'Content-Type': 'image/png' } })
    expect(wrongOrigin.status()).toBe(403)
    expect(await db.mediaAsset.count({ where: { uploadedById: actorId('creator') } })).toBe(before)
    expect(((await inspectMediaGraph(db, manifest, process.cwd(), true)) as { files: { objects: string[] } } | null)?.files.objects.length).toBe(beforeObjects)
  })
})
test('MED-08/11 own library excludes foreign asset while admin can find it', async ({ browser }) => {
  await test.step('MED_SCOPE_SEARCH', async () => {
    const { asset, name } = await test.step('MED_SCOPE_CREATOR_UPLOAD', async () => {
      const creator = await login(browser)
      const name = `scope-${randomBytes(3).toString('hex')}.png`
      const asset = await upload(creator.page, 'creator', name, 'image/png', png())
      return { asset, name }
    })
    await test.step('MED_SCOPE_OTHER', async () => {
      const other = await login(browser, 'other'); await other.page.goto('/creator/media')
      await other.page.getByLabel('Tìm theo tên, alt hoặc chú thích').fill(name)
      await other.page.getByRole('button', { name: 'Tìm kiếm' }).click()
      await expect(other.page.locator(`li[data-media-id="${asset.id}"]`)).toHaveCount(0)
      expect((await other.context.request.get(asset.url)).status()).toBe(404)
    })
    await test.step('MED_SCOPE_ADMIN', async () => {
      const admin = await login(browser, 'admin'); await admin.page.goto('/creator/media')
      await admin.page.getByLabel('Tìm theo tên, alt hoặc chú thích').fill(name)
      await admin.page.getByRole('button', { name: 'Tìm kiếm' }).click()
      await expect(admin.page.locator(`li[data-media-id="${asset.id}"]`)).toBeVisible()
    })
  })
})
test('MED-08 paging keeps selected metadata while foreign scope stays hidden', async ({ browser }) => {
  await test.step('MED_PAGING_SCOPE', async () => {
    const rows = await seedManagedMediaBatch(db, manifest, actorId('creator'), 21, png(), persist)
    await recover()
    const creator = await login(browser)
    await creator.page.goto('/creator/media')
    await creator.page.getByLabel('Tìm theo tên, alt hoặc chú thích').fill('page-')
    await creator.page.getByRole('button', { name: 'Tìm kiếm' }).click()
    await expect(creator.page.getByText('Trang 1/2')).toBeVisible()
    const firstPage = await creator.page.locator('li[data-media-id]').evaluateAll(items => items.map(item => item.getAttribute('data-media-id')))
    expect(firstPage).toHaveLength(20)
    const selected = firstPage[0]!
    await creator.page.locator(`li[data-media-id="${selected}"]`).getByRole('button', { name: 'Sửa metadata' }).click()
    await expect(creator.page.getByRole('form', { name: 'Sửa metadata ảnh' })).toBeVisible()
    await creator.page.getByRole('button', { name: 'Trang sau' }).click()
    await expect(creator.page.getByText('Trang 2/2')).toBeVisible()
    const secondPage = await creator.page.locator('li[data-media-id]').evaluateAll(items => items.map(item => item.getAttribute('data-media-id')))
    expect(secondPage).toHaveLength(1)
    expect(firstPage).not.toContain(secondPage[0])
    await expect(creator.page.getByRole('form', { name: 'Sửa metadata ảnh' })).toBeVisible()
    await creator.page.getByRole('button', { name: 'Trang trước' }).click()
    await expect(creator.page.locator(`li[data-media-id="${selected}"]`)).toBeVisible()
    const other = await login(browser, 'other')
    await other.page.goto('/creator/media')
    for (const row of rows) await expect(other.page.locator(`li[data-media-id="${row.id}"]`)).toHaveCount(0)
    const admin = await login(browser, 'admin')
    await admin.page.goto('/creator/media')
    await admin.page.getByLabel('Tìm theo tên, alt hoặc chú thích').fill(rows[0].originalFilename)
    await admin.page.getByRole('button', { name: 'Tìm kiếm' }).click()
    await expect(admin.page.locator(`li[data-media-id="${rows[0].id}"]`)).toBeVisible()
  })
})
test('MED-09/19/34 metadata edit uses exact CAS and preserves immutable binary identity', async ({ browser }) => {
  await test.step('MED_METADATA_CAS', async () => {
    const first = await login(browser), second = await login(browser)
    const asset = await upload(first.page, 'creator', `metadata-${randomBytes(3).toString('hex')}.png`, 'image/png', png())
    await second.page.goto('/creator/media')
    const before = await db.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })
    await first.page.locator(`li[data-media-id="${asset.id}"]`).getByRole('button', { name: 'Sửa metadata' }).click()
    await first.page.getByRole('form', { name: 'Sửa metadata ảnh' }).getByLabel('Văn bản thay thế').fill('Alt mới tiếng Việt')
    await first.page.getByRole('button', { name: 'Lưu metadata' }).click()
    await expect(first.page.getByRole('status').filter({ hasText: 'Metadata đã được lưu.' })).toBeVisible()
    const saved = await db.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })
    expect(saved.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime())
    expect(saved.altText).toBe('Alt mới tiếng Việt')
    for (const field of ['id', 'filename', 'url', 'mimeType', 'sizeBytes', 'width', 'height', 'uploadedById', 'createdAt'] as const) expect(saved[field]).toEqual(before[field])
    await second.page.locator(`li[data-media-id="${asset.id}"]`).getByRole('button', { name: 'Sửa metadata' }).click()
    await second.page.getByRole('form', { name: 'Sửa metadata ảnh' }).getByLabel('Văn bản thay thế').fill('Alt stale')
    await second.page.getByRole('button', { name: 'Lưu metadata' }).click()
    await expect(failed(second.page, 'MEDIA_CONFLICT')).toBeVisible()
    expect((await db.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).altText).toBe('Alt mới tiếng Việt')
  })
})
test('MED-12/13 cover select and clear preserve article fields and use shared token', async ({ browser }) => {
  await test.step('MED_COVER_ROUNDTRIP', async () => {
    const { page } = await login(browser)
    const asset = await upload(page, 'creator', `cover-${randomBytes(3).toString('hex')}.png`, 'image/png', png())
    const before = await fixtureArticle(db, manifest, draftId())
    await cover(page, draftId(), asset)
    const saved = await fixtureArticle(db, manifest, draftId())
    expect(saved.coverMediaId).toBe(asset.id); expect(saved.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime())
    for (const field of ['title', 'slug', 'contentJson', 'contentText', 'authorId', 'status', 'editorSchemaVersion', 'categoryId'] as const) expect(saved[field]).toEqual(before[field])
    await page.reload(); await expect(page.getByText(asset.originalFilename, { exact: true }).first()).toBeVisible()
    await page.getByLabel('Không dùng ảnh bìa').check()
    await page.getByRole('button', { name: 'Lưu ảnh bìa', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Ảnh bìa đã được lưu.' })).toBeVisible()
    await recover(); expect((await fixtureArticle(db, manifest, draftId())).coverMediaId).toBeNull()
  })
})
test('MED-16 used cover rejects deletion without SetNull', async ({ browser }) => {
  await test.step('MED_DELETE_USED', async () => {
    const { page } = await login(browser)
    const asset = await upload(page, 'creator', `used-${randomBytes(3).toString('hex')}.png`, 'image/png', png())
    await cover(page, draftId(), asset)
    await reserveMediaDelete(manifest, asset.id, actorId('creator'), persist)
    await page.goto('/creator/media')
    page.once('dialog', dialog => void dialog.accept())
    await page.locator(`li[data-media-id="${asset.id}"]`).getByRole('button', { name: 'Xóa ảnh chưa dùng' }).click()
    await expect(failed(page, 'MEDIA_IN_USE')).toBeVisible()
    expect((await fixtureArticle(db, manifest, draftId())).coverMediaId).toBe(asset.id)
    expect(await db.mediaAsset.count({ where: { id: asset.id } })).toBe(1)
    await recover()
    // Explicit clear allows later fixture cleanup without borrowing SetNull.
    await page.goto(`/creator/articles/${draftId()}/media`)
    await page.getByLabel('Không dùng ảnh bìa').check()
    await page.getByRole('button', { name: 'Lưu ảnh bìa', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Ảnh bìa đã được lưu.' })).toBeVisible()
  })
})
test('MED-16 all fixture statuses and owners remain attached after denied delete', async ({ browser }) => {
  await test.step('MED_DELETE_USED_MATRIX', async () => {
    const { page } = await login(browser)
    const asset = await upload(page, 'creator', `used-matrix-${randomBytes(3).toString('hex')}.png`, 'image/png', png())
    const articleIds = manifest.articles.map(row => row.id)
    await attachFixtureCoverMatrix(db, process.env, manifest, articleIds, asset.id, persist)
    try {
    const before = await db.article.findMany({ where: { id: { in: articleIds } }, select: {
      id: true, authorId: true, status: true, coverMediaId: true,
    } })
    expect(before).toHaveLength(articleIds.length)
    expect(new Set(before.map(row => row.status)).size).toBeGreaterThanOrEqual(10)
    expect(new Set(before.map(row => row.authorId)).size).toBeGreaterThanOrEqual(3)
    expect(before.every(row => row.coverMediaId === asset.id)).toBe(true)
    await reserveMediaDelete(manifest, asset.id, actorId('creator'), persist)
    page.once('dialog', dialog => void dialog.accept())
    await page.locator(`li[data-media-id="${asset.id}"]`).getByRole('button', { name: 'Xóa ảnh chưa dùng' }).click()
    await expect(failed(page, 'MEDIA_IN_USE')).toBeVisible()
    expect(await db.mediaAsset.count({ where: { id: asset.id } })).toBe(1)
    const after = await db.article.findMany({ where: { id: { in: articleIds } }, select: {
      id: true, authorId: true, status: true, coverMediaId: true,
    } })
    expect(after).toEqual(before)
    await recover()
    } finally { await clearFixtureCoverMatrix(db, process.env, manifest, articleIds, asset.id, persist) }
  })
})
test('MED-17 confirmed unused delete removes exact DB row and canonical file', async ({ browser }) => {
  await test.step('MED_DELETE_UNUSED', async () => {
    const { page } = await login(browser)
    const asset = await upload(page, 'creator', `unused-${randomBytes(3).toString('hex')}.png`, 'image/png', png())
    await reserveMediaDelete(manifest, asset.id, actorId('creator'), persist)
    page.once('dialog', dialog => void dialog.accept())
    await page.locator(`li[data-media-id="${asset.id}"]`).getByRole('button', { name: 'Xóa ảnh chưa dùng' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Ảnh đã xóa.' })).toBeVisible()
    expect(await db.mediaAsset.count({ where: { id: asset.id } })).toBe(0)
    const graph = await inspectMediaGraph(db, manifest, process.cwd(), true) as { files: { objects: string[] } } | null
    expect(graph?.files.objects).not.toContain(asset.filename)
    await recover()
  })
})
test('MED-21/28 controls remain labelled and usable at 390px and 768px', async ({ browser }) => {
  await test.step('MED_ACCESSIBLE_LAYOUT', async () => {
    const { page } = await login(browser)
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 }); await page.goto('/creator/media')
      await expect(page.getByLabel('Tệp PNG/JPEG')).toBeVisible()
      await expect(page.getByLabel('Văn bản thay thế')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    }
  })
})

test('MED-10-XSS HTML-like metadata is escaped after reload and cannot execute', async ({ browser }) => {
  await test.step('MED_ESCAPED_METADATA', async () => {
    const { page } = await login(browser)
    const asset = await upload(page, 'creator', `escaped-${randomBytes(3).toString('hex')}.png`, 'image/png', png())
    await page.locator(`li[data-media-id="${asset.id}"]`).getByRole('button', { name: 'Sửa metadata' }).click()
    await page.getByRole('form', { name: 'Sửa metadata ảnh' }).getByLabel('Văn bản thay thế').fill('<img src=x onerror=alert(1)>')
    await page.getByRole('form', { name: 'Sửa metadata ảnh' }).getByLabel('Chú thích').fill('<script>alert(1)</script>')
    await page.getByRole('button', { name: 'Lưu metadata' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Metadata đã được lưu.' })).toBeVisible()
    await page.reload()
    const item = page.locator(`li[data-media-id="${asset.id}"]`)
    await expect(item.getByText('<script>alert(1)</script>', { exact: true })).toBeVisible()
    await expect(item.locator('script')).toHaveCount(0)
    expect(await item.locator('img').count()).toBe(1)
    expect((await db.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).altText).toBe('<img src=x onerror=alert(1)>')
  })
})

test('MED-11-COVER foreign direct bytes and operation deny, current foreign cover preview stays narrow', async ({ browser }) => {
  await test.step('MED_COVER_READ_SCOPE', async () => {
    const admin = await login(browser, 'admin')
    const asset = await upload(admin.page, 'admin', `admin-cover-${randomBytes(3).toString('hex')}.png`, 'image/png', png())
    const intent = manifest.mediaIntents.find(row => row.assetId === asset.id)!
    const creator = await login(browser)
    expect((await creator.context.request.get(asset.url)).status()).toBe(404)
    expect((await creator.context.request.get(`/api/cms/media/uploads/${intent.operationId}`)).status()).toBe(404)
    const other = await login(browser, 'other')
    expect((await other.context.request.get(asset.url)).status()).toBe(404)
    await cover(admin.page, draftId(), asset)
    expect((await creator.context.request.get(asset.url)).status()).toBe(200)
    expect((await other.context.request.get(asset.url)).status()).toBe(404)
    await creator.page.goto(`/creator/articles/${draftId()}/media`)
    await expect(creator.page.getByText(asset.originalFilename, { exact: true }).first()).toBeVisible()
    await creator.page.getByLabel('Không dùng ảnh bìa').check()
    await creator.page.getByRole('button', { name: 'Lưu ảnh bìa', exact: true }).click()
    await expect(creator.page.getByRole('status').filter({ hasText: 'Ảnh bìa đã được lưu.' })).toBeVisible()
    expect((await creator.context.request.get(asset.url)).status()).toBe(404)
    await recover()
  })
})

test('MED-12/13-REPLACE cover no-op, replace and clear use persisted shared token', async ({ browser }) => {
  await test.step('MED_COVER_REPLACE', async () => {
    const { page } = await login(browser)
    const first = await upload(page, 'creator', `first-${randomBytes(3).toString('hex')}.png`, 'image/png', png())
    const second = await upload(page, 'creator', `second-${randomBytes(3).toString('hex')}.png`, 'image/png', png())
    await cover(page, draftId(), first)
    const token = (await fixtureArticle(db, manifest, draftId())).updatedAt.getTime()
    await page.getByRole('button', { name: 'Lưu ảnh bìa', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Ảnh bìa đã được lưu.' })).toBeVisible()
    expect((await fixtureArticle(db, manifest, draftId())).updatedAt.getTime()).toBe(token)
    await page.getByLabel('Tìm trong thư viện').fill(second.originalFilename)
    await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
    await page.locator(`input[name="cover"][data-media-id="${second.id}"]`).check()
    await page.getByRole('button', { name: 'Lưu ảnh bìa', exact: true }).click()
    await expect.poll(async () => (await fixtureArticle(db, manifest, draftId())).coverMediaId).toBe(second.id)
    await page.reload(); await expect(page.getByText(second.originalFilename, { exact: true }).first()).toBeVisible()
    await page.getByLabel('Không dùng ảnh bìa').check()
    await page.getByRole('button', { name: 'Lưu ảnh bìa', exact: true }).click()
    await expect.poll(async () => (await fixtureArticle(db, manifest, draftId())).coverMediaId).toBeNull()
    await recover()
  })
})

test('MED-17-CANCEL cancel delete preserves DB row and canonical file', async ({ browser }) => {
  await test.step('MED_DELETE_CANCEL', async () => {
    const { page } = await login(browser)
    const asset = await upload(page, 'creator', `cancel-${randomBytes(3).toString('hex')}.png`, 'image/png', png())
    const before = await readFile(join(mediaRootPath(manifest), 'objects', asset.filename))
    page.once('dialog', dialog => void dialog.dismiss())
    await page.locator(`li[data-media-id="${asset.id}"]`).getByRole('button', { name: 'Xóa ảnh chưa dùng' }).click()
    expect(await db.mediaAsset.count({ where: { id: asset.id } })).toBe(1)
    expect(await readFile(join(mediaRootPath(manifest), 'objects', asset.filename))).toEqual(before)
    expect(manifest.mediaDeleteIntents.some(intent => intent.assetId === asset.id)).toBe(false)
  })
})

test('MED-22 committed upload with lost response is recovered through the same operation', async ({ browser }) => {
  await test.step('MED_UPLOAD_LOST_ACK', async () => {
    const { page } = await login(browser)
    await page.goto('/creator/media')
    const name = `lost-ack-${randomBytes(3).toString('hex')}.png`
    const intercepted = await registerUpload(page, 'creator', name, 'image/png', true)
    try {
      await page.getByLabel('Tệp PNG/JPEG').setInputFiles({ name, mimeType: 'image/png', buffer: png() })
      await page.getByLabel('Văn bản thay thế').fill('Ảnh mất phản hồi')
      await page.getByRole('button', { name: 'Tải ảnh lên', exact: true }).click()
      await expect(failed(page, 'UNKNOWN_OUTCOME')).toBeVisible()
      demand(intercepted.captured.length === 1, 'MEDIA_UPLOAD_OPERATION_NOT_CAPTURED')
      await recover()
      const operation = intercepted.captured[0]
      expect(await db.mediaAsset.count({ where: { id: operation.assetId } })).toBe(1)
      await page.getByRole('button', { name: 'Kiểm tra trạng thái upload' }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Upload đã hoàn tất.' })).toBeVisible()
      expect(await db.mediaAsset.count({ where: { id: operation.assetId } })).toBe(1)
      expect(manifest.mediaIntents.filter(item => item.operationId === operation.operationId)).toHaveLength(1)
    } finally { await intercepted.dispose() }
  })
})

test('MED-24/27 offline and cancelled navigation retain unsaved File without dispatch', async ({ browser }) => {
  await test.step('MED_OFFLINE_NAVIGATION', async () => {
    const { page, context } = await login(browser)
    await page.goto('/creator/media')
    const name = `dirty-${randomBytes(3).toString('hex')}.png`
    await page.getByLabel('Tệp PNG/JPEG').setInputFiles({ name, mimeType: 'image/png', buffer: png() })
    await page.getByLabel('Văn bản thay thế').fill('Ảnh chưa gửi')
    const before = manifest.mediaIntents.length
    await context.setOffline(true)
    await expect(page.getByRole('button', { name: 'Tải ảnh lên', exact: true })).toBeDisabled()
    expect(manifest.mediaIntents.length).toBe(before)
    await context.setOffline(false)
    page.once('dialog', dialog => void dialog.dismiss())
    await page.getByRole('link', { name: 'Danh sách bài viết' }).click()
    await expect(page).toHaveURL(/\/creator\/media$/)
    await expect(page.getByLabel('Tên tệp')).toHaveValue(name)
    expect(manifest.mediaIntents.length).toBe(before)
    const accepted: string[] = []
    const accept = (dialog: import('@playwright/test').Dialog) => { accepted.push(dialog.type()); void dialog.accept() }
    page.on('dialog', accept)
    try {
      await page.getByRole('link', { name: 'Danh sách bài viết' }).click()
      await expect(page).toHaveURL(/\/creator\/articles$/)
    } finally { page.off('dialog', accept) }
    expect(accepted).toContain('confirm')
  })
})

for (const winner of ['cover', 'autosave'] as const) {
  test(`MED-14 ${winner} wins against the stale Article surface without losing input`, async ({ browser }) => {
    await test.step('MED_AUTOSAVE_CONFLICT', async () => {
      const { page, context } = await login(browser)
      const asset = await upload(page, 'creator', `race-${winner}-${randomBytes(3).toString('hex')}.png`, 'image/png', png())
      const editor = await context.newPage()
      await editor.goto(`/creator/articles/${draftId()}/edit`)
      await expect(editor.getByLabel('Tiêu đề', { exact: true })).toBeVisible()
      await page.goto(`/creator/articles/${draftId()}/media`)
      await page.getByLabel('Tìm trong thư viện').fill(asset.originalFilename)
      await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
      await page.locator(`input[name="cover"][data-media-id="${asset.id}"]`).check()
      const title = `Nội dung cạnh tranh ảnh bìa ${randomBytes(3).toString('hex')}`
      if (winner === 'cover') {
        await page.getByRole('button', { name: 'Lưu ảnh bìa', exact: true }).click()
        await expect.poll(async () => (await fixtureArticle(db, manifest, draftId())).coverMediaId).toBe(asset.id)
        await editor.getByLabel('Tiêu đề', { exact: true }).fill(title)
        await expect(failed(editor, 'EDIT_CONFLICT')).toBeVisible()
        await expect(editor.getByLabel('Tiêu đề', { exact: true })).toHaveValue(title)
      } else {
        await editor.getByLabel('Tiêu đề', { exact: true }).fill(title)
        await expect.poll(async () => (await fixtureArticle(db, manifest, draftId())).title).toBe(title)
        await page.getByRole('button', { name: 'Lưu ảnh bìa', exact: true }).click()
        await expect(failed(page, 'EDIT_CONFLICT')).toBeVisible()
        await expect(page.locator(`input[name="cover"][data-media-id="${asset.id}"]`)).toBeChecked()
        expect((await fixtureArticle(db, manifest, draftId())).coverMediaId).not.toBe(asset.id)
      }
      await recover()
    })
  })
}

for (const winner of ['cover', 'source'] as const) {
  test(`MED-15 ${winner} wins between cover and source creation`, async ({ browser }) => {
    await test.step('MED_SOURCE_CONFLICT', async () => {
      const { page, context } = await login(browser)
      const asset = await upload(page, 'creator', `source-race-${winner}-${randomBytes(3).toString('hex')}.png`, 'image/png', png())
      const source = await context.newPage()
      await source.goto(`/creator/articles/${draftId()}/sources`)
      await source.getByRole('button', { name: 'Thêm nguồn', exact: true }).click()
      const sourceTitle = `Nguồn cạnh tranh ảnh bìa ${randomBytes(3).toString('hex')}`
      await source.getByLabel('Tên tài liệu', { exact: true }).fill(sourceTitle)
      await page.goto(`/creator/articles/${draftId()}/media`)
      await page.getByLabel('Tìm trong thư viện').fill(asset.originalFilename)
      await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
      await page.locator(`input[name="cover"][data-media-id="${asset.id}"]`).check()
      const saveCover = () => page.getByRole('button', { name: 'Lưu ảnh bìa', exact: true }).click()
      const saveSource = () => source.getByRole('button', { name: 'Lưu nguồn', exact: true }).click()
      if (winner === 'cover') {
        await saveCover(); await expect.poll(async () => (await fixtureArticle(db, manifest, draftId())).coverMediaId).toBe(asset.id)
        await saveSource(); await expect(failed(source, 'EDIT_CONFLICT')).toBeVisible()
        await expect(source.getByLabel('Tên tài liệu', { exact: true })).toHaveValue(sourceTitle)
        expect(await db.sourceReference.count({ where: { articleId: draftId(), title: sourceTitle } })).toBe(0)
      } else {
        await saveSource(); await expect(source.getByRole('status').filter({ hasText: 'Đã lưu nguồn.' })).toBeVisible()
        await saveCover(); await expect(failed(page, 'EDIT_CONFLICT')).toBeVisible()
        await expect(page.locator(`input[name="cover"][data-media-id="${asset.id}"]`)).toBeChecked()
        expect((await fixtureArticle(db, manifest, draftId())).coverMediaId).not.toBe(asset.id)
        expect(await db.sourceReference.count({ where: { articleId: draftId(), title: sourceTitle } })).toBe(1)
      }
      await recover()
    })
  })
}

for (const winner of ['cover', 'classification'] as const) {
  test(`MED-15 ${winner} wins between cover and classification`, async ({ browser }) => {
    await test.step('MED_CLASSIFICATION_CONFLICT', async () => {
      const { page, context } = await login(browser)
      const asset = await upload(page, 'creator', `class-race-${winner}-${randomBytes(3).toString('hex')}.png`, 'image/png', png())
      const tag = manifest.catalogs.find(row => row.kind === 'tag' && row.seedKey === 'seed-01')!
      demand(tag, 'MEDIA_CLASSIFICATION_SEED_MISSING')
      const classification = await context.newPage()
      await classification.goto(`/creator/articles/${draftId()}/classification`)
      await classification.getByRole('button', { name: 'Thẻ', exact: true }).click()
      await classification.getByLabel('Tìm danh mục', { exact: true }).fill(tag.identity.slug!)
      await classification.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
      await classification.locator(`fieldset[data-classification-kind="tag"] input[data-taxonomy-id="${tag.id}"]`).check()
      await page.goto(`/creator/articles/${draftId()}/media`)
      await page.getByLabel('Tìm trong thư viện').fill(asset.originalFilename)
      await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
      await page.locator(`input[name="cover"][data-media-id="${asset.id}"]`).check()
      const saveCover = () => page.getByRole('button', { name: 'Lưu ảnh bìa', exact: true }).click()
      const saveClass = () => classification.getByRole('button', { name: 'Lưu phân loại', exact: true }).click()
      if (winner === 'cover') {
        await saveCover(); await expect.poll(async () => (await fixtureArticle(db, manifest, draftId())).coverMediaId).toBe(asset.id)
        await saveClass(); await expect(failed(classification, 'EDIT_CONFLICT')).toBeVisible()
        expect(await db.articleTagMapping.count({ where: { articleId: draftId(), tagId: tag.id } })).toBe(0)
      } else {
        await saveClass(); await expect(classification.getByRole('status').filter({ hasText: 'Đã lưu phân loại.' })).toBeVisible()
        await saveCover(); await expect(failed(page, 'EDIT_CONFLICT')).toBeVisible()
        await expect(page.locator(`input[name="cover"][data-media-id="${asset.id}"]`)).toBeChecked()
        expect(await db.articleTagMapping.count({ where: { articleId: draftId(), tagId: tag.id } })).toBe(1)
      }
      await recover()
    })
  })
}

test('MED-18 concurrent cover attach and unused delete cannot detach implicitly or dangle', async ({ browser }) => {
  await test.step('MED_ATTACH_DELETE_RACE', async () => {
    const { page, context } = await login(browser)
    const asset = await upload(page, 'creator', `attach-delete-${randomBytes(3).toString('hex')}.png`, 'image/png', png())
    const deletion = await context.newPage()
    await deletion.goto('/creator/media')
    await page.goto(`/creator/articles/${draftId()}/media`)
    await page.getByLabel('Tìm trong thư viện').fill(asset.originalFilename)
    await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
    await page.locator(`input[name="cover"][data-media-id="${asset.id}"]`).check()
    await reserveMediaDelete(manifest, asset.id, actorId('creator'), persist)
    deletion.once('dialog', dialog => void dialog.accept())
    await Promise.all([
      page.getByRole('button', { name: 'Lưu ảnh bìa', exact: true }).click(),
      deletion.locator(`li[data-media-id="${asset.id}"]`).getByRole('button', { name: 'Xóa ảnh chưa dùng' }).click(),
    ])
    await expect(page.locator('section[aria-busy]')).toHaveAttribute('aria-busy', 'false')
    await expect(deletion.locator('section[aria-busy]')).toHaveAttribute('aria-busy', 'false')
    const media = await db.mediaAsset.findUnique({ where: { id: asset.id } })
    const article = await fixtureArticle(db, manifest, draftId())
    if (media) {
      expect(article.coverMediaId).toBe(asset.id)
      await expect(deletion.locator('[data-error-code="MEDIA_IN_USE"], [data-error-code="MEDIA_BUSY"]')).toBeVisible()
    } else {
      expect(article.coverMediaId).not.toBe(asset.id)
      await expect(page.locator('[data-error-code="MEDIA_NOT_AVAILABLE"], [data-error-code="MEDIA_BUSY"]')).toBeVisible()
    }
    await recover()
  })
})

test('MED-20 fresh actor and Article status are checked again on mutation', async ({ browser }) => {
  await test.step('MED_FRESH_AUTH', async () => {
    const { page } = await login(browser)
    const asset = await upload(page, 'creator', `fresh-${randomBytes(3).toString('hex')}.png`, 'image/png', png())
    await page.locator(`li[data-media-id="${asset.id}"]`).getByRole('button', { name: 'Sửa metadata' }).click()
    await page.getByRole('form', { name: 'Sửa metadata ảnh' }).getByLabel('Văn bản thay thế').fill('Giữ khi mất quyền')
    await alterFixture(db, process.env, manifest, 'user', actorId('creator'), { status: 'SUSPENDED' }, persist)
    try {
      await page.getByRole('button', { name: 'Lưu metadata' }).click()
      await expect(failed(page, 'FORBIDDEN')).toBeVisible()
      await expect(page.getByRole('form', { name: 'Sửa metadata ảnh' }).getByLabel('Văn bản thay thế')).toHaveValue('Giữ khi mất quyền')
      expect((await db.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).altText).not.toBe('Giữ khi mất quyền')
    } finally { await alterFixture(db, process.env, manifest, 'user', actorId('creator'), { status: 'ACTIVE' }, persist) }
    page.once('dialog', dialog => void dialog.accept())
    await page.goto(`/creator/articles/${draftId()}/media`)
    await page.getByLabel('Tìm trong thư viện').fill(asset.originalFilename)
    await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
    await page.locator(`input[name="cover"][data-media-id="${asset.id}"]`).check()
    await alterFixture(db, process.env, manifest, 'article', draftId(), { status: 'SUBMITTED' }, persist)
    try {
      await page.getByRole('button', { name: 'Lưu ảnh bìa', exact: true }).click()
      await expect(failed(page, 'NOT_EDITABLE')).toBeVisible()
      await expect(page.locator(`input[name="cover"][data-media-id="${asset.id}"]`)).toBeChecked()
      expect((await fixtureArticle(db, manifest, draftId())).coverMediaId).not.toBe(asset.id)
    } finally { await alterFixture(db, process.env, manifest, 'article', draftId(), { status: 'DRAFT' }, persist) }
    await recover()
  })
})

test('MED-20 role revocation and parent owner change reject a preloaded mutation', async ({ browser }) => {
  await test.step('MED_FRESH_ROLE_OWNER', async () => {
    const { page } = await login(browser)
    const asset = await upload(page, 'creator', `role-owner-${randomBytes(3).toString('hex')}.png`, 'image/png', png())
    await page.locator(`li[data-media-id="${asset.id}"]`).getByRole('button', { name: 'Sửa metadata' }).click()
    const alt = page.getByRole('form', { name: 'Sửa metadata ảnh' }).getByLabel('Văn bản thay thế')
    await alt.fill('Chưa được lưu vì đổi vai trò')
    await alterFixture(db, process.env, manifest, 'user', actorId('creator'), { role: 'CLIENT' }, persist)
    try {
      await page.getByRole('button', { name: 'Lưu metadata' }).click()
      await expect(failed(page, 'FORBIDDEN')).toBeVisible()
      await expect(alt).toHaveValue('Chưa được lưu vì đổi vai trò')
      expect((await db.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).altText).not.toBe('Chưa được lưu vì đổi vai trò')
    } finally { await alterFixture(db, process.env, manifest, 'user', actorId('creator'), { role: 'CREATOR' }, persist) }
    await reserveFixtureMediaUploaderTransfer(db, process.env, manifest, asset.id, actorId('other'), persist)
    await transferFixtureMediaUploader(db, process.env, manifest, asset.id, actorId('other'), persist)
    try {
      await alt.fill('Chưa được lưu vì đổi uploader')
      await page.getByRole('button', { name: 'Lưu metadata' }).click()
      await expect(failed(page, 'MEDIA_NOT_AVAILABLE')).toBeVisible()
      await expect(alt).toHaveValue('Chưa được lưu vì đổi uploader')
      const rejected = await db.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })
      expect(rejected.uploadedById).toBe(actorId('other'))
      expect(rejected.altText).not.toBe('Chưa được lưu vì đổi uploader')
    } finally { await transferFixtureMediaUploader(db, process.env, manifest, asset.id, actorId('creator'), persist) }
    page.once('dialog', dialog => void dialog.accept())
    await page.goto(`/creator/articles/${draftId()}/media`)
    await page.getByLabel('Tìm trong thư viện').fill(asset.originalFilename)
    await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
    const radio = page.locator(`input[name="cover"][data-media-id="${asset.id}"]`)
    await radio.check()
    const before = await fixtureArticle(db, manifest, draftId())
    await alterFixture(db, process.env, manifest, 'article', draftId(), { authorId: actorId('other') }, persist)
    try {
      await page.getByRole('button', { name: 'Lưu ảnh bìa', exact: true }).click()
      await expect(failed(page, 'NOT_FOUND')).toBeVisible()
      await expect(radio).toBeChecked()
      const rejected = await fixtureArticle(db, manifest, draftId())
      expect(rejected.coverMediaId).toBe(before.coverMediaId)
      expect(rejected.contentJson).toEqual(before.contentJson)
    } finally { await alterFixture(db, process.env, manifest, 'article', draftId(), { authorId: actorId('creator') }, persist) }
    await recover()
  })
})

test('MED-20 expired session returns a safe mutation failure without discarding metadata input', async ({ browser }) => {
  await test.step('MED_SESSION_LOST', async () => {
    const { page, context } = await login(browser)
    const asset = await upload(page, 'creator', `session-lost-${randomBytes(3).toString('hex')}.png`, 'image/png', png())
    await page.locator(`li[data-media-id="${asset.id}"]`).getByRole('button', { name: 'Sửa metadata' }).click()
    const alt = page.getByRole('form', { name: 'Sửa metadata ảnh' }).getByLabel('Văn bản thay thế')
    await alt.fill('Giữ khi hết phiên')
    await context.clearCookies()
    await page.getByRole('button', { name: 'Lưu metadata' }).click()
    await expect(failed(page, 'FORBIDDEN')).toBeVisible()
    await expect(alt).toHaveValue('Giữ khi hết phiên')
    expect((await db.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).altText).not.toBe('Giữ khi hết phiên')
  })
})

test('MED-21 synchronous double submit dispatches one metadata update', async ({ browser }) => {
  await test.step('MED_SINGLE_FLIGHT', async () => {
    const { page } = await login(browser)
    const asset = await upload(page, 'creator', `single-${randomBytes(3).toString('hex')}.png`, 'image/png', png())
    await page.locator(`li[data-media-id="${asset.id}"]`).getByRole('button', { name: 'Sửa metadata' }).click()
    await page.getByRole('form', { name: 'Sửa metadata ảnh' }).getByLabel('Văn bản thay thế').fill('Lưu một lần')
    const actions: string[] = []
    const capture = (request: import('@playwright/test').Request) => {
      const id = request.headers()['next-action']
      if (request.method() === 'POST' && id) actions.push(id)
    }
    page.on('request', capture)
    try {
      await page.getByRole('form', { name: 'Sửa metadata ảnh' }).getByRole('button', { name: 'Lưu metadata' }).evaluate(button => {
        (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click()
      })
      await expect(page.getByRole('status').filter({ hasText: 'Metadata đã được lưu.' })).toBeVisible()
      await expect.poll(async () => (await db.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).altText).toBe('Lưu một lần')
      await expect(page.locator('section[aria-busy]')).toHaveAttribute('aria-busy', 'false')
    } finally { page.off('request', capture) }
    expect(actions.length).toBeGreaterThanOrEqual(1)
    expect(new Set(actions).size).toBe(actions.length)
  })
})

test('MED-23 committed metadata with lost Server Action ACK retains input until explicit reload', async ({ browser }) => {
  await test.step('MED_METADATA_LOST_ACK', async () => {
    const { page } = await login(browser)
    const asset = await upload(page, 'creator', `metadata-ack-${randomBytes(3).toString('hex')}.png`, 'image/png', png())
    await page.locator(`li[data-media-id="${asset.id}"]`).getByRole('button', { name: 'Sửa metadata' }).click()
    await page.getByRole('form', { name: 'Sửa metadata ảnh' }).getByLabel('Văn bản thay thế').fill('Metadata đã commit')
    let dispatched = 0
    const drop = async (route: import('@playwright/test').Route) => {
      if (route.request().method() !== 'POST' || !route.request().headers()['next-action']) { await route.continue(); return }
      const response = await route.fetch(); demand(response.ok(), 'MEDIA_METADATA_ACK_SERVER_WRITE_FAILED')
      dispatched++; await route.abort('failed')
    }
    await page.route('**/creator/media', drop)
    try {
      await page.getByRole('button', { name: 'Lưu metadata' }).click()
      await expect(failed(page, 'UNKNOWN_OUTCOME')).toBeVisible()
      await expect(page.getByRole('form', { name: 'Sửa metadata ảnh' }).getByLabel('Văn bản thay thế')).toHaveValue('Metadata đã commit')
      expect(dispatched).toBe(1)
      expect((await db.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).altText).toBe('Metadata đã commit')
    } finally { await page.unroute('**/creator/media', drop) }
    page.once('dialog', dialog => void dialog.accept())
    await page.reload()
    await expect(page.locator(`li[data-media-id="${asset.id}"]`).getByText('Metadata đã commit', { exact: true })).toBeVisible()
  })
})

test('MED-23 committed delete with lost ACK does not recreate the row or resend', async ({ browser }) => {
  await test.step('MED_DELETE_LOST_ACK', async () => {
    const { page } = await login(browser)
    const asset = await upload(page, 'creator', `delete-ack-${randomBytes(3).toString('hex')}.png`, 'image/png', png())
    await reserveMediaDelete(manifest, asset.id, actorId('creator'), persist)
    let dispatched = 0
    const drop = async (route: import('@playwright/test').Route) => {
      if (route.request().method() !== 'POST' || !route.request().headers()['next-action']) { await route.continue(); return }
      const response = await route.fetch(); demand(response.ok(), 'MEDIA_DELETE_ACK_SERVER_WRITE_FAILED')
      dispatched++; await route.abort('failed')
    }
    await page.route('**/creator/media', drop)
    try {
      page.once('dialog', dialog => void dialog.accept())
      await page.locator(`li[data-media-id="${asset.id}"]`).getByRole('button', { name: 'Xóa ảnh chưa dùng' }).click()
      await expect(failed(page, 'UNKNOWN_OUTCOME')).toBeVisible()
      expect(dispatched).toBe(1)
      expect(await db.mediaAsset.count({ where: { id: asset.id } })).toBe(0)
      await recover()
      const graph = await inspectMediaGraph(db, manifest, process.cwd(), true) as { files: { objects: string[] } } | null
      expect(graph?.files.objects).not.toContain(asset.filename)
    } finally { await page.unroute('**/creator/media', drop) }
    page.once('dialog', dialog => void dialog.accept())
    await page.reload()
    await expect(page.locator(`li[data-media-id="${asset.id}"]`)).toHaveCount(0)
  })
})

test('MED-23 committed cover with lost ACK keeps the chosen asset until explicit reload', async ({ browser }) => {
  await test.step('MED_COVER_LOST_ACK', async () => {
    const { page } = await login(browser)
    const asset = await upload(page, 'creator', `cover-ack-${randomBytes(3).toString('hex')}.png`, 'image/png', png())
    await page.goto(`/creator/articles/${draftId()}/media`)
    await page.getByLabel('Tìm trong thư viện').fill(asset.originalFilename)
    await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
    const radio = page.locator(`input[name="cover"][data-media-id="${asset.id}"]`)
    await radio.check()
    const before = await fixtureArticle(db, manifest, draftId())
    let dispatched = 0
    const drop = async (route: import('@playwright/test').Route) => {
      if (route.request().method() !== 'POST' || !route.request().headers()['next-action']) { await route.continue(); return }
      const response = await route.fetch(); demand(response.ok(), 'MEDIA_COVER_ACK_SERVER_WRITE_FAILED')
      dispatched++; await route.abort('failed')
    }
    await page.route(`**/creator/articles/${draftId()}/media`, drop)
    try {
      await page.getByRole('button', { name: 'Lưu ảnh bìa', exact: true }).click()
      await expect(failed(page, 'UNKNOWN_OUTCOME')).toBeVisible()
      await expect(radio).toBeChecked()
      await expect(page.getByRole('button', { name: 'Tải lại để đối chiếu' })).toBeVisible()
      expect(dispatched).toBe(1)
      const committed = await fixtureArticle(db, manifest, draftId())
      expect(committed.coverMediaId).toBe(asset.id)
      expect(committed.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime())
      for (const field of ['title', 'slug', 'contentJson', 'contentText', 'authorId', 'status', 'editorSchemaVersion'] as const)
        expect(committed[field]).toEqual(before[field])
    } finally { await page.unroute(`**/creator/articles/${draftId()}/media`, drop) }
    page.once('dialog', dialog => void dialog.accept())
    await page.reload()
    await expect(page.getByText(asset.originalFilename, { exact: true }).first()).toBeVisible()
    await expect(page.locator(`input[name="cover"][data-media-id="${asset.id}"]`)).toBeChecked()
  })
})

test('MED-26 legacy media is read-only and a current cover can be retained or cleared without external fetch', async ({ browser }) => {
  await test.step('MED_LEGACY_MEDIA', async () => {
    const legacy = await createLegacyMediaFixture(db, process.env, manifest, actorId('creator'), persist)
    const { page, context } = await login(browser)
    const externalAttempts: string[] = []
    await context.route('https://legacy.invalid/**', async route => {
      externalAttempts.push(new URL(route.request().url()).pathname)
      await route.abort('blockedbyclient')
    })
    const observe = (request: import('@playwright/test').Request) => {
      if (new URL(request.url()).hostname === 'legacy.invalid') externalAttempts.push(new URL(request.url()).pathname)
    }
    page.on('request', observe)
    try {
      await page.goto('/creator/media')
      const item = page.locator(`li[data-media-id="${legacy.id}"]`)
      await expect(item).toBeVisible()
      await expect(item.getByRole('status')).toContainText('không được quản lý')
      await expect(item.getByRole('button', { name: 'Sửa metadata' })).toHaveCount(0)
      await expect(item.getByRole('button', { name: 'Xóa ảnh chưa dùng' })).toHaveCount(0)
      await expect(item.locator('img')).toHaveCount(0)
      await attachLegacyCoverFixture(db, process.env, manifest, draftId(), legacy.id, persist)
      const before = await fixtureArticle(db, manifest, draftId())
      await page.goto(`/creator/articles/${draftId()}/media`)
      await expect(page.getByText('Ảnh cũ không được quản lý; có thể giữ hoặc gỡ, không tải URL bên ngoài.')).toBeVisible()
      await page.getByLabel('Tìm trong thư viện').fill(legacy.filename)
      await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
      await expect(page.locator(`input[name="cover"][data-media-id="${legacy.id}"]`)).toHaveCount(0)
      await page.getByRole('button', { name: 'Lưu ảnh bìa', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Ảnh bìa đã được lưu.' })).toBeVisible()
      const retained = await fixtureArticle(db, manifest, draftId())
      expect(retained.coverMediaId).toBe(legacy.id)
      expect(retained.updatedAt.getTime()).toBe(before.updatedAt.getTime())
      await page.reload()
      await expect(page.getByText(legacy.filename, { exact: true }).first()).toBeVisible()
      await page.getByLabel('Không dùng ảnh bìa').check()
      await page.getByRole('button', { name: 'Lưu ảnh bìa', exact: true }).click()
      await expect.poll(async () => (await fixtureArticle(db, manifest, draftId())).coverMediaId).toBeNull()
      const cleared = await fixtureArticle(db, manifest, draftId())
      expect(cleared.updatedAt.getTime()).toBeGreaterThan(retained.updatedAt.getTime())
      for (const field of ['title', 'slug', 'contentJson', 'contentText', 'authorId', 'status', 'editorSchemaVersion', 'categoryId'] as const)
        expect(cleared[field]).toEqual(before[field])
      await page.reload()
      await expect(page.getByText('Chưa có ảnh bìa.')).toBeVisible()
      expect(await db.mediaAsset.findUnique({ where: { id: legacy.id } })).toMatchObject({ id: legacy.id, url: legacy.url, filename: legacy.filename })
      expect(externalAttempts).toEqual([])
      await recover()
    } finally { page.off('request', observe); await context.unroute('https://legacy.invalid/**') }
  })
})
