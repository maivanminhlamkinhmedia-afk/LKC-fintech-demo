import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PortalShell } from '@/components/portal/PortalShell'
import { requirePermission } from '@/lib/authz'
import { hasPermission } from '@/lib/roles'
import { getArticleReviewQueue } from '@/features/cms/article-review-queue-query'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const metadata: Metadata = {
  title: 'Hàng đợi biên tập',
  description: 'Danh sách nội bộ các phiên bản bài viết đã gửi biên tập.',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
  alternates: { canonical: null }, openGraph: null, twitter: null,
}

const dateFormatter = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh',
})

function QueueTime({ value }: { value: string }) {
  return <time dateTime={value}>{dateFormatter.format(new Date(value))}</time>
}

export default async function ReviewQueuePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { user } = await requirePermission('cms:article:review')
  if (!hasPermission(user.role, 'cms:article:read:any')) redirect('/creator')
  // URL strings are transport input; Q0 in the DAL validates the full request,
  // including repeated/unknown fields. Never construct an actor from this input.
  const parameters = await searchParams
  const request = {
    ...parameters,
    ...(parameters.limit === undefined ? {} : {
      limit: typeof parameters.limit === 'string' && /^[1-9]\d?$/.test(parameters.limit)
        ? Number(parameters.limit) : parameters.limit,
    }),
  }
  const result = await getArticleReviewQueue(user, request)
  const nextHref = result.ok && result.data.nextCursor
    ? `/creator/review?${new URLSearchParams({
      filter: 'SUBMITTED', limit: String(request.limit ?? 20), cursor: result.data.nextCursor,
    })}` : null

  return <div className="min-w-0 [overflow-wrap:anywhere]">
    <PortalShell user={{ name: user.name, role: user.role }}>
      <section aria-labelledby="review-queue-heading" className="min-w-0 space-y-6">
        <header>
          <h1 id="review-queue-heading" className="text-3xl font-bold">Hàng đợi biên tập</h1>
          <p className="mt-2 text-sm text-slate-500">Các phiên bản đã gửi biên tập, theo thời điểm gửi tăng dần. Chỉ xem thông tin phiên bản đã lưu.</p>
        </header>
        <Link href="/creator" className="inline-block text-sm font-medium text-emerald-800 underline">Tổng quan nội dung</Link>
        {!result.ok ? <p role="alert" data-error-code={result.error} className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-700">
          {result.error === 'FORBIDDEN' ? 'Bạn không còn quyền xem hàng đợi biên tập.'
            : result.error === 'VALIDATION_ERROR' ? 'Bộ lọc hoặc vị trí phân trang không hợp lệ.'
              : 'Không thể tải hàng đợi biên tập. Vui lòng thử lại.'}
        </p> : <>
          {result.data.items.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-500">Chưa có bài viết chờ biên tập.</p>
            : <ul className="min-w-0 divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
              {result.data.items.map(item => <li key={item.articleId} className="min-w-0 space-y-3 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h2 className="min-w-0 font-semibold">{item.title}</h2>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">Đã gửi biên tập (SUBMITTED)</span>
                </div>
                <dl className="space-y-2 text-sm text-slate-600">
                  <div><dt className="font-medium">Bài viết</dt><dd>{item.articleId}</dd></div>
                  <div><dt className="font-medium">Phiên bản đã gửi</dt><dd>{item.versionNumber} · {item.versionId}</dd></div>
                  <div><dt className="font-medium">Bản nội dung tại</dt><dd><QueueTime value={item.basisUpdatedAt} /></dd></div>
                  <div><dt className="font-medium">Thời điểm gửi</dt><dd><QueueTime value={item.submittedAt} /></dd></div>
                  <div><dt className="font-medium">Quyền xem đã lưu</dt><dd>{item.audience.accessMode === 'PUBLIC' ? 'Công khai (PUBLIC)' : 'Theo sản phẩm (PAID_PRODUCT)'}</dd></div>
                  {item.audience.accessMode === 'PAID_PRODUCT' && <div>
                    <dt className="font-medium">Mã sản phẩm đã lưu</dt>
                    <dd><ul>{item.audience.productIds.map(id => <li key={id}>{id}</li>)}</ul></dd>
                  </div>}
                </dl>
              </li>)}
            </ul>}
          <p className="text-xs text-slate-500">Quyền xem và mã sản phẩm phản ánh phiên bản đã gửi; không xác nhận khả năng chọn sản phẩm hiện tại hoặc quyền truy cập của người đọc.</p>
          {nextHref && <nav aria-label="Phân trang hàng đợi biên tập">
            <Link href={nextHref} prefetch={false} className="inline-block rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium">Trang sau</Link>
          </nav>}
        </>}
      </section>
    </PortalShell>
  </div>
}
