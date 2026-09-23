import Link from 'next/link'
import { requireUser } from '@/lib/authz'
import { hasPermission, ROLE_LABELS } from '@/lib/roles'

export default async function DashboardPage() {
  const session = await requireUser()
  const role = session.user.role
  const cards = [
    ['Biểu đồ & chỉ báo', '/dashboard/chart', hasPermission(role, 'chart:use')],
    ['Tài khoản của tôi', '/client', hasPermission(role, 'account:self')],
    ['Quản lý khách hàng Sales', '/sales/customers', hasPermission(role, 'sales:read')],
    ['Khu người tạo nội dung', '/creator', hasPermission(role, 'cms:access')],
    ['Quản lý người dùng', '/admin/users', hasPermission(role, 'users:read')],
    ['Tài liệu học tập', '/kien-thuc', hasPermission(role, 'learning:use')],
  ].filter(([, , show]) => show)

  return (
    <section>
      <p className="text-sm font-semibold uppercase tracking-wider text-[#2BAD97]">LKC Portal</p>
      <h1 className="mt-2 text-3xl font-bold">Xin chào, {session.user.name}</h1>
      <p className="mt-2 text-slate-500">Vai trò: {ROLE_LABELS[role]}</p>
      <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map(([title, href]) => (
          <Link key={String(href)} href={String(href)} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md">
            <h2 className="font-semibold">{String(title)}</h2>
            <p className="mt-2 text-sm text-slate-500">Mở module →</p>
          </Link>
        ))}
      </div>
    </section>
  )
}
