'use server'

import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/authz'
import { hasPermission } from '@/lib/roles'
import { prisma } from '@/lib/prisma'
import { customerSalesScope } from '@/features/crm/access'
import { canPlanTask, parseTaskPlanForm } from '@/features/crm/task-plan-validation'
import { toVietnamContactInput } from '@/features/crm/contact-plan-time'

export type TaskPlanState = { kind: 'idle' | 'success' | 'error'; message: string }
class TaskPlanError extends Error {}
const staleMessage = 'Công việc đã thay đổi. Vui lòng tải lại trang, kiểm tra dữ liệu mới và thử lại.'

export async function updateCustomerTaskPlan(
  _previousState: TaskPlanState,
  formData: FormData,
): Promise<TaskPlanState> {
  // Authentication refreshes role/status from the database on each request.
  const session = await requirePermission('sales:write')
  const parsed = parseTaskPlanForm(formData)
  if (!parsed.ok) return { kind: 'error', message: parsed.message }
  const { taskId, title, priority, expectedUpdatedAt } = parsed.data
  let result: { customerId: string; changed: boolean; dueChanged: boolean }
  try {
    result = await prisma.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: session.user.id }, select: { id: true, role: true, status: true },
      })
      if (!actor || actor.status !== 'ACTIVE' || !hasPermission(actor.role, 'sales:write')) {
        throw new TaskPlanError('Bạn không còn quyền sửa kế hoạch công việc. Vui lòng tải lại trang.')
      }
      const scope = customerSalesScope(actor)
      const task = await tx.customerTask.findFirst({
        where: { AND: [{ id: taskId }, { customer: { is: scope } }] },
        select: { id: true, customerId: true, title: true, priority: true, dueAt: true, status: true, updatedAt: true },
      })
      if (!task) throw new TaskPlanError('Không tìm thấy công việc hoặc bạn không có quyền truy cập.')
      // Validate the rendered version even on a no-op; never silently accept a stale draft.
      if (task.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new TaskPlanError(staleMessage)
      if (!canPlanTask(task.status)) throw new TaskPlanError('Chỉ sửa kế hoạch của task TODO hoặc IN_PROGRESS. Trạng thái được quản lý riêng.')

      // Minute UI must not round an existing second/millisecond deadline during a title edit.
      const dueAt = parsed.data.dueAt && task.dueAt
        && toVietnamContactInput(parsed.data.dueAt) === toVietnamContactInput(task.dueAt)
        ? task.dueAt : parsed.data.dueAt
      const changedFields = [
        ...(title !== task.title ? ['title'] : []),
        ...(priority !== task.priority ? ['priority'] : []),
        ...(dueAt?.getTime() !== task.dueAt?.getTime() ? ['dueAt'] : []),
      ]
      if (!changedFields.length) return { customerId: task.customerId, changed: false, dueChanged: false }
      const updated = await tx.customerTask.updateMany({
        where: { AND: [
          { id: task.id, customerId: task.customerId, updatedAt: expectedUpdatedAt, status: task.status },
          { customer: { is: scope } },
        ] },
        // Explicit allowlist; updatedAt remains Prisma-managed. Never status/completedAt/owner.
        data: { title, priority, dueAt },
      })
      if (updated.count !== 1) throw new TaskPlanError(staleMessage)
      const version = await tx.customerTask.findUniqueOrThrow({ where: { id: task.id }, select: { updatedAt: true } })
      // A successful planning write must invalidate its token even at millisecond resolution.
      if (version.updatedAt.getTime() <= task.updatedAt.getTime()) throw new TaskPlanError(staleMessage)
      await tx.auditLog.create({
        data: {
          actorId: actor.id, action: 'CUSTOMER_TASK_PLAN_UPDATE', entityType: 'CustomerTask', entityId: task.id,
          metadata: {
            customerId: task.customerId, taskId: task.id, changedFields,
            previousPriority: task.priority, priority,
            previousDueAt: task.dueAt?.toISOString() ?? null, dueAt: dueAt?.toISOString() ?? null,
          },
        },
      })
      return { customerId: task.customerId, changed: true, dueChanged: changedFields.includes('dueAt') }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) {
    if (error instanceof TaskPlanError) return { kind: 'error', message: error.message }
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2025', 'P2003'].includes(error.code)) {
      return { kind: 'error', message: staleMessage }
    }
    throw error
  }
  if (!result.changed) return { kind: 'success', message: 'Kế hoạch công việc không thay đổi; không ghi thêm nhật ký.' }
  revalidatePath(`/sales/customers/${result.customerId}`)
  revalidatePath('/sales/follow-ups')
  if (result.dueChanged) {
    revalidatePath('/sales/reports')
    revalidatePath('/sales')
    // Both list and pipeline support task=overdue, based on related task dueAt.
    revalidatePath('/sales/customers')
    revalidatePath('/sales/pipeline')
  }
  return { kind: 'success', message: 'Đã cập nhật kế hoạch công việc. Trạng thái, người phụ trách và lịch liên hệ khách hàng không thay đổi.' }
}
