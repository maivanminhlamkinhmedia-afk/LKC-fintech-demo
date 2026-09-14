import { CustomerActivityType } from '@prisma/client'
import type { ActivityFilters } from '@/features/crm/activity-filters'
import { ACTIVITY_LABELS } from '@/features/crm/interaction-validation'

const filterLabels: Record<string, string> = {
  activityType: 'loại hoạt động',
  activityPage: 'trang hoạt động',
}

export function ActivityFiltersForm({ customerId, filters, invalidKeys }: {
  customerId: string
  filters: ActivityFilters
  invalidKeys: string[]
}) {
  const path = `/sales/customers/${customerId}#activity-timeline`
  return (
    <div className="mt-5">
      <form action={path} method="get" className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 text-sm font-medium">
          Loại hoạt động
          <select name="activityType" defaultValue={filters.activityType ?? ''} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="">Tất cả hoạt động</option>
            {Object.values(CustomerActivityType).map((type) => <option key={type} value={type}>{ACTIVITY_LABELS[type]}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded-xl bg-[#1B4FA0] px-4 py-2 text-sm font-semibold text-white">Lọc hoạt động</button>
        <a href={path} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">Xóa bộ lọc</a>
      </form>
      {invalidKeys.length > 0 && (
        <p role="status" className="mt-3 text-sm text-amber-800">
          Đã bỏ qua hoặc đặt lại bộ lọc không hợp lệ: {invalidKeys.map((key) => filterLabels[key] ?? 'giá trị bộ lọc').join(', ')}.
        </p>
      )}
    </div>
  )
}
