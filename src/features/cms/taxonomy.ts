import type { InstrumentType } from '@prisma/client'

export const TAXONOMY_KINDS = ['category', 'topic', 'tag', 'instrument'] as const
export type TaxonomyKind = typeof TAXONOMY_KINDS[number]
export const TAXONOMY_LABELS: Record<TaxonomyKind, string> = { category: 'Chuyên mục', topic: 'Chủ đề', tag: 'Thẻ', instrument: 'Công cụ tài chính' }
export const INSTRUMENT_TYPES = ['INDEX', 'EQUITY', 'FUTURE', 'ETF', 'FUND', 'BOND', 'COMMODITY', 'FX', 'CRYPTO', 'OTHER'] as const satisfies readonly InstrumentType[]
export type TaxonomyOption = { id: string; kind: TaxonomyKind; name: string; slug: string | null; canonicalKey: string | null; symbol: string | null; isActive: boolean | null }
export type TaxonomyItem = TaxonomyOption & { description: string | null; sortOrder: number | null; instrumentType: InstrumentType | null; exchange: string | null; countryCode: string | null; currency: string | null; createdAt: string; updatedAt: string }
export type TaxonomySearch = { q: string; page: number; active: 'all' | 'active' }
export type TaxonomyPage<T = TaxonomyItem> = { kind: TaxonomyKind; q: string; active: 'all' | 'active'; items: T[]; page: number; totalPages: number; total: number }
export type TaxonomyMetadata = { name: string; description?: string | null; sortOrder?: number; isActive?: boolean; countryCode?: string | null; currency?: string | null }
export type TaxonomyCreate = TaxonomyMetadata & { slug?: string; symbol?: string; instrumentType?: InstrumentType; exchange?: string | null; canonicalKey?: string }
const MESSAGES = {
  VALIDATION_ERROR: 'Vui lòng kiểm tra thông tin danh mục.', FORBIDDEN: 'Bạn không còn quyền quản lý danh mục.',
  NOT_FOUND: 'Không tìm thấy danh mục.', IDENTITY_CONFLICT: 'Định danh đã được sử dụng. Hãy chọn định danh khác.',
  TAXONOMY_IN_USE: 'Danh mục đang được bài viết sử dụng nên không thể xóa.',
  EDIT_CONFLICT: 'Danh mục đã thay đổi. Giữ nội dung đang nhập và tải lại để đối chiếu.',
  INTERNAL_ERROR: 'Chưa xác nhận được kết quả lưu. Tải lại để kiểm tra trước khi thực hiện lại.',
} as const
export type TaxonomyFailureCode = keyof typeof MESSAGES
export type TaxonomyFailure = { code: TaxonomyFailureCode; message: string; fieldErrors?: Record<string, string> }
export type TaxonomyResult<T> = { ok: true; data: T; warning?: string } | { ok: false; error: TaxonomyFailure }
export type TaxonomyMutationResult = TaxonomyResult<{ kind: TaxonomyKind; item: TaxonomyItem | null; deletedId: string | null }>
export class TaxonomyError extends Error {
  readonly code: TaxonomyFailureCode
  readonly field?: string
  constructor(code: TaxonomyFailureCode, field?: string) { super(MESSAGES[code]); this.name = 'TaxonomyError'; this.code = code; if (field !== undefined) this.field = field }
}
const own = (input: unknown, key: string): unknown => {
  if (!input || typeof input !== 'object') return undefined
  const descriptor = Object.getOwnPropertyDescriptor(input, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}
export function mapTaxonomyError(error: unknown, deleting = false): TaxonomyFailure {
  try {
    const code = own(error, 'code')
    if (error instanceof TaxonomyError && typeof code === 'string' && Object.hasOwn(MESSAGES, code)) {
      const field = own(error, 'field')
      return { code: code as TaxonomyFailureCode, message: MESSAGES[code as TaxonomyFailureCode],
        ...(typeof field === 'string' && ALL_FIELDS.includes(field) ? { fieldErrors: { [field]: MESSAGES[code as TaxonomyFailureCode] } } : {}) }
    }
    if (code === 'P2002') return { code: 'IDENTITY_CONFLICT', message: MESSAGES.IDENTITY_CONFLICT }
    if (deleting && code === 'P2003') return { code: 'TAXONOMY_IN_USE', message: MESSAGES.TAXONOMY_IN_USE }
    const cause = own(own(own(error, 'meta'), 'driverAdapterError'), 'cause')
    if (code === 'P2034' || (code === 'P2010' && own(cause, 'kind') === 'TransactionWriteConflict')) return { code: 'EDIT_CONFLICT', message: MESSAGES.EDIT_CONFLICT }
  } catch { /* Do not inspect raw messages or execute error getters. */ }
  return { code: 'INTERNAL_ERROR', message: MESSAGES.INTERNAL_ERROR }
}
const invalid = (field?: string): never => { throw new TaxonomyError('VALIDATION_ERROR', field) }
const MUTABLE: Record<TaxonomyKind, readonly string[]> = { category: ['name', 'description', 'sortOrder', 'isActive'], topic: ['name', 'description', 'isActive'], tag: ['name'], instrument: ['name', 'countryCode', 'currency', 'isActive'] }
const IDENTITY: Record<TaxonomyKind, readonly string[]> = { category: ['slug'], topic: ['slug'], tag: ['slug'], instrument: ['symbol', 'instrumentType', 'exchange'] }
const ALL_FIELDS = ['name', 'description', 'sortOrder', 'isActive', 'slug', 'symbol', 'instrumentType', 'exchange', 'countryCode', 'currency', 'expectedUpdatedAt']
export function exactTaxonomyObject(input: unknown, fields: readonly string[]): Record<string, unknown> {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid()
    const prototype = Object.getPrototypeOf(input)
    if (prototype !== Object.prototype && prototype !== null) return invalid()
    const keys = Reflect.ownKeys(input)
    if (keys.length !== fields.length) return invalid()
    const result: Record<string, unknown> = {}
    for (const key of keys) {
      if (typeof key !== 'string' || !fields.includes(key)) return invalid()
      const descriptor = Object.getOwnPropertyDescriptor(input, key)
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable || descriptor.value === undefined) return invalid(key)
      result[key] = descriptor.value
    }
    return result
  } catch (error) { if (error instanceof TaxonomyError) throw error; return invalid() }
}
export function parseTaxonomyKind(input: unknown): TaxonomyKind {
  if (typeof input !== 'string' || !TAXONOMY_KINDS.some(kind => kind === input)) return invalid()
  return input as TaxonomyKind
}
export function parseTaxonomyId(input: unknown): string {
  if (typeof input !== 'string' || !/^[A-Za-z0-9_-]{1,191}$/.test(input)) throw new TaxonomyError('NOT_FOUND')
  return input
}
export function parseTaxonomyTimestamp(input: unknown): Date {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input)) return invalid('expectedUpdatedAt')
  const value = new Date(input)
  if (!Number.isFinite(value.getTime()) || value.toISOString() !== input || value.getUTCFullYear() < 1000 || value.getUTCFullYear() > 9999) return invalid('expectedUpdatedAt')
  return value
}
function name(input: unknown): string {
  if (typeof input !== 'string' || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(input)) return invalid('name')
  const value = input.trim().normalize('NFC')
  if (!value || Array.from(value).length > 180) return invalid('name')
  return value
}
function description(input: unknown): string | null {
  if (input === null) return null
  if (typeof input !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(input)) return invalid('description')
  const value = input.trim().normalize('NFC')
  if (Array.from(value).length > 4000) return invalid('description')
  return value || null
}
function code(input: unknown, field: string, pattern: RegExp, nullable = false): string | null {
  if (input === null && nullable) return null
  if (typeof input !== 'string' || /[^\x20-\x7e]/.test(input)) return invalid(field)
  const value = input.trim().toUpperCase()
  if (!value && nullable) return null
  if (!pattern.test(value)) return invalid(field)
  return value
}
export function normalizeTaxonomyInput(kind: TaxonomyKind, operation: 'create' | 'update', input: unknown): { data: TaxonomyCreate; expectedUpdatedAt: Date | null } {
  const values = exactTaxonomyObject(input, [...MUTABLE[kind], ...(operation === 'create' ? IDENTITY[kind] : ['expectedUpdatedAt'])])
  const data: TaxonomyCreate = { name: name(values.name) }
  if (kind === 'category' || kind === 'topic') data.description = description(values.description)
  if (kind !== 'tag') { if (typeof values.isActive !== 'boolean') return invalid('isActive'); data.isActive = values.isActive }
  if (kind === 'category') {
    if (typeof values.sortOrder !== 'number' || !Number.isInteger(values.sortOrder) || values.sortOrder < -10000 || values.sortOrder > 10000) return invalid('sortOrder')
    data.sortOrder = values.sortOrder
  }
  if (kind === 'instrument') {
    data.countryCode = code(values.countryCode, 'countryCode', /^[A-Z]{2}$/, true)
    data.currency = code(values.currency, 'currency', /^[A-Z]{3}$/, true)
  }
  if (operation === 'create') {
    if (kind !== 'instrument') {
      if (typeof values.slug !== 'string' || /[^\x20-\x7e]/.test(values.slug)) return invalid('slug')
      const slug = values.slug.trim().toLowerCase()
      if (slug.length > 120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return invalid('slug')
      data.slug = slug
    } else {
      if (!INSTRUMENT_TYPES.some(type => type === values.instrumentType)) return invalid('instrumentType')
      data.instrumentType = values.instrumentType as InstrumentType
      data.symbol = code(values.symbol, 'symbol', /^[A-Z0-9][A-Z0-9._/-]{0,47}$/)!
      data.exchange = code(values.exchange, 'exchange', /^[A-Z0-9][A-Z0-9._-]{0,31}$/, true)
      if (data.instrumentType === 'FX' || data.instrumentType === 'CRYPTO') {
        if (data.exchange !== null) return invalid('exchange')
        data.canonicalKey = `${data.instrumentType}:${data.symbol}`
      } else {
        if (data.exchange === 'FX' || data.exchange === 'CRYPTO') return invalid('exchange')
        data.canonicalKey = data.exchange ? `${data.exchange}:${data.symbol}` : data.symbol
      }
    }
  }
  return { data, expectedUpdatedAt: operation === 'update' ? parseTaxonomyTimestamp(values.expectedUpdatedAt) : null }
}
export function normalizeTaxonomyDelete(input: unknown): Date { return parseTaxonomyTimestamp(exactTaxonomyObject(input, ['expectedUpdatedAt']).expectedUpdatedAt) }
export function normalizeTaxonomySearch(input: unknown): TaxonomySearch {
  const values = exactTaxonomyObject(input, ['q', 'page', 'active'])
  if (typeof values.q !== 'string' || Array.from(values.q.trim()).length > 100 || /[\u0000-\u001f\u007f-\u009f]/u.test(values.q)) return invalid()
  if (typeof values.page !== 'number' || !Number.isSafeInteger(values.page) || values.page < 1 || values.page > 100000 || !['all', 'active'].includes(values.active as string)) return invalid()
  return { q: values.q.trim(), page: values.page, active: values.active as 'all' | 'active' }
}
