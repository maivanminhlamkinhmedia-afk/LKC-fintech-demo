'use server'

import bcrypt from 'bcryptjs'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/authz'
import { APP_ROLES, type AppRole } from '@/lib/roles'

function normalizeRole(value: FormDataEntryValue | null): AppRole {
  const role = String(value ?? '') as AppRole

  if (!APP_ROLES.includes(role)) {
    throw new Error('Vai trò không hợp lệ')
  }

  return role
}

function assertCanAssignRole(actorRole: AppRole, role: AppRole) {
  if (role === 'SUPER_ADMIN' && actorRole !== 'SUPER_ADMIN') {
    throw new Error('Chỉ Super Admin được cấp quyền Super Admin')
  }
}

export async function createUser(formData: FormData) {
  const actor = await requirePermission('users:write')

  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase()
  const name = String(formData.get('name') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const role = normalizeRole(formData.get('role'))

  assertCanAssignRole(actor.user.role, role)

  if (!email || !name || password.length < 10) {
    throw new Error('Dữ liệu user không hợp lệ')
  }

  const hash = await bcrypt.hash(password, 12)

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name,
        password: hash,
        role,
      },
    })

    if (role === 'CLIENT') {
      await tx.customerProfile.create({
        data: {
          userId: user.id,
          customerCode: `LKC-${user.id.slice(-8).toUpperCase()}`,
        },
      })
    }

    await tx.auditLog.create({
      data: {
        actorId: actor.user.id,
        action: 'USER_CREATE',
        entityType: 'User',
        entityId: user.id,
        metadata: { role },
      },
    })
  })

  revalidatePath('/admin/users')
}

export async function updateUserRole(formData: FormData) {
  const actor = await requirePermission('users:write')

  const id = String(formData.get('id') ?? '')
  const role = normalizeRole(formData.get('role'))

  if (!id) {
    throw new Error('Thiếu user id')
  }

  if (id === actor.user.id) {
    throw new Error('Không thể tự thay đổi vai trò của chính mình')
  }

  assertCanAssignRole(actor.user.role, role)

  await prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({
      where: { id },
      select: { role: true },
    })

    if (!target) {
      throw new Error('Không tìm thấy user')
    }

    if (
      target.role === 'SUPER_ADMIN' &&
      actor.user.role !== 'SUPER_ADMIN'
    ) {
      throw new Error('Không có quyền thay đổi Super Admin')
    }

    await tx.user.update({
      where: { id },
      data: { role },
    })

    if (role === 'CLIENT') {
      await tx.customerProfile.upsert({
        where: { userId: id },
        update: {},
        create: {
          userId: id,
          customerCode: `LKC-${id.slice(-8).toUpperCase()}`,
        },
      })
    }

    await tx.auditLog.create({
      data: {
        actorId: actor.user.id,
        action: 'USER_ROLE_UPDATE',
        entityType: 'User',
        entityId: id,
        metadata: { role },
      },
    })
  })

  revalidatePath('/admin/users')
}

export async function toggleUserStatus(formData: FormData) {
  const actor = await requirePermission('users:write')
  const id = String(formData.get('id') ?? '')

  if (!id) {
    throw new Error('Thiếu user id')
  }

  if (id === actor.user.id) {
    throw new Error('Không thể khóa chính tài khoản đang đăng nhập')
  }

  await prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({
      where: { id },
      select: {
        role: true,
        status: true,
      },
    })

    if (!target) {
      throw new Error('Không tìm thấy user')
    }

    if (
      target.role === 'SUPER_ADMIN' &&
      actor.user.role !== 'SUPER_ADMIN'
    ) {
      throw new Error('Không có quyền khóa Super Admin')
    }

    const next =
      target.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'

    await tx.user.update({
      where: { id },
      data: { status: next },
    })

    await tx.auditLog.create({
      data: {
        actorId: actor.user.id,
        action: 'USER_STATUS_UPDATE',
        entityType: 'User',
        entityId: id,
        metadata: { status: next },
      },
    })
  })

  revalidatePath('/admin/users')
}