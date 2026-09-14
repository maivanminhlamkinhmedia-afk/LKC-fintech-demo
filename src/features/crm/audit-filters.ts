import { Prisma } from '@prisma/client'
import type { CRMSearchParams } from './customer-filters'
import { parseReportFilters } from './report-filters'
import { CRM_AUDIT_CATEGORIES, CRM_AUDIT_REGISTRY, getAuditDefinition, safeAuditId } from './audit-registry'

export const AUDIT_PERIODS = ['7d', '30d', '90d', 'custom'] as const
export const AUDIT_PAGE_SIZE = 50
export const AUDIT_MAX_PAGE = 1000
export const AUDIT_ACTOR_LIMIT = 200
export type AuditFilters = {
  period: (typeof AUDIT_PERIODS)[number]; from?: string; to?: string
  action?: string; category?: string; actorId?: string; page: number
}

// Invalid/repeated supported parameters fail closed at the query boundary. The
// normalized values only populate the correction form; they never broaden reads.
export function parseAuditFilters(params: CRMSearchParams, now = new Date()) {
  const invalidKeys: string[] = []
  function singleton(key: string, max: number) {
    const value = params[key]
    if (value === undefined || value === '') return undefined
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
      invalidKeys.push(key); return undefined
    }
    return value
  }
  const rawPeriod = singleton('period', 6)
  let period: AuditFilters['period'] = '30d'
  if (rawPeriod !== undefined) {
    if (AUDIT_PERIODS.includes(rawPeriod as AuditFilters['period'])) period = rawPeriod as AuditFilters['period']
    else invalidKeys.push('period')
  }
  const validClock = now instanceof Date && Number.isFinite(now.getTime()) && now.getUTCFullYear() >= 1001 && now.getUTCFullYear() <= 9997
  if (!validClock) invalidKeys.push('period')
  // Reuse CRM-010's strict calendar, inclusive end, 366-day and UTC+7 policy.
  // Do not change reporting behavior; invalid audit filters suppress all reads.
  const dates = parseReportFilters({ period, from: params.from, to: params.to }, validClock ? now : new Date('2000-01-01T00:00:00.000Z'))
  invalidKeys.push(...dates.invalidKeys)
  const action = singleton('action', 64)
  if (action !== undefined && !getAuditDefinition(action)) invalidKeys.push('action')
  const category = singleton('category', 32)
  if (category !== undefined && !CRM_AUDIT_CATEGORIES.includes(category)) invalidKeys.push('category')
  const actorId = singleton('actorId', 191)
  if (actorId !== undefined && !safeAuditId(actorId)) invalidKeys.push('actorId')
  const rawPage = singleton('page', 4)
  let page = 1
  if (rawPage !== undefined) {
    const number = Number(rawPage)
    if (/^[1-9]\d*$/u.test(rawPage) && Number.isSafeInteger(number) && number <= AUDIT_MAX_PAGE) page = number
    else invalidKeys.push('page')
  }
  const filters: AuditFilters = {
    period: dates.filters.period as AuditFilters['period'], from: dates.filters.from, to: dates.filters.to,
    action: invalidKeys.includes('action') ? undefined : action,
    category: invalidKeys.includes('category') ? undefined : category,
    actorId: invalidKeys.includes('actorId') ? undefined : actorId, page,
  }
  return { filters, range: dates.range, invalidKeys: [...new Set(invalidKeys)] }
}

export function auditWhere(filters: AuditFilters, range: ReturnType<typeof parseAuditFilters>['range'], includeActor = true): Prisma.AuditLogWhereInput {
  const clauses: Prisma.AuditLogWhereInput[] = [
    { action: { in: CRM_AUDIT_REGISTRY.map((entry) => entry.action) } },
    { createdAt: { gte: range.startUtc, lt: range.endExclusiveUtc } },
  ]
  if (filters.action) clauses.push({ action: filters.action })
  if (filters.category) clauses.push({ action: { in: CRM_AUDIT_REGISTRY.filter((entry) => entry.category === filters.category).map((entry) => entry.action) } })
  if (includeActor && filters.actorId) clauses.push({ actorId: filters.actorId })
  return { AND: clauses }
}

// Prisma's MySQL string filters inherit a case-insensitive/pad-space collation.
// BINARY equality is required for the explicit action universe, including counts
// and off-page actor choices. All values are bound parameters, never raw SQL from
// a request. Alias `a` and table/column names are fixed in the server DAL.
export function auditSqlWhere(filters: AuditFilters, range: ReturnType<typeof parseAuditFilters>['range'], includeActor = true) {
  const actions = CRM_AUDIT_REGISTRY.filter((entry) => (!filters.action || entry.action === filters.action)
    && (!filters.category || entry.category === filters.category)).map((entry) => entry.action)
  if (!actions.length) return Prisma.sql`1 = 0`
  return Prisma.sql`BINARY a.action IN (${Prisma.join(actions)}) AND a.createdAt >= ${range.startUtc} AND a.createdAt < ${range.endExclusiveUtc}
    ${includeActor && filters.actorId ? Prisma.sql`AND BINARY a.actorId = ${filters.actorId}` : Prisma.empty}`
}

export function auditFiltersHref(filters: AuditFilters, page = filters.page) {
  const params = new URLSearchParams()
  for (const key of ['period', 'from', 'to', 'action', 'category', 'actorId'] as const) {
    if ((key === 'from' || key === 'to') && filters.period !== 'custom') continue
    if (filters[key] !== undefined) params.set(key, filters[key])
  }
  if (page !== 1) params.set('page', String(page))
  return `/sales/audit${params.size ? `?${params}` : ''}`
}
