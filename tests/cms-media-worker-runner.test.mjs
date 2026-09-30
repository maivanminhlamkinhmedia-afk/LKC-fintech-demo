import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { registerHooks } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const root = new URL('../src/features/cms/', import.meta.url)
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'server-only') return next('data:text/javascript,export {};', context)
  if (context.parentURL?.startsWith(root.href) && specifier.startsWith('./') && !specifier.endsWith('.ts'))
    return next(new URL(`${specifier}.ts`, context.parentURL).href, context)
  return next(specifier, context)
} })
const { runImageWorker } = await import('../src/features/cms/media-codec.ts')
after(() => hooks.deregister())
const image = PNG.sync.write({ width: 1, height: 1, data: Buffer.from([1, 2, 3, 255]) })
const realWorker = fileURLToPath(new URL('../src/features/cms/media-codec-worker.cjs', import.meta.url))
async function scratch(t) {
  const folder = await mkdtemp(join(tmpdir(), 'cms009-codec-fault-'))
  assert.equal(dirname(resolve(folder)), resolve(tmpdir()))
  t.after(() => rm(folder, { recursive: true, force: true }))
  return folder
}

test('worker deadline terminates a hung codec and releases single-flight slot', async t => {
  const file = join(await scratch(t), 'hung.cjs')
  await writeFile(file, "require('node:worker_threads').parentPort.on('message', () => {})")
  const first = runImageWorker(image, 'image/png', file, 80)
  await assert.rejects(() => runImageWorker(image, 'image/png', realWorker, 1000), error => error.code === 'MEDIA_BUSY')
  await assert.rejects(() => first, error => error.code === 'MEDIA_BUSY')
  const recovered = await runImageWorker(image, 'image/png', realWorker)
  assert.equal(recovered.width, 1)
  assert.equal(recovered.height, 1)
})

test('worker crash returns safe error and leaves a subsequent valid job runnable', async t => {
  const file = join(await scratch(t), 'crash.cjs')
  await writeFile(file, "throw new Error('synthetic worker crash')")
  await assert.rejects(() => runImageWorker(image, 'image/png', file), error => error.code === 'UNSUPPORTED_MEDIA')
  assert.equal((await runImageWorker(image, 'image/png', realWorker)).mimeType, 'image/png')
})
