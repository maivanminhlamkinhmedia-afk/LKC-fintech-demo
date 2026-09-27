import type { ArticleStatus, SourceType } from '@prisma/client'

export const SOURCE_TYPES = ['WEBSITE', 'REPORT', 'EXCHANGE', 'REGULATOR', 'COMPANY', 'DATA_PROVIDER', 'INTERNAL', 'OTHER'] as const satisfies readonly SourceType[]
export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  WEBSITE: 'Trang web', REPORT: 'Báo cáo', EXCHANGE: 'Sở giao dịch', REGULATOR: 'Cơ quan quản lý',
  COMPANY: 'Doanh nghiệp', DATA_PROVIDER: 'Nhà cung cấp dữ liệu', INTERNAL: 'Nội bộ', OTHER: 'Khác',
}
export const SOURCE_LIMITS = { title: 180, publisher: 180, note: 4000, url: 2048, perArticle: 100, id: 191 } as const
export type SourceMetadata = {
  sourceType: SourceType; title: string; publisher: string | null; url: string | null
  publishedAt: string | null; accessedAt: string | null; dataTimestamp: string | null; note: string | null
}
export type SourceField = keyof SourceMetadata | 'expectedUpdatedAt'
const MESSAGES = {
  VALIDATION_ERROR: 'Vui lòng kiểm tra dữ liệu nguồn tham khảo.',
  SOURCE_LIMIT_REACHED: 'Bài viết đã có tối đa 100 nguồn tham khảo.',
  FORBIDDEN: 'Bạn không còn quyền quản lý nguồn của bài viết này.',
  NOT_FOUND: 'Không tìm thấy bài viết hoặc nguồn tham khảo.',
  NOT_EDITABLE: 'Bài viết không ở trạng thái cho phép chỉnh sửa nguồn.',
  UNSUPPORTED_DOCUMENT: 'Nội dung bài viết chưa được trình soạn thảo hỗ trợ.',
  EDIT_CONFLICT: 'Bài viết hoặc nguồn đã thay đổi. Giữ nội dung đang nhập và tải lại để đối chiếu.',
  INTERNAL_ERROR: 'Chưa xác nhận được kết quả lưu. Tải lại để kiểm tra trước khi thực hiện lại.',
} as const
export type SourceFailureCode = keyof typeof MESSAGES
export type SourceFailure = { code: SourceFailureCode; message: string; fieldErrors?: Partial<Record<SourceField, string>> }
export type SourceItem = SourceMetadata & { id: string; createdById: string; createdAt: string; updatedAt: string; safeUrl: string | null }
export type ArticleSourcesSnapshot = {
  id: string; title: string; status: ArticleStatus; updatedAt: string; canMutate: boolean
  readOnlyReason: SourceFailureCode | null; sources: SourceItem[]
}
export type SourceActionResult = { ok: true; data: ArticleSourcesSnapshot; warning?: string } | { ok: false; error: SourceFailure }
export class ArticleSourceError extends Error {
  readonly code: SourceFailureCode
  readonly field?: SourceField
  constructor(code: SourceFailureCode, field?: SourceField) {
    super(MESSAGES[code]); this.name = 'ArticleSourceError'; this.code = code
    if (field !== undefined) this.field = field
  }
}
const FIELDS: readonly SourceField[] = ['sourceType', 'title', 'publisher', 'url', 'publishedAt', 'accessedAt', 'dataTimestamp', 'note', 'expectedUpdatedAt']
function invalid(field?: SourceField): never { throw new ArticleSourceError('VALIDATION_ERROR', field) }
function own(input: unknown, key: string): unknown {
  if (!input || typeof input !== 'object') return undefined
  const descriptor = Object.getOwnPropertyDescriptor(input, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}
export function mapSourceError(error: unknown): SourceFailure {
  try {
    const code = own(error, 'code')
    if (error instanceof ArticleSourceError && typeof code === 'string' && Object.hasOwn(MESSAGES, code)) {
      const safe = code as SourceFailureCode, field = own(error, 'field')
      return { code: safe, message: MESSAGES[safe], ...(FIELDS.some(key => key === field)
        ? { fieldErrors: { [field as SourceField]: MESSAGES[safe] } } : {}) }
    }
    const cause = own(own(own(error, 'meta'), 'driverAdapterError'), 'cause')
    if (code === 'P2034' || (code === 'P2010' && own(cause, 'kind') === 'TransactionWriteConflict')) {
      return { code: 'EDIT_CONFLICT', message: MESSAGES.EDIT_CONFLICT }
    }
  } catch { /* Never execute error getters/toJSON or expose raw diagnostics. */ }
  return { code: 'INTERNAL_ERROR', message: MESSAGES.INTERNAL_ERROR }
}
function payload(input: unknown, fields: readonly SourceField[]): Record<string, unknown> {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid()
    const prototype = Object.getPrototypeOf(input)
    if (prototype !== Object.prototype && prototype !== null) return invalid()
    const result: Record<string, unknown> = {}
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== 'string' || !fields.includes(key as SourceField)) return invalid()
      const descriptor = Object.getOwnPropertyDescriptor(input, key)
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable || descriptor.value === undefined) return invalid(key as SourceField)
      result[key] = descriptor.value
    }
    return result
  } catch (error) { if (error instanceof ArticleSourceError) throw error; return invalid() }
}
export function parseSourceId(input: unknown): string {
  if (typeof input !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(input) || input.length > SOURCE_LIMITS.id) throw new ArticleSourceError('NOT_FOUND')
  return input
}
function text(input: unknown, field: 'title' | 'publisher' | 'note', required = false): string | null {
  if (input === null && !required) return null
  if (typeof input !== 'string') return invalid(field)
  const value = input.trim()
  if (Array.from(value).length > SOURCE_LIMITS[field] || (required && !value)) return invalid(field)
  return value || null
}
export function normalizeSourceUrl(input: unknown): string | null {
  if (input === null) return null
  if (typeof input !== 'string') return invalid('url')
  // Trim ordinary surrounding whitespace, but never hide raw control bytes.
  if (/[\u0000-\u001f\u007f-\u009f\\]/u.test(input)) return invalid('url')
  const value = input.trim()
  if (!value) return null
  if (!/^https?:\/\/[^/?#]/i.test(value) || /\s/u.test(value)) return invalid('url')
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password
      || /^https?:\/\/[^/?#]*@/i.test(value) || parsed.href.length > SOURCE_LIMITS.url) return invalid('url')
    return parsed.href
  } catch { return invalid('url') }
}
export function safeSourceUrl(input: unknown): string | null {
  try { return normalizeSourceUrl(input) } catch { return null }
}
export function parseSourceTimestamp(input: unknown, field: SourceField = 'expectedUpdatedAt'): Date {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input)) return invalid(field)
  const value = new Date(input)
  if (!Number.isFinite(value.getTime()) || value.toISOString() !== input || value.getUTCFullYear() < 1000 || value.getUTCFullYear() > 9999) return invalid(field)
  return value
}
const OFFSET = 7 * 60 * 60 * 1000
const pad = (value: number, width = 2) => String(value).padStart(width, '0')
function localParts(value: Date) {
  return `${pad(value.getUTCFullYear(), 4)}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}T${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}.${pad(value.getUTCMilliseconds(), 3)}`
}
export function sourceDateToLocal(input: string | null): string {
  return input === null ? '' : localParts(new Date(parseSourceTimestamp(input).getTime() + OFFSET))
}
export function sourceDateFromLocal(input: string): string | null {
  if (input === '') return null
  if (typeof input !== 'string') return invalid()
  const match = /^(\d{4}|10000)-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(input)
  if (!match) return invalid()
  const [, year, month, day, hour, minute, second = '00', ms = '000'] = match
  const canonical = `${year}-${month}-${day}T${hour}:${minute}:${second}.${ms.padEnd(3, '0')}`
  const local = new Date(0)
  local.setUTCFullYear(Number(year), Number(month) - 1, Number(day))
  local.setUTCHours(Number(hour), Number(minute), Number(second), Number(ms.padEnd(3, '0')))
  if (localParts(local) !== canonical) return invalid()
  const utc = new Date(local.getTime() - OFFSET).toISOString()
  parseSourceTimestamp(utc)
  return utc
}
function optionalDate(input: unknown, field: 'publishedAt' | 'accessedAt' | 'dataTimestamp'): string | null {
  if (input === null || input === '') return null
  return parseSourceTimestamp(input, field).toISOString()
}
export function normalizeSourceInput(input: unknown): { data: SourceMetadata; expectedUpdatedAt: Date } {
  const values = payload(input, FIELDS)
  if (!SOURCE_TYPES.some(type => type === values.sourceType)) return invalid('sourceType')
  return { expectedUpdatedAt: parseSourceTimestamp(values.expectedUpdatedAt), data: {
    sourceType: values.sourceType as SourceType,
    title: text(values.title, 'title', true)!,
    publisher: text(values.publisher ?? null, 'publisher'),
    url: normalizeSourceUrl(values.url ?? null),
    publishedAt: optionalDate(values.publishedAt ?? null, 'publishedAt'),
    accessedAt: optionalDate(values.accessedAt ?? null, 'accessedAt'),
    dataTimestamp: optionalDate(values.dataTimestamp ?? null, 'dataTimestamp'),
    note: text(values.note ?? null, 'note'),
  } }
}
export function normalizeSourceDeleteInput(input: unknown): { expectedUpdatedAt: Date } {
  const values = payload(input, ['expectedUpdatedAt'])
  return { expectedUpdatedAt: parseSourceTimestamp(values.expectedUpdatedAt) }
}
