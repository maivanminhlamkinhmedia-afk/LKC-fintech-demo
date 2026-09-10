import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/authz'
import { APP_ROLES, ROLE_LABELS } from '@/lib/roles'
import { createUser, toggleUserStatus, updateUserRole } from '@/features/users/actions'

export default async function AdminUsersPage() {
  await requirePermission('users:read')
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })

  return (
    <section>
      <h1 className="text-3xl font-bold">Quản lý người dùng</h1>
      <p className="mt-2 text-slate-500">Khách hàng, Sales, Quản lý Sales, Creator, Analyst, Employee và Admin.</p>

      <form action={createUser} className="mt-7 grid gap-3 rounded-2xl bg-white p-5 shadow-sm md:grid-cols-2 xl:grid-cols-5">
        <input name="name" required placeholder="Họ tên" className="rounded-xl border px-3 py-2" />
        <input name="email" required type="email" placeholder="Email" className="rounded-xl border px-3 py-2" />
        <input name="password" required type="password" minLength={10} placeholder="Mật khẩu >= 10 ký tự" className="rounded-xl border px-3 py-2" />
        <select name="role" defaultValue="CLIENT" className="rounded-xl border px-3 py-2">
          {APP_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
        </select>
        <button className="rounded-xl bg-[#1B4FA0] px-4 py-2 font-semibold text-white">Tạo user</button>
      </form>

      <div className="mt-6 overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="p-4">Người dùng</th><th className="p-4">Vai trò</th><th className="p-4">Trạng thái</th><th className="p-4">Thao tác</th></tr></thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-t">
                <td className="p-4"><div className="font-semibold">{user.name}</div><div className="text-slate-500">{user.email}</div></td>
                <td className="p-4">
                  <form action={updateUserRole} className="flex gap-2">
                    <input type="hidden" name="id" value={user.id} />
                    <select name="role" defaultValue={user.role} className="rounded-lg border px-2 py-1">
                      {APP_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                    </select>
                    <button className="rounded-lg border px-2 py-1">Lưu</button>
                  </form>
                </td>
                <td className="p-4">{user.status}</td>
                <td className="p-4">
                  <form action={toggleUserStatus}>
                    <input type="hidden" name="id" value={user.id} />
                    <input type="hidden" name="current" value={user.status} />
                    <button className="rounded-lg border px-3 py-1.5">{user.status === 'ACTIVE' ? 'Tạm khóa' : 'Kích hoạt'}</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
