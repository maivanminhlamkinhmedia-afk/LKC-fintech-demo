import Link from 'next/link'
import type { getCRMAudit } from '@/features/crm/audit-queries'
import { formatAuditDate } from '@/features/crm/audit-registry'

type AuditRows = Awaited<ReturnType<typeof getCRMAudit>>['rows']

export function AuditTimeline({ rows }: { rows: AuditRows }) {
  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <h2 className="font-semibold">Không có sự kiện CRM phù hợp</h2>
        <p className="mt-2 text-sm text-slate-500">Thử thay đổi thời gian hoặc bộ lọc để xem các sự kiện được hỗ trợ.</p>
      </div>
    )
  }

  return (
    <ol aria-label="Nhật ký thao tác CRM, mới nhất trước" className="space-y-4">
      {rows.map((row) => (
        <li key={row.id}>
          <article
            data-audit-id={row.id} data-audit-action={row.action} data-audit-category={row.category}
            data-audit-entity-type={row.entityType} data-audit-entity-id={row.entityId ?? ''}
            data-audit-actor-id={row.actor?.id ?? ''}
            className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="break-words text-lg font-semibold">{row.label}</h2>
                <p className="mt-1 break-all text-xs text-slate-500">{row.action}</p>
              </div>
              <time dateTime={Number.isFinite(row.createdAt.getTime()) ? row.createdAt.toISOString() : undefined} className="text-sm text-slate-600">
                {formatAuditDate(row.createdAt)} · UTC+7
              </time>
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Người thực hiện</dt>
                <dd className="mt-1 break-words font-medium">
                  {row.actor?.name ?? 'Không xác định người thực hiện'}
                  {row.actor && <span className="mt-1 block break-all text-xs font-normal text-slate-500">{row.actor.id}</span>}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Nhóm sự kiện</dt>
                <dd className="mt-1 break-words">{row.category}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Loại thực thể</dt>
                <dd className="mt-1 break-words">{row.entityType}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Mã thực thể</dt>
                <dd className="mt-1 break-all">
                  {row.entityId ?? (row.action === 'CUSTOMER_CSV_EXPORT' ? 'Xuất dữ liệu tổng hợp, không gắn với một khách hàng' : 'Không có mã thực thể')}
                </dd>
              </div>
            </dl>
            {row.action === 'CUSTOMER_BULK_PRIORITY_UPDATE' && (
              <p className="mt-4 text-xs leading-relaxed text-slate-500">Sự kiện này ghi nhận thay đổi ưu tiên của một khách hàng, không phải toàn bộ lô cập nhật.</p>
            )}
            {row.action === 'CUSTOMER_CSV_EXPORT' && (
              <p className="mt-4 text-xs leading-relaxed text-slate-500">Ghi nhận tạo CSV thành công; không xác nhận người dùng đã nhận hoặc mở tệp.</p>
            )}
            {row.summary.length > 0 ? (
              <dl aria-label="Tóm tắt an toàn của sự kiện" className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
                {row.summary.map((field) => (
                  <div key={field.key} data-audit-field={field.key}>
                    <dt className="text-slate-500">{field.label}</dt>
                    <dd data-audit-value={field.value} className="mt-1 break-words font-medium">{field.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-4 text-sm text-slate-500">Không có trường tóm tắt hợp lệ để hiển thị.</p>
            )}
            {row.customerHref && (
              <Link href={row.customerHref} prefetch={false} className="mt-4 inline-flex rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-[#1B4FA0] hover:bg-slate-50">
                Xem hồ sơ khách hàng
              </Link>
            )}
          </article>
        </li>
      ))}
    </ol>
  )
}
