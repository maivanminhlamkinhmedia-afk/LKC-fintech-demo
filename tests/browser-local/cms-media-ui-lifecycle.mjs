import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { chromium, expect } from '@playwright/test'

// Real MediaLibrary React component, synthetic actions and loopback-only browser.
const require = createRequire(import.meta.url), root = process.cwd()
const output = path.join(root, '.next', 'cms009-media-ui-local')
await fs.mkdir(output, { recursive: true })
await fs.writeFile(path.join(output, 'loader.cjs'), `const ts=require('typescript');module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`)
await fs.writeFile(path.join(output, 'actions.mjs'), `
export const beginMediaUpload=async()=>{throw Error('unexpected upload')};
export const deleteUnusedMedia=async()=>{throw Error('unexpected delete')};
export const searchMediaLibrary=input=>new Promise(resolve=>window.probe.searches.push({input,resolve}));
export const updateMediaMetadata=(id,input)=>new Promise(resolve=>window.probe.saves.push({id,input,resolve}));
`)
await fs.writeFile(path.join(output, 'link.mjs'), `import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}`)
await fs.writeFile(path.join(output, 'image.mjs'), `import React from 'react';export default function Image(props){return React.createElement('img',props)}`)
await fs.writeFile(path.join(output, 'entry.mjs'), `
import React from 'react';import {createRoot} from 'react-dom/client';
import {MediaLibrary} from '../../src/features/cms/components/MediaLibrary.tsx';
window.probe={searches:[],saves:[]};
window.item={id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',managed:true,contentUrl:'/synthetic.png',filename:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png',
  originalFilename:'synthetic.png',altText:'Original',caption:null,mimeType:'image/png',sizeBytes:70,width:1,height:1,
  uploadedById:'fixture',createdAt:'2026-09-30T00:00:00.000Z',updatedAt:'2026-09-30T00:00:00.000Z'};
window.initial={q:'',page:1,totalPages:1,total:1,items:[window.item]};
const root=createRoot(document.getElementById('root'));
window.mount=()=>root.render(React.createElement(React.StrictMode,null,React.createElement(MediaLibrary,{initial:window.initial})));
window.unmount=()=>root.render(null);
window.mount();
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
const origin = `http://127.0.0.1:${server.address().port}`
let browser
try {
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ serviceWorkers: 'block' })
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  const page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin)
  const item = page.locator('li[data-media-id="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]')
  await item.getByRole('button', { name: 'Sửa metadata' }).click()
  const form = page.getByRole('form', { name: 'Sửa metadata ảnh' })
  await form.getByLabel('Văn bản thay thế').fill('Draft remains')
  await form.getByRole('button', { name: 'Lưu metadata' }).evaluate(button => { button.click(); button.click() })
  await expect.poll(() => page.evaluate(() => window.probe.saves.length)).toBe(1)
  await page.evaluate(() => window.probe.saves[0].resolve({ ok: true, data: { ...window.item, altText: 'Draft remains', updatedAt: '2026-09-30T00:00:00.001Z' } }))
  await expect.poll(() => page.evaluate(() => window.probe.searches.length)).toBe(1)
  await page.evaluate(() => window.probe.searches[0].resolve({ ok: true, data: { ...window.initial, items: [{ ...window.item, altText: 'Draft remains' }] } }))
  await expect(form.getByLabel('Văn bản thay thế')).toHaveValue('Draft remains')
  await page.getByLabel('Tìm theo tên, alt hoặc chú thích').fill('old')
  await page.getByRole('form', { name: 'Tìm ảnh' }).evaluate(form => form.requestSubmit())
  await expect.poll(() => page.evaluate(() => window.probe.searches.length)).toBe(2)
  await page.getByLabel('Tìm theo tên, alt hoặc chú thích').fill('new')
  await page.getByRole('form', { name: 'Tìm ảnh' }).evaluate(form => form.requestSubmit())
  await expect.poll(() => page.evaluate(() => window.probe.searches.length)).toBe(3)
  await page.evaluate(() => window.probe.searches[2].resolve({ ok: true, data: { ...window.initial, q: 'new', total: 0, items: [] } }))
  await expect(item).toHaveCount(0)
  await page.evaluate(() => window.probe.searches[1].resolve({ ok: true, data: { ...window.initial, q: 'old' } }))
  await expect(item).toHaveCount(0)
  await page.getByLabel('Tìm theo tên, alt hoặc chú thích').fill('unmounted')
  await page.getByRole('form', { name: 'Tìm ảnh' }).evaluate(form => form.requestSubmit())
  await expect.poll(() => page.evaluate(() => window.probe.searches.length)).toBe(4)
  await page.evaluate(() => window.unmount())
  await expect(page.getByRole('heading', { name: 'Thư viện ảnh' })).toHaveCount(0)
  await page.evaluate(() => window.mount())
  await expect(item).toBeVisible()
  await page.evaluate(() => window.probe.searches[3].resolve({ ok: true, data: { ...window.initial, q: 'unmounted', items: [] } }))
  await expect(item).toBeVisible()
  await item.getByRole('button', { name: 'Sửa metadata' }).click()
  await page.getByRole('form', { name: 'Sửa metadata ảnh' }).getByLabel('Văn bản thay thế').fill('Late ACK from old mount')
  await page.getByRole('form', { name: 'Sửa metadata ảnh' }).getByRole('button', { name: 'Lưu metadata' }).click()
  await expect.poll(() => page.evaluate(() => window.probe.saves.length)).toBe(2)
  await page.evaluate(() => window.unmount())
  await expect(page.getByRole('heading', { name: 'Thư viện ảnh' })).toHaveCount(0)
  await page.evaluate(() => window.mount())
  await expect(item.getByText('Original', { exact: true })).toBeVisible()
  await page.evaluate(() => window.probe.saves[1].resolve({ ok: true, data: { ...window.item, altText: 'Late ACK from old mount' } }))
  await expect(item.getByText('Original', { exact: true })).toBeVisible()
  assert.equal(await page.evaluate(() => window.probe.searches.length), 4, 'old save ACK cannot start a refresh')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ result: 'PASS', component: 'MediaLibrary', strictMode: true, singleFlightSaves: 1,
    invertedSearch: true, disposedSearchCannotMutateReattach: true, disposedSaveCannotRefreshReattach: true,
    node: process.version, chromium: browser.version() }))
  await context.close()
} finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)) }
