import { CUSTOMER_PRIORITIES, CUSTOMER_STATUSES } from '@/features/crm/customer-filters'
import {
  DUE_STATES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type FollowUpFilters,
} from '@/features/crm/follow-up-filters'

type FilterOptions = {
  sales: { id: string; name: string; email: string }[]
  teams: { id: string; name: string }[]
}

const filterLabels: Record<string, string> = {
  q: 'tìm kiếm',
  status: 'trạng thái task',
  priority: 'ưu tiên task',
  salesId: 'Sales phụ trách task',
  teamId: 'đội của Sales phụ trách task',
  due: 'hạn công việc',
  customerStatus: 'trạng thái khách hàng',
  customerPriority: 'ưu tiên khách hàng',
  page: 'trang',
}

const dueLabels: Record<(typeof DUE_STATES)[number], string> = {
  overdue: 'Quá hạn',
  today: 'Đến hạn hôm nay',
  upcoming: 'Sắp tới',
  none: 'Chưa có hạn',
}

const inputClass = 'mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm'

export function FollowUpFiltersForm({ filters, invalidKeys, options }: {
  filters: FollowUpFilters
  invalidKeys: string[]
  options: FilterOptions
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <form action="/sales/follow-ups" method="get" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <label className="text-sm font-medium sm:col-span-2">
          Tìm công việc hoặc khách hàng
          <input
            className={inputClass}
            name="q"
            type="search"
            maxLength={120}
            defaultValue={filters.q ?? ''}
            placeholder="Tiêu đề task, tên hoặc mã khách hàng"
          />
        </label>
        <label className="text-sm font-medium">
          Trạng thái task
          <select className={inputClass} name="status" defaultValue={filters.status ?? ''}>
            <option value="">Tất cả trạng thái task</option>
            {TASK_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">
          Ưu tiên task
          <select className={inputClass} name="priority" defaultValue={filters.priority ?? ''}>
            <option value="">Tất cả mức ưu tiên task</option>
            {TASK_PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">
          Sales phụ trách task
          <select className={inputClass} name="salesId" defaultValue={filters.salesId ?? ''}>
            <option value="">Tất cả người phụ trách trong phạm vi</option>
            {filters.salesId && !options.sales.some((sales) => sales.id === filters.salesId) && (
              <option value={filters.salesId}>Người phụ trách đã chọn không khả dụng</option>
            )}
            {options.sales.map((sales) => <option key={sales.id} value={sales.id}>{sales.name} · {sales.email}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">
          Đội của Sales phụ trách task
          <select className={inputClass} name="teamId" defaultValue={filters.teamId ?? ''}>
            <option value="">Tất cả đội trong phạm vi</option>
            {filters.teamId && !options.teams.some((team) => team.id === filters.teamId) && (
              <option value={filters.teamId}>Đội đã chọn không khả dụng</option>
            )}
            {options.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">
          Hạn công việc
          <select className={inputClass} name="due" defaultValue={filters.due ?? ''}>
            <option value="">Tất cả hạn công việc</option>
            {DUE_STATES.map((due) => <option key={due} value={due}>{dueLabels[due]}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">
          Trạng thái khách hàng
          <select className={inputClass} name="customerStatus" defaultValue={filters.customerStatus ?? ''}>
            <option value="">Tất cả trạng thái khách hàng</option>
            {CUSTOMER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">
          Ưu tiên khách hàng
          <select className={inputClass} name="customerPriority" defaultValue={filters.customerPriority ?? ''}>
            <option value="">Tất cả mức ưu tiên khách hàng</option>
            {CUSTOMER_PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 xl:col-span-4">
          <button type="submit" className="rounded-xl bg-[#1B4FA0] px-5 py-2 text-sm font-semibold text-white">Áp dụng bộ lọc</button>
          <a href="/sales/follow-ups" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">Xóa bộ lọc</a>
          <p className="text-xs text-slate-500">Giờ Việt Nam (UTC+7). Quá hạn và sắp tới tính theo thời điểm hiện tại.</p>
        </div>
        <p className="text-xs text-slate-500 sm:col-span-2 xl:col-span-4">
          Bộ lọc Sales và đội dùng người phụ trách task, có thể khác Sales phụ trách khách hàng. Bộ lọc hạn áp dụng cho mọi trạng thái task.
        </p>
      </form>
      {invalidKeys.length > 0 && (
        <p role="status" className="mt-4 text-sm text-amber-800">
          Đã bỏ qua bộ lọc không hợp lệ: {invalidKeys.map((key) => filterLabels[key]).join(', ')}.
        </p>
      )}
    </div>
  )
}
