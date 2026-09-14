import type { CustomerFilters } from '@/features/crm/customer-filters'
import { MAX_CUSTOMER_EXPORT_ROWS, customerExportHref } from '@/features/crm/customer-export-filters'

export function CustomerExportButton({ filters, invalidKeys }: { filters: CustomerFilters; invalidKeys: string[] }) {
  const invalidFilters = invalidKeys.some((key) => key !== 'page')
  const buttonClass = 'inline-flex rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold'

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      {invalidFilters ? (
        <button type="button" disabled className={`${buttonClass} cursor-not-allowed opacity-60`}>Xuất CSV</button>
      ) : (
        // Export is an explicit audited GET, never a prefetched navigation.
        <a data-customer-export="" href={customerExportHref(filters)} className={`${buttonClass} hover:bg-slate-50`}>Xuất CSV</a>
      )}
      <p className={`text-xs ${invalidFilters ? 'text-amber-800' : 'text-slate-500'}`}>
        {invalidFilters
          ? 'Hãy sửa hoặc xóa bộ lọc không hợp lệ rồi áp dụng lại trước khi xuất CSV.'
          : `Xuất toàn bộ kết quả phù hợp trong phạm vi của bạn, không chỉ trang này; tối đa ${MAX_CUSTOMER_EXPORT_ROWS} khách hàng. Nếu vượt giới hạn, hãy thu hẹp bộ lọc.`}
      </p>
    </div>
  )
}
