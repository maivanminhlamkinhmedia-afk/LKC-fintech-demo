import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'

const script = resolve('scripts/cms-media/assemble-standalone.mjs')

test('standalone assembler replaces stale same-version codec bytes within its bundle', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'cms009-assemble-'))
  assert.equal(dirname(resolve(scratch)), resolve(tmpdir()))
  t.after(() => rm(scratch, { recursive: true, force: true }))
  await mkdir(join(scratch, 'src', 'features', 'cms'), { recursive: true })
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
  assert.equal(await readFile(join(runtime, 'src', 'features', 'cms', 'media-codec-worker.cjs'), 'utf8'), 'module.exports = 2\n')
  assert.equal(await readFile(join(runtime, 'node_modules', 'pngjs', 'index.js'), 'utf8'), 'module.exports = "nested"\n')
})
test('standalone assembler unlinks a verified source junction without deleting source codec bytes', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'cms009-assemble-junction-'))
  assert.equal(dirname(resolve(scratch)), resolve(tmpdir()))
  t.after(() => rm(scratch, { recursive: true, force: true }))
  const runtime = join(scratch, '.next', 'standalone', '.next', 'isolated-build')
  await mkdir(join(scratch, 'src', 'features', 'cms'), { recursive: true })
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
  assert.equal((await lstat(join(runtime, 'node_modules'))).isSymbolicLink(), false)
  for (const name of ['pngjs', 'jpeg-js']) {
    assert.equal(await readFile(join(scratch, 'node_modules', name, 'index.js'), 'utf8'), 'module.exports = "source remains"\n')
    assert.equal(await readFile(join(runtime, 'node_modules', name, 'index.js'), 'utf8'), 'module.exports = "source remains"\n')
  }
})
