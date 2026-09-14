import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { hasPermission, type AppRole } from '@/lib/roles'
import { customerSalesScope } from '@/features/crm/access'
import { ACTIVITY_PAGE_SIZE, ACTIVITY_TYPES, activityWhere, type ActivityFilters } from '@/features/crm/activity-filters'

type CRMUser = { id: string; role: AppRole }

const timelineSelect = {
  id: true, type: true, title: true, content: true, createdAt: true,
  actor: { select: { id: true, name: true } },
} satisfies Prisma.CustomerActivitySelect

export type ActivityTimelineEntry = Prisma.CustomerActivityGetPayload<{ select: typeof timelineSelect }>

// Called by the authenticated customer detail page, not a Server Action.
// Counts and rows share a read snapshot and the same customer authorization.
export async function getCustomerActivityTimeline(user: CRMUser, customerId: string, filters: ActivityFilters) {
  if (!user.id || !hasPermission(user.role, 'sales:read')) throw new Error('CRM activity access denied')
  if (typeof customerId !== 'string' || !/^[A-Za-z0-9_-]{1,191}$/.test(customerId)) return null
  if (!Number.isSafeInteger(filters.activityPage) || filters.activityPage < 1 || filters.activityPage > 1_000_000
    || (filters.activityType !== undefined && !ACTIVITY_TYPES.includes(filters.activityType))) {
    throw new Error('Invalid CRM activity filters')
  }
  const scope = customerSalesScope(user)
  const where = activityWhere(customerId, scope, filters)
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customerProfile.findFirst({
      where: { AND: [{ id: customerId }, scope] }, select: { id: true },
    })
    // Do not reveal even an activity count for a missing or out-of-scope customer.
    if (!customer) return null
    const total = await tx.customerActivity.count({ where })
    const pageCount = Math.max(1, Math.ceil(total / ACTIVITY_PAGE_SIZE))
    const page = Math.min(filters.activityPage, pageCount)
    const activities = await tx.customerActivity.findMany({
      where, select: timelineSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * ACTIVITY_PAGE_SIZE, take: ACTIVITY_PAGE_SIZE,
    })
    return { activities, total, page, pageCount }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
}
