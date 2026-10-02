import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { chromium, expect } from '@playwright/test'
import { observeMediaSearch } from '../../scripts/cms-e2e/media-search-observation.ts'

// Real MediaLibrary, empty scoped library, synthetic Server Action and loopback Chromium.
const require = createRequire(import.meta.url), root = process.cwd()
const output = path.join(root, '.next', 'cms009-media-search-local')
await fs.mkdir(output, { recursive: true })
await fs.writeFile(path.join(output, 'loader.cjs'), `const ts=require('typescript');module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`)
await fs.writeFile(path.join(output, 'actions.mjs'), `
export const beginMediaUpload=async()=>{throw Error('unexpected upload')};
export const deleteUnusedMedia=async()=>{throw Error('unexpected delete')};
export const updateMediaMetadata=async()=>{throw Error('unexpected metadata')};
export const searchMediaLibrary=input=>new Promise(resolve=>{window.probe.requests.push({input,resolve})});
`)
await fs.writeFile(path.join(output, 'link.mjs'), `import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}`)
await fs.writeFile(path.join(output, 'image.mjs'), `import React from 'react';export default function Image(props){return React.createElement('img',props)}`)
await fs.writeFile(path.join(output, 'entry.mjs'), `
import React from 'react';import {createRoot} from 'react-dom/client';
import {MediaLibrary} from '../../src/features/cms/components/MediaLibrary.tsx';
window.probe={requests:[],submits:0,clicks:0};
window.initial={q:'',page:1,totalPages:1,total:0,items:[]};
const root=createRoot(document.getElementById('root'));
root.render(React.createElement(React.StrictMode,null,React.createElement(MediaLibrary,{initial:window.initial})));
document.addEventListener('submit',()=>{window.probe.submits++},true);
document.addEventListener('click',event=>{if(event.target?.textContent==='Tìm kiếm')window.probe.clicks++},true);
`)
const { webpack } = require('next/dist/compiled/webpack/webpack')
await new Promise((resolve, reject) => {
  const compiler = webpack({ mode: 'production', devtool: false, context: root, entry: path.join(output, 'entry.mjs'),
    output: { path: output, filename: 'browser.js' }, optimization: { minimize: false },
    resolve: { extensions: ['.tsx', '.ts', '.mjs', '.js'], alias: {
      '../media-actions': path.join(output, 'actions.mjs'), 'next/link': path.join(output, 'link.mjs'), 'next/image': path.join(output, 'image.mjs'),
    } }, module: { rules: [{ test: /\.tsx?$/, use: path.join(output, 'loader.cjs') }] } })
  compiler.run((error, stats) => compiler.close(closeError => error || closeError || stats.hasErrors()
    ? reject(error || closeError || new Error(stats.toString({ all: false, errors: true }))) : resolve()))
})
const bundle = await fs.readFile(path.join(output, 'browser.js'))
const server = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': request.url === '/browser.js' ? 'text/javascript' : 'text/html; charset=utf-8' })
  response.end(request.url === '/browser.js' ? bundle : '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/browser.js"></script>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 800 } })
  const origin = `http://127.0.0.1:${server.address().port}`
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  const page = await context.newPage(), errors = [], navigations = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(1) })
  await page.goto(`${origin}/creator/media`)
  await expect(page.getByRole('heading', { name: 'Thư viện ảnh' })).toBeVisible()
  const initialNavigations = navigations.length
  await page.getByLabel('Tìm theo tên, alt hoặc chú thích').fill('synthetic.png')
  const button = page.getByRole('button', { name: 'Tìm kiếm' })
  assert.equal(await button.isEnabled(), true)
  const signals = [], observer = await observeMediaSearch(page, signal => signals.push(signal))
  let clickSettled = false
  const started = performance.now()
  const click = button.click().then(() => { clickSettled = true })
  await expect.poll(() => page.evaluate(() => window.probe.requests.length)).toBe(1)
  const dispatchedMs = Math.round(performance.now() - started)
  const beforeResponse = { clickSettled, ...await page.evaluate(() => ({
    submits: window.probe.submits, clicks: window.probe.clicks,
    disabled: document.querySelector('form[aria-label="Tìm ảnh"] button')?.disabled,
  })) }
  await page.evaluate(() => window.probe.requests[0].resolve({ ok: true,
    data: { ...window.initial, q: 'synthetic.png' } }))
  await click
  await expect(button).toBeEnabled()
  await expect(page.getByRole('status')).toHaveText('0 ảnh trong phạm vi của bạn.')
  await expect.poll(() => observer.saw('BUTTON_REENABLED')).toBe(true)
  for (const signal of ['BUTTON_READY', 'CLICK_EVENT', 'SUBMIT_EVENT', 'BUTTON_DISABLED',
    'BUTTON_REENABLED']) assert.equal(observer.saw(signal), true, signal)
  assert.equal(observer.saw('NAVIGATION_REQUEST'), false)
  assert.equal(await page.evaluate(() => window.probe.requests[0].input.q), 'synthetic.png')
  assert.equal(navigations.length, initialNavigations)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ result: 'PASS', component: 'MediaLibrary', initialEmpty: true,
    clickDispatchedMs: dispatchedMs, beforeResponse, navigationCount: navigations.length - initialNavigations,
    signals: signals.map(entry => entry.signal),
    node: process.version, chromium: browser.version() }))
  observer.dispose()
  await context.close()
} finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)) }
