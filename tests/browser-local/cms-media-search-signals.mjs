import assert from 'node:assert/strict'
import http from 'node:http'
import { chromium } from '@playwright/test'
import { observeMediaSearch } from '../../scripts/cms-e2e/media-search-observation.ts'

// Synthetic geometry isolates the browser hit-test classifier. The full
// component/layout/native-click regression is cms-media-search-layout.mjs.
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end('<!doctype html><html><body><form aria-label="Tìm ảnh"><button>Tìm kiếm</button></form></body></html>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({ headless: true })
  const origin = `http://127.0.0.1:${server.address().port}`
  const results = []
  for (const [scenario, expected] of [
    ['ready', 'BUTTON_READY'], ['outside', 'BUTTON_OUTSIDE_VIEWPORT'],
    ['null-hit', 'BUTTON_NO_HIT'], ['overlay', 'BUTTON_COVERED'],
  ]) {
    const context = await browser.newContext({ serviceWorkers: 'block' })
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    const page = await context.newPage()
    try {
      await page.goto(origin)
      if (scenario !== 'ready') await page.evaluate(kind => {
        const button = document.querySelector('form button')
        if (kind === 'outside') { button.style.position = 'absolute'; button.style.top = '150vh' }
        if (kind === 'null-hit') Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null })
        if (kind === 'overlay') {
          const rect = button.getBoundingClientRect(), blocker = document.createElement('div')
          blocker.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;z-index:100`
          document.body.append(blocker)
        }
      }, scenario)
      const records = [], observer = await observeMediaSearch(page, record => records.push(record))
      assert.equal(observer.saw(expected), true, scenario)
      assert.deepEqual(records.map(row => row.signal), [expected])
      observer.dispose()
      results.push({ scenario, signal: expected })
    } finally { await context.close() }
  }
  console.log(JSON.stringify({ result: 'PASS', node: process.version, cases: results }))
} finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)) }
