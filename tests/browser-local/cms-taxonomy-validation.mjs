import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'
import { chromium, expect } from '@playwright/test'

// Synthetic loopback only: real catalog component/controller/validator and
// installed Next announcer; server actions have an explicit in-memory adapter.
// Never start the CMS app or import its staging suite/fixtures/credentials.
const require = createRequire(import.meta.url), root = process.cwd()
const ts = require('typescript')
// Execute the working-tree assertion fragment under review. The old broad
// locator is exercised separately below as the baseline, without CMS hooks.
const spec = ts.createSourceFile('cms-taxonomy.spec.ts', await fs.readFile(path.join(root, 'tests/e2e/cms-taxonomy.spec.ts'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const fragments = []
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(spec) === 'test.step' && ts.isStringLiteral(node.arguments[0])
    && node.arguments[0].text === 'TAX_ACCESSIBLE_TEXT') {
    const statements = [...node.arguments[1].body.statements], start = statements.findIndex(statement => /^const validationAlert\b/.test(statement.getText(spec)))
    const end = statements.findIndex((statement, index) => index > start && statement.getText(spec).includes('.fill(input.name)'))
    assert.ok(start >= 0 && end > start)
    fragments.push(statements.slice(start, end).map(statement => statement.getText(spec)).join('\n'))
  }
  ts.forEachChild(node, visit)
}
visit(spec); assert.equal(fragments.length, 1)
const runPatchedAssertions = new Function('page', 'expect', 'error', `return (async()=>{${fragments[0]}})();`)
const output = path.join(root, '.next', 'cms008-taxonomy-validation-local')
await fs.mkdir(output, { recursive: true })
await fs.writeFile(path.join(output, 'loader.cjs'), `
const ts = require('typescript');
module.exports = function(source) { return ts.transpileModule(source, { fileName: this.resourcePath,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX }
}).outputText; };
`)
await fs.writeFile(path.join(output, 'actions.mjs'), `
export async function createTaxonomy(kind, input) {
  window.probe.actions++;
  const item = { id: 'synthetic-topic', kind, name: input.name, slug: input.slug, description: input.description,
    isActive: input.isActive, symbol: null, canonicalKey: null, sortOrder: null, instrumentType: null,
    exchange: null, countryCode: null, currency: null, createdAt: '2026-09-29T00:00:00.001Z', updatedAt: '2026-09-29T00:00:00.001Z' };
  return { ok: true, data: { kind, item, deletedId: null } };
}
export async function updateTaxonomy() { throw Error('Unexpected synthetic update'); }
export async function deleteTaxonomy() { throw Error('Unexpected synthetic delete'); }
export async function searchTaxonomy() { return { ok: true, data: window.catalogInitial }; }
`)
await fs.writeFile(path.join(output, 'link.mjs'), `import React from 'react'; export default function Link({children,...props}) {return React.createElement('a',props,children);}`)
await fs.writeFile(path.join(output, 'entry.mjs'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { TaxonomyCatalog } from '../../src/features/cms/components/TaxonomyCatalog.tsx';
import { AppRouterAnnouncer } from 'next/dist/client/components/app-router-announcer.js';
window.probe = { submits: 0, invalid: 0, actions: 0 };
window.catalogInitial = { kind: 'topic', q: '', active: 'all', items: [], page: 1, totalPages: 1, total: 0 };
document.addEventListener('submit', event => { if (event.target.getAttribute('aria-label') === 'Thêm danh mục') window.probe.submits++; }, true);
document.addEventListener('invalid', () => { window.probe.invalid++; }, true);
const announcer = new URL(location.href).searchParams.get('announcer') === 'yes';
createRoot(document.getElementById('root')).render(React.createElement(React.Fragment, null,
  React.createElement(TaxonomyCatalog, { initial: window.catalogInitial }),
  announcer ? React.createElement(AppRouterAnnouncer, { tree: ['synthetic-catalog'] }) : null));
`)
const { webpack } = require('next/dist/compiled/webpack/webpack')
await new Promise((resolve, reject) => {
  const compiler = webpack({ mode: 'production', devtool: false, context: root,
    entry: path.join(output, 'entry.mjs'), output: { path: output, filename: 'browser.js' }, optimization: { minimize: false },
    resolve: { extensions: ['.tsx', '.ts', '.mjs', '.js'], alias: { '../taxonomy-actions': path.join(output, 'actions.mjs'), 'next/link': path.join(output, 'link.mjs') } },
    module: { rules: [{ test: /\.tsx?$/, use: path.join(output, 'loader.cjs') }] },
  })
  compiler.run((error, stats) => compiler.close(closeError => {
    if (error || closeError || stats.hasErrors()) reject(error || closeError || new Error(stats.toString({ all: false, errors: true })))
    else resolve()
  }))
})
const bundle = await fs.readFile(path.join(output, 'browser.js'))
const server = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': request.url === '/browser.js' ? 'text/javascript' : 'text/html; charset=utf-8' })
  response.end(request.url === '/browser.js' ? bundle : '<!doctype html><title>Synthetic taxonomy validation</title><meta charset="utf-8"><div id="root"></div><script src="/browser.js"></script>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
try {
  browser = await chromium.launch({ headless: true })
  console.log(JSON.stringify({ step: 'runtime', node: process.version, chromium: browser.version(), playwright: require('playwright/package.json').version, next: require('next/package.json').version }))
  for (const clock of ['native', 'installed']) for (const announcer of [false, true]) {
    const context = await browser.newContext({ serviceWorkers: 'block' })
    try {
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
      const page = await context.newPage(), errors = []
      page.on('pageerror', error => errors.push(error.message))
      if (clock === 'installed') await page.clock.install()
      await page.goto(`${origin}/?announcer=${announcer ? 'yes' : 'no'}`)
      await page.getByRole('button', { name: 'Thêm danh mục', exact: true }).click()
      const name = page.getByLabel('Tên', { exact: true }), save = page.getByRole('button', { name: 'Lưu danh mục', exact: true })
      await page.getByLabel('Slug', { exact: true }).fill('synthetic-topic')
      await page.getByLabel('Mô tả', { exact: true }).fill('<script>synthetic only</script>')
      await name.fill('')
      const emptyStart = performance.now(); await save.click()
      const empty = await page.evaluate(() => ({ ...window.probe, nativeValid: document.querySelector('#taxonomy-name').validity.valid, valueMissing: document.querySelector('#taxonomy-name').validity.valueMissing }))
      assert.deepEqual(empty, { submits: 0, invalid: 1, actions: 0, nativeValid: false, valueMissing: true })
      console.log(JSON.stringify({ step: 'empty-name-native-block', clock, announcer, durationMs: performance.now() - emptyStart, ...empty }))
      await name.fill('   ')
      assert.equal(await name.evaluate(element => element.validity.valid), true)
      const validationStart = performance.now(); await save.click()
      const domain = page.getByRole('alert').and(page.locator('[data-error-code="VALIDATION_ERROR"]'))
      await expect(domain).toBeVisible()
      const observations = await page.evaluate(() => ({ ...window.probe, nativeValid: document.querySelector('#taxonomy-name').validity.valid,
        fieldInvalid: document.querySelector('#taxonomy-name').getAttribute('aria-invalid'), fieldError: document.querySelector('#taxonomy-name-error').textContent,
        activeId: document.activeElement.id, routeAnnouncer: !!document.querySelector('next-route-announcer')?.shadowRoot?.querySelector('[role="alert"]') }))
      assert.equal(observations.submits, 1); assert.equal(observations.invalid, 1); assert.equal(observations.actions, 0)
      assert.equal(observations.fieldInvalid, 'true'); assert.equal(observations.activeId, 'taxonomy-name')
      const alertCount = await page.getByRole('alert').count()
      assert.equal(alertCount, announcer ? 2 : 1)
      let baselineFailure = null
      const baselineStart = performance.now()
      try { await expect(page.getByRole('alert')).toBeVisible() }
      catch (error) { baselineFailure = String(error.message).includes('strict mode violation') ? 'STRICT_MULTIPLE_ALERTS' : 'OTHER_ASSERTION_ERROR' }
      assert.equal(baselineFailure, announcer ? 'STRICT_MULTIPLE_ALERTS' : null)
      const scopedStart = performance.now()
      await runPatchedAssertions(page, expect, (targetPage, code) => targetPage.locator(`[data-error-code="${code}"]`))
      console.log(JSON.stringify({ step: 'whitespace-domain-validation', clock, announcer, validationDurationMs: baselineStart - validationStart,
        baselineDurationMs: scopedStart - baselineStart, scopedDurationMs: performance.now() - scopedStart, alertCount, baselineFailure, scoped: 'PASS', ...observations }))
      await name.fill('<img src=x onerror=window.PROBE_XSS=1> Tiếng Việt')
      await save.focus(); await page.keyboard.press('Enter')
      await expect(page.locator('[data-error-code="VALIDATION_ERROR"]')).toHaveCount(0)
      await expect(page.getByRole('status').filter({ hasText: /^Đã lưu danh mục\.$/ })).toBeVisible()
      assert.equal(await page.evaluate(() => window.probe.actions), 1)
      assert.equal(await page.evaluate(() => Object.hasOwn(window, 'PROBE_XSS')), false)
      assert.deepEqual(errors, [])
      console.log(JSON.stringify({ step: 'keyboard-recovery', clock, announcer, actions: 1, javascriptErrors: 0, syntheticActionOnly: true }))
    } finally { await context.close() }
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
