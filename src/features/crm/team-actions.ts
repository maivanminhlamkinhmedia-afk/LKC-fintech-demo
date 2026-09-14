'use server'

import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/authz'
import { createRemovalConfirmation, verifyRemovalConfirmation } from '@/features/crm/team-removal-confirmation'

const TEAM_WRITE_ROLES = ['SUPER_ADMIN', 'ADMIN'] as const

export type TeamMemberActionState = {
  kind: 'idle' | 'success' | 'error' | 'warning'
  message: string
  confirmation?: {
    token: string
    teamId: string
    membershipId: string
    userId: string
    salesName: string
    salesEmail: string
    assignedCustomerCount: number
    nonClosedCustomerCount: number
  }
}

class TeamMemberActionError extends Error {}

function singleMemberField(formData: FormData, name: string) {
  const values = formData.getAll(name)
  return values.length === 1 && typeof values[0] === 'string' ? values[0] : null
}

function memberActionId(formData: FormData, name: string, label: string) {
  const value = singleMemberField(formData, name)
  if (!value || !/^[A-Za-z0-9_-]{1,191}$/.test(value)) {
    throw new TeamMemberActionError(`${label} không hợp lệ.`)
  }
  return value
}

function memberActionError(error: unknown): TeamMemberActionState {
  if (error instanceof TeamMemberActionError) return { kind: 'error', message: error.message }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return { kind: 'error', message: 'Nhân viên đã thuộc một đội Sales. Vui lòng tải lại trang.' }
    if (error.code === 'P2034' || error.code === 'P2025') {
      return { kind: 'error', message: 'Dữ liệu vừa thay đổi. Vui lòng tải lại trang và thử lại.' }
    }
  }
  throw error
}

function refreshMembership(teamId: string) {
  refreshTeams(teamId)
  revalidatePath('/sales')
  revalidatePath('/sales/assignment')
  revalidatePath('/sales/customers')
  revalidatePath('/sales/customers/[id]', 'page')
  revalidatePath('/sales/pipeline')
}

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

export async function addSalesTeamMember(_previousState: TeamMemberActionState, formData: FormData): Promise<TeamMemberActionState> {
  const actor = await requireRole(TEAM_WRITE_ROLES)
  if (!(formData instanceof FormData)) return { kind: 'error', message: 'Dữ liệu thành viên không hợp lệ.' }
  let teamId: string
  try {
    teamId = memberActionId(formData, 'teamId', 'Mã đội')
    const userId = memberActionId(formData, 'userId', 'Mã nhân viên')
    await prisma.$transaction(async (tx) => {
      const [team, member, existing] = await Promise.all([
        tx.salesTeam.findUnique({ where: { id: teamId }, select: { id: true } }),
        tx.user.findFirst({ where: { id: userId, role: 'SALES', status: 'ACTIVE' }, select: { id: true } }),
        tx.salesTeamMember.findFirst({ where: { userId }, select: { id: true, teamId: true } }),
      ])
      if (!team) throw new TeamMemberActionError('Không tìm thấy đội Sales.')
      if (!member) throw new TeamMemberActionError('Nhân viên phải đang hoạt động và có vai trò SALES.')
      if (existing?.teamId === teamId) throw new TeamMemberActionError('Nhân viên đã thuộc đội này.')
      if (existing) throw new TeamMemberActionError('Nhân viên đã thuộc một đội Sales khác.')
      const membership = await tx.salesTeamMember.create({ data: { teamId, userId } })
      await tx.auditLog.create({ data: { actorId: actor.user.id, action: 'SALES_TEAM_MEMBER_ADD', entityType: 'SalesTeamMember', entityId: membership.id, metadata: { teamId, userId } } })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) {
    return memberActionError(error)
  }
  refreshMembership(teamId)
  return { kind: 'success', message: 'Đã thêm thành viên vào đội Sales.' }
}

export async function removeSalesTeamMember(_previousState: TeamMemberActionState, formData: FormData): Promise<TeamMemberActionState> {
  const actor = await requireRole(TEAM_WRITE_ROLES)
  if (!(formData instanceof FormData)) return { kind: 'error', message: 'Dữ liệu thành viên không hợp lệ.' }
  let teamId: string
  let result: TeamMemberActionState
  try {
    teamId = memberActionId(formData, 'teamId', 'Mã đội')
    const membershipId = memberActionId(formData, 'membershipId', 'Mã thành viên')
    const hasConfirmation = formData.has('confirmationToken') || formData.has('confirmation')
    const confirmationToken = singleMemberField(formData, 'confirmationToken')
    const acknowledgement = singleMemberField(formData, 'confirmation')
    if (hasConfirmation && (!confirmationToken || acknowledgement !== 'REMOVE_MEMBERSHIP_KEEP_ASSIGNMENTS')) {
      throw new TeamMemberActionError('Xác nhận không hợp lệ. Vui lòng bắt đầu lại thao tác xóa thành viên.')
    }

    result = await prisma.$transaction(async (tx): Promise<TeamMemberActionState> => {
      const [team, membership] = await Promise.all([
        tx.salesTeam.findUnique({ where: { id: teamId }, select: { id: true } }),
        tx.salesTeamMember.findFirst({ where: { id: membershipId, teamId }, select: { id: true, teamId: true, userId: true, createdAt: true } }),
      ])
      if (!team || !membership) throw new TeamMemberActionError('Không tìm thấy thành viên trong đội này.')
      // User identity and counts come only from the current membership, never a submitted userId/count.
      const [member, assignedCustomerCount, nonClosedCustomerCount] = await Promise.all([
        tx.user.findUnique({ where: { id: membership.userId }, select: { id: true, name: true, email: true } }),
        tx.customerProfile.count({ where: { assignedSalesId: membership.userId } }),
        tx.customerProfile.count({ where: { assignedSalesId: membership.userId, status: { not: 'CLOSED' } } }),
      ])
      if (!member) throw new TeamMemberActionError('Không tìm thấy tài khoản thành viên.')
      const binding = {
        actorId: actor.user.id, teamId: team.id, membershipId: membership.id,
        userId: member.id, membershipCreatedAt: membership.createdAt.toISOString(),
      }
      // Validate any supplied token even when the latest assigned-customer count is zero.
      if (hasConfirmation && !verifyRemovalConfirmation(confirmationToken!, binding)) {
        throw new TeamMemberActionError('Xác nhận không hợp lệ hoặc đã hết hạn. Vui lòng bắt đầu lại thao tác xóa thành viên.')
      }
      if (assignedCustomerCount > 0 && !hasConfirmation) {
        return {
          kind: 'warning',
          message: 'Xóa thành viên không phân công lại khách hàng hoặc công việc. Quyền xem khách hàng của quản lý đội có thể thay đổi. Vui lòng xác nhận rõ trước khi tiếp tục.',
          confirmation: {
            token: createRemovalConfirmation(binding), teamId: team.id, membershipId: membership.id,
            userId: member.id, salesName: member.name, salesEmail: member.email,
            assignedCustomerCount, nonClosedCustomerCount,
          },
        }
      }
      await tx.salesTeamMember.delete({ where: { id: membership.id } })
      await tx.auditLog.create({ data: {
        actorId: actor.user.id, action: 'SALES_TEAM_MEMBER_REMOVE', entityType: 'SalesTeamMember', entityId: membership.id,
        metadata: { teamId: membership.teamId, userId: member.id, assignedCustomerCount, nonClosedCustomerCount, confirmationUsed: hasConfirmation },
      } })
      return { kind: 'success', message: 'Đã xóa thành viên khỏi đội. Phân công khách hàng và công việc được giữ nguyên.' }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) {
    return memberActionError(error)
  }
  if (result.kind === 'success') refreshMembership(teamId)
  return result
}
