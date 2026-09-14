import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { hasPermission, type AppRole } from '@/lib/roles'
import { customerSalesScope } from '@/features/crm/access'
import { customerFollowUpWhere } from '@/features/crm/customer-filters'

export type ContactHealth = { overdue: number; today: number; upcoming: number; none: number }

// Four database counts, one request-time instant and a consistent read snapshot.
// No URL filters, customer fetch/group, task joins or shared cross-user cache.
export async function getContactHealth(user: { id: string; role: AppRole }, now: Date): Promise<ContactHealth> {
  if (!user.id || !hasPermission(user.role, 'sales:read')) throw new Error('CRM contact health access denied')
  const scope = customerSalesScope(user)
  const where = (state: keyof ContactHealth) => ({ AND: [scope, customerFollowUpWhere(state, now)] })
  return prisma.$transaction(async (tx) => {
    const [overdue, today, upcoming, none] = await Promise.all([
      tx.customerProfile.count({ where: where('overdue') }),
      tx.customerProfile.count({ where: where('today') }),
      tx.customerProfile.count({ where: where('upcoming') }),
      tx.customerProfile.count({ where: where('none') }),
    ])
    return { overdue, today, upcoming, none }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
}
