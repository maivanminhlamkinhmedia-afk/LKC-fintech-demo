import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import test from 'node:test'

const helper = resolve('scripts/cms-media/package-candidate.mjs')
const sha = '54238cd55e43b60b4d8cea02a32fc98e82f7762e'
function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'cms009-package-test-'))
  t.after(() => {
    const target = realpathSync(home), parent = realpathSync(tmpdir())
    assert.ok(target.startsWith(parent + sep) && target.split(sep).at(-1).startsWith('cms009-package-test-'))
    rmSync(target, { recursive: true })
  })
  const pathsWithSpaces = join(home, 'paths with spaces')
  const source = join(pathsWithSpaces, 'source'), work = join(pathsWithSpaces, 'work'), output = join(pathsWithSpaces, 'output')
  const standalone = join(source, '.next', 'standalone')
  for (const part of [join(standalone, '.next'), join(source, '.next', 'static'), join(source, 'public'),
    join(source, 'scripts', 'cms-media'), join(source, 'tests', 'browser-local')]) mkdirSync(part, { recursive: true })
  writeFileSync(join(standalone, 'server.js'), 'synthetic-server\n')
  writeFileSync(join(standalone, '.next', 'BUILD_ID'), 'synthetic-build-id\n')
  writeFileSync(join(source, '.next', 'static', 'asset.txt'), 'synthetic-static\n')
  writeFileSync(join(source, 'public', 'asset.txt'), 'synthetic-public\n')
  writeFileSync(join(source, 'scripts', 'cms-media', 'smoke-standalone.mjs'), `
    import { existsSync, readFileSync } from 'node:fs'
    import { join } from 'node:path'
    const root = process.argv[2]
    if (!existsSync(join(root, 'server.js')) || !existsSync(join(root, '.next', 'BUILD_ID'))) process.exit(2)
    if (existsSync(join(root, 'linked.txt')) && readFileSync(join(root, 'linked.txt'), 'utf8') !== 'linked-bytes') process.exit(3)
    console.log(JSON.stringify({ assembledMediaSmoke: existsSync(join(root, 'force-fail')) ? 'FAIL' : 'PASS', worker: 'PNG', lifetimes: 2 }))
  `)
  writeFileSync(join(source, 'tests', 'browser-local', 'cms-media-lifetime-child.mjs'), '// synthetic helper\n')
  const smoke = join(home, 'source-smoke.json')
  writeFileSync(smoke, JSON.stringify({ assembledMediaSmoke: 'PASS', worker: 'PNG', lifetimes: 2 }))
  const run = () => spawnSync(process.execPath, [helper, source, work, output, smoke], {
    encoding: 'utf8', timeout: 30000,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', SystemRoot: process.env.SystemRoot ?? '',
      TEMP: process.env.TEMP ?? '', TMP: process.env.TMP ?? '', SOURCE_SHA: sha, GITHUB_SHA: 'a'.repeat(40),
      GITHUB_REF: 'refs/heads/synthetic', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', CANDIDATE_NPM_VERSION: 'synthetic' },
  })
  return { home, source, standalone, work, output, smoke, run }
}
function linkOrSkip(t, target, path, type) {
  try { symlinkSync(target, path, type); return true }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS', 'UNKNOWN'].includes(error.code)) { t.skip(`symlink unavailable: ${error.code}`); return false }
    else throw error
  }
}
function archiveMember(output, archive, member) {
  const result = spawnSync('tar', ['-xOzf', archive, member], { cwd: output, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

test('packages the real helper output and smokes the materialized candidate before manifest creation', t => {
  const f = fixture(t), result = f.run()
  assert.equal(result.status, 0, result.stderr)
  const manifest = JSON.parse(readFileSync(join(f.output, 'manifest.json'), 'utf8'))
  const archive = join(f.output, manifest.archive)
  assert.equal(manifest.sourceSha, sha)
  assert.equal(manifest.workflowSha, 'a'.repeat(40))
  assert.equal(manifest.smoke.assembledMediaSmoke, 'PASS')
  assert.ok(existsSync(archive))
  assert.equal(readFileSync(`${archive}.sha256`, 'utf8').split(' ')[0], manifest.sha256)
  assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'), manifest.sha256)
  const members = spawnSync('tar', ['-tzf', manifest.archive], { cwd: f.output, encoding: 'utf8' })
  assert.equal(members.status, 0, members.stderr)
  assert.match(members.stdout, /cms009-candidate\/standalone\/server\.js/)
  assert.match(members.stdout, /cms009-candidate\/scripts\/cms-media\/smoke-standalone\.mjs/)
  assert.equal(archiveMember(f.output, manifest.archive, 'cms009-candidate/standalone/server.js'), 'synthetic-server\n')
  assert.equal(archiveMember(f.output, manifest.archive, 'cms009-candidate/standalone/.next/BUILD_ID'), 'synthetic-build-id\n')
  assert.equal(archiveMember(f.output, manifest.archive, 'cms009-candidate/standalone/.next/static/asset.txt'), 'synthetic-static\n')
  assert.equal(archiveMember(f.output, manifest.archive, 'cms009-candidate/standalone/public/asset.txt'), 'synthetic-public\n')
  assert.match(archiveMember(f.output, manifest.archive,
    'cms009-candidate/scripts/cms-media/smoke-standalone.mjs'), /assembledMediaSmoke/)
  assert.equal(readFileSync(join(f.work, 'cms009-candidate', 'standalone', '.next', 'static', 'asset.txt'), 'utf8'), 'synthetic-static\n')
  assert.equal(readFileSync(join(f.work, 'cms009-candidate', 'standalone', 'public', 'asset.txt'), 'utf8'), 'synthetic-public\n')
  assert.match(result.stdout, /CMS009_CANDIDATE_SMOKE/)
})

test('internal file link becomes identical bytes and retains executable mode', t => {
  const f = fixture(t), target = join(f.standalone, 'target.txt')
  writeFileSync(target, 'linked-bytes')
  chmodSync(target, 0o755)
  if (!linkOrSkip(t, 'target.txt', join(f.standalone, 'linked.txt'), 'file')) return
  const result = f.run()
  assert.equal(result.status, 0, result.stderr)
  const copied = join(f.work, 'cms009-candidate', 'standalone', 'linked.txt')
  assert.ok(lstatSync(copied).isFile())
  assert.equal(readFileSync(copied, 'utf8'), 'linked-bytes')
  assert.match(result.stdout, /"internal-file":1/)
  if (process.platform !== 'win32') assert.equal((statSync(copied).mode & 0o111), 0o111)
})

test('internal directory link is materialized as a directory with the same content', t => {
  const f = fixture(t), target = join(f.standalone, 'real-dir')
  mkdirSync(target)
  writeFileSync(join(target, 'entry.txt'), 'directory-bytes')
  if (!linkOrSkip(t, target, join(f.standalone, 'linked-dir'), process.platform === 'win32' ? 'junction' : 'dir')) return
  const result = f.run()
  assert.equal(result.status, 0, result.stderr)
  assert.ok(lstatSync(join(f.work, 'cms009-candidate', 'standalone', 'linked-dir')).isDirectory())
  assert.equal(readFileSync(join(f.work, 'cms009-candidate', 'standalone', 'linked-dir', 'entry.txt'), 'utf8'), 'directory-bytes')
  const manifest = JSON.parse(readFileSync(join(f.output, 'manifest.json'), 'utf8'))
  assert.equal(archiveMember(f.output, manifest.archive,
    'cms009-candidate/standalone/linked-dir/entry.txt'), 'directory-bytes')
  assert.match(result.stdout, /"internal-directory":1/)
})

test('external link is inventoried and rejected without reading or replacing its target', t => {
  const f = fixture(t), outside = join(f.home, 'outside-dir')
  mkdirSync(outside)
  writeFileSync(join(outside, 'sentinel.txt'), 'outside-bytes')
  if (!linkOrSkip(t, outside, join(f.standalone, 'outside-link'), process.platform === 'win32' ? 'junction' : 'dir')) return
  const result = f.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stdout, /"external":1/)
  assert.equal(readFileSync(join(outside, 'sentinel.txt'), 'utf8'), 'outside-bytes')
  assert.equal(existsSync(f.output), false)
})

test('dangling link is inventoried and rejected', t => {
  const f = fixture(t)
  const target = join(f.standalone, 'missing-target')
  if (!linkOrSkip(t, target, join(f.standalone, 'dangling-link'), process.platform === 'win32' ? 'junction' : 'dir')) return
  const result = f.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stdout, /"dangling":1/)
  assert.equal(existsSync(f.output), false)
})

test('directory link back to an ancestor is classified as a cycle and rejected', t => {
  const f = fixture(t), child = join(f.standalone, 'child')
  mkdirSync(child)
  if (!linkOrSkip(t, f.standalone, join(child, 'back'), process.platform === 'win32' ? 'junction' : 'dir')) return
  const result = f.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stdout, /"cycle":1/)
  assert.equal(existsSync(f.output), false)
})

test('.env content is never packaged or logged', t => {
  const f = fixture(t)
  writeFileSync(join(f.standalone, '.env.local'), 'PRIVATE_SYNTHETIC_SENTINEL')
  const result = f.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stdout, /"envFiles":1/)
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_SYNTHETIC_SENTINEL/)
  assert.equal(existsSync(f.output), false)
})

test('failed source smoke cannot create a candidate', t => {
  const f = fixture(t)
  writeFileSync(f.smoke, JSON.stringify({ assembledMediaSmoke: 'FAIL', worker: 'PNG', lifetimes: 2 }))
  const result = f.run()
  assert.notEqual(result.status, 0)
  assert.equal(existsSync(f.work), false)
  assert.equal(existsSync(f.output), false)
})

test('failed smoke on the materialized candidate prevents archive publication', t => {
  const f = fixture(t)
  writeFileSync(join(f.standalone, 'force-fail'), 'synthetic')
  const result = f.run()
  assert.notEqual(result.status, 0)
  assert.equal(existsSync(f.output), false)
  assert.match(result.stderr, /CMS009_CANDIDATE_SMOKE_NOT_PASS/)
})

test('Linux special file is rejected before materialization', t => {
  if (process.platform !== 'linux') { t.skip('requires Linux mkfifo'); return }
  const f = fixture(t)
  const fifo = join(f.standalone, 'special-fifo')
  const made = spawnSync('mkfifo', [fifo], { encoding: 'utf8' })
  assert.equal(made.status, 0, made.stderr)
  const result = f.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stdout, /"specialFiles":1/)
  assert.equal(existsSync(f.output), false)
})
