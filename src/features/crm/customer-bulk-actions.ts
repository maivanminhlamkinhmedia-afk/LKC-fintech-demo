'use server'

import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/authz'
import { hasPermission } from '@/lib/roles'
import { prisma } from '@/lib/prisma'
import { customerSalesScope } from '@/features/crm/access'
import { MAX_BULK_CUSTOMERS, parseCustomerBulkForm } from '@/features/crm/customer-bulk-validation'

export type CustomerBulkState = { kind: 'idle' | 'success' | 'error'; message: string }
const conflictMessage = 'Không thể cập nhật danh sách này. Quyền truy cập hoặc dữ liệu có thể đã thay đổi. Vui lòng tải lại trang và thử lại.'

export async function updateCustomerPriorities(
  _previousState: CustomerBulkState,
  formData: FormData,
): Promise<CustomerBulkState> {
  const session = await requirePermission('sales:write')
  const parsed = parseCustomerBulkForm(formData)
  if (!parsed.ok) return { kind: 'error', message: parsed.message }
  const { customerIds, priority } = parsed.data
  let changedIds: string[]
  try {
    changedIds = await prisma.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: session.user.id }, select: { id: true, role: true, status: true },
      })
      if (!actor || actor.status !== 'ACTIVE' || !hasPermission(actor.role, 'sales:write')) throw new Error('Bulk access changed')
      const scope = customerSalesScope(actor)
      const customers = await tx.customerProfile.findMany({
        where: { AND: [{ id: { in: customerIds } }, scope] },
        select: { id: true, priority: true, updatedAt: true }, orderBy: { id: 'asc' }, take: MAX_BULK_CUSTOMERS,
      })
      // All-or-nothing, including no-op selections: never reveal the offending ID.
      if (customers.length !== customerIds.length) throw new Error('Bulk scope changed')
      const changed = customers.filter((customer) => customer.priority !== priority)
      if (!changed.length) return []
      const updated = await tx.customerProfile.updateMany({
        where: { AND: [scope, { OR: changed.map((customer) => ({
          id: customer.id, priority: customer.priority, updatedAt: customer.updatedAt,
        })) }] },
        // Only CustomerProfile.priority; Prisma manages updatedAt. Never tasks.
        data: { priority },
      })
      if (updated.count !== changed.length) throw new Error('Bulk write conflict')
      const audit = await tx.auditLog.createMany({
        data: changed.map((customer) => ({
          actorId: actor.id, action: 'CUSTOMER_BULK_PRIORITY_UPDATE', entityType: 'CustomerProfile', entityId: customer.id,
          metadata: { customerId: customer.id, previousPriority: customer.priority, priority, bulk: true },
        })),
      })
      if (audit.count !== changed.length) throw new Error('Bulk audit conflict')
      return changed.map((customer) => customer.id)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 })
  } catch {
    // All database errors roll back; never send Prisma/MySQL diagnostics to clients.
    return { kind: 'error', message: conflictMessage }
  }
  if (!changedIds.length) return { kind: 'success', message: 'Ưu tiên không thay đổi; không cập nhật dữ liệu hoặc ghi thêm nhật ký.' }
  for (const path of ['/sales/customers', '/sales/pipeline', '/sales/reports', '/sales', '/sales/follow-ups', '/sales/assignment']) {
    // Dashboard counts HIGH; workbench has customerPriority; assignment sorts by priority.
    revalidatePath(path)
  }
  for (const id of changedIds) revalidatePath(`/sales/customers/${id}`)
  return { kind: 'success', message: `Đã cập nhật ưu tiên cho ${changedIds.length} khách hàng. Task, phân công và lịch liên hệ không thay đổi.` }
}
