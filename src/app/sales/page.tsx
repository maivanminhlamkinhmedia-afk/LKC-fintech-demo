import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/authz'
import { customerSalesScope } from '@/features/crm/access'

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
    overdueFollowups,
    openTasks,
    overdueTasks,
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

    prisma.customerProfile.count({
      where: {
        ...scope,
        nextContactAt: {
          lt: now,
        },
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
    ['Follow-up quá hạn', overdueFollowups],
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
      </div>
    </section>
  )
}