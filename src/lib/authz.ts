import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { hasPermission, type AppRole, type Permission } from '@/lib/roles'

export async function requireUser() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect('/dang-nhap')
  return session
}

export async function requireRole(roles: readonly AppRole[]) {
  const session = await requireUser()
  if (!roles.includes(session.user.role)) redirect('/dashboard')
  return session
}

export async function requirePermission(permission: Permission) {
  const session = await requireUser()
  if (!hasPermission(session.user.role, permission)) redirect('/dashboard')
  return session
}
