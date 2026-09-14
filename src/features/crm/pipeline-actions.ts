'use server'

import { CustomerStatus, Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { customerSalesScope } from '@/features/crm/access'
import { requirePermission } from '@/lib/authz'
import { prisma } from '@/lib/prisma'

export type PipelineStatusState = {
  kind: 'idle' | 'success' | 'error'
  message: string
}

class PipelineStatusError extends Error {}

function singleText(formData: FormData, name: string) {
  const values = formData.getAll(name)
  return values.length === 1 && typeof values[0] === 'string'
    ? values[0]
    : null
}

function refreshPipeline(customerId: string) {
  revalidatePath('/sales/follow-ups')
  revalidatePath('/sales')
  revalidatePath('/sales/pipeline')
  revalidatePath('/sales/customers')
  revalidatePath(`/sales/customers/${customerId}`)
  revalidatePath('/sales/assignment')
}

export async function updateCustomerPipelineStatus(
  _previousState: PipelineStatusState,
  formData: FormData,
): Promise<PipelineStatusState> {
  const session = await requirePermission('sales:write')

  if (!(formData instanceof FormData)) {
    return { kind: 'error', message: 'Dữ liệu cập nhật không hợp lệ.' }
  }

  const customerId = singleText(formData, 'customerId')
  const rawStatus = singleText(formData, 'status')
  if (!customerId || !/^[A-Za-z0-9_-]{1,191}$/.test(customerId)) {
    return { kind: 'error', message: 'Mã khách hàng không hợp lệ.' }
  }
  if (!rawStatus || !Object.values(CustomerStatus).includes(rawStatus as CustomerStatus)) {
    return { kind: 'error', message: 'Trạng thái khách hàng không hợp lệ.' }
  }
  const status = rawStatus as CustomerStatus
  const scope = customerSalesScope(session.user)

  let changed: boolean
  try {
    changed = await prisma.$transaction(async (tx) => {
      const current = await tx.customerProfile.findFirst({
        where: { AND: [{ id: customerId }, scope] },
        select: { id: true, status: true },
      })
      if (!current) {
        throw new PipelineStatusError('Không tìm thấy khách hàng hoặc bạn không có quyền truy cập.')
      }
      if (current.status === status) return false

      // Keep the scope and previous status in the write predicate as well as the read.
      const updated = await tx.customerProfile.updateMany({
        where: { AND: [{ id: customerId, status: current.status }, scope] },
        data: { status },
      })
      if (updated.count !== 1) {
        throw new PipelineStatusError('Dữ liệu đã thay đổi. Vui lòng tải lại trang và thử lại.')
      }

      await tx.customerActivity.create({
        data: {
          customerId,
          actorId: session.user.id,
          type: 'STATUS_CHANGE',
          title: 'Thay đổi trạng thái khách hàng',
          content: `${current.status} → ${status}`,
        },
      })
      await tx.auditLog.create({
        data: {
          actorId: session.user.id,
          action: 'CUSTOMER_PIPELINE_STATUS_CHANGE',
          entityType: 'CustomerProfile',
          entityId: customerId,
          metadata: { previousStatus: current.status, newStatus: status },
        },
      })
      return true
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) {
    if (error instanceof PipelineStatusError) {
      return { kind: 'error', message: error.message }
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return { kind: 'error', message: 'Dữ liệu đang được cập nhật. Vui lòng thử lại.' }
    }
    throw error
  }

  refreshPipeline(customerId)
  return {
    kind: 'success',
    message: changed ? 'Đã cập nhật trạng thái khách hàng.' : 'Trạng thái khách hàng không thay đổi.',
  }
}
