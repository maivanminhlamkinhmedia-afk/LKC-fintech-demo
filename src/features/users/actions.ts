'use server'

import bcrypt from 'bcryptjs'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/authz'
import { APP_ROLES, type AppRole } from '@/lib/roles'

function normalizeRole(value: FormDataEntryValue | null): AppRole {
  const role = String(value ?? '') as AppRole
  if (!APP_ROLES.includes(role)) throw new Error('Vai trò không hợp lệ')
  return role
}

export async function createUser(formData: FormData) {
  const actor = await requirePermission('users:write')
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const name = String(formData.get('name') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const role = normalizeRole(formData.get('role'))

  if (!email || !name || password.length < 10) throw new Error('Dữ liệu user không hợp lệ')

  const hash = await bcrypt.hash(password, 12)
  const user = await prisma.user.create({ data: { email, name, password: hash, role } })

  if (role === 'CLIENT') {
    await prisma.customerProfile.create({
      data: { userId: user.id, customerCode: `LKC-${user.id.slice(-8).toUpperCase()}` },
    })
  }

  await prisma.auditLog.create({ data: { actorId: actor.user.id, action: 'USER_CREATE', entityType: 'User', entityId: user.id, metadata: { role } } })
  revalidatePath('/admin/users')
}

export async function updateUserRole(formData: FormData) {
  const actor = await requirePermission('users:write')
  const id = String(formData.get('id') ?? '')
  const role = normalizeRole(formData.get('role'))
  if (!id) throw new Error('Thiếu user id')

  await prisma.user.update({ where: { id }, data: { role } })
  if (role === 'CLIENT') {
    await prisma.customerProfile.upsert({
      where: { userId: id },
      update: {},
      create: { userId: id, customerCode: `LKC-${id.slice(-8).toUpperCase()}` },
    })
  }
  await prisma.auditLog.create({ data: { actorId: actor.user.id, action: 'USER_ROLE_UPDATE', entityType: 'User', entityId: id, metadata: { role } } })
  revalidatePath('/admin/users')
}

export async function toggleUserStatus(formData: FormData) {
  const actor = await requirePermission('users:write')
  const id = String(formData.get('id') ?? '')
  const current = String(formData.get('current') ?? '')
  const next = current === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'
  if (!id || id === actor.user.id) throw new Error('Không thể khóa chính tài khoản đang đăng nhập')
  await prisma.user.update({ where: { id }, data: { status: next } })
  await prisma.auditLog.create({ data: { actorId: actor.user.id, action: 'USER_STATUS_UPDATE', entityType: 'User', entityId: id, metadata: { status: next } } })
  revalidatePath('/admin/users')
}
