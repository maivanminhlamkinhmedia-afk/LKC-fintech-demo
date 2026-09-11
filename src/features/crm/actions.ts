'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/authz'
import { customerSalesScope } from '@/features/crm/access'

const CUSTOMER_STATUSES = [
  'LEAD',
  'PROSPECT',
  'ACTIVE',
  'DORMANT',
  'CLOSED',
] as const

const CUSTOMER_PRIORITIES = [
  'LOW',
  'MEDIUM',
  'HIGH',
] as const

const ACTIVITY_TYPES = [
  'NOTE',
  'CALL',
  'EMAIL',
  'MEETING',
  'MESSAGE',
] as const

const TASK_PRIORITIES = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'URGENT',
] as const

const TASK_STATUSES = [
  'TODO',
  'IN_PROGRESS',
  'DONE',
  'CANCELLED',
] as const

function requiredText(
  value: FormDataEntryValue | null,
  label: string,
) {
  const result = String(value ?? '').trim()

  if (!result) {
    throw new Error(`${label} không được để trống`)
  }

  return result
}

function optionalText(value: FormDataEntryValue | null) {
  const result = String(value ?? '').trim()
  return result || null
}

function enumValue<const T extends readonly string[]>(
  value: FormDataEntryValue | null,
  allowed: T,
  label: string,
): T[number] {
  const candidate = String(value ?? '')

  if (!allowed.includes(candidate as T[number])) {
    throw new Error(`${label} không hợp lệ`)
  }

  return candidate as T[number]
}

function vietnamDateTime(
  value: FormDataEntryValue | null,
) {
  const raw = optionalText(value)

  if (!raw) {
    return null
  }

  const date = new Date(`${raw}:00+07:00`)

  if (Number.isNaN(date.getTime())) {
    throw new Error('Ngày giờ không hợp lệ')
  }

  return date
}

function refreshCustomer(customerId: string) {
  revalidatePath('/sales/customers')
  revalidatePath(`/sales/customers/${customerId}`)
}

export async function updateCustomerProfile(
  formData: FormData,
) {
  const session = await requirePermission('sales:write')

  const customerId = requiredText(
    formData.get('customerId'),
    'Customer ID',
  )

  const status = enumValue(
    formData.get('status'),
    CUSTOMER_STATUSES,
    'Trạng thái',
  )

  const priority = enumValue(
    formData.get('priority'),
    CUSTOMER_PRIORITIES,
    'Mức ưu tiên',
  )

  const source = optionalText(formData.get('source'))
  const note = optionalText(formData.get('note'))
  const nextContactAt = vietnamDateTime(
    formData.get('nextContactAt'),
  )

  if (source && source.length > 120) {
    throw new Error('Nguồn khách quá dài')
  }

  if (note && note.length > 5000) {
    throw new Error('Ghi chú quá dài')
  }

  const current = await prisma.customerProfile.findFirst({
    where: {
      id: customerId,
      ...customerSalesScope(session.user),
    },
    select: {
      id: true,
      status: true,
    },
  })

  if (!current) {
    throw new Error(
      'Không tìm thấy khách hàng hoặc bạn không có quyền truy cập',
    )
  }

  await prisma.$transaction(async (tx) => {
    await tx.customerProfile.update({
      where: {
        id: customerId,
      },
      data: {
        status,
        priority,
        source,
        note,
        nextContactAt,
      },
    })

    if (current.status !== status) {
      await tx.customerActivity.create({
        data: {
          customerId,
          actorId: session.user.id,
          type: 'STATUS_CHANGE',
          title: 'Thay đổi trạng thái khách hàng',
          content: `${current.status} → ${status}`,
        },
      })
    }

    await tx.auditLog.create({
      data: {
        actorId: session.user.id,
        action: 'CUSTOMER_PROFILE_UPDATE',
        entityType: 'CustomerProfile',
        entityId: customerId,
        metadata: {
          status,
          priority,
        },
      },
    })
  })

  refreshCustomer(customerId)
}

export async function addCustomerActivity(
  formData: FormData,
) {
  const session = await requirePermission('sales:write')

  const customerId = requiredText(
    formData.get('customerId'),
    'Customer ID',
  )

  const type = enumValue(
    formData.get('type'),
    ACTIVITY_TYPES,
    'Loại hoạt động',
  )

  const title = requiredText(
    formData.get('title'),
    'Tiêu đề',
  )

  const content = optionalText(formData.get('content'))

  if (title.length > 160) {
    throw new Error('Tiêu đề quá dài')
  }

  if (content && content.length > 5000) {
    throw new Error('Nội dung quá dài')
  }

  const customer = await prisma.customerProfile.findFirst({
    where: {
      id: customerId,
      ...customerSalesScope(session.user),
    },
    select: {
      id: true,
    },
  })

  if (!customer) {
    throw new Error(
      'Không tìm thấy khách hàng hoặc bạn không có quyền truy cập',
    )
  }

  const now = new Date()
  const isContact = type !== 'NOTE'

  await prisma.$transaction(async (tx) => {
    await tx.customerActivity.create({
      data: {
        customerId,
        actorId: session.user.id,
        type,
        title,
        content,
      },
    })

    if (isContact) {
      await tx.customerProfile.update({
        where: {
          id: customerId,
        },
        data: {
          lastContactAt: now,
        },
      })
    }

    await tx.auditLog.create({
      data: {
        actorId: session.user.id,
        action: 'CUSTOMER_ACTIVITY_CREATE',
        entityType: 'CustomerProfile',
        entityId: customerId,
        metadata: {
          type,
        },
      },
    })
  })

  refreshCustomer(customerId)
}

export async function createCustomerTask(
  formData: FormData,
) {
  const session = await requirePermission('sales:write')

  const customerId = requiredText(
    formData.get('customerId'),
    'Customer ID',
  )

  const title = requiredText(
    formData.get('title'),
    'Tiêu đề công việc',
  )

  const description = optionalText(
    formData.get('description'),
  )

  const priority = enumValue(
    formData.get('priority'),
    TASK_PRIORITIES,
    'Độ ưu tiên',
  )

  const dueAt = vietnamDateTime(formData.get('dueAt'))

  if (title.length > 160) {
    throw new Error('Tiêu đề công việc quá dài')
  }

  const customer = await prisma.customerProfile.findFirst({
    where: {
      id: customerId,
      ...customerSalesScope(session.user),
    },
    select: {
      id: true,
      assignedSalesId: true,
    },
  })

  if (!customer) {
    throw new Error(
      'Không tìm thấy khách hàng hoặc bạn không có quyền truy cập',
    )
  }

  const assignedToId =
    customer.assignedSalesId ?? session.user.id

  await prisma.$transaction(async (tx) => {
    const task = await tx.customerTask.create({
      data: {
        customerId,
        assignedToId,
        createdById: session.user.id,
        title,
        description,
        priority,
        dueAt,
      },
    })

    await tx.auditLog.create({
      data: {
        actorId: session.user.id,
        action: 'CUSTOMER_TASK_CREATE',
        entityType: 'CustomerTask',
        entityId: task.id,
        metadata: {
          customerId,
          priority,
        },
      },
    })
  })

  refreshCustomer(customerId)
}

export async function updateCustomerTaskStatus(
  formData: FormData,
) {
  const session = await requirePermission('sales:write')

  const taskId = requiredText(
    formData.get('taskId'),
    'Task ID',
  )

  const status = enumValue(
    formData.get('status'),
    TASK_STATUSES,
    'Trạng thái task',
  )

  const task = await prisma.customerTask.findUnique({
    where: {
      id: taskId,
    },
    select: {
      id: true,
      customerId: true,
    },
  })

  if (!task) {
    throw new Error('Không tìm thấy task')
  }

  const customer = await prisma.customerProfile.findFirst({
    where: {
      id: task.customerId,
      ...customerSalesScope(session.user),
    },
    select: {
      id: true,
    },
  })

  if (!customer) {
    throw new Error(
      'Bạn không có quyền cập nhật task này',
    )
  }

  await prisma.$transaction(async (tx) => {
    await tx.customerTask.update({
      where: {
        id: taskId,
      },
      data: {
        status,
        completedAt:
          status === 'DONE' ? new Date() : null,
      },
    })

    await tx.auditLog.create({
      data: {
        actorId: session.user.id,
        action: 'CUSTOMER_TASK_STATUS_UPDATE',
        entityType: 'CustomerTask',
        entityId: taskId,
        metadata: {
          status,
          customerId: task.customerId,
        },
      },
    })
  })

  refreshCustomer(task.customerId)
}