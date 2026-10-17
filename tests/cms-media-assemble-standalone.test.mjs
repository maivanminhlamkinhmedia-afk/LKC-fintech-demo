import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { link, lstat, mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'

const script = resolve('scripts/cms-media/assemble-standalone.mjs')
const rawNames = ['media-storage.ts', 'media-contract.ts']
const rawBytes = name => Buffer.from(`// synthetic ${name}\r\nexport const value = "Tiếng Việt";\r\n`, 'utf8')
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
