export const MEDIA_LIMITS = {
  bytes: 5 * 1024 * 1024, dimension: 4096, pixels: 4_194_304,
  filename: 180, alt: 300, caption: 2000, search: 100,
  pageSize: 20, maxPage: 10_000, pendingPerActor: 4,
  intentMilliseconds: 30 * 60_000,
} as const

const messages = {
  VALIDATION_ERROR: 'Vui lòng kiểm tra tên ảnh, mô tả và dữ liệu đã nhập.',
  UNSUPPORTED_MEDIA: 'Chỉ hỗ trợ ảnh PNG hoặc JPEG hợp lệ.',
  FILE_TOO_LARGE: 'Ảnh phải lớn hơn 0 và không quá 5 MiB.',
  IMAGE_LIMIT_EXCEEDED: 'Kích thước ảnh vượt giới hạn cho phép.',
  MEDIA_BUSY: 'Ảnh đang được xử lý. Vui lòng thử lại sau.',
  MEDIA_STORAGE_UNAVAILABLE: 'Kho ảnh hiện không khả dụng.',
  MEDIA_NOT_AVAILABLE: 'Ảnh không khả dụng hoặc không thuộc phạm vi của bạn.',
  MEDIA_IN_USE: 'Ảnh đang được dùng làm ảnh bìa và không thể xóa.',
  MEDIA_CONFLICT: 'Ảnh đã thay đổi. Giữ dữ liệu đang nhập và tải lại để đối chiếu.',
  EDIT_CONFLICT: 'Bài viết đã thay đổi. Giữ lựa chọn đang nhập và tải lại để đối chiếu.',
  FORBIDDEN: 'Bạn không còn quyền thực hiện thao tác này.',
  NOT_FOUND: 'Không tìm thấy dữ liệu trong phạm vi của bạn.',
  NOT_EDITABLE: 'Bài viết không ở trạng thái cho phép chỉnh sửa.',
  UNSUPPORTED_DOCUMENT: 'Nội dung bài viết chưa được trình soạn thảo hỗ trợ.',
  UNKNOWN_OUTCOME: 'Chưa xác nhận được kết quả. Kiểm tra trạng thái trước khi thử lại.',
  STORAGE_CLEANUP_PENDING: 'Dữ liệu đã xóa; việc dọn tệp còn chờ xác minh.',
  INTERNAL_ERROR: 'Chưa xác nhận được kết quả. Giữ dữ liệu và tải lại để kiểm tra.',
} as const
export type MediaCode = keyof typeof messages
export type MediaField = 'originalFilename' | 'altText' | 'caption' | 'mimeType' | 'expectedUpdatedAt' | 'mediaId' | 'expectedMediaUpdatedAt'
export type MediaFailure = { code: MediaCode; message: string; fieldErrors?: Partial<Record<MediaField, string>> }
export class MediaError extends Error {
  readonly code: MediaCode
  readonly field?: MediaField
  constructor(code: MediaCode, field?: MediaField) { super(messages[code]); this.name = 'MediaError'; this.code = code; this.field = field }
}
export function mediaFailure(error: unknown): MediaFailure {
  try {
    if (error instanceof MediaError && Object.hasOwn(messages, error.code)) return {
      code: error.code, message: messages[error.code], ...(error.field ? { fieldErrors: { [error.field]: messages[error.code] } } : {}),
    }
    const code = error && typeof error === 'object' && Object.getOwnPropertyDescriptor(error, 'code')?.value
    if (code === 'P2034') return { code: 'MEDIA_CONFLICT', message: messages.MEDIA_CONFLICT }
  } catch { /* Hostile errors must never reach a client. */ }
  return { code: 'INTERNAL_ERROR', message: messages.INTERNAL_ERROR }
}
function invalid(field?: MediaField): never { throw new MediaError('VALIDATION_ERROR', field) }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return invalid()
    const found = Reflect.ownKeys(value)
    if (found.length !== keys.length) return invalid()
    const data: Record<string, unknown> = Object.create(null)
    for (const key of found) {
      if (typeof key !== 'string' || !keys.includes(key)) return invalid()
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || descriptor.value === undefined) return invalid(key as MediaField)
      data[key] = descriptor.value
    }
    return data
  } catch (error) { if (error instanceof MediaError) throw error; return invalid() }
}
function text(value: unknown, max: number, field: MediaField, required: boolean): string | null {
  if (value === null && !required) return null
  if (typeof value !== 'string') return invalid(field)
  const normalized = value.normalize('NFC').trim()
  if ((required && !normalized) || Array.from(normalized).length > max || /[\u0000-\u001f\u007f]/u.test(normalized)) return invalid(field)
  return normalized || null
}
export type MediaMetadata = { originalFilename: string; altText: string; caption: string | null; mimeType: 'image/png' | 'image/jpeg' }
export function normalizeUploadDescriptor(value: unknown): MediaMetadata {
  const data = record(value, ['originalFilename', 'altText', 'caption', 'mimeType'])
  const originalFilename = text(data.originalFilename, MEDIA_LIMITS.filename, 'originalFilename', true)!
  if (/[\\/:]/u.test(originalFilename) || !/\.(png|jpe?g)$/iu.test(originalFilename)
    || originalFilename === '.' || originalFilename === '..') return invalid('originalFilename')
  const mimeType = data.mimeType
  if (mimeType !== 'image/png' && mimeType !== 'image/jpeg') return invalid('mimeType')
  if ((mimeType === 'image/png') !== /\.png$/iu.test(originalFilename)) return invalid('mimeType')
  return { originalFilename, altText: text(data.altText, MEDIA_LIMITS.alt, 'altText', true)!,
    caption: text(data.caption, MEDIA_LIMITS.caption, 'caption', false), mimeType }
}
export function normalizeMetadataEdit(value: unknown) {
  const data = record(value, ['altText', 'caption', 'expectedUpdatedAt'])
  return { altText: text(data.altText, MEDIA_LIMITS.alt, 'altText', true)!,
    caption: text(data.caption, MEDIA_LIMITS.caption, 'caption', false), expectedUpdatedAt: mediaToken(data.expectedUpdatedAt) }
}
export function normalizeDelete(value: unknown) {
  const data = record(value, ['expectedUpdatedAt'])
  return { expectedUpdatedAt: mediaToken(data.expectedUpdatedAt) }
}
export function normalizeCover(value: unknown) {
  const data = record(value, ['mediaId', 'expectedUpdatedAt', 'expectedMediaUpdatedAt'])
  const mediaId = data.mediaId === null ? null : mediaIdOrThrow(data.mediaId)
  const expectedMediaUpdatedAt = data.expectedMediaUpdatedAt === null ? null : mediaToken(data.expectedMediaUpdatedAt, 'expectedMediaUpdatedAt')
  if ((mediaId === null) !== (expectedMediaUpdatedAt === null)) return invalid('expectedMediaUpdatedAt')
  return { mediaId, expectedUpdatedAt: mediaToken(data.expectedUpdatedAt), expectedMediaUpdatedAt }
}
export function mediaIdOrThrow(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,191}$/u.test(value)) throw new MediaError('NOT_FOUND')
  return value
}
export function operationIdOrThrow(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/u.test(value)) throw new MediaError('NOT_FOUND')
  return value
}
export function mediaToken(value: unknown, field: MediaField = 'expectedUpdatedAt'): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return invalid(field)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value || date.getUTCFullYear() < 1000 || date.getUTCFullYear() > 9999) return invalid(field)
  return date
}
export function mediaSearch(value: unknown): { q: string; page: number } {
  const data = record(value, ['q', 'page'])
  if (typeof data.q !== 'string') return invalid()
  const q = data.q.normalize('NFC').trim()
  if (Array.from(q).length > MEDIA_LIMITS.search || /[\u0000-\u001f\u007f]/u.test(q)
    || !Number.isInteger(data.page) || (data.page as number) < 1 || (data.page as number) > MEDIA_LIMITS.maxPage) return invalid()
  return { q, page: data.page as number }
}
export function nextMediaUpdatedAt(previous: Date, now = Date.now()) {
  const value = Math.max(now, previous.getTime() + 1)
  if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) throw new MediaError('INTERNAL_ERROR')
  return new Date(value)
}
