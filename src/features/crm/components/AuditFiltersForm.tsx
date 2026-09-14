import { AUDIT_ACTOR_LIMIT, AUDIT_PERIODS, type AuditFilters } from '@/features/crm/audit-filters'
import { CRM_AUDIT_CATEGORIES, CRM_AUDIT_REGISTRY } from '@/features/crm/audit-registry'

const inputClass = 'mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm'
const periodLabels: Record<string, string> = { '7d': '7 ngày', '30d': '30 ngày', '90d': '90 ngày', custom: 'Tùy chọn ngày' }
const filterLabels: Record<string, string> = {
  period: 'kỳ xem', from: 'ngày bắt đầu', to: 'ngày kết thúc', action: 'hành động',
  category: 'nhóm sự kiện', actorId: 'người thực hiện', page: 'trang',
}

export function AuditFiltersForm({ filters, range, invalidKeys, actors }: {
  filters: AuditFilters
  range: { from: string; to: string }
  invalidKeys: string[]
  actors: { id: string; name: string }[]
}) {
  return (
    <section aria-labelledby="audit-filters-title" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 id="audit-filters-title" className="text-lg font-semibold">Bộ lọc nhật ký</h2>
      <form data-audit-filters="" action="/sales/audit" method="get" className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <label className="text-sm font-medium">
          Kỳ xem
          <select className={inputClass} name="period" defaultValue={filters.period} aria-describedby="audit-date-help">
            {AUDIT_PERIODS.map((period) => <option key={period} value={period}>{periodLabels[period] ?? period}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">
          Từ ngày (kỳ tùy chọn)
          <input className={inputClass} name="from" type="date" defaultValue={filters.from ?? range.from} aria-describedby="audit-date-help" />
        </label>
        <label className="text-sm font-medium">
          Đến hết ngày (kỳ tùy chọn)
          <input className={inputClass} name="to" type="date" defaultValue={filters.to ?? range.to} aria-describedby="audit-date-help" />
        </label>
        <label className="text-sm font-medium">
          Hành động
          <select className={inputClass} name="action" defaultValue={filters.action ?? ''}>
            <option value="">Tất cả hành động CRM được hỗ trợ</option>
            {CRM_AUDIT_REGISTRY.map((entry) => <option key={entry.action} value={entry.action}>{entry.label}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">
          Nhóm sự kiện
          <select className={inputClass} name="category" defaultValue={filters.category ?? ''}>
            <option value="">Tất cả nhóm CRM được hỗ trợ</option>
            {CRM_AUDIT_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">
          Người thực hiện
          <select className={inputClass} name="actorId" defaultValue={filters.actorId ?? ''} aria-describedby="audit-actor-help">
            <option value="">Tất cả người thực hiện</option>
            {filters.actorId && !actors.some((actor) => actor.id === filters.actorId) && (
              <option value={filters.actorId}>ID đã chọn</option>
            )}
            {actors.map((actor) => <option key={actor.id} value={actor.id}>{actor.name} · {actor.id}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 xl:col-span-3">
          <button type="submit" className="rounded-xl bg-[#1B4FA0] px-5 py-2 text-sm font-semibold text-white">Áp dụng bộ lọc</button>
          <a href="/sales/audit" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">Xóa bộ lọc</a>
        </div>
        <p id="audit-date-help" className="text-xs leading-relaxed text-slate-500 sm:col-span-2 xl:col-span-3">
          Ngày theo giờ Việt Nam (UTC+7), tính trọn ngày kết thúc. Chọn “Tùy chọn ngày” để dùng hai ngày nhập, tối đa 366 ngày; với kỳ 7, 30 hoặc 90 ngày, hai ngày nhập không quyết định khoảng thời gian.
        </p>
        <p id="audit-actor-help" className="text-xs leading-relaxed text-slate-500 sm:col-span-2 xl:col-span-3">
          Danh sách gợi ý tối đa {AUDIT_ACTOR_LIMIT} người thực hiện, dùng tên tài khoản hiện tại. “ID đã chọn” chỉ giữ giá trị bộ lọc, không xác nhận tài khoản tồn tại.
        </p>
      </form>
      {invalidKeys.length > 0 && (
        <p role="alert" className="mt-4 text-sm text-amber-800">
          Bộ lọc không hợp lệ: {invalidKeys.map((key) => filterLabels[key] ?? 'giá trị bộ lọc').join(', ')}. Không hiển thị kết quả; hãy sửa hoặc xóa bộ lọc rồi áp dụng lại.
        </p>
      )}
    </section>
  )
}
