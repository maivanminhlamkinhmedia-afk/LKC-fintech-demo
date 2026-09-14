import { CustomerPriority, CustomerStatus, CustomerTaskPriority, CustomerTaskStatus } from '@prisma/client'

type FieldKind = 'id' | 'nullableId' | 'date' | 'count' | 'boolean' | 'true' | 'enum' | 'changedFields'
type AuditField = { key: string; label: string; kind: FieldKind; values?: readonly string[]; max?: number }
type AuditDefinition = {
  action: string; label: string; category: string; entityType: string
  fields: readonly AuditField[]; customerReference?: 'entityId' | 'customerId'
}
export type AuditSummaryField = { key: string; label: string; value: string }
const field = (key: string, label: string, kind: FieldKind, values?: readonly string[]): AuditField => ({ key, label, kind, values })
const customerId = field('customerId', 'Khách hàng', 'id')
const customerPriority = Object.values(CustomerPriority)
const taskPriority = Object.values(CustomerTaskPriority)
const customerStatus = Object.values(CustomerStatus)
const taskStatus = Object.values(CustomerTaskStatus)

// Only actual production emitters. Never use a prefix match to admit future actions.
// Team names are deliberately omitted: they are arbitrary free text, not changes
// appropriate for this privacy-minimized console. Task title is only a field name.
export const CRM_AUDIT_REGISTRY: readonly AuditDefinition[] = [
  { action: 'CUSTOMER_PROFILE_UPDATE', label: 'Cập nhật hồ sơ khách hàng', category: 'CUSTOMER', entityType: 'CustomerProfile', customerReference: 'entityId', fields: [
    field('status', 'Trạng thái được ghi nhận', 'enum', customerStatus), field('priority', 'Ưu tiên được ghi nhận', 'enum', customerPriority),
  ] },
  { action: 'CUSTOMER_SALES_ASSIGNMENT', label: 'Phân công Sales', category: 'ASSIGNMENT', entityType: 'CustomerProfile', customerReference: 'entityId', fields: [
    field('previousSalesId', 'Sales trước', 'nullableId'), field('newSalesId', 'Sales sau', 'id'),
  ] },
  { action: 'CUSTOMER_PIPELINE_STATUS_CHANGE', label: 'Đổi trạng thái pipeline', category: 'PIPELINE', entityType: 'CustomerProfile', customerReference: 'entityId', fields: [
    field('previousStatus', 'Trạng thái trước', 'enum', customerStatus), field('newStatus', 'Trạng thái sau', 'enum', customerStatus),
  ] },
  { action: 'CUSTOMER_TASK_CREATE', label: 'Tạo task', category: 'TASK', entityType: 'CustomerTask', customerReference: 'customerId', fields: [
    customerId, field('priority', 'Ưu tiên task', 'enum', taskPriority),
  ] },
  { action: 'CUSTOMER_TASK_STATUS_UPDATE', label: 'Đổi trạng thái task', category: 'TASK', entityType: 'CustomerTask', customerReference: 'customerId', fields: [
    customerId, field('previousStatus', 'Trạng thái trước', 'enum', taskStatus), field('status', 'Trạng thái sau', 'enum', taskStatus),
  ] },
  { action: 'CUSTOMER_TASK_PLAN_UPDATE', label: 'Đổi kế hoạch task', category: 'TASK', entityType: 'CustomerTask', customerReference: 'customerId', fields: [
    customerId, field('taskId', 'Task', 'id'), field('changedFields', 'Các trường đã đổi', 'changedFields'),
    field('previousPriority', 'Ưu tiên task trước', 'enum', taskPriority), field('priority', 'Ưu tiên task sau', 'enum', taskPriority),
    field('previousDueAt', 'Hạn trước', 'date'), field('dueAt', 'Hạn sau', 'date'),
  ] },
  { action: 'CUSTOMER_ACTIVITY_CREATE', label: 'Ghi nhận tương tác', category: 'INTERACTION', entityType: 'CustomerProfile', customerReference: 'entityId', fields: [
    customerId, field('activityId', 'Tương tác', 'id'), field('activityType', 'Loại tương tác', 'enum', ['NOTE', 'CALL', 'EMAIL', 'MEETING', 'MESSAGE']),
  ] },
  { action: 'CUSTOMER_NEXT_CONTACT_UPDATE', label: 'Đổi lịch liên hệ', category: 'CONTACT', entityType: 'CustomerProfile', customerReference: 'entityId', fields: [
    customerId, field('previousNextContactAt', 'Lịch trước', 'date'), field('nextContactAt', 'Lịch sau', 'date'), field('operation', 'Thao tác', 'enum', ['SET', 'CLEAR']),
  ] },
  { action: 'CUSTOMER_BULK_PRIORITY_UPDATE', label: 'Đổi ưu tiên khách hàng hàng loạt', category: 'BULK_OPERATION', entityType: 'CustomerProfile', customerReference: 'entityId', fields: [
    customerId, field('previousPriority', 'Ưu tiên trước', 'enum', customerPriority), field('priority', 'Ưu tiên sau', 'enum', customerPriority), field('bulk', 'Thao tác hàng loạt', 'true'),
  ] },
  { action: 'CUSTOMER_CSV_EXPORT', label: 'Tạo CSV khách hàng', category: 'EXPORT', entityType: 'CustomerProfile', fields: [
    { key: 'rowCount', label: 'Số dòng', kind: 'count', max: 5000 }, field('filtersActive', 'Có bộ lọc', 'boolean'), field('format', 'Định dạng', 'enum', ['csv']),
  ] },
  { action: 'SALES_TEAM_CREATE', label: 'Tạo đội Sales', category: 'TEAM', entityType: 'SalesTeam', fields: [field('managerId', 'Quản lý', 'id')] },
  { action: 'SALES_TEAM_RENAME', label: 'Đổi tên đội Sales', category: 'TEAM', entityType: 'SalesTeam', fields: [] },
  { action: 'SALES_TEAM_MANAGER_CHANGE', label: 'Đổi quản lý đội Sales', category: 'TEAM', entityType: 'SalesTeam', fields: [
    field('previousManagerId', 'Quản lý trước', 'id'), field('newManagerId', 'Quản lý sau', 'id'),
  ] },
  { action: 'SALES_TEAM_MEMBER_ADD', label: 'Thêm thành viên đội', category: 'TEAM', entityType: 'SalesTeamMember', fields: [field('teamId', 'Đội', 'id'), field('userId', 'Thành viên', 'id')] },
  { action: 'SALES_TEAM_MEMBER_REMOVE', label: 'Gỡ thành viên đội', category: 'TEAM', entityType: 'SalesTeamMember', fields: [
    field('teamId', 'Đội', 'id'), field('userId', 'Thành viên', 'id'), field('assignedCustomerCount', 'Khách hàng được phân công', 'count'),
    field('nonClosedCustomerCount', 'Khách hàng chưa đóng', 'count'), field('confirmationUsed', 'Đã xác nhận', 'boolean'),
  ] },
]
export const CRM_AUDIT_CATEGORIES = [...new Set(CRM_AUDIT_REGISTRY.map((entry) => entry.category))]
export const CRM_AUDIT_EXCLUDED_ACTIONS = {
  AUTH_LOGIN: 'Account authentication, not a CRM operation.',
  USER_CREATE: 'Account administration, even when CLIENT creation also creates a customer profile.',
  USER_ROLE_UPDATE: 'Account authorization administration, not a CRM operation.',
  USER_STATUS_UPDATE: 'Account status administration, not a CRM operation.',
} as const

export function getAuditDefinition(action: string) {
  return CRM_AUDIT_REGISTRY.find((entry) => entry.action === action)
}

export function safeAuditId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 191 && !/[^A-Za-z0-9_-]/u.test(value)
}

// CRM dates use fixed UTC+7, including accepted historical task deadlines. The
// IANA zone had different historical offsets; shift explicitly, format in UTC.
const dateFormatter = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'UTC',
})
function canonicalDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return undefined
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? parsed : undefined
}
export function formatAuditDate(value: Date | string | null) {
  if (value === null) return 'Không có'
  const parsed = value instanceof Date ? value : canonicalDate(value)
  return parsed && Number.isFinite(parsed.getTime()) ? dateFormatter.format(new Date(parsed.getTime() + 7 * 3_600_000)) : 'Không xác định'
}

function metadataValue(metadata: unknown, key: string): unknown {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined
  const prototype = Object.getPrototypeOf(metadata)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  // Prisma JSON has no accessors; do not execute them if this pure helper is
  // called with a non-JSON object in a test or future caller.
  return Object.getOwnPropertyDescriptor(metadata, key)?.value
}
function safeValue(definition: AuditField, value: unknown): string | undefined {
  switch (definition.kind) {
    case 'nullableId': if (value === null) return 'Không có'
    // falls through
    case 'id': return safeAuditId(value) ? value : undefined
    case 'date': return value === null ? 'Không có' : canonicalDate(value) ? formatAuditDate(value as string) : undefined
    case 'count': return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= (definition.max ?? Number.MAX_SAFE_INTEGER) ? String(value) : undefined
    case 'boolean': return typeof value === 'boolean' ? value ? 'Có' : 'Không' : undefined
    case 'true': return value === true ? 'Có' : undefined
    case 'enum': return typeof value === 'string' && definition.values?.includes(value) ? value : undefined
    case 'changedFields': return Array.isArray(value) && value.length > 0 && value.length <= 3
      && new Set(value).size === value.length && value.every((item) => typeof item === 'string' && ['title', 'priority', 'dueAt'].includes(item)) ? value.join(', ') : undefined
  }
}
export function summarizeAuditMetadata(action: string, metadata: unknown): AuditSummaryField[] {
  const definition = getAuditDefinition(action)
  if (!definition) return []
  return definition.fields.flatMap((entry) => {
    const value = safeValue(entry, metadataValue(metadata, entry.key))
    return value === undefined ? [] : [{ key: entry.key, label: entry.label, value }]
  })
}

export function auditCustomerHref(action: string, entityType: string, entityId: unknown, metadata: unknown): string | null {
  const definition = getAuditDefinition(action)
  if (!definition || definition.entityType !== entityType || !definition.customerReference) return null
  const id = definition.customerReference === 'entityId' ? entityId : metadataValue(metadata, 'customerId')
  return safeAuditId(id) ? `/sales/customers/${id}` : null
}
