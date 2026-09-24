import assert from 'node:assert/strict'
import { after } from 'node:test'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { APP_ROLES, hasPermission } from '../src/lib/roles.ts'

// These are server-route/Prisma-contract tests, not a browser or SQL simulation.
// Real routes, query functions, policies and PortalShell are imported. The client
// editor form is a captured component boundary; its browser UX is tested in E2E.
const sourceRoot = new URL('../src/', import.meta.url)
const listUrl = new URL('app/creator/articles/page.tsx', sourceRoot).href
const newUrl = new URL('app/creator/articles/new/page.tsx', sourceRoot).href
const editUrl = new URL('app/creator/articles/[id]/edit/page.tsx', sourceRoot).href
const shellUrl = new URL('components/portal/PortalShell.tsx', sourceRoot).href
const bridge = Symbol.for('cms-draft-routes-test-adapter')
const clone = value => structuredClone(value)
const authDenied = new Error('Authentication redirect')
const missing = new Error('Next notFound sentinel')
const redirected = new Error('Next redirect sentinel')
let current
const record = (kind, args) => current.calls.push({ kind, ...(args === undefined ? {} : { args: clone(args) }) })
const originalError = console.error
console.error = (...args) => current?.logs.push(args)
after(() => { console.error = originalError })
function noWrite() { throw new Error('GET routes cannot mutate articles or open write transactions') }
const adapter = {
  async requirePermission(permission) {
    record('auth', permission)
    if (!current.bypassGuard && (!current.user?.id || !hasPermission(current.user.role, permission))) throw authDenied
    return { user: clone(current.user) }
  },
  notFound() { record('notFound'); throw missing },
  redirect(path) { record('redirect', path); throw redirected },
  usePathname() { return '/creator/articles' },
  signOut() { throw new Error('Render must not sign out') },
  Link({ children, prefetch, ...props }) { void prefetch; return createElement('a', props, children) },
  ArticleDraftForm({ initial }) {
    record('form', initial)
    return createElement('div', { 'data-editor-form': initial ? 'edit' : 'new' }, 'Client editor boundary')
  },
  prisma: {
    article: {
      async findFirst(args) {
        record('editorQuery', args)
        if (current.queryError) throw current.queryError
        return clone(current.article)
      },
      async count(args) {
        record('count', args)
        if (current.queryError) throw current.queryError
        return current.total
      },
      async findMany(args) {
        record('list', args)
        if (current.queryError) throw current.queryError
        return clone(current.rows)
      },
      create: noWrite, update: noWrite, updateMany: noWrite, upsert: noWrite, delete: noWrite,
    },
    authorProfile: { findFirst: noWrite, findUnique: noWrite, create: noWrite },
    $transaction: noWrite,
  },
}
globalThis[bridge] = adapter
const adapterModule = exports => `data:text/javascript,${encodeURIComponent(
  `const adapter = globalThis[Symbol.for('cms-draft-routes-test-adapter')]; ${exports}`,
)}`
const replacements = new Map([
  ['@/lib/authz', adapterModule('export const requirePermission = adapter.requirePermission;')],
  ['@/lib/prisma', adapterModule('export const prisma = adapter.prisma;')],
  ['next/navigation', adapterModule('export const notFound = adapter.notFound; export const redirect = adapter.redirect; export const usePathname = adapter.usePathname;')],
  ['next/link', adapterModule('export default adapter.Link;')],
  ['next-auth/react', adapterModule('export const signOut = adapter.signOut;')],
  ['@/features/cms/components/ArticleDraftForm', adapterModule('export const ArticleDraftForm = adapter.ArticleDraftForm;')],
  ['server-only', 'data:text/javascript,export {};'],
])
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (replacements.has(specifier)) return nextResolve(replacements.get(specifier), context)
    if (specifier === '@/components/portal/PortalShell') return nextResolve(shellUrl, context)
    if (specifier.startsWith('@/')) return nextResolve(new URL(`${specifier.slice(2)}.ts`, sourceRoot).href, context)
    if (context.parentURL?.startsWith(sourceRoot.href) && specifier.startsWith('./') && !/\.[mc]?ts$/.test(specifier)) {
      return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context)
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    // Node may percent-encode the dynamic route's [id] path during resolution.
    if ([listUrl, newUrl, editUrl, shellUrl].some(candidate => decodeURI(candidate) === decodeURI(url))) {
      const source = ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
      } }).outputText
      return { format: 'module', shortCircuit: true, source }
    }
    return nextLoad(url, context)
  },
})
let ArticleListPage, NewArticlePage, EditArticlePage
try {
  ;({ default: ArticleListPage } = await import(listUrl))
  ;({ default: NewArticlePage } = await import(newUrl))
  ;({ default: EditArticlePage } = await import(editUrl))
} finally { hook.deregister(); delete globalThis[bridge] }

const updatedAt = new Date('2026-09-24T01:02:03.456Z')
const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Tiếng Việt trong bản nháp' }] }] }
function article(overrides = {}) {
  return { id: 'article-a', authorId: 'creator-a', title: 'Bài viết riêng', slug: 'bai-viet-rieng', excerpt: 'Tóm tắt', articleType: 'NEWS',
    status: 'DRAFT', updatedAt, publishedAt: null, editorSchemaVersion: 1, contentJson: doc, contentText: 'PRIVATE_DERIVED_TEXT',
    user: { password: 'PRIVATE_PASSWORD', email: 'PRIVATE_EMAIL' }, ...overrides }
}
function scenario(role = 'CREATOR', overrides = {}) {
  current = {
    user: { id: 'creator-a', role, name: 'Tác giả', email: 'PRIVATE_SESSION_EMAIL', password: 'PRIVATE_SESSION_PASSWORD' },
    article: article(), rows: [], total: 0, calls: [], logs: [], ...overrides,
  }
  return current
}
const calls = kind => current.calls.filter(call => call.kind === kind)
function params(value) {
  return { then(resolve) { record('params', value); resolve(value) } }
}
const renderNew = async () => renderToStaticMarkup(await NewArticlePage())
const renderEdit = async (id = 'article-a') => renderToStaticMarkup(await EditArticlePage({ params: params({ id }) }))
const renderList = async (page = '1') => renderToStaticMarkup(await ArticleListPage({ searchParams: params({ page }) }))
const hrefs = html => [...html.matchAll(/\bhref="([^"]*)"/g)].map(match => match[1])

test('EDIT-01/02: all three routes authenticate before params or article access for anonymous/non-CMS users', async () => {
  for (const role of [null, ...APP_ROLES.filter(role => !['CREATOR', 'ADMIN', 'SUPER_ADMIN'].includes(role))]) {
    for (const render of [renderNew, renderEdit, renderList]) {
      scenario(role ?? 'CLIENT', role === null ? { user: null } : {})
      await assert.rejects(render(), error => error === authDenied)
      assert.deepEqual(current.calls, [{ kind: 'auth', args: 'cms:access' }])
    }
  }
})

test('EDIT-05/16: new route renders a blank client form without query/write or requiring an AuthorProfile', async () => {
  for (const role of ['CREATOR', 'ADMIN', 'SUPER_ADMIN']) {
    scenario(role)
    const html = await renderNew()
    assert.match(html, /data-editor-form="new"/)
    assert.deepEqual(current.calls, [{ kind: 'auth', args: 'cms:access' }, { kind: 'form' }])
    assert.equal(html.includes('PRIVATE_'), false)
  }
})

test('new route retains canCreateArticle enforcement even if an upstream guard is accidentally bypassed', async () => {
  scenario('CLIENT', { bypassGuard: true })
  await assert.rejects(renderNew(), error => error === redirected)
  assert.deepEqual(current.calls, [{ kind: 'auth', args: 'cms:access' }, { kind: 'redirect', args: '/creator' }])
})

test('EDIT-07: missing and out-of-scope IDs use identical notFound handling with no leaked article/form data', async () => {
  for (const id of ['missing-article', 'foreign-article']) {
    // A scoped Prisma miss is the boundary fixture; SQL ownership filtering is
    // verified by the actual where contract and later staging tests.
    scenario('CREATOR', { article: null })
    await assert.rejects(renderEdit(id), error => error === missing)
    assert.deepEqual(current.calls.map(call => call.kind), ['auth', 'params', 'editorQuery', 'notFound'])
    assert.deepEqual(calls('editorQuery')[0].args.where, { AND: [{ id }, { authorId: 'creator-a' }] })
    assert.equal(calls('form').length, 0)
  }
  for (const id of ['', '../secret', 'x'.repeat(192)]) {
    scenario()
    await assert.rejects(renderEdit(id), error => error === missing)
    assert.equal(calls('editorQuery').length, 0)
    assert.equal(calls('form').length, 0)
  }
})

test('EDIT-06/08/09: eligible own/admin edit routes pass only safe canonical form data after scoped loading', async () => {
  for (const role of ['CREATOR', 'ADMIN', 'SUPER_ADMIN']) {
    for (const status of ['DRAFT', 'CHANGES_REQUESTED']) {
      const authorId = role === 'CREATOR' ? 'creator-a' : 'super-admin-author'
      scenario(role, { article: article({ status, authorId }) })
      const html = await renderEdit()
      assert.match(html, /data-editor-form="edit"/)
      assert.equal(html.includes('PRIVATE_'), false)
      assert.deepEqual(current.calls.slice(0, 3).map(call => call.kind), ['auth', 'params', 'editorQuery'])
      assert.deepEqual(calls('editorQuery')[0].args.where, { AND: [{ id: 'article-a' }, role === 'CREATOR' ? { authorId: 'creator-a' } : {}] })
      assert.deepEqual(calls('form')[0].args, { id: 'article-a', title: 'Bài viết riêng', slug: 'bai-viet-rieng', excerpt: 'Tóm tắt',
        articleType: 'NEWS', contentJson: doc, updatedAt: updatedAt.toISOString() })
    }
  }
})

test('EDIT-10: no role can open the form for non-editable workflow states', async () => {
  for (const role of ['CREATOR', 'ADMIN', 'SUPER_ADMIN']) {
    for (const status of ['SUBMITTED', 'EDITORIAL_REVIEW', 'FACT_CHECK', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'CORRECTED', 'ARCHIVED']) {
      scenario(role, { article: article({ status }) })
      const html = await renderEdit()
      assert.match(html, /data-error-code="NOT_EDITABLE"/)
      assert.equal(calls('form').length, 0)
      assert.equal(html.includes('Bài viết riêng'), false)
      assert.equal(html.includes('Tiếng Việt trong bản nháp'), false)
      assert.ok(hrefs(html).includes('/creator/articles'))
    }
  }
})

test('EDIT-17: unsupported persisted schema/documents show a safe error instead of an overwriting editor', async () => {
  for (const row of [article({ editorSchemaVersion: 2 }), article({ contentJson: { type: 'doc', content: [{ type: 'image' }] } })]) {
    scenario('ADMIN', { article: row })
    const html = await renderEdit()
    assert.match(html, /data-error-code="UNSUPPORTED_DOCUMENT"/)
    assert.equal(calls('form').length, 0)
    assert.equal(html.includes('Bài viết riêng'), false)
    assert.equal(html.includes('PRIVATE_'), false)
  }
})

test('EDIT-20: edit query failures render generic safe errors and never a form or raw database diagnostics', async () => {
  scenario('CREATOR', { queryError: new Error('PRIVATE DB connection credentials') })
  const html = await renderEdit()
  assert.match(html, /data-error-code="INTERNAL_ERROR"/)
  assert.equal(html.includes('PRIVATE_'), false)
  assert.equal(calls('form').length, 0)
  assert.equal(JSON.stringify(current.logs).includes('PRIVATE_'), false)
})

test('EDIT-21: list route passes validated pagination to scoped minimal queries and renders next/previous links', async () => {
  scenario('CREATOR', { total: 45, rows: [article()] })
  const html = await renderList('2')
  assert.deepEqual(current.calls.slice(0, 4).map(call => call.kind), ['auth', 'params', 'count', 'list'])
  assert.deepEqual(calls('count')[0].args, { where: { AND: [{ authorId: 'creator-a' }] } })
  assert.deepEqual(calls('list')[0].args, {
    where: { AND: [{ authorId: 'creator-a' }] },
    select: { id: true, title: true, slug: true, authorId: true, status: true, articleType: true, updatedAt: true, publishedAt: true },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: 20, take: 20,
  })
  assert.ok(hrefs(html).includes('/creator/articles?page=1'))
  assert.ok(hrefs(html).includes('/creator/articles?page=3'))
  assert.match(html, /Trang 2 \/ 3/)
  assert.equal(html.includes('PRIVATE_'), false)
  assert.equal(html.includes('Tiếng Việt trong bản nháp'), false)
})

test('EDIT-21: creator/admin list edit links obey ownership and task-specific status restrictions', async () => {
  for (const role of ['CREATOR', 'ADMIN', 'SUPER_ADMIN']) {
    const authorId = role === 'CREATOR' ? 'creator-a' : 'foreign-author'
    const rows = ['DRAFT', 'CHANGES_REQUESTED', 'PUBLISHED', 'CORRECTED', 'SUBMITTED', 'ARCHIVED']
      .map(status => article({ id: `article-${status}`, authorId, status, title: `Title ${status}` }))
    scenario(role, { rows, total: rows.length })
    const html = await renderList()
    const links = hrefs(html)
    for (const status of ['DRAFT', 'CHANGES_REQUESTED']) assert.ok(links.includes(`/creator/articles/article-${status}/edit`))
    for (const status of ['PUBLISHED', 'CORRECTED', 'SUBMITTED', 'ARCHIVED']) {
      assert.equal(links.includes(`/creator/articles/article-${status}/edit`), false)
      assert.ok(html.includes(`Title ${status}`))
    }
    assert.deepEqual(calls('list')[0].args.where, { AND: [role === 'CREATOR' ? { authorId: 'creator-a' } : {}] })
    assert.ok(links.includes('/creator/articles/new'))
  }
})

test('list route safely handles malformed pages, empty results and last-page bounds', async () => {
  for (const page of [undefined, ['1', '2'], '0', '-2', '1.5', '1e3', '9007199254740992']) {
    scenario('CREATOR', { total: 45 })
    const html = await renderList(page)
    assert.equal(calls('list')[0].args.skip, 0)
    assert.equal(hrefs(html).includes('/creator/articles?page=0'), false)
  }
  scenario('CREATOR', { total: 45 })
  const last = await renderList('999')
  assert.equal(calls('list')[0].args.skip, 40)
  assert.ok(hrefs(last).includes('/creator/articles?page=2'))
  assert.equal(hrefs(last).includes('/creator/articles?page=4'), false)
  scenario()
  const empty = await renderList('10')
  assert.match(empty, /Chưa có bài viết/)
  assert.match(empty, /Trang 1 \/ 1/)
  assert.equal(hrefs(empty).some(href => href.includes('/creator/articles?page=')), false)
})

test('list route lets a sanitized storage error reach the framework rather than rendering a fake empty success', async () => {
  scenario('CREATOR', { queryError: new Error('PRIVATE SQL') })
  await assert.rejects(renderList(), error => !error.message.includes('PRIVATE') && error.cause === undefined)
  assert.equal(JSON.stringify(current.logs).includes('PRIVATE'), false)
})
