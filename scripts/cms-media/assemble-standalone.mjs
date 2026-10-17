import { closeSync, constants, cpSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const project = process.cwd()
const bundle = resolve(project, '.next', 'standalone')
if (!bundle.startsWith(resolve(project, '.next') + sep)) throw new Error('CMS_MEDIA_STANDALONE_PATH_INVALID')
if (!existsSync(bundle) || !lstatSync(bundle).isDirectory()) throw new Error('CMS_MEDIA_STANDALONE_MISSING')
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
function checkedDirectory(root, target, create = false) {
  const rel = relative(root, target)
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('CMS_MEDIA_SOURCE_PATH_INVALID')
  let current = root
  for (const part of ['', ...rel.split(sep).filter(Boolean)]) {
    if (part) current = join(current, part)
    let info
    try { info = lstatSync(current) } catch (error) {
      if (!create || error.code !== 'ENOENT') throw new Error('CMS_MEDIA_SOURCE_PATH_INVALID')
      mkdirSync(current); info = lstatSync(current)
    }
    if (!info.isDirectory() || info.isSymbolicLink() || !samePath(realpathSync(current), current)) throw new Error('CMS_MEDIA_SOURCE_PATH_INVALID')
  }
}
function regularSource(file) {
  const info = lstatSync(file)
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || !samePath(realpathSync(file), file)) throw new Error('CMS_MEDIA_RAW_SOURCE_INVALID')
  return info
}
function sourceBytes(file) {
  const before = regularSource(file)
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = fstatSync(fd)
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error('CMS_MEDIA_RAW_SOURCE_INVALID')
    return readFileSync(fd)
  } finally { closeSync(fd) }
}
checkedDirectory(project, bundle)
function servers(directory) {
  const found = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error('CMS_MEDIA_SOURCE_PATH_INVALID')
    if (entry.isDirectory()) found.push(...servers(path))
    else if (entry.isFile() && entry.name === 'server.js') found.push(path)
  }
  return found
}
const entrypoints = servers(bundle)
if (entrypoints.length !== 1) throw new Error('CMS_MEDIA_STANDALONE_ENTRYPOINT_INVALID')
const runtimeBundle = dirname(entrypoints[0])
if (runtimeBundle !== bundle && !runtimeBundle.startsWith(bundle + sep)) throw new Error('CMS_MEDIA_STANDALONE_PATH_INVALID')
if (relative(bundle, runtimeBundle).split(sep).some(part => part === 'public' || part === 'static')) throw new Error('CMS_MEDIA_SOURCE_PATH_INVALID')
checkedDirectory(project, runtimeBundle)
regularSource(entrypoints[0])

// Dynamic operations-directory tracing can capture these repository runbooks.
// Prune only these exact, byte-verified copies; unknown inventory fails closed.
// Never recursively delete a docs tree or follow a link during release assembly.
const operationArtifacts = [
  'cms004-staging-cleanup.cjs',
  'cms009-candidate-artifact.md',
  'cms009-media-storage.md',
  'cms009-production-storage-release.md',
].map(name => `docs/cms/operations/${name}`)
const runtimeSources = new Set(['media-storage.ts', 'media-contract.ts', 'media-codec-worker.cjs']
  .map(name => `src/features/cms/${name}`))
const nextFiles = new Set(['BUILD_ID', 'package.json', 'app-path-routes-manifest.json', 'build-manifest.json',
  'prerender-manifest.json', 'required-server-files.json', 'routes-manifest.json'])
const nextDirectory = rel => ['.next/server', '.next/node_modules', '.next/static'].some(root => rel === root || rel.startsWith(`${root}/`))
const portable = path => path.split(sep).join('/')
// Diagnostic-only: never use these classifications as permission to copy a link.
// Emit known structural names only. Unknown names may contain customer/secret data.
function diagnosticBundlePath(path) {
  const rel = portable(relative(bundle, path))
  if (!rel || rel.length > 240 || isAbsolute(rel) || /[\x00-\x20\x7f-\uffff]/u.test(rel)
    || rel.split('/').some(part => part === '..' || part === '.' || !part)) return '[REDACTED]'
  const names = new Set(['.next', 'isolated-build', 'node_modules', '.bin', '@prisma', 'client',
    'runtime', 'pngjs', 'jpeg-js', 'index.js', 'client.js', 'package.json'])
  return rel.split('/').map((part, index, parts) => names.has(part)
    || (parts[index - 1] === '@prisma' && /^client-[a-f0-9]{16}$/u.test(part)) ? part : '[REDACTED]').join('/')
}
function diagnosticDependency(target) {
  // Only the existing assembler-owned dependencies can receive this classification.
  // Name/version metadata verification is diagnostic evidence, not a runtime permit.
  for (const name of ['@prisma/client', 'pngjs', 'jpeg-js']) {
    const root = resolve(project, 'node_modules', name)
    const rel = relative(root, target)
    if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) continue
    try {
      checkedDirectory(project, root)
      const packageFile = join(root, 'package.json'), lockFile = join(project, 'package-lock.json')
      if (regularSource(packageFile).size > 65536 || regularSource(lockFile).size > 4 * 1024 * 1024) return false
      const metadata = JSON.parse(sourceBytes(packageFile).toString('utf8'))
      const lock = JSON.parse(sourceBytes(lockFile).toString('utf8'))
      return metadata.name === name && typeof metadata.version === 'string' && metadata.version.length > 0
        && metadata.version === lock.packages?.[`node_modules/${name}`]?.version
    } catch { return false }
  }
  return false
}
function inventoryLinkError(path) {
  let linkType = 'unresolvable', targetClass = 'UNRESOLVED'
  try {
    const target = realpathSync(path), info = lstatSync(target)
    linkType = info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'unresolvable'
    const rel = relative(bundle, target)
    targetClass = !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
      ? 'INSIDE_BUNDLE' : diagnosticDependency(target) ? 'VERIFIED_CHECKOUT_DEPENDENCY' : 'OUTSIDE_SCOPE'
  } catch (error) {
    // Never forward native error messages, raw targets, or absolute filesystem paths.
    linkType = error?.code === 'ENOENT' ? 'dangling' : 'unresolvable'
  }
  let bundlePath = '[REDACTED]'
  try { bundlePath = diagnosticBundlePath(path) } catch { /* Diagnostics stay fail-closed. */ }
  console.error(`CMS_RELEASE_LINK_DIAGNOSTIC ${JSON.stringify({ bundlePath, linkType, targetClass })}`)
  const error = new Error('CMS_RELEASE_INVENTORY_LINK')
  // The ordinary Node stack would expose the checkout's absolute host path.
  error.stack = 'Error: CMS_RELEASE_INVENTORY_LINK'
  return error
}
function inventoryRealpath(path) {
  try { return realpathSync(path) } catch { throw inventoryLinkError(path) }
}

function forbiddenEntry(path) {
  return path.split('/').some(part => /^\.env/iu.test(part) || /^(?:AGENTS|CLAUDE)\.md$/iu.test(part)
    || /\.xlsx$/iu.test(part) || /(?:runbook|staging[-_]cleanup)/iu.test(part)
    || ['.git', '.journal', '.cms-media-root.json'].includes(part.toLowerCase()))
    || /(?:^|\/)docs\/cms\/operations(?:\/|$)/iu.test(path)
}
function regularTree(root, directory = root) {
  checkedDirectory(root, directory)
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (forbiddenEntry(portable(relative(root, path)))) throw new Error('CMS_RELEASE_INVENTORY_FORBIDDEN')
    if (entry.isSymbolicLink()) throw inventoryLinkError(path)
    if (entry.isDirectory()) regularTree(root, path)
    else regularSource(path)
  }
}
const prune = [], materialize = []
function releaseInventory(directory, preflight) {
  checkedDirectory(bundle, directory)
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const rel = portable(relative(runtimeBundle, path))
    // Next on Windows may emit this specific Prisma package junction. Materialize
    // only a verified checkout package, retaining byte integrity and portability.
    if (entry.isSymbolicLink()) {
      // Preserve the existing nested-output codec junction handling below.
      if (preflight && runtimeBundle !== bundle && rel === 'node_modules'
        && samePath(inventoryRealpath(path), resolve(project, 'node_modules'))) continue
      const source = resolve(project, 'node_modules', '@prisma', 'client')
      if (!preflight || !/^\.next\/node_modules\/@prisma\/client-[a-f0-9]{16}$/u.test(rel)
        || !samePath(inventoryRealpath(path), source)) throw inventoryLinkError(path)
      checkedDirectory(project, source)
      const manifest = JSON.parse(sourceBytes(join(source, 'package.json')).toString('utf8'))
      const lock = JSON.parse(sourceBytes(join(project, 'package-lock.json')).toString('utf8'))
      if (manifest.name !== '@prisma/client' || !manifest.version
        || manifest.version !== lock.packages?.['node_modules/@prisma/client']?.version)
        throw new Error('CMS_RELEASE_DEPENDENCY_IDENTITY_INVALID')
      regularTree(source)
      materialize.push({ path, source })
      continue
    }
    if (entry.isDirectory()) {
      const structural = path === runtimeBundle || runtimeBundle.startsWith(path + sep)
      const allowed = structural || ['.next', 'node_modules', 'src', 'src/features', 'src/features/cms', 'public'].includes(rel)
        || nextDirectory(rel) || rel.startsWith('node_modules/') || rel.startsWith('public/')
        || (preflight && ['docs', 'docs/cms', 'docs/cms/operations'].includes(rel))
      if (!allowed || (forbiddenEntry(rel) && !(preflight && rel === 'docs/cms/operations')))
        throw new Error('CMS_RELEASE_INVENTORY_FORBIDDEN')
      releaseInventory(path, preflight)
      continue
    }
    regularSource(path)
    if (preflight && operationArtifacts.includes(rel)) {
      const source = resolve(project, rel)
      checkedDirectory(project, dirname(source))
      if (!sourceBytes(path).equals(sourceBytes(source))) throw new Error('CMS_RELEASE_PRUNE_IDENTITY_MISMATCH')
      prune.push(path)
      continue
    }
    const allowed = ['server.js', 'package.json'].includes(rel) || runtimeSources.has(rel)
      || nextDirectory(rel) || (rel.startsWith('.next/') && nextFiles.has(rel.slice(6)))
      || rel.startsWith('node_modules/') || rel.startsWith('public/')
    if (!allowed || forbiddenEntry(rel)) throw new Error('CMS_RELEASE_INVENTORY_FORBIDDEN')
    // Public assets must be exact source assets, never an accidental source copy.
    if (rel.startsWith('public/')) {
      const source = resolve(project, rel)
      checkedDirectory(project, dirname(source))
      if (!sourceBytes(path).equals(sourceBytes(source))) throw new Error('CMS_RELEASE_PUBLIC_IDENTITY_MISMATCH')
    }
  }
}
// Complete inventory preflight before changing any release inventory.
releaseInventory(bundle, true)
for (const path of prune) {
  checkedDirectory(bundle, dirname(path)); regularSource(path); unlinkSync(path)
}
for (const rel of ['docs/cms/operations', 'docs/cms', 'docs']) {
  const path = resolve(runtimeBundle, rel)
  if (existsSync(path)) {
    checkedDirectory(runtimeBundle, path)
    if (readdirSync(path).length !== 0) throw new Error('CMS_RELEASE_INVENTORY_FORBIDDEN')
    rmdirSync(path) // Empty directories only; never recursive pruning.
  }
}
for (const { path, source } of materialize) {
  checkedDirectory(bundle, dirname(path))
  if (!lstatSync(path).isSymbolicLink() || !samePath(inventoryRealpath(path), source)) throw inventoryLinkError(path)
  unlinkSync(path) // Unlink the verified junction, never its target.
  cpSync(source, path, { recursive: true, force: false, errorOnExist: true })
  regularTree(path)
  if (!sameTree(source, path)) throw new Error('CMS_RELEASE_DEPENDENCY_COPY_MISMATCH')
}

// Offline standalone smoke consumes these exact raw modules. They used to arrive
// accidentally through whole-project tracing; never restore that broad dependency.
// Read both checked sources before copying anything. No env/private-media glob.
const rawNames = ['media-storage.ts', 'media-contract.ts']
const sourceDirectory = resolve(project, 'src', 'features', 'cms')
checkedDirectory(project, sourceDirectory)
const rawSources = rawNames.map(name => ({ name, bytes: sourceBytes(join(sourceDirectory, name)) }))
const rawDestination = resolve(runtimeBundle, 'src', 'features', 'cms')
checkedDirectory(runtimeBundle, rawDestination, true)
for (const { name } of rawSources) {
  const destination = join(rawDestination, name)
  try { regularSource(destination) } catch (error) { if (error.code !== 'ENOENT') throw error }
}
for (const { name, bytes } of rawSources) {
  const destination = join(rawDestination, name)
  // Unlink only the checked exact regular entry; exclusive creation never follows
  // a newly inserted symlink or overwrites another inode/hardlink target.
  try { unlinkSync(destination) } catch (error) { if (error.code !== 'ENOENT') throw error }
  writeFileSync(destination, bytes, { flag: 'wx', mode: 0o600 })
  if (!sourceBytes(destination).equals(bytes)) throw new Error('CMS_MEDIA_RAW_SOURCE_COPY_MISMATCH')
}

function sameTree(source, destination) {
  const sourceFiles = readdirSync(source, { withFileTypes: true })
  const destinationFiles = readdirSync(destination, { withFileTypes: true })
  if (sourceFiles.length !== destinationFiles.length) return false
  for (const entry of sourceFiles) {
    const from = join(source, entry.name), to = join(destination, entry.name)
    if (!existsSync(to) || entry.isSymbolicLink() || lstatSync(to).isSymbolicLink()) return false
    if (entry.isDirectory()) { if (!lstatSync(to).isDirectory() || !sameTree(from, to)) return false }
    else if (!entry.isFile() || !lstatSync(to).isFile() || !readFileSync(from).equals(readFileSync(to))) return false
  }
  return true
}

const workerRelative = join('src', 'features', 'cms', 'media-codec-worker.cjs')
const workerSource = resolve(project, workerRelative)
if (!existsSync(workerSource) || !lstatSync(workerSource).isFile() || lstatSync(workerSource).isSymbolicLink()) throw new Error('CMS_MEDIA_WORKER_MISSING')
const workerDestination = resolve(runtimeBundle, workerRelative)
mkdirSync(join(runtimeBundle, 'src', 'features', 'cms'), { recursive: true })
cpSync(workerSource, workerDestination, { force: true })
if (!readFileSync(workerSource).equals(readFileSync(workerDestination))) throw new Error('CMS_MEDIA_WORKER_COPY_MISMATCH')

for (const [name, version] of [['pngjs', '7.0.0'], ['jpeg-js', '0.4.4']]) {
  const source = resolve(project, 'node_modules', name)
  if (!existsSync(source) || !lstatSync(source).isDirectory() || lstatSync(source).isSymbolicLink()) throw new Error('CMS_MEDIA_CODEC_PACKAGE_MISSING')
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  if (manifest.name !== name || manifest.version !== version) throw new Error('CMS_MEDIA_CODEC_PIN_MISMATCH')
  const modules = resolve(runtimeBundle, 'node_modules')
  // A traced standalone can contain a junction to the checkout's node_modules.
  // Never remove an apparent bundle child through that junction.
  if (existsSync(modules) && lstatSync(modules).isSymbolicLink()) {
    // Isolated Next output may trace the source node_modules as a junction.
    // Unlink only that verified junction, never recurse into its target.
    if (runtimeBundle === bundle || realpathSync(modules).toLowerCase() !== realpathSync(resolve(project, 'node_modules')).toLowerCase())
      throw new Error('CMS_MEDIA_CODEC_DESTINATION_INVALID')
    unlinkSync(modules)
  }
  if (existsSync(modules)) {
    if (!lstatSync(modules).isDirectory() || realpathSync(modules).toLowerCase() !== modules.toLowerCase())
      throw new Error('CMS_MEDIA_CODEC_DESTINATION_INVALID')
  } else mkdirSync(modules, { recursive: true })
  const destination = resolve(modules, name)
  if (!destination.startsWith(runtimeBundle + sep)) throw new Error('CMS_MEDIA_CODEC_DESTINATION_INVALID')
  if (existsSync(destination)) {
    if (!lstatSync(destination).isDirectory() || lstatSync(destination).isSymbolicLink()
      || realpathSync(destination).toLowerCase() !== destination.toLowerCase()) throw new Error('CMS_MEDIA_CODEC_DESTINATION_INVALID')
    rmSync(destination, { recursive: true })
  }
  cpSync(source, destination, { recursive: true, force: false, errorOnExist: true })
  const copied = JSON.parse(readFileSync(join(destination, 'package.json'), 'utf8'))
  if (copied.name !== name || copied.version !== version || !sameTree(source, destination)) throw new Error('CMS_MEDIA_CODEC_COPY_MISMATCH')
}
releaseInventory(bundle, false)
console.log('CMS_MEDIA_STANDALONE_READY worker=1 codecs=2')
