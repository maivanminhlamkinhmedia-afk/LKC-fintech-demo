import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { chromium, expect } from '@playwright/test'
import { PNG } from 'pngjs'

// The real MediaLibrary with synthetic actions and a loopback-only POST.
// This checks feedback behavior, not Server Action transport or a DB commit.
const require = createRequire(import.meta.url), root = process.cwd()
const output = path.join(root, '.next', 'cms009-media-upload-feedback-local')
await fs.mkdir(output, { recursive: true })
await fs.writeFile(path.join(output, 'loader.cjs'), `const ts=require('typescript');module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`)
await fs.writeFile(path.join(output, 'actions.mjs'), `
export const beginMediaUpload=async()=>{window.probe.begins++;return window.probe.begins===1
  ? {ok:false,error:{code:'MEDIA_BUSY',message:'Synthetic busy'}}
  : {ok:true,data:{operationId:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',expiresAt:'2099-01-01T00:00:00.000Z'}}};
export const deleteUnusedMedia=async()=>{throw Error('unexpected delete')};
export const searchMediaLibrary=async()=>window.initial;
export const updateMediaMetadata=async()=>{throw Error('unexpected metadata')};
`)
await fs.writeFile(path.join(output, 'link.mjs'), `import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}`)
await fs.writeFile(path.join(output, 'image.mjs'), `import React from 'react';export default function Image(props){return React.createElement('img',props)}`)
await fs.writeFile(path.join(output, 'entry.mjs'), `
import React from 'react';import {createRoot} from 'react-dom/client';
import {MediaLibrary} from '../../src/features/cms/components/MediaLibrary.tsx';
window.probe={begins:0,posts:0};
window.initial={q:'',page:1,totalPages:1,total:0,items:[]};
createRoot(document.getElementById('root')).render(React.createElement(MediaLibrary,{initial:window.initial}));
`)
const { webpack } = require('next/dist/compiled/webpack/webpack')
await new Promise((resolve, reject) => {
  const compiler = webpack({ mode: 'production', devtool: false, context: root, entry: path.join(output, 'entry.mjs'),
    output: { path: output, filename: 'browser.js' }, optimization: { minimize: false },
    resolve: { extensions: ['.tsx', '.ts', '.mjs', '.js'], alias: {
      '../media-actions': path.join(output, 'actions.mjs'), 'next/link': path.join(output, 'link.mjs'),
      'next/image': path.join(output, 'image.mjs'),
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
  await page.evaluate(() => {
    const original = window.fetch
    window.fetch = async (input, init) => {
      if (typeof input === 'string' && input.startsWith('/api/cms/media/uploads/')) {
        window.probe.posts++
        return new Response(JSON.stringify({ ok: true, data: { id: 'synthetic' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return original(input, init)
    }
  })
  const image = PNG.sync.write({ width: 1, height: 1, data: Buffer.from([1, 2, 3, 255]) })
  await page.getByLabel('Tệp PNG/JPEG').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: image })
  await page.getByLabel('Văn bản thay thế').fill('Synthetic image')
  await page.getByRole('button', { name: 'Tải ảnh lên', exact: true }).click()
  await expect(page.locator('[data-error-code="MEDIA_BUSY"]')).toBeVisible()
  assert.deepEqual(await page.evaluate(() => [window.probe.begins, window.probe.posts]), [1, 0])
  await expect(page.getByLabel('Tên tệp')).toHaveValue('synthetic.png')
  await page.getByRole('button', { name: 'Tải ảnh lên', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Ảnh đã được lưu.' })).toBeVisible()
  assert.deepEqual(await page.evaluate(() => [window.probe.begins, window.probe.posts]), [2, 1])
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ result: 'PASS', component: 'MediaLibrary', syntheticBusyPreservesFile: true,
    busyHasNoPost: true, syntheticPostShowsSuccess: true, node: process.version, chromium: browser.version() }))
  await context.close()
} finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)) }
