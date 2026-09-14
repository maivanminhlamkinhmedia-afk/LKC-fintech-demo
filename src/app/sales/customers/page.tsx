import Link from 'next/link'
import { requirePermission } from '@/lib/authz'
import { hasPermission } from '@/lib/roles'
import {
  filtersHref,
  parseCustomerFilters,
  type CRMSearchParams,
} from '@/features/crm/customer-filters'
import { getCustomerFilterOptions, getCustomerList } from '@/features/crm/customer-queries'
import { CustomerFiltersForm } from '@/features/crm/components/CustomerFiltersForm'
import { CustomerBulkActions, CustomerCards } from '@/features/crm/components/CustomerBulkActions'
import { CustomerExportButton } from '@/features/crm/components/CustomerExportButton'

export default async function SalesCustomersPage({ searchParams }: { searchParams: Promise<CRMSearchParams> }) {
  const session = await requirePermission('sales:read')
  const { filters, invalidKeys } = parseCustomerFilters(await searchParams)
  const now = new Date()
  const [result, options] = await Promise.all([
    getCustomerList(session.user, filters, now),
    getCustomerFilterOptions(session.user),
  ])
  const selectionKey = JSON.stringify([
    filtersHref('/sales/customers', filters, { page: result.page }),
    result.customers.map((customer) => [customer.id, customer.priority]),
  ])

  return (
    <section className="mx-auto max-w-7xl px-5 py-8 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/sales" className="text-sm font-medium text-blue-600 hover:underline">← Dashboard Sales</Link>
          <h1 className="mt-3 text-3xl font-bold">Khách hàng Sales</h1>
          <p className="mt-2 text-slate-500">Quản lý hồ sơ khách hàng, lịch sử tương tác và follow-up.</p>
        </div>
        <Link href={filtersHref('/sales/pipeline', filters, { page: 1 })} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50">Xem Pipeline</Link>
      </div>

      <CustomerFiltersForm filters={filters} invalidKeys={invalidKeys} options={options} action="/sales/customers" />
      <CustomerExportButton filters={filters} invalidKeys={invalidKeys} />
      <p className="mt-6 text-sm text-slate-500" role="status">{result.total} khách hàng phù hợp · Trang {result.page}/{result.pageCount}</p>
      {hasPermission(session.user.role, 'sales:write') ? (
        <CustomerBulkActions customers={result.customers} now={now} selectionKey={selectionKey} />
      ) : (
        <CustomerCards customers={result.customers} now={now} />
      )}
      {result.customers.length === 0 && (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-300 p-8 text-center">
          <h2 className="font-semibold">Không có khách hàng phù hợp</h2>
          <p className="mt-2 text-sm text-slate-500">Thử thay đổi bộ lọc hoặc xóa bộ lọc để xem khách hàng trong phạm vi của bạn.</p>
        </div>
      )}
      {result.pageCount > 1 && (
        <nav aria-label="Phân trang khách hàng" className="mt-6 flex items-center gap-4 text-sm">
          {result.page > 1 && <Link className="rounded-xl border px-4 py-2" href={filtersHref('/sales/customers', filters, { page: result.page - 1 })}>Trang trước</Link>}
          <span>Trang {result.page}/{result.pageCount}</span>
          {result.page < result.pageCount && <Link className="rounded-xl border px-4 py-2" href={filtersHref('/sales/customers', filters, { page: result.page + 1 })}>Trang sau</Link>}
        </nav>
      )}
    </section>
  )
}
