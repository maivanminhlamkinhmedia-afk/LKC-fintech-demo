'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/authz'
import { customerSalesScope } from '@/features/crm/access'

const ASSIGNMENT_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'SALES_MANAGER',
] as const

function requiredId(
  value: FormDataEntryValue | null,
  label: string,
) {
  const id = String(value ?? '').trim()

  if (!id) {
    throw new Error(`${label} không hợp lệ`)
  }

  return id
}

function refreshAssignment(customerId: string) {
  revalidatePath('/sales')
  revalidatePath('/sales/assignment')
  revalidatePath('/sales/customers')
  revalidatePath(`/sales/customers/${customerId}`)
}

export async function assignCustomerToSales(
  formData: FormData,
) {
  const session = await requireRole(ASSIGNMENT_ROLES)

  const customerId = requiredId(
    formData.get('customerId'),
    'Customer ID',
  )

  const salesId = requiredId(
    formData.get('salesId'),
    'Sales ID',
  )

  const isGlobalManager =
    session.user.role === 'SUPER_ADMIN' ||
    session.user.role === 'ADMIN'

  /*
   * ADMIN / SUPER_ADMIN:
   *   được quản lý mọi khách hàng.
   *
   * SALES_MANAGER:
   *   chỉ được quản lý khách thuộc team mình.
   */
  const customer = await prisma.customerProfile.findFirst({
    where: {
      id: customerId,
      ...(isGlobalManager
        ? {}
        : customerSalesScope(session.user)),
    },
    include: {
      assignedSales: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  })

  if (!customer) {
    throw new Error(
      'Không tìm thấy khách hàng hoặc bạn không có quyền phân công khách hàng này',
    )
  }

  /*
   * SALES_MANAGER chỉ được chọn Sales thuộc team mình.
   * ADMIN / SUPER_ADMIN được chọn mọi Sales ACTIVE.
   */
  const targetSales = await prisma.user.findFirst({
    where: {
      id: salesId,
      role: 'SALES',
      status: 'ACTIVE',

      ...(session.user.role === 'SALES_MANAGER'
        ? {
            salesMemberships: {
              some: {
                team: {
                  managerId: session.user.id,
                },
              },
            },
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      email: true,
    },
  })

  if (!targetSales) {
    throw new Error(
      'Sales không tồn tại, đã bị khóa hoặc không thuộc team bạn quản lý',
    )
  }

  if (customer.assignedSalesId === targetSales.id) {
    refreshAssignment(customerId)
    return
  }

  const previousSalesName =
    customer.assignedSales?.name ?? 'Chưa phân công'

  await prisma.$transaction(async (tx) => {
    await tx.customerProfile.update({
      where: {
        id: customerId,
      },
      data: {
        assignedSalesId: targetSales.id,
      },
    })

    /*
     * Task đang mở đi theo Sales mới để tránh task
     * bị bỏ lại ở tài khoản Sales cũ.
     */
    await tx.customerTask.updateMany({
      where: {
        customerId,
        status: {
          in: ['TODO', 'IN_PROGRESS'],
        },
      },
      data: {
        assignedToId: targetSales.id,
      },
    })

    await tx.customerActivity.create({
      data: {
        customerId,
        actorId: session.user.id,
        type: 'ASSIGNMENT',
        title: 'Phân công Sales phụ trách',
        content: `${previousSalesName} → ${targetSales.name}`,
      },
    })

    await tx.auditLog.create({
      data: {
        actorId: session.user.id,
        action: 'CUSTOMER_SALES_ASSIGNMENT',
        entityType: 'CustomerProfile',
        entityId: customerId,
        metadata: {
          previousSalesId:
            customer.assignedSalesId ?? null,
          newSalesId: targetSales.id,
        },
      },
    })
  })

  refreshAssignment(customerId)
}