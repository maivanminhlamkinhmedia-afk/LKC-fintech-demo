import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/authz'
import { customerSalesScope } from '@/features/crm/access'
import { assignCustomerToSales } from '@/features/crm/assignment-actions'

const ASSIGNMENT_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'SALES_MANAGER',
] as const

export default async function SalesAssignmentPage() {
  const session = await requireRole(ASSIGNMENT_ROLES)

  const isGlobal =
    session.user.role === 'SUPER_ADMIN' ||
    session.user.role === 'ADMIN'

  const customers = await prisma.customerProfile.findMany({
    where: isGlobal
      ? {}
      : customerSalesScope(session.user),

    include: {
      user: true,
      assignedSales: true,
    },

    orderBy: [
      {
        priority: 'desc',
      },
      {
        updatedAt: 'desc',
      },
    ],

    take: 300,
  })

  const salesUsers = await prisma.user.findMany({
    where: {
      role: 'SALES',
      status: 'ACTIVE',

      ...(session.user.role === 'SALES_MANAGER'
        ? {
            salesMemberships: {
              some: {
                team: {
                  managerId: session.user.id,
                },
              },
            },
          }
        : {}),
    },

    orderBy: {
      name: 'asc',
    },

    select: {
      id: true,
      name: true,
      email: true,
    },
  })

  return (
    <section>
      <Link
        href="/sales"
        className="text-sm font-medium text-blue-600 hover:underline"
      >
        ← Dashboard Sales
      </Link>

      <h1 className="mt-4 text-3xl font-bold">
        Phân công khách hàng
      </h1>

      <p className="mt-2 text-slate-500">
        Admin có thể phân công toàn bộ khách hàng. Quản lý
        Sales chỉ thao tác trong phạm vi team mình.
      </p>

      <div className="mt-8 overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="p-4">Khách hàng</th>
              <th className="p-4">Trạng thái</th>
              <th className="p-4">Priority</th>
              <th className="p-4">Sales hiện tại</th>
              <th className="p-4">Phân công</th>
            </tr>
          </thead>

          <tbody>
            {customers.map((customer) => (
              <tr
                key={customer.id}
                className="border-t"
              >
                <td className="p-4">
                  <Link
                    href={`/sales/customers/${customer.id}`}
                    className="font-semibold hover:underline"
                  >
                    {customer.user.name}
                  </Link>

                  <p className="mt-1 text-xs text-slate-500">
                    {customer.customerCode}
                  </p>

                  <p className="text-xs text-slate-400">
                    {customer.user.email}
                  </p>
                </td>

                <td className="p-4">
                  {customer.status}
                </td>

                <td className="p-4">
                  {customer.priority}
                </td>

                <td className="p-4">
                  {customer.assignedSales?.name ??
                    'Chưa phân công'}
                </td>

                <td className="p-4">
                  <form
                    action={assignCustomerToSales}
                    className="flex min-w-[280px] gap-2"
                  >
                    <input
                      type="hidden"
                      name="customerId"
                      value={customer.id}
                    />

                    <select
                      name="salesId"
                      required
                      defaultValue={
                        customer.assignedSalesId ?? ''
                      }
                      className="min-w-0 flex-1 rounded-lg border px-2 py-2"
                    >
                      <option value="" disabled>
                        Chọn Sales
                      </option>

                      {salesUsers.map((sales) => (
                        <option
                          key={sales.id}
                          value={sales.id}
                        >
                          {sales.name} — {sales.email}
                        </option>
                      ))}
                    </select>

                    <button className="rounded-lg bg-[#1B4FA0] px-3 py-2 font-semibold text-white">
                      Giao
                    </button>
                  </form>
                </td>
              </tr>
            ))}

            {customers.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="p-8 text-center text-slate-500"
                >
                  Không có khách hàng trong phạm vi quản lý.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}