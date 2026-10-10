// CMS-011.2-M0 shapes only. A future server caller must load the persisted
// Article and authoritatively validate MediaAsset/receipt before supplying them.
// Structural typing here is not proof of authorization or storage integrity.
export type PersistedArticleCoverReference = Readonly<{
  id: string
  coverMediaId: string | null
}>

export type ArticleVersionReference = Readonly<{
  id: string
  articleId: string
}>

export type SuppliedValidatedCoverEvidence = Readonly<{
  assetId: string
  context: 'COVER'
  altText: string | null
  caption: string | null
}>

export type ArticleVersionMediaCaptureInput = Readonly<{
  article: PersistedArticleCoverReference
  version: ArticleVersionReference
  evidence?: SuppliedValidatedCoverEvidence | null
}>

export type ArticleVersionMediaCoverEdge = Readonly<{
  articleId: string
  versionId: string
  assetId: string
  context: 'COVER'
  altTextAtCapture: string | null
  captionAtCapture: string | null
}>

export type ArticleVersionMediaCapturePlan = Readonly<{
  edges: readonly ArticleVersionMediaCoverEdge[]
}>

export type ArticleVersionMediaCaptureError =
  | 'INVALID_CAPTURE_INPUT'
  | 'VERSION_MISMATCH'
  | 'MEDIA_EVIDENCE_REQUIRED'
  | 'MEDIA_EVIDENCE_INVALID'
  | 'UNSUPPORTED_MEDIA_CONTEXT'

export type ArticleVersionMediaCaptureResult =
  | Readonly<{ ok: true; data: ArticleVersionMediaCapturePlan }>
  | Readonly<{ ok: false; error: ArticleVersionMediaCaptureError }>
