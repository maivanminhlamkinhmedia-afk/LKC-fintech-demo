import 'server-only'
import { resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
import { MediaError, MEDIA_LIMITS } from './media-contract'

// The standalone server chdirs to its bundle root before handling requests.
// A module-level require.resolve becomes a numeric Turbopack module ID here.
const workerFile = resolve(process.cwd(), 'src', 'features', 'cms', 'media-codec-worker.cjs')
let active = false
export type CanonicalImage = { bytes: Buffer; width: number; height: number; mimeType: 'image/png' | 'image/jpeg' }
export async function runImageWorker(bytes: Buffer, mimeType: 'image/png' | 'image/jpeg', file: string,
  deadlineMilliseconds = 15_000): Promise<CanonicalImage> {
  if (!bytes.length || bytes.length > MEDIA_LIMITS.bytes) throw new MediaError('FILE_TOO_LARGE')
  if (!Number.isInteger(deadlineMilliseconds) || deadlineMilliseconds < 1 || deadlineMilliseconds > 15_000) throw new MediaError('INTERNAL_ERROR')
  if (active) throw new MediaError('MEDIA_BUSY')
  active = true
  let worker: Worker | null = null
  try {
    worker = new Worker(file, { resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 } })
    const runningWorker = worker
    return await new Promise<CanonicalImage>((resolve, reject) => {
      let done = false
      const finish = (error?: MediaError, image?: CanonicalImage) => {
        if (done) return
        done = true; clearTimeout(timer)
        if (error) reject(error); else resolve(image!)
      }
      const timer = setTimeout(() => finish(new MediaError('MEDIA_BUSY')), deadlineMilliseconds)
      runningWorker.once('message', message => {
        if (!message || message.ok !== true) return finish(new MediaError(message?.code === 'FILE_TOO_LARGE' || message?.code === 'IMAGE_LIMIT_EXCEEDED' ? message.code : 'UNSUPPORTED_MEDIA'))
        const data = message.data
        if (!data || !Number.isInteger(data.width) || !Number.isInteger(data.height)) return finish(new MediaError('UNSUPPORTED_MEDIA'))
        finish(undefined, { bytes: Buffer.from(data.bytes), width: data.width, height: data.height, mimeType: data.mimeType })
      })
      runningWorker.once('error', () => finish(new MediaError('UNSUPPORTED_MEDIA')))
      runningWorker.once('exit', () => finish(new MediaError('UNSUPPORTED_MEDIA')))
      runningWorker.postMessage({ bytes, mimeType })
    })
  } finally { if (worker) await worker.terminate(); active = false }
}
export async function canonicalizeImage(bytes: Buffer, mimeType: 'image/png' | 'image/jpeg'): Promise<CanonicalImage> {
  return runImageWorker(bytes, mimeType, workerFile)
}
