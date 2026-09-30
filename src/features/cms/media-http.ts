import 'server-only'
import { getServerSession } from 'next-auth'
import { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessCms } from './access'
import { MEDIA_LIMITS, MediaError, mediaFailure } from './media-contract'
import { freshMediaActor } from './media-store'

export async function httpMediaActor() {
  const session = await getServerSession(authOptions)
  if (!canAccessCms(session?.user)) throw new MediaError('FORBIDDEN')
  return prisma.$transaction(tx => freshMediaActor(tx, session.user), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}
export function safeMediaResponse(error: unknown) {
  const failure = mediaFailure(error)
  const code = failure.code
  const status = code === 'FORBIDDEN' ? 403 : code === 'NOT_FOUND' || code === 'MEDIA_NOT_AVAILABLE' ? 404
    : code === 'FILE_TOO_LARGE' ? 413 : code === 'UNSUPPORTED_MEDIA' || code === 'VALIDATION_ERROR' || code === 'IMAGE_LIMIT_EXCEEDED' ? 400
      : code === 'MEDIA_BUSY' || code === 'EDIT_CONFLICT' || code === 'MEDIA_CONFLICT' || code === 'MEDIA_IN_USE' ? 409
        : code === 'MEDIA_STORAGE_UNAVAILABLE' ? 503 : 500
  return Response.json({ ok: false, error: failure }, { status, headers: { 'Cache-Control': 'private, no-store' } })
}
export function requireUploadOrigin(request: Request) {
  try {
    const configured = process.env.NEXTAUTH_URL
    if (!configured) throw new Error('missing')
    const canonical = new URL(configured)
    if (!['https:', 'http:'].includes(canonical.protocol) || canonical.username || canonical.password || canonical.search || canonical.hash
      || canonical.pathname !== '/') throw new Error('canonical')
    const origin = request.headers.get('origin')
    if (!origin || origin !== canonical.origin) throw new Error('mismatch')
  } catch { throw new MediaError('FORBIDDEN') }
}
export async function boundedImageBody(request: Request) {
  const length = request.headers.get('content-length')
  if (length !== null && (!/^(0|[1-9]\d*)$/u.test(length) || Number(length) < 1 || Number(length) > MEDIA_LIMITS.bytes)) throw new MediaError('FILE_TOO_LARGE')
  if (!request.body) throw new MediaError('FILE_TOO_LARGE')
  const reader = request.body.getReader(), chunks: Uint8Array[] = []
  let count = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      count += value.byteLength
      if (count > MEDIA_LIMITS.bytes) { await reader.cancel(); throw new MediaError('FILE_TOO_LARGE') }
      chunks.push(value)
    }
  } catch (error) { try { await reader.cancel() } catch { /* Stream already closed. */ }
    if (error instanceof MediaError) throw error
    throw new MediaError('UNKNOWN_OUTCOME')
  } finally { reader.releaseLock() }
  if (!count || length !== null && Number(length) !== count) throw new MediaError('FILE_TOO_LARGE')
  return Buffer.concat(chunks, count)
}
