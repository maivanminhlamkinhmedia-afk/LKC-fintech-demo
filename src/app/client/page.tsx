import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/authz'

export default async function ClientPage() {
  const session = await requirePermission('account:self')
  const profile = await prisma.customerProfile.findUnique({ where: { userId: session.user.id }, include: { assignedSales: true } })
  return (
    <section>
      <h1 className="text-3xl font-bold">Tài khoản khách hàng</h1>
      <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">Mã khách hàng</p><p className="mt-1 text-xl font-semibold">{profile?.customerCode ?? 'Đang khởi tạo'}</p>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Trạng thái</p><p className="mt-1 font-semibold">{profile?.status ?? 'PROSPECT'}</p></div>
          <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Sales phụ trách</p><p className="mt-1 font-semibold">{profile?.assignedSales?.name ?? 'Chưa phân công'}</p></div>
          <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Email</p><p className="mt-1 font-semibold">{session.user.email}</p></div>
        </div>
      </div>
    </section>
  )
}
