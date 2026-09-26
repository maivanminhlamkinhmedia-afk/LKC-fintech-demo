import assert from 'node:assert/strict'
import http from 'node:http'
import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'
import { chromium, errors } from 'playwright'

// Explicit standalone browser reproduction, outside the CMS staging suite and
// tests/*.test.mjs. Run only with the sanitized local environment in the report.
// No CMS imports, accounts, DB, fixtures, artifacts, traces or external requests.
const html = `<!doctype html><meta charset="utf-8"><label>Title <input id="title" value="baseline"></label>
<script>
window.saves = 0; window.beforeCalls = 0; window.dirty = false;
const input = document.querySelector('#title'); let timer;
input.addEventListener('input', () => {
  window.dirty = true; clearTimeout(timer);
  timer = setTimeout(() => { window.saves++; window.saved = input.value; window.dirty = false; }, 2000);
});
addEventListener('beforeunload', event => {
  window.beforeCalls++;
  if (window.dirty) { event.preventDefault(); event.returnValue = ''; }
});
</script>`
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(html)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
try {
  browser = await chromium.launch({ headless: true })
  console.log(JSON.stringify({ step: 'runtime', node: process.version, chromium: browser.version(),
    playwright: createRequire(import.meta.url)('playwright/package.json').version }))
  for (const paused of [true, false]) {
    for (const method of ['reload-waiter', 'native-trigger']) {
      const context = await browser.newContext({ serviceWorkers: 'block' })
      try {
        await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
        const page = await context.newPage()
        await page.clock.install()
        await page.goto(origin)
        if (paused) await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 60000)
        await page.locator('#title').click() // Real user activation for native beforeunload.
        await page.locator('#title').fill('synthetic retained draft')
        const start = performance.now() // Node clock, unaffected by page.clock.
        const log = (step, data = {}) => console.log(JSON.stringify({ method, paused, step,
          ms: Math.round(performance.now() - start), ...data }))
        let promiseState = 'pending', navigationError
        const unload = page.waitForEvent('dialog', { timeout: 4000 }).then(async dialog => {
          log('dialog', { type: dialog.type() })
          assert.equal(dialog.type(), 'beforeunload')
          await dialog.dismiss()
          log('dismissed')
        })
        const navigation = (method === 'reload-waiter' ? page.reload({ timeout: 2000 })
          : page.evaluate(() => window.location.reload())).then(() => {
          promiseState = 'fulfilled'; log('promise-settled', { promiseState })
        }, error => {
          promiseState = 'rejected'
          // Only the baseline's expected bounded TimeoutError is evidence;
          // all other errors, especially in the fixed path, fail this probe.
          if (method !== 'reload-waiter' || !(error instanceof errors.TimeoutError)) throw error
          navigationError = error
          log('promise-settled', { promiseState, errorName: 'TimeoutError' })
        })
        await unload
        const retained = await page.locator('#title').inputValue() === 'synthetic retained draft'
        const state = await page.evaluate(() => ({ beforeCalls: window.beforeCalls, saves: window.saves }))
        log('after-dismiss', { promiseState, open: !page.isClosed(), retained, ...state })
        assert.equal(page.isClosed(), false); assert.equal(retained, true); assert.equal(state.beforeCalls, 1)
        if (method === 'reload-waiter') assert.equal(promiseState, 'pending')
        // Both operations actually settle; no Promise.race or orphaned request.
        await Promise.all([navigation, unload])
        assert.equal(promiseState, method === 'reload-waiter' ? 'rejected' : 'fulfilled')
        assert.equal(!!navigationError, method === 'reload-waiter')
        assert.equal(await page.locator('#title').inputValue(), 'synthetic retained draft')
        log('after-await', { promiseState, open: !page.isClosed(), retained: true })
        if (paused) {
          await page.clock.runFor(1999); assert.equal(await page.evaluate(() => window.saves), 0)
          await page.clock.runFor(1); assert.equal(await page.evaluate(() => window.saves), 1)
          assert.equal(await page.evaluate(() => window.saved), 'synthetic retained draft')
          await page.clock.runFor(5000); assert.equal(await page.evaluate(() => window.saves), 1)
          log('debounce-preserved', { saves: 1 })
        }
        log('scenario-pass')
      } finally { await context.close() }
    }
  }
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
