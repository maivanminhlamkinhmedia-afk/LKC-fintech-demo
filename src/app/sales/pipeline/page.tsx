import Link from 'next/link'
import { requirePermission } from '@/lib/authz'
import { hasPermission } from '@/lib/roles'
import {
  type CRMSearchParams,
  filtersHref,
  formatCRMDate,
  isOverdueFollowUp,
  parseCustomerFilters,
} from '@/features/crm/customer-filters'
import { getCustomerFilterOptions, getPipelineCustomers } from '@/features/crm/customer-queries'
import { CustomerFiltersForm } from '@/features/crm/components/CustomerFiltersForm'
import { PipelineStatusForm } from '@/features/crm/components/PipelineStatusForm'

export default async function SalesPipelinePage({
  searchParams,
}: {
  searchParams: Promise<CRMSearchParams>
}) {
  const session = await requirePermission('sales:read')
  const { filters, invalidKeys } = parseCustomerFilters(await searchParams)
  const now = new Date()
  const [{ columns }, options] = await Promise.all([
    getPipelineCustomers(session.user, filters, now),
    getCustomerFilterOptions(session.user),
  ])
  const canChangeStatus = hasPermission(session.user.role, 'sales:write')
  const total = columns.reduce((count, column) => count + column.total, 0)

  return (
    <section className="mx-auto min-w-0 max-w-7xl space-y-6 px-5 py-8 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/sales" className="text-sm font-medium text-blue-600 hover:underline">← Dashboard Sales</Link>
          <h1 className="mt-3 text-3xl font-bold">Pipeline khách hàng</h1>
          <p className="mt-2 text-slate-500">
            Theo dõi khách hàng theo trạng thái và lịch liên hệ tiếp theo.
          </p>
        </div>
        <Link
          href={filtersHref('/sales/customers', filters, { page: 1 })}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-[#1B4FA0] hover:bg-slate-50"
        >
          Xem danh sách khách hàng
        </Link>
      </div>

      <CustomerFiltersForm
        filters={filters}
        invalidKeys={invalidKeys}
        options={options}
        action="/sales/pipeline"
      />

      <p className="text-sm text-slate-500">{total} khách hàng phù hợp với bộ lọc.</p>
      {total === 0 && (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-slate-500">
          Không có khách hàng phù hợp. Hãy thay đổi hoặc xóa bộ lọc.
        </p>
      )}

      <div
        role="region"
        aria-label="Pipeline theo trạng thái khách hàng, cuộn ngang để xem các cột"
        tabIndex={0}
        className="overflow-x-auto rounded-2xl pb-4 focus-visible:outline-2 focus-visible:outline-[#1B4FA0]"
      >
        <div className="flex items-start gap-4">
          {columns.map((column) => (
            <section
              key={column.status}
              aria-labelledby={`pipeline-${column.status}`}
              className="w-80 shrink-0 rounded-2xl border border-slate-200 bg-slate-50 p-4"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 id={`pipeline-${column.status}`} className="font-bold">{column.status}</h2>
                <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-600">
                  <span className="sr-only">Số khách hàng: </span>{column.total}
                </span>
              </div>

              <div className="space-y-3">
                {column.customers.map((customer) => (
                  <article key={customer.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <h3 className="break-words font-semibold">
                      <Link
                        href={`/sales/customers/${customer.id}`}
                        prefetch={false}
                        className="text-[#1B4FA0] hover:underline"
                      >
                        {customer.user.name || customer.user.email}
                      </Link>
                    </h3>
                    <p className="mt-1 break-words text-xs text-slate-500">{customer.customerCode}</p>
                    <dl className="mt-4 space-y-2 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">Ưu tiên</dt>
                        <dd className="font-medium">{customer.priority}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">Sales</dt>
                        <dd className="min-w-0 break-words text-right">{customer.assignedSales?.name || 'Chưa phân công'}</dd>
                      </div>
                      <div className="space-y-1">
                        <dt className="text-slate-500">Liên hệ tiếp theo</dt>
                        <dd>
                          {formatCRMDate(customer.nextContactAt)}
                          {isOverdueFollowUp(customer.nextContactAt, now) && (
                            <span className="ml-2 inline-block rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                              Quá hạn
                            </span>
                          )}
                        </dd>
                      </div>
                    </dl>
                    {canChangeStatus && (
                      <PipelineStatusForm customerId={customer.id} status={customer.status} />
                    )}
                  </article>
                ))}
                {column.customers.length === 0 && (
                  <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                    Không có khách hàng ở trạng thái này.
                  </p>
                )}
              </div>

              {column.total > column.customers.length && (
                <Link
                  href={filtersHref('/sales/customers', filters, { status: column.status, page: 1 })}
                  className="mt-4 block rounded-xl border border-slate-200 bg-white p-3 text-center text-sm font-semibold text-[#1B4FA0] hover:bg-slate-100"
                >
                  Xem tất cả {column.total} khách hàng {column.status}
                </Link>
              )}
            </section>
          ))}
        </div>
      </div>
    </section>
  )
}
