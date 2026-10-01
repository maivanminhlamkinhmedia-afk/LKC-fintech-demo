import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { chromium, expect } from '@playwright/test'

// Real ArticleCoverPanel, synthetic committed snapshot and actions, loopback only.
const require = createRequire(import.meta.url), root = process.cwd()
const output = path.join(root, '.next', 'cms009-cover-reload-local')
await fs.mkdir(output, { recursive: true })
await fs.writeFile(path.join(output, 'loader.cjs'), `const ts=require('typescript');module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`)
await fs.writeFile(path.join(output, 'actions.mjs'), `export async function saveArticleCover(){throw Error('unexpected save')}\nexport async function searchMediaLibrary(){throw Error('unexpected search')}`)
await fs.writeFile(path.join(output, 'link.mjs'), `import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}`)
await fs.writeFile(path.join(output, 'image.mjs'), `import React from 'react';export default function Image(props){return React.createElement('img',props)}`)
await fs.writeFile(path.join(output, 'entry.mjs'), `
import React from 'react';import {createRoot} from 'react-dom/client';
import {ArticleCoverPanel} from '../../src/features/cms/components/ArticleCoverPanel.tsx';
const cover={id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',originalFilename:'committed-cover.png',mimeType:'image/png',sizeBytes:70,
  width:1,height:1,altText:'Synthetic',caption:null,updatedAt:'2026-10-01T00:00:00.000Z',createdAt:'2026-10-01T00:00:00.000Z',
  contentUrl:'/synthetic.png',managed:true,uploadedByMe:true};
const initial={id:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',title:'Synthetic draft',status:'DRAFT',updatedAt:'2026-10-01T00:00:00.001Z',
  cover,canMutate:true,readOnlyReason:null};
createRoot(document.getElementById('root')).render(React.createElement(ArticleCoverPanel,{initial}));
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
  const current = page.getByLabel('Giữ ảnh bìa hiện tại (committed-cover.png)')
  const none = page.getByLabel('Không dùng ảnh bìa')
  await expect(current).toBeChecked()
  await expect(none).not.toBeChecked()
  await expect(page.getByText('committed-cover.png', { exact: true }).first()).toBeVisible()
  assert.equal(await page.locator('input[name="cover"][data-media-id="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]').count(), 0,
    'the pre-fix post-reload locator is absent, not unchecked')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ result: 'PASS', component: 'ArticleCoverPanel', currentCoverChecked: true,
    noCoverUnchecked: true, oldLocatorAbsent: true, node: process.version, chromium: browser.version() }))
  await context.close()
} finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)) }
