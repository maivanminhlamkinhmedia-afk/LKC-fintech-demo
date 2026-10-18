import assert from 'node:assert/strict'
import * as nativeFs from 'node:fs'
import * as nativePath from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { cp, link, lstat, mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, posix } from 'node:path'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'

const script = resolve('scripts/cms-media/assemble-standalone.mjs')
const rawNames = ['media-storage.ts', 'media-contract.ts']
const rawBytes = name => Buffer.from(`// synthetic ${name}\r\nexport const value = "TiÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂºÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¿ng ViÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â»ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡t";\r\n`, 'utf8')
async function seedRaw(scratch) {
  for (const name of rawNames) await writeFile(join(scratch, 'src', 'features', 'cms', name), rawBytes(name))
}
async function assertRaw(runtime) {
  for (const name of rawNames) {
    assert.deepEqual(await readFile(join(runtime, 'src', 'features', 'cms', name)), rawBytes(name))
    await assert.rejects(() => readFile(join(runtime, 'public', name)))
    await assert.rejects(() => readFile(join(runtime, '.next', 'static', name)))
  }
}

test('standalone assembler replaces stale same-version codec bytes within its bundle', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'cms009-assemble-'))
  assert.equal(dirname(resolve(scratch)), resolve(tmpdir()))
  t.after(() => rm(scratch, { recursive: true, force: true }))
  await mkdir(join(scratch, 'src', 'features', 'cms'), { recursive: true })
  await seedRaw(scratch)
  await mkdir(join(scratch, '.next', 'standalone'), { recursive: true })
  await writeFile(join(scratch, '.next', 'standalone', 'server.js'), 'process.chdir(__dirname)\n')
  await writeFile(join(scratch, 'src', 'features', 'cms', 'media-codec-worker.cjs'), 'module.exports = 1\n')
  for (const [name, version] of [['pngjs', '7.0.0'], ['jpeg-js', '0.4.4']]) {
    const source = join(scratch, 'node_modules', name)
    const destination = join(scratch, '.next', 'standalone', 'node_modules', name)
    await mkdir(source, { recursive: true }); await mkdir(destination, { recursive: true })
    const manifest = JSON.stringify({ name, version, main: 'index.js' })
    await writeFile(join(source, 'package.json'), manifest)
    await writeFile(join(destination, 'package.json'), manifest)
    await writeFile(join(source, 'index.js'), 'module.exports = "fresh"\n')
    await writeFile(join(destination, 'index.js'), 'module.exports = "stale"\n')
    await writeFile(join(destination, 'extra.js'), 'module.exports = "leftover"\n')
  }
  const result = spawnSync(process.execPath, [script], { cwd: scratch, env: process.env, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /CMS_MEDIA_STANDALONE_READY worker=1 codecs=2/)
  await assertRaw(join(scratch, '.next', 'standalone'))
  for (const name of ['pngjs', 'jpeg-js']) {
    const destination = join(scratch, '.next', 'standalone', 'node_modules', name)
    assert.equal(await readFile(join(destination, 'index.js'), 'utf8'), 'module.exports = "fresh"\n')
    await assert.rejects(() => readFile(join(destination, 'extra.js')))
  }
})
test('standalone assembler targets the directory where generated server.js changes cwd', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'cms009-assemble-nested-'))
  assert.equal(dirname(resolve(scratch)), resolve(tmpdir()))
  t.after(() => rm(scratch, { recursive: true, force: true }))
  const runtime = join(scratch, '.next', 'standalone', '.next', 'isolated-build')
  await mkdir(runtime, { recursive: true })
  await mkdir(join(scratch, 'src', 'features', 'cms'), { recursive: true })
  await seedRaw(scratch)
  await writeFile(join(runtime, 'server.js'), 'process.chdir(__dirname)\n')
  await writeFile(join(scratch, 'src', 'features', 'cms', 'media-codec-worker.cjs'), 'module.exports = 2\n')
  for (const [name, version] of [['pngjs', '7.0.0'], ['jpeg-js', '0.4.4']]) {
    const source = join(scratch, 'node_modules', name)
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'package.json'), JSON.stringify({ name, version, main: 'index.js' }))
    await writeFile(join(source, 'index.js'), 'module.exports = "nested"\n')
  }
  const result = spawnSync(process.execPath, [script], { cwd: scratch, env: process.env, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  await assertRaw(runtime)
  assert.equal(await readFile(join(runtime, 'src', 'features', 'cms', 'media-codec-worker.cjs'), 'utf8'), 'module.exports = 2\n')
  assert.equal(await readFile(join(runtime, 'node_modules', 'pngjs', 'index.js'), 'utf8'), 'module.exports = "nested"\n')
})
test('standalone assembler unlinks a verified source junction without deleting source codec bytes', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'cms009-assemble-junction-'))
  assert.equal(dirname(resolve(scratch)), resolve(tmpdir()))
  t.after(() => rm(scratch, { recursive: true, force: true }))
  const runtime = join(scratch, '.next', 'standalone', '.next', 'isolated-build')
  await mkdir(join(scratch, 'src', 'features', 'cms'), { recursive: true })
  await seedRaw(scratch)
  await mkdir(runtime, { recursive: true })
  await writeFile(join(runtime, 'server.js'), 'process.chdir(__dirname)\n')
  await writeFile(join(scratch, 'src', 'features', 'cms', 'media-codec-worker.cjs'), 'module.exports = 3\n')
  for (const [name, version] of [['pngjs', '7.0.0'], ['jpeg-js', '0.4.4']]) {
    const source = join(scratch, 'node_modules', name)
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'package.json'), JSON.stringify({ name, version, main: 'index.js' }))
    await writeFile(join(source, 'index.js'), 'module.exports = "source remains"\n')
  }
  await symlink(join(scratch, 'node_modules'), join(runtime, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  const result = spawnSync(process.execPath, [script], { cwd: scratch, env: process.env, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  await assertRaw(runtime)
  assert.equal((await lstat(join(runtime, 'node_modules'))).isSymbolicLink(), false)
  for (const name of ['pngjs', 'jpeg-js']) {
    assert.equal(await readFile(join(scratch, 'node_modules', name, 'index.js'), 'utf8'), 'module.exports = "source remains"\n')
    assert.equal(await readFile(join(runtime, 'node_modules', name, 'index.js'), 'utf8'), 'module.exports = "source remains"\n')
  }
})

async function fixture(t) {
  const scratch = await mkdtemp(join(tmpdir(), 'cms-trace-assemble-'))
  assert.equal(dirname(resolve(scratch)), resolve(tmpdir()))
  t.after(() => rm(scratch, { recursive: true, force: true }))
  const source = join(scratch, 'src', 'features', 'cms')
  const runtime = join(scratch, '.next', 'standalone')
  const destination = join(runtime, 'src', 'features', 'cms')
  await mkdir(source, { recursive: true }); await mkdir(runtime, { recursive: true })
  await writeFile(join(runtime, 'server.js'), 'process.chdir(__dirname)\n')
  await writeFile(join(source, 'media-codec-worker.cjs'), 'module.exports = 1\n')
  await seedRaw(scratch)
  for (const [name, version] of [['pngjs', '7.0.0'], ['jpeg-js', '0.4.4']]) {
    const packageRoot = join(scratch, 'node_modules', name)
    await mkdir(packageRoot, { recursive: true })
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name, version }))
    await writeFile(join(packageRoot, 'index.js'), 'module.exports = {}\n')
  }
  const run = () => spawnSync(process.execPath, [script], { cwd: scratch, env: process.env, encoding: 'utf8', timeout: 15000, shell: false })
  return { scratch, source, runtime, destination, run }
}
function refused(result) {
  assert.equal(result.error, undefined)
  assert.notEqual(result.status, 0)
  assert.doesNotMatch(result.stdout, /CMS_MEDIA_STANDALONE_READY/)
}

test('raw copy is byte-identical, replaces stale files and never copies unrelated private data', async t => {
  const f = await fixture(t)
  await mkdir(f.destination, { recursive: true })
  for (const name of rawNames) await writeFile(join(f.destination, name), 'stale\n')
  await writeFile(join(f.source, '.env'), 'synthetic-private-canary')
  await writeFile(join(f.source, 'private-media.png'), 'synthetic-private-canary')
  assert.equal(f.run().status, 0)
  await assertRaw(f.runtime)
  assert.deepEqual((await readdir(f.destination)).sort(), [...rawNames, 'media-codec-worker.cjs'].sort())
  assert.equal(f.run().status, 0) // Reassembly is byte-stable, not dependent on prior tracing.
  await assertRaw(f.runtime)
})

for (const missing of rawNames) {
  test(`missing ${missing} fails before publishing raw files`, async t => {
    const f = await fixture(t)
    await rm(join(f.source, missing))
    refused(f.run())
    await assert.rejects(() => lstat(f.destination), { code: 'ENOENT' })
  })
}

test('source ancestor junction/path escape is rejected without copying outside bytes', async t => {
  const f = await fixture(t), original = join(f.scratch, 'source-outside')
  await rename(join(f.scratch, 'src'), original)
  await symlink(original, join(f.scratch, 'src'), process.platform === 'win32' ? 'junction' : 'dir')
  refused(f.run())
  await assert.rejects(() => lstat(f.destination), { code: 'ENOENT' })
  assert.deepEqual(await readFile(join(original, 'features', 'cms', rawNames[0])), rawBytes(rawNames[0]))
})

test('source file junction and hardlink are rejected as non-private regular files', async t => {
  const f = await fixture(t)
  await rm(join(f.source, rawNames[0]))
  await symlink(f.runtime, join(f.source, rawNames[0]), process.platform === 'win32' ? 'junction' : 'dir')
  refused(f.run())
  await rm(join(f.source, rawNames[0]))
  await link(join(f.source, rawNames[1]), join(f.source, rawNames[0]))
  refused(f.run())
})

test('destination ancestor junction cannot redirect copies to source or another directory', async t => {
  const f = await fixture(t), outside = join(f.scratch, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'canary'), 'unchanged')
  await symlink(outside, join(f.runtime, 'src'), process.platform === 'win32' ? 'junction' : 'dir')
  refused(f.run())
  assert.deepEqual(await readdir(outside), ['canary'])
  assert.equal(await readFile(join(outside, 'canary'), 'utf8'), 'unchanged')
})

test('destination file junction fails preflight without replacing another stale destination', async t => {
  const f = await fixture(t), outside = join(f.scratch, 'outside')
  await mkdir(outside); await mkdir(f.destination, { recursive: true })
  await writeFile(join(f.destination, rawNames[0]), 'stale-but-preserve-on-rejection')
  await symlink(outside, join(f.destination, rawNames[1]), process.platform === 'win32' ? 'junction' : 'dir')
  refused(f.run())
  assert.equal(await readFile(join(f.destination, rawNames[0]), 'utf8'), 'stale-but-preserve-on-rejection')
  assert.deepEqual(await readdir(outside), [])
})

test('destination hardlink is rejected without altering its outside inode', async t => {
  const f = await fixture(t), outside = join(f.scratch, 'outside.txt')
  await mkdir(f.destination, { recursive: true }); await writeFile(outside, 'unchanged')
  await link(outside, join(f.destination, rawNames[0]))
  refused(f.run())
  assert.equal(await readFile(outside, 'utf8'), 'unchanged')
})

test('standalone root junction is rejected before writing through it', async t => {
  const f = await fixture(t), moved = join(f.scratch, 'outside-bundle')
  await rename(f.runtime, moved)
  await symlink(moved, f.runtime, process.platform === 'win32' ? 'junction' : 'dir')
  refused(f.run())
  assert.deepEqual(await readdir(moved), ['server.js'])
})

for (const segment of ['public', join('.next', 'static')]) {
  test(`entrypoint inside ${segment} cannot make raw source publicly served`, async t => {
    const f = await fixture(t), wrong = join(f.runtime, segment)
    await mkdir(wrong, { recursive: true })
    await rename(join(f.runtime, 'server.js'), join(wrong, 'server.js'))
    refused(f.run())
    await assert.rejects(() => lstat(join(wrong, 'src')), { code: 'ENOENT' })
  })
}


const operationalFiles = [
  'cms004-staging-cleanup.cjs', 'cms009-candidate-artifact.md',
  'cms009-media-storage.md', 'cms009-production-storage-release.md',
]
async function put(root, relative, bytes) {
  const path = join(root, relative)
  await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes)
  return path
}
async function seedOperations(f, runtime = f.runtime) {
  for (const name of operationalFiles) {
    const rel = `docs/cms/operations/${name}`
    await put(f.scratch, rel, `synthetic operations ${name}\r\n`)
    await put(runtime, rel, `synthetic operations ${name}\r\n`)
  }
}
for (const nested of [false, true]) {
  test(`release inventory removes only verified operational copies (${nested ? 'nested' : 'root'} runtime)`, async t => {
    const f = await fixture(t)
    let runtime = f.runtime
    if (nested) {
      runtime = join(f.runtime, '.next', 'isolated-build')
      await mkdir(runtime, { recursive: true })
      await rename(join(f.runtime, 'server.js'), join(runtime, 'server.js'))
    }
    await seedOperations(f, runtime)
    const chunk = await put(runtime, '.next/server/chunks/cms.js', 'synthetic runtime chunk')
    const dependency = await put(runtime, 'node_modules/runtime-dependency/index.js', 'synthetic runtime dependency')
    const publicAsset = await put(runtime, 'public/icon.svg', 'synthetic public asset')
    await put(f.scratch, 'public/icon.svg', 'synthetic public asset')
    const result = f.run()
    assert.equal(result.status, 0, result.stderr)
    await assert.rejects(() => lstat(join(runtime, 'docs')), { code: 'ENOENT' })
    for (const name of operationalFiles) assert.equal(await readFile(join(f.scratch, 'docs/cms/operations', name), 'utf8'), `synthetic operations ${name}\r\n`)
    assert.equal(await readFile(chunk, 'utf8'), 'synthetic runtime chunk')
    assert.equal(await readFile(dependency, 'utf8'), 'synthetic runtime dependency')
    assert.equal(await readFile(publicAsset, 'utf8'), 'synthetic public asset')
    await assertRaw(runtime)
    assert.equal(await readFile(join(runtime, 'src/features/cms/media-codec-worker.cjs'), 'utf8'), 'module.exports = 1\n')
    assert.equal(f.run().status, 0)
  })
}
for (const unexpected of [
  'docs/cms/operations/new-runbook.md', 'docs/other.md', '.env', '.env.production',
  '.next/server/.env.local', 'node_modules/dependency/.env.example', 'public/unapproved.xlsx',
  'node_modules/dependency/UNAPPROVED.XLSX', 'AGENTS.md', '.next/server/CLAUDE.md',
  'node_modules/dependency/staging-cleanup.cjs', 'scripts/cleanup.cjs', 'private/objects/media.png',
  'src/features/cms/unapproved.ts', '.git/config', '.next/cache/private.bin', '.next/unapproved.json',
]) {
  test(`release inventory refuses ${unexpected} without silently deleting it`, async t => {
    const f = await fixture(t)
    await seedOperations(f)
    const path = await put(f.runtime, unexpected, 'synthetic unapproved canary')
    const before = await lstat(path)
    const result = f.run()
    refused(result)
    assert.match(result.stderr, /CMS_RELEASE_INVENTORY_FORBIDDEN/)
    const after = await lstat(path)
    assert.equal(after.ino, before.ino)
    assert.equal(after.size, before.size)
    assert.equal(after.mtimeMs, before.mtimeMs)
    if (!unexpected.split('/').at(-1).startsWith('.env')) assert.equal(await readFile(path, 'utf8'), 'synthetic unapproved canary')
    // Inventory rejection must precede pruning even if the known docs were found first.
    for (const name of operationalFiles) assert.equal(await readFile(join(f.runtime, 'docs/cms/operations', name), 'utf8'), `synthetic operations ${name}\r\n`)
  })
}
test('operational copy with different bytes is rejected, not deleted', async t => {
  const f = await fixture(t)
  await seedOperations(f)
  const file = join(f.runtime, 'docs/cms/operations', operationalFiles[0])
  await writeFile(file, 'mismatched bytes')
  refused(f.run())
  assert.equal(await readFile(file, 'utf8'), 'mismatched bytes')
})
test('operational directory junction cannot redirect pruning outside standalone', async t => {
  const f = await fixture(t)
  await seedOperations(f)
  const docs = join(f.runtime, 'docs'), outside = join(f.scratch, 'outside-docs')
  await rename(docs, outside)
  await symlink(outside, docs, process.platform === 'win32' ? 'junction' : 'dir')
  refused(f.run())
  for (const name of operationalFiles) assert.equal(await readFile(join(outside, 'cms/operations', name), 'utf8'), `synthetic operations ${name}\r\n`)
})
async function prismaJunction(f) {
  const source = join(f.scratch, 'node_modules/@prisma/client')
  await put(source, 'package.json', JSON.stringify({ name: '@prisma/client', version: '7.8.0' }))
  await put(source, 'runtime/client.js', 'synthetic runtime client')
  await put(f.scratch, 'package-lock.json', JSON.stringify({ packages: { 'node_modules/@prisma/client': { version: '7.8.0' } } }))
  const destination = join(f.runtime, '.next/node_modules/@prisma/client-2c3a283f134fdcb6')
  await mkdir(dirname(destination), { recursive: true })
  await symlink(source, destination, process.platform === 'win32' ? 'junction' : 'dir')
  return { source, destination }
}
test('verified Prisma trace junction becomes byte-identical self-contained dependency', async t => {
  const f = await fixture(t), p = await prismaJunction(f)
  const result = f.run()
  assert.equal(result.status, 0, result.stderr)
  assert.equal((await lstat(p.destination)).isSymbolicLink(), false)
  for (const file of ['package.json', 'runtime/client.js']) assert.deepEqual(await readFile(join(p.source, file)), await readFile(join(p.destination, file)))
  assert.equal(f.run().status, 0)
})
for (const variant of ['wrong target', 'wrong version', 'secret-bearing dependency']) {
  test(`Prisma trace junction rejects ${variant} without altering source`, async t => {
    const f = await fixture(t), p = await prismaJunction(f)
    if (variant === 'wrong target') {
      await rm(p.destination)
      await symlink(f.source, p.destination, process.platform === 'win32' ? 'junction' : 'dir')
    } else if (variant === 'wrong version') {
      await writeFile(join(p.source, 'package.json'), JSON.stringify({ name: '@prisma/client', version: '0.0.0' }))
    } else await put(p.source, '.env', 'synthetic secret canary')
    refused(f.run())
    assert.equal((await lstat(p.destination)).isSymbolicLink(), true)
    assert.equal(await readFile(join(p.source, 'runtime/client.js'), 'utf8'), 'synthetic runtime client')
  })
}
test('public asset mismatch refuses release without changing the asset', async t => {
  const f = await fixture(t)
  const file = await put(f.runtime, 'public/icon.svg', 'unexpected content')
  await put(f.scratch, 'public/icon.svg', 'source content')
  refused(f.run())
  assert.equal(await readFile(file, 'utf8'), 'unexpected content')
})


function diagnostic(result, scratch) {
  refused(result)
  assert.match(result.stderr, /Error: CMS_RELEASE_INVENTORY_LINK/)
  const records = result.stderr.split(/\r?\n/u).filter(line => line.startsWith('CMS_RELEASE_LINK_DIAGNOSTIC '))
  assert.equal(records.length, 1)
  assert.ok(!result.stderr.includes(scratch))
  assert.doesNotMatch(result.stderr, /(?:file:\/\/\/|[A-Za-z]:[\\/]|\/home\/|\/Users\/)/u)
  const value = JSON.parse(records[0].slice('CMS_RELEASE_LINK_DIAGNOSTIC '.length))
  assert.deepEqual(Object.keys(value).sort(), ['bundlePath', 'linkType', 'targetClass'])
  return value
}
for (const nested of [false, true]) {
  test(`link diagnostic retains denial for an in-bundle directory (${nested ? 'nested' : 'root'})`, async t => {
    const f = await fixture(t)
    let runtime = f.runtime
    if (nested) {
      runtime = join(f.runtime, '.next/isolated-build')
      await mkdir(runtime, { recursive: true })
      await rename(join(f.runtime, 'server.js'), join(runtime, 'server.js'))
    }
    const target = join(runtime, 'node_modules/pngjs')
    await mkdir(target, { recursive: true }); await writeFile(join(target, 'index.js'), 'synthetic target bytes')
    const linkPath = join(runtime, '.next/node_modules/@prisma/client-1111111111111111')
    await mkdir(dirname(linkPath), { recursive: true })
    await symlink(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
    assert.deepEqual(diagnostic(f.run(), f.scratch), {
      bundlePath: `${nested ? '.next/isolated-build/' : ''}.next/node_modules/@prisma/client-1111111111111111`,
      linkType: 'directory', targetClass: 'INSIDE_BUNDLE',
    })
    assert.equal((await lstat(linkPath)).isSymbolicLink(), true)
    assert.equal(await readFile(join(target, 'index.js'), 'utf8'), 'synthetic target bytes')
  })
}
for (const matchedVersion of [true, false]) {
  test(`diagnostic dependency identity (${matchedVersion ? 'verified' : 'mismatched'}) never permits an unapproved link path`, async t => {
    const f = await fixture(t), p = await prismaJunction(f)
    const alias = join(dirname(p.destination), 'client')
    await rename(p.destination, alias) // Name is not the existing materialization allowlist.
    if (!matchedVersion) await writeFile(join(p.source, 'package.json'), JSON.stringify({ name: '@prisma/client', version: '0.0.0' }))
    assert.deepEqual(diagnostic(f.run(), f.scratch), {
      bundlePath: '.next/node_modules/@prisma/client', linkType: 'directory',
      targetClass: matchedVersion ? 'VERIFIED_CHECKOUT_DEPENDENCY' : 'OUTSIDE_SCOPE',
    })
    assert.equal((await lstat(alias)).isSymbolicLink(), true)
    assert.equal(await readFile(join(p.source, 'runtime/client.js'), 'utf8'), 'synthetic runtime client')
  })
}
test('diagnostic redacts sensitive link names and never emits external target or contents', async t => {
  const f = await fixture(t), outside = join(f.scratch, 'private-secret-password-canary')
  await mkdir(outside); await writeFile(join(outside, 'private.txt'), 'SECRET-CONTENT-CANARY')
  const path = join(f.runtime, 'node_modules/credential-secret-canary')
  await mkdir(dirname(path), { recursive: true })
  await symlink(outside, path, process.platform === 'win32' ? 'junction' : 'dir')
  const result = f.run()
  assert.deepEqual(diagnostic(result, f.scratch), { bundlePath: 'node_modules/[REDACTED]', linkType: 'directory', targetClass: 'OUTSIDE_SCOPE' })
  for (const value of ['private-secret-password-canary', 'credential-secret-canary', 'SECRET-CONTENT-CANARY', outside])
    assert.ok(!`${result.stdout}${result.stderr}`.includes(value))
  assert.equal(await readFile(join(outside, 'private.txt'), 'utf8'), 'SECRET-CONTENT-CANARY')
})
test('dangling previously recognized link emits sanitized failure instead of raw realpath error', async t => {
  const f = await fixture(t), p = await prismaJunction(f)
  await rename(p.source, `${p.source}-moved`)
  const value = diagnostic(f.run(), f.scratch)
  assert.equal(value.bundlePath, '.next/node_modules/@prisma/client-2c3a283f134fdcb6')
  assert.equal(value.linkType, 'dangling')
  assert.equal(value.targetClass, 'UNRESOLVED')
  assert.equal((await lstat(p.destination)).isSymbolicLink(), true)
})

// Pure diagnostic privacy tests use POSIX paths and synthetic metadata. These are
// not Linux filesystem execution evidence; real junction tests above are separate.
async function diagnosticModel({ path, target = '/checkout/.next/standalone/node_modules/pngjs/index.js', errorCode, kind = 'file', badMetadata = false }) {
  const source = await readFile(script, 'utf8')
  const helper = source.slice(source.indexOf('// Diagnostic-only:'), source.indexOf('function forbiddenEntry('))
  assert.ok(helper.includes('function inventoryLinkError('))
  const output = [], metadataReads = []
  const context = {
    project: '/checkout', bundle: '/checkout/.next/standalone', runtimeBundle: '/checkout/.next/standalone', sep: '/',
    relative: posix.relative, resolve: posix.resolve, join: posix.join, isAbsolute: posix.isAbsolute,
    portable: value => value, console: { error: value => output.push(value) },
    realpathSync: () => {
      if (errorCode) throw Object.assign(new Error('RAW-SECRET /outside/password'), { code: errorCode })
      return target
    },
    lstatSync: () => ({ isDirectory: () => kind === 'directory', isFile: () => kind === 'file' }),
    checkedDirectory: () => {}, regularSource: () => ({ size: 100 }),
    sourceBytes: file => {
      metadataReads.push(file)
      assert.ok(['/checkout/node_modules/pngjs/package.json', '/checkout/package-lock.json'].includes(file))
      return Buffer.from(JSON.stringify(file.endsWith('package-lock.json')
        ? { packages: { 'node_modules/pngjs': { version: '7.0.0' } } }
        : { name: 'pngjs', version: badMetadata ? '0.0.0' : '7.0.0' }))
    },
  }
  const run = runInNewContext(`${helper}\n(path) => { try { inventoryRealpath(path) } catch (e) { return e.message }; return inventoryLinkError(path).message }`, context)
  assert.equal(run(path), 'CMS_RELEASE_INVENTORY_LINK')
  assert.equal(output.length, 1)
  assert.ok(output[0].length < 600)
  assert.ok(!output[0].includes('RAW-SECRET'))
  assert.ok(!output[0].includes('/checkout'))
  assert.ok(!output[0].includes('/outside'))
  return { value: JSON.parse(output[0].slice('CMS_RELEASE_LINK_DIAGNOSTIC '.length)), metadataReads }
}
for (const [name, target, kind, errorCode, expected] of [
  ['file inside bundle', '/checkout/.next/standalone/node_modules/pngjs/index.js', 'file', undefined, ['file', 'INSIDE_BUNDLE']],
  ['file outside bundle', '/outside/private.env', 'file', undefined, ['file', 'OUTSIDE_SCOPE']],
  ['prefix sibling is outside', '/checkout/.next/standalone-secret/private', 'directory', undefined, ['directory', 'OUTSIDE_SCOPE']],
  ['dangling', undefined, 'file', 'ENOENT', ['dangling', 'UNRESOLVED']],
  ['loop', undefined, 'file', 'ELOOP', ['unresolvable', 'UNRESOLVED']],
  ['permission denied', undefined, 'file', 'EACCES', ['unresolvable', 'UNRESOLVED']],
]) {
  test(`diagnostic model: ${name} remains a sanitized rejection`, async () => {
    const { value, metadataReads } = await diagnosticModel({ path: '/checkout/.next/standalone/node_modules/pngjs', target, kind, errorCode })
    assert.deepEqual([value.linkType, value.targetClass], expected)
    assert.deepEqual(metadataReads, []) // Never read target contents or arbitrary package metadata.
  })
}
for (const [caseIndex, name] of ['secret-token-abc', '.env.production', '.npmrc', 'customer@example.com', 'secret\nforged-log', 'secret\u001b[31m', 'secret\u202etxt', 'x'.repeat(300), '../outside'].entries()) {
  test(`diagnostic path privacy model case ${caseIndex + 1}`, async () => {
    const { value } = await diagnosticModel({ path: `/checkout/.next/standalone/node_modules/${name}` })
    assert.ok(value.bundlePath.includes('[REDACTED]'))
    assert.ok(!value.bundlePath.includes(name))
    assert.doesNotMatch(value.bundlePath, /[\x00-\x20\x7f-\uffff]/u)
  })
}


async function identityFixture(t, nested = false) {
  const f = await fixture(t)
  if (nested) {
    const runtime = join(f.runtime, '.next/isolated-build')
    await mkdir(runtime, { recursive: true })
    await rename(join(f.runtime, 'server.js'), join(runtime, 'server.js'))
    f.runtime = runtime
  }
  const source = join(f.scratch, 'node_modules/@prisma/client')
  await put(source, 'package.json', JSON.stringify({ name: '@prisma/client', version: '7.8.0' }))
  await put(source, 'runtime/client.js', 'synthetic-prisma-runtime')
  await put(f.scratch, 'package-lock.json', JSON.stringify({ packages: { 'node_modules/@prisma/client': { version: '7.8.0' } } }))
  const target = join(f.runtime, 'node_modules/@prisma/client')
  await cp(source, target, { recursive: true })
  const path = join(f.runtime, '.next/node_modules/@prisma/client-2c3a283f134fdcb6')
  await mkdir(dirname(path), { recursive: true })
  // Actual relative Linux link; Windows uses an actual junction without needing ACL changes.
  await symlink(process.platform === 'win32' ? target : '../../../node_modules/@prisma/client', path,
    process.platform === 'win32' ? 'junction' : 'dir')
  return { ...f, source, target, path }
}
function identityRecord(result, f) {
  diagnostic(result, f.scratch) // Rejection and redaction are mandatory even on identity match.
  const lines = result.stderr.split(/\r?\n/u).filter(line => line.startsWith('CMS_PRISMA_IDENTITY_DIAGNOSTIC '))
  assert.equal(lines.length, 1)
  assert.ok(lines[0].length < 12000)
  const value = JSON.parse(lines[0].slice('CMS_PRISMA_IDENTITY_DIAGNOSTIC '.length))
  assert.deepEqual(Object.keys(value).sort(), ['bundlePath', 'chainComplete', 'hops', 'canonicalTargetPath',
    'targetIsDirectory', 'lockVersionMatches', 'sourceMetadataMatches', 'targetMetadataMatches', 'safeInventory',
    'targetFilesMatchSource', 'exactInventoryMatch', 'sourceFileCount', 'targetFileCount',
    'sourceInventorySha256', 'targetInventorySha256', 'status'].sort())
  for (const hop of value.hops) assert.deepEqual(Object.keys(hop).sort(), ['lexicalTargetPath', 'linkPath'])
  return value
}
for (const nested of [false, true]) {
  test(`Prisma identity: matching in-bundle dependency (${nested ? 'nested' : 'root'}) remains rejected`, async t => {
    const f = await identityFixture(t, nested), first = identityRecord(f.run(), f)
    assert.equal(first.status, 'OBSERVED_MATCH_NOT_AUTHORIZATION')
    assert.equal(first.canonicalTargetPath, `${nested ? '.next/isolated-build/' : ''}node_modules/@prisma/client`)
    for (const field of ['chainComplete', 'targetIsDirectory', 'lockVersionMatches', 'sourceMetadataMatches',
      'targetMetadataMatches', 'safeInventory', 'targetFilesMatchSource', 'exactInventoryMatch']) assert.equal(first[field], true, field)
    assert.equal(first.hops.length, 1)
    assert.equal(first.sourceFileCount, 2); assert.equal(first.targetFileCount, 2)
    assert.match(first.targetInventorySha256, /^[a-f0-9]{64}$/u)
    assert.equal(first.targetInventorySha256, first.sourceInventorySha256)
    assert.deepEqual(identityRecord(f.run(), f), first) // Deterministic evidence, not mutation/replay.
    assert.equal((await lstat(f.path)).isSymbolicLink(), true)
    assert.deepEqual(await readFile(join(f.source, 'runtime/client.js')), await readFile(join(f.target, 'runtime/client.js')))
  })
}
for (const variant of ['fake bytes', 'wrong name', 'wrong version', 'wrong lock version', 'wrong source metadata', 'missing metadata',
  'nested link', 'hardlink', 'secret file', 'credential dotfile', 'unsafe filename', 'file byte limit', 'metadata byte limit', 'entry limit']) {
  test(`Prisma identity: ${variant} cannot produce successful identity evidence`, async t => {
    const f = await identityFixture(t)
    if (variant === 'fake bytes') await put(f.target, 'runtime/client.js', 'PRIVATE-CONTENT-CANARY')
    if (variant === 'wrong name') await put(f.target, 'package.json', JSON.stringify({ name: 'PRIVATE-PACKAGE-CANARY', version: '7.8.0' }))
    if (variant === 'wrong version') await put(f.target, 'package.json', JSON.stringify({ name: '@prisma/client', version: '0.0.0' }))
    if (variant === 'wrong lock version') await put(f.scratch, 'package-lock.json', JSON.stringify({ packages: { 'node_modules/@prisma/client': { version: '0.0.0' } } }))
    if (variant === 'wrong source metadata') await put(f.source, 'package.json', JSON.stringify({ name: 'fake', version: '7.8.0' }))
    if (variant === 'missing metadata') await rm(join(f.target, 'package.json'))
    if (variant === 'nested link') await symlink(f.source, join(f.target, 'runtime/client'), process.platform === 'win32' ? 'junction' : 'dir')
    if (variant === 'hardlink') await link(join(f.source, 'runtime/client.js'), join(f.target, 'runtime/extra.js'))
    if (variant === 'secret file') await put(f.target, '.env.production', 'PRIVATE-CONTENT-CANARY')
    if (variant === 'credential dotfile') await put(f.target, '.npmrc', 'PRIVATE-CONTENT-CANARY')
    if (variant === 'unsafe filename') await put(f.target, 'customer@example.com', 'PRIVATE-CONTENT-CANARY')
    if (variant === 'file byte limit') await truncate(join(f.target, 'runtime/client.js'), 16 * 1024 * 1024 + 1)
    if (variant === 'metadata byte limit') await truncate(join(f.target, 'package.json'), 65537)
    if (variant === 'entry limit') for (let i = 0; i < 4097; i++) await put(f.target, `runtime/file-${i}.js`, '')
    const result = f.run(), value = identityRecord(result, f)
    assert.notEqual(value.status, 'OBSERVED_MATCH_NOT_AUTHORIZATION')
    assert.equal(value.targetFilesMatchSource, false)
    assert.equal(value.targetInventorySha256, null)
    assert.equal(value.sourceInventorySha256, null)
    for (const secret of ['PRIVATE-CONTENT-CANARY', 'PRIVATE-PACKAGE-CANARY', '.env.production', '.npmrc', 'customer@example.com'])
      assert.ok(!result.stderr.includes(secret))
    assert.equal((await lstat(f.path)).isSymbolicLink(), true)
  })
}
for (const variant of ['multi hop', 'existing checkout target', 'outside bundle', 'dangling', 'circular', 'unknown structural target', 'file target']) {
  test(`Prisma identity chain: ${variant} preserves fail-closed assembly`, async t => {
    const f = await identityFixture(t)
    await rm(f.path)
    let target = f.target
    if (variant === 'multi hop') {
      target = join(f.runtime, 'node_modules/@prisma/client-1111111111111111')
      await symlink(f.target, target, process.platform === 'win32' ? 'junction' : 'dir')
    }
    if (variant === 'existing checkout target') target = f.source
    if (variant === 'outside bundle') {
      target = join(f.scratch, 'outside-prisma-canary'); await cp(f.source, target, { recursive: true })
    }
    if (variant === 'dangling') { await rename(f.target, `${f.target}-moved`) }
    if (variant === 'circular') target = f.path
    if (variant === 'unknown structural target') {
      target = join(f.runtime, 'node_modules/private-secret-canary')
      await cp(f.source, target, { recursive: true })
    }
    if (variant === 'file target') target = join(f.target, 'runtime/client.js')
    // On Windows a junction to a file is unresolvable; this is still a refusal, not Linux file-link evidence.
    await symlink(target, f.path, process.platform === 'win32' ? 'junction' : 'dir')
    const result = f.run()
    if (variant === 'existing checkout target') {
      // The old, verified checkout-junction acceptance is deliberately untouched.
      assert.equal(result.status, 0, result.stderr)
      assert.ok(!result.stderr.includes('CMS_PRISMA_IDENTITY_DIAGNOSTIC'))
      return
    }
    const value = identityRecord(result, f)
    if (variant === 'multi hop') {
      assert.equal(value.hops.length, 2); assert.equal(value.chainComplete, true)
      assert.equal(value.status, 'OBSERVED_MATCH_NOT_AUTHORIZATION')
    } else {
      assert.notEqual(value.status, 'OBSERVED_MATCH_NOT_AUTHORIZATION')
      assert.equal(value.targetInventorySha256, null)
    }
    assert.ok(!result.stderr.includes('private-secret-canary'))
    assert.equal((await lstat(f.path)).isSymbolicLink(), true)
  })
}
test('Prisma identity diagnostic is absent for other hash aliases', async t => {
  const f = await identityFixture(t)
  await rename(f.path, f.path.replace('2c3a283f134fdcb6', '1111111111111111'))
  const result = f.run()
  diagnostic(result, f.scratch)
  assert.ok(!result.stderr.includes('CMS_PRISMA_IDENTITY_DIAGNOSTIC'))
})
test('Prisma identity distinguishes a safe traced subset from a complete package', async t => {
  const f = await identityFixture(t)
  await put(f.source, 'index.js', 'synthetic additional checkout file')
  const value = identityRecord(f.run(), f)
  assert.equal(value.targetFilesMatchSource, true); assert.equal(value.exactInventoryMatch, false)
  assert.equal(value.sourceFileCount, 3); assert.equal(value.targetFileCount, 2)
  assert.notEqual(value.targetInventorySha256, value.sourceInventorySha256)
})

// Fault-injected metadata controls use the real diagnostic functions and temporary
// fixtures. These are deterministic unit tests, not Linux filesystem evidence.
async function identityModel(f, overrides) {
  const source = await readFile(script, 'utf8')
  const helpers = source.slice(source.indexOf('const samePath'), source.indexOf('checkedDirectory(project, bundle)'))
    + source.slice(source.indexOf('const portable'), source.indexOf('const prune ='))
  const evaluate = runInNewContext(`${helpers}\nprismaIdentityDiagnostic`, {
    ...nativeFs, ...nativePath, createHash, Buffer, process: { platform: process.platform },
    project: f.scratch, bundle: f.runtime, runtimeBundle: f.runtime,
    console: { error: () => assert.fail('Direct helper must not print') }, ...overrides,
  })
  return JSON.parse(JSON.stringify(evaluate(f.path)))
}
for (const kind of ['special file', 'hardlink metadata', 'changed open inode', 'changed file after read', 'changed chain', 'raw IO error']) {
  test(`Prisma identity fault model: ${kind} is sanitized and cannot emit inventory digests`, async t => {
    const f = await identityFixture(t), file = join(f.target, 'runtime/client.js')
    const overrides = {}
    if (kind === 'special file' || kind === 'hardlink metadata') overrides.lstatSync = path => {
      const value = nativeFs.lstatSync(path)
      if (path === file) {
        if (kind === 'special file') value.isFile = () => false
        else value.nlink = 2
      }
      return value
    }
    if (kind === 'changed open inode' || kind === 'changed file after read') {
      let calls = 0
      overrides.fstatSync = fd => {
        const value = nativeFs.fstatSync(fd)
        if (kind === 'changed open inode') value.ino = -1
        else if (++calls % 2 === 0) value.size += 1
        return value
      }
    }
    if (kind === 'changed chain') {
      let calls = 0
      overrides.readlinkSync = path => ++calls === 1 ? nativeFs.readlinkSync(path) : join(f.runtime, 'node_modules/pngjs')
    }
    if (kind === 'raw IO error') overrides.opendirSync = () => { throw new Error('RAW-SECRET /private/host') }
    const value = await identityModel(f, overrides)
    assert.notEqual(value.status, 'OBSERVED_MATCH_NOT_AUTHORIZATION')
    assert.equal(value.sourceInventorySha256, null); assert.equal(value.targetInventorySha256, null)
    assert.ok(!JSON.stringify(value).includes('RAW-SECRET'))
    assert.ok(!JSON.stringify(value).includes(f.scratch))
  })
}
test('Prisma identity bounds tree depth without traversing a nested private link', async t => {
  const f = await identityFixture(t)
  await put(f.target, `${'runtime/'.repeat(25)}index.js`, 'synthetic depth control')
  const value = identityRecord(f.run(), f)
  assert.equal(value.status, 'TREE_LIMIT'); assert.equal(value.targetInventorySha256, null)
})

test('Prisma identity relative-link component model resolves each hop before dot-dot', async t => {
  const f = await identityFixture(t)
  const value = await identityModel(f, { readlinkSync: path => path === f.path
    ? '../../../node_modules/@prisma/client'.split('/').join(nativePath.sep) : nativeFs.readlinkSync(path) })
  assert.equal(value.chainComplete, true)
  assert.equal(value.canonicalTargetPath, 'node_modules/@prisma/client')
  assert.equal(value.status, 'OBSERVED_MATCH_NOT_AUTHORIZATION')
})
test('Prisma identity relative escape is rejected before reading outside the bundle', async t => {
  const f = await identityFixture(t), touched = []
  const value = await identityModel(f, {
    readlinkSync: () => '../../../../../../outside-private-canary',
    lstatSync: path => { touched.push(path); return nativeFs.lstatSync(path) },
  })
  assert.equal(value.status, 'PATH_UNSAFE')
  assert.equal(value.targetInventorySha256, null)
  assert.ok(!JSON.stringify(value).includes('outside-private-canary'))
  assert.ok(touched.every(path => path === f.runtime || path.startsWith(f.runtime + nativePath.sep)))
})


async function subsetFixture(t, nested = false) {
  const f = await identityFixture(t, nested)
  for (const root of [f.source, f.target]) {
    await put(root, 'default.js', 'module.exports = require(".prisma/client/default")\n')
    await put(root, 'runtime/client.js', 'module.exports = require("@prisma/client-runtime-utils")\n')
  }
  // The observed target has three entries; the source package has 76. Never copy the other 73.
  for (let i = 0; i < 73; i++) await put(f.source, `unused/file-${i}.js`, `source-only-${i}`)
  await put(f.runtime, 'node_modules/.prisma/client/default.js', 'module.exports = {client:"synthetic-generated-client"}\n')
  await put(f.runtime, 'node_modules/@prisma/client-runtime-utils/package.json', JSON.stringify({ name: '@prisma/client-runtime-utils', version: '7.8.0', main: 'index.js' }))
  await put(f.runtime, 'node_modules/@prisma/client-runtime-utils/index.js', 'module.exports = {runtime:"synthetic-runtime-utils"}\n')
  return f
}
async function treeSnapshot(root) {
  const files = {}
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      assert.equal(entry.isSymbolicLink(), false)
      if (entry.isDirectory()) await visit(path)
      else {
        assert.equal((await lstat(path)).nlink, 1)
        files[nativePath.relative(root, path).split(nativePath.sep).join('/')] = (await readFile(path)).toString('base64')
      }
    }
  }
  await visit(root)
  return files
}
function subsetModuleProbe(f) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    'import{createRequire}from"node:module";const r=createRequire(process.argv[1]);const d=r(process.argv[2]),u=r(process.argv[3]);console.log(JSON.stringify({client:d.client??null,runtime:u.runtime??null,defaultKeys:Object.keys(d).sort(),runtimeKeys:Object.keys(u).sort()}));',
    join(f.runtime, 'server.js'), join(f.path, 'default.js'), join(f.path, 'runtime/client.js')],
  { cwd: f.scratch, env: process.env, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}
for (const nested of [false, true]) {
  test(`Prisma traced subset: exact 3-file alias materializes without expanding package (${nested ? 'nested' : 'root'})`, async t => {
    const f = await subsetFixture(t, nested)
    const sourceBefore = await treeSnapshot(f.source), targetBefore = await treeSnapshot(f.target)
    assert.equal(Object.keys(sourceBefore).length, 76); assert.equal(Object.keys(targetBefore).length, 3)
    const before = subsetModuleProbe(f)
    const result = f.run()
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /CMS_MEDIA_STANDALONE_READY/)
    assert.equal((await lstat(f.path)).isSymbolicLink(), false)
    assert.deepEqual(await treeSnapshot(f.path), targetBefore)
    assert.deepEqual(await treeSnapshot(f.target), targetBefore)
    assert.deepEqual(await treeSnapshot(f.source), sourceBefore)
    assert.deepEqual(subsetModuleProbe(f), before)
    assert.equal(f.run().status, 0) // No second materialization or package expansion.
    assert.deepEqual(await treeSnapshot(f.path), targetBefore)
    await assertRaw(f.runtime)
  })
}
for (const variant of ['wrong bytes', 'wrong metadata', 'wrong source version', 'wrong lock version', 'missing default',
  'missing runtime', 'missing source file', 'nested link', 'hardlink', 'secret dotfile', 'unknown file', 'wrong target',
  'additional hop', 'missing generated client', 'shadowed dependency']) {
  test(`Prisma traced subset rejects ${variant} before replacing alias`, async t => {
    const f = await subsetFixture(t)
    if (variant === 'wrong bytes') await put(f.target, 'runtime/client.js', 'module.exports = "wrong"')
    if (variant === 'wrong metadata') await put(f.target, 'package.json', JSON.stringify({ name: 'fake', version: '7.8.0' }))
    if (variant === 'wrong source version') await put(f.source, 'package.json', JSON.stringify({ name: '@prisma/client', version: '0.0.0' }))
    if (variant === 'wrong lock version') await put(f.scratch, 'package-lock.json', JSON.stringify({ packages: { 'node_modules/@prisma/client': { version: '0.0.0' } } }))
    if (variant === 'missing default') await rm(join(f.target, 'default.js'))
    if (variant === 'missing runtime') await rm(join(f.target, 'runtime/client.js'))
    if (variant === 'missing source file') await rm(join(f.source, 'runtime/client.js'))
    if (variant === 'nested link') await symlink(f.source, join(f.target, 'nested'), process.platform === 'win32' ? 'junction' : 'dir')
    if (variant === 'hardlink') await link(join(f.source, 'default.js'), join(f.target, 'other.js'))
    if (variant === 'secret dotfile') await put(f.target, '.env.private', 'DO-NOT-LOG-CANARY')
    if (variant === 'unknown file') await put(f.target, 'other.js', 'DO-NOT-LOG-CANARY')
    if (variant === 'wrong target' || variant === 'additional hop') {
      await rm(f.path)
      const alternative = join(f.runtime, 'node_modules/@prisma/client-1111111111111111')
      if (variant === 'wrong target') await cp(f.target, alternative, { recursive: true })
      else await symlink(f.target, alternative, process.platform === 'win32' ? 'junction' : 'dir')
      await symlink(alternative, f.path, process.platform === 'win32' ? 'junction' : 'dir')
    }
    if (variant === 'missing generated client') await rm(join(f.runtime, 'node_modules/.prisma'), { recursive: true })
    if (variant === 'shadowed dependency') await put(f.runtime, '.next/node_modules/.prisma/client/default.js', 'module.exports = {shadow:true}')
    const sourceBefore = await readFile(join(f.source, 'package.json'))
    const result = f.run()
    refused(result)
    assert.equal((await lstat(f.path)).isSymbolicLink(), true)
    assert.deepEqual(await readFile(join(f.source, 'package.json')), sourceBefore)
    assert.ok(!result.stderr.includes('DO-NOT-LOG-CANARY'))
  })
}
async function subsetFunctions(f, overrides = {}) {
  const source = await readFile(script, 'utf8')
  const helpers = source.slice(source.indexOf('const samePath'), source.indexOf('checkedDirectory(project, bundle)'))
    + source.slice(source.indexOf('const operationArtifacts'), source.indexOf('const prune ='))
  return runInNewContext(`${helpers}\n({capturePrismaSubset, recheckPrismaSubset, materializePrismaSubset})`, {
    ...nativeFs, ...nativePath, createHash, createRequire, Buffer, process: { platform: process.platform },
    project: f.scratch, bundle: f.runtime, runtimeBundle: f.runtime,
    console: { error: () => assert.fail('Core subset verifier must not emit native details') }, ...overrides,
  })
}
for (const variant of ['link swap', 'same-byte target inode swap', 'target byte mutation', 'source inode swap', 'lockfile mutation', 'new target file']) {
  test(`Prisma traced subset detects TOCTOU: ${variant} before mutation`, async t => {
    const f = await subsetFixture(t), helpers = await subsetFunctions(f), plan = helpers.capturePrismaSubset(f.path)
    if (variant === 'link swap') {
      await rm(f.path); await symlink(f.source, f.path, process.platform === 'win32' ? 'junction' : 'dir')
    }
    if (variant === 'same-byte target inode swap' || variant === 'source inode swap') {
      const path = join(variant === 'source inode swap' ? f.source : f.target, 'runtime/client.js')
      const bytes = await readFile(path)
      await rename(path, `${path}-old`); await writeFile(path, bytes)
    }
    if (variant === 'target byte mutation') await put(f.target, 'runtime/client.js', 'mutated')
    if (variant === 'lockfile mutation') await put(f.scratch, 'package-lock.json', '{}')
    if (variant === 'new target file') await put(f.target, 'new.js', 'unexpected')
    let deleted = 0
    const guarded = await subsetFunctions(f, { unlinkSync: () => { deleted++; assert.fail('No unlink on changed plan') } })
    assert.throws(() => guarded.materializePrismaSubset(plan))
    assert.equal(deleted, 0)
    assert.equal((await lstat(f.path)).isSymbolicLink(), true)
  })
}
test('Prisma traced subset special-file metadata fails before mutation', async t => {
  const f = await subsetFixture(t)
  const helpers = await subsetFunctions(f, { lstatSync: (path, options) => {
    const stat = nativeFs.lstatSync(path, options)
    if (path === join(f.target, 'runtime/client.js')) stat.isFile = () => false
    return stat
  } })
  assert.throws(() => helpers.capturePrismaSubset(f.path))
  assert.equal((await lstat(f.path)).isSymbolicLink(), true)
})
test('Prisma traced subset exclusive creation refuses an injected destination link without changing its target', async t => {
  const f = await subsetFixture(t), outside = await put(f.scratch, 'outside-marker.txt', 'unchanged')
  const helpers = await subsetFunctions(f, { openSync: (path, flags, mode) => {
    if ((flags & nativeFs.constants.O_CREAT) !== 0) {
      // Use a hardlink on Windows without symlink privilege; O_EXCL rejects either form.
      nativeFs.linkSync(outside, path)
    }
    return nativeFs.openSync(path, flags, mode)
  } })
  const plan = helpers.capturePrismaSubset(f.path)
  assert.throws(() => helpers.materializePrismaSubset(plan))
  assert.equal(await readFile(outside, 'utf8'), 'unchanged')
  assert.deepEqual(await readFile(join(f.target, 'package.json')), await readFile(join(f.source, 'package.json')))
})

test('Prisma observed real three-file payload preserves runtime module loading without opening a database', async t => {
  const f = await subsetFixture(t)
  const packageRoot = resolve('node_modules/@prisma/client')
  // Actual pinned npm package code; the generated application client stays synthetic.
  await rm(f.source, { recursive: true }); await cp(packageRoot, f.source, { recursive: true })
  await rm(f.target, { recursive: true }); await mkdir(f.target, { recursive: true })
  const observed = ['default.js', 'package.json', 'runtime/client.js']
  for (const rel of observed) await put(f.target, rel, await readFile(join(packageRoot, rel)))
  const utils = join(f.runtime, 'node_modules/@prisma/client-runtime-utils')
  await rm(utils, { recursive: true })
  await cp(resolve('node_modules/@prisma/client-runtime-utils'), utils, { recursive: true })
  const rows = []
  for (const rel of observed) {
    const bytes = await readFile(join(f.target, rel))
    rows.push([rel, bytes.length, createHash('sha256').update(bytes).digest('hex')])
  }
  assert.equal(createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    'a8a851e099c688790b75c81888772e82dd51ac90b23383e41b75c8e809ccda29')
  // Load the real generated module without constructing a client/adapter or querying DB.
  const generated = join(f.runtime, 'node_modules/.prisma/client')
  await rm(generated, { recursive: true })
  await cp(resolve('node_modules/.prisma/client'), generated, { recursive: true })
  function errorIdentityProbe() {
    const probe = spawnSync(process.execPath, ['--input-type=module', '-e',
      'import{createRequire}from"node:module";const r=createRequire(process.argv[1]),d=r(process.argv[2]),u=r(process.argv[3]);const names=["PrismaClientKnownRequestError","PrismaClientUnknownRequestError","PrismaClientInitializationError","PrismaClientValidationError","PrismaClientRustPanicError"];console.log(JSON.stringify(Object.fromEntries(names.map(n=>[n,d.Prisma[n]===u[n]]))));',
      join(f.runtime, 'server.js'), join(f.path, 'default.js'), join(f.path, 'runtime/client.js')],
    { cwd: f.scratch, env: process.env, encoding: 'utf8' })
    assert.equal(probe.status, 0, probe.stderr)
    return JSON.parse(probe.stdout)
  }
  const errorsBefore = errorIdentityProbe()
  assert.ok(Object.values(errorsBefore).every(Boolean))
  const before = subsetModuleProbe(f)
  assert.ok(before.runtimeKeys.includes('getPrismaClient'))
  const result = f.run(); assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(subsetModuleProbe(f), before)
  assert.deepEqual(errorIdentityProbe(), errorsBefore)
  assert.deepEqual(await treeSnapshot(f.path), await treeSnapshot(f.target))
  assert.equal(Object.keys(await treeSnapshot(f.path)).length, 3)
})

test('Prisma traced subset detects new target entries inserted during copy and never removes canonical bytes', async t => {
  const f = await subsetFixture(t)
  let inserted = false
  const helpers = await subsetFunctions(f, { writeFileSync: (file, bytes, options) => {
    const result = nativeFs.writeFileSync(file, bytes, options)
    if (!inserted) {
      inserted = true
      nativeFs.writeFileSync(join(f.target, 'injected.js'), 'unexpected')
    }
    return result
  } })
  const plan = helpers.capturePrismaSubset(f.path)
  assert.throws(() => helpers.materializePrismaSubset(plan), /CMS_PRISMA_SUBSET_CHANGED_OR_INVALID/)
  assert.equal(await readFile(join(f.target, 'injected.js'), 'utf8'), 'unexpected')
  assert.deepEqual(await readFile(join(f.target, 'default.js')), await readFile(join(f.source, 'default.js')))
})

test('Prisma traced subset sanitizes native failures without leaking target or process details', async t => {
  const f = await subsetFixture(t)
  const helpers = await subsetFunctions(f, { readSync: () => { throw new Error('RAW-PRIVATE-CANARY /private/absolute/target') } })
  assert.throws(() => helpers.capturePrismaSubset(f.path), error => {
    assert.equal(error.message, 'CMS_PRISMA_SUBSET_CHANGED_OR_INVALID')
    assert.equal(error.stack, 'Error: CMS_PRISMA_SUBSET_CHANGED_OR_INVALID')
    return true
  })
  assert.equal((await lstat(f.path)).isSymbolicLink(), true)
})
