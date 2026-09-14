import { contactStates, formatCRMDate } from '@/features/crm/customer-filters'
import { toVietnamContactInput } from '@/features/crm/contact-plan-time'
import { ContactPlanningForm } from '@/features/crm/components/ContactPlanningForm'

const stateLabels = {
  overdue: 'Liên hệ quá hạn',
  today: 'Liên hệ trong hôm nay',
  upcoming: 'Liên hệ sắp tới',
  none: 'Chưa lên lịch liên hệ',
} as const

const stateStyles = {
  overdue: 'bg-red-50 text-red-700',
  today: 'bg-amber-50 text-amber-800',
  upcoming: 'bg-blue-50 text-blue-700',
  none: 'bg-slate-100 text-slate-600',
} as const

export function ContactPlanning({ customerId, lastContactAt, nextContactAt, canWrite, now }: {
  customerId: string
  lastContactAt: Date | null
  nextContactAt: Date | null
  canWrite: boolean
  now: Date
}) {
  const states = contactStates(nextContactAt, now)

  return (
    <section
      data-contact-planning=""
      data-last-contact={lastContactAt?.toISOString() ?? ''}
      data-next-contact={nextContactAt?.toISOString() ?? ''}
      aria-labelledby="contact-planning-title"
      className="rounded-2xl bg-white p-6 shadow-sm"
    >
      <h2 id="contact-planning-title" className="text-xl font-bold">Kế hoạch liên hệ</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">Lịch liên hệ ở cấp khách hàng, tách biệt với tương tác đã diễn ra và Follow-up Task. Lưu hoặc xóa lịch không tạo task, sự kiện lịch, thông báo hay tương tác; không thực hiện cuộc gọi hoặc gửi email.</p>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl bg-slate-50 p-4">
          <dt className="text-sm text-slate-500">Liên hệ gần nhất (UTC+7)</dt>
          <dd className="mt-2 font-semibold">{lastContactAt ? <time dateTime={lastContactAt.toISOString()}>{formatCRMDate(lastContactAt)}</time> : 'Chưa ghi nhận liên hệ'}</dd>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <dt className="text-sm text-slate-500">Liên hệ dự kiến tiếp theo (UTC+7)</dt>
          <dd className="mt-2 font-semibold">{nextContactAt ? <time dateTime={nextContactAt.toISOString()}>{formatCRMDate(nextContactAt)}</time> : 'Chưa lên lịch liên hệ'}</dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2" aria-label="Trạng thái kế hoạch liên hệ">
        {states.map((state) => <span key={state} data-contact-state={state} className={`rounded-full px-3 py-1 text-xs font-semibold ${stateStyles[state]}`}>{stateLabels[state]}</span>)}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-slate-500">Trạng thái tại thời điểm tải trang. “Hôm nay” theo ngày Việt Nam và có thể đồng thời là “Quá hạn” hoặc “Sắp tới”; “Sắp tới” gồm các thời điểm từ hiện tại trở đi.</p>
      {canWrite ? <ContactPlanningForm key={customerId} customerId={customerId} initialValue={toVietnamContactInput(nextContactAt)} /> : <p className="mt-4 text-sm text-slate-500">Bạn đang xem kế hoạch liên hệ ở chế độ chỉ đọc.</p>}
    </section>
  )
}
