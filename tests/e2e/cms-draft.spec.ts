import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import type { Article } from '@prisma/client'
import { connectStaging, demand } from '../../scripts/cms-e2e/guard.mjs'
import { loadManifest, saveManifest, discoverCreatedArticles, fixtureArticle, alterFixture } from '../../scripts/cms-e2e/fixtures.mjs'
import { pauseEditorClock } from './cms-autosave-support'

type Actor = 'creator' | 'other' | 'admin' | 'super' | 'analyst' | 'client'
type FixtureManifest = {
  runId: string
  namespace: string
  users: { key: Actor; id: string; email: string; role: string }[]
  articles: { key: string; id: string; slug: string; authorId: string; allowedOwnerIds: string[]; status: string }[]
}
let manifest: FixtureManifest
let db: Awaited<ReturnType<typeof connectStaging>>
let credentials: Record<Actor, { email: string; password: string }>
let counter = 0
const contexts: BrowserContext[] = []
const manifestFile = () => process.env.CMS_E2E_MANIFEST as string
const persist = (value: unknown) => saveManifest(manifestFile(), value)
const userId = (actor: Actor) => manifest.users.find(user => user.key === actor)!.id
const fixture = (key: string) => manifest.articles.find(article => article.key === key)!
const newSlug = (suffix: string) => `${manifest.namespace}-${suffix}-${++counter}`
const body = (page: Page) => page.getByRole('textbox', { name: 'Nội dung bài viết', exact: true })
const error = (page: Page, code: string) => page.locator(`[data-error-code="${code}"]`)
const editPath = (id: string) => `/creator/articles/${id}/edit`
const readArticle = async (id: string) => await fixtureArticle(db, manifest, id) as Article
const snapshot = (article: Article) => ({ title: article.title, contentJson: article.contentJson, contentText: article.contentText,
  authorId: article.authorId, status: article.status, updatedAt: article.updatedAt.toISOString() })

async function login(browser: Browser, actor: Actor) {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3001' })
  contexts.push(context)
  const page = await context.newPage()
  try {
    await page.goto('/dang-nhap')
    await page.getByLabel('Email', { exact: true }).fill(credentials[actor].email)
    await page.getByLabel('Mật khẩu', { exact: true }).fill(credentials[actor].password)
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard$/)
  } catch { throw new Error(`Fixture login failed for ${actor}; credential diagnostics suppressed`) }
  await page.clock.install()
  return { context, page }
}
async function openManualEdit(page: Page, id: string) {
  await page.clock.resume()
  await page.goto(editPath(id))
  await expect(body(page)).toBeVisible()
  // Keep the existing explicit-save assertions independent of the new 2s timer.
  await pauseEditorClock(page)
}
async function fillHeader(page: Page, slug: string, title = `Bài nháp tiếng Việt ${slug}`) {
  await page.getByLabel('Tiêu đề', { exact: true }).fill(title)
  await page.getByLabel('Slug', { exact: true }).fill(slug)
  await page.getByLabel('Tóm tắt', { exact: true }).fill('Tóm tắt kiểm tra staging')
}
async function save(page: Page) { await page.getByRole('button', { name: 'Lưu nháp', exact: true }).click() }
async function saved(page: Page) { await expect(page.getByRole('status').filter({ hasText: /^Đã lưu$/ })).toBeVisible() }
async function registerCreated(page: Page) {
  await expect(page).toHaveURL(/\/creator\/articles\/[^/]+\/edit$/)
  const id = new URL(page.url()).pathname.split('/').at(-2)!
  await discoverCreatedArticles(db, process.env, manifest, persist)
  demand(manifest.articles.some(article => article.id === id), 'UI_ARTICLE_NOT_RECORDED')
  return id
}

test.beforeAll(async () => {
  // Only explicit staging execution reaches these hooks. --list does not.
  demand(process.env.CMS_E2E_RUNNING === 'YES', 'USE_GUARDED_STAGING_RUNNER')
  manifest = await loadManifest(manifestFile()) as FixtureManifest
  credentials = JSON.parse(process.env.CMS_E2E_CREDENTIALS ?? '{}')
  db = await connectStaging(process.env)
})
test.afterEach(async () => {
  try { if (db) await discoverCreatedArticles(db, process.env, manifest, persist) }
  finally { await Promise.all(contexts.splice(0).map(context => context.close())) }
})
test.afterAll(async () => { if (db) await db.$disconnect() })

test('EDIT-01 anonymous new/edit redirects to login without article metadata', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3001' }); contexts.push(context)
  const page = await context.newPage()
  for (const path of ['/creator/articles/new', editPath(fixture('DRAFT').id)]) {
    await page.goto(path)
    await expect(page).toHaveURL(/\/dang-nhap(?:\?|$)/)
    await expect(page.getByText(`${manifest.namespace} DRAFT`, { exact: true })).toHaveCount(0)
  }
})

for (const actor of ['client', 'analyst'] as const) {
  test(`EDIT-02 ${actor} direct routes deny access`, async ({ browser }) => {
    const { page } = await login(browser, actor)
    for (const path of ['/creator', '/creator/articles', '/creator/articles/new', editPath(fixture('DRAFT').id)]) {
      await page.goto(path)
      await expect(page).toHaveURL(/\/dashboard$/)
      await expect(page.getByRole('textbox', { name: 'Nội dung bài viết' })).toHaveCount(0)
    }
    await expect(page.locator('a[href="/creator"]')).toHaveCount(0)
  })
}

test('EDIT-04/05/06/21 create and refresh Vietnamese formatting with no writes from GET or typing', async ({ browser }) => {
  const { page } = await test.step('FMT_LOGIN', async () => login(browser, 'creator'))
  const before = await test.step('FMT_INPUT', async () => {
    const before = await db.article.count({ where: { authorId: userId('creator') } })
    await page.goto('/creator/articles/new')
    const slug = newSlug('round-trip')
    await fillHeader(page, slug)
    await body(page).fill('Nội dung tiếng Việt: cổ phiếu, thị trường và rủi ro.')
    return before
  })
  await test.step('FMT_BOLD', async () => {
    await body(page).press('ControlOrMeta+A')
    await body(page).press('ControlOrMeta+B')
    await body(page).press('ArrowRight')
  })
  await test.step('FMT_LIST', async () => {
    await body(page).press('Enter')
    await body(page).press('ControlOrMeta+Shift+8')
    await page.keyboard.type('Danh sách kiểm tra')
    await body(page).press('Enter')
    await body(page).press('Enter')
  })
  await test.step('FMT_CODE_BLOCK', async () => {
    const code = 'const tiếngViệt = "an toàn";\nconsole.log(tiếngViệt)'
    await page.getByRole('button', { name: 'Khối mã', exact: true }).click()
    // TipTap returns focus to the editor on an animation frame, after click can settle.
    await expect(body(page)).toBeFocused()
    await expect(body(page).locator('pre')).toBeVisible()
    await page.keyboard.type(code)
    // Check exact text (including the newline) before Save/DB can obscure the input boundary.
    await expect(body(page).locator('pre code')).toHaveJSProperty('textContent', code)
  })
  await test.step('FMT_NO_WRITE', async () => {
    expect(await db.article.count({ where: { authorId: userId('creator') } })).toBe(before)
  })
  const id = await test.step('FMT_SAVE_NAVIGATE', async () => {
    await save(page)
    return await registerCreated(page)
  })
  await test.step('FMT_DB', async () => {
    const row = await readArticle(id)
    expect(row.authorId).toBe(userId('creator'))
    expect(row.status).toBe('DRAFT')
    expect(row.editorSchemaVersion).toBe(1)
    expect(row.contentText).toContain('Nội dung tiếng Việt')
    expect(row.contentText).toContain('Danh sách kiểm tra')
    expect(row.contentText).toContain('const tiếngViệt = "an toàn";')
    expect(JSON.stringify(row.contentJson)).toContain('"bold"')
    expect(JSON.stringify(row.contentJson)).toContain('"bulletList"')
  })
  await test.step('FMT_RELOAD', async () => { await page.reload() })
  await test.step('FMT_DOM_TEXT', async () => {
    await expect(body(page)).toContainText('Nội dung tiếng Việt')
  })
  await test.step('FMT_DOM_BOLD', async () => {
    await expect(body(page).locator('strong')).toContainText('Nội dung tiếng Việt')
  })
  await test.step('FMT_DOM_LIST', async () => {
    await expect(body(page).locator('li')).toContainText('Danh sách kiểm tra')
  })
  await test.step('FMT_DOM_CODE', async () => {
    await expect(body(page).locator('pre code')).toContainText('const tiếngViệt')
  })
  await test.step('FMT_LIST_LINK', async () => {
    await page.goto('/creator/articles')
    await expect(page.locator(`a[href="${editPath(id)}"]`)).toBeVisible()
  })
  await test.step('FMT_DASHBOARD', async () => {
    await page.goto('/creator')
    await expect(page.locator(`a[href="${editPath(id)}"]`)).toBeVisible()
    const ownCount = await db.article.count({ where: { authorId: userId('creator') } })
    await expect(page.getByText('Tổng bài viết', { exact: true }).locator('..').locator('dd').first()).toHaveText(ownCount.toLocaleString('vi-VN'))
    await expect(page.getByText(`${manifest.namespace} other-draft`, { exact: true })).toHaveCount(0)
  })
})

test('EDIT-07 creator foreign ID behaves like missing ID without revealing metadata', async ({ browser }) => {
  const { page } = await login(browser, 'creator')
  const foreign = fixture('other-draft')
  for (const id of [foreign.id, `${manifest.namespace}-missing`]) {
    await page.goto(editPath(id))
    await expect(body(page)).toHaveCount(0)
    await expect(page.getByText(`${manifest.namespace} other-draft`, { exact: true })).toHaveCount(0)
  }
})

test('EDIT-08 creator saves own DRAFT and CHANGES_REQUESTED without changing status', async ({ browser }) => {
  const { page } = await login(browser, 'creator')
  for (const status of ['DRAFT', 'CHANGES_REQUESTED']) {
    const id = fixture(status).id
    await openManualEdit(page, id)
    await page.getByLabel('Tiêu đề', { exact: true }).fill(`${manifest.namespace} own ${status}`)
    await save(page); await saved(page)
    const row = await readArticle(id)
    expect(row.status).toBe(status)
    expect(row.authorId).toBe(userId('creator'))
  }
})

for (const actor of ['admin', 'super'] as const) {
  test(`EDIT-09 ${actor} edits foreign drafts without reassigning the author`, async ({ browser }) => {
    const { page } = await login(browser, actor)
    // ADMIN editing a SUPER_ADMIN-authored article follows article permissions,
    // not the stricter AuthorProfile hierarchy from CMS-003.
    const id = fixture(actor === 'admin' ? 'super-draft' : 'other-draft').id
    const before = await readArticle(id)
    await openManualEdit(page, id)
    await page.getByLabel('Tiêu đề', { exact: true }).fill(`${manifest.namespace} saved by ${actor}`)
    await save(page); await saved(page)
    const after = await readArticle(id)
    expect(after.authorId).toBe(before.authorId)
    expect(after.status).toBe(before.status)
  })
}

for (const actor of ['creator', 'admin', 'super'] as const) {
  test(`EDIT-10 ${actor} cannot edit articles outside DRAFT/CHANGES_REQUESTED`, async ({ browser }) => {
    const { page } = await login(browser, actor)
    for (const status of ['SUBMITTED', 'EDITORIAL_REVIEW', 'FACT_CHECK', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'CORRECTED', 'ARCHIVED']) {
      const id = fixture(status).id
      const before = snapshot(await readArticle(id))
      await page.goto(editPath(id))
      await expect(body(page)).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Lưu nháp', exact: true })).toHaveCount(0)
      expect(snapshot(await readArticle(id))).toEqual(before)
    }
  })
}

test('EDIT-11 suspended or demoted actor cannot save an already-open editor', async ({ browser }) => {
  for (const patch of [{ status: 'SUSPENDED' }, { role: 'CLIENT' }]) {
    const { page } = await login(browser, 'creator')
    const id = fixture('DRAFT').id
    await openManualEdit(page, id)
    await page.getByLabel('Tiêu đề', { exact: true }).fill(`${manifest.namespace} must not save`)
    const before = snapshot(await readArticle(id))
    try {
      await alterFixture(db, process.env, manifest, 'user', userId('creator'), patch, persist)
      await save(page)
      await expect(error(page, 'FORBIDDEN')).toBeVisible()
      await expect(page).toHaveURL(new RegExp(`${id}/edit$`))
      await expect(page.getByLabel('Tiêu đề', { exact: true })).toHaveValue(`${manifest.namespace} must not save`)
      expect(snapshot(await readArticle(id))).toEqual(before)
    } finally { await alterFixture(db, process.env, manifest, 'user', userId('creator'), { role: 'CREATOR', status: 'ACTIVE' }, persist) }
  }
})

test('EDIT-12 status and owner changes after opening cannot bypass the write guard', async ({ browser }) => {
  const id = fixture('DRAFT').id
  for (const patch of [{ status: 'PUBLISHED' }, { authorId: userId('other') }]) {
    const { page } = await login(browser, 'creator')
    await openManualEdit(page, id)
    await page.getByLabel('Tiêu đề', { exact: true }).fill(`${manifest.namespace} stale policy`)
    try {
      await alterFixture(db, process.env, manifest, 'article', id, patch, persist)
      const before = snapshot(await readArticle(id))
      await save(page)
      await expect(page.locator('[data-error-code="NOT_EDITABLE"], [data-error-code="NOT_FOUND"], [data-error-code="EDIT_CONFLICT"]')).toBeVisible()
      expect(snapshot(await readArticle(id))).toEqual(before)
    } finally { await alterFixture(db, process.env, manifest, 'article', id, { status: 'DRAFT', authorId: userId('creator') }, persist) }
  }
})

test('EDIT-13 simultaneous saves from two tabs have one winner and preserve the losing draft', async ({ browser }) => {
  const { context, page: first } = await login(browser, 'creator')
  const second = await context.newPage()
  const id = fixture('DRAFT').id
  await Promise.all([first.goto(editPath(id)), second.goto(editPath(id))])
  await expect(body(first)).toBeVisible(); await expect(body(second)).toBeVisible()
  // Clock controls the whole context, including both already-hydrated tabs.
  await pauseEditorClock(first)
  const titles = [`${manifest.namespace} tab first`, `${manifest.namespace} tab second`]
  await first.getByLabel('Tiêu đề', { exact: true }).fill(titles[0])
  await second.getByLabel('Tiêu đề', { exact: true }).fill(titles[1])
  await Promise.all([save(first), save(second)])
  await expect.poll(async () => (await error(first, 'EDIT_CONFLICT').count()) + (await error(second, 'EDIT_CONFLICT').count())).toBe(1)
  const winner = (await readArticle(id)).title
  expect(titles).toContain(winner)
  const loser = winner === titles[0] ? second : first
  await expect(loser.getByLabel('Tiêu đề', { exact: true })).toHaveValue(winner === titles[0] ? titles[1] : titles[0])
})

test('EDIT-14 real DATETIME(3) tokens advance by one millisecond when stored time is ahead of the clock', async ({ browser }) => {
  const { page } = await login(browser, 'creator')
  const id = fixture('DRAFT').id
  const future = new Date(Date.now() + 3_600_000)
  await alterFixture(db, process.env, manifest, 'article', id, { updatedAt: future }, persist)
  const stored = await readArticle(id)
  expect(stored.updatedAt.getTime()).toBe(future.getTime())
  await openManualEdit(page, id)
  for (const offset of [1, 2]) {
    await page.getByLabel('Tiêu đề', { exact: true }).fill(`${manifest.namespace} precision ${offset}`)
    await save(page); await saved(page)
    expect((await readArticle(id)).updatedAt.getTime()).toBe(future.getTime() + offset)
  }
})

test('EDIT-15 canonical slug collision is a form error with no duplicate article or metadata leak', async ({ browser }) => {
  const { page } = await login(browser, 'creator')
  const before = await db.article.count({ where: { authorId: userId('creator') } })
  await page.goto('/creator/articles/new')
  await fillHeader(page, fixture('DRAFT').slug.toUpperCase(), `${manifest.namespace} collision draft`)
  await save(page)
  await expect(error(page, 'SLUG_CONFLICT')).toBeVisible()
  await expect(page.getByLabel('Tiêu đề', { exact: true })).toHaveValue(`${manifest.namespace} collision draft`)
  expect(await db.article.count({ where: { authorId: userId('creator') } })).toBe(before)
})

test('EDIT-16 blank body saves without an author profile', async ({ browser }) => {
  const { page } = await login(browser, 'other')
  expect(await db.authorProfile.count({ where: { userId: userId('other') } })).toBe(0)
  await page.goto('/creator/articles/new')
  await fillHeader(page, newSlug('blank'))
  await save(page)
  const id = await registerCreated(page)
  const row = await readArticle(id)
  expect(row.contentText).toBe('')
  expect(row.contentJson).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
})

test('EDIT-22 editor works at 390/768/desktop and exposes keyboard-operable controls', async ({ browser }) => {
  const { page } = await login(browser, 'creator')
  await page.goto('/creator/articles/new')
  await fillHeader(page, newSlug('responsive'))
  await body(page).fill('Tiếng Việt '.repeat(150))
  await page.getByLabel('Tiêu đề', { exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Slug', { exact: true })).toBeFocused()
  await body(page).focus()
  await body(page).press('ControlOrMeta+A')
  await body(page).press('ControlOrMeta+I')
  await expect(body(page).locator('em')).toContainText('Tiếng Việt')
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 850 })
    await expect(body(page)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const buttons = page.getByRole('group', { name: 'Định dạng bài viết', exact: true }).locator('button')
    expect(await buttons.count()).toBeGreaterThan(0)
    for (const button of await buttons.all()) await expect(button).toHaveAttribute('type', 'button')
  }
  await body(page).focus()
  await body(page).press('ControlOrMeta+A')
  await page.keyboard.insertText(`const longLine = "${'x'.repeat(1200)}";`)
  await page.getByRole('button', { name: 'Khối mã', exact: true }).click()
  const code = body(page).locator('pre')
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 850 })
    await expect(code).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(await code.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
    expect(await code.evaluate(element => ['auto', 'scroll'].includes(getComputedStyle(element).overflowX))).toBe(true)
  }
})
