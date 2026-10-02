import { createHash } from 'node:crypto'
import { lstat, open, readFile, realpath, readdir, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const id = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)
const key = value => typeof value === 'string' && /^[a-f0-9]{32}\.(png|jpg)$/.test(value)
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const fail = code => { throw new Error(code) }
const safe = error => /^[A-Z][A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'RECOVERY_FAILED_REDACTED'
async function regular(file, expectedSize) {
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || expectedSize !== undefined && info.size !== expectedSize) fail('RECOVERY_FILE_DRIFT')
  return info
}
async function privateRoot(path, identity) {
  if (!isAbsolute(path) || !id(identity) || resolve(path) !== path) fail('RECOVERY_ROOT_INVALID')
  const root = await lstat(path)
  if (!root.isDirectory() || root.isSymbolicLink() || await realpath(path) !== path) fail('RECOVERY_ROOT_INVALID')
  const marker = join(path, '.cms-media-root.json')
  await regular(marker)
  const value = JSON.parse(await readFile(marker, 'utf8'))
  if (value.version !== 1 || value.identity !== identity || value.purpose !== 'cms-media') fail('RECOVERY_ROOT_INVALID')
  for (const name of ['objects', 'tmp', 'operations', 'locks']) {
    const folder = join(path, name), info = await lstat(folder)
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(folder) !== folder) fail('RECOVERY_ROOT_INVALID')
  }
}
async function exactFile(path, size, hash) {
  try {
    await regular(path, size)
    const bytes = await readFile(path)
    if (createHash('sha256').update(bytes).digest('hex') !== hash) fail('RECOVERY_FILE_DRIFT')
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}
async function journal(root, operationId, rootIdentity) {
  const file = join(root, 'operations', `${operationId}.json`)
  await regular(file)
  const operation = JSON.parse(await readFile(file, 'utf8'))
  if (operation.version !== 1 || operation.id !== operationId || operation.rootIdentity !== rootIdentity
    || !id(operation.assetId) || !key(operation.key) || typeof operation.actorId !== 'string'
    || !['upload', 'delete'].includes(operation.kind)
    || !['intent', 'dispatched', 'canonical-ready', 'file-ready', 'committed', 'abandoned', 'rejected', 'db-deleted', 'complete'].includes(operation.stage)) fail('RECOVERY_OPERATION_DRIFT')
  if (operation.kind === 'upload' && !['intent', 'dispatched', 'canonical-ready', 'file-ready', 'committed', 'abandoned'].includes(operation.stage)
    || operation.kind === 'delete' && !['intent', 'dispatched', 'rejected', 'db-deleted', 'complete'].includes(operation.stage)) fail('RECOVERY_OPERATION_DRIFT')
  if (operation.kind === 'delete' && (typeof operation.uploadedById !== 'string' || !operation.uploadedById)) fail('RECOVERY_OPERATION_DRIFT')
  return { operation, file }
}
async function writeStage(file, operation, stage) {
  const temp = join(resolve(file, '..', '..'), 'tmp', `${operation.id}.journal`)
  const handle = await open(temp, 'wx', 0o600)
  try { await handle.writeFile(JSON.stringify({ ...operation, stage })); await handle.sync() }
  finally { await handle.close() }
  await rename(temp, file)
}

// Adapters are injected for local fault tests. Neither import nor check-only writes DB/FS.
export async function inspectRecovery({ db, root, rootIdentity, operationId }) {
  if (!id(operationId)) fail('RECOVERY_OPERATION_INVALID')
  await privateRoot(root, rootIdentity)
  const { operation, file } = await journal(root, operationId, rootIdentity)
  try { await lstat(join(root, 'tmp', `${operationId}.journal`)); fail('RECOVERY_TEMP_JOURNAL_PRESENT') }
  catch (error) { if (error?.code !== 'ENOENT') throw error }
  const lockNames = await readdir(join(root, 'locks'))
  if (lockNames.includes(`operation-${operationId}`) || lockNames.includes(`asset-${operation.assetId}`)
    || lockNames.includes(`actor-${createHash('sha256').update(operation.actorId).digest('hex').slice(0, 32)}`)) fail('RECOVERY_LOCK_PRESENT')
  const row = await db.mediaAsset.findUnique({ where: { id: operation.assetId } })
  const covers = await db.article.count({ where: { coverMediaId: operation.assetId } })
  if (covers && !row) fail('RECOVERY_DB_DRIFT')
  const canonicalPath = join(root, 'objects', operation.key)
  const hasReceipt = Number.isInteger(operation.size) && operation.size > 0 && operation.size <= 5 * 1024 * 1024 && digest(operation.digest)
  let filePresent = false
  if (hasReceipt) filePresent = await exactFile(canonicalPath, operation.size, operation.digest)
  else { try { await lstat(canonicalPath); fail('RECOVERY_UNRECEIPTED_FILE') } catch (error) { if (error?.code !== 'ENOENT') throw error } }
  const tempPath = join(root, 'tmp', `${operationId}.bin`)
  let tempPresent = false
  if (hasReceipt) tempPresent = await exactFile(tempPath, operation.size, operation.digest)
  else { try { await lstat(tempPath); fail('RECOVERY_UNRECEIPTED_FILE') } catch (error) { if (error?.code !== 'ENOENT') throw error } }
  let state
  if (operation.kind === 'upload') {
    if (row) {
      if (!filePresent || row.id !== operation.assetId || row.uploadedById !== operation.actorId
        || row.filename !== operation.key || row.url !== `/api/cms/media/${operation.assetId}/content`
        || row.sizeBytes !== operation.size || row.mimeType !== operation.metadata?.mimeType) fail('RECOVERY_DB_DRIFT')
      state = 'UPLOAD_COMMITTED'
    } else if (covers || operation.stage === 'committed') fail('RECOVERY_DB_DRIFT')
    else state = 'UPLOAD_ORPHAN'
  } else {
    if (row) {
      if (row.filename !== operation.key || row.uploadedById !== operation.uploadedById)
        fail('RECOVERY_DB_DRIFT')
      state = 'DELETE_NOT_COMMITTED'
    } else if (operation.stage === 'intent' || operation.stage === 'rejected') state = 'DELETE_NOT_DISPATCHED'
    else state = filePresent ? 'DELETE_FILE_PENDING' : 'DELETE_COMPLETE'
  }
  return { state, operation, file, canonicalPath, tempPath, filePresent, tempPresent, covers }
}

export async function applyRecovery(options) {
  const { operationId, expectedAssetId, expectedActorId, expectedKey, confirmation } = options
  if (confirmation !== operationId || !id(expectedAssetId) || !key(expectedKey) || !expectedActorId) fail('RECOVERY_CONFIRMATION_REQUIRED')
  const result = await inspectRecovery(options)
  const op = result.operation
  if (op.assetId !== expectedAssetId || op.actorId !== expectedActorId || op.key !== expectedKey) fail('RECOVERY_OPERATION_DRIFT')
  if (result.state === 'UPLOAD_COMMITTED' || result.state === 'DELETE_NOT_COMMITTED' || result.state === 'DELETE_NOT_DISPATCHED')
    return { state: result.state, applied: false }
  if (result.state === 'UPLOAD_ORPHAN' && op.stage === 'abandoned' && !result.filePresent && !result.tempPresent
    || result.state === 'DELETE_COMPLETE' && op.stage === 'complete') return { state: result.state, applied: false }
  if (result.state === 'UPLOAD_ORPHAN') {
    if (result.filePresent) await unlink(result.canonicalPath)
    if (result.tempPresent) await unlink(result.tempPath)
    await writeStage(result.file, op, 'abandoned')
  } else if (result.state === 'DELETE_FILE_PENDING') {
    await unlink(result.canonicalPath)
    await writeStage(result.file, op, 'complete')
  } else if (result.state === 'DELETE_COMPLETE' && op.stage !== 'complete') await writeStage(result.file, op, 'complete')
  return { state: result.state, applied: true }
}

function argumentsFrom(args) {
  const result = { apply: false }
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    if (flag === '--apply') { result.apply = true; continue }
    if (!['--operation', '--root-identity', '--database-name', '--database-user', '--confirm-operation', '--asset', '--actor', '--key'].includes(flag)
      || !args[i + 1] || args[i + 1].startsWith('--')) fail('RECOVERY_ARGUMENT_INVALID')
    result[flag.slice(2)] = args[++i]
  }
  if (!result.operation || !result['root-identity'] || !result['database-name'] || !result['database-user']) fail('RECOVERY_ARGUMENT_INVALID')
  return result
}

async function main() {
  const args = argumentsFrom(process.argv.slice(2))
  const root = process.env.CMS_MEDIA_ROOT, databaseUrl = process.env.DATABASE_URL
  if (!root || !databaseUrl) fail('RECOVERY_CONFIGURATION_REQUIRED')
  const target = new URL(databaseUrl)
  if (target.protocol !== 'mysql:' || !target.hostname || !target.pathname.slice(1)) fail('RECOVERY_CONFIGURATION_REQUIRED')
  const [{ PrismaClient }, { PrismaMariaDb }] = await Promise.all([import('@prisma/client'), import('@prisma/adapter-mariadb')])
  const db = new PrismaClient({ adapter: new PrismaMariaDb({ host: target.hostname, port: Number(target.port || 3306),
    user: decodeURIComponent(target.username), password: decodeURIComponent(target.password),
    database: decodeURIComponent(target.pathname.slice(1)), connectionLimit: 1 }), log: [] })
  try {
    const identity = await db.$queryRaw`SELECT DATABASE() AS databaseName, CURRENT_USER() AS databaseUser`
    if (identity.length !== 1 || identity[0].databaseName !== args['database-name']
      || identity[0].databaseUser?.split('@')[0] !== args['database-user']) fail('RECOVERY_DATABASE_IDENTITY_MISMATCH')
    const options = { db, root, rootIdentity: args['root-identity'], operationId: args.operation,
      confirmation: args['confirm-operation'], expectedAssetId: args.asset, expectedActorId: args.actor, expectedKey: args.key }
    const result = args.apply ? await applyRecovery(options) : await inspectRecovery(options)
    console.log(JSON.stringify({ operationId: args.operation, state: result.state, applied: args.apply && result.applied }))
  } finally { await db.$disconnect() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(JSON.stringify({ code: safe(error) })); process.exitCode = 1 })
}
