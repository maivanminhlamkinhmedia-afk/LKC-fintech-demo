import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'
import { chromium, expect } from '@playwright/test'

// Synthetic loopback: actual component/controller and actual choose() helper.
// HTTP options below are a synthetic adapter, NOT Next Flight, auth, DB or
// staging latency evidence. No CMS app/guarded suite is started or imported.
const require = createRequire(import.meta.url), ts = require('typescript'), root = process.cwd()
// Match the installed project's assertion budget. This standalone probe has
// no surrounding 60s Playwright test body; it cannot identify its exhaustion.
const assertionExpect = expect.configure({ timeout: 10_000 })
const output = path.join(root, '.next', 'cms008-search-timing-local')
const source = ts.createSourceFile('cms-taxonomy.spec.ts', await fs.readFile(path.join(root, 'tests/e2e/cms-taxonomy.spec.ts'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const functions = source.statements.filter(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'choose')
assert.equal(functions.length, 1)
const chooseSource = ts.transpileModule(functions[0].getText(source), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const labels = { category: 'Chuyên mục', topic: 'Chủ đề', tag: 'Thẻ', instrument: 'Công cụ tài chính' }
const kinds = Object.keys(labels), token = '2026-09-29T00:00:00.001Z'
const term = (kind, index) => ({ id: `${kind}-${index}`, kind, name: `Synthetic ${kind} ${index}`, isActive: kind === 'tag' ? null : true,
  slug: kind === 'instrument' ? null : `synthetic-${kind}-${index}`, canonicalKey: kind === 'instrument' ? `SYN:${index}` : null, symbol: kind === 'instrument' ? `S${index}` : null })
const keyOf = item => item.slug ?? item.canonicalKey
const initial = { id: 'synthetic-article', title: 'Synthetic classification', status: 'DRAFT', updatedAt: token, canMutate: true,
  readOnlyReason: null, warnings: [], category: term('category', 1), topics: [term('topic', 1)], tags: [term('tag', 1)],
  instruments: [term('instrument', 1), term('instrument', 7)].map(item => ({ ...item, isPrimary: false })) }
await fs.mkdir(output, { recursive: true })
await fs.writeFile(path.join(output, 'loader.cjs'), `const ts=require('typescript');module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;};`)
await fs.writeFile(path.join(output, 'link.mjs'), `import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children);}`)
await fs.writeFile(path.join(output, 'actions.mjs'), `
let serial=0; let previous=Promise.resolve();
export async function updateArticleClassification(){throw Error('Unexpected synthetic write');}
export function searchArticleClassificationOptions(_articleId,kind,input){
  const sequence=++serial;
  const execute=async()=>{const response=await fetch('/options',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,q:input.q,page:input.page,sequence})});return response.json();};
  // This mode is an explicitly modeled FIFO adapter, not a claim to execute
  // Next's action queue; other modes permit real HTTP out-of-order completion.
  if(new URL(location.href).searchParams.get('mode')==='serialized'){
    const response=previous.then(execute);previous=response.then(()=>{},()=>{});return response;
  }
  return execute();
}
`)
await fs.writeFile(path.join(output, 'entry.mjs'), `import React from 'react';import {createRoot} from 'react-dom/client';import {ArticleClassificationPanel} from '../../src/features/cms/components/ArticleClassificationPanel.tsx';createRoot(document.getElementById('root')).render(React.createElement(ArticleClassificationPanel,{initial:${JSON.stringify(initial)}}));`)
const { webpack } = require('next/dist/compiled/webpack/webpack')
await new Promise((resolve, reject) => {
  const compiler = webpack({ mode: 'production', context: root, devtool: false, entry: path.join(output, 'entry.mjs'),
    output: { path: output, filename: 'browser.js' }, optimization: { minimize: false },
    resolve: { extensions: ['.tsx', '.ts', '.mjs', '.js'], alias: { '../article-classification-actions': path.join(output, 'actions.mjs'), '../article-classification-options': path.join(output, 'actions.mjs'), 'next/link': path.join(output, 'link.mjs') } },
    module: { rules: [{ test: /\.tsx?$/, use: path.join(output, 'loader.cjs') }] },
  })
  compiler.run((error, stats) => compiler.close(closeError => { if (error || closeError || stats.hasErrors()) reject(error || closeError || new Error(stats.toString({ all: false, errors: true }))); else resolve() }))
})
const bundle = await fs.readFile(path.join(output, 'browser.js'))
let run, browser
const tasks = new Set()
const log = event => { const entry = { ...event, elapsedMs: Math.round((performance.now() - run.start) * 100) / 100 }; run.events.push(entry); return entry }
const server = http.createServer((request, response) => {
  if (request.url === '/options') {
    const task = (async () => {
      let body = ''; for await (const chunk of request) body += chunk
      const { kind, q, sequence } = JSON.parse(body)
      assert.ok(kinds.includes(kind)); assert.equal(typeof q, 'string')
      const targeted = q !== '', requested = log({ stage: 'search-request', kind, queryType: targeted ? 'targeted' : 'blank', sequence })
      const delay = run.mode === 'delayed' ? targeted ? 450 : 50 : run.mode === 'reordered' || run.mode === 'serialized' ? targeted ? 30 : 500 : 0
      if (delay) await new Promise(resolve => setTimeout(resolve, delay))
      const items = Array.from({ length: 27 }, (_, index) => term(kind, index + 1)).filter(item => !targeted || keyOf(item) === q).slice(0, 25)
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify({ ok: true, data: { kind, items, page: 1, totalPages: targeted ? 1 : 2, total: targeted ? 1 : 27 } }))
      log({ stage: 'search-response', kind, queryType: targeted ? 'targeted' : 'blank', sequence, syntheticDelayMs: delay, requestDurationMs: Math.round((performance.now() - run.start - requested.elapsedMs) * 100) / 100, itemCount: items.length })
    })()
    tasks.add(task); void task.finally(() => tasks.delete(task)); return
  }
  response.writeHead(200, { 'Content-Type': request.url === '/browser.js' ? 'text/javascript' : 'text/html; charset=utf-8' })
  response.end(request.url === '/browser.js' ? bundle : '<!doctype html><meta charset="utf-8"><title>Synthetic classification search</title><div id="root"></div><script src="/browser.js"></script>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
try {
  browser = await chromium.launch({ headless: true })
  console.log(JSON.stringify({ stage: 'runtime', node: process.version, chromium: browser.version(), playwright: require('playwright/package.json').version, next: require('next/package.json').version }))
  for (const clock of ['native', 'installed']) for (const mode of ['normal', 'delayed', 'reordered', 'serialized']) {
    run = { start: performance.now(), mode, clock, events: [] }
    const context = await browser.newContext({ serviceWorkers: 'block' })
    try {
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
      const page = await context.newPage(), errors = []
      page.on('pageerror', error => errors.push(error.message))
      if (clock === 'installed') await page.clock.install()
      await page.goto(`${origin}/?mode=${mode}`)
      await expect(page.getByRole('heading', { name: 'Phân loại bài viết', exact: true })).toBeVisible()
      for (const item of [term('topic', 1), term('tag', 1), term('instrument', 1)]) await page.locator(`[data-selected-kind="${item.kind}"][data-taxonomy-id="${item.id}"]`).getByRole('button', { name: /^Gỡ / }).click()
      let choosing = null
      const instrumentedExpect = locator => ({ async toBeVisible(...args) {
        const start = performance.now(); log({ stage: 'assertion-start', kind: choosing })
        try { await assertionExpect(locator).toBeVisible(...args); log({ stage: 'assertion-settle', kind: choosing, status: 'passed', assertionDurationMs: Math.round((performance.now() - start) * 100) / 100 }) }
        catch (error) { log({ stage: 'assertion-settle', kind: choosing, status: 'failed', assertionDurationMs: Math.round((performance.now() - start) * 100) / 100 }); throw error }
      } })
      const choose = new Function('labels', 'keyOf', 'expect', `${chooseSource};return choose;`)(labels, keyOf, instrumentedExpect)
      const replaceStart = performance.now()
      for (const item of [term('category', 7), term('topic', 7), term('tag', 7), term('instrument', 8)]) {
        choosing = item.kind; const start = performance.now(); log({ stage: 'choose-start', kind: item.kind })
        await choose(page, item)
        log({ stage: 'choose-settle', kind: item.kind, status: 'passed', chooseDurationMs: Math.round((performance.now() - start) * 100) / 100 })
        await expect(page.locator(`[data-selected-kind="${item.kind}"][data-taxonomy-id="${item.id}"]`)).toBeVisible()
      }
      const replacementDurationMs = Math.round((performance.now() - replaceStart) * 100) / 100
      // Join every synthetic delayed response; late blank responses must not
      // replace the latest targeted options or the selected replacement set.
      while (tasks.size) await Promise.all([...tasks])
      await expect(page.locator('fieldset[data-classification-kind="instrument"] input[data-taxonomy-id]')).toHaveCount(1)
      await expect(page.locator('[data-selected-kind]')).toHaveCount(5)
      const requests = run.events.filter(event => event.stage === 'search-request'), responses = run.events.filter(event => event.stage === 'search-response')
      assert.equal(requests.length, 9); assert.equal(responses.length, 9)
      assert.deepEqual(requests.map(event => [event.kind, event.queryType]), [['category', 'blank'], ...kinds.flatMap(kind => [[kind, 'blank'], [kind, 'targeted']])])
      assert.deepEqual(errors, [])
      console.log(JSON.stringify({ stage: 'case', clock, mode, replacementDurationMs, requests: requests.length, responseOrder: responses.map(event => event.sequence),
        assertions: run.events.filter(event => ['assertion-start', 'assertion-settle', 'choose-start', 'choose-settle'].includes(event.stage)),
        searchEvents: run.events.filter(event => ['search-request', 'search-response'].includes(event.stage)), result: 'PASS' }))
    } finally { while (tasks.size) await Promise.all([...tasks]); await context.close() }
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
