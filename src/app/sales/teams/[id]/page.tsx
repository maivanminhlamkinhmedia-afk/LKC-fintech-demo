import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/authz'
import { changeSalesTeamManager, renameSalesTeam } from '@/features/crm/team-actions'
import { AddTeamMemberForm, RemoveTeamMemberForm } from '@/features/crm/components/TeamMemberForms'

const TEAM_READ_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER'] as const

export default async function SalesTeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(TEAM_READ_ROLES)
  const { id } = await params
  const canManage = session.user.role === 'SUPER_ADMIN' || session.user.role === 'ADMIN'
  const team = await prisma.salesTeam.findFirst({
    where: { id, ...(session.user.role === 'SALES_MANAGER' ? { managerId: session.user.id } : {}) },
    select: {
      id: true,
      name: true,
      managerId: true,
      manager: { select: { name: true, email: true } },
      members: {
        select: { id: true, user: { select: { name: true, email: true, status: true } } },
        orderBy: { user: { name: 'asc' } },
      },
    },
  })
  if (!team) notFound()

  const [managers, availableSales] = canManage ? await Promise.all([
    prisma.user.findMany({ where: { role: 'SALES_MANAGER', status: 'ACTIVE' }, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } }),
    prisma.user.findMany({ where: { role: 'SALES', status: 'ACTIVE', salesMemberships: { none: {} } }, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } }),
  ]) : [[], []]

  return (
    <section className="space-y-8">
      <div><Link href="/sales/teams" className="text-sm font-medium text-blue-600 hover:underline">← Danh sách đội Sales</Link><h1 className="mt-4 text-3xl font-bold">{team.name}</h1><p className="mt-2 text-slate-500">Quản lý: {team.manager.name} · {team.manager.email}</p></div>
      {canManage && (
        <div className="grid gap-6 xl:grid-cols-2">
          <form action={renameSalesTeam} className="rounded-2xl bg-white p-6 shadow-sm"><input type="hidden" name="teamId" value={team.id} /><h2 className="text-lg font-bold">Đổi tên đội</h2><div className="mt-4 flex gap-2"><input name="name" required maxLength={120} defaultValue={team.name} className="min-w-0 flex-1 rounded-xl border px-3 py-2" /><button className="rounded-xl bg-[#1B4FA0] px-4 py-2 font-semibold text-white">Lưu</button></div></form>
          <form action={changeSalesTeamManager} className="rounded-2xl bg-white p-6 shadow-sm"><input type="hidden" name="teamId" value={team.id} /><h2 className="text-lg font-bold">Đổi quản lý</h2><div className="mt-4 flex gap-2"><select name="managerId" required defaultValue={team.managerId} className="min-w-0 flex-1 rounded-xl border px-3 py-2">{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name} · {manager.email}</option>)}</select><button className="rounded-xl bg-[#1B4FA0] px-4 py-2 font-semibold text-white">Lưu</button></div></form>
        </div>
      )}
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold">Thành viên</h2>
            <p className="mt-1 text-sm text-slate-500">Chỉ tài khoản SALES đang hoạt động mới có thể được thêm.</p>
          </div>
          {canManage && <AddTeamMemberForm teamId={team.id} sales={availableSales} />}
        </div>
        <div className="mt-6 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr><th className="p-4">Thành viên</th><th className="p-4">Email</th><th className="p-4">Trạng thái</th>{canManage && <th className="p-4">Thao tác</th>}</tr>
            </thead>
            <tbody>
              {team.members.map((membership) => (
                <tr key={membership.id} className="border-t">
                  <td className="p-4 align-top font-semibold">{membership.user.name}</td>
                  <td className="p-4 align-top">{membership.user.email}</td>
                  <td className="p-4 align-top">{membership.user.status}</td>
                  {canManage && <td className="p-4 align-top"><RemoveTeamMemberForm teamId={team.id} membershipId={membership.id} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {team.members.length === 0 && <p className="p-4 text-sm text-slate-500">Đội chưa có thành viên.</p>}
        </div>
      </div>
    </section>
  )
}
