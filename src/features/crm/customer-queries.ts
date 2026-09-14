import type { Prisma } from '@prisma/client'
import type { AppRole } from '@/lib/roles'
import { prisma } from '@/lib/prisma'
import { customerSalesScope } from '@/features/crm/access'
import {
  CUSTOMER_PAGE_SIZE,
  CUSTOMER_STATUSES,
  PIPELINE_COLUMN_LIMIT,
  customerFilterWhere,
  type CustomerFilters,
} from '@/features/crm/customer-filters'

type CRMUser = { id: string; role: AppRole }

const customerSummarySelect = {
  id: true,
  customerCode: true,
  status: true,
  priority: true,
  nextContactAt: true,
  user: { select: { name: true, email: true } },
  assignedSales: { select: { id: true, name: true } },
} satisfies Prisma.CustomerProfileSelect

export type CustomerSummary = Prisma.CustomerProfileGetPayload<{ select: typeof customerSummarySelect }>

function scopedWhere(user: CRMUser, filters: CustomerFilters, now: Date): Prisma.CustomerProfileWhereInput {
  // Each predicate must hold: URL filters cannot overwrite authorization keys.
  return { AND: [customerSalesScope(user), customerFilterWhere(filters, now)] }
}

export async function getCustomerList(user: CRMUser, filters: CustomerFilters, now: Date) {
  const where = scopedWhere(user, filters, now)
  const total = await prisma.customerProfile.count({ where })
  const pageCount = Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE))
  const page = Math.min(filters.page, pageCount)
  const customers = await prisma.customerProfile.findMany({
    where,
    select: customerSummarySelect,
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    skip: (page - 1) * CUSTOMER_PAGE_SIZE,
    take: CUSTOMER_PAGE_SIZE,
  })
  return { customers, total, page, pageCount }
}

export async function getPipelineCustomers(user: CRMUser, filters: CustomerFilters, now: Date) {
  const where = scopedWhere(user, filters, now)
  const [counts, groups] = await Promise.all([
    prisma.customerProfile.groupBy({ by: ['status'], where, _count: { _all: true } }),
    Promise.all(CUSTOMER_STATUSES.map((status) => prisma.customerProfile.findMany({
      where: { AND: [where, { status }] },
      select: customerSummarySelect,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: PIPELINE_COLUMN_LIMIT,
    }))),
  ])
  return { columns: CUSTOMER_STATUSES.map((status, index) => ({
    status,
    total: counts.find((count) => count.status === status)?._count._all ?? 0,
    customers: groups[index],
  })) }
}

export async function getCustomerFilterOptions(user: CRMUser) {
  // Assignee options come only from visible customers. Historical/inactive
  // assignees remain filterable, without exposing another manager's team.
  const [sales, teams] = await Promise.all([
    prisma.user.findMany({
      where: { assignedCustomers: { some: customerSalesScope(user) } },
      select: { id: true, name: true, email: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }),
    prisma.salesTeam.findMany({
      where: user.role === 'SALES_MANAGER'
        ? { managerId: user.id }
        : user.role === 'SALES'
          ? { members: { some: { userId: user.id } } }
          : {},
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }),
  ])
  return { sales, teams }
}
