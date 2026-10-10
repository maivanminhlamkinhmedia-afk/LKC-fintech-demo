import type { ArticleStatus, ArticleType } from '@prisma/client'
import { canUpdateArticle, type CMSArticle, type CMSUser } from './access'
import { EditorDocumentError, validateEditorDocument, type ValidatedEditorDocument } from './editor-schema'

export const ARTICLE_TYPES = ['NEWS', 'MARKET_UPDATE', 'ANALYSIS', 'EDUCATION', 'RESEARCH', 'OPINION'] as const satisfies readonly ArticleType[]
export const EDITABLE_DRAFT_STATUSES = ['DRAFT', 'CHANGES_REQUESTED'] as const satisfies readonly ArticleStatus[]
export const ARTICLE_DRAFT_LIMITS = { title: 180, slug: 150, excerpt: 2000, id: 191, pageSize: 20 } as const

export function canEditArticleDraft(actor: CMSUser | null | undefined, article: CMSArticle | null | undefined): boolean {
  return canUpdateArticle(actor, article) && !!article && EDITABLE_DRAFT_STATUSES.some(status => status === article.status)
}

const MESSAGES = {
  VALIDATION_ERROR: 'Vui lòng kiểm tra dữ liệu bài viết.',
  SLUG_CONFLICT: 'Đường dẫn này đã được sử dụng. Vui lòng chọn đường dẫn khác.',
  FORBIDDEN: 'Bạn không còn quyền lưu bài viết này. Vui lòng tải lại trang.',
  NOT_FOUND: 'Không tìm thấy bài viết.',
  NOT_EDITABLE: 'Bài viết không ở trạng thái cho phép chỉnh sửa.',
  EDIT_CONFLICT: 'Bài viết đã thay đổi. Giữ bản đang nhập và tải lại để đối chiếu.',
  POLICY_UNRESOLVED: 'Quyền xem này chưa được hỗ trợ. Nội dung đang nhập vẫn được giữ lại.',
  UNSUPPORTED_DOCUMENT: 'Nội dung chưa được trình soạn thảo hỗ trợ.',
  INTERNAL_ERROR: 'Không thể lưu bài viết. Nội dung đang nhập vẫn được giữ lại.',
} as const
export type DraftErrorCode = keyof typeof MESSAGES
export type DraftField = 'title' | 'slug' | 'excerpt' | 'articleType' | 'contentJson' | 'expectedUpdatedAt' | 'audience'
export type DraftFailure = { code: DraftErrorCode; message: string; fieldErrors?: Partial<Record<DraftField, string>> }
export class ArticleDraftError extends Error {
  readonly code: DraftErrorCode
  readonly field?: DraftField
  constructor(code: DraftErrorCode, field?: DraftField) {
    super(MESSAGES[code])
    this.name = 'ArticleDraftError'
    this.code = code
    if (field !== undefined) this.field = field
  }
}

const FIELDS: readonly DraftField[] = ['title', 'slug', 'excerpt', 'articleType', 'contentJson', 'expectedUpdatedAt', 'audience']
const COMBINING_MARKS = new RegExp('\\p{M}', 'gu')
function validation(field?: DraftField): never { throw new ArticleDraftError('VALIDATION_ERROR', field) }

export function canonicalizeArticleSlug(input: unknown): string {
  if (typeof input !== 'string') return validation('slug')
  const slug = input.trim().toLowerCase().normalize('NFD').replace(COMBINING_MARKS, '')
    .replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (!slug || slug.length > ARTICLE_DRAFT_LIMITS.slug) return validation('slug')
  return slug
}

function payload(input: unknown, update: boolean): Record<string, unknown> {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return validation()
    const prototype = Object.getPrototypeOf(input)
    if (prototype !== Object.prototype && prototype !== null) return validation()
    const result: Record<string, unknown> = {}
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== 'string' || !FIELDS.includes(key as DraftField) || (!update && key === 'expectedUpdatedAt')) return validation()
      const descriptor = Object.getOwnPropertyDescriptor(input, key)
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return validation(key as DraftField)
      result[key] = descriptor.value
    }
    return result
  } catch (error) {
    const safe = mapDraftError(error)
    return validation(FIELDS.find(field => safe.fieldErrors?.[field] !== undefined))
  }
}

// W0 can persist only unconfigured or PUBLIC audience. Paid binding requires
// the authoritative C01 port in the same future writer transaction.
export type DraftAudience = { accessMode: null | 'PUBLIC'; productIds: [] }

// Persisted-state validation is separate from input validation: missing columns
// or unexpected Product edges must never turn into an unconfigured draft.
export function readStoredDraftAudience(accessMode: unknown, productCount: unknown): DraftAudience {
  if (typeof productCount !== 'number' || !Number.isSafeInteger(productCount) || productCount < 0) {
    throw new ArticleDraftError('INTERNAL_ERROR')
  }
  if (accessMode === 'PAID_PRODUCT') throw new ArticleDraftError('POLICY_UNRESOLVED', 'audience')
  if ((accessMode !== null && accessMode !== 'PUBLIC') || productCount !== 0) throw new ArticleDraftError('INTERNAL_ERROR')
  return { accessMode, productIds: [] }
}

function normalizeAudience(input: unknown): DraftAudience {
  let mode: null | 'PUBLIC' | 'PAID_PRODUCT'
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return validation('audience')
    const prototype = Object.getPrototypeOf(input)
    if (prototype !== Object.prototype && prototype !== null) return validation('audience')
    const keys = Reflect.ownKeys(input)
    if (keys.length !== 2 || !keys.includes('accessMode') || !keys.includes('productIds')) return validation('audience')
    const access = Object.getOwnPropertyDescriptor(input, 'accessMode')
    const products = Object.getOwnPropertyDescriptor(input, 'productIds')
    if (!access || !('value' in access) || !access.enumerable
      || !products || !('value' in products) || !products.enumerable) return validation('audience')
    if (access.value !== null && access.value !== 'PUBLIC' && access.value !== 'PAID_PRODUCT') return validation('audience')
    mode = access.value
    const ids: unknown = products.value
    if (!Array.isArray(ids) || Object.getPrototypeOf(ids) !== Array.prototype) return validation('audience')
    const length = Object.getOwnPropertyDescriptor(ids, 'length')
    if (!length || !('value' in length) || !Number.isSafeInteger(length.value) || length.value < 0) return validation('audience')
    const idKeys = Reflect.ownKeys(ids)
    if (idKeys.length !== length.value + 1 || !idKeys.includes('length')) return validation('audience')
    const seen = new Set<string>()
    for (let index = 0; index < length.value; index++) {
      const id = Object.getOwnPropertyDescriptor(ids, String(index))
      if (!id || !('value' in id) || !id.enumerable || typeof id.value !== 'string'
        || !/^[a-zA-Z0-9_-]{1,191}$/.test(id.value) || seen.has(id.value)) return validation('audience')
      seen.add(id.value)
    }
    if (mode !== 'PAID_PRODUCT' && length.value !== 0) return validation('audience')
  } catch {
    // Do not propagate proxy trap errors, invoke accessors, or serialize input.
    return validation('audience')
  }
  if (mode === 'PAID_PRODUCT') throw new ArticleDraftError('POLICY_UNRESOLVED', 'audience')
  return { accessMode: mode, productIds: [] }
}

export type NormalizedDraftData = ValidatedEditorDocument & {
  title: string
  slug: string
  excerpt: string
  articleType: ArticleType
  audience?: DraftAudience
}

function normalize(input: Record<string, unknown>): NormalizedDraftData {
  if (typeof input.title !== 'string') return validation('title')
  const title = input.title.trim()
  if (!title || Array.from(title).length > ARTICLE_DRAFT_LIMITS.title) return validation('title')
  if (typeof input.excerpt !== 'string') return validation('excerpt')
  const excerpt = input.excerpt.trim()
  if (Array.from(excerpt).length > ARTICLE_DRAFT_LIMITS.excerpt) return validation('excerpt')
  if (!ARTICLE_TYPES.some(type => type === input.articleType)) return validation('articleType')
  return {
    title,
    slug: canonicalizeArticleSlug(input.slug),
    excerpt,
    articleType: input.articleType as ArticleType,
    ...validateEditorDocument(input.contentJson),
    ...(Object.prototype.hasOwnProperty.call(input, 'audience') ? { audience: normalizeAudience(input.audience) } : {}),
  }
}

export function normalizeCreateDraftInput(input: unknown): NormalizedDraftData & { audience: DraftAudience } {
  const data = normalize(payload(input, false))
  return { ...data, audience: data.audience ?? { accessMode: null, productIds: [] } }
}

export function parseExpectedUpdatedAt(input: unknown): Date {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input)) return validation('expectedUpdatedAt')
  const date = new Date(input)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== input) return validation('expectedUpdatedAt')
  return date
}

export function normalizeUpdateDraftInput(input: unknown): { data: NormalizedDraftData; expectedUpdatedAt: Date } {
  const values = payload(input, true)
  return { data: normalize(values), expectedUpdatedAt: parseExpectedUpdatedAt(values.expectedUpdatedAt) }
}

export function parseArticleId(input: unknown): string {
  if (typeof input !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(input) || input.length > ARTICLE_DRAFT_LIMITS.id) {
    throw new ArticleDraftError('NOT_FOUND')
  }
  return input
}

export function parseArticlePage(input: unknown): number {
  if (input === undefined) return 1
  if (typeof input !== 'string' || !/^[1-9]\d*$/.test(input)) return 1
  const page = Number(input)
  return Number.isSafeInteger(page) && Number.isSafeInteger((page - 1) * ARTICLE_DRAFT_LIMITS.pageSize) ? page : 1
}

export function nextArticleUpdatedAt(previous: Date, nowMilliseconds = Date.now()): Date {
  const timestamp = Math.max(nowMilliseconds, previous.getTime() + 1)
  if (!Number.isSafeInteger(timestamp) || !Number.isFinite(new Date(timestamp).getTime())) throw new ArticleDraftError('INTERNAL_ERROR')
  return new Date(timestamp)
}

function ownValue(input: unknown, key: string): unknown {
  if (!input || typeof input !== 'object') return undefined
  const descriptor = Object.getOwnPropertyDescriptor(input, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}

export function mapDraftError(error: unknown): DraftFailure {
  try {
    const code = ownValue(error, 'code')
    if (error instanceof EditorDocumentError) {
      const safeCode = code === 'UNSUPPORTED_DOCUMENT' ? code : 'VALIDATION_ERROR'
      return { code: safeCode, message: MESSAGES[safeCode], fieldErrors: { contentJson: MESSAGES[safeCode] } }
    }
    if (error instanceof ArticleDraftError && typeof code === 'string' && Object.prototype.hasOwnProperty.call(MESSAGES, code)) {
      const safeCode = code as DraftErrorCode
      const field = ownValue(error, 'field')
      return { code: safeCode, message: MESSAGES[safeCode], ...(FIELDS.some(key => key === field) ? { fieldErrors: { [field as DraftField]: MESSAGES[safeCode] } } : {}) }
    }
    const meta = ownValue(error, 'meta')
    const cause = ownValue(ownValue(meta, 'driverAdapterError'), 'cause')
    if (code === 'P2002') {
      const model = ownValue(meta, 'modelName')
      const target = ownValue(meta, 'target')
      const index = ownValue(ownValue(cause, 'constraint'), 'index')
      const targets = Array.isArray(target) ? target : [target]
      if ((model === undefined || model === 'Article')
        && (targets.some(value => value === 'slug' || value === 'Article_slug_key') || index === 'Article_slug_key')) {
        return { code: 'SLUG_CONFLICT', message: MESSAGES.SLUG_CONFLICT, fieldErrors: { slug: MESSAGES.SLUG_CONFLICT } }
      }
    }
    if (code === 'P2034' || (code === 'P2010' && ownValue(cause, 'kind') === 'TransactionWriteConflict')) {
      return { code: 'EDIT_CONFLICT', message: MESSAGES.EDIT_CONFLICT }
    }
  } catch { /* Never serialize unknown errors or execute error accessors. */ }
  return { code: 'INTERNAL_ERROR', message: MESSAGES.INTERNAL_ERROR }
}
