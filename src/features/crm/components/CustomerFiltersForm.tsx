import { CUSTOMER_PRIORITIES, CUSTOMER_STATUSES, type CustomerFilters } from '@/features/crm/customer-filters'

type FilterOptions = {
  sales: { id: string; name: string; email: string }[]
  teams: { id: string; name: string }[]
}
const filterLabels: Record<string, string> = {
  q: 'tìm kiếm', status: 'trạng thái', priority: 'ưu tiên', salesId: 'Sales',
  teamId: 'đội Sales', followUp: 'follow-up', task: 'công việc', page: 'trang',
}
const inputClass = 'mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm'

export function CustomerFiltersForm({ filters, invalidKeys, options, action }: {
  filters: CustomerFilters
  invalidKeys: string[]
  options: FilterOptions
  action: '/sales/customers' | '/sales/pipeline'
}) {
  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <form action={action} method="get" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <label className="text-sm font-medium sm:col-span-2">
          Tìm khách hàng
          <input className={inputClass} name="q" type="search" maxLength={120} defaultValue={filters.q ?? ''} placeholder="Tên, email hoặc mã khách hàng" />
        </label>
        <label className="text-sm font-medium">
          Trạng thái
          <select className={inputClass} name="status" defaultValue={filters.status ?? ''}>
            <option value="">Tất cả trạng thái</option>
            {CUSTOMER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">
          Ưu tiên
          <select className={inputClass} name="priority" defaultValue={filters.priority ?? ''}>
            <option value="">Tất cả mức ưu tiên</option>
            {CUSTOMER_PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">
          Sales phụ trách
          <select className={inputClass} name="salesId" defaultValue={filters.salesId ?? ''}>
            <option value="">Tất cả Sales trong phạm vi</option>
            {filters.salesId && !options.sales.some((sales) => sales.id === filters.salesId) && (
              <option value={filters.salesId}>Sales đã chọn không khả dụng</option>
            )}
            {options.sales.map((sales) => <option key={sales.id} value={sales.id}>{sales.name} · {sales.email}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">
          Đội Sales
          <select className={inputClass} name="teamId" defaultValue={filters.teamId ?? ''}>
            <option value="">Tất cả đội trong phạm vi</option>
            {filters.teamId && !options.teams.some((team) => team.id === filters.teamId) && (
              <option value={filters.teamId}>Đội đã chọn không khả dụng</option>
            )}
            {options.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">
          Follow-up
          <select className={inputClass} name="followUp" defaultValue={filters.followUp ?? ''}>
            <option value="">Tất cả lịch hẹn</option>
            <option value="overdue">Quá hạn</option>
            <option value="today">Trong hôm nay</option>
            <option value="upcoming">Sắp tới</option>
            <option value="none">Chưa hẹn follow-up</option>
          </select>
        </label>
        <label className="text-sm font-medium">
          Công việc
          <select className={inputClass} name="task" defaultValue={filters.task ?? ''}>
            <option value="">Tất cả công việc</option>
            <option value="open">Có công việc đang mở</option>
            <option value="overdue">Có công việc quá hạn</option>
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 xl:col-span-4">
          <button type="submit" className="rounded-xl bg-[#1B4FA0] px-5 py-2 text-sm font-semibold text-white">Áp dụng bộ lọc</button>
          <a href={action} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">Xóa bộ lọc</a>
          <p className="text-xs text-slate-500">Giờ Việt Nam (UTC+7). Quá hạn và sắp tới tính theo thời điểm hiện tại.</p>
        </div>
      </form>
      {invalidKeys.length > 0 && (
        <p role="status" className="mt-4 text-sm text-amber-800">
          Đã bỏ qua bộ lọc không hợp lệ: {invalidKeys.map((key) => filterLabels[key]).join(', ')}.
        </p>
      )}
    </div>
  )
}
