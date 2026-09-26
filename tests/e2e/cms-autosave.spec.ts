import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import type { Article } from '@prisma/client'
import { connectStaging, demand, STAGING_BASE_URL } from '../../scripts/cms-e2e/guard.mjs'
import { loadManifest, saveManifest, discoverCreatedArticles, fixtureArticle, alterFixture } from '../../scripts/cms-e2e/fixtures.mjs'
import { validateEditorDocument } from '../../src/features/cms/editor-schema'
import { countArticleActions, holdActionResponses, pauseEditorClock } from './cms-autosave-support'

type Actor = 'creator' | 'other' | 'admin' | 'super' | 'analyst' | 'client'
type Manifest = { runId: string; namespace: string; users: { key: Actor; id: string; email: string; role: string }[];
  articles: { key: string; id: string; slug: string; authorId: string; allowedOwnerIds: string[]; status: string }[] }
let manifest: Manifest
let db: Awaited<ReturnType<typeof connectStaging>>
let credentials: Record<Actor, { email: string; password: string }>
let sequence = 0
const contexts: BrowserContext[] = []
const releases: (() => void)[] = []
const persist = (value: unknown) => saveManifest(process.env.CMS_E2E_MANIFEST, value)
const userId = (actor: Actor) => manifest.users.find(user => user.key === actor)!.id
const fixture = (key: string) => manifest.articles.find(article => article.key === key)!
const slug = (suffix: string) => `${manifest.namespace}-auto-${suffix}-${++sequence}`
const body = (page: Page) => page.getByRole('textbox', { name: 'Nội dung bài viết', exact: true })
const title = (page: Page) => page.getByLabel('Tiêu đề', { exact: true })
const save = (page: Page) => page.getByRole('button', { name: 'Lưu nháp', exact: true }).click()
const saved = (page: Page) => expect(page.getByRole('status').filter({ hasText: /^Đã lưu$/ })).toBeVisible()
const notSaved = (page: Page) => expect(page.getByRole('status').filter({ hasText: /^Đã lưu$/ })).toHaveCount(0)
const error = (page: Page, code: string) => page.locator(`[data-error-code="${code}"]`)
const read = async (id: string) => await fixtureArticle(db, manifest, id) as Article
const state = (row: Article) => ({ title: row.title, slug: row.slug, excerpt: row.excerpt, articleType: row.articleType,
  contentJson: row.contentJson, contentText: row.contentText, authorId: row.authorId, status: row.status, updatedAt: row.updatedAt.toISOString() })
const tick = (page: Page, ms = 2000) => page.clock.runFor(ms)
const editPath = (id: string) => `/creator/articles/${id}/edit`

async function login(browser: Browser, actor: Actor = 'creator') {
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
async function openEdit(page: Page, id: string) {
  await page.clock.resume()
  await page.goto(editPath(id)); await expect(body(page)).toBeVisible(); await pauseEditorClock(page)
}
async function create(page: Page, suffix: string) {
  await page.clock.resume()
  await page.goto('/creator/articles/new'); await expect(body(page)).toBeVisible(); await pauseEditorClock(page)
  await title(page).fill(`Autosave ${suffix}`)
  await page.getByLabel('Slug', { exact: true }).fill(slug(suffix))
  await page.clock.resume() // New remains manual; let edit-route hydration run.
  await save(page)
  await expect(page).toHaveURL(/\/creator\/articles\/[^/]+\/edit$/)
  await saved(page)
  const id = new URL(page.url()).pathname.split('/').at(-2)!
  await discoverCreatedArticles(db, process.env, manifest, persist)
  demand(manifest.articles.some(article => article.id === id), 'UI_ARTICLE_NOT_RECORDED')
  await expect(body(page)).toBeVisible(); await pauseEditorClock(page)
  return id
}
async function hold(page: Page, count = 1) {
  const barrier = await holdActionResponses(page, count); releases.push(barrier.dispose); return barrier
}
async function dialogLink(page: Page, accept: boolean) {
  const handled = page.waitForEvent('dialog').then(async dialog => {
    expect(dialog.type()).toBe('confirm')
    if (accept) await dialog.accept(); else await dialog.dismiss()
  })
  await Promise.all([page.getByRole('link', { name: 'Danh sách bài viết', exact: true }).click(), handled])
}

test.beforeAll(async () => {
  demand(process.env.CMS_E2E_RUNNING === 'YES', 'USE_GUARDED_STAGING_RUNNER')
  manifest = await loadManifest(process.env.CMS_E2E_MANIFEST) as Manifest
  demand(manifest.runId === process.env.CMS_E2E_RUN_ID, 'RUN_PROVENANCE_MISMATCH')
  credentials = JSON.parse(process.env.CMS_E2E_CREDENTIALS ?? '{}')
  db = await connectStaging(process.env)
})
test.afterEach(async () => {
  for (const release of releases.splice(0)) release()
  try { await Promise.all(contexts.splice(0).map(context => context.close())) }
  finally { if (db) await discoverCreatedArticles(db, process.env, manifest, persist) }
})
test.afterAll(async () => { if (db) await db.$disconnect() })

test('AUTO-01/02 new stays manual and persisted edit stays idle until data changes', async ({ browser }) => {
  await test.step('AUTO_CREATE_IDLE', async () => {
    const { page } = await login(browser)
    const count = countArticleActions(page)
    const before = await db.article.count({ where: { authorId: userId('creator') } })
    await page.goto('/creator/articles/new'); await expect(body(page)).toBeVisible(); await pauseEditorClock(page)
    await title(page).fill('Tạo thủ công một lần'); await page.getByLabel('Slug', { exact: true }).fill(slug('first'))
    await body(page).fill('Chưa tạo bài khi đang gõ')
    await tick(page, 10000)
    expect(count()).toBe(0); expect(await db.article.count({ where: { authorId: userId('creator') } })).toBe(before)
    await page.clock.resume()
    await page.getByRole('button', { name: 'Lưu nháp', exact: true }).dblclick()
    await expect(page).toHaveURL(/\/creator\/articles\/[^/]+\/edit$/); await saved(page)
    await expect(body(page)).toBeVisible(); await pauseEditorClock(page)
    await discoverCreatedArticles(db, process.env, manifest, persist)
    const id = new URL(page.url()).pathname.split('/').at(-2)!
    expect(count()).toBe(1)
    const stored = state(await read(id))
    await body(page).focus(); await body(page).press('ArrowLeft')
    await page.getByRole('button', { name: 'Liên kết', exact: true }).click()
    await tick(page, 10000)
    expect(count()).toBe(1); expect(state(await read(id))).toEqual(stored)
    await page.clock.resume(); await page.reload(); await expect(body(page)).toBeVisible()
    await pauseEditorClock(page); await tick(page, 5000)
    expect(count()).toBe(1); expect(state(await read(id))).toEqual(stored)
    await title(page).fill('Chỉ edit persisted mới tự lưu'); await tick(page); await saved(page)
    expect(count()).toBe(2); expect((await read(id)).title).toBe('Chỉ edit persisted mới tự lưu')
  })
})

test('AUTO-03/04/18 latest metadata and native rich clipboard autosave round trip', async ({ browser }) => {
  await test.step('AUTO_RICH_ROUNDTRIP', async () => {
    const { context, page } = await login(browser)
    const id = await create(page, 'rich'); const count = countArticleActions(page)
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: STAGING_BASE_URL })
    await title(page).fill('Bản trung gian'); await tick(page, 1500)
    await title(page).fill('Tiêu đề cuối tiếng Việt')
    const canonicalSlug = slug('rich-updated')
    await page.getByLabel('Slug', { exact: true }).fill(canonicalSlug.toUpperCase())
    await page.getByLabel('Tóm tắt', { exact: true }).fill('Tóm tắt tự lưu')
    await page.getByLabel('Loại bài viết', { exact: true }).selectOption('ANALYSIS')
    await page.evaluate(async () => {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob(['<h2>Tiêu đề</h2><p><a href="https://example.com/vi" target="_self" title="copy">Liên kết</a></p><ol start="3"><li>Một</li><li>Hai</li></ol><pre><code>const tiếngViệt = 1;\n  tiếngViệt++</code></pre>'], { type: 'text/html' }),
        'text/plain': new Blob(['Clipboard fallback'], { type: 'text/plain' }),
      })])
    })
    await body(page).focus(); await page.keyboard.press('ControlOrMeta+V')
    await expect(body(page).locator('h2')).toHaveText('Tiêu đề')
    await tick(page, 1999); expect(count()).toBe(0)
    await tick(page, 1); await saved(page); expect(count()).toBe(1)
    const row = await read(id)
    expect(row.title).toBe('Tiêu đề cuối tiếng Việt'); expect(row.slug).toBe(canonicalSlug)
    expect(row.excerpt).toBe('Tóm tắt tự lưu'); expect(row.articleType).toBe('ANALYSIS')
    const validated = validateEditorDocument(row.contentJson)
    expect(validated.contentJson).toEqual(row.contentJson); expect(validated.contentText).toBe(row.contentText)
    expect(row.contentText).toBe('Tiêu đề\nLiên kết\nMột\nHai\nconst tiếngViệt = 1;\n  tiếngViệt++')
    await tick(page, 10000); expect(count()).toBe(1)
    await page.clock.resume(); await page.reload(); await expect(body(page).locator('h2')).toHaveText('Tiêu đề')
    await pauseEditorClock(page)
    await expect(body(page).locator('a')).toHaveAttribute('target', '_blank')
    await expect(body(page).locator('ol')).toHaveAttribute('start', '3')
    await expect(body(page).locator('pre code')).toHaveText('const tiếngViệt = 1;\n  tiếngViệt++')
    await body(page).fill(''); await tick(page); await saved(page)
    expect((await read(id)).contentText).toBe('')
  })
})

test('AUTO-05/06/07/23 slow real ACK preserves typing and coalesces one latest tokened followup', async ({ browser }) => {
  await test.step('AUTO_SINGLE_FLIGHT', async () => {
    const { page } = await login(browser); const id = await create(page, 'flight')
    const editorElement = await body(page).elementHandle()
    expect(editorElement).not.toBeNull()
    const count = countArticleActions(page); const barrier = await hold(page, 2)
    const firstSlug = slug('first-ack'); const latestSlug = slug('latest-ack')
    await page.getByLabel('Slug', { exact: true }).fill(firstSlug.toUpperCase())
    await title(page).fill('Snapshot một'); await tick(page); await barrier.ready(0)
    const first = await read(id); expect(first.title).toBe('Snapshot một')
    await title(page).fill('Snapshot đã bị thay'); await body(page).fill('Gõ trong khi đang lưu')
    await tick(page, 600) // Separate the format operation from text history.
    await body(page).press('ControlOrMeta+A')
    await page.getByRole('button', { name: 'Đậm', exact: true }).click()
    await expect(body(page).locator('strong')).toHaveText('Gõ trong khi đang lưu')
    await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click()
    await expect(body(page).locator('strong')).toHaveCount(0)
    await page.getByRole('button', { name: 'Làm lại', exact: true }).click()
    await expect(body(page).locator('strong')).toHaveText('Gõ trong khi đang lưu')
    await title(page).fill('Snapshot cuối'); await page.getByLabel('Slug', { exact: true }).fill(latestSlug)
    await title(page).focus(); await title(page).press('End')
    const selection = await title(page).evaluate(element => (element as HTMLInputElement).selectionStart)
    await tick(page, 5000); await save(page); await save(page)
    expect(count()).toBe(1); await notSaved(page)
    barrier.release(0); await barrier.ready(1)
    await expect(title(page)).toHaveValue('Snapshot cuối')
    await expect(page.getByLabel('Slug', { exact: true })).toHaveValue(latestSlug)
    // Restore title focus after explicit manual clicks, then check ACK 2 keeps it.
    await title(page).focus(); await title(page).press('End')
    await notSaved(page); expect(count()).toBe(2)
    const second = await read(id)
    expect(second.title).toBe('Snapshot cuối'); expect(second.slug).toBe(latestSlug)
    expect(second.contentText).toBe('Gõ trong khi đang lưu'); expect(second.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime())
    expect(JSON.stringify(second.contentJson)).toContain('"bold"')
    barrier.release(1); await saved(page)
    expect(await editorElement!.evaluate(element => element.isConnected)).toBe(true)
    await expect(title(page)).toBeFocused()
    expect(await title(page).evaluate(element => (element as HTMLInputElement).selectionStart)).toBe(selection)
    await tick(page, 10000); expect(count()).toBe(2)
    await expect(page.getByRole('button', { name: 'Hoàn tác', exact: true })).toBeEnabled()
  })
})

test('AUTO-07 manual flush before deadline and repeated clean clicks make one update', async ({ browser }) => {
  await test.step('AUTO_MANUAL_FLUSH', async () => {
    const { page } = await login(browser); const id = await create(page, 'manual'); const count = countArticleActions(page)
    await title(page).fill('Lưu ngay trước deadline'); await tick(page, 1999)
    await page.getByRole('button', { name: 'Lưu nháp', exact: true }).dblclick(); await saved(page)
    await save(page); await tick(page, 10000)
    expect(count()).toBe(1); expect((await read(id)).title).toBe('Lưu ngay trước deadline')
  })
})

test('AUTO-10 slug conflict pauses the same slug until an edited slug becomes valid', async ({ browser }) => {
  await test.step('AUTO_SLUG_BARRIER', async () => {
    const { page } = await login(browser); const id = await create(page, 'collision'); const count = countArticleActions(page)
    const before = state(await read(id))
    await page.getByLabel('Slug', { exact: true }).fill(fixture('DRAFT').slug)
    await tick(page); await expect(error(page, 'SLUG_CONFLICT')).toBeVisible()
    await body(page).fill('Đổi body không lặp slug đang xung đột'); await tick(page, 10000)
    expect(count()).toBe(1); expect(state(await read(id))).toEqual(before)
    const fixedSlug = slug('fixed'); await page.getByLabel('Slug', { exact: true }).fill(fixedSlug)
    await tick(page); await saved(page); expect(count()).toBe(2)
    expect((await read(id)).slug).toBe(fixedSlug)
  })
})

test('AUTO-11 known offline makes no request and online rearms one latest save', async ({ browser }) => {
  await test.step('AUTO_OFFLINE_REARM', async () => {
    const { context, page } = await login(browser); const id = await create(page, 'offline'); const count = countArticleActions(page)
    const before = state(await read(id))
    try {
      await context.setOffline(true); await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false)
      await title(page).fill('Offline trước dispatch'); await tick(page, 10000)
      await body(page).fill('Nội dung mới nhất offline'); await tick(page, 10000)
      expect(count()).toBe(0); expect(state(await read(id))).toEqual(before); await notSaved(page)
      await dialogLink(page, false); await expect(body(page)).toHaveText('Nội dung mới nhất offline')
    } finally { await context.setOffline(false) }
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true)
    await tick(page, 1999); expect(count()).toBe(0)
    await tick(page, 1); await saved(page); expect(count()).toBe(1)
    expect((await read(id)).contentText).toBe('Nội dung mới nhất offline')
  })
})

test('AUTO-12 lost real committed ACK stops retries and explicit stale retry conflicts', async ({ browser }) => {
  await test.step('AUTO_UNKNOWN_ACK', async () => {
    const { context, page } = await login(browser); const id = await create(page, 'lost'); const count = countArticleActions(page)
    const barrier = await hold(page)
    await title(page).fill('Server đã nhận snapshot'); await tick(page); await barrier.ready()
    const committed = state(await read(id)); expect(committed.title).toBe('Server đã nhận snapshot')
    barrier.release(0, true); await expect(error(page, 'INTERNAL_ERROR')).toBeVisible()
    await body(page).fill('Giữ bản chưa xác nhận'); await tick(page, 10000)
    await context.setOffline(true); await context.setOffline(false); await tick(page, 10000)
    expect(count()).toBe(1); await notSaved(page); await expect(body(page)).toHaveText('Giữ bản chưa xác nhận')
    await save(page); await expect(error(page, 'EDIT_CONFLICT')).toBeVisible()
    expect(count()).toBe(2); expect(state(await read(id))).toEqual(committed)
    await tick(page, 10000); expect(count()).toBe(2)
  })
})

test('AUTO-13 two autosaving tabs keep the loser draft and require confirmed reload', async ({ browser }) => {
  await test.step('AUTO_TWO_TABS', async () => {
    const { page: first } = await login(browser); const id = await create(first, 'tabs')
    const { page: second } = await login(browser); await openEdit(second, id)
    const firstCount = countArticleActions(first); const secondCount = countArticleActions(second)
    await title(first).fill('Tab một tự lưu'); await title(second).fill('Tab hai tự lưu')
    await Promise.all([tick(first), tick(second)])
    await expect.poll(async () => await error(first, 'EDIT_CONFLICT').count() + await error(second, 'EDIT_CONFLICT').count()).toBe(1)
    const winner = (await read(id)).title; const loser = winner === 'Tab một tự lưu' ? second : first
    const loserTitle = winner === 'Tab một tự lưu' ? 'Tab hai tự lưu' : 'Tab một tự lưu'
    await expect(title(loser)).toHaveValue(loserTitle); await dialogLink(loser, false)
    await tick(loser, 10000); expect(firstCount()).toBe(1); expect(secondCount()).toBe(1)
    const reload = loser.getByRole('button', { name: 'Tải lại bản mới nhất', exact: true })
    const cancel = loser.waitForEvent('dialog').then(dialog => dialog.dismiss())
    await Promise.all([reload.click(), cancel]); await expect(title(loser)).toHaveValue(loserTitle)
    await loser.clock.resume() // Conflict already blocks timers; hydrate the reload.
    const accept = loser.waitForEvent('dialog').then(dialog => dialog.accept())
    await Promise.all([reload.click(), accept]); await expect(title(loser)).toHaveValue(winner)
  })
})

for (const actor of ['admin', 'super'] as const) {
  test(`AUTO-14 ${actor} autosaves an allowed foreign draft without changing owner`, async ({ browser }) => {
    await test.step('AUTO_ADMIN_SCOPE', async () => {
      const { page } = await login(browser, actor); const id = fixture('other-draft').id
      const before = await read(id); await openEdit(page, id)
      await title(page).fill(`Tự lưu bởi ${actor}`); await tick(page); await saved(page)
      const after = await read(id); expect(after.authorId).toBe(before.authorId); expect(after.status).toBe(before.status)
      expect(after.title).toBe(`Tự lưu bởi ${actor}`)
    })
  })
}

test('AUTO-14 revocation stops an open editor and non-CMS roles cannot open it', async ({ browser }) => {
  await test.step('AUTO_REVOKED_ACTOR', async () => {
    for (const patch of [{ status: 'SUSPENDED' }, { role: 'CLIENT' }]) {
      const { page } = await login(browser); const id = await create(page, 'revoke'); const before = state(await read(id))
      const count = countArticleActions(page)
      await title(page).fill('Không được tự lưu sau thu hồi quyền')
      try {
        await alterFixture(db, process.env, manifest, 'user', userId('creator'), patch, persist)
        await tick(page); await expect(error(page, 'FORBIDDEN')).toBeVisible()
        await body(page).fill('Giữ nội dung sau từ chối'); await tick(page, 10000)
        expect(count()).toBe(1); expect(state(await read(id))).toEqual(before)
        await expect(page).toHaveURL(new RegExp(`${id}/edit$`)); await expect(body(page)).toHaveText('Giữ nội dung sau từ chối')
      } finally { await alterFixture(db, process.env, manifest, 'user', userId('creator'), { role: 'CREATOR', status: 'ACTIVE' }, persist) }
      await page.close()
    }
    for (const actor of ['client', 'analyst'] as const) {
      const { page } = await login(browser, actor); await page.goto(editPath(fixture('DRAFT').id))
      await expect(page).toHaveURL(/\/dashboard$/); await expect(body(page)).toHaveCount(0)
    }
    const { page } = await login(browser); const foreign = fixture('other-draft')
    const before = state(await read(foreign.id)); await page.goto(editPath(foreign.id))
    await expect(body(page)).toHaveCount(0); expect(state(await read(foreign.id))).toEqual(before)
  })
})

test('AUTO-15 owner or status changing after load blocks autosave and its queued edits', async ({ browser }) => {
  await test.step('AUTO_CHANGED_POLICY', async () => {
    for (const patch of [{ status: 'PUBLISHED' }, { authorId: userId('other') }]) {
      const { page } = await login(browser); const id = await create(page, 'policy'); const count = countArticleActions(page)
      await title(page).fill('Snapshot quyền cũ')
      try {
        await alterFixture(db, process.env, manifest, 'article', id, patch, persist)
        const changed = state(await read(id)); await tick(page)
        await expect(page.locator('[data-error-code="NOT_EDITABLE"], [data-error-code="NOT_FOUND"], [data-error-code="EDIT_CONFLICT"]')).toBeVisible()
        await body(page).fill('Không tự ghi đè chính sách mới'); await tick(page, 10000)
        expect(count()).toBe(1); expect(state(await read(id))).toEqual(changed)
      } finally { await alterFixture(db, process.env, manifest, 'article', id, { status: 'DRAFT', authorId: userId('creator') }, persist) }
    }
  })
})

test('AUTO-16 expired browser session pauses autosave without redirecting the draft', async ({ browser }) => {
  await test.step('AUTO_EXPIRED_SESSION', async () => {
    const { context, page } = await login(browser); const id = await create(page, 'session'); const before = state(await read(id))
    const count = countArticleActions(page)
    await title(page).fill('Bản nháp khi hết phiên'); await context.clearCookies()
    await tick(page); await expect(error(page, 'FORBIDDEN')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`${id}/edit$`)); await expect(title(page)).toHaveValue('Bản nháp khi hết phiên')
    await tick(page, 10000); expect(count()).toBe(1); expect(state(await read(id))).toEqual(before)
  })
})

test('AUTO-19 composition blocks intermediate title and editor snapshots beyond debounce', async ({ browser }) => {
  await test.step('AUTO_COMPOSITION', async () => {
    const { page } = await login(browser); const id = await create(page, 'ime'); const count = countArticleActions(page)
    for (const [field, value] of [[title(page), 'Tiếng Việt hoàn chỉnh'], [body(page), 'Nội dung tiếng Việt hoàn chỉnh']] as const) {
      const before = count(); await field.dispatchEvent('compositionstart', { data: '' })
      await field.fill(value); await tick(page, 5000); expect(count()).toBe(before)
      await field.dispatchEvent('compositionend', { data: value })
      await tick(page, 1999); expect(count()).toBe(before)
      await tick(page, 1); await saved(page); expect(count()).toBe(before + 1)
    }
    const row = await read(id); expect(row.title).toBe('Tiếng Việt hoàn chỉnh'); expect(row.contentText).toBe('Nội dung tiếng Việt hoàn chỉnh')
    // Synthetic composition events prove app handling, not every OS input method.
  })
})

test('AUTO-21 navigation cancel preserves debounce and accepting during save prevents followup', async ({ browser }) => {
  await test.step('AUTO_NAVIGATION', async () => {
    const { page } = await login(browser); const id = await create(page, 'navigate'); const count = countArticleActions(page)
    await title(page).fill('Giữ timer sau cancel')
    const unload = page.waitForEvent('dialog').then(async dialog => {
      expect(dialog.type()).toBe('beforeunload'); await dialog.dismiss()
    })
    // Cancellation has no new document to await. Trigger the native reload
    // without Playwright's navigation waiter; unexpected errors must propagate.
    await Promise.all([page.evaluate(() => window.location.reload()), unload])
    await expect(title(page)).toHaveValue('Giữ timer sau cancel')
    await dialogLink(page, false)
    await tick(page); await saved(page); expect(count()).toBe(1)
    const barrier = await hold(page)
    await title(page).fill('Snapshot đang gửi'); await tick(page); await barrier.ready()
    await title(page).fill('Không gửi followup sau rời trang'); await tick(page, 5000)
    await dialogLink(page, false); await expect(title(page)).toHaveValue('Không gửi followup sau rời trang')
    await dialogLink(page, true)
    // Next may serialize navigation behind the pending real action. Release the
    // response after the confirmed leave intent, before waiting for navigation.
    barrier.release(); await page.clock.resume(); await expect(page).toHaveURL(/\/creator\/articles$/)
    await pauseEditorClock(page)
    await tick(page, 10000)
    expect(count()).toBe(2); expect((await read(id)).title).toBe('Snapshot đang gửi')
  })
})

test('AUTO-23 persisted future millisecond tokens advance across consecutive autosaves', async ({ browser }) => {
  await test.step('AUTO_TOKEN_PRECISION', async () => {
    const { page } = await login(browser); const id = await create(page, 'precision')
    const future = new Date(Date.now() + 3600000)
    await alterFixture(db, process.env, manifest, 'article', id, { updatedAt: future }, persist)
    await openEdit(page, id)
    for (const offset of [1, 2]) {
      await title(page).fill(`Tự lưu token ${offset}`); await tick(page); await saved(page)
      expect((await read(id)).updatedAt.getTime()).toBe(future.getTime() + offset)
    }
  })
})
