import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { APP_ROLES, hasPermission } from '../src/lib/roles.ts'

// Real Server Component, PortalShell and Q0 request policy; only auth, DAL and
// framework boundaries are adapted. Fresh DB authorization/query contracts are
// covered by the query suite. This is SSR HTML evidence, not a browser or DB run.
const sourceRoot = new URL('../src/', import.meta.url)
const pageUrl = new URL('app/creator/review/page.tsx', sourceRoot).href
const shellUrl = new URL('components/portal/PortalShell.tsx', sourceRoot).href
const policyUrl = new URL('features/cms/article-review-queue-policy.ts', sourceRoot).href
const bridge = Symbol.for('cms-review-queue-route-test')
const denied = new Error('Authentication denied')
const redirected = new Error('Next redirect')
const clone = value => structuredClone(value)
let current, planReviewQueue
const record = (kind, args) => current.calls.push({ kind, ...(args === undefined ? {} : { args: clone(args) }) })
const allowed = (role, permission) => current.permissionOverrides?.[permission] ?? hasPermission(role, permission)
const adapter = {
  hasPermission: allowed,
  async requirePermission(permission) {
    record('auth', permission)
    if (!current.user?.id || !allowed(current.user.role, permission)) throw denied
    return { user: clone(current.user) }
  },
  redirect(path) { record('redirect', path); throw redirected },
  usePathname() { return '/creator/review' },
  signOut() { throw new Error('Read-only rendering must not sign out') },
  Link({ children, prefetch, ...props }) { void prefetch; return createElement('a', props, children) },
  async getArticleReviewQueue(user, request) {
    record('queue', { user, request })
    // Exercise the same pure request parser without claiming a database actor
    // revalidation from this route boundary double.
    const plan = planReviewQueue({ id: user.id, role: user.role, status: 'ACTIVE' }, request)
    if (!plan.ok) return plan
    return clone(current.result)
  },
}
globalThis[bridge] = adapter
const adapterModule = exports => `data:text/javascript,${encodeURIComponent(
  `const adapter = globalThis[Symbol.for('cms-review-queue-route-test')]; ${exports}`,
)}`
const rolesAdapter = adapterModule('export const hasPermission = adapter.hasPermission;')
const replacements = new Map([
  ['@/lib/authz', adapterModule('export const requirePermission = adapter.requirePermission;')],
  ['@/features/cms/article-review-queue-query', adapterModule('export const getArticleReviewQueue = adapter.getArticleReviewQueue;')],
  ['next/navigation', adapterModule('export const redirect = adapter.redirect; export const usePathname = adapter.usePathname;')],
  ['next/link', adapterModule('export default adapter.Link;')],
  ['next-auth/react', adapterModule('export const signOut = adapter.signOut;')],
])
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (replacements.has(specifier)) return nextResolve(replacements.get(specifier), context)
    if (specifier === '@/components/portal/PortalShell') return nextResolve(shellUrl, context)
    if (specifier === '@/lib/roles' && context.parentURL === pageUrl) return nextResolve(rolesAdapter, context)
    if (specifier.startsWith('@/')) return nextResolve(new URL(`${specifier.slice(2)}.ts`, sourceRoot).href, context)
    if (context.parentURL?.startsWith(sourceRoot.href) && /^\.\.?\//.test(specifier) && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context)
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if ([pageUrl, shellUrl].includes(url)) {
      const source = ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
      } }).outputText
      return { format: 'module', shortCircuit: true, source }
    }
    return nextLoad(url, context)
  },
})
let pageModule
try {
  ;({ planReviewQueue } = await import(policyUrl))
  pageModule = await import(pageUrl)
} finally { hook.deregister(); delete globalThis[bridge] }
const ReviewQueuePage = pageModule.default
function item(overrides = {}) {
  return { articleId: 'article-a', versionId: 'version-a', versionNumber: 3,
    title: 'Captured submitted title', basisUpdatedAt: '2026-10-10T01:02:03.456Z', submittedAt: '2026-10-10T02:03:04.567Z',
    audience: { accessMode: 'PUBLIC', productIds: [] }, ...overrides }
}
function scenario(role = 'ADMIN', overrides = {}) {
  current = { user: { id: 'reviewer-a', role, name: 'Reviewer', email: 'PRIVATE_EMAIL' },
    result: { ok: true, data: { items: [item()], nextCursor: null } }, calls: [], ...overrides }
  return current
}
function searchParams(value) { return { then(resolve) { record('params', value); resolve(value) } } }
async function render(request = {}) {
  return renderToStaticMarkup(await ReviewQueuePage({ searchParams: searchParams(request) }))
}
const calls = kind => current.calls.filter(call => call.kind === kind)
const hrefs = html => [...html.matchAll(/\bhref="([^"]*)"/g)].map(match => match[1].replaceAll('&amp;', '&'))
function queueSection(html) {
  const matched = html.match(/<section aria-labelledby="review-queue-heading"[^>]*>([\s\S]*?)<\/section>/)
  assert.ok(matched, 'Actual queue section must exist before read-only assertions')
  return matched[1]
}

test('Q1 route role matrix authenticates before parameters and rejects every role missing reviewer permissions', async () => {
  for (const role of [null, ...APP_ROLES]) {
    scenario(role ?? 'CLIENT', role === null ? { user: null } : {})
    if (role && hasPermission(role, 'cms:article:read:any') && hasPermission(role, 'cms:article:review')) {
      const html = await render()
      assert.match(html, /Captured submitted title/)
      assert.deepEqual(current.calls.map(call => call.kind), ['auth', 'params', 'queue'])
      assert.equal(calls('auth')[0].args, 'cms:article:review')
    } else {
      await assert.rejects(render({ role: 'SUPER_ADMIN', userId: 'reviewer-a' }), error => error === denied)
      assert.deepEqual(current.calls, [{ kind: 'auth', args: 'cms:article:review' }])
    }
  }
})

test('Q1 route requires both permissions independently before query string or DAL access', async () => {
  for (const [review, readAny] of [[false, true], [true, false], [false, false]]) {
    scenario('ADMIN', { permissionOverrides: { 'cms:article:review': review, 'cms:article:read:any': readAny } })
    await assert.rejects(render(), error => error === (review ? redirected : denied))
    assert.equal(calls('params').length, 0)
    assert.equal(calls('queue').length, 0)
    if (review) assert.deepEqual(calls('redirect'), [{ kind: 'redirect', args: '/creator' }])
  }
})

test('Q1 route supplies only the authenticated actor and preserves invalid transport input for safe rejection', async () => {
  for (const request of [
    { cursor: ['a', 'b'] }, { cursor: '../secret' }, { filter: 'DRAFT' }, { filter: ['SUBMITTED'] },
    { limit: '0' }, { limit: '51' }, { limit: '01' }, { limit: '1e1' }, { limit: ['20'] },
    { userId: 'other-reviewer' }, { role: 'SUPER_ADMIN' }, { page: '2' },
  ]) {
    scenario()
    const html = await render(request)
    assert.match(html, /data-error-code="VALIDATION_ERROR"/)
    assert.equal(html.includes('Captured submitted title'), false)
    assert.equal(calls('queue').length, 1)
    assert.deepEqual(calls('queue')[0].args.user, current.user)
    assert.equal(hrefs(queueSection(html)).some(href => href.includes('cursor=')), false)
  }
})

test('Q1 route renders captured PUBLIC and PAID metadata without granting Product selection or reader access', async () => {
  scenario('SUPER_ADMIN', { result: { ok: true, data: { items: [item(), item({ articleId: 'article-b', versionId: 'version-b',
    title: 'Captured paid title', audience: { accessMode: 'PAID_PRODUCT', productIds: ['product-a', 'product-b'] } })], nextCursor: null } } })
  const html = queueSection(await render())
  for (const text of ['article-a', 'version-a', 'Captured submitted title', 'Captured paid title', 'PUBLIC', 'PAID_PRODUCT', 'product-a', 'product-b', 'SUBMITTED']) {
    assert.ok(html.includes(text), text)
  }
  assert.match(html, /datetime="2026-10-10T01:02:03\.456Z"/i)
  assert.match(html, /datetime="2026-10-10T02:03:04\.567Z"/i)
  assert.match(html, /không xác nhận khả năng chọn sản phẩm hiện tại hoặc quyền truy cập của người đọc/)
  assert.equal(/<button\b|<form\b/i.test(html), false)
  assert.deepEqual(hrefs(html), ['/creator'])
})

test('Q1 HTML escapes hostile captured metadata and does not spread body, notes, media or session secrets', async () => {
  const privateExtras = { contentJson: { text: 'PRIVATE_EDITOR_JSON' }, contentText: 'PRIVATE_PAID_BODY',
    note: 'PRIVATE_REVIEW_NOTE', internalNote: 'PRIVATE_INTERNAL_NOTE', receipt: 'PRIVATE_RECEIPT',
    objectPath: 'PRIVATE_STORAGE_PATH', url: 'https://invalid.example/PRIVATE_MEDIA_URL' }
  scenario('ADMIN', { result: { ok: true, data: { items: [item({ ...privateExtras,
    title: '<img src="https://invalid.example/x" onerror="hostile()">',
    audience: { accessMode: 'PAID_PRODUCT', productIds: ['product-safe'], ...privateExtras },
  })], nextCursor: null, ...privateExtras } } })
  const html = await render()
  assert.equal(html.includes('PRIVATE_'), false)
  assert.equal(html.includes('<img src="https://invalid.example'), false)
  assert.match(html, /&lt;img src=&quot;https:\/\/invalid\.example\/x&quot;/)
  assert.equal(/<script\b/i.test(queueSection(html)), false)
})

test('Q1 pagination uses only keyset cursor with validated filter and limit, never offset or client identity', async () => {
  const nextCursor = Buffer.from(JSON.stringify({ v: 1, filter: 'SUBMITTED', submittedAt: '2026-10-10T02:03:04.567Z', id: 'article-a' })).toString('base64url')
  for (const request of [{}, { filter: 'SUBMITTED', limit: '1' }, { limit: '50', cursor: nextCursor }]) {
    scenario('ADMIN', { result: { ok: true, data: { items: [item()], nextCursor } } })
    const html = queueSection(await render(request))
    const next = hrefs(html).find(href => href.startsWith('/creator/review?'))
    assert.ok(next)
    const parsed = new URL(next, 'https://cms.invalid')
    assert.deepEqual([...parsed.searchParams.keys()].sort(), ['cursor', 'filter', 'limit'])
    assert.equal(parsed.searchParams.get('filter'), 'SUBMITTED')
    assert.equal(parsed.searchParams.get('limit'), request.limit ?? '20')
    assert.equal(parsed.searchParams.get('cursor'), nextCursor)
    assert.match(html, /Trang sau/)
    assert.deepEqual(calls('queue')[0].args.request, {
      ...request, ...(request.limit === undefined ? {} : { limit: Number(request.limit) }),
    })
  }
})

test('Q1 empty and last pages contain no fabricated row or next link', async () => {
  for (const items of [[], [item()]]) {
    scenario('ADMIN', { result: { ok: true, data: { items, nextCursor: null } } })
    const html = queueSection(await render())
    assert.equal(html.includes('Chưa có bài viết chờ biên tập.'), items.length === 0)
    assert.equal(html.includes('Captured submitted title'), items.length > 0)
    assert.equal(hrefs(html).some(href => href.startsWith('/creator/review?')), false)
  }
})

test('Q1 safe DAL failures render no rows, pagination or raw diagnostics, including authorization revoked after session', async () => {
  for (const error of ['FORBIDDEN', 'VALIDATION_ERROR', 'INVALID_QUEUE_DATA', 'INTERNAL_ERROR']) {
    scenario('ADMIN', { result: { ok: false, error, message: 'PRIVATE_DB_CREDENTIALS', cause: { note: 'PRIVATE_NOTE' } } })
    const html = await render()
    assert.match(html, new RegExp(`data-error-code="${error}"`))
    assert.equal(html.includes('PRIVATE_'), false)
    assert.equal(html.includes('Captured submitted title'), false)
    assert.equal(html.includes('Chưa có bài viết chờ biên tập.'), false)
    assert.deepEqual(hrefs(queueSection(html)), ['/creator'])
  }
})

test('Q1 private route declares request-time rendering, no shared page revalidation and no indexing metadata', () => {
  assert.equal(pageModule.dynamic, 'force-dynamic')
  assert.equal(pageModule.revalidate, 0)
  assert.deepEqual(pageModule.metadata.robots, { index: false, follow: false, googleBot: { index: false, follow: false } })
  assert.deepEqual(pageModule.metadata.alternates, { canonical: null })
  assert.equal(pageModule.metadata.openGraph, null)
  assert.equal(pageModule.metadata.twitter, null)
  const source = readFileSync(new URL(pageUrl), 'utf8')
  assert.equal(/^\s*['"]use client['"]/.test(source), false)
  assert.equal(/['"]use cache['"]|unstable_cache|dangerouslySetInnerHTML/.test(source), false)
})
