import { CUSTOMER_PRIORITIES, CUSTOMER_STATUSES } from '@/features/crm/customer-filters'
import type { parseReportFilters } from '@/features/crm/report-filters'

type ParsedReport = ReturnType<typeof parseReportFilters>
type ReportOptions = {
  sales: { id: string; name: string; email: string }[]
  teams: { id: string; name: string }[]
  salesTruncated: boolean
  teamsTruncated: boolean
}

const inputClass = 'mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm'
const filterLabels: Record<string, string> = {
  period: 'kỳ báo cáo', from: 'ngày bắt đầu', to: 'ngày kết thúc',
  salesId: 'Sales phụ trách khách hàng', teamId: 'đội hiện tại',
  status: 'trạng thái khách hàng', priority: 'ưu tiên khách hàng',
  page: 'trang Sales', teamPage: 'trang đội',
}

export function ReportFiltersForm({ filters, range, invalidKeys, options }: {
  filters: ParsedReport['filters']
  range: ParsedReport['range']
  invalidKeys: string[]
  options: ReportOptions
}) {
  return (
    <section aria-labelledby="report-filters-title" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 id="report-filters-title" className="text-lg font-semibold">Bộ lọc báo cáo</h2>
      <form action="/sales/reports" method="get" className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <label className="text-sm font-medium">
          Kỳ báo cáo
          <select className={inputClass} name="period" defaultValue={filters.period}>
            <option value="7d">7 ngày</option>
            <option value="30d">30 ngày</option>
            <option value="90d">90 ngày</option>
            <option value="ytd">Từ đầu năm</option>
            <option value="custom">Tùy chọn ngày</option>
          </select>
        </label>
        <label className="text-sm font-medium">
          Từ ngày (kỳ tùy chọn)
          <input className={inputClass} name="from" type="date" defaultValue={filters.from ?? range.from} aria-describedby="report-date-help" />
        </label>
        <label className="text-sm font-medium">
          Đến hết ngày (kỳ tùy chọn)
          <input className={inputClass} name="to" type="date" defaultValue={filters.to ?? range.to} aria-describedby="report-date-help" />
        </label>
        <label className="text-sm font-medium">
          Sales đang phụ trách khách hàng
          <select className={inputClass} name="salesId" defaultValue={filters.salesId ?? ''}>
            <option value="">Tất cả Sales trong phạm vi</option>
            {filters.salesId && !options.sales.some((sales) => sales.id === filters.salesId) && (
              <option value={filters.salesId}>Sales đã chọn không khả dụng trong danh sách</option>
            )}
            {options.sales.map((sales) => <option key={sales.id} value={sales.id}>{sales.name} · {sales.email}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">
          Đội hiện tại của Sales phụ trách khách hàng
          <select className={inputClass} name="teamId" defaultValue={filters.teamId ?? ''}>
            <option value="">Tất cả đội trong phạm vi</option>
            {filters.teamId && !options.teams.some((team) => team.id === filters.teamId) && (
              <option value={filters.teamId}>Đội đã chọn không khả dụng trong danh sách</option>
            )}
            {options.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">
          Trạng thái khách hàng hiện tại
          <select className={inputClass} name="status" defaultValue={filters.status ?? ''}>
            <option value="">Tất cả trạng thái</option>
            {CUSTOMER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">
          Ưu tiên khách hàng hiện tại
          <select className={inputClass} name="priority" defaultValue={filters.priority ?? ''}>
            <option value="">Tất cả mức ưu tiên</option>
            {CUSTOMER_PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 xl:col-span-4">
          <button type="submit" className="rounded-xl bg-[#1B4FA0] px-5 py-2 text-sm font-semibold text-white">Áp dụng bộ lọc</button>
          <a href="/sales/reports" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">Xóa bộ lọc</a>
        </div>
        <p id="report-date-help" className="text-xs text-slate-500 sm:col-span-2 xl:col-span-4">
          Ngày báo cáo theo giờ Việt Nam (UTC+7), tính trọn ngày kết thúc. Chọn “Tùy chọn ngày” để dùng hai ngày nhập; tối đa 366 ngày.
        </p>
        <p className="text-xs text-slate-500 sm:col-span-2 xl:col-span-4">
          Bộ lọc Sales và đội dựa trên phân công khách hàng hiện tại, không dựa trên người phụ trách task. Kỳ báo cáo chỉ áp dụng cho các số liệu có nhãn “KỲ ĐÃ CHỌN”.
        </p>
      </form>
      {(options.salesTruncated || options.teamsTruncated) && (
        <p role="status" className="mt-4 text-sm text-amber-800">
          Danh sách chọn chỉ hiển thị tối đa 100 mục cho {options.salesTruncated && options.teamsTruncated ? 'Sales và đội' : options.salesTruncated ? 'Sales' : 'đội'}. Các bảng khối lượng bên dưới vẫn có phân trang để xem các nhóm còn lại trong phạm vi.
        </p>
      )}
      {invalidKeys.length > 0 && (
        <p role="status" className="mt-4 text-sm text-amber-800">
          Đã bỏ qua hoặc đặt lại bộ lọc không hợp lệ: {invalidKeys.map((key) => filterLabels[key] ?? 'giá trị bộ lọc').join(', ')}.
        </p>
      )}
    </section>
  )
}
