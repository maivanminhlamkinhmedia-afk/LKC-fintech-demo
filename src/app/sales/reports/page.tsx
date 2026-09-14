import Link from 'next/link'
import { requirePermission } from '@/lib/authz'
import type { CRMSearchParams } from '@/features/crm/customer-filters'
import { parseReportFilters, reportFiltersHref } from '@/features/crm/report-filters'
import { getCRMReport } from '@/features/crm/report-queries'
import { ReportFiltersForm } from '@/features/crm/components/ReportFiltersForm'

type ReportFilters = ReturnType<typeof parseReportFilters>['filters']
type Report = Awaited<ReturnType<typeof getCRMReport>>
type MetricKey = keyof Report['metrics']
type MetricDefinition = { key: MetricKey; label: string; period: boolean; description: string }
type WorkloadRow = {
  id: string | null
  name: string
  email?: string
  customers: number
  newCustomers: number
  open: number
  overdue: number
  completed: number
}
type Workload = { rows: WorkloadRow[]; total: number; page: number; pageCount: number }

const countFormatter = new Intl.NumberFormat('vi-VN')
const percentageFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 })
const summaryMetrics: MetricDefinition[] = [
  { key: 'customers', label: 'Khách hàng hiện tại', period: false, description: 'Khách hàng trong phạm vi và bộ lọc hiện tại, không giới hạn theo kỳ.' },
  { key: 'newCustomers', label: 'Khách hàng mới trong kỳ', period: true, description: 'Hồ sơ khách hàng tạo trong kỳ, thuộc danh mục đang được xem.' },
  { key: 'activities', label: 'Hoạt động CRM trong kỳ', period: true, description: 'Hoạt động ghi nhận trong kỳ của các khách hàng thuộc danh mục hiện tại.' },
]
const taskMetrics: MetricDefinition[] = [
  { key: 'open', label: 'Task đang mở', period: false, description: 'Task hiện ở TODO hoặc IN_PROGRESS của các khách hàng trong phạm vi.' },
  { key: 'overdue', label: 'Task mở quá hạn', period: false, description: 'Task đang mở có hạn trước thời điểm xem báo cáo.' },
  { key: 'today', label: 'Task mở đến hạn hôm nay', period: false, description: 'Task đang mở có hạn trong ngày Việt Nam hiện tại, kể cả task đã quá giờ.' },
  { key: 'completed', label: 'Task hoàn tất trong kỳ', period: true, description: 'Task hiện ở DONE, có ngày hoàn tất trong kỳ; không tính task đã mở lại.' },
]

function MetricCard({ definition, count }: { definition: MetricDefinition; count: number }) {
  return (
    <div data-report-metric={definition.key} data-count={count} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className={`text-xs font-semibold tracking-wide ${definition.period ? 'text-[#1B4FA0]' : 'text-[#2BAD97]'}`}>
        {definition.period ? 'KỲ ĐÃ CHỌN' : 'SNAPSHOT HIỆN TẠI'}
      </p>
      <h3 className="mt-3 text-sm font-medium text-slate-600">{definition.label}</h3>
      <p className={`mt-2 text-3xl font-bold ${definition.key === 'overdue' ? 'text-red-700' : 'text-[#0A1628]'}`}>{countFormatter.format(count)}</p>
      <p className="mt-3 text-xs leading-relaxed text-slate-500">{definition.description}</p>
    </div>
  )
}

function DistributionTable({ kind, title, rows }: {
  kind: 'status' | 'priority'
  title: string
  rows: { value: string; count: number; percentage: number }[]
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold tracking-wide text-[#2BAD97]">SNAPSHOT HIỆN TẠI</p>
      <h2 className="mt-2 text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">Tỷ trọng trên tổng khách hàng thuộc phạm vi và bộ lọc hiện tại.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-sm">
          <caption className="sr-only">{title} hiện tại</caption>
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr><th scope="col" className="p-3">{kind === 'status' ? 'Trạng thái' : 'Ưu tiên'}</th><th scope="col" className="p-3 text-right">Khách hàng</th><th scope="col" className="p-3 text-right">Tỷ trọng</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.value} data-report-distribution={kind} data-value={row.value} data-count={row.count} data-percentage={row.percentage} className="border-t border-slate-100">
                <th scope="row" className="p-3 text-left font-medium">{row.value}</th>
                <td className="p-3 text-right tabular-nums">{countFormatter.format(row.count)}</td>
                <td className="p-3 text-right tabular-nums">{percentageFormatter.format(row.percentage)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function WorkloadTable({ kind, data, filters }: { kind: 'sales' | 'team'; data: Workload; filters: ReportFilters }) {
  const title = kind === 'sales' ? 'Khối lượng theo Sales hiện tại' : 'Khối lượng theo đội hiện tại'
  const pageLink = (page: number) => reportFiltersHref('/sales/reports', filters, kind === 'sales' ? { page } : { teamPage: page })
  return (
    <section aria-labelledby={`report-${kind}-title`} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 id={`report-${kind}-title`} className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">
        {kind === 'sales'
          ? 'Số liệu gắn với khách hàng hiện được phân công cho Sales, không quy cho người đã tạo khách hàng hay người hoàn thành task.'
          : 'Gom theo đội của Sales đang phụ trách khách hàng và tư cách thành viên hiện tại; không tái dựng phân công hay thành viên trong quá khứ.'}
      </p>
      <div data-report-table={kind} data-total={data.total} data-page={data.page} data-page-count={data.pageCount}>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <caption className="sr-only">{title}: số liệu theo danh mục khách hàng hiện tại, với cột snapshot và kỳ đã chọn được ghi riêng</caption>
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th scope="col" className="min-w-48 p-3">{kind === 'sales' ? 'Sales đang phụ trách' : 'Đội hiện tại'}</th>
                <th scope="col" className="min-w-36 p-3 text-right">Khách hiện được phân công<span className="mt-1 block text-xs font-normal">SNAPSHOT HIỆN TẠI</span></th>
                <th scope="col" className="min-w-36 p-3 text-right">Khách mới hiện được phân công<span className="mt-1 block text-xs font-normal">KỲ ĐÃ CHỌN</span></th>
                <th scope="col" className="min-w-32 p-3 text-right">Task đang mở<span className="mt-1 block text-xs font-normal">SNAPSHOT HIỆN TẠI</span></th>
                <th scope="col" className="min-w-32 p-3 text-right">Task mở quá hạn<span className="mt-1 block text-xs font-normal">SNAPSHOT HIỆN TẠI</span></th>
                <th scope="col" className="min-w-40 p-3 text-right">Task hoàn tất của danh mục hiện tại<span className="mt-1 block text-xs font-normal">KỲ ĐÃ CHỌN</span></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr
                  key={row.id ?? 'none'}
                  data-report-row={kind}
                  data-id={row.id ?? 'none'}
                  data-customers={row.customers}
                  data-new-customers={row.newCustomers}
                  data-open={row.open}
                  data-overdue={row.overdue}
                  data-completed={row.completed}
                  className="border-t border-slate-100"
                >
                  <th scope="row" className="p-3 text-left font-medium"><span className="block break-words">{row.name}</span>{row.email && <span className="mt-1 block break-all text-xs font-normal text-slate-500">{row.email}</span>}</th>
                  <td className="p-3 text-right tabular-nums">{countFormatter.format(row.customers)}</td>
                  <td className="p-3 text-right tabular-nums">{countFormatter.format(row.newCustomers)}</td>
                  <td className="p-3 text-right tabular-nums">{countFormatter.format(row.open)}</td>
                  <td className="p-3 text-right tabular-nums">{countFormatter.format(row.overdue)}</td>
                  <td className="p-3 text-right tabular-nums">{countFormatter.format(row.completed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.rows.length === 0 && <p className="mt-4 text-sm text-slate-500">Không có nhóm khách hàng phù hợp trong phạm vi và bộ lọc này.</p>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 text-sm text-slate-500">
          <p>{countFormatter.format(data.total)} nhóm danh mục · Trang {data.page}/{data.pageCount}</p>
          {data.pageCount > 1 && (
            <nav aria-label={`Phân trang ${kind === 'sales' ? 'Sales' : 'đội'}`} className="flex flex-wrap gap-3">
              {data.page > 1 && <Link href={pageLink(data.page - 1)} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-[#1B4FA0] hover:bg-slate-50">Trang trước</Link>}
              {data.page < data.pageCount && <Link href={pageLink(data.page + 1)} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-[#1B4FA0] hover:bg-slate-50">Trang sau</Link>}
            </nav>
          )}
        </div>
      </div>
    </section>
  )
}

export default async function SalesReportsPage({ searchParams }: { searchParams: Promise<CRMSearchParams> }) {
  const session = await requirePermission('sales:read')
  const now = new Date()
  const { filters, range, invalidKeys } = parseReportFilters(await searchParams, now)
  const report = await getCRMReport(session.user, filters, range, now)

  return (
    <section className="mx-auto min-w-0 max-w-7xl space-y-6 px-5 py-8 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/sales" className="text-sm font-medium text-blue-600 hover:underline">← Dashboard Sales</Link>
          <h1 className="mt-3 text-3xl font-bold">Báo cáo CRM</h1>
          <p className="mt-2 text-slate-500">Danh mục khách hàng và khối lượng công việc trong phạm vi truy cập của bạn.</p>
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-[#2BAD97]">Báo cáo chỉ đọc</p>
        </div>
        <nav aria-label="Đi đến các trang CRM" className="flex flex-wrap gap-3">
          <Link href="/sales/customers" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-[#1B4FA0] hover:bg-slate-50">Khách hàng</Link>
          <Link href="/sales/pipeline" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-[#1B4FA0] hover:bg-slate-50">Pipeline</Link>
          <Link href="/sales/follow-ups" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-[#1B4FA0] hover:bg-slate-50">Follow-ups</Link>
        </nav>
      </div>

      <ReportFiltersForm filters={filters} range={range} invalidKeys={invalidKeys} options={report.options} />
      <div data-report-range="" data-from={range.from} data-to={range.to} data-start={range.startUtc.toISOString()} data-end={range.endExclusiveUtc.toISOString()} className="rounded-2xl border border-blue-100 bg-blue-50 p-5 text-sm text-blue-950">
        <p className="font-semibold">KỲ ĐÃ CHỌN: {range.from} đến hết {range.to} · Giờ Việt Nam (UTC+7)</p>
        <p className="mt-2 leading-relaxed">Số liệu SNAPSHOT HIỆN TẠI phản ánh danh mục và task lúc xem báo cáo. Số liệu KỲ ĐÃ CHỌN dùng ngày tạo hoặc ngày hoàn tất, nhưng vẫn thuộc danh mục khách hàng được phân công hiện tại.</p>
      </div>
      {report.metrics.customers === 0 && (
        <p role="status" className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">Không có khách hàng phù hợp trong phạm vi và bộ lọc này. Bạn có thể thay đổi hoặc xóa bộ lọc.</p>
      )}

      <section aria-labelledby="report-overview-title">
        <h2 id="report-overview-title" className="text-xl font-semibold">Tổng quan danh mục CRM</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">{summaryMetrics.map((definition) => <MetricCard key={definition.key} definition={definition} count={report.metrics[definition.key]} />)}</div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <DistributionTable kind="status" title="Phân bố trạng thái khách hàng" rows={report.statuses} />
        <DistributionTable kind="priority" title="Phân bố mức ưu tiên khách hàng" rows={report.priorities} />
      </div>

      <section aria-labelledby="report-tasks-title">
        <h2 id="report-tasks-title" className="text-xl font-semibold">Công việc và follow-up</h2>
        <p className="mt-2 text-sm text-slate-500">Đếm task gắn với danh mục khách hàng hiện tại, kể cả khi người phụ trách task khác Sales phụ trách khách hàng.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{taskMetrics.map((definition) => <MetricCard key={definition.key} definition={definition} count={report.metrics[definition.key]} />)}</div>
      </section>

      <WorkloadTable kind="sales" data={report.sales} filters={filters} />
      <WorkloadTable kind="team" data={report.teams} filters={filters} />

      <section aria-labelledby="report-activities-title" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold tracking-wide text-[#1B4FA0]">KỲ ĐÃ CHỌN</p>
        <h2 id="report-activities-title" className="mt-2 text-lg font-semibold">Hoạt động CRM theo loại</h2>
        <p className="mt-2 text-sm text-slate-500">Hoạt động được tạo trong kỳ của khách hàng thuộc phạm vi và bộ lọc hiện tại; không quy thành hoạt động do từng Sales thực hiện.</p>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <caption className="sr-only">Hoạt động CRM theo loại trong kỳ đã chọn</caption>
            <thead className="bg-slate-50 text-left text-slate-500"><tr><th scope="col" className="p-3">Loại hoạt động</th><th scope="col" className="p-3 text-right">Số hoạt động</th></tr></thead>
            <tbody>{report.activities.map((row) => <tr key={row.value} data-report-distribution="activity" data-value={row.value} data-count={row.count} className="border-t border-slate-100"><th scope="row" className="p-3 text-left font-medium">{row.value}</th><td className="p-3 text-right tabular-nums">{countFormatter.format(row.count)}</td></tr>)}</tbody>
          </table>
        </div>
        {report.metrics.activities === 0 && <p className="mt-4 text-sm text-slate-500">Không có hoạt động trong kỳ cho danh mục khách hàng này.</p>}
      </section>

      <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-relaxed text-slate-600">
        <h2 className="font-semibold">Cách đọc số liệu</h2>
        <p className="mt-2">Đây là báo cáo danh mục và khối lượng CRM theo phân công hiện tại. Các số liệu không xác định ai đã thu hút khách hàng, thực hiện hoạt động hay hoàn thành task trong quá khứ.</p>
        <p className="mt-2">Chưa báo cáo tỷ lệ chuyển đổi lịch sử vì dữ liệu hiện tại chưa có lịch sử chuyển trạng thái có cấu trúc đầy đủ và đáng tin cậy. Phân bố trạng thái hiện tại không thể thay thế lịch sử chuyển đổi.</p>
      </aside>
    </section>
  )
}
