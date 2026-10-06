import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import type { Article } from '@prisma/client'
import { PNG } from 'pngjs'
import jpeg from 'jpeg-js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connectStaging, demand, STAGING_BASE_URL } from '../../scripts/cms-e2e/guard.mjs'
import { loadManifest, saveManifest, discoverCreatedArticles, discoverFixtureGraph, fixtureArticle, alterFixture,
  attachFixtureCoverMatrix, clearFixtureCoverMatrix, createLegacyMediaFixture, attachLegacyCoverFixture } from '../../scripts/cms-e2e/fixtures.mjs'
import { mediaRootPath, reserveMediaOperation, seedManagedMediaBatch } from '../../scripts/cms-e2e/media-fixtures.mjs'
import { pauseEditorClock } from './cms-autosave-support'
import { observeTaxonomyActions } from './cms-taxonomy-support'

type Actor = 'creator' | 'other' | 'admin' | 'super' | 'analyst' | 'client'
type Manifest = { version: number; runId: string; namespace: string;
  users: { key: Actor; id: string; email: string; role: string }[];
  articles: { key: string; id: string; authorId: string; allowedOwnerIds: string[] }[];
  catalogs: { kind: string; id: string; seedKey: string | null; identity: { slug?: string; canonicalKey?: string } }[] }
let manifest: Manifest, db: Awaited<ReturnType<typeof connectStaging>>
let credentials: Record<Actor, { email: string; password: string }>
const contexts: BrowserContext[] = []
const persist = (value: unknown) => saveManifest(process.env.CMS_E2E_MANIFEST, value)
const fixture = (key: string) => manifest.articles.find(row => row.key === key)!
const actorId = (actor: Actor) => manifest.users.find(row => row.key === actor)!.id
const path = (id: string) => `/creator/articles/${id}/preview`
const read = (id: string) => fixtureArticle(db, manifest, id) as Promise<Article>
const snapshot = (article: Article) => ({ title: article.title, excerpt: article.excerpt, contentJson: article.contentJson,
  contentText: article.contentText, status: article.status, authorId: article.authorId,
  updatedAt: article.updatedAt.toISOString(), categoryId: article.categoryId, coverMediaId: article.coverMediaId })
const png = () => { const image = new PNG({ width: 2, height: 1 }); image.data = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]); return PNG.sync.write(image) }
const jpg = () => jpeg.encode({ width: 2, height: 1, data: Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]) }, 90).data

async function login(browser: Browser, actor: Actor) {
  const context = await browser.newContext({ baseURL: STAGING_BASE_URL }); contexts.push(context)
  const page = await context.newPage()
  try {
    await page.goto('/dang-nhap')
    await page.getByLabel('Email', { exact: true }).fill(credentials[actor].email)
    await page.getByLabel('Mật khẩu', { exact: true }).fill(credentials[actor].password)
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard$/)
  } catch { throw new Error(`Fixture login failed for ${actor}; details suppressed`) }
  await page.clock.install()
  return { context, page }
}
async function open(page: Page, id: string) {
  await page.clock.resume()
  await page.goto(path(id))
  await expect(page.getByText('Bản xem trước nội bộ — nội dung đã lưu', { exact: true })).toBeVisible()
}
async function findListPreview(page: Page, id: string) {
  await page.goto('/creator/articles')
  for (let index = 0; index < 50; index++) {
    const link = page.locator(`a[href="${path(id)}"]`)
    if (await link.count()) { await expect(link.getByText('Xem trước')).toBeVisible(); return }
    const next = page.getByRole('link', { name: 'Trang sau' })
    demand(await next.count() === 1, 'PREVIEW_LIST_LINK_NOT_FOUND')
    await next.click()
  }
  throw new Error('PREVIEW_LIST_PAGE_LIMIT')
}

test.beforeAll(async () => {
  demand(process.env.CMS_E2E_RUNNING === 'YES', 'USE_GUARDED_STAGING_RUNNER')
  manifest = await loadManifest(process.env.CMS_E2E_MANIFEST) as Manifest
  demand(manifest.version === 4 && manifest.runId === process.env.CMS_E2E_RUN_ID, 'RUN_PROVENANCE_MISMATCH')
  credentials = JSON.parse(process.env.CMS_E2E_CREDENTIALS ?? '{}')
  db = await connectStaging(process.env)
})
test.afterEach(async () => {
  try { if (db) await discoverFixtureGraph(db, process.env, manifest, persist) }
  finally { await Promise.all(contexts.splice(0).map(context => context.close())) }
})
test.afterAll(async () => { if (db) await db.$disconnect() })

test('PREV-01 anonymous direct preview has no saved article marker', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: STAGING_BASE_URL }); contexts.push(context)
  const page = await context.newPage()
  await test.step('PREV_ANON', async () => {
    await page.goto(path(fixture('DRAFT').id))
    await expect(page).toHaveURL(/\/dang-nhap(?:\?|$)/)
    await expect(page.getByText(`${manifest.namespace} DRAFT`, { exact: true })).toHaveCount(0)
  })
})

test('PREV-02 non-CMS roles cannot open preview', async ({ browser }) => {
  await test.step('PREV_NON_CMS', async () => {
    for (const role of ['client', 'analyst'] as const) {
      const { page } = await login(browser, role)
      await page.goto(path(fixture('DRAFT').id))
      await expect(page).toHaveURL(/\/dashboard$/)
      await expect(page.getByRole('heading', { name: `${manifest.namespace} DRAFT` })).toHaveCount(0)
    }
  })
})

test('PREV-03 creator sees own and foreign missing invalid paths reveal no article', async ({ browser }) => {
  const { page } = await login(browser, 'creator')
  await test.step('PREV_SCOPE', async () => {
    await open(page, fixture('DRAFT').id)
    await expect(page.getByRole('heading', { name: `${manifest.namespace} DRAFT` })).toBeVisible()
    for (const id of [fixture('other-draft').id, 'missing-preview-id', '%2E%2Ebad']) {
      await page.goto(path(id))
      await expect(page.getByText('Bản xem trước nội bộ — nội dung đã lưu', { exact: true })).toHaveCount(0)
      await expect(page.getByText(`${manifest.namespace} other-draft`, { exact: true })).toHaveCount(0)
    }
  })
})

test('PREV-04 admin and super read foreign draft without reassigning author', async ({ browser }) => {
  await test.step('PREV_ANY_SCOPE', async () => {
    const id = fixture('other-draft').id, before = snapshot(await read(id))
    for (const role of ['admin', 'super'] as const) {
      const { page } = await login(browser, role)
      await open(page, id)
      await expect(page.getByRole('heading', { name: before.title })).toBeVisible()
    }
    expect(snapshot(await read(id))).toEqual(before)
  })
})

test('PREV-05 all ten saved statuses remain readable but editing policy stays separate', async ({ browser }) => {
  const { page } = await login(browser, 'creator')
  await test.step('PREV_STATUSES', async () => {
    for (const status of ['DRAFT', 'CHANGES_REQUESTED', 'SUBMITTED', 'EDITORIAL_REVIEW', 'FACT_CHECK',
      'APPROVED', 'SCHEDULED', 'PUBLISHED', 'CORRECTED', 'ARCHIVED']) {
      const row = fixture(status), before = snapshot(await read(row.id))
      await open(page, row.id)
      await expect(page.getByRole('heading', { name: before.title })).toBeVisible()
      expect(snapshot(await read(row.id))).toEqual(before)
    }
  })
})

test('PREV-06 fresh actor and owner changes revoke a later preview request', async ({ browser }) => {
  const id = fixture('DRAFT').id
  const { page } = await login(browser, 'creator')
  await open(page, id)
  await test.step('PREV_REVOKE', async () => {
    try {
      await alterFixture(db, process.env, manifest, 'user', actorId('creator'), { status: 'SUSPENDED' }, persist)
      await page.reload()
      await expect(page.getByRole('heading', { name: `${manifest.namespace} DRAFT` })).toHaveCount(0)
    } finally { await alterFixture(db, process.env, manifest, 'user', actorId('creator'), { status: 'ACTIVE' }, persist) }
    try {
      await alterFixture(db, process.env, manifest, 'article', id, { authorId: actorId('other') }, persist)
      await page.goto(path(id))
      await expect(page.getByRole('heading', { name: `${manifest.namespace} DRAFT` })).toHaveCount(0)
    } finally { await alterFixture(db, process.env, manifest, 'article', id, { authorId: actorId('creator') }, persist) }
  })
})

test('PREV-07/08/12 header uses saved time and missing profile and empty data have fallbacks', async ({ browser }) => {
  const { page } = await login(browser, 'creator')
  await test.step('PREV_HEADER_EMPTY', async () => {
    const before = await read(fixture('DRAFT').id)
    await open(page, before.id)
    await expect(page.getByRole('heading', { name: before.title })).toBeVisible()
    await expect(page.locator('time').first()).toHaveAttribute('datetime', before.updatedAt.toISOString())
    await expect(page.getByText('Tác giả chưa có hồ sơ công khai')).toBeVisible()
    await expect(page.getByText('Bài viết chưa có ảnh bìa khả dụng.')).toBeVisible()
    await expect(page.getByText('Chưa có nguồn tham khảo.')).toBeVisible()
  })
})

test('PREV-10 unsupported editor schema is safe and does not mutate Article', async ({ browser }) => {
  const id = fixture('DRAFT').id
  const { page } = await login(browser, 'creator')
  await test.step('PREV_UNSUPPORTED', async () => {
    try {
      await alterFixture(db, process.env, manifest, 'article', id, { editorSchemaVersion: 2 }, persist)
      const before = snapshot(await read(id))
      await page.goto(path(id))
      await expect(page.locator('[data-error-code="UNSUPPORTED_DOCUMENT"]')).toBeVisible()
      await expect(page.getByText(before.title, { exact: true })).toHaveCount(0)
      expect(snapshot(await read(id))).toEqual(before)
    } finally { await alterFixture(db, process.env, manifest, 'article', id, { editorSchemaVersion: 1 }, persist) }
  })
})

test('PREV-09/16/17/20 saved Vietnamese rich text and source render after reload without private note', async ({ browser }) => {
  const { page } = await login(browser, 'creator')
  await test.step('PREV_SAVED_CONTENT', async () => {
    await page.clock.resume()
    await page.goto('/creator/articles/new')
    const title = `${manifest.namespace} preview rich tiếng Việt`
    await page.getByLabel('Tiêu đề', { exact: true }).fill(title)
    await page.getByLabel('Slug', { exact: true }).fill(`${manifest.namespace}-preview-rich`)
    const body = page.getByRole('textbox', { name: 'Nội dung bài viết', exact: true })
    await body.fill('Nội dung tiếng Việt đã lưu')
    await body.press('ControlOrMeta+A')
    await body.press('ControlOrMeta+B')
    await page.getByRole('button', { name: 'Lưu nháp', exact: true }).click()
    await expect(page).toHaveURL(/\/creator\/articles\/[^/]+\/edit$/)
    const id = new URL(page.url()).pathname.split('/').at(-2)!
    await discoverCreatedArticles(db, process.env, manifest, persist)
    demand(manifest.articles.some(row => row.id === id), 'PREV_ARTICLE_NOT_JOURNALED')
    await page.goto(`/creator/articles/${id}/sources`)
    await page.getByRole('button', { name: 'Thêm nguồn', exact: true }).click()
    await page.getByLabel('Tên tài liệu', { exact: true }).fill('Nguồn preview tiếng Việt')
    await page.getByLabel('Loại nguồn', { exact: true }).selectOption('REPORT')
    await page.getByLabel('URL', { exact: true }).fill('https://example.com/preview')
    await page.getByLabel('Ghi chú', { exact: true }).fill('PRIVATE_PREVIEW_NOTE')
    await page.getByRole('button', { name: 'Lưu nguồn', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: /^Đã lưu nguồn\.$/ })).toBeVisible()
    await discoverFixtureGraph(db, process.env, manifest, persist)
    await open(page, id)
    await page.reload()
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
    await expect(page.locator('article strong')).toContainText('Nội dung tiếng Việt đã lưu')
    await expect(page.getByRole('link', { name: 'Nguồn preview tiếng Việt' })).toHaveAttribute('href', 'https://example.com/preview')
    await expect(page.getByText('PRIVATE_PREVIEW_NOTE')).toHaveCount(0)
    expect((await page.content()).includes('PRIVATE_PREVIEW_NOTE')).toBe(false)
  })
})

test('PREV-11 hostile saved metadata and links neither execute nor auto-request external resources', async ({ browser }) => {
  const { context, page } = await login(browser, 'creator')
  await test.step('PREV_XSS_NETWORK', async () => {
    await page.clock.resume()
    await page.goto('/creator/articles/new')
    const host = 'preview-xss.example.invalid'
    const title = `<script>window.__cmsPreviewXssFired=true</script> ${manifest.namespace}`
    const excerpt = `<img src="https://${host}/auto" onerror="window.__cmsPreviewXssFired=true">`
    const sourceTitle = `<img src="https://${host}/source" onerror="window.__cmsPreviewXssFired=true">`
    await page.getByLabel('Tiêu đề', { exact: true }).fill(title)
    await page.getByLabel('Slug', { exact: true }).fill(`${manifest.namespace}-preview-xss`)
    await page.getByLabel('Tóm tắt', { exact: true }).fill(excerpt)
    await page.getByRole('button', { name: 'Lưu nháp', exact: true }).click()
    await expect(page).toHaveURL(/\/creator\/articles\/[^/]+\/edit$/)
    const id = new URL(page.url()).pathname.split('/').at(-2)!
    await discoverCreatedArticles(db, process.env, manifest, persist)
    demand(manifest.articles.some(row => row.id === id), 'PREV_XSS_ARTICLE_NOT_JOURNALED')
    await page.goto(`/creator/articles/${id}/sources`)
    await page.getByRole('button', { name: 'Thêm nguồn', exact: true }).click()
    await page.getByLabel('Tên tài liệu', { exact: true }).fill(sourceTitle)
    await page.getByLabel('Loại nguồn', { exact: true }).selectOption('REPORT')
    await page.getByLabel('URL', { exact: true }).fill(`https://${host}/click-only`)
    await page.getByRole('button', { name: 'Lưu nguồn', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: /^Đã lưu nguồn\.$/ })).toBeVisible()
    await discoverFixtureGraph(db, process.env, manifest, persist)

    const externalRequests: string[] = []
    await context.route(`https://${host}/**`, route => {
      externalRequests.push(route.request().method())
      return route.abort('blockedbyclient')
    })
    await page.addInitScript(() => { (window as Window & { __cmsPreviewXssFired?: boolean }).__cmsPreviewXssFired = false })
    await open(page, id)
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
    await expect(page.getByText(excerpt, { exact: true })).toBeVisible()
    const sources = page.getByRole('region', { name: 'Nguồn tham khảo', exact: true })
    await expect(sources).toHaveCount(1)
    await expect(sources).toBeVisible()
    const link = sources.getByRole('link', { name: sourceTitle, exact: true })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /noopener noreferrer nofollow/)
    await expect(link).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(await link.evaluate(element => new URL((element as HTMLAnchorElement).href).hostname === 'preview-xss.example.invalid')).toBe(true)
    await expect(page.locator('header script, header img')).toHaveCount(0)
    await expect(sources.locator('script, img')).toHaveCount(0)
    expect(await page.evaluate(() => (window as Window & { __cmsPreviewXssFired?: boolean }).__cmsPreviewXssFired)).toBe(false)
    expect(externalRequests).toEqual([])
    await page.reload()
    await expect(sources).toHaveCount(1)
    await expect(sources).toBeVisible()
    await expect(sources.getByRole('link', { name: sourceTitle, exact: true })).toBeVisible()
    await expect(page.locator('header script, header img')).toHaveCount(0)
    await expect(sources.locator('script, img')).toHaveCount(0)
    expect(await page.evaluate(() => (window as Window & { __cmsPreviewXssFired?: boolean }).__cmsPreviewXssFired)).toBe(false)
    expect(externalRequests).toEqual([])
  })
})

test('PREV-13/14/15 attached foreign-uploader private PNG renders while unrelated bytes deny and load failure falls back', async ({ browser }) => {
  const id = fixture('DRAFT').id
  const { page } = await login(browser, 'creator')
  await test.step('PREV_PRIVATE_COVER', async () => {
    const rows = await seedManagedMediaBatch(db, manifest, actorId('other'), 2, png(), persist)
    await discoverFixtureGraph(db, process.env, manifest, persist)
    const [attached, unrelated] = rows
    await attachFixtureCoverMatrix(db, process.env, manifest, [id], attached.id, persist)
    try {
      await open(page, id)
      const src = `/api/cms/media/${attached.id}/content`
      await expect(page.locator(`img[src="${src}"]`)).toBeVisible()
      const allowed = await page.request.get(src)
      expect(allowed.status()).toBe(200)
      expect(allowed.headers()['content-type']).toMatch(/^image\/png/)
      expect((await allowed.body()).length).toBeGreaterThan(0)
      expect((await page.request.get(`/api/cms/media/${unrelated.id}/content`)).status()).toBe(404)
      await page.route(`**${src}`, route => route.fulfill({ status: 404, body: '' }))
      await page.reload()
      await expect(page.getByText('Ảnh bìa hiện không khả dụng.')).toBeVisible()
      await expect(page.getByRole('heading', { name: (await read(id)).title })).toBeVisible()
    } finally { await clearFixtureCoverMatrix(db, process.env, manifest, [id], attached.id, persist) }
  })
})

test('PREV-13 real JPEG upload and Article cover remain readable in saved preview', async ({ browser }) => {
  const id = fixture('DRAFT').id
  const { page } = await login(browser, 'creator')
  await test.step('PREV_JPEG_COVER', async () => {
    await page.clock.resume()
    await page.goto('/creator/media')
    const filename = `${manifest.namespace}-preview.jpg`
    const captured: string[] = []
    const intercept = async (route: import('@playwright/test').Route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return }
      const operationId = new URL(route.request().url()).pathname.split('/').at(-1)!
      const operation = JSON.parse(await readFile(join(mediaRootPath(manifest), 'operations', `${operationId}.json`), 'utf8'))
      demand(operation.kind === 'upload' && operation.stage === 'intent' && operation.actorId === actorId('creator')
        && operation.metadata.originalFilename === filename && operation.metadata.mimeType === 'image/jpeg', 'PREV_JPEG_INTENT_MISMATCH')
      await reserveMediaOperation(manifest, { operationId, assetId: operation.assetId, actorId: operation.actorId,
        key: operation.key, mimeType: 'image/jpeg', originalFilename: filename }, persist)
      captured.push(operation.assetId)
      await route.continue()
    }
    await page.route('**/api/cms/media/uploads/*', intercept)
    try {
      await page.getByLabel('Tệp PNG/JPEG').setInputFiles({ name: filename, mimeType: 'image/jpeg', buffer: jpg() })
      await page.getByLabel('Văn bản thay thế').fill('Ảnh JPEG preview')
      await page.getByRole('button', { name: 'Tải ảnh lên', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Ảnh đã được lưu.' })).toBeVisible()
      demand(captured.length === 1, 'PREV_JPEG_OPERATION_COUNT')
    } finally { await page.unroute('**/api/cms/media/uploads/*', intercept) }
    await discoverFixtureGraph(db, process.env, manifest, persist)
    const asset = await db.mediaAsset.findUnique({ where: { id: captured[0] } })
    demand(asset && asset.uploadedById === actorId('creator') && asset.mimeType === 'image/jpeg', 'PREV_JPEG_ASSET_MISMATCH')
    const assetId = asset!.id
    await page.goto(`/creator/articles/${id}/media`)
    await page.getByLabel('Tìm trong thư viện').fill(filename)
    await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
    await page.locator(`input[name="cover"][data-media-id="${assetId}"]`).check()
    await page.getByRole('button', { name: 'Lưu ảnh bìa', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Ảnh bìa đã được lưu.' })).toBeVisible()
    await discoverFixtureGraph(db, process.env, manifest, persist)
    try {
      await open(page, id)
      const src = `/api/cms/media/${assetId}/content`
      await expect(page.locator(`img[src="${src}"]`)).toBeVisible()
      const bytes = await page.request.get(src)
      expect(bytes.status()).toBe(200)
      expect(bytes.headers()['content-type']).toMatch(/^image\/jpeg/)
      await page.reload()
      await expect(page.locator(`img[src="${src}"]`)).toBeVisible()
    } finally {
      await page.goto(`/creator/articles/${id}/media`)
      await page.getByLabel('Không dùng ảnh bìa').check()
      await page.getByRole('button', { name: 'Lưu ảnh bìa', exact: true }).click()
      await expect.poll(async () => (await read(id)).coverMediaId).toBeNull()
      await discoverFixtureGraph(db, process.env, manifest, persist)
    }
  })
})

test('PREV-15 legacy cover never requests its external URL', async ({ browser }) => {
  const id = fixture('other-draft').id
  const { context, page } = await login(browser, 'other')
  await test.step('PREV_LEGACY_COVER', async () => {
    const legacy = await createLegacyMediaFixture(db, process.env, manifest, actorId('other'), persist)
    const external: string[] = []
    await context.route('https://legacy.invalid/**', route => {
      external.push(new URL(route.request().url()).pathname)
      return route.abort('blockedbyclient')
    })
    await attachLegacyCoverFixture(db, process.env, manifest, id, legacy.id, persist)
    try {
      await open(page, id)
      await expect(page.getByText('Bài viết chưa có ảnh bìa khả dụng.')).toBeVisible()
      await expect(page.locator(`img[src="${legacy.url}"]`)).toHaveCount(0)
      expect(external).toEqual([])
    } finally {
      await page.goto(`/creator/articles/${id}/media`)
      await page.getByLabel('Không dùng ảnh bìa').check()
      await page.getByRole('button', { name: 'Lưu ảnh bìa', exact: true }).click()
      await expect.poll(async () => (await read(id)).coverMediaId).toBeNull()
    }
  })
})

test('PREV-16 saved category topic tag instrument and primary survive preview read without mutation', async ({ browser }) => {
  const { page } = await login(browser, 'creator')
  await test.step('PREV_CLASSIFICATION', async () => {
    await page.clock.resume()
    await page.goto('/creator/articles/new')
    await page.getByLabel('Tiêu đề', { exact: true }).fill(`${manifest.namespace} preview taxonomy`)
    await page.getByLabel('Slug', { exact: true }).fill(`${manifest.namespace}-preview-taxonomy`)
    await page.getByRole('button', { name: 'Lưu nháp', exact: true }).click()
    await expect(page).toHaveURL(/\/creator\/articles\/[^/]+\/edit$/)
    const id = new URL(page.url()).pathname.split('/').at(-2)!
    await discoverCreatedArticles(db, process.env, manifest, persist)
    demand(manifest.articles.some(row => row.id === id), 'PREV_TAX_ARTICLE_NOT_JOURNALED')
    const observer = observeTaxonomyActions(page)
    await page.goto(`/creator/articles/${id}/classification`)
    await observer.ready('searchArticleClassificationOptions', 'updateArticleClassification')
    const names = { category: 'Chuyên mục', topic: 'Chủ đề', tag: 'Thẻ', instrument: 'Công cụ tài chính' }
    const chosen = []
    for (const kind of ['category', 'topic', 'tag', 'instrument'] as const) {
      const seed = manifest.catalogs.find(row => row.kind === kind && row.seedKey === 'seed-01')!
      demand(seed, 'PREV_TAX_SEED_MISSING')
      await page.getByRole('button', { name: names[kind], exact: true }).click()
      await page.getByLabel('Tìm danh mục', { exact: true }).fill(seed.identity.slug ?? seed.identity.canonicalKey!)
      await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
      const input = page.locator(`fieldset[data-classification-kind="${kind}"] input[data-taxonomy-id="${seed.id}"]`)
      await expect(input).toBeVisible()
      await input.setChecked(true)
      chosen.push(seed)
    }
    await page.locator(`input[data-primary-instrument-id="${chosen[3].id}"]`).check()
    await page.getByRole('button', { name: 'Lưu phân loại', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: /^Đã lưu phân loại\.$/ })).toBeVisible()
    await discoverFixtureGraph(db, process.env, manifest, persist)
    const before = snapshot(await read(id))
    try {
      await alterFixture(db, process.env, manifest, 'category', chosen[0].id, { isActive: false }, persist)
      await alterFixture(db, process.env, manifest, 'instrument', chosen[3].id, { isActive: false }, persist)
      await open(page, id)
      await expect(page.getByRole('heading', { name: 'Phân loại', exact: true })).toBeVisible()
      for (const seed of chosen) {
        const term = seed.kind === 'category' ? await db.articleCategory.findUnique({ where: { id: seed.id } })
          : seed.kind === 'topic' ? await db.articleTopic.findUnique({ where: { id: seed.id } })
            : seed.kind === 'tag' ? await db.articleTag.findUnique({ where: { id: seed.id } })
              : await db.financialInstrument.findUnique({ where: { id: seed.id } })
        demand(term, 'PREV_TAX_TERM_MISSING')
        await expect(page.getByText(term!.name, { exact: false }).first()).toBeVisible()
      }
      await expect(page.getByText('Ngừng sử dụng', { exact: false }).first()).toBeVisible()
      await expect(page.getByText('Chính', { exact: false }).first()).toBeVisible()
      expect(snapshot(await read(id))).toEqual(before)
    } finally {
      await alterFixture(db, process.env, manifest, 'category', chosen[0].id, { isActive: true }, persist)
      await alterFixture(db, process.env, manifest, 'instrument', chosen[3].id, { isActive: true }, persist)
    }
  })
})

test('PREV-17/18 list and persisted editor link open saved preview without replacing editor', async ({ browser }) => {
  const { context, page } = await login(browser, 'creator')
  const id = fixture('DRAFT').id
  await test.step('PREV_LINKS', async () => {
    await findListPreview(page, id)
    const submitted = fixture('SUBMITTED').id
    await findListPreview(page, submitted)
    await expect(page.locator(`a[href="/creator/articles/${submitted}/edit"]`)).toHaveCount(0)
    await page.goto('/creator/articles/new')
    await expect(page.getByRole('link', { name: 'Xem bản đã lưu' })).toHaveCount(0)
    await expect(page.getByText('Lưu nháp lần đầu trước khi xem bản đã lưu.')).toBeVisible()
    await page.goto(`/creator/articles/${id}/edit`)
    const link = page.getByRole('link', { name: 'Xem bản đã lưu' })
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    const popupPromise = context.waitForEvent('page')
    await link.click()
    const popup = await popupPromise
    await expect(popup.getByText('Bản xem trước nội bộ — nội dung đã lưu', { exact: true })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`${id}/edit$`))
  })
})

test('PREV-19 dirty editor stays intact while preview reads the persisted title', async ({ browser }) => {
  const { context, page } = await login(browser, 'creator')
  const id = fixture('DRAFT').id
  await test.step('PREV_DIRTY_TAB', async () => {
    await page.goto(`/creator/articles/${id}/edit`)
    await pauseEditorClock(page)
    const saved = (await read(id)).title, unsaved = `${manifest.namespace} unsaved preview input`
    await page.getByLabel('Tiêu đề', { exact: true }).fill(unsaved)
    const popupPromise = context.waitForEvent('page')
    await page.getByRole('link', { name: 'Xem bản đã lưu' }).click()
    const popup = await popupPromise
    await expect(popup.getByRole('heading', { name: saved })).toBeVisible()
    await expect(popup.getByText(unsaved, { exact: true })).toHaveCount(0)
    await expect(page.getByLabel('Tiêu đề', { exact: true })).toHaveValue(unsaved)
    expect((await read(id)).title).toBe(saved)
  })
})

test('PREV-21 GET and reload leave persisted Article unchanged', async ({ browser }) => {
  const { page } = await login(browser, 'creator')
  const id = fixture('DRAFT').id
  await test.step('PREV_NO_WRITE', async () => {
    const before = snapshot(await read(id))
    await open(page, id)
    await page.reload()
    await expect(page.getByRole('heading', { name: before.title })).toBeVisible()
    expect(snapshot(await read(id))).toEqual(before)
  })
})

test('PREV-22 private HTML has noindex and does not advertise draft metadata', async ({ browser }) => {
  const { page } = await login(browser, 'creator')
  await test.step('PREV_PRIVACY', async () => {
    const response = await page.goto(path(fixture('DRAFT').id))
    expect(response?.status()).toBe(200)
    expect(response?.headers()['cache-control'] ?? '').not.toMatch(/\bpublic\b/i)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
    await expect(page.locator('meta[property="og:title"]')).toHaveCount(0)
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0)
  })
})

test('PREV-23 long saved content remains within responsive app viewport', async ({ browser }) => {
  const { page } = await login(browser, 'creator')
  await test.step('PREV_LAYOUT', async () => {
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 })
      await open(page, fixture('DRAFT').id)
      const dimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }))
      expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport)
      await expect(page.getByRole('heading', { name: `${manifest.namespace} DRAFT` })).toBeVisible()
    }
  })
})
