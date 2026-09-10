import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/authz'

export default async function SalesCustomersPage() {
  const session = await requirePermission('sales:read')
  const role = session.user.role

  const where =
    role === 'SUPER_ADMIN' ||
    role === 'ADMIN' ||
    role === 'MANAGER'
      ? {}
      : role === 'SALES_MANAGER'
        ? {
            assignedSales: {
              salesMemberships: {
                some: {
                  team: {
                    managerId: session.user.id,
                  },
                },
              },
            },
          }
        : {
            assignedSalesId: session.user.id,
          }

  const customers = await prisma.customerProfile.findMany({
    where,
    include: {
      user: true,
      assignedSales: true,
    },
    orderBy: {
      updatedAt: 'desc',
    },
    take: 300,
  })

  return (
    <section>
      <h1 className="text-3xl font-bold">Khách hàng Sales</h1>

      <p className="mt-2 text-slate-500">
        Sales chỉ thấy khách được giao; Quản lý Sales chỉ thấy khách
        thuộc đội mình phụ trách.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {customers.map((customer) => (
          <article
            key={customer.id}
            className="rounded-2xl bg-white p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">
                  {customer.user.name}
                </h2>

                <p className="text-sm text-slate-500">
                  {customer.customerCode}
                </p>
              </div>

              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">
                {customer.status}
              </span>
            </div>

            <p className="mt-4 text-sm">
              {customer.user.email}
            </p>

            <p className="mt-2 text-xs text-slate-500">
              Sales phụ trách:{' '}
              {customer.assignedSales?.name ?? 'Chưa phân công'}
            </p>
          </article>
        ))}
      </div>
    </section>
  )
}