import assert from 'node:assert/strict'
import http from 'node:http'
import { chromium } from 'playwright'
import { holdTaxonomyResponses, observeTaxonomyActions } from '../e2e/cms-taxonomy-support.ts'

// Run under the filtered Node 22 wrapper. Real installed helper + Chromium,
// synthetic loopback HTML/POST/compiled metadata only; no app, auth or DB.
const updateId = '40' + 'c'.repeat(40), readId = '40' + 'd'.repeat(40)
const script = `//(0,r.createServerReference)("${updateId}",r.callServer,void 0,r.findSourceMapURL,"updateArticleClassification")\n//(0,r.createServerReference)("${readId}",r.callServer,void 0,r.findSourceMapURL,"searchArticleClassificationOptions")\ndocument.querySelector('#save').onclick = async () => {document.querySelector('#ack').textContent='pending'; const r=await fetch(location.pathname,{method:'POST',headers:{'next-action':'${updateId}'}}); document.querySelector('#ack').textContent=await r.text()}; fetch(location.pathname,{method:'POST',headers:{'next-action':'${readId}'}});`
let writes = 0
const server = http.createServer((request, response) => {
  if (request.method === 'POST') { response.writeHead(200, { 'Content-Type': 'text/plain' }); response.end(request.headers['next-action'] === updateId ? String(++writes) : 'read'); return }
  if (request.url.endsWith('.js')) { response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=3600' }); response.end(script); return }
  response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>Synthetic barrier</title><button id="save">Save</button><output id="ack"></output><script src="/_next/static/synthetic.js"></script>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ serviceWorkers: 'block' })
  await context.route('**/*', route => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') throw new Error('External request prohibited')
    return route.continue()
  })
  const page = await context.newPage(), observer = observeTaxonomyActions(page)
  await page.clock.install()
  const url = `http://127.0.0.1:${server.address().port}/creator/articles/synthetic/classification`
  await page.goto(url)
  const barriers = []
  try {
    for (let index = 0; index < 6; index++) {
      const start = performance.now()
      if (index) await page.reload()
      console.log(JSON.stringify({ stage: 'observer-ready-start', index }))
      await observer.ready('updateArticleClassification', 'searchArticleClassificationOptions')
      const barrier = await holdTaxonomyResponses(page, observer.ids, ['updateArticleClassification']); barriers.push(barrier)
      await page.locator('#save').click()
      console.log(JSON.stringify({ stage: 'barrier-ready-start', index }))
      await barrier.ready()
      assert.equal(writes, index + 1)
      barrier.release()
      await page.locator('#ack').filter({ hasText: String(index + 1) }).waitFor()
      console.log(JSON.stringify({ stage: 'ack-received', index, writes, elapsedMs: Math.round(performance.now() - start) }))
    }
    assert.equal(observer.count('updateArticleClassification'), 6)
    console.log(JSON.stringify({ result: 'PASS', node: process.version, chromium: browser.version(), writes }))
  } finally { for (const barrier of barriers) barrier.dispose(); await context.close() }
} finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)) }
