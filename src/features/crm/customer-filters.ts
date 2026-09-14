import { CustomerPriority, CustomerStatus, CustomerTaskStatus, type Prisma } from '@prisma/client'

export const CUSTOMER_STATUSES = Object.values(CustomerStatus)
export const CUSTOMER_PRIORITIES = Object.values(CustomerPriority)
export const FOLLOW_UP_FILTERS = ['overdue', 'today', 'upcoming', 'none'] as const
export const TASK_FILTERS = ['open', 'overdue'] as const
export const CUSTOMER_PAGE_SIZE = 30
export const PIPELINE_COLUMN_LIMIT = 30

export type CRMSearchParams = Record<string, string | string[] | undefined>
export type CustomerFilters = {
  q?: string
  status?: CustomerStatus
  priority?: CustomerPriority
  salesId?: string
  teamId?: string
  followUp?: (typeof FOLLOW_UP_FILTERS)[number]
  task?: (typeof TASK_FILTERS)[number]
  page: number
}

// Invalid/repeated values never reach Prisma. Unknown keys are ignored.
export function parseCustomerFilters(params: CRMSearchParams) {
  const invalidKeys: string[] = []
  function text(key: string, maxLength: number) {
    const value = params[key]
    if (value === undefined || value === '') return undefined
    if (typeof value !== 'string' || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
      invalidKeys.push(key)
      return undefined
    }
    return value.trim() || undefined
  }
  function enumFilter<T extends string>(key: string, values: readonly T[]): T | undefined {
    const value = text(key, 32)
    if (value === undefined) return undefined
    if (values.includes(value as T)) return value as T
    invalidKeys.push(key)
    return undefined
  }
  function idFilter(key: string) {
    const value = text(key, 191)
    if (value === undefined || /^[a-zA-Z0-9_-]+$/.test(value)) return value
    invalidKeys.push(key)
    return undefined
  }

  const q = text('q', 120)
  const status = enumFilter('status', CUSTOMER_STATUSES)
  const priority = enumFilter('priority', CUSTOMER_PRIORITIES)
  const salesId = idFilter('salesId')
  const teamId = idFilter('teamId')
  const followUp = enumFilter('followUp', FOLLOW_UP_FILTERS)
  const task = enumFilter('task', TASK_FILTERS)
  const rawPage = text('page', 7)
  let page = 1
  if (rawPage !== undefined) {
    const candidate = Number(rawPage)
    if (/^[1-9]\d*$/.test(rawPage) && Number.isSafeInteger(candidate) && candidate <= 1_000_000) {
      page = candidate
    } else {
      invalidKeys.push('page')
    }
  }
  return { filters: { q, status, priority, salesId, teamId, followUp, task, page } satisfies CustomerFilters, invalidKeys }
}

export function vietnamDayBounds(now: Date) {
  // Fixed UTC+7, independent of the deployment timezone.
  const offset = 7 * 60 * 60 * 1000
  const local = new Date(now.getTime() + offset)
  const start = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offset)
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) }
}

export function customerFilterWhere(filters: CustomerFilters, now: Date): Prisma.CustomerProfileWhereInput {
  const clauses: Prisma.CustomerProfileWhereInput[] = []
  if (filters.q) {
    // MySQL contains uses LIKE: bind parameters and escape literal wildcards.
    const search = filters.q.replace(/[\\%_]/g, '\\$&')
    clauses.push({ OR: [
      { user: { name: { contains: search } } },
      { user: { email: { contains: search } } },
      { customerCode: { contains: search } },
    ] })
  }
  if (filters.status) clauses.push({ status: filters.status })
  if (filters.priority) clauses.push({ priority: filters.priority })
  if (filters.salesId) clauses.push({ assignedSalesId: filters.salesId })
  if (filters.teamId) clauses.push({ assignedSales: { salesMemberships: { some: { teamId: filters.teamId } } } })
  if (filters.followUp === 'overdue') clauses.push({ nextContactAt: { lt: now } })
  if (filters.followUp === 'today') {
    const { start, end } = vietnamDayBounds(now)
    clauses.push({ nextContactAt: { gte: start, lt: end } })
  }
  if (filters.followUp === 'upcoming') clauses.push({ nextContactAt: { gte: now } })
  if (filters.followUp === 'none') clauses.push({ nextContactAt: null })
  if (filters.task) {
    clauses.push({ tasks: { some: {
      status: { in: [CustomerTaskStatus.TODO, CustomerTaskStatus.IN_PROGRESS] },
      ...(filters.task === 'overdue' ? { dueAt: { lt: now } } : {}),
    } } })
  }
  return { AND: clauses }
}

export function filtersHref(path: string, filters: CustomerFilters, overrides: Partial<CustomerFilters> = {}) {
  const values = { ...filters, ...overrides }
  const params = new URLSearchParams()
  for (const key of ['q', 'status', 'priority', 'salesId', 'teamId', 'followUp', 'task', 'page'] as const) {
    const value = values[key]
    if (value !== undefined && !(key === 'page' && value === 1)) params.set(key, String(value))
  }
  return params.size ? `${path}?${params}` : path
}

const dateFormatter = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh',
})

export function formatCRMDate(value: Date | null) {
  return value ? dateFormatter.format(value) : 'Chưa hẹn follow-up'
}

export function isOverdueFollowUp(value: Date | null, now: Date) {
  return value !== null && value.getTime() < now.getTime()
}
