import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/authz'
import { customerSalesScope } from '@/features/crm/access'
import { getContactHealth } from '@/features/crm/contact-health'
import { ContactHealthSummary } from '@/features/crm/components/ContactHealthSummary'

export default async function SalesDashboardPage() {
  const session = await requirePermission('sales:read')
  const scope = customerSalesScope(session.user)
  const now = new Date()

  const [
    total,
    leads,
    prospects,
    active,
    highPriority,
    openTasks,
    overdueTasks,
    contactHealth,
  ] = await Promise.all([
    prisma.customerProfile.count({
      where: scope,
    }),

    prisma.customerProfile.count({
      where: {
        ...scope,
        status: 'LEAD',
      },
    }),

    prisma.customerProfile.count({
      where: {
        ...scope,
        status: 'PROSPECT',
      },
    }),

    prisma.customerProfile.count({
      where: {
        ...scope,
        status: 'ACTIVE',
      },
    }),

    prisma.customerProfile.count({
      where: {
        ...scope,
        priority: 'HIGH',
        status: {
          not: 'CLOSED',
        },
      },
    }),

    prisma.customerTask.count({
      where: {
        status: {
          in: ['TODO', 'IN_PROGRESS'],
        },
        customer: {
          is: scope,
        },
      },
    }),

    prisma.customerTask.count({
      where: {
        status: {
          in: ['TODO', 'IN_PROGRESS'],
        },
        dueAt: {
          lt: now,
        },
        customer: {
          is: scope,
        },
      },
    }),
    getContactHealth(session.user, now),
  ])

  const canAssign = [
    'SUPER_ADMIN',
    'ADMIN',
    'SALES_MANAGER',
  ].includes(session.user.role)

  const cards = [
    ['Tổng khách hàng', total],
    ['Lead', leads],
    ['Prospect', prospects],
    ['Active', active],
    ['Ưu tiên cao', highPriority],
    ['Task đang mở', openTasks],
    ['Task quá hạn', overdueTasks],
  ]

  return (
    <section>
      <div>
        <p className="text-sm font-semibold uppercase tracking-wider text-[#2BAD97]">
          LKC Sales CRM
        </p>

        <h1 className="mt-2 text-3xl font-bold">
          Dashboard Sales
        </h1>

        <p className="mt-2 text-slate-500">
          Tổng quan khách hàng, follow-up và công việc CRM.
        </p>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded-2xl bg-white p-5 shadow-sm"
          >
            <p className="text-sm text-slate-500">
              {String(label)}
            </p>

            <p className="mt-2 text-3xl font-bold">
              {Number(value)}
            </p>
          </div>
        ))}
      </div>

      <ContactHealthSummary counts={contactHealth} />

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Link
          href="/sales/customers"
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
        >
          <h2 className="text-lg font-semibold">
            Khách hàng CRM
          </h2>

          <p className="mt-2 text-sm text-slate-500">
            Xem hồ sơ, activity timeline và follow-up tasks.
          </p>
        </Link>

        <Link
          href="/sales/pipeline"
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
        >
          <h2 className="text-lg font-semibold">
            Pipeline khách hàng
          </h2>

          <p className="mt-2 text-sm text-slate-500">
            Lọc khách hàng và theo dõi tiến trình theo trạng thái.
          </p>
        </Link>

        <Link
          href="/sales/follow-ups"
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
        >
          <h2 className="text-lg font-semibold">
            Follow-up Workbench
          </h2>

          <p className="mt-2 text-sm text-slate-500">
            Theo dõi hạn công việc, lọc task và cập nhật trạng thái.
          </p>
        </Link>

        <Link
          href="/sales/reports"
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
        >
          <h2 className="text-lg font-semibold">
            Báo cáo CRM
          </h2>

          <p className="mt-2 text-sm text-slate-500">
            Xem danh mục khách hàng, khối lượng công việc và hoạt động theo kỳ.
          </p>
        </Link>

        {canAssign && (
          <Link
            href="/sales/assignment"
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
          >
            <h2 className="text-lg font-semibold">
              Phân công khách hàng
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              Chuyển khách hàng cho Sales phù hợp.
            </p>
          </Link>
        )}

        {canAssign && (
          <Link
            href="/sales/teams"
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
          >
            <h2 className="text-lg font-semibold">
              Đội ngũ Sales
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              Xem đội Sales, quản lý và thành viên trong phạm vi truy cập.
            </p>
          </Link>
        )}
      </div>
    </section>
  )
}
