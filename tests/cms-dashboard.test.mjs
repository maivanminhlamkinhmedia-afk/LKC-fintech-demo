import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { APP_ROLES, ROLE_LABELS, hasPermission } from '../src/lib/roles.ts'

// Exercise the actual page, helper and navigation with installed TS/React tools.
// Only auth/database/framework boundaries are adapted. Prisma query arguments
// are asserted directly; the fixture does not duplicate Prisma's filter engine.
// These tests are not browser layout checks or live database integration tests.
const sourceRoot = new URL('../src/', import.meta.url)
const pageUrl = new URL('app/creator/page.tsx', sourceRoot).href
const homeUrl = new URL('app/dashboard/page.tsx', sourceRoot).href
const shellUrl = new URL('components/portal/PortalShell.tsx', sourceRoot).href
const helperUrl = new URL('features/cms/dashboard.ts', sourceRoot).href
const accessUrl = new URL('features/cms/access.ts', sourceRoot).href
const rolesUrl = new URL('lib/roles.ts', sourceRoot).href
const bridgeKey = Symbol.for('cms-dashboard-test-adapter')
const clone = value => structuredClone(value)
const denied = new Error('Authenticated CMS permission denied')
let current
const record = (kind, args) => current.calls.push({ kind, ...(args === undefined ? {} : { args: clone(args) }) })
async function query(kind, args, result) {
  record(kind, args)
  if (current.queryError?.kind === kind) throw current.queryError.error
  if (current.deferQueries) await new Promise(resolve => current.pending.push(resolve))
  return clone(result)
}
function forbiddenWrite() { throw new Error('Dashboard must never write or open a transaction') }
const adapter = {
  ROLE_LABELS,
  navHasPermission(role, permission) {
    if (current.navOverrides && Object.hasOwn(current.navOverrides, permission)) return current.navOverrides[permission]
    return hasPermission(role, permission)
  },
  async requirePermission(permission) {
    record('auth', permission)
    if (current.authError) throw current.authError
    if (!current.session?.user?.id || !hasPermission(current.session.user.role, permission)) throw denied
    return clone(current.session)
  },
  async requireUser() { record('requireUser'); return clone(current.session) },
  usePathname() { return '/creator' },
  signOut() { throw new Error('Navigation render must not sign out') },
  Link({ children, prefetch, ...props }) {
    void prefetch
    return createElement('a', props, children)
  },
  prisma: {
    article: {
      count(args) { return query('count', args, current.counts[current.countIndex++]) },
      findMany(args) { return query('recent', args, current.articles) },
      create: forbiddenWrite, update: forbiddenWrite, delete: forbiddenWrite, upsert: forbiddenWrite,
    },
    authorProfile: {
      findUnique(args) { return query('profile', args, current.profile) },
      create: forbiddenWrite, update: forbiddenWrite, delete: forbiddenWrite, upsert: forbiddenWrite,
    },
    $transaction: forbiddenWrite,
  },
}
globalThis[bridgeKey] = adapter
const adapterModule = exports => `data:text/javascript,${encodeURIComponent(
  `const adapter = globalThis[Symbol.for('cms-dashboard-test-adapter')]; ${exports}`,
)}`
const navRolesUrl = adapterModule('export const hasPermission = adapter.navHasPermission; export const ROLE_LABELS = adapter.ROLE_LABELS;')
const substitutes = new Map([
  ['@/lib/authz', adapterModule('export const requirePermission = adapter.requirePermission; export const requireUser = adapter.requireUser;')],
  ['@/lib/prisma', adapterModule('export const prisma = adapter.prisma;')],
  ['next/link', adapterModule('export default adapter.Link;')],
  ['next/navigation', adapterModule('export const usePathname = adapter.usePathname;')],
  ['next-auth/react', adapterModule('export const signOut = adapter.signOut;')],
])
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (substitutes.has(specifier)) return nextResolve(substitutes.get(specifier), context)
    if (specifier === '@/components/portal/PortalShell') return nextResolve(shellUrl, context)
    if (specifier === '@/lib/roles') return nextResolve([homeUrl, shellUrl].includes(context.parentURL) ? navRolesUrl : rolesUrl, context)
    if (specifier.startsWith('@/')) return nextResolve(new URL(`${specifier.slice(2)}.ts`, sourceRoot).href, context)
    if (context.parentURL === helperUrl && specifier === './access') return nextResolve(accessUrl, context)
    if (context.parentURL?.startsWith(sourceRoot.href) && specifier.startsWith('./') && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context)
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if ([pageUrl, homeUrl, shellUrl].includes(url)) {
      const source = ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
      } }).outputText
      return { format: 'module', shortCircuit: true, source }
    }
    return nextLoad(url, context)
  },
})
let CreatorPage, DashboardPage, PortalShell, helpers
try {
  helpers = await import(helperUrl)
  ;({ default: CreatorPage } = await import(pageUrl))
  ;({ default: DashboardPage } = await import(homeUrl))
  ;({ PortalShell } = await import(shellUrl))
} finally { hook.deregister(); delete globalThis[bridgeKey] }
const { dashboardArticleWhere, EDITORIAL_IN_PROGRESS_STATUSES, PUBLISHED_STATUSES, RECENT_ARTICLE_SELECT, OWN_AUTHOR_PROFILE_SELECT } = helpers

const creator = { id: 'creator-own', role: 'CREATOR', name: 'Session creator' }
const editorialStatuses = ['SUBMITTED', 'EDITORIAL_REVIEW', 'CHANGES_REQUESTED', 'FACT_CHECK', 'APPROVED', 'SCHEDULED']
const publishedStatuses = ['PUBLISHED', 'CORRECTED']
const recentSelect = Object.fromEntries(['id', 'authorId', 'title', 'slug', 'articleType', 'status', 'updatedAt', 'publishedAt'].map(field => [field, true]))
const profileSelect = Object.fromEntries(['displayName', 'slug', 'jobTitle', 'isPublic', 'updatedAt'].map(field => [field, true]))
function article(overrides = {}) {
  return { id: 'article-own', authorId: 'creator-own', title: 'Recent market article', slug: 'market-article', articleType: 'NEWS',
    status: 'DRAFT', updatedAt: new Date('2026-09-26T05:00:00Z'), publishedAt: null, ...overrides }
}
function profile(overrides = {}) {
  return { displayName: 'Own author profile', slug: 'own-author', jobTitle: 'Financial author',
    isPublic: true, updatedAt: new Date('2026-09-25T06:00:00Z'), ...overrides }
}
function scenario(role = 'CREATOR', overrides = {}) {
  current = {
    session: { user: { ...creator, id: `${role.toLowerCase()}-own`, role } },
    counts: [17, 3, 8, 6], countIndex: 0, articles: [article()], profile: profile(),
    calls: [], pending: [], ...overrides,
  }
  return current
}
const calls = kind => current.calls.filter(call => call.kind === kind)
const render = async () => renderToStaticMarkup(await CreatorPage())
const hrefs = html => [...html.matchAll(/\bhref="([^"]*)"/g)].map(match => match[1])
const countWhere = index => calls('count')[index].args.where
const expectedWhere = (scope, extra = {}) => ({ AND: [scope, extra] })
const roleScope = role => role === 'CREATOR' ? { authorId: current.session.user.id } : {}

for (const [id, role] of [['DASH-01', 'CREATOR'], ['DASH-02', 'ADMIN'], ['DASH-03', 'SUPER_ADMIN']]) {
  test(`${id}: ${role} enters the actual creator page through cms:access`, async () => {
    scenario(role)
    const html = await render()
    assert.deepEqual(current.calls[0], { kind: 'auth', args: 'cms:access' })
    assert.match(html, /Recent market article/)
    assert.equal(calls('count').length, 4)
    assert.equal(calls('recent').length, 1)
    assert.equal(calls('profile').length, 1)
  })
}

for (const [id, role] of [['DASH-04', 'ANALYST'], ['DASH-05', 'CLIENT']]) {
  test(`${id}: ${role} is denied before any dashboard query`, async () => {
    scenario(role)
    await assert.rejects(render(), error => error === denied)
    assert.deepEqual(current.calls, [{ kind: 'auth', args: 'cms:access' }])
  })
}

test('DASH-06: creator total count uses session ownership and renders the returned total', async () => {
  scenario()
  const html = await render()
  assert.deepEqual(countWhere(0), expectedWhere({ authorId: 'creator-own' }))
  assert.match(html, />17</)
})

test('DASH-07: creator recent query uses own scope with updatedAt DESC and a ten-row limit', async () => {
  scenario()
  await render()
  assert.deepEqual(calls('recent')[0].args, {
    where: expectedWhere({ authorId: 'creator-own' }), orderBy: { updatedAt: 'desc' }, take: 10, select: recentSelect,
  })
})

test('DASH-08: creator draft metric combines ownership and DRAFT without replacing scope', async () => {
  scenario()
  const html = await render()
  assert.deepEqual(countWhere(1), expectedWhere({ authorId: 'creator-own' }, { status: 'DRAFT' }))
  assert.match(html, />3</)
})

test('DASH-09: editorial filters use AND and a conflicting author filter cannot override ownership', async () => {
  const extra = Object.freeze({ authorId: 'foreign-author', status: 'DRAFT' })
  assert.deepEqual(dashboardArticleWhere(creator, extra), expectedWhere({ authorId: creator.id }, extra))
  assert.deepEqual(extra, { authorId: 'foreign-author', status: 'DRAFT' })
  scenario()
  const html = await render()
  assert.deepEqual(countWhere(2), expectedWhere({ authorId: 'creator-own' }, { status: { in: editorialStatuses } }))
  assert.match(html, />8</)
})

for (const [id, role] of [['DASH-10', 'ADMIN'], ['DASH-11', 'SUPER_ADMIN']]) {
  test(`${id}: ${role} sees all article scopes while the profile stays bound to its own session`, async () => {
    scenario(role)
    await render()
    assert.deepEqual(countWhere(0), expectedWhere({}))
    assert.deepEqual(countWhere(1), expectedWhere({}, { status: 'DRAFT' }))
    assert.deepEqual(countWhere(2), expectedWhere({}, { status: { in: editorialStatuses } }))
    assert.deepEqual(countWhere(3), expectedWhere({}, { status: { in: publishedStatuses } }))
    assert.deepEqual(calls('recent')[0].args.where, expectedWhere({}))
    assert.deepEqual(calls('profile')[0].args, { where: { userId: current.session.user.id }, select: profileSelect })
  })
}

test('DASH-12: recent select contains eight summary fields including editor eligibility owner and never fetches article body', async () => {
  assert.deepEqual(RECENT_ARTICLE_SELECT, recentSelect)
  scenario()
  await render()
  const args = calls('recent')[0].args
  assert.deepEqual(args.select, recentSelect)
  assert.equal(Object.hasOwn(args, 'include'), false)
  for (const field of ['contentJson', 'contentText', 'author', 'editor']) assert.equal(Object.hasOwn(args.select, field), false)
})

test('DASH-13: a missing own AuthorProfile renders an explicit non-failing empty state', async () => {
  scenario('CREATOR', { profile: null })
  const html = await render()
  assert.match(html, /Chưa có hồ sơ tác giả/i)
  assert.match(html, /Recent market article/)
  assert.deepEqual(calls('profile')[0].args, { where: { userId: 'creator-own' }, select: profileSelect })
})

test('DASH-14: zero counts and an empty recent list render a clear empty dashboard', async () => {
  scenario('CREATOR', { counts: [0, 0, 0, 0], articles: [], profile: null })
  const html = await render()
  assert.match(html, /Chưa có bài viết/i)
  assert.equal([...html.matchAll(/>0</g)].length, 4)
  assert.equal(html.includes('Recent market article'), false)
})

test('DASH-15: both real navigation surfaces follow cms:access, independently of legacy content:write', async () => {
  for (const role of APP_ROLES) {
    scenario(role)
    const expected = hasPermission(role, 'cms:access')
    const shell = renderToStaticMarkup(createElement(PortalShell, { user: current.session.user }, 'Content'))
    const home = renderToStaticMarkup(await DashboardPage())
    assert.equal(hrefs(shell).includes('/creator'), expected, `PortalShell ${role}`)
    assert.equal(hrefs(home).includes('/creator'), expected, `Dashboard ${role}`)
  }
  // The current matrix grants content:write to the same CMS roles. Deliberately
  // separate these two permissions to catch an accidental legacy guard regression.
  for (const allowed of [false, true]) {
    scenario('CREATOR', { navOverrides: { 'cms:access': allowed, 'content:write': !allowed } })
    const shell = renderToStaticMarkup(createElement(PortalShell, { user: current.session.user }, 'Content'))
    const home = renderToStaticMarkup(await DashboardPage())
    assert.equal(hrefs(shell).includes('/creator'), allowed)
    assert.equal(hrefs(home).includes('/creator'), allowed)
  }
})

test('DASH-16 / CMS-005: new list/create/edit links all resolve to implemented routes', async () => {
  for (const articles of [[article()], []]) {
    scenario('CREATOR', { articles })
    const html = await render()
    assert.equal(hrefs(html).includes('/creator/articles/new'), true)
    assert.equal(hrefs(html).includes('/creator/articles'), true)
    assert.equal(hrefs(html).includes('/creator/articles/article-own/edit'), articles.length > 0)
    assert.equal(/<form\b/i.test(html), false)
    for (const href of hrefs(html).filter(href => href.startsWith('/'))) {
      const path = href.split(/[?#]/)[0].replace(/^\//, '').replace(/^creator\/articles\/[^/]+\/edit$/, 'creator/articles/[id]/edit')
      assert.ok(existsSync(new URL(`app/${path ? `${path}/` : ''}page.tsx`, sourceRoot)), `Missing page for ${href}`)
    }
  }
})

test('CMS-005 recent edit links respect existing ownership and task-level status restrictions for every author role', async () => {
  for (const role of ['CREATOR', 'ADMIN', 'SUPER_ADMIN']) {
    for (const status of ['DRAFT', 'CHANGES_REQUESTED', 'SUBMITTED', 'EDITORIAL_REVIEW', 'FACT_CHECK', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'CORRECTED', 'ARCHIVED']) {
      for (const authorId of [`${role.toLowerCase()}-own`, 'another-author']) {
        scenario(role, { articles: [article({ status, authorId })] })
        const html = await render()
        const editable = ['DRAFT', 'CHANGES_REQUESTED'].includes(status) && (role !== 'CREATOR' || authorId === 'creator-own')
        assert.equal(hrefs(html).includes('/creator/articles/article-own/edit'), editable, `${role}/${status}/${authorId}`)
      }
    }
  }
})

test('all non-CMS roles and unauthenticated requests stop before data access', async () => {
  for (const role of ['MANAGER', 'SALES_MANAGER', 'SALES', 'ANALYST', 'EMPLOYEE', 'CLIENT']) {
    scenario(role)
    await assert.rejects(render(), error => error === denied)
    assert.equal(current.calls.length, 1)
  }
  const failure = new Error('Authentication redirect')
  scenario('CREATOR', { authError: failure })
  await assert.rejects(render(), error => error === failure)
  assert.deepEqual(current.calls, [{ kind: 'auth', args: 'cms:access' }])
})

test('pure dashboard scope fails closed for invalid actors even with broad or conflicting extra filters', () => {
  const invalidActors = [null, undefined, {}, { id: '', role: 'ADMIN' }, { id: '   ', role: 'SUPER_ADMIN' },
    { id: 123, role: 'CREATOR' }, ...['UNKNOWN', '__proto__', 'constructor', 'MANAGER', 'SALES_MANAGER', 'SALES', 'ANALYST', 'EMPLOYEE', 'CLIENT']
      .map(role => ({ id: creator.id, role }))]
  for (const actor of invalidActors) {
    for (const extra of [undefined, {}, { authorId: 'other-author' }, { OR: [{ status: 'DRAFT' }, {}] }]) {
      assert.deepEqual(dashboardArticleWhere(actor, extra), expectedWhere({ id: { in: [] } }, extra ?? {}))
    }
  }
  for (const role of ['ADMIN', 'SUPER_ADMIN']) assert.deepEqual(dashboardArticleWhere({ id: 'admin', role }), expectedWhere({}))
  assert.deepEqual(dashboardArticleWhere(creator), expectedWhere({ authorId: creator.id }))
})

test('status groups and published metric match the specification and exclude archived articles', async () => {
  assert.deepEqual([...EDITORIAL_IN_PROGRESS_STATUSES], editorialStatuses)
  assert.deepEqual([...PUBLISHED_STATUSES], publishedStatuses)
  for (const statuses of [EDITORIAL_IN_PROGRESS_STATUSES, PUBLISHED_STATUSES]) {
    assert.equal(statuses.includes('ARCHIVED'), false)
    assert.equal(new Set(statuses).size, statuses.length)
  }
  scenario()
  const html = await render()
  assert.deepEqual(countWhere(3), expectedWhere({ authorId: 'creator-own' }, { status: { in: publishedStatuses } }))
  assert.match(html, />6</)
})

test('every count and recent query includes the scope, for each eligible role', async () => {
  for (const role of ['CREATOR', 'ADMIN', 'SUPER_ADMIN']) {
    scenario(role)
    await render()
    for (const call of [...calls('count'), ...calls('recent')]) {
      assert.deepEqual(call.args.where.AND[0], roleScope(role))
      assert.equal(Object.hasOwn(call.args.where, 'authorId'), false)
    }
  }
})

test('six independent queries start together without a read transaction or N+1 queries', async () => {
  scenario('CREATOR', { deferQueries: true })
  const rendering = render()
  await new Promise(resolve => setImmediate(resolve))
  const launchedBeforeAnyResolution = current.pending.length
  current.deferQueries = false
  current.pending.forEach(resolve => resolve())
  await rendering
  assert.equal(launchedBeforeAnyResolution, 6)
  assert.equal(calls('count').length, 4)
  assert.equal(calls('recent').length, 1)
  assert.equal(calls('profile').length, 1)
  assert.equal(current.calls.length, 7)
})

test('own profile renders safe summary fields and accurate public/private visibility', async () => {
  assert.deepEqual(OWN_AUTHOR_PROFILE_SELECT, profileSelect)
  for (const isPublic of [true, false]) {
    scenario('CREATOR', { profile: profile({ isPublic }) })
    const html = await render()
    assert.match(html, /Own author profile/)
    assert.match(html, /own-author/)
    assert.match(html, /Financial author/)
    assert.match(html, isPublic ? /Công khai/i : /Riêng tư/i)
  }
})

test('rendering ignores private/body extras and escapes untrusted summary text', async () => {
  const privateData = { password: 'PRIVATE_PASSWORD', phone: 'PRIVATE_PHONE', email: 'PRIVATE_EMAIL',
    lastLoginAt: 'PRIVATE_LAST_LOGIN', contentJson: { text: 'PRIVATE_JSON_BODY' }, contentText: 'PRIVATE_TEXT_BODY' }
  scenario('CREATOR', {
    profile: profile({ ...privateData, user: privateData, displayName: '<script>bad-profile</script>' }),
    articles: [article({ ...privateData, author: privateData, title: '<script>bad-article</script>' })],
  })
  Object.assign(current.session.user, privateData, { name: null })
  const html = await render()
  assert.equal(html.includes('PRIVATE_'), false)
  assert.equal(html.includes('<script>bad-'), false)
  assert.match(html, /&lt;script&gt;bad-profile&lt;\/script&gt;/)
  assert.match(html, /&lt;script&gt;bad-article&lt;\/script&gt;/)
})

test('summary metrics keep their labels and recent cards show type, status and update/publication times', async () => {
  const publishedAt = new Date('2026-09-24T03:00:00Z')
  scenario('CREATOR', { articles: [article({ articleType: 'MARKET_UPDATE', status: 'PUBLISHED', publishedAt })] })
  const html = await render()
  for (const [label, count] of [['Tổng bài viết', 17], ['Draft', 3], ['Đang xử lý biên tập', 8], ['Đã xuất bản', 6]]) {
    assert.match(html, new RegExp(`<dt[^>]*>${label}</dt><dd[^>]*>${count}</dd>`))
  }
  assert.match(html, /Cập nhật thị trường/)
  assert.match(html, /market-article/)
  assert.match(html, /Đã xuất bản<\/span>/)
  assert.match(html, /datetime="2026-09-26T05:00:00\.000Z"/i)
  assert.match(html, /datetime="2026-09-24T03:00:00\.000Z"/i)
  scenario()
  const draftHtml = await render()
  assert.match(draftHtml, /Tin tức/)
  assert.match(draftHtml, /Bản nháp<\/span>/)
  assert.equal(draftHtml.includes('Xuất bản: '), false)
})

test('query failures reach the framework boundary rather than rendering raw diagnostics or fake success', async () => {
  for (const kind of ['count', 'recent', 'profile']) {
    const failure = new Error('PRIVATE Prisma database diagnostics')
    scenario('CREATOR', { queryError: { kind, error: failure } })
    await assert.rejects(render(), error => error === failure || !error.message.includes('PRIVATE'))
  }
})

test('creator dashboard remains a Server Component and removes the former Analyst invitation', async () => {
  const source = readFileSync(new URL(pageUrl), 'utf8')
  assert.equal(/^\s*['"]use client['"]/.test(source), false)
  scenario()
  const html = await render()
  assert.equal(html.includes('Creator/Analyst/Admin'), false)
})
