import Link from 'next/link'
import { CustomerActivityType } from '@prisma/client'
import { activityFiltersHref, type ActivityFilters } from '@/features/crm/activity-filters'
import type { getCustomerActivityTimeline } from '@/features/crm/activity-queries'
import { ACTIVITY_LABELS } from '@/features/crm/interaction-validation'
import { ActivityFiltersForm } from '@/features/crm/components/ActivityFiltersForm'

type Timeline = NonNullable<Awaited<ReturnType<typeof getCustomerActivityTimeline>>>
const formatter = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh',
})

export function ActivityTimeline({ customerId, filters, invalidKeys, timeline }: {
  customerId: string
  filters: ActivityFilters
  invalidKeys: string[]
  timeline: Timeline
}) {
  const path = `/sales/customers/${customerId}`
  return (
    <section
      id="activity-timeline"
      aria-labelledby="activity-timeline-title"
      data-activity-total={timeline.total}
      data-activity-page={timeline.page}
      data-activity-page-count={timeline.pageCount}
      className="min-w-0 scroll-mt-6 rounded-2xl bg-white p-6 shadow-sm"
    >
      <h2 id="activity-timeline-title" className="text-xl font-bold">Activity Timeline</h2>
      <p className="mt-2 text-sm text-slate-500">Lịch sử hoạt động của khách hàng, mới nhất trước. Thời gian hiển thị theo giờ Việt Nam (UTC+7).</p>
      <ActivityFiltersForm customerId={customerId} filters={filters} invalidKeys={invalidKeys} />
      <p role="status" className="mt-4 text-sm text-slate-500">{timeline.total} hoạt động phù hợp · Trang {timeline.page}/{timeline.pageCount}</p>
      <div className="mt-5 space-y-5">
        {timeline.activities.map((activity) => {
          const isSystemType = activity.type === CustomerActivityType.STATUS_CHANGE || activity.type === CustomerActivityType.ASSIGNMENT
          return (
            <article key={activity.id} data-activity-id={activity.id} data-activity-type={activity.type} className="min-w-0 border-l-2 border-slate-200 pl-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-1 text-xs font-semibold ${isSystemType ? 'bg-blue-50 text-blue-800' : 'bg-emerald-50 text-emerald-800'}`}>{ACTIVITY_LABELS[activity.type]}</span>
                <span className="text-xs text-slate-500">{isSystemType ? 'Sự kiện hệ thống' : 'Loại tương tác thủ công'}</span>
                <time dateTime={activity.createdAt.toISOString()} className="text-xs text-slate-500">{formatter.format(activity.createdAt)}</time>
              </div>
              <h3 className="mt-2 break-words font-semibold">{activity.title}</h3>
              {activity.content && <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-600">{activity.content}</p>}
              <p className="mt-2 break-words text-xs text-slate-500">Thực hiện bởi: {activity.actor?.name || 'Không rõ người thực hiện'}</p>
            </article>
          )
        })}
      </div>
      {timeline.activities.length === 0 && (
        <p className="mt-5 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
          {filters.activityType ? 'Không có hoạt động phù hợp với loại đã chọn.' : 'Chưa có hoạt động cho khách hàng này.'}
        </p>
      )}
      {timeline.pageCount > 1 && (
        <nav aria-label="Phân trang lịch sử hoạt động" className="mt-6 flex flex-wrap items-center gap-3 text-sm">
          {timeline.page > 1 && <Link href={activityFiltersHref(path, filters, { activityPage: timeline.page - 1 })} className="rounded-xl border border-slate-300 px-4 py-2 font-medium hover:bg-slate-50">Trang trước</Link>}
          <span className="text-slate-500">Trang {timeline.page}/{timeline.pageCount}</span>
          {timeline.page < timeline.pageCount && <Link href={activityFiltersHref(path, filters, { activityPage: timeline.page + 1 })} className="rounded-xl border border-slate-300 px-4 py-2 font-medium hover:bg-slate-50">Trang sau</Link>}
        </nav>
      )}
    </section>
  )
}
