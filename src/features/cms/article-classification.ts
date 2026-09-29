import type { ArticleStatus } from '@prisma/client'
import type { TaxonomyKind, TaxonomyOption } from './taxonomy'

export const CLASSIFICATION_LIMITS = { topicIds: 5, tagIds: 10, instrumentIds: 10 } as const
export type ClassificationSelection = {
  categoryId: string | null; topicIds: string[]; tagIds: string[]; instrumentIds: string[]; primaryInstrumentId: string | null
}
export type ClassificationField = keyof ClassificationSelection | 'expectedUpdatedAt'
const FIELDS: readonly ClassificationField[] = ['categoryId', 'topicIds', 'tagIds', 'instrumentIds', 'primaryInstrumentId', 'expectedUpdatedAt']
const MESSAGES = {
  VALIDATION_ERROR: 'Vui lòng kiểm tra lựa chọn phân loại và giới hạn số lượng.',
  INVALID_SELECTION: 'Một lựa chọn không còn khả dụng. Giữ bản đang chọn và kiểm tra lại danh mục.',
  FORBIDDEN: 'Bạn không còn quyền quản lý phân loại của bài viết này.',
  NOT_FOUND: 'Không tìm thấy bài viết.',
  NOT_EDITABLE: 'Bài viết không ở trạng thái cho phép chỉnh sửa phân loại.',
  UNSUPPORTED_DOCUMENT: 'Nội dung bài viết chưa được trình soạn thảo hỗ trợ.',
  EDIT_CONFLICT: 'Bài viết đã thay đổi. Giữ lựa chọn đang nhập và tải lại để đối chiếu.',
  INTERNAL_ERROR: 'Chưa xác nhận được kết quả lưu. Tải lại để kiểm tra trước khi thực hiện lại.',
} as const
export type ClassificationFailureCode = keyof typeof MESSAGES
export type ClassificationFailure = { code: ClassificationFailureCode; message: string; fieldErrors?: Partial<Record<ClassificationField, string>> }
export class ArticleClassificationError extends Error {
  readonly code: ClassificationFailureCode
  readonly field?: ClassificationField
  constructor(code: ClassificationFailureCode, field?: ClassificationField) {
    super(MESSAGES[code]); this.name = 'ArticleClassificationError'; this.code = code
    if (field !== undefined) this.field = field
  }
}
function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}
export function mapClassificationError(error: unknown): ClassificationFailure {
  try {
    const code = own(error, 'code')
    if (error instanceof ArticleClassificationError && typeof code === 'string' && Object.hasOwn(MESSAGES, code)) {
      const safe = code as ClassificationFailureCode, field = own(error, 'field')
      return { code: safe, message: MESSAGES[safe], ...(FIELDS.some(key => key === field)
        ? { fieldErrors: { [field as ClassificationField]: MESSAGES[safe] } } : {}) }
    }
    const cause = own(own(own(error, 'meta'), 'driverAdapterError'), 'cause')
    if (code === 'P2034' || (code === 'P2010' && own(cause, 'kind') === 'TransactionWriteConflict')) {
      return { code: 'EDIT_CONFLICT', message: MESSAGES.EDIT_CONFLICT }
    }
    if (code === 'P2003') return { code: 'INVALID_SELECTION', message: MESSAGES.INVALID_SELECTION }
  } catch { /* Error getters, proxies and messages are never exposed. */ }
  return { code: 'INTERNAL_ERROR', message: MESSAGES.INTERNAL_ERROR }
}
function invalid(field?: ClassificationField): never { throw new ArticleClassificationError('VALIDATION_ERROR', field) }
export function parseClassificationId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,191}$/.test(value)) throw new ArticleClassificationError('NOT_FOUND')
  return value
}
function selectionId(value: unknown, field: ClassificationField): string {
  try { return parseClassificationId(value) } catch { return invalid(field) }
}
export function classificationTimestamp(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return invalid('expectedUpdatedAt')
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value || date.getUTCFullYear() < 1000 || date.getUTCFullYear() > 9999) return invalid('expectedUpdatedAt')
  return date
}
function ids(value: unknown, field: keyof typeof CLASSIFICATION_LIMITS): string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return invalid(field)
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value
  if (!Number.isInteger(length) || length < 0 || length > CLASSIFICATION_LIMITS[field]) return invalid(field)
  const keys = Reflect.ownKeys(value)
  if (keys.length !== length + 1) return invalid(field)
  const result: string[] = []
  for (let i = 0; i < length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i))
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return invalid(field)
    result.push(selectionId(descriptor.value, field))
  }
  if (new Set(result).size !== result.length) return invalid(field)
  return result.sort()
}
export function normalizeClassificationInput(input: unknown): { selection: ClassificationSelection; expectedUpdatedAt: Date } {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid()
    const prototype = Object.getPrototypeOf(input)
    if (prototype !== Object.prototype && prototype !== null) return invalid()
    const keys = Reflect.ownKeys(input)
    if (keys.length !== FIELDS.length) return invalid()
    const data: Record<string, unknown> = {}
    for (const key of keys) {
      if (typeof key !== 'string' || !FIELDS.includes(key as ClassificationField)) return invalid()
      const descriptor = Object.getOwnPropertyDescriptor(input, key)
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable || descriptor.value === undefined) return invalid(key as ClassificationField)
      data[key] = descriptor.value
    }
    const selection: ClassificationSelection = {
      categoryId: data.categoryId === null ? null : selectionId(data.categoryId, 'categoryId'),
      topicIds: ids(data.topicIds, 'topicIds'), tagIds: ids(data.tagIds, 'tagIds'), instrumentIds: ids(data.instrumentIds, 'instrumentIds'),
      primaryInstrumentId: data.primaryInstrumentId === null ? null : selectionId(data.primaryInstrumentId, 'primaryInstrumentId'),
    }
    if (selection.primaryInstrumentId !== null && !selection.instrumentIds.includes(selection.primaryInstrumentId)) return invalid('primaryInstrumentId')
    return { selection, expectedUpdatedAt: classificationTimestamp(data.expectedUpdatedAt) }
  } catch (error) {
    if (error instanceof ArticleClassificationError) throw error
    return invalid()
  }
}
export type ArticleClassificationSnapshot = {
  id: string; title: string; status: ArticleStatus; updatedAt: string; canMutate: boolean; readOnlyReason: ClassificationFailureCode | null
  category: TaxonomyOption | null; topics: TaxonomyOption[]; tags: TaxonomyOption[]; instruments: (TaxonomyOption & { isPrimary: boolean })[]
  warnings: string[]
}
export type ClassificationResult = { ok: true; data: ArticleClassificationSnapshot; warning?: string } | { ok: false; error: ClassificationFailure }
export type ClassificationOptions = { kind: TaxonomyKind; items: TaxonomyOption[]; page: number; totalPages: number; total: number }
export type ClassificationOptionsResult = { ok: true; data: ClassificationOptions } | { ok: false; error: ClassificationFailure }
export function selectionFromSnapshot(snapshot: ArticleClassificationSnapshot): ClassificationSelection {
  const primary = snapshot.instruments.filter(item => item.isPrimary)
  return { categoryId: snapshot.category?.id ?? null, topicIds: snapshot.topics.map(item => item.id).sort(),
    tagIds: snapshot.tags.map(item => item.id).sort(), instrumentIds: snapshot.instruments.map(item => item.id).sort(),
    primaryInstrumentId: primary.length === 1 ? primary[0].id : null }
}
export function sameClassification(a: ClassificationSelection, b: ClassificationSelection): boolean {
  return a.categoryId === b.categoryId && a.primaryInstrumentId === b.primaryInstrumentId
    && (['topicIds', 'tagIds', 'instrumentIds'] as const).every(key => a[key].length === b[key].length
      && [...a[key]].sort().every((id, i) => id === [...b[key]].sort()[i]))
}
