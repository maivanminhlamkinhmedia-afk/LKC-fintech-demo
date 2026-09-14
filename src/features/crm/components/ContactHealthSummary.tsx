import Link from 'next/link'
import { filtersHref } from '@/features/crm/customer-filters'

const contactCards = [
  { key: 'overdue', label: 'Liên hệ quá hạn', description: 'Lịch liên hệ trước thời điểm hiện tại.' },
  { key: 'today', label: 'Liên hệ trong hôm nay', description: 'Lịch liên hệ trong ngày Việt Nam (UTC+7).' },
  { key: 'upcoming', label: 'Liên hệ sắp tới', description: 'Lịch liên hệ từ thời điểm hiện tại trở đi.' },
  { key: 'none', label: 'Chưa lên lịch liên hệ', description: 'Khách hàng chưa có lịch liên hệ tiếp theo.' },
] as const

export function ContactHealthSummary({ counts }: {
  counts: { overdue: number; today: number; upcoming: number; none: number }
}) {
  return (
    <section aria-labelledby="contact-health-title" className="mt-8">
      <p className="text-xs font-semibold uppercase tracking-wider text-[#2BAD97]">Snapshot hiện tại</p>
      <h2 id="contact-health-title" className="mt-2 text-xl font-bold">Tình hình liên hệ khách hàng</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">Lịch liên hệ của khách hàng trong phạm vi truy cập, gồm mọi trạng thái khách hàng. Đây không phải số lượng Follow-up Task.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {contactCards.map(({ key, label, description }) => (
          <Link
            key={key}
            href={filtersHref('/sales/customers', { followUp: key, page: 1 })}
            data-contact-health={key}
            data-count={counts[key]}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md"
          >
            <h3 className="text-sm font-medium text-slate-600">{label}</h3>
            <p className={`mt-2 text-3xl font-bold ${key === 'overdue' ? 'text-red-700' : 'text-[#0A1628]'}`}>{counts[key]}</p>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">{description}</p>
            <p className="mt-3 text-xs font-semibold text-[#1B4FA0]">Xem khách hàng →</p>
          </Link>
        ))}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-slate-500">Các nhóm không loại trừ nhau: lịch trong hôm nay có thể đồng thời quá hạn hoặc sắp tới. Không cộng bốn số đếm thành tổng khách hàng. Số liệu và trạng thái được tính khi tải trang.</p>
    </section>
  )
}
