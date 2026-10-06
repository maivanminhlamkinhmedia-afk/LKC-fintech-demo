import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  chmodSync, closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, realpathSync, statSync, writeFileSync,
} from 'node:fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'

const SOURCE_SHA = '54238cd55e43b60b4d8cea02a32fc98e82f7762e'
const ARCHIVE = 'cms009-candidate-54238cd.tar.gz'

function fail(code) { throw new Error(code) }
function inside(root, path) {
  const part = relative(root, path)
  return part === '' || (part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part))
}
function envPath(path) { return path.split(/[\\/]/).some(part => part.toLowerCase().startsWith('.env')) }
function pathKey(path) { return process.platform === 'win32' ? path.toLowerCase() : path }
function digest(path) { return createHash('sha256').update(readFileSync(path)).digest('hex') }

function inspect(rootPath, label) {
  if (!lstatSync(rootPath).isDirectory()) fail('CMS009_SOURCE_ROOT_INVALID')
  const root = realpathSync(rootPath)
  const dirs = new Map(), links = new Map()
  let envFiles = 0, specialFiles = 0

  function visit(directory) {
    const canonical = realpathSync(directory)
    const edges = []
    dirs.set(pathKey(canonical), edges)
    for (const name of readdirSync(directory)) {
      if (envPath(name)) { envFiles++; continue }
      const child = join(directory, name)
      const meta = lstatSync(child)
      if (meta.isDirectory()) {
        const target = realpathSync(child)
        edges.push({ target: pathKey(target), link: null })
        visit(child)
      } else if (meta.isSymbolicLink()) {
        const record = { path: child, relative: relative(root, child).replaceAll('\\', '/'), kind: 'unverified', target: null }
        try {
          const target = realpathSync(child)
          if (!inside(root, target)) record.kind = 'external'
          else if (envPath(relative(root, target))) record.kind = 'env-target'
          else {
            const targetMeta = statSync(target)
            if (targetMeta.isFile()) record.kind = 'internal-file'
            else if (targetMeta.isDirectory()) {
              record.kind = 'internal-directory'
              edges.push({ target: pathKey(target), link: record })
            } else record.kind = 'special-target'
            record.target = target
          }
        } catch (error) {
          if (error.code === 'ENOENT' || error.code === 'ENOTDIR') record.kind = 'dangling'
          else if (error.code === 'ELOOP') record.kind = 'cycle'
          else record.kind = 'unverified'
        }
        links.set(pathKey(child), record)
      } else if (!meta.isFile()) specialFiles++
    }
  }
  visit(root)

  const states = new Map()
  function checkCycles(directory) {
    states.set(directory, 'active')
    for (const edge of dirs.get(directory) ?? []) {
      if (states.get(edge.target) === 'active') {
        if (edge.link) edge.link.kind = 'cycle'
        else fail('CMS009_DIRECTORY_GRAPH_INVALID')
      } else if (!states.has(edge.target)) checkCycles(edge.target)
    }
    states.set(directory, 'done')
  }
  checkCycles(pathKey(root))

  const items = [...links.values()].sort((a, b) => a.relative.localeCompare(b.relative))
  const counts = { 'internal-file': 0, 'internal-directory': 0, external: 0, dangling: 0, cycle: 0,
    'env-target': 0, 'special-target': 0, unverified: 0 }
  for (const item of items) counts[item.kind]++
  // Only paths inside the bundle are logged. Never log link targets or file contents.
  console.log(`CMS009_SYMLINK_INVENTORY ${JSON.stringify({ label, counts, envFiles, specialFiles,
    links: items.slice(0, 50).map(({ relative: path, kind }) => ({ path, kind })), omitted: Math.max(0, items.length - 50) })}`)
  if (envFiles || counts['env-target']) fail('CMS009_ENV_FILE_FOUND')
  if (specialFiles || counts['special-target']) fail('CMS009_SPECIAL_FILE_FOUND')
  if (items.some(item => !['internal-file', 'internal-directory'].includes(item.kind))) fail('CMS009_UNSAFE_SYMLINK_FOUND')
  return { root, links, counts }
}

function materialize(source, destination, inventory, ancestors = new Set()) {
  const meta = lstatSync(source)
  let actual = source
  if (meta.isSymbolicLink()) {
    const recorded = inventory.links.get(pathKey(source))
    if (!recorded || !recorded.kind.startsWith('internal-')) fail('CMS009_LINK_NOT_IN_INVENTORY')
    actual = realpathSync(source)
    if (!inside(inventory.root, actual) || pathKey(actual) !== pathKey(recorded.target)) fail('CMS009_LINK_CHANGED')
  }
  const targetMeta = statSync(actual)
  if (targetMeta.isDirectory()) {
    const canonical = pathKey(realpathSync(actual))
    if (ancestors.has(canonical)) fail('CMS009_DIRECTORY_CYCLE')
    mkdirSync(destination)
    const next = new Set(ancestors).add(canonical)
    for (const name of readdirSync(actual)) {
      if (envPath(name)) fail('CMS009_ENV_FILE_FOUND')
      materialize(join(actual, name), join(destination, name), inventory, next)
    }
    chmodSync(destination, targetMeta.mode & 0o777)
  } else if (targetMeta.isFile()) {
    copyFileSync(actual, destination)
    chmodSync(destination, targetMeta.mode & 0o777)
    if (digest(actual) !== digest(destination)) fail('CMS009_COPY_BYTES_CHANGED')
    if (process.platform !== 'win32' && (statSync(destination).mode & 0o111) !== (targetMeta.mode & 0o111))
      fail('CMS009_EXECUTABLE_MODE_CHANGED')
  } else fail('CMS009_SPECIAL_FILE_FOUND')
}

function copyHelper(source, destination) {
  const meta = lstatSync(source)
  if (!meta.isFile() || envPath(basename(source))) fail('CMS009_HELPER_INVALID')
  copyFileSync(source, destination)
  chmodSync(destination, meta.mode & 0o777)
  if (digest(source) !== digest(destination)) fail('CMS009_HELPER_COPY_CHANGED')
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options })
  if (result.error || result.status !== 0) fail(`CMS009_COMMAND_FAILED_${command}_${result.status ?? result.error?.code ?? 'UNKNOWN'}`)
  return result.stdout
}

const [sourceArg, workArg, outputArg, sourceSmokeArg] = process.argv.slice(2)
if (!sourceArg || !workArg || !outputArg || !sourceSmokeArg || process.argv.length !== 6) fail('CMS009_PACKAGE_ARGS_INVALID')
const source = realpathSync(resolve(sourceArg)), work = resolve(workArg), output = resolve(outputArg)
if (inside(source, work) || inside(source, output) || inside(work, output) || inside(output, work)
  || existsSync(work) || existsSync(output)) fail('CMS009_PACKAGE_PATH_INVALID')
if (process.env.SOURCE_SHA !== SOURCE_SHA || !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '')
  || process.env.GITHUB_SHA === SOURCE_SHA) fail('CMS009_PACKAGE_PROVENANCE_INVALID')
const sourceSmoke = JSON.parse(readFileSync(resolve(sourceSmokeArg), 'utf8'))
if (sourceSmoke.assembledMediaSmoke !== 'PASS' || sourceSmoke.worker !== 'PNG' || sourceSmoke.lifetimes !== 2)
  fail('CMS009_SOURCE_SMOKE_NOT_PASS')

const bundle = inspect(join(source, '.next', 'standalone'), 'standalone')
const staticAssets = inspect(join(source, '.next', 'static'), 'static')
const publicAssets = inspect(join(source, 'public'), 'public')

mkdirSync(work)
const candidate = join(work, 'cms009-candidate')
mkdirSync(candidate)
const standalone = join(candidate, 'standalone')
materialize(bundle.root, standalone, bundle)
mkdirSync(join(candidate, 'scripts', 'cms-media'), { recursive: true })
mkdirSync(join(candidate, 'tests', 'browser-local'), { recursive: true })
mkdirSync(join(standalone, '.next'), { recursive: true })
materialize(staticAssets.root, join(standalone, '.next', 'static'), staticAssets)
materialize(publicAssets.root, join(standalone, 'public'), publicAssets)
copyHelper(join(source, 'scripts', 'cms-media', 'smoke-standalone.mjs'), join(candidate, 'scripts', 'cms-media', 'smoke-standalone.mjs'))
copyHelper(join(source, 'tests', 'browser-local', 'cms-media-lifetime-child.mjs'),
  join(candidate, 'tests', 'browser-local', 'cms-media-lifetime-child.mjs'))
const packed = inspect(candidate, 'materialized-candidate')
if (packed.links.size) fail('CMS009_CANDIDATE_LINK_REMAINS')
for (const name of ['server.js', join('.next', 'BUILD_ID')]) {
  if (!statSync(join(standalone, name)).isFile()) fail('CMS009_CANDIDATE_LAYOUT_INVALID')
}

const smokeEnv = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '',
  TMPDIR: process.env.TMPDIR ?? '', TEMP: process.env.TEMP ?? '', TMP: process.env.TMP ?? '',
  SystemRoot: process.env.SystemRoot ?? '', NODE_ENV: 'production',
  DATABASE_URL: 'mysql://build:build@127.0.0.1:3306/build', NEXTAUTH_URL: 'http://127.0.0.1:3000' }
const smokeText = run(process.execPath, [join(candidate, 'scripts', 'cms-media', 'smoke-standalone.mjs'), standalone],
  { cwd: candidate, env: smokeEnv, timeout: 60000 })
const smoke = JSON.parse(smokeText)
if (smoke.assembledMediaSmoke !== 'PASS' || smoke.worker !== 'PNG' || smoke.lifetimes !== 2)
  fail('CMS009_CANDIDATE_SMOKE_NOT_PASS')
console.log(`CMS009_CANDIDATE_SMOKE ${JSON.stringify(smoke)}`)

mkdirSync(output)
const archivePath = join(output, ARCHIVE)
// Tar sees only stdin/stdout and a relative input path; Node owns the platform-specific archive path.
const archiveWriter = openSync(archivePath, 'wx')
try {
  run('tar', ['-czf', '-', '-C', '.', 'cms009-candidate'],
    { cwd: work, stdio: ['ignore', archiveWriter, 'pipe'] })
} finally { closeSync(archiveWriter) }
const archiveReader = openSync(archivePath, 'r')
let members
try {
  members = run('tar', ['-tzf', '-'],
    { cwd: output, stdio: [archiveReader, 'pipe', 'pipe'] }).trim().split(/\r?\n/)
} finally { closeSync(archiveReader) }
const required = ['cms009-candidate/standalone/server.js', 'cms009-candidate/standalone/.next/BUILD_ID',
  'cms009-candidate/scripts/cms-media/smoke-standalone.mjs',
  'cms009-candidate/tests/browser-local/cms-media-lifetime-child.mjs']
for (const member of members) {
  const parts = member.replace(/\/$/, '').split('/')
  if (parts[0] !== 'cms009-candidate' || parts.some(part => part === '..' || part === '.') || member.startsWith('/'))
    fail('CMS009_ARCHIVE_LAYOUT_INVALID')
}
for (const member of required) if (!members.includes(member)) fail('CMS009_ARCHIVE_MEMBER_MISSING')
const sha256 = digest(archivePath)
writeFileSync(`${archivePath}.sha256`, `${sha256}  ${ARCHIVE}\n`)
const manifest = { schemaVersion: 1, kind: 'cms009-candidate', sourceSha: SOURCE_SHA,
  workflowSha: process.env.GITHUB_SHA, workflowRef: process.env.GITHUB_REF,
  runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  node: process.version, npm: process.env.CANDIDATE_NPM_VERSION, archive: ARCHIVE, sha256,
  sourceSmoke, smoke, materializedSymlinks: bundle.counts, packagedAt: new Date().toISOString(),
  layout: ['standalone', 'scripts/cms-media/smoke-standalone.mjs', 'tests/browser-local/cms-media-lifetime-child.mjs'] }
writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`CMS009_CANDIDATE_PACKAGE_READY archive=${ARCHIVE} sha256=${sha256}`)
