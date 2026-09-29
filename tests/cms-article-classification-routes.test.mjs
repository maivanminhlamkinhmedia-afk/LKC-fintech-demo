import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { APP_ROLES, hasPermission } from '../src/lib/roles.ts'

const routeUrl = new URL('../src/app/creator/articles/[id]/classification/page.tsx', import.meta.url).href
const bridge = Symbol.for('cms-classification-route-adapter')
let current
const denied = Error('Guard redirect'), missing = Error('notFound')
const adapter = {
  async requirePermission(permission) {
    current.calls.push(['auth', permission])
    if (!current.user || !hasPermission(current.user.role, permission)) throw denied
    return { user: current.user }
  },
  async getArticleClassification(actor, id) { current.calls.push(['query', actor.id, id]); return current.result },
  notFound() { throw missing },
  ArticleClassificationPanel({ initial }) { current.calls.push(['panel', initial]); return createElement('div', { 'data-classification': initial.id }, initial.title) },
  PortalShell({ user, children }) { current.calls.push(['shell', user]); return createElement('main', null, children) },
  Link({ children, ...props }) { return createElement('a', props, children) },
}
globalThis[bridge] = adapter
const mod = exports => `data:text/javascript,${encodeURIComponent(`const a = globalThis[Symbol.for('cms-classification-route-adapter')]; ${exports}`)}`
const replacements = new Map([
  ['@/lib/authz', mod('export const requirePermission = a.requirePermission;')],
  ['@/features/cms/article-classification-query', mod('export const getArticleClassification = a.getArticleClassification;')],
  ['@/features/cms/components/ArticleClassificationPanel', mod('export const ArticleClassificationPanel = a.ArticleClassificationPanel;')],
  ['@/components/portal/PortalShell', mod('export const PortalShell = a.PortalShell;')],
  ['next/link', mod('export default a.Link;')], ['next/navigation', mod('export const notFound = a.notFound;')],
])
const hook = registerHooks({
  resolve(specifier, context, next) { return next(replacements.get(specifier) ?? specifier, context) },
  load(url, context, next) {
    if (decodeURI(url) === decodeURI(routeUrl)) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText }
    return next(url, context)
  },
})
let Page
try { ({ default: Page } = await import(routeUrl)) } finally { hook.deregister(); delete globalThis[bridge] }
const snapshot = { id: 'article-a', title: 'Bài trong scope', status: 'DRAFT', updatedAt: '2026-09-27T02:00:00.000Z', canMutate: true, readOnlyReason: null, category: null, topics: [], tags: [], instruments: [], warnings: [] }
function scenario(role = 'CREATOR', result = { ok: true, data: snapshot }) {
  current = { user: role ? { id: 'actor-a', name: 'Tác giả', role, email: 'PRIVATE_EMAIL' } : null, result, calls: [] }
}
const render = async () => renderToStaticMarkup(await Page({ params: { then(resolve) { current.calls.push(['params']); resolve({ id: 'article-a' }) } } }))

test('TAX-01/13: classification route enforces CMS guard before params/query for anonymous and complete denied role matrix', async () => {
  for (const role of [null, ...APP_ROLES.filter(value => !['CREATOR', 'ADMIN', 'SUPER_ADMIN'].includes(value))]) {
    scenario(role); await assert.rejects(render(), error => error === denied)
    assert.deepEqual(current.calls, [['auth', 'cms:access']])
  }
})
test('TAX-01/13/14: allowed roles pass actor and awaited id to scoped domain read, without exposing session fields', async () => {
  for (const role of ['CREATOR', 'ADMIN', 'SUPER_ADMIN']) {
    scenario(role); const html = await render()
    assert.deepEqual(current.calls.slice(0, 3), [['auth', 'cms:access'], ['params'], ['query', 'actor-a', 'article-a']])
    assert.deepEqual(current.calls.find(([kind]) => kind === 'shell'), ['shell', { name: 'Tác giả', role }])
    assert.equal(html.includes('PRIVATE'), false); assert.match(html, /data-classification="article-a"/)
  }
})
test('TAX-01/13: NOT_FOUND route never renders classification panel or private article metadata', async () => {
  scenario('CREATOR', { ok: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy.' } })
  await assert.rejects(render(), error => error === missing)
  assert.equal(current.calls.some(([kind]) => kind === 'panel'), false)
})
test('TAX-19/29: safe denied/internal query results render error and list recovery link, no classification panel', async () => {
  for (const code of ['FORBIDDEN', 'INTERNAL_ERROR']) {
    scenario('CREATOR', { ok: false, error: { code, message: 'Không thể mở nguồn.' } })
    const html = await render()
    assert.match(html, new RegExp(`data-error-code="${code}"`)); assert.match(html, /href="\/creator\/articles"/)
    assert.equal(current.calls.some(([kind]) => kind === 'panel'), false)
  }
})
