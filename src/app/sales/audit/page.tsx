import Link from 'next/link'
import type { CRMSearchParams } from '@/features/crm/customer-filters'
import { AUDIT_MAX_PAGE, AUDIT_PAGE_SIZE, auditFiltersHref } from '@/features/crm/audit-filters'
import { getCRMAudit } from '@/features/crm/audit-queries'
import { AuditFiltersForm } from '@/features/crm/components/AuditFiltersForm'
import { AuditTimeline } from '@/features/crm/components/AuditTimeline'

export const dynamic = 'force-dynamic'

export default async function SalesAuditPage({ searchParams }: { searchParams: Promise<CRMSearchParams> }) {
  // The DAL authenticates, reloads the active actor and restricts audit roles.
  const result = await getCRMAudit(await searchParams)
  const hasResults = !result.error && result.invalidKeys.length === 0

  return (
    <section className="mx-auto min-w-0 max-w-7xl space-y-6 px-5 py-8 md:px-8">
      <div>
        <Link href="/sales" className="text-sm font-medium text-blue-600 hover:underline">← Dashboard Sales</Link>
        <h1 className="mt-3 text-3xl font-bold">Nhật ký thao tác CRM</h1>
        <p className="mt-2 text-slate-500">Tra cứu các sự kiện quản trị CRM được hỗ trợ theo thời gian, hành động và người thực hiện.</p>
        <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-[#2BAD97]">Chỉ đọc · Không thay đổi lịch sử</p>
        <p className="mt-3 text-sm leading-relaxed text-slate-500">
          Đây là nhật ký kiểm tra thao tác, không phải lịch sử tương tác khách hàng. Chỉ hiển thị các trường tóm tắt được phép; không hiển thị nội dung ghi chú, task hoặc dữ liệu xác thực.
        </p>
      </div>

      <AuditFiltersForm filters={result.filters} range={result.range} invalidKeys={result.invalidKeys} actors={result.actors} />
      {result.error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{result.error}</p>}

      {hasResults && (
        <>
          <div
            data-audit-range="" data-from={result.range.from} data-to={result.range.to}
            data-start={result.range.startUtc.toISOString()} data-end={result.range.endExclusiveUtc.toISOString()}
            className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-950"
          >
            <p className="font-semibold">Kỳ đã chọn: {result.range.from} đến hết {result.range.to} · Giờ Việt Nam (UTC+7)</p>
            <p className="mt-2">Sắp xếp mới nhất trước; tối đa {AUDIT_PAGE_SIZE} sự kiện mỗi trang. Tên người thực hiện là tên tài khoản hiện tại.</p>
          </div>
          <p data-audit-total={result.total} data-audit-page={result.page} data-audit-page-count={result.pageCount} role="status" className="text-sm text-slate-600">
            {new Intl.NumberFormat('vi-VN').format(result.total)} sự kiện phù hợp · Trang {result.page}/{result.pageCount}
          </p>
          {result.historyCapped && (
            <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Lịch sử vượt giới hạn xem {AUDIT_MAX_PAGE} trang. Hãy thu hẹp thời gian hoặc bộ lọc để tìm các sự kiện cần tra cứu.
            </p>
          )}
          <AuditTimeline rows={result.rows} />
          {result.pageCount > 1 && (
            <nav aria-label="Phân trang nhật ký CRM" className="flex flex-wrap items-center gap-4 text-sm">
              {result.page > 1 && <Link href={auditFiltersHref(result.filters, result.page - 1)} prefetch={false} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-[#1B4FA0] hover:bg-slate-50">Trang trước</Link>}
              <span>Trang {result.page}/{result.pageCount}</span>
              {result.page < result.pageCount && <Link href={auditFiltersHref(result.filters, result.page + 1)} prefetch={false} className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-[#1B4FA0] hover:bg-slate-50">Trang sau</Link>}
            </nav>
          )}
        </>
      )}
    </section>
  )
}
