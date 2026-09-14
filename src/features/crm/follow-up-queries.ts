import { Prisma } from '@prisma/client'
import type { AppRole } from '@/lib/roles'
import { prisma } from '@/lib/prisma'
import { customerSalesScope } from '@/features/crm/access'
import {
  FOLLOW_UP_PAGE_SIZE,
  followUpMetricWhere,
  scopedFollowUpWhere,
  type FollowUpFilters,
} from '@/features/crm/follow-up-filters'

type CRMUser = { id: string; role: AppRole }

const taskSummarySelect = {
  id: true, title: true, status: true, priority: true, dueAt: true, updatedAt: true,
  assignedTo: { select: { id: true, name: true } },
  customer: { select: {
    id: true, customerCode: true, status: true, priority: true,
    user: { select: { name: true } },
    assignedSales: { select: { id: true, name: true } },
  } },
} satisfies Prisma.CustomerTaskSelect

export async function getFollowUpWorkbench(user: CRMUser, filters: FollowUpFilters, now: Date) {
  const where = scopedFollowUpWhere(customerSalesScope(user), filters, now)
  // A single read snapshot keeps the filtered list, total and open-task metrics consistent.
  // Five counts and one bounded task fetch with selected relations; no per-task queries.
  return prisma.$transaction(async (tx) => {
    const [total, open, overdue, today, upcoming] = await Promise.all([
      tx.customerTask.count({ where }),
      tx.customerTask.count({ where: followUpMetricWhere(where, undefined, now) }),
      tx.customerTask.count({ where: followUpMetricWhere(where, 'overdue', now) }),
      tx.customerTask.count({ where: followUpMetricWhere(where, 'today', now) }),
      tx.customerTask.count({ where: followUpMetricWhere(where, 'upcoming', now) }),
    ])
    const pageCount = Math.max(1, Math.ceil(total / FOLLOW_UP_PAGE_SIZE))
    const page = Math.min(filters.page, pageCount)
    const tasks = await tx.customerTask.findMany({
      where, select: taskSummarySelect,
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * FOLLOW_UP_PAGE_SIZE, take: FOLLOW_UP_PAGE_SIZE,
    })
    return { tasks, total, page, pageCount, metrics: { open, overdue, today, upcoming } }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
}

export async function getFollowUpFilterOptions(user: CRMUser) {
  const visibleTask: Prisma.CustomerTaskWhereInput = { customer: { is: customerSalesScope(user) } }
  const teamScope: Prisma.SalesTeamWhereInput = user.role === 'SALES_MANAGER'
    ? { managerId: user.id }
    : user.role === 'SALES' ? { members: { some: { userId: user.id } } } : {}
  const [sales, teams] = await Promise.all([
    // A visible task can legitimately retain a different historical assignee than its customer.
    prisma.user.findMany({
      where: { customerTasksAssigned: { some: visibleTask } },
      select: { id: true, name: true, email: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }),
    prisma.salesTeam.findMany({
      where: { AND: [teamScope, { members: { some: { user: { customerTasksAssigned: { some: visibleTask } } } } }] },
      select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }),
  ])
  return { sales, teams }
}
