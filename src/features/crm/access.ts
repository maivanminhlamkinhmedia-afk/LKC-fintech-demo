import type { Prisma } from '@prisma/client'
import type { AppRole } from '@/lib/roles'

type CRMUser = {
  id: string
  role: AppRole
}

export function customerSalesScope(
  user: CRMUser,
): Prisma.CustomerProfileWhereInput {
  if (
    user.role === 'SUPER_ADMIN' ||
    user.role === 'ADMIN' ||
    user.role === 'MANAGER'
  ) {
    return {}
  }

  if (user.role === 'SALES_MANAGER') {
    return {
      assignedSales: {
        salesMemberships: {
          some: {
            team: {
              managerId: user.id,
            },
          },
        },
      },
    }
  }

  return {
    assignedSalesId: user.id,
  }
}