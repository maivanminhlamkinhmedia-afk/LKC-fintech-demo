import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import type { Article } from '@prisma/client'
import { connectStaging, demand, STAGING_BASE_URL } from '../../scripts/cms-e2e/guard.mjs'
import { loadManifest, saveManifest, discoverCreatedArticles, fixtureArticle } from '../../scripts/cms-e2e/fixtures.mjs'
import { validateEditorDocument } from '../../src/features/cms/editor-schema'

type FixtureManifest = {
  runId: string
  namespace: string
  users: { key: string; id: string; email: string; role: string }[]
  articles: { key: string; id: string; slug: string; authorId: string; allowedOwnerIds: string[]; status: string }[]
}
let manifest: FixtureManifest
let db: Awaited<ReturnType<typeof connectStaging>>
let credentials: { creator: { email: string; password: string } }
const contexts: BrowserContext[] = []
const manifestFile = () => process.env.CMS_E2E_MANIFEST as string
const persist = (value: unknown) => saveManifest(manifestFile(), value)
const body = (page: Page) => page.getByRole('textbox', { name: 'Nội dung bài viết', exact: true })
const save = (page: Page) => page.getByRole('button', { name: 'Lưu nháp', exact: true }).click()
const saved = (page: Page) => expect(page.getByRole('status').filter({ hasText: /^Đã lưu$/ })).toBeVisible()
const readArticle = async (id: string) => await fixtureArticle(db, manifest, id) as Article
const snapshot = (article: Article) => ({
  title: article.title, slug: article.slug, excerpt: article.excerpt,
  contentJson: article.contentJson, contentText: article.contentText,
  authorId: article.authorId, status: article.status, updatedAt: article.updatedAt.toISOString(),
})

async function login(browser: Browser, clipboard = false) {
  const context = await browser.newContext({ baseURL: STAGING_BASE_URL })
  contexts.push(context)
  if (clipboard) await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: STAGING_BASE_URL })
  const page = await context.newPage()
  try {
    await page.goto('/dang-nhap')
    await page.getByLabel('Email', { exact: true }).fill(credentials.creator.email)
    await page.getByLabel('Mật khẩu', { exact: true }).fill(credentials.creator.password)
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard$/)
  } catch { throw new Error('Fixture login failed for creator; credential diagnostics suppressed') }
  return { context, page }
}

async function newDraft(page: Page, suffix: string) {
  await page.goto('/creator/articles/new')
  await page.getByLabel('Tiêu đề', { exact: true }).fill(`Kiểm tra an toàn ${suffix}`)
  await page.getByLabel('Slug', { exact: true }).fill(`${manifest.namespace}-safety-${suffix}`)
  await page.getByLabel('Tóm tắt', { exact: true }).fill('Tóm tắt kiểm tra staging')
  await expect(body(page)).toBeVisible()
}

async function registerCreated(page: Page) {
  await expect(page).toHaveURL(/\/creator\/articles\/[^/]+\/edit$/)
  const id = new URL(page.url()).pathname.split('/').at(-2)!
  await discoverCreatedArticles(db, process.env, manifest, persist)
  demand(manifest.articles.some(article => article.id === id), 'UI_ARTICLE_NOT_RECORDED')
  await saved(page)
  return id
}

async function assertSafePastedDom(page: Page) {
  const editor = body(page)
  await expect(editor).toContainText('Nội dung dán tiếng Việt')
  await expect(editor.locator('a')).toHaveCount(1)
  const link = editor.getByRole('link', { name: 'Liên kết an toàn', exact: true })
  await expect(link).toHaveAttribute('href', 'https://example.com/vi')
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow')
  await expect(link).not.toHaveAttribute('class')
  await expect(link).not.toHaveAttribute('title')
  await expect(editor.locator('script, iframe, object, embed, img, svg')).toHaveCount(0)
  expect(await editor.evaluate(element => Array.from(element.querySelectorAll('*')).some(node =>
    Array.from(node.attributes).some(attribute => /^on/i.test(attribute.name))))).toBe(false)
  expect(await page.evaluate(() => (window as Window & { __cms005PasteExecuted?: boolean }).__cms005PasteExecuted === true)).toBe(false)
}

test.beforeAll(async () => {
  // Discovery imports this file without entering hooks, connecting or writing.
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

test('EDIT-18 real HTML clipboard paste removes unsafe content and persists canonical safe links', async ({ browser }) => {
  const { page } = await login(browser, true)
  await newDraft(page, 'paste')
  await page.evaluate(async () => {
    const state = window as Window & { __cms005PasteExecuted?: boolean }
    state.__cms005PasteExecuted = false
    const html = '<p>Nội dung dán tiếng Việt</p>'
      + '<p><a href="https://example.com/vi" target="_self" rel="opener" class="copied-style" title="Copied title" onclick="window.__cms005PasteExecuted=true">Liên kết an toàn</a></p>'
      + '<p><a href="javascript:window.__cms005PasteExecuted=true">Liên kết javascript</a> '
      + '<a href="data:text/html,unsafe">Liên kết data</a> '
      + '<a href="https://user:secret@example.com">Liên kết có thông tin đăng nhập</a></p>'
      + '<script>window.__cms005PasteExecuted=true</script>'
      + '<img src="cms005-missing-image" onerror="window.__cms005PasteExecuted=true">'
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob(['Nội dung dán tiếng Việt'], { type: 'text/plain' }),
    })])
  })
  // Use Chromium's clipboard and native paste event, not editor setContent or a
  // mocked server request. Anchor assertions ensure the HTML path was exercised.
  await body(page).focus()
  await page.keyboard.press('ControlOrMeta+V')
  await assertSafePastedDom(page)
  await save(page)
  const id = await registerCreated(page)
  const row = await readArticle(id)
  const validated = validateEditorDocument(row.contentJson)
  expect(validated.contentJson).toEqual(row.contentJson)
  expect(validated.contentText).toBe(row.contentText)
  const links: Record<string, unknown>[] = []
  const collect = (node: typeof validated.contentJson) => {
    for (const mark of node.marks ?? []) if (mark.type === 'link') links.push(mark.attrs ?? {})
    for (const child of node.content ?? []) collect(child)
  }
  collect(validated.contentJson)
  expect(links).toEqual([{ href: 'https://example.com/vi', target: '_blank',
    rel: 'noopener noreferrer nofollow', class: null, title: null }])
  await page.reload()
  await assertSafePastedDom(page)
})

test('EDIT-20 offline save retains the draft, dirty app-link dismissal stays in editor, and explicit retry succeeds', async ({ browser }) => {
  const { context, page } = await login(browser)
  await newDraft(page, 'offline')
  await body(page).fill('Nội dung đã lưu trước khi mất mạng')
  await save(page)
  const id = await registerCreated(page)
  const before = snapshot(await readArticle(id))
  const title = 'Tiêu đề chưa lưu khi mất mạng'
  const text = 'Bản nháp tiếng Việt cần giữ lại khi mất mạng'
  await page.getByLabel('Tiêu đề', { exact: true }).fill(title)
  await page.getByLabel('Tóm tắt', { exact: true }).fill('Tóm tắt chưa lưu')
  await body(page).fill(text)
  try {
    await context.setOffline(true)
    const failedRequest = page.waitForEvent('requestfailed', {
      predicate: request => request.method() === 'POST' && 'next-action' in request.headers(),
    })
    await save(page)
    await failedRequest
    await expect(page.getByRole('status').filter({ hasText: /^Lưu thất bại$/ })).toBeVisible()
    await expect(page.locator('[data-error-code="INTERNAL_ERROR"]')).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: /^Đã lưu$/ })).toHaveCount(0)
    await expect(page.getByLabel('Tiêu đề', { exact: true })).toHaveValue(title)
    await expect(page.getByLabel('Tóm tắt', { exact: true })).toHaveValue('Tóm tắt chưa lưu')
    await expect(body(page)).toHaveText(text)
    expect(snapshot(await readArticle(id))).toEqual(before)

    const editorUrl = page.url()
    const dismissal = page.waitForEvent('dialog').then(async dialog => {
      const type = dialog.type()
      await dialog.dismiss()
      return type
    })
    const [, dialogType] = await Promise.all([
      page.getByRole('link', { name: 'Danh sách bài viết', exact: true }).click(), dismissal,
    ])
    expect(dialogType).toBe('confirm')
    await expect(page).toHaveURL(editorUrl)
    await expect(body(page)).toHaveText(text)
    await expect(page.getByLabel('Tiêu đề', { exact: true })).toHaveValue(title)
  } finally {
    // Never leave a context offline after a failed assertion or timeout.
    await context.setOffline(false)
  }
  await save(page)
  await saved(page)
  const after = await readArticle(id)
  expect(after.title).toBe(title)
  expect(after.excerpt).toBe('Tóm tắt chưa lưu')
  expect(after.contentText).toBe(text)
  expect(after.updatedAt.getTime()).toBeGreaterThan(Date.parse(before.updatedAt))
  expect(after.authorId).toBe(before.authorId)
  expect(after.status).toBe(before.status)
})
