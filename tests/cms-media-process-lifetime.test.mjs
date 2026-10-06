import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'

const child = resolve('tests/browser-local/cms-media-lifetime-child.mjs')

test('two independent Node lifetimes read the same external private root and digest', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'cms009-lifetime-'))
  assert.equal(dirname(resolve(scratch)), resolve(tmpdir()))
  t.after(() => rm(scratch, { recursive: true, force: true }))
  const env = { ...process.env, CMS_MEDIA_ROOT: join(scratch, 'private-root'), CMS_MEDIA_ROOT_MODE: 'local',
    CMS009_TEST_OP: randomBytes(16).toString('hex'), CMS009_TEST_ASSET: randomBytes(16).toString('hex'),
    CMS009_TEST_KEY: `${randomBytes(16).toString('hex')}.png` }
  const run = mode => {
    const childRun = spawnSync(process.execPath, [child, mode], { cwd: process.cwd(), env, encoding: 'utf8', timeout: 15000 })
    assert.equal(childRun.status, 0, childRun.stderr)
    return JSON.parse(childRun.stdout)
  }
  const first = run('write'), second = run('read')
  assert.notEqual(first.pid, second.pid)
  assert.deepEqual({ identity: second.identity, digest: second.digest, size: second.size },
    { identity: first.identity, digest: first.digest, size: first.size })
})
