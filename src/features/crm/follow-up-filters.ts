import { CustomerTaskPriority, CustomerTaskStatus, type Prisma } from '@prisma/client'
import {
  parseCustomerFilters,
  vietnamDayBounds,
  type CRMSearchParams,
  type CustomerFilters,
} from './customer-filters'

export const TASK_STATUSES = Object.values(CustomerTaskStatus)
export const TASK_PRIORITIES = Object.values(CustomerTaskPriority)
export const DUE_STATES = ['overdue', 'today', 'upcoming', 'none'] as const
export const OPEN_TASK_STATUSES: CustomerTaskStatus[] = [CustomerTaskStatus.TODO, CustomerTaskStatus.IN_PROGRESS]
export const FOLLOW_UP_PAGE_SIZE = 30

export type FollowUpFilters = {
  q?: string
  status?: CustomerTaskStatus
  priority?: CustomerTaskPriority
  salesId?: string
  teamId?: string
  due?: (typeof DUE_STATES)[number]
  customerStatus?: CustomerFilters['status']
  customerPriority?: CustomerFilters['priority']
  page: number
}

export function parseFollowUpFilters(params: CRMSearchParams) {
  // Reuse CRM-007's text, identifier, customer-enum and pagination validation.
  // Pass only known fields: unrelated URL keys cannot become Prisma predicates.
  const parsed = parseCustomerFilters({
    q: params.q, salesId: params.salesId, teamId: params.teamId, page: params.page,
    status: params.customerStatus, priority: params.customerPriority,
  })
  const invalidKeys = parsed.invalidKeys.map((key) => key === 'status' ? 'customerStatus' : key === 'priority' ? 'customerPriority' : key)
  function enumFilter<T extends string>(key: string, values: readonly T[]): T | undefined {
    const value = params[key]
    if (value === undefined || value === '') return undefined
    if (typeof value !== 'string' || value.length > 32 || /[\u0000-\u001f\u007f]/.test(value)) {
      invalidKeys.push(key)
      return undefined
    }
    const trimmed = value.trim()
    if (!trimmed) return undefined
    if (values.includes(trimmed as T)) return trimmed as T
    invalidKeys.push(key)
    return undefined
  }
  const filters: FollowUpFilters = {
    q: parsed.filters.q, salesId: parsed.filters.salesId, teamId: parsed.filters.teamId,
    customerStatus: parsed.filters.status, customerPriority: parsed.filters.priority,
    status: enumFilter('status', TASK_STATUSES), priority: enumFilter('priority', TASK_PRIORITIES),
    due: enumFilter('due', DUE_STATES), page: parsed.filters.page,
  }
  return { filters, invalidKeys }
}

export function taskDueWhere(due: FollowUpFilters['due'], now: Date): Prisma.CustomerTaskWhereInput {
  // Date filters include every task status. Metrics/overdue badges separately require open tasks.
  if (due === 'overdue') return { dueAt: { lt: now } }
  if (due === 'upcoming') return { dueAt: { gte: now } }
  if (due === 'none') return { dueAt: null }
  if (due === 'today') {
    const { start, end } = vietnamDayBounds(now)
    return { dueAt: { gte: start, lt: end } }
  }
  return {}
}

export function followUpFilterWhere(filters: FollowUpFilters, now: Date): Prisma.CustomerTaskWhereInput {
  const clauses: Prisma.CustomerTaskWhereInput[] = []
  if (filters.q) {
    // Same literal MySQL LIKE escaping as the verified customer search.
    const search = filters.q.replace(/[\\%_]/g, '\\$&')
    clauses.push({ OR: [
      { title: { contains: search } },
      { customer: { is: { user: { name: { contains: search } } } } },
      { customer: { is: { customerCode: { contains: search } } } },
    ] })
  }
  if (filters.status) clauses.push({ status: filters.status })
  if (filters.priority) clauses.push({ priority: filters.priority })
  // These are task-assignee filters, not authorization or customer ownership.
  if (filters.salesId) clauses.push({ assignedToId: filters.salesId })
  if (filters.teamId) clauses.push({ assignedTo: { is: { salesMemberships: { some: { teamId: filters.teamId } } } } })
  if (filters.customerStatus) clauses.push({ customer: { is: { status: filters.customerStatus } } })
  if (filters.customerPriority) clauses.push({ customer: { is: { priority: filters.customerPriority } } })
  if (filters.due) clauses.push(taskDueWhere(filters.due, now))
  return { AND: clauses }
}

export function scopedFollowUpWhere(scope: Prisma.CustomerProfileWhereInput, filters: FollowUpFilters, now: Date): Prisma.CustomerTaskWhereInput {
  // Authorization is an independent AND clause; no URL field can replace it.
  return { AND: [{ customer: { is: scope } }, followUpFilterWhere(filters, now)] }
}

export function followUpMetricWhere(where: Prisma.CustomerTaskWhereInput, due?: FollowUpFilters['due'], now = new Date()): Prisma.CustomerTaskWhereInput {
  return { AND: [where, { status: { in: OPEN_TASK_STATUSES } }, taskDueWhere(due, now)] }
}

export function isOverdueTask(task: { status: CustomerTaskStatus; dueAt: Date | null }, now: Date) {
  return OPEN_TASK_STATUSES.includes(task.status) && task.dueAt !== null && task.dueAt.getTime() < now.getTime()
}

export function followUpFiltersHref(path: string, filters: FollowUpFilters, overrides: Partial<FollowUpFilters> = {}) {
  const values = { ...filters, ...overrides }
  const params = new URLSearchParams()
  for (const key of ['q', 'status', 'priority', 'salesId', 'teamId', 'due', 'customerStatus', 'customerPriority', 'page'] as const) {
    const value = values[key]
    if (value !== undefined && !(key === 'page' && value === 1)) params.set(key, String(value))
  }
  return params.size ? `${path}?${params}` : path
}
