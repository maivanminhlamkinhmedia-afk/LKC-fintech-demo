import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import type { Article } from '@prisma/client'
import { connectStaging, demand, STAGING_BASE_URL } from '../../scripts/cms-e2e/guard.mjs'
import { loadManifest, saveManifest, discoverFixtureGraph, fixtureArticle, fixtureClassification, fixtureCatalog,
  catalogCreateData, reserveCatalogIntent, alterFixture } from '../../scripts/cms-e2e/fixtures.mjs'
import { observeTaxonomyActions, holdTaxonomyResponses, type TaxonomyAction } from './cms-taxonomy-support'
import { countArticleActions, holdActionResponses, pauseEditorClock } from './cms-autosave-support'
import { holdSourceResponses } from './cms-sources-support'

type Actor = 'creator' | 'other' | 'admin' | 'super' | 'analyst' | 'client'
type Kind = 'category' | 'topic' | 'tag' | 'instrument'
type Catalog = { kind: Kind; id: string; seedKey: string | null; identity: { slug?: string; canonicalKey?: string } }
type Manifest = { version: number; runId: string; namespace: string;
  users: { key: Actor; id: string; email: string; role: string }[];
  articles: { id: string; key: string; authorId: string }[]; catalogs: Catalog[] }
type CatalogInput = { name: string; slug?: string; description?: string | null; sortOrder?: number; isActive?: boolean;
  symbol?: string; instrumentType?: string; exchange?: string | null; countryCode?: string | null; currency?: string | null }
let manifest: Manifest, db: Awaited<ReturnType<typeof connectStaging>>
let credentials: Record<Actor, { email: string; password: string }>, sequence = 0
const contexts: BrowserContext[] = [], releases: (() => void)[] = []
const observations = new WeakMap<Page, ReturnType<typeof observeTaxonomyActions>>()
const labels = { category: 'Chuyên mục', topic: 'Chủ đề', tag: 'Thẻ', instrument: 'Công cụ tài chính' }
const kinds: Kind[] = ['category', 'topic', 'tag', 'instrument']
const persist = (value: unknown) => saveManifest(process.env.CMS_E2E_MANIFEST, value)
const recover = () => test.step('TAX_GRAPH_RECOVER', () => discoverFixtureGraph(db, process.env, manifest, persist))
const userId = (key: Actor) => manifest.users.find(user => user.key === key)!.id
const path = (id: string) => `/creator/articles/${id}/classification`
const keyOf = (term: Catalog) => term.identity.slug ?? term.identity.canonicalKey!
const seed = (kind: Kind, number = 1) => manifest.catalogs.find(term => term.kind === kind && term.seedKey === `seed-${String(number).padStart(2, '0')}`)!
const saveCatalog = (page: Page) => page.getByRole('button', { name: 'Lưu danh mục', exact: true })
const saveSelection = (page: Page) => page.getByRole('button', { name: 'Lưu phân loại', exact: true })
const error = (page: Page, code: string) => page.locator(`[data-error-code="${code}"]`)
const item = (page: Page, id: string) => page.locator(`li[data-taxonomy-id="${id}"]`)
const selected = (page: Page, term: Catalog) => page.locator(`[data-selected-kind="${term.kind}"][data-taxonomy-id="${term.id}"]`)
const read = async (id: string) => await fixtureArticle(db, manifest, id) as Article
const graph = async (id: string) => {
  await recover()
  return test.step('TAX_GRAPH_SNAPSHOT', () => fixtureClassification(db, manifest, id))
}
const preserved = (row: Article) => { const { updatedAt: _token, categoryId: _category, ...rest } = row; void _token; void _category; return rest }
const acknowledged = (page: Page) => expect(page.getByRole('status').filter({ hasText: /^Đã lưu phân loại\.$/ })).toBeVisible()
const observer = (page: Page) => {
  let result = observations.get(page)
  if (!result) { result = observeTaxonomyActions(page); observations.set(page, result) }
  return result
}
async function login(browser: Browser, actor: Actor = 'creator') {
  const context = await browser.newContext({ baseURL: STAGING_BASE_URL }); contexts.push(context)
  const page = await context.newPage(); observer(page)
  try {
    await page.goto('/dang-nhap'); await page.getByLabel('Email', { exact: true }).fill(credentials[actor].email)
    await page.getByLabel('Mật khẩu', { exact: true }).fill(credentials[actor].password)
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click(); await expect(page).toHaveURL(/\/dashboard$/)
  } catch { throw new Error(`Fixture login failed for ${actor}; details suppressed`) }
  await page.clock.install(); return { page, context }
}
async function article(page: Page, suffix: string) {
  await page.clock.resume(); await page.goto('/creator/articles/new')
  await expect(page.getByRole('textbox', { name: 'Nội dung bài viết', exact: true })).toBeVisible()
  await page.getByLabel('Tiêu đề', { exact: true }).fill(`Phân loại ${suffix}`)
  await page.getByLabel('Slug', { exact: true }).fill(`${manifest.namespace}-tax-${suffix}-${++sequence}`)
  await page.getByRole('button', { name: 'Lưu nháp', exact: true }).click()
  await expect(page).toHaveURL(/\/creator\/articles\/[^/]+\/edit$/)
  await expect(page.getByRole('status').filter({ hasText: /^Đã lưu$/ })).toBeVisible()
  const id = new URL(page.url()).pathname.split('/').at(-2)!
  await recover(); demand(manifest.articles.some(row => row.id === id), 'UI_ARTICLE_NOT_RECORDED'); return id
}
async function open(page: Page, id: string) {
  observer(page); await page.goto(path(id)); await expect(page.getByRole('heading', { name: 'Phân loại bài viết', exact: true })).toBeVisible()
  await observer(page).ready('updateArticleClassification', 'searchArticleClassificationOptions')
}
async function catalog(page: Page, kind: Kind, q = '') {
  observer(page); await page.goto(`/creator/taxonomy?kind=${kind}&q=${encodeURIComponent(q)}`)
  await expect(page.getByRole('heading', { name: 'Danh mục phân loại', exact: true })).toBeVisible()
  await observer(page).ready('createTaxonomy', 'updateTaxonomy', 'deleteTaxonomy', 'searchTaxonomy')
}
async function choose(page: Page, term: Catalog, checked = true) {
  await page.getByRole('button', { name: labels[term.kind], exact: true }).click()
  await page.getByLabel('Tìm danh mục', { exact: true }).fill(keyOf(term))
  await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
  const input = page.locator(`fieldset[data-classification-kind="${term.kind}"] input[data-taxonomy-id="${term.id}"]`)
  await expect(input).toBeVisible(); await input.setChecked(checked)
}
async function confirm(page: Page, trigger: () => Promise<unknown>, accept: boolean, type = 'confirm') {
  const handled = page.waitForEvent('dialog').then(async dialog => {
    expect(dialog.type()).toBe(type); if (accept) await dialog.accept(); else await dialog.dismiss()
  })
  await Promise.all([trigger(), handled])
}
async function hold(page: Page, ...actions: TaxonomyAction[]) {
  await observer(page).ready(...actions)
  const barrier = await holdTaxonomyResponses(page, observer(page).ids, actions); releases.push(barrier.dispose); return barrier
}
async function fillCatalog(page: Page, kind: Kind, input: CatalogInput) {
  await page.getByLabel('Tên', { exact: true }).fill(input.name)
  if (kind === 'instrument') {
    await page.getByLabel('Mã công cụ', { exact: true }).fill(input.symbol!)
    await page.getByLabel('Loại công cụ', { exact: true }).selectOption(input.instrumentType!)
    await page.getByLabel('Sàn giao dịch', { exact: true }).fill(input.exchange ?? '')
    await page.getByLabel('Mã quốc gia', { exact: true }).fill(input.countryCode ?? '')
    await page.getByLabel('Tiền tệ', { exact: true }).fill(input.currency ?? '')
  } else await page.getByLabel('Slug', { exact: true }).fill(input.slug!)
  if (kind === 'category' || kind === 'topic') await page.getByLabel('Mô tả', { exact: true }).fill(input.description ?? '')
  if (kind === 'category') await page.getByLabel('Thứ tự', { exact: true }).fill(String(input.sortOrder))
  if (kind !== 'tag') await page.getByLabel('Đang hoạt động', { exact: true }).setChecked(input.isActive!)
}
async function beginCatalog(page: Page, kind: Kind, suffix: string, overrides: Partial<CatalogInput> = {}) {
  const input = catalogCreateData(manifest, kind, suffix, overrides) as CatalogInput
  await reserveCatalogIntent(db, process.env, manifest, kind, suffix, input, persist)
  await catalog(page, kind); await page.getByRole('button', { name: 'Thêm danh mục', exact: true }).click()
  await fillCatalog(page, kind, input); return input
}
async function createdTerm(kind: Kind, input: CatalogInput) {
  await recover()
  const expected = kind === 'instrument' ? (input.instrumentType === 'FX' || input.instrumentType === 'CRYPTO'
    ? `${input.instrumentType}:${input.symbol}` : input.exchange ? `${input.exchange}:${input.symbol}` : input.symbol) : input.slug
  const term = manifest.catalogs.find(row => row.kind === kind && keyOf(row) === expected)
  demand(term, 'UI_CATALOG_NOT_RECORDED'); return term!
}
async function createCatalog(page: Page, kind: Kind, suffix: string, overrides: Partial<CatalogInput> = {}) {
  const input = await beginCatalog(page, kind, suffix, overrides)
  const barrier = await hold(page, 'createTaxonomy'); await saveCatalog(page).click(); await barrier.ready()
  const term = await createdTerm(kind, input); barrier.release()
  await expect(saveCatalog(page)).toBeEnabled(); await expect(error(page, 'INTERNAL_ERROR')).toHaveCount(0)
  return { term, input }
}
async function editCatalog(page: Page, term: Catalog) {
  await catalog(page, term.kind, keyOf(term)); await item(page, term.id).getByRole('button', { name: /^Sửa / }).click()
}
async function saveClass(page: Page) { await saveSelection(page).click(); await acknowledged(page) }
async function tab(context: BrowserContext) { const page = await context.newPage(); observer(page); await page.clock.install(); return page }
async function source(page: Page, id: string, title: string) {
  await page.goto(`/creator/articles/${id}/sources`); await page.getByRole('button', { name: 'Thêm nguồn', exact: true }).click()
  await page.getByLabel('Tên tài liệu', { exact: true }).fill(title)
  await page.getByRole('button', { name: 'Lưu nguồn', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: /^Đã lưu nguồn\.$/ })).toBeVisible(); await recover()
  return db.sourceReference.findFirstOrThrow({ where: { articleId: id, title } })
}

test.beforeAll(async () => {
  demand(process.env.CMS_E2E_RUNNING === 'YES', 'USE_GUARDED_STAGING_RUNNER')
  manifest = await loadManifest(process.env.CMS_E2E_MANIFEST) as Manifest
  demand(manifest.version === 3 && manifest.runId === process.env.CMS_E2E_RUN_ID, 'RUN_PROVENANCE_MISMATCH')
  credentials = JSON.parse(process.env.CMS_E2E_CREDENTIALS ?? '{}'); db = await connectStaging(process.env)
})
test.afterEach(async () => {
  await test.step('TAX_TEARDOWN_DISPOSE', async () => { for (const release of releases.splice(0)) release() })
  try {
    await test.step('TAX_TEARDOWN_CONTEXT_CLOSE', async () => { await Promise.all(contexts.splice(0).map(context => context.close())) })
  } finally {
    await test.step('TAX_TEARDOWN_RECOVER', async () => { if (db) await recover() })
  }
})
test.afterAll(async () => {
  await test.step('TAX_TEARDOWN_DISCONNECT', async () => { if (db) await db.$disconnect() })
})

test('TAX-01 protected catalog and classification enforce anonymous role and ownership scope', async ({ browser }) => {
  await test.step('TAX_ACCESS', async () => {
    const { page } = await login(browser); const id = await article(page, 'access')
    const context = await browser.newContext({ baseURL: STAGING_BASE_URL }); contexts.push(context)
    const anonymous = await context.newPage()
    for (const url of ['/creator/taxonomy', path(id)]) { await anonymous.goto(url); await expect(anonymous).toHaveURL(/\/dang-nhap(?:\?|$)/) }
    for (const actor of ['creator', 'other', 'analyst', 'client'] as const) {
      const session = await login(browser, actor); await session.page.goto('/creator/taxonomy'); await expect(session.page).toHaveURL(/\/dashboard$/)
      await session.page.goto(path(id))
      if (actor === 'creator') await expect(saveSelection(session.page)).toBeVisible()
      else { await expect(saveSelection(session.page)).toHaveCount(0); await expect(session.page.getByText('Phân loại access', { exact: true })).toHaveCount(0) }
    }
  })
})

for (const actor of ['admin', 'super'] as const) test(`TAX-02 ${actor} creates all four catalog kinds through real forms`, async ({ browser }) => {
  await test.step('TAX_CATALOG_CREATE', async () => {
    const { page } = await login(browser, actor)
    for (const kind of kinds) {
      const { term, input } = await createCatalog(page, kind, `${actor}-${kind}`, { name: `Tên Việt ${actor} ${kind}` })
      const row = await fixtureCatalog(db, manifest, kind, term.id)
      expect(row.name).toBe(input.name); expect(kind === 'instrument' ? row.canonicalKey : row.slug).toBe(keyOf(term))
      await catalog(page, kind, keyOf(term)); await expect(item(page, term.id)).toContainText(input.name)
    }
  })
})

test('TAX-03 catalog metadata edits preserve identity article tokens and source rows', async ({ browser }) => {
  await test.step('TAX_CATALOG_METADATA', async () => {
    const { page } = await login(browser, 'admin'); const id = await article(page, 'catalog-preserved')
    const src = await source(page, id, 'Nguồn không đổi'); const before = await read(id)
    for (const kind of kinds) {
      const term = seed(kind, 2), row = await fixtureCatalog(db, manifest, kind, term.id)
      await editCatalog(page, term); await page.getByLabel('Tên', { exact: true }).fill(`Tên đã sửa ${kind}`)
      if (kind === 'category') await page.getByLabel('Thứ tự', { exact: true }).fill('-12')
      if (kind !== 'tag') await page.getByLabel('Đang hoạt động', { exact: true }).uncheck()
      else await expect(page.getByLabel('Đang hoạt động', { exact: true })).toHaveCount(0)
      const barrier = await hold(page, 'updateTaxonomy'); await saveCatalog(page).click(); await barrier.ready()
      const updated = await fixtureCatalog(db, manifest, kind, term.id)
      expect(updated.name).toBe(`Tên đã sửa ${kind}`); expect(updated.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime())
      expect(kind === 'instrument' ? updated.canonicalKey : updated.slug).toBe(keyOf(term)); expect(updated.createdAt).toEqual(row.createdAt)
      expect(await read(id)).toEqual(before); expect(await db.sourceReference.findUnique({ where: { id: src.id } })).toEqual(src)
      barrier.release(); await expect(saveCatalog(page)).toBeEnabled()
    }
  })
})

test('TAX-05 instrument canonical identity normalizes case rejects reserved venue and duplicate key', async ({ browser }) => {
  await test.step('TAX_INSTRUMENT_IDENTITY', async () => {
    const { page } = await login(browser, 'admin')
    const input = await beginCatalog(page, 'instrument', 'canonical', { instrumentType: 'EQUITY', exchange: 'HOSE', countryCode: 'VN', currency: 'VND' })
    await page.getByLabel('Mã công cụ', { exact: true }).fill(` ${input.symbol!.toLowerCase()} `)
    await page.getByLabel('Sàn giao dịch', { exact: true }).fill(' fx ')
    await saveCatalog(page).click(); await expect(error(page, 'VALIDATION_ERROR')).toBeVisible()
    await page.getByLabel('Sàn giao dịch', { exact: true }).fill(' hose ')
    const barrier = await hold(page, 'createTaxonomy'); await saveCatalog(page).click(); await barrier.ready()
    const term = await createdTerm('instrument', input); barrier.release(); await expect(saveCatalog(page)).toBeEnabled()
    expect((await fixtureCatalog(db, manifest, 'instrument', term.id)).canonicalKey).toBe(`HOSE:${input.symbol}`)
    await editCatalog(page, term); await expect(page.locator('[data-taxonomy-identity]')).toHaveText(keyOf(term))
    await expect(page.getByLabel('Mã công cụ', { exact: true })).toHaveCount(0)
    await expect(page.getByLabel('Sàn giao dịch', { exact: true })).toHaveCount(0)
    await catalog(page, 'instrument'); await page.getByRole('button', { name: 'Thêm danh mục', exact: true }).click()
    await fillCatalog(page, 'instrument', { ...input, instrumentType: 'FUND' }); await saveCatalog(page).click()
    await expect(error(page, 'IDENTITY_CONFLICT')).toBeVisible(); await expect(page.getByLabel('Tên', { exact: true })).toHaveValue(input.name)
    expect((await fixtureCatalog(db, manifest, 'instrument', term.id)).instrumentType).toBe('EQUITY')
  })
})

test('TAX-06 catalog stale token conflicts future timestamps advance and no-op does not write', async ({ browser }) => {
  await test.step('TAX_CATALOG_TOKEN', async () => {
    const { page } = await login(browser, 'admin'), term = seed('topic', 3)
    const future = new Date(Date.now() + 3_600_000)
    await alterFixture(db, process.env, manifest, 'topic', term.id, { updatedAt: future }, persist)
    await editCatalog(page, term); const { page: other } = await login(browser, 'super'); await editCatalog(other, term)
    const unchanged = await fixtureCatalog(db, manifest, 'topic', term.id)
    const noop = await hold(page, 'updateTaxonomy'); await saveCatalog(page).click(); await noop.ready()
    expect(await fixtureCatalog(db, manifest, 'topic', term.id)).toEqual(unchanged); noop.release(); await expect(saveCatalog(page)).toBeEnabled()
    await page.getByLabel('Tên', { exact: true }).fill('Catalog thắng'); await other.getByLabel('Tên', { exact: true }).fill('Catalog thua')
    const winner = await hold(page, 'updateTaxonomy'); await saveCatalog(page).click(); await winner.ready()
    expect((await fixtureCatalog(db, manifest, 'topic', term.id)).updatedAt.getTime()).toBe(future.getTime() + 1)
    await saveCatalog(other).click(); await expect(error(other, 'EDIT_CONFLICT')).toBeVisible()
    await expect(other.getByLabel('Tên', { exact: true })).toHaveValue('Catalog thua'); await expect(saveCatalog(other)).toBeDisabled()
    winner.release(); await expect(saveCatalog(page)).toBeEnabled()
    await page.getByLabel('Tên', { exact: true }).fill('Catalog tiếp theo')
    const next = await hold(page, 'updateTaxonomy'); await saveCatalog(page).click(); await next.ready()
    expect((await fixtureCatalog(db, manifest, 'topic', term.id)).updatedAt.getTime()).toBe(future.getTime() + 2); next.release()
  })
})

test('TAX-07 inactive attachments remain visible removable and cannot be newly added', async ({ browser }) => {
  await test.step('TAX_INACTIVE', async () => {
    const { page } = await login(browser), id = await article(page, 'inactive'), terms = [seed('category', 4), seed('topic', 4), seed('instrument', 4)]
    await open(page, id); for (const term of terms) await choose(page, term); await saveClass(page); await recover()
    for (const term of terms) await alterFixture(db, process.env, manifest, term.kind, term.id, { isActive: false }, persist)
    await page.reload(); await acknowledgedReadonlyLoad(page)
    for (const term of terms) { await expect(selected(page, term)).toBeVisible(); await expect(selected(page, term)).toContainText('Không hoạt động') }
    const inst = await fixtureCatalog(db, manifest, 'instrument', terms[2].id)
    await page.getByLabel(`Chính: ${inst.name}`, { exact: true }).check(); await saveClass(page)
    expect((await graph(id)).articleInstruments).toEqual([{ articleId: id, instrumentId: terms[2].id, isPrimary: true }])
    for (const term of terms) await selected(page, term).getByRole('button', { name: /^Gỡ / }).click()
    await saveClass(page); expect((await graph(id)).article.categoryId).toBeNull()
    for (const term of terms) {
      await page.getByRole('button', { name: labels[term.kind], exact: true }).click()
      await page.getByLabel('Tìm danh mục', { exact: true }).fill(keyOf(term)); await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
      await expect(page.getByText('Không có lựa chọn phù hợp.', { exact: true })).toBeVisible()
      await expect(page.locator(`fieldset input[data-taxonomy-id="${term.id}"]`)).toHaveCount(0)
      await alterFixture(db, process.env, manifest, term.kind, term.id, { isActive: true }, persist)
      await choose(page, term)
    }
    // Stale option eligibility is re-read in the transaction, not trusted from UI.
    await alterFixture(db, process.env, manifest, 'category', terms[0].id, { isActive: false }, persist)
    const before = await read(id); await saveSelection(page).click(); await expect(error(page, 'INVALID_SELECTION')).toBeVisible()
    expect(await read(id)).toEqual(before); await expect(selected(page, terms[0])).toBeVisible()
  })
})
async function acknowledgedReadonlyLoad(page: Page) { await expect(page.getByRole('heading', { name: 'Phân loại bài viết', exact: true })).toBeVisible() }

test('TAX-08 delete cancel unused rows and used guards preserve category and every mapping', async ({ browser }) => {
  await test.step('TAX_DELETE_GUARDS', async () => {
    const { page, context } = await login(browser, 'admin'), id = await article(page, 'delete-guards')
    await open(page, id); for (const kind of kinds) await choose(page, seed(kind, 5)); await saveClass(page)
    const before = await graph(id), panel = await tab(context)
    for (const kind of kinds) {
      const used = seed(kind, 5); await catalog(panel, kind, keyOf(used))
      await confirm(panel, () => item(panel, used.id).getByRole('button', { name: /^Xóa / }).click(), true)
      await expect(error(panel, 'TAXONOMY_IN_USE')).toBeVisible(); expect(await graph(id)).toEqual(before)
      const unused = seed(kind, 6); await catalog(panel, kind, keyOf(unused))
      await confirm(panel, () => item(panel, unused.id).getByRole('button', { name: /^Xóa / }).click(), false)
      await expect(item(panel, unused.id)).toBeVisible()
      await confirm(panel, () => item(panel, unused.id).getByRole('button', { name: /^Xóa / }).click(), true)
      await expect(item(panel, unused.id)).toHaveCount(0); await recover()
    }
    expect(await graph(id)).toEqual(before)
  })
})

test('TAX-09 bounded search pagination retains selected outside current page without writes', async ({ browser }) => {
  await test.step('TAX_SEARCH_PAGING', async () => {
    const { page } = await login(browser, 'admin'); await catalog(page, 'tag', `${manifest.namespace}-tax-tag-seed`)
    expect(await page.locator('li[data-taxonomy-id]').count()).toBe(25)
    const first = await page.locator('li[data-taxonomy-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-taxonomy-id')))
    await page.getByRole('button', { name: 'Trang sau', exact: true }).click()
    await expect(page.getByText(/danh mục · Trang 2\//)).toBeVisible()
    expect(await page.locator('li[data-taxonomy-id]').count()).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Trang trước', exact: true }).click()
    await expect(page.getByText(/danh mục · Trang 1\//)).toBeVisible()
    expect(await page.locator('li[data-taxonomy-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-taxonomy-id')))).toEqual(first)
    const id = await article(page, 'paging'); await open(page, id); const before = await read(id)
    await choose(page, seed('tag', 1)); await choose(page, seed('tag', 26))
    await page.getByLabel('Tìm danh mục', { exact: true }).fill('no-match-tax-synthetic'); await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click()
    await expect(page.getByText('Không có lựa chọn phù hợp.', { exact: true })).toBeVisible()
    await expect(page.locator('fieldset input[data-taxonomy-id]')).toHaveCount(0)
    await expect(selected(page, seed('tag', 1))).toBeVisible(); await expect(selected(page, seed('tag', 26))).toBeVisible()
    expect(observer(page).count('updateArticleClassification', 'createTaxonomy', 'updateTaxonomy', 'deleteTaxonomy')).toBe(0)
    expect(await read(id)).toEqual(before)
  })
})

test('TAX-10/11 classification round trip primary replacement clear and no-op preserve unrelated fields', async ({ browser }) => {
  // Six saves, five reloads and graph checks reached 60s in staging, cutting short an expect before its own timeout.
  test.setTimeout(120_000)
  await test.step('TAX_SELECTION_ROUNDTRIP', async () => {
    const { page, id, src, before, instrument } = await test.step('TAX_ROUNDTRIP_SETUP', async () => {
      const { page } = await login(browser), id = await article(page, 'roundtrip')
      const src = await source(page, id, 'Nguồn cần giữ'); const before = await read(id)
      await open(page, id); for (const kind of kinds) await choose(page, seed(kind, 1))
      await choose(page, seed('instrument', 7)); const instrument = await fixtureCatalog(db, manifest, 'instrument', seed('instrument', 7).id)
      return { page, id, src, before, instrument }
    })
    const saved = await test.step('TAX_ROUNDTRIP_INITIAL_SAVE', async () => {
      await page.getByLabel(`Chính: ${instrument.name}`, { exact: true }).check(); await saveClass(page)
      const saved = await graph(id)
      expect(saved.article.categoryId).toBe(seed('category', 1).id)
      expect(saved.topicMappings).toEqual([{ articleId: id, topicId: seed('topic', 1).id }])
      expect(saved.tagMappings).toEqual([{ articleId: id, tagId: seed('tag', 1).id }])
      expect(saved.articleInstruments.filter((row: { isPrimary: boolean }) => row.isPrimary).map((row: { instrumentId: string }) => row.instrumentId)).toEqual([seed('instrument', 7).id])
      expect(preserved(saved.article)).toEqual(preserved(before)); expect(await db.sourceReference.findUnique({ where: { id: src.id } })).toEqual(src)
      await page.reload(); await acknowledgedReadonlyLoad(page)
      for (const kind of kinds) await expect(selected(page, seed(kind, 1))).toBeVisible()
      await expect(page.getByLabel(`Chính: ${instrument.name}`, { exact: true })).toBeChecked()
      return saved
    })
    await test.step('TAX_ROUNDTRIP_NOOP', async () => {
      const noop = await test.step('TAX_ROUNDTRIP_OBSERVER_READY', () => hold(page, 'updateArticleClassification')); await saveSelection(page).click(); await test.step('TAX_ROUNDTRIP_RESPONSE_READY', () => noop.ready())
      expect(await graph(id)).toEqual(saved); noop.release(); await test.step('TAX_ROUNDTRIP_ACK', () => acknowledged(page))
    })
    await test.step('TAX_ROUNDTRIP_PRIMARY_SWITCH', async () => {
      // Persist the primary change separately from removal, proving 0/1 primary
      // while both instrument mappings continue to exist, then verify reload.
      const otherInstrument = await fixtureCatalog(db, manifest, 'instrument', seed('instrument', 1).id)
      await page.getByLabel(`Chính: ${otherInstrument.name}`, { exact: true }).check()
      const switchPrimary = await test.step('TAX_ROUNDTRIP_OBSERVER_READY', () => hold(page, 'updateArticleClassification')); await saveSelection(page).click(); await test.step('TAX_ROUNDTRIP_RESPONSE_READY', () => switchPrimary.ready())
      const switched = await graph(id)
      expect(switched.articleInstruments.map((row: { instrumentId: string }) => row.instrumentId).sort()).toEqual([seed('instrument', 1).id, seed('instrument', 7).id].sort())
      expect(switched.articleInstruments.filter((row: { isPrimary: boolean }) => row.isPrimary).map((row: { instrumentId: string }) => row.instrumentId)).toEqual([seed('instrument', 1).id])
      expect(preserved(switched.article)).toEqual(preserved(before)); switchPrimary.release(); await test.step('TAX_ROUNDTRIP_ACK', () => acknowledged(page))
      await page.reload(); await acknowledgedReadonlyLoad(page)
      await expect(page.getByLabel(`Chính: ${otherInstrument.name}`, { exact: true })).toBeChecked()
      await expect(page.getByLabel(`Chính: ${instrument.name}`, { exact: true })).not.toBeChecked()
    })
    await test.step('TAX_ROUNDTRIP_PRIMARY_CLEAR', async () => {
      await page.getByLabel('Không chọn công cụ chính', { exact: true }).check()
      const clearPrimary = await test.step('TAX_ROUNDTRIP_OBSERVER_READY', () => hold(page, 'updateArticleClassification')); await saveSelection(page).click(); await test.step('TAX_ROUNDTRIP_RESPONSE_READY', () => clearPrimary.ready())
      const withoutPrimary = await graph(id)
      expect(withoutPrimary.articleInstruments.map((row: { instrumentId: string }) => row.instrumentId).sort()).toEqual([seed('instrument', 1).id, seed('instrument', 7).id].sort())
      expect(withoutPrimary.articleInstruments.every((row: { isPrimary: boolean }) => row.isPrimary === false)).toBe(true)
      expect(preserved(withoutPrimary.article)).toEqual(preserved(before)); clearPrimary.release(); await test.step('TAX_ROUNDTRIP_ACK', () => acknowledged(page))
      await page.reload(); await acknowledgedReadonlyLoad(page)
      await expect(page.getByLabel('Không chọn công cụ chính', { exact: true })).toBeChecked()
      for (const term of [seed('instrument', 1), seed('instrument', 7)]) await expect(selected(page, term)).toBeVisible()
    })
    const replacements = await test.step('TAX_ROUNDTRIP_REPLACE', async () => {
      // A nonempty replacement is distinct from clearing the entire snapshot.
      for (const term of [seed('topic', 1), seed('tag', 1), seed('instrument', 1)]) {
        await selected(page, term).getByRole('button', { name: /^Gỡ / }).click()
      }
      const replacements = [seed('category', 7), seed('topic', 7), seed('tag', 7), seed('instrument', 8)]
      await test.step('TAX_REPLACE_CATEGORY', () => choose(page, replacements[0]))
      await test.step('TAX_REPLACE_TOPIC', () => choose(page, replacements[1]))
      await test.step('TAX_REPLACE_TAG', () => choose(page, replacements[2]))
      await test.step('TAX_REPLACE_INSTRUMENT', () => choose(page, replacements[3]))
      const replaceSelection = await test.step('TAX_ROUNDTRIP_OBSERVER_READY', () => hold(page, 'updateArticleClassification')); await saveSelection(page).click(); await test.step('TAX_ROUNDTRIP_RESPONSE_READY', () => replaceSelection.ready())
      const replaced = await graph(id)
      expect(replaced.article.categoryId).toBe(seed('category', 7).id)
      expect(replaced.topicMappings).toEqual([{ articleId: id, topicId: seed('topic', 7).id }])
      expect(replaced.tagMappings).toEqual([{ articleId: id, tagId: seed('tag', 7).id }])
      expect(replaced.articleInstruments.map((row: { instrumentId: string }) => row.instrumentId).sort()).toEqual([seed('instrument', 7).id, seed('instrument', 8).id].sort())
      expect(replaced.articleInstruments.every((row: { isPrimary: boolean }) => row.isPrimary === false)).toBe(true)
      expect(preserved(replaced.article)).toEqual(preserved(before)); expect(await db.sourceReference.findUnique({ where: { id: src.id } })).toEqual(src)
      replaceSelection.release(); await test.step('TAX_ROUNDTRIP_ACK', () => acknowledged(page)); await page.reload(); await acknowledgedReadonlyLoad(page)
      for (const term of [...replacements, seed('instrument', 7)]) await expect(selected(page, term)).toBeVisible()
      for (const kind of kinds) await expect(selected(page, seed(kind, 1))).toHaveCount(0)
      return replacements
    })
    await test.step('TAX_ROUNDTRIP_CLEAR', async () => {
      for (const term of [...replacements, seed('instrument', 7)]) {
        await selected(page, term).getByRole('button', { name: /^Gỡ / }).click()
      }
      await saveClass(page); const cleared = await graph(id)
      expect(cleared.article.categoryId).toBeNull(); expect(cleared.topicMappings).toEqual([]); expect(cleared.tagMappings).toEqual([]); expect(cleared.articleInstruments).toEqual([])
      expect(preserved(cleared.article)).toEqual(preserved(before))
      await page.reload(); await acknowledgedReadonlyLoad(page)
      await expect(page.locator('[data-selected-kind]')).toHaveCount(0)
      await expect(page.getByLabel('Không chọn công cụ chính', { exact: true })).toBeChecked()
    })
  })
})

test('TAX-13 admin and super classify foreign articles without changing owner or source creator', async ({ browser }) => {
  await test.step('TAX_ASSIGNMENT_SCOPE', async () => {
    const owner = await login(browser), id = await article(owner.page, 'scope'), src = await source(owner.page, id, 'Nguồn owner')
    for (const actor of ['admin', 'super'] as const) {
      const { page } = await login(browser, actor); await open(page, id); await choose(page, seed('tag', actor === 'admin' ? 8 : 9)); await saveClass(page)
      const snapshot = await graph(id); expect(snapshot.article.authorId).toBe(userId('creator'))
      expect((await db.sourceReference.findUniqueOrThrow({ where: { id: src.id } })).createdById).toBe(src.createdById)
    }
  })
})

test('TAX-14 editable statuses and unsupported documents preserve readonly selected metadata', async ({ browser }) => {
  await test.step('TAX_READ_ONLY', async () => {
    const { page } = await login(browser, 'admin'), id = await article(page, 'statuses')
    await open(page, id); await choose(page, seed('tag', 10)); await saveClass(page); await recover()
    await alterFixture(db, process.env, manifest, 'article', id, { status: 'CHANGES_REQUESTED' }, persist)
    await open(page, id); await choose(page, seed('tag', 11)); await saveClass(page); await recover()
    for (const status of ['SUBMITTED', 'EDITORIAL_REVIEW', 'FACT_CHECK', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'CORRECTED', 'ARCHIVED']) {
      await alterFixture(db, process.env, manifest, 'article', id, { status }, persist); await open(page, id)
      await expect(saveSelection(page)).toHaveCount(0); await expect(selected(page, seed('tag', 10))).toBeVisible()
    }
    await alterFixture(db, process.env, manifest, 'article', id, { status: 'DRAFT', editorSchemaVersion: 2 }, persist)
    await open(page, id); await expect(page.locator('[data-read-only-reason="UNSUPPORTED_DOCUMENT"]')).toBeVisible()
    await expect(saveSelection(page)).toHaveCount(0); await expect(selected(page, seed('tag', 10))).toBeVisible()
  })
})

test('TAX-15 simultaneous classification tabs have one winner and preserve the losing selection', async ({ browser }) => {
  await test.step('TAX_TWO_TABS', async () => {
    const { page, context } = await login(browser), id = await article(page, 'two-tabs'), other = await tab(context)
    await open(page, id); await open(other, id)
    await choose(page, seed('tag', 12)); await choose(other, seed('tag', 13))
    await Promise.all([saveSelection(page).click(), saveSelection(other).click()])
    await expect.poll(async () => await error(page, 'EDIT_CONFLICT').count() + await error(other, 'EDIT_CONFLICT').count()).toBe(1)
    const loser = await error(page, 'EDIT_CONFLICT').count() ? page : other
    const losing = seed('tag', loser === page ? 12 : 13), winning = seed('tag', loser === page ? 13 : 12)
    await expect(selected(loser, losing)).toBeVisible(); await expect(saveSelection(loser)).toBeDisabled()
    expect((await graph(id)).tagMappings).toEqual([{ articleId: id, tagId: winning.id }])
    const count = observer(loser).count('updateArticleClassification'); await loser.clock.runFor(5000)
    expect(observer(loser).count('updateArticleClassification')).toBe(count)
    await confirm(loser, () => loser.getByRole('button', { name: 'Tải lại bản mới nhất', exact: true }).click(), true)
    await expect(selected(loser, winning)).toBeVisible(); await expect(selected(loser, losing)).toHaveCount(0)
  })
})

for (const first of ['classification', 'autosave'] as const) test(`TAX-16 ${first} wins against the other stale article surface`, async ({ browser }) => {
  await test.step('TAX_AUTOSAVE_CONFLICT', async () => {
    const { page, context } = await login(browser), id = await article(page, `body-${first}`), panel = await tab(context)
    await pauseEditorClock(page); await open(panel, id); await choose(panel, seed('tag', 14)); const before = await read(id)
    await page.getByLabel('Tiêu đề', { exact: true }).fill('Nội dung cạnh tranh phân loại')
    if (first === 'classification') {
      const barrier = await hold(panel, 'updateArticleClassification'); await saveSelection(panel).click(); await barrier.ready()
      expect((await graph(id)).tagMappings).toHaveLength(1)
      await page.clock.runFor(2000); await expect(error(page, 'EDIT_CONFLICT')).toBeVisible(); barrier.release(); await acknowledged(panel)
      expect((await read(id)).title).toBe(before.title); await expect(page.getByLabel('Tiêu đề', { exact: true })).toHaveValue('Nội dung cạnh tranh phân loại')
    } else {
      const barrier = await holdActionResponses(page); releases.push(barrier.dispose)
      await page.clock.runFor(2000); await barrier.ready(); expect((await read(id)).title).toBe('Nội dung cạnh tranh phân loại')
      await saveSelection(panel).click(); await expect(error(panel, 'EDIT_CONFLICT')).toBeVisible(); barrier.release()
      await expect(selected(panel, seed('tag', 14))).toBeVisible(); expect((await graph(id)).tagMappings).toEqual([])
    }
    const count = observer(panel).count('updateArticleClassification'); await panel.clock.runFor(5000)
    expect(observer(panel).count('updateArticleClassification')).toBe(count)
  })
})

for (const operation of ['create', 'update', 'delete'] as const) for (const first of ['classification', 'source'] as const) {
  test(`TAX-17 ${first} wins against source ${operation} with the shared article token`, async ({ browser }) => {
    await test.step('TAX_SOURCE_CONFLICT', async () => {
      const { page, context } = await login(browser), id = await article(page, `source-${operation}-${first}`)
      const src = operation === 'create' ? null : await source(page, id, 'Nguồn trước race')
      await page.goto(`/creator/articles/${id}/sources`)
      if (operation === 'create') await page.getByRole('button', { name: 'Thêm nguồn', exact: true }).click()
      if (operation === 'update') await page.locator(`li[data-source-id="${src!.id}"]`).getByRole('button', { name: /^Sửa nguồn / }).click()
      if (operation !== 'delete') await page.getByLabel('Tên tài liệu', { exact: true }).fill('Nguồn sau race')
      const panel = await tab(context); await open(panel, id); await choose(panel, seed('topic', 15)); const before = await read(id)
      const submitSource = () => operation === 'delete'
        ? confirm(page, () => page.locator(`li[data-source-id="${src!.id}"]`).getByRole('button', { name: /^Xóa nguồn / }).click(), true)
        : page.getByRole('button', { name: 'Lưu nguồn', exact: true }).click()
      if (first === 'classification') {
        const barrier = await hold(panel, 'updateArticleClassification'); await saveSelection(panel).click(); await barrier.ready()
        await graph(id); await submitSource(); await expect(error(page, 'EDIT_CONFLICT')).toBeVisible(); barrier.release(); await acknowledged(panel)
      } else {
        const barrier = await holdSourceResponses(page); releases.push(barrier.dispose); await submitSource(); await barrier.ready()
        await recover(); await saveSelection(panel).click(); await expect(error(panel, 'EDIT_CONFLICT')).toBeVisible(); barrier.release()
        await expect(selected(panel, seed('topic', 15))).toBeVisible()
      }
      const current = await graph(id), rows = await db.sourceReference.findMany({ where: { articleId: id } })
      expect(current.topicMappings).toHaveLength(first === 'classification' ? 1 : 0)
      expect(preserved(current.article)).toEqual(preserved(before))
      if (first === 'classification') {
        expect(rows).toEqual(src ? [src] : [])
        if (operation !== 'delete') await expect(page.getByLabel('Tên tài liệu', { exact: true })).toHaveValue('Nguồn sau race')
      } else if (operation === 'delete') expect(rows).toEqual([])
      else { expect(rows).toHaveLength(1); expect(rows[0].title).toBe('Nguồn sau race') }
    })
  })
}

test('TAX-18 classification persists successive future DATETIME millisecond tokens and rejects stale noop', async ({ browser }) => {
  await test.step('TAX_ARTICLE_TOKEN', async () => {
    const { page, context } = await login(browser), id = await article(page, 'precision'), future = new Date(Date.now() + 3_600_000)
    await alterFixture(db, process.env, manifest, 'article', id, { updatedAt: future }, persist)
    await open(page, id); const stale = await tab(context); await open(stale, id)
    await choose(page, seed('tag', 16)); await saveClass(page); expect((await graph(id)).article.updatedAt.getTime()).toBe(future.getTime() + 1)
    await choose(page, seed('tag', 17)); await saveClass(page); expect((await graph(id)).article.updatedAt.getTime()).toBe(future.getTime() + 2)
    await saveSelection(stale).click(); await expect(error(stale, 'EDIT_CONFLICT')).toBeVisible()
    expect((await graph(id)).article.updatedAt.getTime()).toBe(future.getTime() + 2)
  })
})

test('TAX-19 revoked actor or session keeps classification draft and does not redirect mutation', async ({ browser }) => {
  await test.step('TAX_ACTOR_REVOKED', async () => {
    for (const mode of ['suspended', 'demoted', 'expired'] as const) {
      const { page, context } = await login(browser), id = await article(page, `actor-${mode}`)
      await open(page, id); await choose(page, seed('tag', 18)); const before = await graph(id)
      try {
        if (mode === 'expired') await context.clearCookies()
        else await alterFixture(db, process.env, manifest, 'user', userId('creator'), mode === 'suspended' ? { status: 'SUSPENDED' } : { role: 'CLIENT' }, persist)
        await saveSelection(page).click(); await expect(error(page, 'FORBIDDEN')).toBeVisible(); await expect(page).toHaveURL(new RegExp(`${path(id)}$`))
        await expect(selected(page, seed('tag', 18))).toBeVisible(); expect(await graph(id)).toEqual(before)
      } finally { if (mode !== 'expired') await alterFixture(db, process.env, manifest, 'user', userId('creator'), { status: 'ACTIVE', role: 'CREATOR' }, persist) }
    }
  })
})

test('TAX-19 changed article owner or status blocks classification with input preserved', async ({ browser }) => {
  await test.step('TAX_PARENT_REVOKED', async () => {
    for (const mode of ['owner', 'status'] as const) {
      const { page } = await login(browser), id = await article(page, `parent-${mode}`)
      await open(page, id); await choose(page, seed('topic', 18))
      await alterFixture(db, process.env, manifest, 'article', id, mode === 'owner' ? { authorId: userId('other') } : { status: 'SUBMITTED' }, persist)
      const before = await graph(id); await saveSelection(page).click(); await expect(error(page, mode === 'owner' ? 'NOT_FOUND' : 'NOT_EDITABLE')).toBeVisible()
      await expect(selected(page, seed('topic', 18))).toBeVisible(); expect(await graph(id)).toEqual(before)
    }
  })
})

test('TAX-20 revoked admin or expired session stops catalog writes without discarding input', async ({ browser }) => {
  await test.step('TAX_ADMIN_REVOKED', async () => {
    for (const mode of ['suspended', 'demoted', 'expired'] as const) {
      const { page, context } = await login(browser, 'admin'), term = seed('tag', 19)
      await editCatalog(page, term); await page.getByLabel('Tên', { exact: true }).fill('Catalog giữ khi mất quyền')
      const before = await fixtureCatalog(db, manifest, 'tag', term.id)
      try {
        if (mode === 'expired') await context.clearCookies()
        else await alterFixture(db, process.env, manifest, 'user', userId('admin'), mode === 'suspended' ? { status: 'SUSPENDED' } : { role: 'CLIENT' }, persist)
        await saveCatalog(page).click(); await expect(error(page, 'FORBIDDEN')).toBeVisible()
        await expect(page).toHaveURL(/\/creator\/taxonomy(?:\?|$)/); await expect(page.getByLabel('Tên', { exact: true })).toHaveValue('Catalog giữ khi mất quyền')
        expect(await fixtureCatalog(db, manifest, 'tag', term.id)).toEqual(before)
      } finally { if (mode !== 'expired') await alterFixture(db, process.env, manifest, 'user', userId('admin'), { status: 'ACTIVE', role: 'ADMIN' }, persist) }
    }
  })
})

test('TAX-21 both panels stay manual and pending double submissions dispatch one write', async ({ browser }) => {
  await test.step('TAX_MANUAL_SINGLE_FLIGHT', async () => {
    const { page } = await login(browser, 'admin'), term = seed('tag', 20)
    await editCatalog(page, term); const original = await fixtureCatalog(db, manifest, 'tag', term.id)
    await page.getByLabel('Tên', { exact: true }).fill('Chỉ lưu thủ công'); await page.clock.runFor(10000)
    expect(observer(page).count('updateTaxonomy')).toBe(0); expect(await fixtureCatalog(db, manifest, 'tag', term.id)).toEqual(original)
    const catalogBarrier = await hold(page, 'updateTaxonomy'); await saveCatalog(page).dblclick(); await catalogBarrier.ready()
    expect(observer(page).count('updateTaxonomy')).toBe(1); await expect(page.getByRole('button', { name: 'Thêm danh mục', exact: true })).toBeDisabled()
    catalogBarrier.release(); await expect(saveCatalog(page)).toBeEnabled()
    const id = await article(page, 'manual'); await open(page, id); const before = await read(id)
    await choose(page, term); await page.clock.runFor(10000); expect(observer(page).count('updateArticleClassification')).toBe(0); expect(await read(id)).toEqual(before)
    const barrier = await hold(page, 'updateArticleClassification'); await saveSelection(page).dblclick(); await barrier.ready()
    expect(observer(page).count('updateArticleClassification')).toBe(1); await expect(saveSelection(page)).toBeDisabled()
    expect((await graph(id)).tagMappings).toEqual([{ articleId: id, tagId: term.id }]); barrier.release(); await acknowledged(page)
  })
})

test('TAX-22 lost real catalog create ACK blocks retries and recovery adopts only reserved identity', async ({ browser }) => {
  await test.step('TAX_CATALOG_UNKNOWN_ACK', async () => {
    const { page } = await login(browser, 'admin'), input = await beginCatalog(page, 'tag', 'lost-ack', { name: 'Danh mục mất ACK' })
    const barrier = await hold(page, 'createTaxonomy'); await saveCatalog(page).click(); await barrier.ready()
    const term = await createdTerm('tag', input); barrier.release(0, true)
    await expect(page.getByRole('alert')).toBeVisible(); await expect(saveCatalog(page)).toBeDisabled()
    await expect(page.getByLabel('Tên', { exact: true })).toHaveValue(input.name); await page.clock.runFor(10000)
    expect(observer(page).count('createTaxonomy')).toBe(1)
    await confirm(page, () => page.getByRole('button', { name: 'Tải lại bản mới nhất', exact: true }).click(), true)
    await catalog(page, 'tag', keyOf(term)); await expect(item(page, term.id)).toBeVisible()
    expect(await db.articleTag.count({ where: { slug: keyOf(term) } })).toBe(1)
  })
})

test('TAX-22 lost classification ACK preserves selection and explicit reload never resubmits', async ({ browser }) => {
  await test.step('TAX_CLASSIFICATION_UNKNOWN_ACK', async () => {
    const { page } = await login(browser), id = await article(page, 'lost-ack'), term = seed('tag', 21)
    await open(page, id); await choose(page, term); const barrier = await hold(page, 'updateArticleClassification')
    await saveSelection(page).click(); await barrier.ready(); expect((await graph(id)).tagMappings).toHaveLength(1)
    barrier.release(0, true); await expect(page.getByRole('alert')).toBeVisible(); await expect(saveSelection(page)).toBeDisabled()
    await expect(selected(page, term)).toBeVisible(); await page.clock.runFor(10000); expect(observer(page).count('updateArticleClassification')).toBe(1)
    await confirm(page, () => page.getByRole('button', { name: 'Tải lại bản mới nhất', exact: true }).click(), true)
    await expect(selected(page, term)).toBeVisible(); expect((await graph(id)).tagMappings).toHaveLength(1)
  })
})

test('TAX-23 offline blocks dispatch and reconnect requires explicit manual save on both panels', async ({ browser }) => {
  await test.step('TAX_OFFLINE', async () => {
    const { page, context } = await login(browser, 'admin'), term = seed('tag', 22)
    await editCatalog(page, term); await page.getByLabel('Tên', { exact: true }).fill('Catalog offline'); const before = await fixtureCatalog(db, manifest, 'tag', term.id)
    await context.setOffline(true); await saveCatalog(page).click(); expect(observer(page).count('updateTaxonomy')).toBe(0)
    await expect(page.getByLabel('Tên', { exact: true })).toHaveValue('Catalog offline'); expect(await fixtureCatalog(db, manifest, 'tag', term.id)).toEqual(before)
    await context.setOffline(false); await page.clock.runFor(5000); expect(observer(page).count('updateTaxonomy')).toBe(0)
    const update = await hold(page, 'updateTaxonomy'); await saveCatalog(page).click(); await update.ready(); update.release(); await expect(saveCatalog(page)).toBeEnabled()
    const id = await article(page, 'offline'); await open(page, id); await choose(page, term)
    await context.setOffline(true); await saveSelection(page).click(); expect(observer(page).count('updateArticleClassification')).toBe(0)
    await context.setOffline(false); await page.clock.runFor(5000); expect(observer(page).count('updateArticleClassification')).toBe(0)
    await expect(selected(page, term)).toBeVisible(); await saveClass(page); expect((await graph(id)).tagMappings).toHaveLength(1)
  })
})

test('TAX-24 native navigation cancel preserves selections and accepted leave ignores late ACK', async ({ browser }) => {
  await test.step('TAX_PANEL_NAVIGATION', async () => {
    const { page, context } = await login(browser, 'admin'), term = seed('tag', 23)
    await editCatalog(page, term); await page.getByLabel('Tên', { exact: true }).fill('Catalog còn đang nhập')
    await confirm(page, () => page.getByRole('button', { name: 'Hủy', exact: true }).click(), false)
    await confirm(page, () => page.getByLabel('Loại danh mục', { exact: true }).selectOption('topic'), false)
    await expect(page.getByLabel('Tên', { exact: true })).toHaveValue('Catalog còn đang nhập')
    await confirm(page, () => page.evaluate(() => window.location.reload()), false, 'beforeunload')
    await expect(page.getByLabel('Tên', { exact: true })).toHaveValue('Catalog còn đang nhập')
    await confirm(page, () => page.getByRole('button', { name: 'Hủy', exact: true }).click(), true)
    const id = await article(page, 'navigation'); await open(page, id); await choose(page, term)
    await confirm(page, () => page.getByRole('button', { name: 'Hủy', exact: true }).click(), false)
    await confirm(page, () => page.getByRole('link', { name: 'Nguồn tham khảo', exact: true }).click(), false)
    await confirm(page, () => page.evaluate(() => window.location.reload()), false, 'beforeunload')
    await expect(selected(page, term)).toBeVisible(); expect(observer(page).count('updateArticleClassification')).toBe(0)
    const barrier = await hold(page, 'updateArticleClassification'); await saveSelection(page).click(); await barrier.ready()
    await confirm(page, () => page.getByRole('link', { name: 'Nguồn tham khảo', exact: true }).click(), true)
    await expect(page).toHaveURL(new RegExp(`/creator/articles/${id}/sources$`)); barrier.release()
    await page.clock.runFor(5000); expect(observer(page).count('updateArticleClassification')).toBe(1)
    const fresh = await tab(context); await open(fresh, id); await expect(selected(fresh, term)).toBeVisible()
  })
})

test('TAX-24 classification links preserve editor debounce and dirty source drafts', async ({ browser }) => {
  await test.step('TAX_LINKS_REGRESSION', async () => {
    const { page } = await login(browser); await page.goto('/creator/articles/new')
    await expect(page.getByText('Lưu bài trước để chọn phân loại', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Phân loại', exact: true })).toHaveCount(0)
    const id = await article(page, 'links'); await pauseEditorClock(page)
    const count = countArticleActions(page); await page.getByLabel('Tiêu đề', { exact: true }).fill('Giữ debounce khi hủy phân loại')
    await confirm(page, () => page.getByRole('link', { name: 'Phân loại', exact: true }).click(), false)
    await page.clock.runFor(2000); await expect(page.getByRole('status').filter({ hasText: /^Đã lưu$/ })).toBeVisible(); expect(count()).toBe(1)
    await page.getByLabel('Tiêu đề', { exact: true }).fill('Bản không gửi khi rời')
    await confirm(page, () => page.getByRole('link', { name: 'Phân loại', exact: true }).click(), true)
    await expect(page).toHaveURL(new RegExp(`${path(id)}$`)); await page.clock.runFor(5000); expect(count()).toBe(1)
    expect((await read(id)).title).toBe('Giữ debounce khi hủy phân loại')
    await page.getByRole('link', { name: 'Nguồn tham khảo', exact: true }).click()
    await page.getByRole('button', { name: 'Thêm nguồn', exact: true }).click(); await page.getByLabel('Tên tài liệu', { exact: true }).fill('Nguồn chưa lưu')
    await confirm(page, () => page.getByRole('link', { name: 'Phân loại', exact: true }).click(), false)
    await expect(page.getByLabel('Tên tài liệu', { exact: true })).toHaveValue('Nguồn chưa lưu')
    expect(await db.sourceReference.count({ where: { articleId: id } })).toBe(0)
    await confirm(page, () => page.getByRole('link', { name: 'Phân loại', exact: true }).click(), true)
    await page.getByRole('link', { name: 'Danh sách bài viết', exact: true }).click(); await expect(page.locator(`a[href="${path(id)}"]`)).toBeVisible()
  })
})

test('TAX-25/26 catalog text safety keyboard labels and responsive classification remain usable', async ({ browser }) => {
  await test.step('TAX_ACCESSIBLE_TEXT', async () => {
    const { page } = await login(browser, 'admin'), input = await beginCatalog(page, 'topic', 'text-safety', {
      name: '<img src=x onerror=window.TAX_XSS=1> Tiếng Việt', description: '<script>window.TAX_XSS=1</script>\nChỉ là văn bản',
    })
    let external = 0
    page.on('request', request => { if (new URL(request.url()).hostname === 'taxonomy-fixture.example.invalid') external++ })
    await page.getByLabel('Tên', { exact: true }).fill('   '); await saveCatalog(page).click()
    // Next also has a route-announcement alert. Assert the catalog validation
    // error and its accessible field association, not an unrelated live region.
    const validationAlert = page.getByRole('alert').and(error(page, 'VALIDATION_ERROR'))
    await expect(validationAlert).toHaveCount(1); await expect(validationAlert).toBeVisible()
    await expect(page.getByLabel('Tên', { exact: true })).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByLabel('Tên', { exact: true })).toHaveAttribute('aria-describedby', 'taxonomy-name-error')
    await expect(page.getByLabel('Tên', { exact: true })).toHaveAccessibleDescription('Vui lòng kiểm tra thông tin danh mục.')
    await expect(page.getByLabel('Tên', { exact: true })).toBeFocused()
    await page.getByLabel('Tên', { exact: true }).fill(input.name)
    const barrier = await hold(page, 'createTaxonomy'); await saveCatalog(page).focus(); await page.keyboard.press('Enter'); await barrier.ready()
    const term = await createdTerm('topic', input); barrier.release(); await expect(saveCatalog(page)).toBeEnabled()
    await catalog(page, 'topic', keyOf(term)); await expect(item(page, term.id)).toContainText(input.name)
    expect(await page.evaluate(() => Object.hasOwn(window, 'TAX_XSS'))).toBe(false)
    expect((await fixtureCatalog(db, manifest, 'topic', term.id)).description).toBe(input.description)
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 }); await expect(item(page, term.id)).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
    const id = await article(page, 'accessibility'); await open(page, id)
    await choose(page, term); await saveSelection(page).focus(); await page.keyboard.press('Enter'); await acknowledged(page)
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 }); await expect(selected(page, term)).toContainText(input.name)
      await expect(page.getByLabel('Tìm danh mục', { exact: true })).toBeVisible(); await expect(saveSelection(page)).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
    expect(await page.evaluate(() => Object.hasOwn(window, 'TAX_XSS'))).toBe(false); expect(external).toBe(0)
  })
})

for (const first of ['assignment', 'deactivate', 'delete'] as const) test(`TAX-30 ${first} commits first in catalog attachment race without dangling links`, async ({ browser }) => {
  await test.step('TAX_CATALOG_ATTACHMENT_RACE', async () => {
    const { page, context } = await login(browser, 'admin'), id = await article(page, `race-${first}`)
    const term = seed('category', first === 'assignment' ? 24 : first === 'deactivate' ? 25 : 26)
    await open(page, id); await choose(page, term); const admin = await tab(context); await editCatalog(admin, term)
    const before = await read(id)
    if (first === 'assignment') {
      const barrier = await hold(page, 'updateArticleClassification'); await saveSelection(page).click(); await barrier.ready(); await graph(id)
      await confirm(admin, () => item(admin, term.id).getByRole('button', { name: /^Xóa / }).click(), true)
      await expect(error(admin, 'TAXONOMY_IN_USE')).toBeVisible(); barrier.release(); await acknowledged(page)
      await admin.getByLabel('Đang hoạt động', { exact: true }).uncheck()
      const deactivate = await hold(admin, 'updateTaxonomy'); await saveCatalog(admin).click(); await deactivate.ready(); deactivate.release()
      expect((await graph(id)).article.categoryId).toBe(term.id)
      expect((await fixtureCatalog(db, manifest, 'category', term.id)).isActive).toBe(false)
    } else if (first === 'deactivate') {
      await admin.getByLabel('Đang hoạt động', { exact: true }).uncheck()
      const barrier = await hold(admin, 'updateTaxonomy'); await saveCatalog(admin).click(); await barrier.ready()
      await saveSelection(page).click(); await expect(error(page, 'INVALID_SELECTION')).toBeVisible(); barrier.release()
      expect(await read(id)).toEqual(before); await expect(selected(page, term)).toBeVisible()
    } else {
      const barrier = await hold(admin, 'deleteTaxonomy')
      await confirm(admin, () => item(admin, term.id).getByRole('button', { name: /^Xóa / }).click(), true); await barrier.ready(); await recover()
      await saveSelection(page).click(); await expect(error(page, 'INVALID_SELECTION')).toBeVisible(); barrier.release()
      expect(await read(id)).toEqual(before); await expect(selected(page, term)).toBeVisible()
    }
  })
})
