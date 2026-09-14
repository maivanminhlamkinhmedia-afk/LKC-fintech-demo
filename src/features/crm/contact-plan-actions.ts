'use server'

import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/authz'
import { hasPermission } from '@/lib/roles'
import { prisma } from '@/lib/prisma'
import { customerSalesScope } from '@/features/crm/access'
import { parseContactPlanForm } from '@/features/crm/contact-plan-time'

export type ContactPlanState = { kind: 'idle' | 'success' | 'error'; message: string }
class ContactPlanError extends Error {}

export async function updateCustomerNextContact(
  _previousState: ContactPlanState,
  formData: FormData,
): Promise<ContactPlanState> {
  const session = await requirePermission('sales:write')
  const now = new Date()
  let result: { customerId: string; changed: boolean }
  try {
    result = await prisma.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: session.user.id }, select: { id: true, role: true, status: true },
      })
      if (!actor || actor.status !== 'ACTIVE' || !hasPermission(actor.role, 'sales:write')) {
        throw new ContactPlanError('Bạn không còn quyền lên lịch liên hệ. Vui lòng tải lại trang.')
      }
      const parsed = parseContactPlanForm(formData, now)
      if (!parsed.ok) throw new ContactPlanError(parsed.message)
      const { customerId, operation, nextContactAt } = parsed.data
      const where = { AND: [{ id: customerId }, customerSalesScope(actor)] }
      const customer = await tx.customerProfile.findFirst({ where, select: { id: true, nextContactAt: true } })
      if (!customer) throw new ContactPlanError('Không tìm thấy khách hàng hoặc bạn không có quyền truy cập.')
      if (customer.nextContactAt?.getTime() === nextContactAt?.getTime()) return { customerId, changed: false }

      // Only the plan timestamp plus Prisma-managed updatedAt may change. Scope
      // is retained on the write; Serializable protects the authorization reads.
      const updated = await tx.customerProfile.updateMany({ where, data: { nextContactAt } })
      if (updated.count !== 1) throw new ContactPlanError('Phạm vi khách hàng đã thay đổi. Vui lòng tải lại trang.')
      await tx.auditLog.create({
        data: {
          actorId: actor.id, action: 'CUSTOMER_NEXT_CONTACT_UPDATE', entityType: 'CustomerProfile', entityId: customer.id,
          metadata: {
            customerId: customer.id, previousNextContactAt: customer.nextContactAt?.toISOString() ?? null,
            nextContactAt: nextContactAt?.toISOString() ?? null, operation,
          },
        },
      })
      return { customerId, changed: true }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) {
    if (error instanceof ContactPlanError) return { kind: 'error', message: error.message }
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2025', 'P2003'].includes(error.code)) {
      return { kind: 'error', message: 'Dữ liệu vừa thay đổi. Vui lòng tải lại trang và thử lại.' }
    }
    throw error
  }
  if (!result.changed) return { kind: 'success', message: 'Lịch liên hệ không thay đổi; không ghi thêm nhật ký.' }
  revalidatePath(`/sales/customers/${result.customerId}`)
  revalidatePath('/sales/customers')
  revalidatePath('/sales')
  // Pipeline cards also display/filter the customer plan; reports/tasks do not.
  revalidatePath('/sales/pipeline')
  return { kind: 'success', message: 'Đã cập nhật kế hoạch liên hệ. Thời điểm liên hệ thực tế không thay đổi.' }
}
