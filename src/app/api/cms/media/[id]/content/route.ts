import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { MediaError } from '@/features/cms/media-contract'
import { httpMediaActor, safeMediaResponse } from '@/features/cms/media-http'
import { managedAsset, readableMedia } from '@/features/cms/media-store'
import { openMediaRoot, readCanonicalFile, receiptForAsset } from '@/features/cms/media-storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }
async function content(context: Context, head: boolean) {
  try {
    const actor = await httpMediaActor()
    const { id } = await context.params
    const row = await prisma.$transaction(tx => readableMedia(tx, actor, id), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    if (!managedAsset(row)) throw new MediaError('MEDIA_NOT_AVAILABLE')
    const root = await openMediaRoot()
    const receipt = await receiptForAsset(root, row.id, row.filename, ['file-ready', 'committed'])
    if (receipt.size !== row.sizeBytes) throw new MediaError('MEDIA_NOT_AVAILABLE')
    const bytes = await readCanonicalFile(root, row.filename, receipt.size!, receipt.digest!)
    const headers = { 'Content-Type': row.mimeType, 'Content-Length': String(bytes.length), 'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store', 'Content-Security-Policy': "sandbox; default-src 'none'",
      'Content-Disposition': `inline; filename="${row.filename}"` }
    return new Response(head ? null : new Uint8Array(bytes), { status: 200, headers })
  } catch (error) { return safeMediaResponse(error) }
}
export async function GET(_request: Request, context: Context) { return content(context, false) }
export async function HEAD(_request: Request, context: Context) { return content(context, true) }
