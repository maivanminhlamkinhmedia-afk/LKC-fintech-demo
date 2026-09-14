import 'server-only'
import { CustomerActivityType, CustomerPriority, CustomerStatus, CustomerTaskStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { hasPermission } from '@/lib/roles'
import { customerSalesScope } from '@/features/crm/access'
import { vietnamDayBounds } from '@/features/crm/customer-filters'
import { OPEN_TASK_STATUSES } from '@/features/crm/follow-up-filters'
import { REPORT_OPTION_LIMIT, REPORT_PAGE_SIZE, reportCustomerWhere, type ReportFilters, type ReportRange } from '@/features/crm/report-filters'
import { reportCustomerSql, type ReportUser } from '@/features/crm/report-scope-sql'

const WORKLOAD_PAGE_SIZE = REPORT_PAGE_SIZE
const OPTION_LIMIT = REPORT_OPTION_LIMIT
type RawCount = number | bigint | string | Prisma.Decimal
type RawWorkload = {
  id: string | null
  customers: RawCount
  newCustomers: RawCount
  open: RawCount
  overdue: RawCount
  completed: RawCount
}

function countNumber(value: RawCount) {
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('CRM report count exceeds supported range')
  return count
}

function workloadCounts(row: RawWorkload) {
  return {
    id: row.id,
    customers: countNumber(row.customers), newCustomers: countNumber(row.newCustomers),
    open: countNumber(row.open), overdue: countNumber(row.overdue), completed: countNumber(row.completed),
  }
}

function pagination(requested: number, total: number) {
  if (!Number.isSafeInteger(requested) || requested < 1 || requested > 1_000_000) throw new Error('Invalid CRM report page')
  const pageCount = Math.max(1, Math.ceil(total / WORKLOAD_PAGE_SIZE))
  const page = Math.min(requested, pageCount)
  return { page, pageCount, offset: (page - 1) * WORKLOAD_PAGE_SIZE }
}

async function workloadRows(tx: Prisma.TransactionClient, mode: 'sales' | 'teams', where: Prisma.Sql, range: ReportRange, now: Date, offset: number) {
  // Identifiers are static fragments, never user input. CRM-008 makes membership
  // a one-to-zero/one join. COUNT DISTINCT avoids customer duplication by tasks.
  const group = mode === 'sales' ? Prisma.sql`c.assignedSalesId` : Prisma.sql`m.teamId`
  return tx.$queryRaw<RawWorkload[]>(Prisma.sql`
    SELECT ${group} AS id,
      COUNT(DISTINCT c.id) AS customers,
      COUNT(DISTINCT CASE WHEN c.createdAt >= ${range.startUtc} AND c.createdAt < ${range.endExclusiveUtc} THEN c.id END) AS newCustomers,
      SUM(CASE WHEN t.status IN (${Prisma.join(OPEN_TASK_STATUSES)}) THEN 1 ELSE 0 END) AS \`open\`,
      SUM(CASE WHEN t.status IN (${Prisma.join(OPEN_TASK_STATUSES)}) AND t.dueAt < ${now} THEN 1 ELSE 0 END) AS overdue,
      SUM(CASE WHEN t.status = ${CustomerTaskStatus.DONE} AND t.completedAt >= ${range.startUtc} AND t.completedAt < ${range.endExclusiveUtc} THEN 1 ELSE 0 END) AS completed
    FROM CustomerProfile c
    LEFT JOIN SalesTeamMember m ON m.userId = c.assignedSalesId
    LEFT JOIN CustomerTask t ON t.customerId = c.id
    WHERE ${where}
    GROUP BY ${group}
    ORDER BY ${group} ASC
    LIMIT ${WORKLOAD_PAGE_SIZE} OFFSET ${offset}
  `)
}

// Internal read-only DAL: the page authenticates first; this also denies roles
// without CRM read permission. No Server Action endpoint or cross-user cache.
export async function getCRMReport(user: ReportUser, filters: ReportFilters, range: ReportRange, now: Date) {
  if (!user.id || !hasPermission(user.role, 'sales:read')) throw new Error('CRM report access denied')
  const scope = customerSalesScope(user)
  const where = reportCustomerWhere(scope, filters)
  // Compile before executing ANY metrics, so unsupported future scopes fail closed.
  const sqlWhere = reportCustomerSql(user, scope, filters)
  const customerTask: Prisma.CustomerTaskWhereInput = { customer: { is: where } }
  const period = { gte: range.startUtc, lt: range.endExclusiveUtc }
  const { start, end } = vietnamDayBounds(now)
  const openTask: Prisma.CustomerTaskWhereInput = { AND: [customerTask, { status: { in: OPEN_TASK_STATUSES } }] }

  return prisma.$transaction(async (tx) => {
    const [customers, newCustomers, open, overdue, today, completed, activityCount, statusGroups, priorityGroups, activityGroups, totals, salesOptions, teamOptions] = await Promise.all([
      tx.customerProfile.count({ where }),
      tx.customerProfile.count({ where: { AND: [where, { createdAt: period }] } }),
      tx.customerTask.count({ where: openTask }),
      tx.customerTask.count({ where: { AND: [openTask, { dueAt: { lt: now } }] } }),
      tx.customerTask.count({ where: { AND: [openTask, { dueAt: { gte: start, lt: end } }] } }),
      tx.customerTask.count({ where: { AND: [customerTask, { status: CustomerTaskStatus.DONE, completedAt: period }] } }),
      tx.customerActivity.count({ where: { customer: { is: where }, createdAt: period } }),
      tx.customerProfile.groupBy({ by: ['status'], where, _count: { _all: true } }),
      tx.customerProfile.groupBy({ by: ['priority'], where, _count: { _all: true } }),
      tx.customerActivity.groupBy({ by: ['type'], where: { customer: { is: where }, createdAt: period }, _count: { _all: true } }),
      tx.$queryRaw<{ sales: RawCount; teams: RawCount }[]>(Prisma.sql`
        SELECT COUNT(DISTINCT c.assignedSalesId) + IF(COUNT(*) > COUNT(c.assignedSalesId), 1, 0) AS sales,
          COUNT(DISTINCT m.teamId) + IF(COUNT(*) > COUNT(m.teamId), 1, 0) AS teams
        FROM CustomerProfile c
        LEFT JOIN SalesTeamMember m ON m.userId = c.assignedSalesId
        WHERE ${sqlWhere}
      `),
      tx.user.findMany({
        where: { assignedCustomers: { some: scope } },
        select: { id: true, name: true, email: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: OPTION_LIMIT + 1,
      }),
      tx.salesTeam.findMany({
        where: { members: { some: { user: { assignedCustomers: { some: scope } } } } },
        select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: OPTION_LIMIT + 1,
      }),
    ])
    const salesTotal = countNumber(totals[0].sales)
    const teamsTotal = countNumber(totals[0].teams)
    const salesPage = pagination(filters.page, salesTotal)
    const teamsPage = pagination(filters.teamPage, teamsTotal)
    const [salesRaw, teamsRaw] = await Promise.all([
      workloadRows(tx, 'sales', sqlWhere, range, now, salesPage.offset),
      workloadRows(tx, 'teams', sqlWhere, range, now, teamsPage.offset),
    ])
    const salesIds = salesRaw.flatMap((row) => row.id === null ? [] : [row.id])
    const teamIds = teamsRaw.flatMap((row) => row.id === null ? [] : [row.id])
    const [salesLabels, teamLabels] = await Promise.all([
      tx.user.findMany({
        where: { id: { in: salesIds }, assignedCustomers: { some: where } },
        select: { id: true, name: true, email: true }, orderBy: { id: 'asc' }, take: WORKLOAD_PAGE_SIZE,
      }),
      tx.salesTeam.findMany({
        where: { id: { in: teamIds }, members: { some: { user: { assignedCustomers: { some: where } } } } },
        select: { id: true, name: true }, orderBy: { id: 'asc' }, take: WORKLOAD_PAGE_SIZE,
      }),
    ])
    const salesNames = new Map(salesLabels.map((row) => [row.id, row]))
    const teamNames = new Map(teamLabels.map((row) => [row.id, row]))
    const percent = (count: number) => customers ? (count / customers) * 100 : 0
    return {
      metrics: { customers, newCustomers, open, overdue, today, completed, activities: activityCount },
      statuses: Object.values(CustomerStatus).map((value) => {
        const count = statusGroups.find((group) => group.status === value)?._count._all ?? 0
        return { value, count, percentage: percent(count) }
      }),
      priorities: Object.values(CustomerPriority).map((value) => {
        const count = priorityGroups.find((group) => group.priority === value)?._count._all ?? 0
        return { value, count, percentage: percent(count) }
      }),
      activities: Object.values(CustomerActivityType).map((value) => ({
        value, count: activityGroups.find((group) => group.type === value)?._count._all ?? 0,
      })),
      sales: {
        rows: salesRaw.map((row) => ({
          ...workloadCounts(row),
          name: row.id === null ? 'Chưa phân công' : salesNames.get(row.id)?.name ?? 'Người phụ trách không khả dụng',
          email: row.id === null ? undefined : salesNames.get(row.id)?.email,
        })),
        total: salesTotal, page: salesPage.page, pageCount: salesPage.pageCount,
      },
      teams: {
        rows: teamsRaw.map((row) => ({
          ...workloadCounts(row), name: row.id === null ? 'Không có đội' : teamNames.get(row.id)?.name ?? 'Đội không khả dụng',
        })),
        total: teamsTotal, page: teamsPage.page, pageCount: teamsPage.pageCount,
      },
      options: {
        sales: salesOptions.slice(0, OPTION_LIMIT), teams: teamOptions.slice(0, OPTION_LIMIT),
        salesTruncated: salesOptions.length > OPTION_LIMIT, teamsTruncated: teamOptions.length > OPTION_LIMIT,
      },
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10_000 })
}
