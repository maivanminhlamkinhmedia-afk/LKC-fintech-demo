'use server'

import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/authz'

const TEAM_WRITE_ROLES = ['SUPER_ADMIN', 'ADMIN'] as const

function requiredId(value: FormDataEntryValue | null, label: string) {
  const id = String(value ?? '').trim()
  if (!id || id.length > 191) throw new Error(`${label} không hợp lệ`)
  return id
}

function teamName(value: FormDataEntryValue | null) {
  const name = String(value ?? '').trim()
  if (!name || name.length > 120) throw new Error('Tên đội phải có từ 1 đến 120 ký tự')
  return name
}

async function activeSalesManager(tx: Prisma.TransactionClient, managerId: string) {
  const manager = await tx.user.findFirst({
    where: { id: managerId, role: 'SALES_MANAGER', status: 'ACTIVE' },
    select: { id: true },
  })
  if (!manager) throw new Error('Quản lý Sales không tồn tại, không hoạt động hoặc sai vai trò')
  return manager
}

function refreshTeams(teamId?: string) {
  revalidatePath('/sales/teams')
  if (teamId) revalidatePath(`/sales/teams/${teamId}`)
}

export async function createSalesTeam(formData: FormData) {
  const actor = await requireRole(TEAM_WRITE_ROLES)
  const name = teamName(formData.get('name'))
  const managerId = requiredId(formData.get('managerId'), 'Manager ID')
  const team = await prisma.$transaction(async (tx) => {
    await activeSalesManager(tx, managerId)
    const created = await tx.salesTeam.create({ data: { name, managerId } })
    await tx.auditLog.create({ data: { actorId: actor.user.id, action: 'SALES_TEAM_CREATE', entityType: 'SalesTeam', entityId: created.id, metadata: { name, managerId } } })
    return created
  })
  refreshTeams(team.id)
}

export async function renameSalesTeam(formData: FormData) {
  const actor = await requireRole(TEAM_WRITE_ROLES)
  const teamId = requiredId(formData.get('teamId'), 'Team ID')
  const name = teamName(formData.get('name'))
  await prisma.$transaction(async (tx) => {
    const current = await tx.salesTeam.findUnique({ where: { id: teamId }, select: { name: true } })
    if (!current) throw new Error('Không tìm thấy đội Sales')
    if (current.name === name) return
    await tx.salesTeam.update({ where: { id: teamId }, data: { name } })
    await tx.auditLog.create({ data: { actorId: actor.user.id, action: 'SALES_TEAM_RENAME', entityType: 'SalesTeam', entityId: teamId, metadata: { previousName: current.name, newName: name } } })
  })
  refreshTeams(teamId)
}

export async function changeSalesTeamManager(formData: FormData) {
  const actor = await requireRole(TEAM_WRITE_ROLES)
  const teamId = requiredId(formData.get('teamId'), 'Team ID')
  const managerId = requiredId(formData.get('managerId'), 'Manager ID')
  await prisma.$transaction(async (tx) => {
    const current = await tx.salesTeam.findUnique({ where: { id: teamId }, select: { managerId: true } })
    if (!current) throw new Error('Không tìm thấy đội Sales')
    await activeSalesManager(tx, managerId)
    if (current.managerId === managerId) return
    await tx.salesTeam.update({ where: { id: teamId }, data: { managerId } })
    await tx.auditLog.create({ data: { actorId: actor.user.id, action: 'SALES_TEAM_MANAGER_CHANGE', entityType: 'SalesTeam', entityId: teamId, metadata: { previousManagerId: current.managerId, newManagerId: managerId } } })
  })
  refreshTeams(teamId)
}

export async function addSalesTeamMember(formData: FormData) {
  const actor = await requireRole(TEAM_WRITE_ROLES)
  const teamId = requiredId(formData.get('teamId'), 'Team ID')
  const userId = requiredId(formData.get('userId'), 'User ID')
  await prisma.$transaction(async (tx) => {
    const [team, member, existing] = await Promise.all([
      tx.salesTeam.findUnique({ where: { id: teamId }, select: { id: true } }),
      tx.user.findFirst({ where: { id: userId, role: 'SALES', status: 'ACTIVE' }, select: { id: true } }),
      tx.salesTeamMember.findFirst({ where: { userId }, select: { id: true, teamId: true } }),
    ])
    if (!team) throw new Error('Không tìm thấy đội Sales')
    if (!member) throw new Error('Nhân viên phải đang hoạt động và có vai trò SALES')
    if (existing?.teamId === teamId) throw new Error('Nhân viên đã thuộc đội này')
    if (existing) throw new Error('Nhân viên đã thuộc một đội Sales khác')
    const membership = await tx.salesTeamMember.create({ data: { teamId, userId } })
    await tx.auditLog.create({ data: { actorId: actor.user.id, action: 'SALES_TEAM_MEMBER_ADD', entityType: 'SalesTeamMember', entityId: membership.id, metadata: { teamId, userId } } })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  refreshTeams(teamId)
}

export async function removeSalesTeamMember(formData: FormData) {
  const actor = await requireRole(TEAM_WRITE_ROLES)
  const teamId = requiredId(formData.get('teamId'), 'Team ID')
  const membershipId = requiredId(formData.get('membershipId'), 'Membership ID')
  await prisma.$transaction(async (tx) => {
    const membership = await tx.salesTeamMember.findFirst({ where: { id: membershipId, teamId }, select: { id: true, teamId: true, userId: true } })
    if (!membership) throw new Error('Không tìm thấy thành viên trong đội này')
    await tx.salesTeamMember.delete({ where: { id: membership.id } })
    await tx.auditLog.create({ data: { actorId: actor.user.id, action: 'SALES_TEAM_MEMBER_REMOVE', entityType: 'SalesTeamMember', entityId: membership.id, metadata: { teamId: membership.teamId, userId: membership.userId } } })
  })
  refreshTeams(teamId)
}
