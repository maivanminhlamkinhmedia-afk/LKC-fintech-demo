import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { canonicalizeImage } from '@/features/cms/media-codec'
import { MediaError, operationIdOrThrow } from '@/features/cms/media-contract'
import { boundedImageBody, httpMediaActor, requireUploadOrigin, safeMediaResponse } from '@/features/cms/media-http'
import { mediaDTO } from '@/features/cms/media-store'
import { openMediaRoot, readMediaOperation, withMediaLock, advanceMediaOperation, writeCanonicalFile } from '@/features/cms/media-storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ operationId: string }> }
async function status(actorId: string, operationId: string) {
  const root = await openMediaRoot(), operation = await readMediaOperation(root, operationId)
  if (operation.kind !== 'upload' || operation.actorId !== actorId) throw new MediaError('NOT_FOUND')
  const row = await prisma.mediaAsset.findUnique({ where: { id: operation.assetId } })
  if (row) {
    if (row.uploadedById !== actorId || row.filename !== operation.key || row.url !== `/api/cms/media/${operation.assetId}/content`
      || row.sizeBytes !== operation.size || !operation.digest) throw new MediaError('UNKNOWN_OUTCOME')
    return { root, operation, data: mediaDTO(row, { id: actorId, role: 'CREATOR' }) }
  }
  return { root, operation, data: null }
}
export async function GET(_request: Request, context: Context) {
  try {
    const actor = await httpMediaActor(), { operationId } = await context.params
    const result = await status(actor.id, operationIdOrThrow(operationId))
    return Response.json({ ok: true, state: result.data ? 'COMMITTED' : result.operation.stage === 'intent' ? 'PENDING'
      : result.operation.stage === 'abandoned' ? 'ABANDONED' : 'UNKNOWN_OUTCOME',
      data: result.data }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return safeMediaResponse(error) }
}
export async function POST(request: Request, context: Context) {
  try {
    const actor = await httpMediaActor()
    requireUploadOrigin(request)
    const { operationId } = await context.params
    const id = operationIdOrThrow(operationId)
    const prior = await status(actor.id, id)
    if (prior.data) return Response.json({ ok: true, data: prior.data }, { headers: { 'Cache-Control': 'private, no-store' } })
    return await withMediaLock(prior.root, 'operation', id, async () => {
      const current = await status(actor.id, id)
      if (current.data) return Response.json({ ok: true, data: current.data }, { headers: { 'Cache-Control': 'private, no-store' } })
      const operation = current.operation
      if (operation.kind !== 'upload' || operation.stage !== 'intent' || Date.now() - Date.parse(operation.startedAt) > 30 * 60_000) throw new MediaError('UNKNOWN_OUTCOME')
      if (request.headers.get('content-type') !== operation.metadata.mimeType) {
        operation.stage = 'abandoned'; await advanceMediaOperation(current.root, operation)
        throw new MediaError('UNSUPPORTED_MEDIA')
      }
      operation.stage = 'dispatched'; await advanceMediaOperation(current.root, operation)
      let image: Awaited<ReturnType<typeof canonicalizeImage>>
      try {
        const bytes = await boundedImageBody(request)
        image = await canonicalizeImage(bytes, operation.metadata.mimeType)
      } catch (error) {
        // No filesystem publication or DB dispatch has occurred yet. Keep the receipt,
        // but release quota for a known invalid input after the durable state change.
        if (error instanceof MediaError && ['FILE_TOO_LARGE', 'UNSUPPORTED_MEDIA', 'IMAGE_LIMIT_EXCEEDED'].includes(error.code)) {
          operation.stage = 'abandoned'; await advanceMediaOperation(current.root, operation)
        }
        throw error
      }
      operation.digest = createHash('sha256').update(image.bytes).digest('hex')
      operation.size = image.bytes.length; operation.width = image.width; operation.height = image.height
      operation.stage = 'canonical-ready'; await advanceMediaOperation(current.root, operation)
      const stored = await writeCanonicalFile(current.root, operation.key, image.bytes, operation.id)
      operation.stage = 'file-ready'; await advanceMediaOperation(current.root, operation)
      let row
      try {
        row = await prisma.$transaction(async tx => {
          const fresh = await tx.user.findUnique({ where: { id: actor.id }, select: { id: true, role: true, status: true } })
          if (!fresh || fresh.status !== 'ACTIVE' || fresh.role !== actor.role) throw new MediaError('FORBIDDEN')
          return tx.mediaAsset.create({ data: { id: operation.assetId, filename: operation.key,
            originalFilename: operation.metadata.originalFilename, url: `/api/cms/media/${operation.assetId}/content`,
            mimeType: image.mimeType, sizeBytes: stored.size, width: image.width, height: image.height,
            altText: operation.metadata.altText, caption: operation.metadata.caption, uploadedById: actor.id } })
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      } catch { throw new MediaError('UNKNOWN_OUTCOME') }
      operation.stage = 'committed'; await advanceMediaOperation(current.root, operation)
      return Response.json({ ok: true, data: mediaDTO(row, actor) }, { headers: { 'Cache-Control': 'private, no-store' } })
    })
  } catch (error) { return safeMediaResponse(error) }
}
