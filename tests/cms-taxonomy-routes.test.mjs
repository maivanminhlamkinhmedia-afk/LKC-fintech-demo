import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { APP_ROLES, hasPermission } from '../src/lib/roles.ts'

const route = new URL('../src/app/creator/taxonomy/page.tsx', import.meta.url).href, root = new URL('../src/', import.meta.url)
let current
const denied = new Error('Guard redirect')
const adapter = {
  async requirePermission(permission) { current.calls.push(['auth', permission]); if (!current.user || !hasPermission(current.user.role, permission)) throw denied; return { user: current.user } },
  async getTaxonomyCatalog(actor, kind, input) { current.calls.push(['query', actor.id, kind, input]); return current.result },
  TaxonomyCatalog({ initial }) { current.calls.push(['panel']); return createElement('div', { 'data-kind': initial.kind }, 'Danh mục') },
  PortalShell({ user, children }) { current.calls.push(['shell', user]); return createElement('main', null, children) },
  Link({ children, ...props }) { return createElement('a', props, children) },
}
globalThis[Symbol.for('taxonomy-route')] = adapter
const mod = code => `data:text/javascript,${encodeURIComponent(`const a=globalThis[Symbol.for('taxonomy-route')];${code}`)}`
const replacements = new Map([['@/lib/authz', mod('export const requirePermission=a.requirePermission;')], ['@/features/cms/taxonomy-query', mod('export const getTaxonomyCatalog=a.getTaxonomyCatalog;')], ['@/features/cms/components/TaxonomyCatalog', mod('export const TaxonomyCatalog=a.TaxonomyCatalog;')], ['@/components/portal/PortalShell', mod('export const PortalShell=a.PortalShell;')], ['next/link', mod('export default a.Link;')]])
const hook = registerHooks({ resolve(specifier, context, next) { if (replacements.has(specifier)) return next(replacements.get(specifier), context); if (specifier.startsWith('@/')) return next(new URL(`${specifier.slice(2)}.ts`, root).href, context); return next(specifier, context) },
  load(url, context, next) { if (url === route) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText }; return next(url, context) } })
let Page
try { ({ default: Page } = await import(route)) } finally { hook.deregister(); delete globalThis[Symbol.for('taxonomy-route')] }
const scenario = (role = 'ADMIN', result = { ok: true, data: { kind: 'tag' } }) => { current = { user: role ? { id: 'user-a', name: 'Quản trị', role, email: 'PRIVATE' } : null, calls: [], result } }
const render = async (params = {}) => renderToStaticMarkup(await Page({ searchParams: { then(resolve) { current.calls.push(['params']); resolve(params) } } }))
test('TAX-01: exact admin guard precedes parameter resolution/domain reads for all denied roles', async () => {
  for (const role of [null, ...APP_ROLES.filter(role => !['ADMIN', 'SUPER_ADMIN'].includes(role))]) { scenario(role); await assert.rejects(render(), error => error === denied); assert.deepEqual(current.calls, [['auth', 'cms:admin']]) }
})
test('TAX-01/09: allowed routes await params and pass bounded normalized search; shell omits session secrets', async () => {
  for (const role of ['ADMIN', 'SUPER_ADMIN']) {
    scenario(role); const html = await render({ kind: 'instrument', q: 'VN', page: '2', active: 'active' })
    assert.deepEqual(current.calls.slice(0, 3), [['auth', 'cms:admin'], ['params'], ['query', 'user-a', 'instrument', { q: 'VN', page: 2, active: 'active' }]])
    assert.deepEqual(current.calls.find(call => call[0] === 'shell'), ['shell', { name: 'Quản trị', role }]); assert.equal(html.includes('PRIVATE'), false)
  }
  for (const page of ['-1', '0', '100001', 'Infinity', '2x', ['2']]) { scenario(); await render({ kind: '__proto__', page }); assert.deepEqual(current.calls[2].slice(2), ['category', { q: '', page: 1, active: 'all' }]) }
})
test('TAX-20: fresh query denial renders safe recovery and no catalog metadata', async () => {
  scenario('ADMIN', { ok: false, error: { code: 'FORBIDDEN', message: 'Không còn quyền.' } }); const html = await render()
  assert.match(html, /data-error-code="FORBIDDEN"/); assert.match(html, /href="\/creator"/); assert.equal(current.calls.some(call => call[0] === 'panel'), false)
})
