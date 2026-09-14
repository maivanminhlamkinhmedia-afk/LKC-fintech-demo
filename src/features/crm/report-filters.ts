import type { CustomerPriority, CustomerStatus, Prisma } from '@prisma/client'
import { parseCustomerFilters, vietnamDayBounds, type CRMSearchParams } from './customer-filters'

export const REPORT_PERIODS = ['7d', '30d', '90d', 'ytd', 'custom'] as const
export const REPORT_MAX_DAYS = 366
export const REPORT_PAGE_SIZE = 20
export const REPORT_OPTION_LIMIT = 100
const DAY_MS = 24 * 60 * 60 * 1000
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000

export type ReportFilters = {
  period: (typeof REPORT_PERIODS)[number]
  from?: string
  to?: string
  salesId?: string
  teamId?: string
  status?: CustomerStatus
  priority?: CustomerPriority
  page: number
  teamPage: number
}
export type ReportRange = {
  from: string
  to: string
  startUtc: Date
  endExclusiveUtc: Date
}

function reportDay(value: string) {
  // Strict calendar validation; Date's normalization must not accept February 30.
  // Keep boundaries within MySQL DATETIME's supported years, including next-day end.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const [year, month, day] = value.split('-').map(Number)
  if (year < 1000 || year > 9998) return undefined
  const calendar = new Date(Date.UTC(year, month - 1, day))
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return undefined
  const utc = new Date(calendar.getTime() - VIETNAM_OFFSET_MS)
  return utc.getUTCFullYear() >= 1000 ? utc : undefined
}

function dayLabel(value: Date) {
  return new Date(value.getTime() + VIETNAM_OFFSET_MS).toISOString().slice(0, 10)
}

export function parseReportFilters(params: CRMSearchParams, now = new Date()) {
  const parsed = parseCustomerFilters({
    salesId: params.salesId, teamId: params.teamId,
    status: params.status, priority: params.priority, page: params.page,
  })
  const teamPaging = parseCustomerFilters({ page: params.teamPage })
  const invalidKeys = [...parsed.invalidKeys, ...teamPaging.invalidKeys.map(() => 'teamPage')]
  let period: ReportFilters['period'] = '30d'
  const rawPeriod = params.period
  if (rawPeriod !== undefined && rawPeriod !== '') {
    if (typeof rawPeriod === 'string' && rawPeriod.length <= 32
      && !/[\u0000-\u001f\u007f]/.test(rawPeriod)
      && REPORT_PERIODS.includes(rawPeriod.trim() as ReportFilters['period'])) {
      period = rawPeriod.trim() as ReportFilters['period']
    } else invalidKeys.push('period')
  }
  function dateField(key: 'from' | 'to') {
    const value = params[key]
    if (value === undefined || value === '') return undefined
    const date = typeof value === 'string' ? reportDay(value) : undefined
    if (!date) invalidKeys.push(key)
    return date
  }
  // Even unused preset date fields are validated, but never change preset boundaries.
  const from = dateField('from')
  const to = dateField('to')
  if (period === 'custom') {
    if (!from) invalidKeys.push('from')
    if (!to) invalidKeys.push('to')
    if (from && to && (from > to || (to.getTime() - from.getTime()) / DAY_MS + 1 > REPORT_MAX_DAYS)) {
      invalidKeys.push('from', 'to')
    }
    if (invalidKeys.includes('from') || invalidKeys.includes('to')) period = '30d'
  }
  const today = vietnamDayBounds(now)
  let startUtc: Date
  let endExclusiveUtc = today.end
  if (period === 'custom' && from && to) {
    startUtc = from
    endExclusiveUtc = new Date(to.getTime() + DAY_MS)
  } else if (period === 'ytd') {
    startUtc = reportDay(`${dayLabel(today.start).slice(0, 4)}-01-01`)!
  } else {
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30
    startUtc = new Date(today.start.getTime() - (days - 1) * DAY_MS)
  }
  const range: ReportRange = {
    from: dayLabel(startUtc), to: dayLabel(new Date(endExclusiveUtc.getTime() - DAY_MS)), startUtc, endExclusiveUtc,
  }
  const filters: ReportFilters = {
    period, from: period === 'custom' ? range.from : undefined, to: period === 'custom' ? range.to : undefined,
    salesId: parsed.filters.salesId, teamId: parsed.filters.teamId,
    status: parsed.filters.status, priority: parsed.filters.priority,
    page: parsed.filters.page, teamPage: teamPaging.filters.page,
  }
  return { filters, range, invalidKeys: [...new Set(invalidKeys)] }
}

export function reportCustomerWhere(scope: Prisma.CustomerProfileWhereInput, filters: ReportFilters): Prisma.CustomerProfileWhereInput {
  // Reporting periods intentionally do NOT constrain the current customer portfolio.
  const clauses: Prisma.CustomerProfileWhereInput[] = []
  if (filters.salesId) clauses.push({ assignedSalesId: filters.salesId })
  if (filters.teamId) clauses.push({ assignedSales: { salesMemberships: { some: { teamId: filters.teamId } } } })
  if (filters.status) clauses.push({ status: filters.status })
  if (filters.priority) clauses.push({ priority: filters.priority })
  return { AND: [scope, { AND: clauses }] }
}

export function reportFiltersHref(path: string, filters: ReportFilters, overrides: Partial<ReportFilters> = {}) {
  const values = { ...filters, ...overrides }
  const params = new URLSearchParams()
  for (const key of ['period', 'from', 'to', 'salesId', 'teamId', 'status', 'priority', 'page', 'teamPage'] as const) {
    const value = values[key]
    if (value === undefined || ((key === 'page' || key === 'teamPage') && value === 1)) continue
    if ((key === 'from' || key === 'to') && values.period !== 'custom') continue
    params.set(key, String(value))
  }
  return params.size ? `${path}?${params}` : path
}
