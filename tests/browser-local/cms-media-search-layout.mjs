import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { chromium, expect } from '@playwright/test'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

// Real CMS library, portal shell, floating contact and freshly compiled app CSS.
// Only authentication, navigation and the Server Action are synthetic.
const require = createRequire(import.meta.url), root = process.cwd()
const output = path.join(root, '.next', 'cms009-media-layout-local')
await fs.mkdir(output, { recursive: true })
await fs.writeFile(path.join(output, 'loader.cjs'), `const ts=require('typescript');module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`)
await fs.writeFile(path.join(output, 'actions.mjs'), `
export const beginMediaUpload=async()=>{throw Error('unexpected upload')};
export const deleteUnusedMedia=async()=>{throw Error('unexpected delete')};
export const updateMediaMetadata=async()=>{throw Error('unexpected metadata')};
export const searchMediaLibrary=async input=>{window.probe.searches++;return {ok:true,data:{...window.initial,q:input.q}}};
`)
await fs.writeFile(path.join(output, 'link.mjs'), `import React from 'react';export default function Link({children,prefetch,...props}){return React.createElement('a',props,children)}`)
await fs.writeFile(path.join(output, 'image.mjs'), `import React from 'react';export default function Image(props){return React.createElement('img',props)}`)
await fs.writeFile(path.join(output, 'navigation.mjs'), `export const usePathname=()=>'/creator/media'`)
await fs.writeFile(path.join(output, 'auth.mjs'), `export const signOut=async()=>{throw Error('unexpected signout')}`)
await fs.writeFile(path.join(output, 'entry.mjs'), `
import React from 'react';import {createRoot} from 'react-dom/client';
import {MediaLibrary} from '../../src/features/cms/components/MediaLibrary.tsx';
import {PortalShell} from '../../src/components/portal/PortalShell.tsx';
import {FloatingContact} from '../../src/features/landing/components/FloatingContact.tsx';
window.probe={searches:0};window.initial={q:'',page:1,totalPages:1,total:0,items:[]};
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,
  React.createElement(React.Fragment,null,
    React.createElement(PortalShell,{user:{name:'Synthetic',role:'CREATOR'}},React.createElement(MediaLibrary,{initial:window.initial})),
    React.createElement(FloatingContact))));
`)
const { webpack } = require('next/dist/compiled/webpack/webpack')
await new Promise((resolve, reject) => {
  const compiler = webpack({ mode: 'production', devtool: false, context: root, entry: path.join(output, 'entry.mjs'),
    output: { path: output, filename: 'browser.js' }, optimization: { minimize: false },
    resolve: { extensions: ['.tsx', '.ts', '.mjs', '.js'], alias: {
      '../media-actions': path.join(output, 'actions.mjs'),
      'next/link': path.join(output, 'link.mjs'), 'next/image': path.join(output, 'image.mjs'),
      'next/navigation': path.join(output, 'navigation.mjs'), 'next-auth/react': path.join(output, 'auth.mjs'),
      '@': path.join(root, 'src'),
    } }, module: { rules: [{ test: /\.tsx?$/, use: path.join(output, 'loader.cjs') }] } })
  compiler.run((error, stats) => compiler.close(closeError => error || closeError || stats.hasErrors()
    ? reject(error || closeError || new Error(stats.toString({ all: false, errors: true }))) : resolve()))
})
const css = (await postcss([tailwind()]).process(await fs.readFile(path.join(root, 'src/app/globals.css'), 'utf8'),
  { from: path.join(root, 'src/app/globals.css') })).css
const bundle = await fs.readFile(path.join(output, 'browser.js'))
const server = http.createServer((request, response) => {
  const style = request.url === '/style.css', script = request.url === '/browser.js'
  response.writeHead(200, { 'Content-Type': style ? 'text/css' : script ? 'text/javascript' : 'text/html; charset=utf-8' })
  response.end(style ? css : script ? bundle : '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/browser.js"></script></body></html>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({ headless: true })
  const origin = `http://127.0.0.1:${server.address().port}`
  const context = await browser.newContext({ baseURL: origin, serviceWorkers: 'block',
    ...(process.argv[2] === 'project-viewport' ? { viewport: { width: 1280, height: 800 } } : {}) })
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  const page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.name))
  await page.goto('/creator/media')
  await expect(page.getByRole('heading', { name: 'Thư viện ảnh' })).toBeVisible()
  const input = page.getByLabel('Tìm theo tên, alt hoặc chú thích')
  await input.fill('synthetic.png')
  const button = page.getByRole('button', { name: 'Tìm kiếm' })
  const toggle = page.getByRole('button', { name: 'Mở liên hệ' })
  // Recreate the scrolled but still visible search row; this is a controlled
  // scroll condition, not a claim that staging scrolled by the same amount.
  await page.evaluate(() => window.scrollBy(0, 32))
  const geometry = () => page.evaluate(() => {
    const search = document.querySelector('form[aria-label="Tìm ảnh"] button')
    const contact = document.querySelector('button[aria-label="Mở liên hệ"],button[aria-label="Đóng liên hệ"]')
    const panel = contact?.parentElement
    const b = search?.getBoundingClientRect(), p = panel?.getBoundingClientRect()
    const point = b && { x: b.left + b.width / 2, y: b.top + b.height / 2 }
    const hit = point && document.elementFromPoint(point.x, point.y)
    return { viewport: { width: innerWidth, height: innerHeight }, scrollY,
      button: b && { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) },
      panel: p && { x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height), pointerEvents: getComputedStyle(panel).pointerEvents },
      centerInViewport: !!point && point.x >= 0 && point.x < innerWidth && point.y >= 0 && point.y < innerHeight,
      hit: hit ? hit.tagName.toLowerCase() : null, hitIsButton: !!hit && (hit === search || search?.contains(hit)),
      hitInContact: !!hit && !!panel && panel.contains(hit),
    }
  })
  const before = await geometry()
  let nativeClickPassed = true
  try { await button.click({ timeout: 2500 }) } catch { nativeClickPassed = false }
  const after = await geometry()
  let controlledClickPassed = null
  if (!nativeClickPassed) {
    await page.evaluate(() => {
      const toggle = document.querySelector('button[aria-label="Mở liên hệ"]')
      toggle.parentElement.style.pointerEvents = 'none'
      toggle.style.pointerEvents = 'auto'
    })
    await button.click({ timeout: 2500 })
    controlledClickPassed = true
  }
  await expect.poll(() => page.evaluate(() => window.probe.searches)).toBe(1)
  console.log(JSON.stringify({ phase: 'search', node: process.version, chromium: browser.version(),
    nativeClickPassed, controlledClickPassed, before, after, searches: 1 }))
  await toggle.click()
  await expect(page.getByRole('button', { name: 'Đóng liên hệ' })).toBeVisible()
  const facebook = page.getByRole('link', { name: 'Liên hệ qua Facebook' })
  assert.equal(await facebook.evaluate(anchor => {
    const rect = anchor.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return hit === anchor || anchor.contains(hit)
  }), true, 'visible contact link must remain hit-testable')
  const zalo = page.getByRole('button', { name: 'Liên hệ qua Zalo' })
  await zalo.hover()
  await expect(zalo).toHaveAttribute('aria-expanded', 'true')
  const group = page.getByRole('link', { name: 'Chứng khoán cơ sở' })
  const groupHit = () => group.evaluate(anchor => {
    const rect = anchor.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return hit === anchor || anchor.contains(hit)
  })
  await expect.poll(groupHit).toBe(true)
  await zalo.click()
  await expect(zalo).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('button', { name: 'Đóng liên hệ' }).click()
  await expect(toggle).toBeVisible()
  const contactOpenClosePassed = true
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ phase: 'widget', contactOpenClosePassed }))
  await context.close()
  assert.equal(nativeClickPassed, true, 'native search click must work with the real floating widget')
} finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)) }
