import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

const project = process.cwd()
const bundle = resolve(project, '.next', 'standalone')
if (!bundle.startsWith(resolve(project, '.next') + sep)) throw new Error('CMS_MEDIA_STANDALONE_PATH_INVALID')
if (!existsSync(bundle) || !lstatSync(bundle).isDirectory()) throw new Error('CMS_MEDIA_STANDALONE_MISSING')
function servers(directory) {
  const found = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...servers(path))
    else if (entry.isFile() && entry.name === 'server.js') found.push(path)
  }
  return found
}
const entrypoints = servers(bundle)
if (entrypoints.length !== 1) throw new Error('CMS_MEDIA_STANDALONE_ENTRYPOINT_INVALID')
const runtimeBundle = dirname(entrypoints[0])
if (runtimeBundle !== bundle && !runtimeBundle.startsWith(bundle + sep)) throw new Error('CMS_MEDIA_STANDALONE_PATH_INVALID')

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
console.log('CMS_MEDIA_STANDALONE_READY worker=1 codecs=2')
