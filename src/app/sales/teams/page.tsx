import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/authz'
import { createSalesTeam } from '@/features/crm/team-actions'

const TEAM_READ_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER'] as const

export default async function SalesTeamsPage() {
  const session = await requireRole(TEAM_READ_ROLES)
  const canManage = session.user.role === 'SUPER_ADMIN' || session.user.role === 'ADMIN'
  const [teams, managers] = await Promise.all([
    prisma.salesTeam.findMany({
      where: session.user.role === 'SALES_MANAGER' ? { managerId: session.user.id } : {},
      include: { manager: true, _count: { select: { members: true } } },
      orderBy: { name: 'asc' },
    }),
    canManage ? prisma.user.findMany({ where: { role: 'SALES_MANAGER', status: 'ACTIVE' }, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } }) : Promise.resolve([]),
  ])

  return (
    <section className="space-y-8">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wider text-[#2BAD97]">Sales CRM</p>
        <h1 className="mt-2 text-3xl font-bold">Đội ngũ Sales</h1>
        <p className="mt-2 text-slate-500">{canManage ? 'Tạo đội, phân công quản lý và quản lý thành viên Sales.' : 'Các đội Sales do bạn quản lý.'}</p>
      </div>
      {canManage && (
        <form action={createSalesTeam} className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold">Tạo đội Sales</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <label className="text-sm"><span className="mb-1 block text-slate-500">Tên đội</span><input name="name" required maxLength={120} className="w-full rounded-xl border px-3 py-2" /></label>
            <label className="text-sm"><span className="mb-1 block text-slate-500">Quản lý Sales</span><select name="managerId" required defaultValue="" className="w-full rounded-xl border px-3 py-2"><option value="" disabled>Chọn quản lý</option>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name} · {manager.email}</option>)}</select></label>
            <button className="rounded-xl bg-[#1B4FA0] px-5 py-2.5 font-semibold text-white">Tạo đội</button>
          </div>
        </form>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {teams.map((team) => <Link key={team.id} href={`/sales/teams/${team.id}`} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md"><h2 className="text-lg font-semibold">{team.name}</h2><p className="mt-2 text-sm text-slate-500">Quản lý: {team.manager.name}</p><p className="mt-1 text-sm text-slate-500">{team._count.members} thành viên</p></Link>)}
        {teams.length === 0 && <p className="text-sm text-slate-500">Không có đội Sales nào trong phạm vi truy cập.</p>}
      </div>
    </section>
  )
}
