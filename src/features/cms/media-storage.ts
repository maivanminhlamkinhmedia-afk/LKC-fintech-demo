import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, open, readFile, readdir, realpath, rename, lstat, unlink, link } from 'node:fs/promises'
import path from 'node:path'
import { MediaError, MEDIA_LIMITS, operationIdOrThrow } from './media-contract'

const markerName = '.cms-media-root.json'
const folders = ['objects', 'tmp', 'operations', 'locks'] as const
type Folder = typeof folders[number]
export type MediaRoot = { path: string; identity: string }
export type UploadOperation = {
  version: 1; kind: 'upload'; id: string; actorId: string; assetId: string; key: string; rootIdentity: string;
  startedAt: string; stage: 'intent' | 'dispatched' | 'canonical-ready' | 'file-ready' | 'committed' | 'abandoned';
  metadata: { originalFilename: string; altText: string; caption: string | null; mimeType: 'image/png' | 'image/jpeg' };
  digest: string | null; size: number | null; width: number | null; height: number | null
}
export type DeleteOperation = {
  version: 1; kind: 'delete'; id: string; actorId: string; uploadedById: string; assetId: string; key: string; rootIdentity: string;
  startedAt: string; stage: 'intent' | 'dispatched' | 'rejected' | 'db-deleted' | 'complete'; digest: string; size: number
}
export type MediaOperation = UploadOperation | DeleteOperation
const safeId = (value: string) => /^[a-f0-9]{32}$/u.test(value)
const safeKey = (value: string) => /^[a-f0-9]{32}\.(png|jpg)$/u.test(value)
function within(parent: string, target: string) {
  const relative = path.relative(parent, target)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
function mediaRootPath(): string {
  const value = process.env.CMS_MEDIA_ROOT
  if (!value || !path.isAbsolute(value)) throw new MediaError('MEDIA_STORAGE_UNAVAILABLE')
  const root = path.resolve(value), repo = path.resolve(process.cwd())
  const inside = within(repo, root) || root === repo
  const mode = process.env.CMS_MEDIA_ROOT_MODE
  const stagingBase = process.env.CMS_E2E_WORKSPACE ? path.join(path.resolve(process.env.CMS_E2E_WORKSPACE), '.next', 'cms-e2e-media') : path.join(repo, '.next', 'cms-e2e-media')
  const stagingRun = process.env.CMS_E2E_RUN_ID
  if (inside && !(mode === 'local' && within(path.join(repo, '.next', 'cms009-local'), root))
    && !(mode === 'staging' && /^[a-f0-9]{24}$/u.test(stagingRun ?? '') && root === path.join(stagingBase, stagingRun!))) throw new MediaError('MEDIA_STORAGE_UNAVAILABLE')
  if (mode === 'staging' && (!/^[a-f0-9]{24}$/u.test(stagingRun ?? '') || root !== path.join(stagingBase, stagingRun!))) throw new MediaError('MEDIA_STORAGE_UNAVAILABLE')
  return root
}
async function regular(file: string, expectedSize?: number) {
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (expectedSize !== undefined && info.size !== expectedSize)) throw new MediaError('MEDIA_STORAGE_UNAVAILABLE')
  return info
}
async function folder(root: string, name: Folder) {
  const target = path.join(root, name)
  const info = await lstat(target)
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(target) !== target) throw new MediaError('MEDIA_STORAGE_UNAVAILABLE')
  return target
}
export async function openMediaRoot(): Promise<MediaRoot> {
  try {
    const root = mediaRootPath()
    const info = await lstat(root)
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(root) !== root) throw new Error('root')
    const markerFile = path.join(root, markerName)
    await regular(markerFile)
    const marker = JSON.parse(await readFile(markerFile, 'utf8')) as { version?: number; identity?: string; purpose?: string }
    if (marker.version !== 1 || typeof marker.identity !== 'string' || !safeId(marker.identity) || marker.purpose !== 'cms-media') throw new Error('marker')
    for (const name of folders) await folder(root, name)
    return { path: root, identity: marker.identity }
  } catch { throw new MediaError('MEDIA_STORAGE_UNAVAILABLE') }
}
// Explicit local/staging provisioning only. Production provisioning is an operator task.
export async function provisionMediaRoot(root: string): Promise<MediaRoot> {
  if (root !== mediaRootPath() || !['local', 'staging'].includes(process.env.CMS_MEDIA_ROOT_MODE ?? '')) throw new MediaError('MEDIA_STORAGE_UNAVAILABLE')
  const identity = randomBytes(16).toString('hex')
  try {
    await mkdir(root, { recursive: false, mode: 0o700 })
    for (const name of folders) await mkdir(path.join(root, name), { mode: 0o700 })
    const handle = await open(path.join(root, markerName), 'wx', 0o600)
    try { await handle.writeFile(JSON.stringify({ version: 1, identity, purpose: 'cms-media' })); await handle.sync() } finally { await handle.close() }
    return await openMediaRoot()
  } catch { throw new MediaError('MEDIA_STORAGE_UNAVAILABLE') }
}
function operationFile(root: MediaRoot, id: string) { return path.join(root.path, 'operations', `${operationIdOrThrow(id)}.json`) }
function assertOperation(value: unknown, root: MediaRoot, id: string): asserts value is MediaOperation {
  if (!value || typeof value !== 'object') throw new MediaError('MEDIA_STORAGE_UNAVAILABLE')
  const op = value as Partial<MediaOperation>
  if (op.version !== 1 || op.id !== id || op.rootIdentity !== root.identity || !safeId(op.assetId ?? '') || !safeKey(op.key ?? '')
    || typeof op.actorId !== 'string' || !/^[A-Za-z0-9_-]{1,191}$/u.test(op.actorId)
    || (op.kind !== 'upload' && op.kind !== 'delete') || typeof op.startedAt !== 'string') throw new MediaError('MEDIA_STORAGE_UNAVAILABLE')
  if (op.kind === 'delete' && (typeof op.uploadedById !== 'string' || !/^[A-Za-z0-9_-]{1,191}$/u.test(op.uploadedById))) throw new MediaError('MEDIA_STORAGE_UNAVAILABLE')
}
export async function readMediaOperation(root: MediaRoot, id: string): Promise<MediaOperation> {
  try {
    const file = operationFile(root, id)
    await regular(file)
    const data: unknown = JSON.parse(await readFile(file, 'utf8'))
    assertOperation(data, root, id)
    return data
  } catch { throw new MediaError('NOT_FOUND') }
}
async function syncWrite(file: string, bytes: Buffer | string, exclusive = false) {
  const handle = await open(file, exclusive ? 'wx' : 'w', 0o600)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
}
export async function createMediaOperation(root: MediaRoot, operation: MediaOperation) {
  assertOperation(operation, root, operation.id)
  await syncWrite(operationFile(root, operation.id), JSON.stringify(operation), true)
}
export async function advanceMediaOperation(root: MediaRoot, operation: MediaOperation) {
  assertOperation(operation, root, operation.id)
  const file = operationFile(root, operation.id)
  await regular(file)
  // A crash before rename leaves a temp journal attributable to this operation.
  const temporary = path.join(root.path, 'tmp', `${operation.id}.journal`)
  await syncWrite(temporary, JSON.stringify(operation), true)
  await rename(temporary, file)
}
export async function withMediaLock<T>(root: MediaRoot, kind: 'operation' | 'asset' | 'actor', id: string, run: () => Promise<T>): Promise<T> {
  if (!safeId(id)) throw new MediaError('NOT_FOUND')
  const lock = path.join(root.path, 'locks', `${kind}-${id}`)
  try { await mkdir(lock, { mode: 0o700 }) } catch { throw new MediaError('MEDIA_BUSY') }
  try { return await run() } finally {
    // Only this invocation created this exact lock; if removal fails, keep it as recovery evidence.
    try { const { rmdir } = await import('node:fs/promises'); await rmdir(lock) } catch { console.error('CMS_MEDIA_LOCK_RELEASE_FAILED') }
  }
}
export async function countPendingMediaIntents(root: MediaRoot, actorId: string) {
  let count = 0
  for (const name of await readdir(path.join(root.path, 'operations'))) {
    if (!/^[a-f0-9]{32}\.json$/u.test(name)) throw new MediaError('MEDIA_STORAGE_UNAVAILABLE')
    const op = await readMediaOperation(root, name.slice(0, 32))
    if (op.kind === 'upload' && op.actorId === actorId && (op.stage === 'intent' || op.stage === 'dispatched'
      || op.stage === 'canonical-ready' || op.stage === 'file-ready')) {
      if (op.stage === 'intent' && Date.now() - Date.parse(op.startedAt) > MEDIA_LIMITS.intentMilliseconds) continue
      count++
    }
  }
  return count
}
export async function writeCanonicalFile(root: MediaRoot, key: string, bytes: Buffer, operationId: string) {
  if (!safeKey(key) || !bytes.length || bytes.length > MEDIA_LIMITS.bytes) throw new MediaError('MEDIA_STORAGE_UNAVAILABLE')
  const temporary = path.join(root.path, 'tmp', `${operationIdOrThrow(operationId)}.bin`)
  const final = path.join(root.path, 'objects', key)
  try {
    await syncWrite(temporary, bytes, true)
    // Atomic same-filesystem publication without replacing an existing key.
    await link(temporary, final)
    await unlink(temporary)
    await regular(final, bytes.length)
    return { digest: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }
  } catch { throw new MediaError('MEDIA_STORAGE_UNAVAILABLE') }
}
export async function readCanonicalFile(root: MediaRoot, key: string, size: number, digest: string) {
  if (!safeKey(key) || !Number.isInteger(size) || size < 1 || size > MEDIA_LIMITS.bytes || !/^[a-f0-9]{64}$/u.test(digest)) throw new MediaError('MEDIA_NOT_AVAILABLE')
  try {
    const file = path.join(root.path, 'objects', key)
    await regular(file, size)
    const bytes = await readFile(file)
    if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('digest')
    return bytes
  } catch { throw new MediaError('MEDIA_NOT_AVAILABLE') }
}
export async function removeCanonicalFile(root: MediaRoot, key: string, size: number, digest: string) {
  await readCanonicalFile(root, key, size, digest)
  await unlink(path.join(root.path, 'objects', key))
}
export async function storageInventory(root: MediaRoot) {
  const result: Record<Folder, string[]> = { objects: [], tmp: [], operations: [], locks: [] }
  for (const name of folders) {
    const dir = await folder(root.path, name)
    for (const entry of await readdir(dir)) {
      const target = path.join(dir, entry)
      const info = await lstat(target)
      if (name === 'locks' ? !info.isDirectory() || info.isSymbolicLink() : !info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new MediaError('MEDIA_STORAGE_UNAVAILABLE')
      result[name].push(entry)
    }
  }
  return result
}
export async function receiptForAsset(root: MediaRoot, assetId: string, key: string, allowedStages: readonly string[] = ['committed', 'db-deleted', 'complete']) {
  if (!safeId(assetId) || !safeKey(key)) throw new MediaError('MEDIA_NOT_AVAILABLE')
  for (const name of await readdir(path.join(root.path, 'operations'))) {
    if (!/^[a-f0-9]{32}\.json$/u.test(name)) throw new MediaError('MEDIA_STORAGE_UNAVAILABLE')
    const operation = await readMediaOperation(root, name.slice(0, 32))
    if (operation.kind === 'upload' && operation.assetId === assetId && operation.key === key && allowedStages.includes(operation.stage)
      && typeof operation.digest === 'string' && typeof operation.size === 'number') return operation
  }
  throw new MediaError('MEDIA_NOT_AVAILABLE')
}
