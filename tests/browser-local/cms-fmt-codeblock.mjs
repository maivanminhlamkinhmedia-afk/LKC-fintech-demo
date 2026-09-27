import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'
import { chromium, expect } from '@playwright/test'
import { validateEditorDocument } from '../../src/features/cms/editor-schema.ts'

// Standalone, synthetic browser probe. Use the filtered environment in the report.
// Mount the real ArticleEditor with installed packages; never start the CMS app.
const require = createRequire(import.meta.url)
const root = process.cwd()
const ts = require('typescript')
// Execute the actual patched FMT_CODE_BLOCK callback, without importing the CMS
// suite or its guarded staging hooks. Fail if the expected step is ambiguous.
const spec = ts.createSourceFile('cms-draft.spec.ts', await fs.readFile(path.join(root, 'tests/e2e/cms-draft.spec.ts'), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const callbacks = []
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(spec) === 'test.step'
    && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'FMT_CODE_BLOCK') {
    callbacks.push(node.arguments[1].getText(spec))
  }
  ts.forEachChild(node, visit)
}
visit(spec)
assert.equal(callbacks.length, 1)
const body = page => page.getByRole('textbox', { name: 'Nội dung bài viết', exact: true })
const runPatchedStep = new Function('page', 'body', 'expect', `return (${callbacks[0]})();`)
const output = path.join(root, '.next', 'cms006-fmt-local')
await fs.mkdir(output, { recursive: true })
await fs.writeFile(path.join(output, 'loader.cjs'), `
const ts = require('typescript');
module.exports = function(source) {
  if (this.resourcePath.endsWith('.css')) {
    const css = source.replace(/:global\\(([^)]+)\\)/g, '$1');
    return 'const style = document.createElement("style"); style.textContent = ' + JSON.stringify(css)
      + '; document.head.append(style); export default { editor: "editor" };';
  }
  return ts.transpileModule(source, { fileName: this.resourcePath, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX
  }}).outputText;
};
`)
await fs.writeFile(path.join(output, 'entry.mjs'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ArticleEditor } from '../../src/features/cms/components/ArticleEditor.tsx';
const onReady = editor => { window.editor = editor; };
createRoot(document.getElementById('root')).render(React.createElement(ArticleEditor, {
  initialContent: { type: 'doc', content: [{ type: 'paragraph' }] },
  disabled: false, onChange: () => {}, onReady
}));
`)
const { webpack } = require('next/dist/compiled/webpack/webpack')
await new Promise((resolve, reject) => {
  const compiler = webpack({ mode: 'production', devtool: false, context: root,
    entry: path.join(output, 'entry.mjs'), output: { path: output, filename: 'browser.js' },
    optimization: { minimize: false },
    resolve: { extensions: ['.tsx', '.ts', '.mjs', '.js'], alias: { '@': path.join(root, 'src') } },
    module: { rules: [{ test: /\.(tsx?|css)$/, use: path.join(output, 'loader.cjs') }] },
  })
  compiler.run((error, stats) => compiler.close(closeError => {
    if (error || closeError || stats.hasErrors()) reject(error || closeError || new Error(stats.toString({ all: false, errors: true })))
    else resolve()
  }))
})
const bundle = await fs.readFile(path.join(output, 'browser.js'))
const server = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': request.url === '/browser.js' ? 'text/javascript' : 'text/html; charset=utf-8' })
  response.end(request.url === '/browser.js' ? bundle : '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/browser.js"></script>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const code = 'const tiếngViệt = "an toàn";\nconsole.log(tiếngViệt)'
let browser
try {
  browser = await chromium.launch({ headless: true })
  console.log(JSON.stringify({ step: 'runtime', node: process.version, chromium: browser.version(),
    tiptap: JSON.parse(await fs.readFile(path.join(root, 'node_modules/@tiptap/core/package.json'), 'utf8')).version,
    playwright: require('playwright/package.json').version }))
  for (const clock of ['native', 'installed', 'paused-frame']) {
    for (const method of ['baseline', 'patched']) {
      for (let iteration = 1; iteration <= (clock === 'paused-frame' ? 1 : 5); iteration++) {
        const context = await browser.newContext({ serviceWorkers: 'block' })
        try {
          await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
          const page = await context.newPage()
          const errors = []
          page.on('pageerror', error => errors.push(error.message))
          if (clock !== 'native') await page.clock.install()
          await page.goto(origin)
          const editorBody = body(page)
          await expect(editorBody).toBeVisible()
          await editorBody.fill('Nội dung tiếng Việt: cổ phiếu, thị trường và rủi ro.')
          await editorBody.press('ControlOrMeta+A'); await editorBody.press('ControlOrMeta+B'); await editorBody.press('ArrowRight')
          await editorBody.press('Enter'); await editorBody.press('ControlOrMeta+Shift+8')
          await page.keyboard.type('Danh sách kiểm tra')
          await editorBody.press('Enter'); await editorBody.press('Enter')
          // Controlled comparison only: pause scheduled RAF while baseline sends
          // keys, or while patched code waits for the editor to receive focus.
          // The native/installed observations above do not intervene in timing.
          if (clock === 'paused-frame') await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 60_000)
          const start = performance.now()
          const events = []
          await page.exposeFunction('recordEvent', data => events.push({ ms: Math.round(performance.now() - start), ...data }))
          await page.evaluate(() => {
            const state = () => ({ active: document.activeElement?.tagName,
              focused: window.editor.view.hasFocus(), parent: window.editor.state.selection.$from.parent.type.name,
              anchor: window.editor.state.selection.anchor, domAnchor: window.getSelection()?.anchorNode?.parentElement?.tagName })
            let first = true
            window.fmtKeyCount = 0
            window.fmtClicks = 0
            document.addEventListener('keydown', event => {
              window.fmtKeyCount++
              if (first) { first = false; window.recordEvent({ step: 'first-key', key: event.key, ...state() }) }
            }, true)
            document.addEventListener('focusin', () => window.recordEvent({ step: 'focusin', ...state() }), true)
            document.addEventListener('click', event => {
              if (event.target.textContent !== 'Khối mã') return
              window.fmtClicks++
              window.recordEvent({ step: 'toolbar-click', ...state() })
            }, true)
          })
          if (method === 'baseline') {
            await page.getByRole('button', { name: 'Khối mã', exact: true }).click()
            events.push({ step: 'click-settled', ms: Math.round(performance.now() - start) })
            await page.keyboard.type(code)
            if (clock === 'paused-frame') await page.clock.runFor(16)
          } else {
            // Attach fulfillment/rejection handling immediately; always join the
            // operation before context closure, including a failed gate assertion.
            let settled = false
            const operation = runPatchedStep(page, body, expect).then(() => {
              settled = true; return { ok: true }
            }, error => { settled = true; return { ok: false, error } })
            try {
              if (clock === 'paused-frame') {
                await expect.poll(() => page.evaluate(() => window.fmtClicks)).toBe(1)
                const held = await page.evaluate(() => ({ focused: window.editor.view.hasFocus(), keys: window.fmtKeyCount }))
                assert.deepEqual(held, { focused: false, keys: 0 })
                assert.equal(settled, false)
                events.push({ step: 'waiting-without-typing', ms: Math.round(performance.now() - start), ...held })
              }
            } finally {
              if (clock === 'paused-frame') await page.clock.runFor(16)
              const result = await operation
              if (!result.ok) throw result.error
            }
          }
          await expect(editorBody).toBeFocused()
          const raw = await page.evaluate(() => window.editor.getJSON())
          const payload = await page.evaluate(() => JSON.stringify(window.editor.getJSON()))
          const domCode = await editorBody.evaluate(element => element.querySelector('pre code')?.textContent ?? null)
          const validated = validateEditorDocument(JSON.parse(payload))
          assert.deepEqual(JSON.parse(payload), raw)
          assert.deepEqual(validated.contentJson, raw)
          assert.ok(validated.contentText.includes('Nội dung tiếng Việt'))
          assert.ok(validated.contentText.includes('Danh sách kiểm tra'))
          assert.ok(JSON.stringify(raw).includes('"bold"'))
          assert.ok(JSON.stringify(raw).includes('"bulletList"'))
          const intact = domCode === code && validated.contentText.includes(code)
          if (method === 'patched') {
            assert.equal(intact, true)
            assert.equal(events.find(event => event.step === 'first-key').focused, true)
          }
          if (method === 'baseline' && clock === 'paused-frame') {
            assert.equal(intact, false)
            assert.equal(events.find(event => event.step === 'first-key').active, 'BUTTON')
            assert.equal(validated.contentText.includes('const tiếngViệt = "an toàn";'), false)
          }
          console.log(JSON.stringify({ clock, method, iteration, events, domCode, raw, contentText: validated.contentText,
            intact, errors }))
          assert.deepEqual(errors, [])
        } finally { await context.close() }
      }
    }
  }
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
