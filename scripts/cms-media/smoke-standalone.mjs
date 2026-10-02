import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Worker } from 'node:worker_threads'

const bundle = resolve(process.argv[2] ?? '')
if (!process.argv[2] || !existsSync(bundle)) throw new Error('STANDALONE_BUNDLE_REQUIRED')
function find(directory, name) {
  const matches = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) matches.push(...find(path, name))
    else if (entry.isFile() && entry.name === name) matches.push(path)
  }
  return matches
}
const entrypoints = find(bundle, 'server.js')
assert.equal(entrypoints.length, 1, 'one standalone entrypoint')
const runtimeBundle = dirname(entrypoints[0])
async function canonicalize(workerFile) {
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWNgZGL+DwABFAEGJMkltwAAAABJRU5ErkJggg==', 'base64')
  const worker = new Worker(workerFile)
  try {
    return await new Promise((resolveResult, reject) => {
      const timer = setTimeout(() => reject(new Error('STANDALONE_WORKER_TIMEOUT')), 15000)
      worker.once('message', result => { clearTimeout(timer); resolveResult(result) })
      worker.once('error', error => { clearTimeout(timer); reject(error) })
      worker.once('exit', code => { clearTimeout(timer); reject(new Error(`STANDALONE_WORKER_EXIT_${code}`)) })
      worker.postMessage({ bytes, mimeType: 'image/png' })
    })
  } finally { await worker.terminate() }
}
const scratch = await mkdtemp(join(tmpdir(), 'cms009-assembled-'))
assert.equal(dirname(resolve(scratch)), resolve(tmpdir()))
try {
  const directory = join(scratch, 'src', 'features', 'cms')
  await mkdir(directory, { recursive: true })
  for (const name of ['media-storage.ts', 'media-contract.ts']) {
    const matches = find(bundle, name)
    assert.equal(matches.length, 1, `traced ${name} inventory`)
    await cp(matches[0], join(directory, name))
  }
  const workerSource = join(runtimeBundle, 'src', 'features', 'cms', 'media-codec-worker.cjs')
  assert.ok(existsSync(workerSource), 'assembled worker path')
  const workerFile = join(directory, 'media-codec-worker.cjs')
  await cp(workerSource, workerFile)
  for (const name of ['pngjs', 'jpeg-js']) {
    const packageRoot = join(runtimeBundle, 'node_modules', name)
    assert.ok(existsSync(join(packageRoot, 'package.json')), `assembled ${name}`)
    await cp(packageRoot, join(scratch, 'node_modules', name), { recursive: true })
  }
  const canonical = await canonicalize(workerFile)
  assert.equal(canonical.ok, true, canonical.code)
  assert.equal(canonical.data.width, 1)
  assert.equal(canonical.data.height, 1)
  const child = resolve('tests/browser-local/cms-media-lifetime-child.mjs')
  const env = { ...process.env, CMS009_MEDIA_MODULE_ROOT: scratch, CMS_MEDIA_ROOT: join(scratch, 'private-root'),
    CMS_MEDIA_ROOT_MODE: 'local', CMS009_TEST_OP: randomBytes(16).toString('hex'),
    CMS009_TEST_ASSET: randomBytes(16).toString('hex'), CMS009_TEST_KEY: `${randomBytes(16).toString('hex')}.png`,
    CMS009_TEST_PAYLOAD: Buffer.from(canonical.data.bytes).toString('base64') }
  const run = mode => {
    const result = spawnSync(process.execPath, [child, mode], { cwd: process.cwd(), env, encoding: 'utf8', timeout: 15000 })
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout)
  }
  const first = run('write'), second = run('read')
  assert.notEqual(first.pid, second.pid)
  assert.deepEqual({ identity: second.identity, digest: second.digest, size: second.size },
    { identity: first.identity, digest: first.digest, size: first.size })
  assert.equal(first.size, canonical.data.bytes.length)
  process.stdout.write(JSON.stringify({ assembledMediaSmoke: 'PASS', worker: 'PNG', lifetimes: 2, canonicalBytes: first.size }) + '\n')
} finally { await rm(scratch, { recursive: true, force: true }) }
