'use server'

import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/authz'
import { hasPermission } from '@/lib/roles'
import { prisma } from '@/lib/prisma'
import { customerSalesScope } from '@/features/crm/access'
import {
  isManualActivityType, MAX_INTERACTION_CONTENT, parseInteractionForm, singleInteractionField,
} from '@/features/crm/interaction-validation'

export type InteractionState = {
  kind: 'idle' | 'success' | 'error'
  message: string
  values?: { type: string; content: string }
}

class InteractionError extends Error {}

function draftValues(formData: FormData) {
  if (!(formData instanceof FormData)) return undefined
  const type = singleInteractionField(formData, 'type')
  const content = singleInteractionField(formData, 'content')
  // Return only this submission's bounded draft to its caller, never a database record.
  return {
    type: type && isManualActivityType(type) ? type : 'NOTE',
    content: content !== null && content.length <= MAX_INTERACTION_CONTENT ? content : '',
  }
}

export async function createCustomerInteraction(
  _previousState: InteractionState,
  formData: FormData,
): Promise<InteractionState> {
  // Existing auth callback refreshes role/status from the database on every request.
  const session = await requirePermission('sales:write')
  const parsed = parseInteractionForm(formData)
  const values = draftValues(formData)
  if (!parsed.ok) return { kind: 'error', message: parsed.message, values }
  const { customerId, type, title, content } = parsed.data

  try {
    await prisma.$transaction(async (tx) => {
      // Recheck the actor inside the same transaction as customer scope and the append.
      const actor = await tx.user.findUnique({
        where: { id: session.user.id }, select: { id: true, role: true, status: true },
      })
      if (!actor || actor.status !== 'ACTIVE' || !hasPermission(actor.role, 'sales:write')) {
        throw new InteractionError('Bạn không còn quyền ghi nhận tương tác. Vui lòng tải lại trang.')
      }
      const where = { AND: [{ id: customerId }, customerSalesScope(actor)] }
      const customer = await tx.customerProfile.findFirst({ where, select: { id: true } })
      if (!customer) throw new InteractionError('Không tìm thấy khách hàng hoặc bạn không có quyền truy cập.')

      const activity = await tx.customerActivity.create({
        data: { customerId: customer.id, actorId: actor.id, type, title, content },
        select: { id: true, createdAt: true },
      })
      // Preserve the existing addCustomerActivity rule: contacts advance lastContactAt,
      // NOTE does not touch the profile. No owner/status/priority/task/team/role changes.
      if (type !== 'NOTE') {
        const updated = await tx.customerProfile.updateMany({
          where, data: { lastContactAt: activity.createdAt },
        })
        if (updated.count !== 1) throw new InteractionError('Phạm vi khách hàng đã thay đổi. Vui lòng tải lại trang.')
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id, action: 'CUSTOMER_ACTIVITY_CREATE',
          entityType: 'CustomerProfile', entityId: customer.id,
          metadata: { customerId: customer.id, activityId: activity.id, activityType: type },
        },
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) {
    if (error instanceof InteractionError) return { kind: 'error', message: error.message, values }
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2025', 'P2003'].includes(error.code)) {
      return { kind: 'error', message: 'Dữ liệu vừa thay đổi. Vui lòng tải lại trang và thử lại.', values }
    }
    throw error
  }

  revalidatePath(`/sales/customers/${customerId}`)
  revalidatePath('/sales/reports')
  return { kind: 'success', message: 'Đã ghi nhận tương tác. Xem trang đầu của timeline với loại phù hợp để tìm bản ghi mới.', values: { type, content: '' } }
}
