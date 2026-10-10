import type {
  ArticleVersionMediaCaptureError, ArticleVersionMediaCaptureResult,
  ArticleVersionMediaCoverEdge,
} from './article-version-media-capture-contract'

const ID = /^[A-Za-z0-9_-]{1,191}$/u

class CaptureFault extends Error {
  readonly code: ArticleVersionMediaCaptureError
  constructor(code: ArticleVersionMediaCaptureError) { super(code); this.code = code }
}

function fault(code: ArticleVersionMediaCaptureError): never { throw new CaptureFault(code) }

function record(input: unknown, code: ArticleVersionMediaCaptureError): object {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fault(code)
  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) return fault(code)
  return input
}

function field(input: unknown, key: string, code: ArticleVersionMediaCaptureError): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record(input, code), key)
  if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return fault(code)
  return descriptor.value
}

function optionalField(input: unknown, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record(input, 'INVALID_CAPTURE_INPUT'), key)
  if (!descriptor) return undefined
  if (!descriptor.enumerable || !('value' in descriptor)) return fault('INVALID_CAPTURE_INPUT')
  return descriptor.value
}

function id(input: unknown, code: ArticleVersionMediaCaptureError): string {
  if (typeof input !== 'string' || !ID.test(input)) return fault(code)
  return input
}

function metadata(input: unknown): string | null {
  // The existing snapshot reader accepts null or nonblank captured strings.
  if (input !== null && (typeof input !== 'string' || !input.trim())) return fault('MEDIA_EVIDENCE_INVALID')
  return input
}

const EMPTY_PLAN = Object.freeze({ edges: Object.freeze([]) })

// The supplied Article must already be persisted and the evidence must have
// been validated by a server caller. This pure projection cannot establish
// either fact, authorize an actor, lock an asset or write ArticleVersionMedia.
export function planArticleVersionMediaCapture(input: unknown): ArticleVersionMediaCaptureResult {
  try {
    const article = field(input, 'article', 'INVALID_CAPTURE_INPUT')
    const version = field(input, 'version', 'INVALID_CAPTURE_INPUT')
    const articleId = id(field(article, 'id', 'INVALID_CAPTURE_INPUT'), 'INVALID_CAPTURE_INPUT')
    const coverMediaId = field(article, 'coverMediaId', 'INVALID_CAPTURE_INPUT')
    if (coverMediaId !== null) id(coverMediaId, 'INVALID_CAPTURE_INPUT')
    const versionId = id(field(version, 'id', 'INVALID_CAPTURE_INPUT'), 'INVALID_CAPTURE_INPUT')
    const versionArticleId = id(field(version, 'articleId', 'INVALID_CAPTURE_INPUT'), 'INVALID_CAPTURE_INPUT')
    if (versionArticleId !== articleId) return { ok: false, error: 'VERSION_MISMATCH' }

    const evidence = optionalField(input, 'evidence')
    if (coverMediaId === null) {
      if (evidence !== undefined && evidence !== null) return { ok: false, error: 'MEDIA_EVIDENCE_INVALID' }
      return { ok: true, data: EMPTY_PLAN }
    }
    if (evidence === undefined || evidence === null) return { ok: false, error: 'MEDIA_EVIDENCE_REQUIRED' }

    const assetId = id(field(evidence, 'assetId', 'MEDIA_EVIDENCE_INVALID'), 'MEDIA_EVIDENCE_INVALID')
    const context = field(evidence, 'context', 'MEDIA_EVIDENCE_INVALID')
    if (context !== 'COVER') return { ok: false, error: 'UNSUPPORTED_MEDIA_CONTEXT' }
    if (assetId !== coverMediaId) return { ok: false, error: 'MEDIA_EVIDENCE_INVALID' }
    const altTextAtCapture = metadata(field(evidence, 'altText', 'MEDIA_EVIDENCE_INVALID'))
    const captionAtCapture = metadata(field(evidence, 'caption', 'MEDIA_EVIDENCE_INVALID'))
    const edge: ArticleVersionMediaCoverEdge = Object.freeze({
      articleId, versionId, assetId, context: 'COVER', altTextAtCapture, captionAtCapture,
    })
    return { ok: true, data: Object.freeze({ edges: Object.freeze([edge]) }) }
  } catch (error) {
    // A proxy trap can throw another hostile proxy; even instanceof may throw.
    try {
      if (error instanceof CaptureFault) return { ok: false, error: error.code }
    } catch { /* Never inspect or expose an untrusted thrown value further. */ }
    return { ok: false, error: 'INVALID_CAPTURE_INPUT' }
  }
}
