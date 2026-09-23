'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import type { AppRole } from '@/lib/roles'
import { ROLE_LABELS, hasPermission } from '@/lib/roles'
import { canReadCRMAudit } from '@/features/crm/audit-access'

export function PortalShell({
  children,
  user,
}: {
  children: React.ReactNode
  user: { name?: string | null; email?: string | null; role: AppRole }
}) {
  const pathname = usePathname()
  const links = [
    { href: '/dashboard', label: 'Tổng quan', show: true },
    { href: '/dashboard/chart', label: 'Biểu đồ & chỉ báo', show: hasPermission(user.role, 'chart:use') },
    { href: '/client', label: 'Tài khoản của tôi', show: hasPermission(user.role, 'account:self') },
    { href: '/sales', label: 'Sales CRM', show: hasPermission(user.role, 'sales:read') },

{ href: '/sales/customers', label: 'Khách hàng Sales', show: hasPermission(user.role, 'sales:read') },
    { href: '/sales/pipeline', label: 'Pipeline khách hàng', show: hasPermission(user.role, 'sales:read') },
    { href: '/sales/follow-ups', label: 'Follow-ups', show: hasPermission(user.role, 'sales:read') },
    { href: '/sales/reports', label: 'Báo cáo CRM', show: hasPermission(user.role, 'sales:read') },
    { href: '/sales/audit', label: 'Nhật ký thao tác CRM', show: canReadCRMAudit(user.role) },

{
  href: '/sales/assignment',
  label: 'Phân công khách',
  show: ['SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER'].includes(user.role),
},
    {
      href: '/sales/teams',
      label: 'Đội ngũ Sales',
      show: ['SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER'].includes(user.role),
    },
    { href: '/creator', label: 'Khu người tạo', show: hasPermission(user.role, 'cms:access') },
    { href: '/admin/users', label: 'Quản lý User', show: hasPermission(user.role, 'users:read') },
    { href: '/kien-thuc', label: 'Kiến thức', show: hasPermission(user.role, 'learning:use') },
  ].filter((x) => x.show)

  return (
    <div className="min-h-screen bg-slate-100 text-[#0A1628] lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="bg-[#071528] text-white px-5 py-6">
        <Link href="/" className="text-xl font-bold">LKC Fintech</Link>
        <div className="mt-6 rounded-2xl bg-white/10 p-4">
          <p className="font-semibold">{user.name || user.email}</p>
          <p className="mt-1 text-xs text-white/60">{ROLE_LABELS[user.role]}</p>
        </div>
        <nav className="mt-6 space-y-1">
          {links.map((link) => (
            <Link key={link.href} href={link.href} prefetch={link.href === '/sales/audit' ? false : undefined} data-audit-link={link.href === '/sales/audit' ? '' : undefined} className={`block rounded-xl px-4 py-3 text-sm ${pathname === link.href ? 'bg-[#2BAD97] text-white' : 'text-white/75 hover:bg-white/10 hover:text-white'}`}>
              {link.label}
            </Link>
          ))}
        </nav>
        <button onClick={() => signOut({ callbackUrl: '/' })} className="mt-8 w-full rounded-xl border border-white/20 px-4 py-3 text-left text-sm text-white/80 hover:bg-white/10">Đăng xuất</button>
      </aside>
      <main className="p-5 md:p-8 lg:p-10">{children}</main>
    </div>
  )
}
