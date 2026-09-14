import Link from 'next/link'
import { requirePermission } from '@/lib/authz'
import { hasPermission } from '@/lib/roles'
import { formatCRMDate, type CRMSearchParams } from '@/features/crm/customer-filters'
import {
  followUpFiltersHref,
  isOverdueTask,
  parseFollowUpFilters,
} from '@/features/crm/follow-up-filters'
import { getFollowUpFilterOptions, getFollowUpWorkbench } from '@/features/crm/follow-up-queries'
import { FollowUpFiltersForm } from '@/features/crm/components/FollowUpFiltersForm'
import { TaskStatusForm } from '@/features/crm/components/TaskStatusForm'
import { TaskPlanningForm } from '@/features/crm/components/TaskPlanningForm'
import { canPlanTask } from '@/features/crm/task-plan-validation'

const metricLabels = [
  ['open', 'Task đang mở'],
  ['overdue', 'Quá hạn'],
  ['today', 'Đến hạn hôm nay'],
  ['upcoming', 'Sắp tới'],
] as const

export default async function SalesFollowUpsPage({ searchParams }: {
  searchParams: Promise<CRMSearchParams>
}) {
  const session = await requirePermission('sales:read')
  const { filters, invalidKeys } = parseFollowUpFilters(await searchParams)
  const now = new Date()
  const [result, options] = await Promise.all([
    getFollowUpWorkbench(session.user, filters, now),
    getFollowUpFilterOptions(session.user),
  ])
  const canChangeStatus = hasPermission(session.user.role, 'sales:write')

  return (
    <section className="mx-auto min-w-0 max-w-7xl space-y-6 px-5 py-8 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/sales" className="text-sm font-medium text-blue-600 hover:underline">← Dashboard Sales</Link>
          <h1 className="mt-3 text-3xl font-bold">Follow-up Workbench</h1>
          <p className="mt-2 text-slate-500">Theo dõi hạn công việc và cập nhật task của khách hàng trong phạm vi của bạn.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/sales/customers" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-[#1B4FA0] hover:bg-slate-50">Khách hàng</Link>
          <Link href="/sales/pipeline" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-[#1B4FA0] hover:bg-slate-50">Pipeline</Link>
        </div>
      </div>

      <section aria-labelledby="follow-up-metrics-title">
        <h2 id="follow-up-metrics-title" className="text-lg font-semibold">Task đang mở trong kết quả lọc</h2>
        <p className="mt-1 text-sm text-slate-500">Các số đếm chỉ gồm TODO và IN_PROGRESS theo bộ lọc hiện tại. Danh sách bên dưới có thể gồm mọi trạng thái.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metricLabels.map(([key, label]) => (
            <div key={key} data-metric={key} data-count={result.metrics[key]} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">{label}</p>
              <p className={`mt-2 text-3xl font-bold ${key === 'overdue' ? 'text-red-700' : 'text-[#0A1628]'}`}>{result.metrics[key]}</p>
            </div>
          ))}
        </div>
      </section>

      <FollowUpFiltersForm filters={filters} invalidKeys={invalidKeys} options={options} />

      <p role="status" className="text-sm text-slate-500">{result.total} task phù hợp · Trang {result.page}/{result.pageCount}</p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {result.tasks.map((task) => (
          <article key={task.id} data-task-id={task.id} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="min-w-0 flex-1 break-words text-lg font-semibold">{task.title}</h2>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium">{task.status}</span>
            </div>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Ưu tiên task</dt>
                <dd className="font-medium">{task.priority}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Hạn công việc</dt>
                <dd className="mt-1">
                  {task.dueAt ? formatCRMDate(task.dueAt) : 'Chưa có hạn'}
                  {isOverdueTask(task, now) && <span className="ml-2 inline-block rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">Task quá hạn</span>}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Khách hàng</dt>
                <dd className="mt-1 break-words font-medium">
                  <Link href={`/sales/customers/${task.customer.id}`} prefetch={false} className="text-[#1B4FA0] hover:underline">{task.customer.user.name}</Link>
                </dd>
                <dd className="mt-1 break-all text-xs text-slate-500">{task.customer.customerCode}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-slate-500">Trạng thái / ưu tiên khách</dt>
                <dd>{task.customer.status} · {task.customer.priority}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Sales phụ trách task</dt>
                <dd className="mt-1 break-words font-medium">{task.assignedTo?.name || 'Chưa phân công'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Sales phụ trách khách hàng</dt>
                <dd className="mt-1 break-words">{task.customer.assignedSales?.name || 'Chưa phân công'}</dd>
              </div>
            </dl>
            {canChangeStatus && <TaskStatusForm taskId={task.id} status={task.status} />}
            {canPlanTask(task.status) ? canChangeStatus && (
              <TaskPlanningForm taskId={task.id} title={task.title} priority={task.priority} dueAt={task.dueAt} updatedAt={task.updatedAt} />
            ) : (
              <p data-task-plan-readonly="" className="mt-4 text-xs text-slate-500">Task đã hoàn tất hoặc hủy: kế hoạch chỉ đọc.</p>
            )}
          </article>
        ))}
      </div>
      {result.tasks.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <h2 className="font-semibold">Không có task phù hợp</h2>
          <p className="mt-2 text-sm text-slate-500">Thay đổi hoặc xóa bộ lọc để xem công việc trong phạm vi của bạn.</p>
        </div>
      )}
      {result.pageCount > 1 && (
        <nav aria-label="Phân trang công việc" className="flex flex-wrap items-center gap-4 text-sm">
          {result.page > 1 && <Link className="rounded-xl border border-slate-300 px-4 py-2 hover:bg-slate-50" href={followUpFiltersHref('/sales/follow-ups', filters, { page: result.page - 1 })}>Trang trước</Link>}
          <span>Trang {result.page}/{result.pageCount}</span>
          {result.page < result.pageCount && <Link className="rounded-xl border border-slate-300 px-4 py-2 hover:bg-slate-50" href={followUpFiltersHref('/sales/follow-ups', filters, { page: result.page + 1 })}>Trang sau</Link>}
        </nav>
      )}
    </section>
  )
}
