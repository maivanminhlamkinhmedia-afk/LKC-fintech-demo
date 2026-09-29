import { test, expect, type Browser, type BrowserContext, type Page, type Locator } from '@playwright/test'
import type { Article, SourceReference } from '@prisma/client'
import { connectStaging, demand, STAGING_BASE_URL } from '../../scripts/cms-e2e/guard.mjs'
import { loadManifest, saveManifest, discoverCreatedArticles, discoverCreatedSources, discoverFixtureGraph, fixtureArticle, alterFixture } from '../../scripts/cms-e2e/fixtures.mjs'
import { countArticleActions, holdActionResponses, pauseEditorClock } from './cms-autosave-support'
import { countSourceActions, holdSourceResponses } from './cms-sources-support'

type Actor = 'creator' | 'other' | 'admin' | 'super' | 'analyst' | 'client'
type Manifest = { version: number; runId: string; namespace: string;
  users: { key: Actor; id: string; email: string; role: string }[];
  articles: { key: string; id: string; slug: string; authorId: string; allowedOwnerIds: string[]; status: string }[];
  sources: { id: string; articleId: string; createdById: string }[] }
let manifest: Manifest
let db: Awaited<ReturnType<typeof connectStaging>>
let credentials: Record<Actor, { email: string; password: string }>
let sequence = 0
const contexts: BrowserContext[] = []
const releases: (() => void)[] = []
const persist = (value: unknown) => saveManifest(process.env.CMS_E2E_MANIFEST, value)
// V3 recovery validates catalog edges as well as sources; legacy v2 retains its existing authority.
const recover = () => manifest.version === 3
  ? discoverFixtureGraph(db, process.env, manifest, persist)
  : discoverCreatedSources(db, process.env, manifest, persist)
const userId = (actor: Actor) => manifest.users.find(user => user.key === actor)!.id
const path = (id: string) => `/creator/articles/${id}/sources`
const body = (page: Page) => page.getByRole('textbox', { name: 'Nội dung bài viết', exact: true })
const name = (page: Page) => page.getByLabel('Tên tài liệu', { exact: true })
const save = (page: Page) => page.getByRole('button', { name: 'Lưu nguồn', exact: true })
const add = (page: Page) => page.getByRole('button', { name: 'Thêm nguồn', exact: true })
const error = (page: Page, code: string) => page.locator(`[data-error-code="${code}"]`)
const item = (page: Page, id: string) => page.locator(`li[data-source-id="${id}"]`)
const read = async (id: string) => await fixtureArticle(db, manifest, id) as Article
const withoutToken = (row: Article) => { const { updatedAt: _token, ...rest } = row; void _token; return rest }
const acknowledge = (page: Page) => expect(page.getByRole('status').filter({ hasText: /^Đã lưu nguồn\.$/ })).toBeVisible()
async function sources(id: string): Promise<SourceReference[]> {
  await recover()
  demand(manifest.articles.some(article => article.id === id), 'ARTICLE_NOT_IN_MANIFEST')
  return db.sourceReference.findMany({ where: { articleId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
}
async function login(browser: Browser, actor: Actor = 'creator', timezoneId = 'UTC') {
  const context = await browser.newContext({ baseURL: STAGING_BASE_URL, timezoneId }); contexts.push(context)
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
async function createArticle(page: Page, suffix: string) {
  await page.clock.resume()
  await page.goto('/creator/articles/new'); await expect(body(page)).toBeVisible()
  await page.getByLabel('Tiêu đề', { exact: true }).fill(`Nguồn ${suffix}`)
  await page.getByLabel('Slug', { exact: true }).fill(`${manifest.namespace}-src-${suffix}-${++sequence}`)
  await page.getByRole('button', { name: 'Lưu nháp', exact: true }).click()
  await expect(page).toHaveURL(/\/creator\/articles\/[^/]+\/edit$/)
  await expect(page.getByRole('status').filter({ hasText: /^Đã lưu$/ })).toBeVisible()
  const id = new URL(page.url()).pathname.split('/').at(-2)!
  await discoverCreatedArticles(db, process.env, manifest, persist)
  demand(manifest.articles.some(article => article.id === id), 'UI_ARTICLE_NOT_RECORDED')
  return id
}
async function open(page: Page, id: string) {
  await page.clock.resume(); await page.goto(path(id))
  await expect(page.getByRole('heading', { name: 'Nguồn tham khảo', exact: true })).toBeVisible()
}
async function begin(page: Page, title = 'Nguồn tiếng Việt') {
  await add(page).click(); await expect(name(page)).toBeVisible(); await name(page).fill(title)
}
async function createSource(page: Page, articleId: string, title = 'Nguồn tiếng Việt') {
  await begin(page, title); await save(page).click(); await acknowledge(page)
  const rows = await sources(articleId)
  const row = rows.find(source => source.title === title)
  demand(row, 'UI_SOURCE_NOT_RECORDED')
  await expect(item(page, row!.id)).toBeVisible()
  return row!
}
async function hold(page: Page) {
  const barrier = await holdSourceResponses(page); releases.push(barrier.dispose); return barrier
}
async function confirm(page: Page, trigger: () => Promise<unknown>, accept: boolean, type = 'confirm') {
  const handled = page.waitForEvent('dialog').then(async dialog => {
    expect(dialog.type()).toBe(type)
    if (accept) await dialog.accept(); else await dialog.dismiss()
  })
  await Promise.all([trigger(), handled])
}
async function editSource(page: Page, row: SourceReference) {
  await item(page, row.id).getByRole('button', { name: `Sửa nguồn ${row.title}`, exact: true }).click()
}
const destroy = (page: Page, row: SourceReference) => item(page, row.id).getByRole('button', { name: `Xóa nguồn ${row.title}`, exact: true })
async function verifyField(page: Page, label: string, value: string) { await expect(page.getByLabel(label, { exact: true })).toHaveValue(value) }

test.beforeAll(async () => {
  demand(process.env.CMS_E2E_RUNNING === 'YES', 'USE_GUARDED_STAGING_RUNNER')
  manifest = await loadManifest(process.env.CMS_E2E_MANIFEST) as Manifest
  demand([2, 3].includes(manifest.version) && manifest.runId === process.env.CMS_E2E_RUN_ID, 'RUN_PROVENANCE_MISMATCH')
  credentials = JSON.parse(process.env.CMS_E2E_CREDENTIALS ?? '{}')
  db = await connectStaging(process.env)
})
test.afterEach(async () => {
  await test.step('SRC_TEARDOWN_DISPOSE', async () => {
    for (const release of releases.splice(0)) release()
  })
  try {
    await test.step('SRC_TEARDOWN_CONTEXT_CLOSE', async () => {
      await Promise.all(contexts.splice(0).map(context => context.close()))
    })
  } finally {
    await test.step('SRC_TEARDOWN_RECOVER', async () => { if (db) await recover() })
  }
})
test.afterAll(async () => {
  await test.step('SRC_TEARDOWN_DISCONNECT', async () => { if (db) await db.$disconnect() })
})

test('SRC-01 sources route denies anonymous non-CMS and foreign readers', async ({ browser }) => {
  await test.step('SRC_ACCESS', async () => {
    const owner = await login(browser); const id = await createArticle(owner.page, 'scope')
    await open(owner.page, id); await createSource(owner.page, id, 'Nguồn chỉ owner thấy')
    const context = await browser.newContext({ baseURL: STAGING_BASE_URL }); contexts.push(context)
    const anonymous = await context.newPage(); await anonymous.goto(path(id))
    await expect(anonymous).toHaveURL(/\/dang-nhap(?:\?|$)/)
    for (const actor of ['client', 'analyst', 'other'] as const) {
      const { page } = await login(browser, actor); await page.goto(path(id))
      if (actor === 'other') await expect(page.getByText('Nguồn chỉ owner thấy', { exact: true })).toHaveCount(0)
      else await expect(page).toHaveURL(/\/dashboard$/)
      await expect(add(page)).toHaveCount(0)
    }
    expect(await sources(id)).toHaveLength(1)
  })
})

test('SRC-02/09 full source metadata retains fixed Vietnam time and millisecond precision', async ({ browser }) => {
  const { page } = await login(browser, 'creator', 'America/Los_Angeles')
  let id: string, before: Article, source: SourceReference
  await test.step('SRC_METADATA_INPUT', async () => {
    id = await createArticle(page, 'metadata'); before = await read(id); await open(page, id); await begin(page, 'Báo cáo tiếng Việt')
    await page.getByLabel('Loại nguồn', { exact: true }).selectOption('REPORT')
    await page.getByLabel('Đơn vị xuất bản/cung cấp', { exact: true }).fill('Đơn vị độc lập')
    await page.getByLabel('URL', { exact: true }).fill('https://EXAMPLE.COM/report?q=1#trang-2')
    await page.getByLabel('Thời điểm công bố (UTC+7)', { exact: true }).fill('2026-09-27T09:00:12.345')
    await page.getByLabel('Thời điểm truy cập (UTC+7)', { exact: true }).fill('2026-09-26T08:00:11.123')
    await page.getByLabel('Thời điểm dữ liệu (UTC+7)', { exact: true }).fill('2028-02-29T23:59:59.987')
    await page.getByLabel('Ghi chú', { exact: true }).fill('Trang 2\nDữ liệu tham khảo')
  })
  await test.step('SRC_METADATA_SUBMIT', async () => { await save(page).click(); await acknowledge(page) })
  await test.step('SRC_METADATA_DB', async () => {
    const rows = await sources(id); expect(rows).toHaveLength(1); source = rows[0]
    expect(source).toMatchObject({ articleId: id, createdById: userId('creator'), sourceType: 'REPORT', title: 'Báo cáo tiếng Việt',
      publisher: 'Đơn vị độc lập', url: 'https://example.com/report?q=1#trang-2', note: 'Trang 2\nDữ liệu tham khảo' })
    expect(source.publishedAt?.toISOString()).toBe('2026-09-27T02:00:12.345Z')
    expect(source.accessedAt?.toISOString()).toBe('2026-09-26T01:00:11.123Z')
    expect(source.dataTimestamp?.toISOString()).toBe('2028-02-29T16:59:59.987Z')
    expect(withoutToken(await read(id))).toEqual(withoutToken(before))
    expect((await read(id)).updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime())
  })
  await test.step('SRC_METADATA_RELOAD', async () => {
    await page.reload(); await editSource(page, source)
    for (const [label, value] of [['Tên tài liệu', source.title], ['Thời điểm công bố (UTC+7)', '2026-09-27T09:00:12.345'],
      ['Thời điểm truy cập (UTC+7)', '2026-09-26T08:00:11.123'], ['Thời điểm dữ liệu (UTC+7)', '2028-02-29T23:59:59.987']]) await verifyField(page, label, value)
    await name(page).fill('Đã chỉnh tiêu đề'); await save(page).click(); await acknowledge(page)
    const updated = (await sources(id))[0]
    expect(updated).toMatchObject({ id: source.id, articleId: source.articleId, createdById: source.createdById,
      createdAt: source.createdAt, publishedAt: source.publishedAt, accessedAt: source.accessedAt, dataTimestamp: source.dataTimestamp })
    await page.reload(); await expect(item(page, source.id)).toContainText('Đã chỉnh tiêu đề')
  })
})

test('SRC-02 changes requested saves blank optional fields as null', async ({ browser }) => {
  await test.step('SRC_NULL_FIELDS', async () => {
    const { page } = await login(browser); const id = await createArticle(page, 'nulls')
    await alterFixture(db, process.env, manifest, 'article', id, { status: 'CHANGES_REQUESTED' }, persist)
    await open(page, id); const row = await createSource(page, id, 'Nguồn ngoại tuyến')
    for (const key of ['publisher', 'url', 'publishedAt', 'accessedAt', 'dataTimestamp', 'note'] as const) expect(row[key]).toBeNull()
    await page.reload(); await editSource(page, row); await name(page).fill('Nguồn ngoại tuyến đã sửa')
    await save(page).click(); await acknowledge(page)
    expect((await sources(id))[0].title).toBe('Nguồn ngoại tuyến đã sửa')
    expect((await read(id)).status).toBe('CHANGES_REQUESTED')
  })
})

for (const actor of ['admin', 'super'] as const) test(`SRC-03 ${actor} source author does not replace article ownership`, async ({ browser }) => {
  await test.step('SRC_ADMIN_SCOPE', async () => {
    const owner = await login(browser); const id = await createArticle(owner.page, actor)
    const elevated = await login(browser, actor); await open(elevated.page, id)
    let row = await createSource(elevated.page, id, `Nguồn ${actor}`)
    expect(row.createdById).toBe(userId(actor)); expect((await read(id)).authorId).toBe(userId('creator'))
    await name(elevated.page).fill(`Nguồn ${actor} đã sửa`); await save(elevated.page).click(); await acknowledge(elevated.page)
    const createdAt = row.createdAt; row = (await sources(id))[0]
    expect(row).toMatchObject({ title: `Nguồn ${actor} đã sửa`, createdById: userId(actor), createdAt })
    await open(owner.page, id); await editSource(owner.page, row); await name(owner.page).fill('Owner sửa nguồn người khác tạo')
    await save(owner.page).click(); await acknowledge(owner.page)
    expect((await sources(id))[0]).toMatchObject({ title: 'Owner sửa nguồn người khác tạo', createdById: userId(actor), createdAt: row.createdAt, articleId: id })
    await owner.page.reload(); await expect(item(owner.page, row.id)).toContainText('Owner sửa nguồn người khác tạo')
  })
})

test('SRC-04 excluded statuses and unsupported documents expose read-only sources', async ({ browser }) => {
  await test.step('SRC_READ_ONLY', async () => {
    const { page } = await login(browser); const id = await createArticle(page, 'readonly')
    await open(page, id); const row = await createSource(page, id)
    for (const status of ['SUBMITTED', 'EDITORIAL_REVIEW', 'FACT_CHECK', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'CORRECTED', 'ARCHIVED']) {
      await alterFixture(db, process.env, manifest, 'article', id, { status }, persist)
      const before = await read(id); await open(page, id)
      await expect(item(page, row.id)).toBeVisible(); await expect(add(page)).toHaveCount(0); await expect(save(page)).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'Quay lại bài viết', exact: true })).toHaveCount(0)
      expect(await read(id)).toEqual(before)
    }
    await alterFixture(db, process.env, manifest, 'article', id, { status: 'DRAFT', editorSchemaVersion: 2 }, persist)
    const unsupported = await read(id); await open(page, id); await expect(add(page)).toHaveCount(0)
    await expect(item(page, row.id)).toBeVisible(); expect(await read(id)).toEqual(unsupported)
  })
})

test('SRC-07/08 safe source links and legacy unsafe text never execute or fetch', async ({ browser }) => {
  const { page } = await login(browser); const id = await createArticle(page, 'unsafe')
  let row: SourceReference
  const external: string[] = []
  page.on('request', request => { if (new URL(request.url()).hostname === 'source-fixture.example.invalid') external.push(request.method()) })
  await test.step('SRC_URL_INPUT', async () => {
    await open(page, id); await begin(page, 'Nguồn URL')
    await page.getByLabel('URL', { exact: true }).fill('javascript:alert(1)'); await save(page).click()
    await expect(page.getByRole('alert')).toBeVisible(); expect(await sources(id)).toHaveLength(0)
    await page.getByLabel('URL', { exact: true }).fill('https://source-fixture.example.invalid/path?q=1#p2')
    await save(page).click(); await acknowledge(page); row = (await sources(id))[0]
    const link = item(page, row.id).getByRole('link')
    await expect(link).toHaveAttribute('href', row.url!); await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /noopener/); await expect(link).toHaveAttribute('rel', /noreferrer/)
  })
  await test.step('SRC_UNSAFE_RENDER', async () => {
    const title = '<img src=x onerror="window.__sourceExecuted=1"> Tiếng Việt'
    const note = '<script>window.__sourceExecuted=1</script>\nTrang 2'
    await alterFixture(db, process.env, manifest, 'source', row.id, { url: 'javascript:window.__sourceExecuted=1', title, publisher: '<b>Đơn vị</b>', note }, persist)
    await page.reload(); const card = item(page, row.id)
    await expect(card).toContainText(title); await expect(card).toContainText('<b>Đơn vị</b>')
    await expect(card).toContainText(note); await expect(card.getByRole('link')).toHaveCount(0)
    await expect(card.locator('img, script, iframe')).toHaveCount(0)
    expect(await page.evaluate(() => '__sourceExecuted' in window)).toBe(false)
    expect(external).toEqual([]); expect((await sources(id))[0].url).toBe('javascript:window.__sourceExecuted=1')
  })
})

test('SRC-10/11 manual source panel has no idle writes and one pending mutation', async ({ browser }) => {
  const { page } = await login(browser); const id = await createArticle(page, 'manual')
  await open(page, id); const count = countSourceActions(page); const before = await read(id)
  await test.step('SRC_MANUAL_IDLE', async () => {
    await expect(page.locator('li[data-source-id]')).toHaveCount(0)
    await begin(page, 'Thủ công'); await name(page).focus(); await page.getByLabel('Ghi chú', { exact: true }).fill('Chưa lưu')
    await page.clock.runFor(10000); expect(count()).toBe(0); expect(await sources(id)).toHaveLength(0); expect(await read(id)).toEqual(before)
  })
  await test.step('SRC_SINGLE_FLIGHT', async () => {
    const barrier = await hold(page); await save(page).dblclick(); await barrier.ready()
    await expect(save(page)).toBeDisabled(); await expect(add(page)).toBeDisabled()
    expect(count()).toBe(1); expect(await sources(id)).toHaveLength(1)
    barrier.release(); await acknowledge(page); const row = (await sources(id))[0]
    await name(page).fill('Cập nhật thủ công'); const update = await hold(page)
    await save(page).dblclick(); await update.ready(); await expect(destroy(page, row)).toBeDisabled()
    expect(count()).toBe(2); update.release(); await acknowledge(page)
    const second = await createSource(page, id, 'Nguồn kế tiếp')
    const ordered = await sources(id); expect(ordered.map(source => source.id)).toEqual([row.id, second.id])
    await page.reload(); expect(await page.locator('li[data-source-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-source-id')))).toEqual(ordered.map(source => source.id))
  })
})

test('SRC-12 two source tabs have one winner and preserve the losing form', async ({ browser }) => {
  const { page, context } = await login(browser); const id = await createArticle(page, 'two-tabs'); await open(page, id)
  const other = await context.newPage(); await open(other, id)
  await test.step('SRC_TWO_TABS_SUBMIT', async () => {
    await begin(page, 'Nguồn tab A'); await begin(other, 'Nguồn tab B')
    await Promise.all([save(page).click(), save(other).click()])
    await expect.poll(async () => (await error(page, 'EDIT_CONFLICT').count()) + (await error(other, 'EDIT_CONFLICT').count())).toBe(1)
  })
  await test.step('SRC_TWO_TABS_DB', async () => {
    const rows = await sources(id); expect(rows).toHaveLength(1)
    const loser = await error(page, 'EDIT_CONFLICT').count() ? page : other
    const expected = loser === page ? 'Nguồn tab A' : 'Nguồn tab B'
    await expect(name(loser)).toHaveValue(expected); expect(rows[0].title).not.toBe(expected)
    const count = countSourceActions(loser); await loser.clock.runFor(10000); expect(count()).toBe(0)
    await expect(save(loser)).toBeDisabled()
    await confirm(loser, () => loser.getByRole('button', { name: 'Tải lại bản mới nhất', exact: true }).click(), true)
    await expect(item(loser, rows[0].id)).toBeVisible()
  })
})

for (const first of ['source', 'autosave'] as const) test(`SRC-13 ${first} commit conflicts with the other stale surface`, async ({ browser }) => {
  const { page, context } = await login(browser); const id = await createArticle(page, `concurrent-${first}`)
  await expect(body(page)).toBeVisible(); await pauseEditorClock(page)
  const panel = await context.newPage(); await open(panel, id)
  await pauseEditorClock(page)
  const before = await read(id)
  await test.step('SRC_CROSS_SURFACE_SUBMIT', async () => {
    await begin(panel, 'Nguồn cạnh tranh'); await page.getByLabel('Tiêu đề', { exact: true }).fill('Nội dung cạnh tranh')
    if (first === 'source') {
      const barrier = await hold(panel); await save(panel).click(); await barrier.ready()
      expect(await sources(id)).toHaveLength(1)
      await page.clock.runFor(2000); await expect(error(page, 'EDIT_CONFLICT')).toBeVisible()
      barrier.release(); await acknowledge(panel)
    } else {
      const barrier = await holdActionResponses(page); releases.push(barrier.dispose)
      await page.clock.runFor(2000); await barrier.ready(); expect((await read(id)).title).toBe('Nội dung cạnh tranh')
      await save(panel).click(); await expect(error(panel, 'EDIT_CONFLICT')).toBeVisible()
      barrier.release(); await expect(page.getByRole('status').filter({ hasText: /^Đã lưu$/ })).toBeVisible()
    }
  })
  await test.step('SRC_CROSS_SURFACE_DB', async () => {
    if (first === 'source') {
      expect((await read(id)).title).toBe(before.title); await expect(page.getByLabel('Tiêu đề', { exact: true })).toHaveValue('Nội dung cạnh tranh')
      expect(await sources(id)).toHaveLength(1)
    } else { expect(await sources(id)).toHaveLength(0); await expect(name(panel)).toHaveValue('Nguồn cạnh tranh') }
    const count = countSourceActions(panel); await panel.clock.runFor(10000); expect(count()).toBe(0)
  })
})

test('SRC-14 suspended demoted and expired sessions retain source input without writes', async ({ browser }) => {
  await test.step('SRC_ACTOR_REVOKED', async () => {
    for (const mode of ['suspended', 'demoted', 'expired'] as const) {
      const { page, context } = await login(browser); const id = await createArticle(page, mode); await open(page, id)
      await begin(page, 'Giữ nguồn khi mất quyền'); const before = await read(id)
      try {
        if (mode === 'expired') await context.clearCookies()
        else await alterFixture(db, process.env, manifest, 'user', userId('creator'), mode === 'suspended' ? { status: 'SUSPENDED' } : { role: 'CLIENT' }, persist)
        await save(page).click(); await expect(error(page, 'FORBIDDEN')).toBeVisible()
        await expect(page).toHaveURL(new RegExp(`/creator/articles/${id}/sources$`)); await expect(name(page)).toHaveValue('Giữ nguồn khi mất quyền')
        expect(await sources(id)).toHaveLength(0); expect(await read(id)).toEqual(before)
      } finally { if (mode !== 'expired') await alterFixture(db, process.env, manifest, 'user', userId('creator'), { status: 'ACTIVE', role: 'CREATOR' }, persist) }
    }
  })
})

test('SRC-14 changed article owner or status blocks an already open source form', async ({ browser }) => {
  await test.step('SRC_PARENT_REVOKED', async () => {
    for (const mode of ['owner', 'status'] as const) {
      const { page } = await login(browser); const id = await createArticle(page, `changed-${mode}`); await open(page, id); await begin(page, 'Giữ nháp nguồn')
      await alterFixture(db, process.env, manifest, 'article', id, mode === 'owner' ? { authorId: userId('other') } : { status: 'SUBMITTED' }, persist)
      const before = await read(id); await save(page).click()
      await expect(error(page, mode === 'owner' ? 'NOT_FOUND' : 'NOT_EDITABLE')).toBeVisible()
      await expect(name(page)).toHaveValue('Giữ nháp nguồn'); expect(await sources(id)).toHaveLength(0); expect(await read(id)).toEqual(before)
    }
  })
})

test('SRC-15 delete confirmation removes only the selected source', async ({ browser }) => {
  const { page } = await login(browser); const id = await createArticle(page, 'delete'); await open(page, id)
  const row = await createSource(page, id, 'Xóa nguồn này'); const retained = await createSource(page, id, 'Giữ nguồn này')
  const before = await read(id); const count = countSourceActions(page)
  await test.step('SRC_DELETE_CANCEL', async () => {
    await confirm(page, () => destroy(page, row).click(), false)
    expect(count()).toBe(0); expect(await sources(id)).toHaveLength(2); expect(await read(id)).toEqual(before)
  })
  await test.step('SRC_DELETE_DB', async () => {
    const barrier = await hold(page); await confirm(page, () => destroy(page, row).click(), true); await barrier.ready()
    await expect(destroy(page, retained)).toBeDisabled(); await expect(add(page)).toBeDisabled(); expect(count()).toBe(1)
    barrier.release(); await expect(item(page, row.id)).toHaveCount(0)
    expect((await sources(id)).map(source => source.id)).toEqual([retained.id])
    expect(withoutToken(await read(id))).toEqual(withoutToken(before))
    expect(await db.user.count({ where: { id: userId('creator') } })).toBe(1)
    await page.reload(); await expect(item(page, retained.id)).toBeVisible(); await expect(item(page, row.id)).toHaveCount(0)
  })
})

test('SRC-17 source create update delete retain monotonic persisted DATETIME tokens', async ({ browser }) => {
  await test.step('SRC_TOKEN_PRECISION', async () => {
    const { page, context } = await login(browser); const id = await createArticle(page, 'precision')
    const future = new Date(Date.now() + 3_600_000)
    await alterFixture(db, process.env, manifest, 'article', id, { updatedAt: future }, persist)
    await page.reload(); await expect(body(page)).toBeVisible(); await pauseEditorClock(page)
    const panel = await context.newPage(); await open(panel, id); await pauseEditorClock(page)
    const row = await createSource(panel, id); expect((await read(id)).updatedAt.getTime()).toBe(future.getTime() + 1)
    await name(panel).fill('Nguồn sửa +1ms'); await save(panel).click(); await acknowledge(panel)
    expect((await read(id)).updatedAt.getTime()).toBe(future.getTime() + 2)
    const updated = (await sources(id))[0]; await confirm(panel, () => destroy(panel, updated).click(), true)
    await expect(item(panel, row.id)).toHaveCount(0); expect((await read(id)).updatedAt.getTime()).toBe(future.getTime() + 3)
    await page.getByLabel('Tiêu đề', { exact: true }).fill('Editor token cũ'); await page.clock.runFor(2000)
    await expect(error(page, 'EDIT_CONFLICT')).toBeVisible(); await expect(page.getByLabel('Tiêu đề', { exact: true })).toHaveValue('Editor token cũ')
    expect((await read(id)).updatedAt.getTime()).toBe(future.getTime() + 3)
  })
})

test('SRC-18 offline and lost real ACK preserve input and never duplicate create', async ({ browser }) => {
  const { page, context } = await login(browser); const id = await createArticle(page, 'unknown'); await open(page, id)
  const count = countSourceActions(page); await begin(page, 'Nguồn mất ACK')
  await test.step('SRC_OFFLINE', async () => {
    await context.setOffline(true); await save(page).click()
    await expect(name(page)).toHaveValue('Nguồn mất ACK'); expect(count()).toBe(0); expect(await sources(id)).toHaveLength(0)
    await context.setOffline(false); await page.clock.runFor(10000); expect(count()).toBe(0)
  })
  await test.step('SRC_UNKNOWN_ACK', async () => {
    const barrier = await hold(page); await save(page).click(); await barrier.ready()
    const row = (await sources(id))[0]; expect(row.title).toBe('Nguồn mất ACK')
    barrier.release(0, true); await expect(page.getByRole('alert')).toBeVisible(); await expect(name(page)).toHaveValue('Nguồn mất ACK')
    await expect(save(page)).toBeDisabled(); await expect(add(page)).toBeDisabled()
    await page.clock.runFor(10000); await context.setOffline(true); await context.setOffline(false)
    expect(count()).toBe(1); expect(await sources(id)).toHaveLength(1)
    await confirm(page, () => page.getByRole('button', { name: 'Tải lại bản mới nhất', exact: true }).click(), true)
    await expect(item(page, row.id)).toBeVisible(); expect(await sources(id)).toHaveLength(1)
  })
})

test('SRC-20 dirty navigation cancellation retains source form and accepted leave has no followup', async ({ browser }) => {
  const { page } = await login(browser); const id = await createArticle(page, 'navigation'); await open(page, id)
  const row = await createSource(page, id, 'Nguồn đã lưu'); await begin(page, 'Nguồn chưa lưu'); const count = countSourceActions(page)
  await test.step('SRC_NAVIGATION_CANCEL', async () => {
    await confirm(page, () => page.getByRole('button', { name: 'Hủy', exact: true }).click(), false)
    await confirm(page, () => item(page, row.id).getByRole('button', { name: `Sửa nguồn ${row.title}`, exact: true }).click(), false)
    await confirm(page, () => page.getByRole('link', { name: 'Danh sách bài viết', exact: true }).click(), false)
    await confirm(page, () => page.evaluate(() => window.location.reload()), false, 'beforeunload')
    await expect(name(page)).toHaveValue('Nguồn chưa lưu'); expect(count()).toBe(0)
  })
  await test.step('SRC_NAVIGATION_LEAVE', async () => {
    const barrier = await hold(page); await save(page).click(); await barrier.ready()
    await confirm(page, () => page.getByRole('link', { name: 'Danh sách bài viết', exact: true }).click(), true)
    await expect(page).toHaveURL(/\/creator\/articles$/); barrier.release()
    await page.clock.runFor(10000); expect(count()).toBe(1); expect(await sources(id)).toHaveLength(2)
    await open(page, id); await begin(page, 'Instance mới'); await expect(name(page)).toHaveValue('Instance mới')
    expect(count()).toBe(1)
  })
})

test('SRC-21 editor source links retain the autosave navigation guard', async ({ browser }) => {
  await test.step('SRC_EDITOR_LINKS', async () => {
    const { page } = await login(browser)
    await page.goto('/creator/articles/new'); await expect(body(page)).toBeVisible()
    await expect(page.getByText('Lưu nháp trước khi thêm nguồn', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Nguồn tham khảo', exact: true })).toHaveCount(0)
    const id = await createArticle(page, 'editor-link'); await expect(body(page)).toBeVisible(); await pauseEditorClock(page)
    const count = countArticleActions(page); await page.getByLabel('Tiêu đề', { exact: true }).fill('Giữ debounce khi hủy nguồn')
    await confirm(page, () => page.getByRole('link', { name: 'Nguồn tham khảo', exact: true }).click(), false)
    await expect(page.getByLabel('Tiêu đề', { exact: true })).toHaveValue('Giữ debounce khi hủy nguồn')
    await page.clock.runFor(2000); await expect(page.getByRole('status').filter({ hasText: /^Đã lưu$/ })).toBeVisible(); expect(count()).toBe(1)
    await page.getByLabel('Tiêu đề', { exact: true }).fill('Bỏ thay đổi khi rời editor')
    await confirm(page, () => page.getByRole('link', { name: 'Nguồn tham khảo', exact: true }).click(), true)
    await expect(page).toHaveURL(new RegExp(`${path(id)}$`)); await page.clock.runFor(5000); expect(count()).toBe(1)
    expect((await read(id)).title).toBe('Giữ debounce khi hủy nguồn')
    await page.getByRole('link', { name: 'Quay lại bài viết', exact: true }).click(); await expect(body(page)).toBeVisible()
    await page.getByRole('link', { name: 'Danh sách bài viết', exact: true }).click()
    await expect(page.locator(`a[href="${path(id)}"]`)).toBeVisible()
  })
})

test('SRC-23 source form labels keyboard errors and long URLs fit all viewports', async ({ browser }) => {
  await test.step('SRC_ACCESSIBLE_LAYOUT', async () => {
    const { page } = await login(browser); const id = await createArticle(page, 'layout'); await open(page, id)
    await add(page).focus(); await page.keyboard.press('Enter'); await expect(name(page)).toBeVisible()
    await name(page).fill('   '); await save(page).click(); await expect(page.getByRole('alert')).toBeVisible()
    await name(page).fill('Nguồn dài tiếng Việt')
    const url = `https://source-fixture.example.invalid/${'a'.repeat(1700)}`
    await page.getByLabel('URL', { exact: true }).fill(url)
    await save(page).focus(); await page.keyboard.press('Enter'); await acknowledge(page)
    const row = (await sources(id))[0]
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 }); await expect(item(page, row.id)).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await expect(save(page)).toBeVisible(); await expect(name(page)).toBeVisible()
    }
    const labels = ['Loại nguồn', 'Tên tài liệu', 'Đơn vị xuất bản/cung cấp', 'URL', 'Thời điểm công bố (UTC+7)',
      'Thời điểm truy cập (UTC+7)', 'Thời điểm dữ liệu (UTC+7)', 'Ghi chú']
    for (const label of labels) await expect(page.getByLabel(label, { exact: true })).toBeVisible()
    const link: Locator = item(page, row.id).getByRole('link'); await expect(link).toHaveAttribute('href', url)
  })
})
