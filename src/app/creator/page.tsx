import type { ArticleStatus, ArticleType } from '@prisma/client'
import Link from 'next/link'
import { PortalShell } from '@/components/portal/PortalShell'
import { requirePermission } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { canCreateArticle } from '@/features/cms/access'
import { canEditArticleDraft } from '@/features/cms/article-draft'
import {
  dashboardArticleWhere,
  EDITORIAL_IN_PROGRESS_STATUSES,
  OWN_AUTHOR_PROFILE_SELECT,
  PUBLISHED_STATUSES,
  RECENT_ARTICLE_SELECT,
} from '@/features/cms/dashboard'

const ARTICLE_TYPE_LABELS: Record<ArticleType, string> = {
  NEWS: 'Tin tức',
  MARKET_UPDATE: 'Cập nhật thị trường',
  ANALYSIS: 'Phân tích',
  EDUCATION: 'Kiến thức',
  RESEARCH: 'Nghiên cứu',
  OPINION: 'Góc nhìn',
}

const ARTICLE_STATUS_LABELS: Record<ArticleStatus, string> = {
  DRAFT: 'Bản nháp',
  SUBMITTED: 'Đã gửi biên tập',
  EDITORIAL_REVIEW: 'Đang biên tập',
  CHANGES_REQUESTED: 'Cần chỉnh sửa',
  FACT_CHECK: 'Đang kiểm chứng',
  APPROVED: 'Đã duyệt',
  SCHEDULED: 'Đã lên lịch',
  PUBLISHED: 'Đã xuất bản',
  CORRECTED: 'Đã đính chính',
  ARCHIVED: 'Đã lưu trữ',
}

const dateFormatter = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Asia/Ho_Chi_Minh',
})

function UpdatedTime({ value }: { value: Date }) {
  return <time dateTime={value.toISOString()}>{dateFormatter.format(value)}</time>
}

export default async function CreatorPage() {
  const { user } = await requirePermission('cms:access')
  const [total, drafts, editorial, published, recentArticles, authorProfile] = await Promise.all([
    prisma.article.count({ where: dashboardArticleWhere(user) }),
    prisma.article.count({ where: dashboardArticleWhere(user, { status: 'DRAFT' }) }),
    prisma.article.count({
      where: dashboardArticleWhere(user, { status: { in: [...EDITORIAL_IN_PROGRESS_STATUSES] } }),
    }),
    prisma.article.count({
      where: dashboardArticleWhere(user, { status: { in: [...PUBLISHED_STATUSES] } }),
    }),
    prisma.article.findMany({
      where: dashboardArticleWhere(user),
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: RECENT_ARTICLE_SELECT,
    }),
    prisma.authorProfile.findUnique({
      where: { userId: user.id },
      select: OWN_AUTHOR_PROFILE_SELECT,
    }),
  ])

  const metrics = [
    { label: 'Tổng bài viết', value: total, detail: 'Tất cả trạng thái' },
    { label: 'Draft', value: drafts, detail: 'Bài viết ở trạng thái bản nháp' },
    { label: 'Đang xử lý biên tập', value: editorial, detail: 'Từ gửi biên tập đến lên lịch xuất bản' },
    { label: 'Đã xuất bản', value: published, detail: 'Bao gồm bài đã đính chính' },
  ]

  return (
    <div className="min-w-0 [overflow-wrap:anywhere]">
      <PortalShell user={{ name: user.name, role: user.role }}>
        <section className="min-w-0 space-y-8 [overflow-wrap:anywhere]">
          <header>
            <p className="text-sm font-semibold uppercase tracking-wider text-[#2BAD97]">LKC Publishing</p>
            <h1 className="mt-2 text-3xl font-bold">Khu người tạo nội dung</h1>
            <p className="mt-2 text-slate-500">Tổng quan bài viết trong phạm vi được cấp quyền của bạn.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              {canCreateArticle(user) && <Link href="/creator/articles/new" className="rounded-xl bg-[#167563] px-5 py-3 font-semibold text-white">Tạo bài nháp</Link>}
              <Link href="/creator/articles" className="rounded-xl border border-slate-300 bg-white px-5 py-3 font-medium">Danh sách bài viết</Link>
            </div>
          </header>

          <dl className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map(({ label, value, detail }) => (
              <div key={label} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <dt className="text-sm font-medium text-slate-600">{label}</dt>
                <dd className="mt-2 text-3xl font-bold tabular-nums">{value.toLocaleString('vi-VN')}</dd>
                <dd className="mt-2 text-xs text-slate-500">{detail}</dd>
              </div>
            ))}
          </dl>

          <div className="grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <section aria-labelledby="recent-articles-heading" className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 p-5 sm:p-6">
                <h2 id="recent-articles-heading" className="text-lg font-semibold">Bài viết gần đây</h2>
                <p className="mt-1 text-sm text-slate-500">Tối đa 10 bài, theo lần cập nhật gần nhất. Thời gian hiển thị theo giờ Việt Nam.</p>
              </div>
              {recentArticles.length === 0 ? (
                <div className="p-6 text-sm text-slate-500">
                  <p className="font-medium text-slate-700">Chưa có bài viết</p>
                  <p className="mt-2">Các bài viết trong phạm vi của bạn sẽ xuất hiện tại đây.</p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {recentArticles.map((article) => (
                    <li key={article.id} className="min-w-0 p-5 sm:p-6">
                      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                        <h3 className="min-w-0 font-semibold">{article.title}</h3>
                        <span className="w-fit shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                          {ARTICLE_STATUS_LABELS[article.status]}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-500">{ARTICLE_TYPE_LABELS[article.articleType]} · {article.slug}</p>
                      {canEditArticleDraft(user, article) && <Link href={`/creator/articles/${encodeURIComponent(article.id)}/edit`} className="mt-2 inline-block text-sm font-medium text-emerald-800 underline">Chỉnh sửa</Link>}
                      <div className="mt-3 flex flex-col gap-1 text-xs text-slate-500 sm:flex-row sm:flex-wrap sm:gap-x-4">
                        <p>Cập nhật: <UpdatedTime value={article.updatedAt} /></p>
                        {article.publishedAt && <p>Xuất bản: <UpdatedTime value={article.publishedAt} /></p>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="author-profile-heading" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <h2 id="author-profile-heading" className="text-lg font-semibold">Hồ sơ tác giả của bạn</h2>
              {authorProfile ? (
                <div className="mt-4 space-y-4">
                  <div>
                    <p className="text-lg font-semibold">{authorProfile.displayName}</p>
                    <p className="mt-1 text-sm text-slate-500">{authorProfile.jobTitle || 'Chưa bổ sung chức danh'}</p>
                  </div>
                  <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${authorProfile.isPublic ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>
                    {authorProfile.isPublic ? 'Công khai' : 'Riêng tư'}
                  </span>
                  <dl className="space-y-3 text-sm">
                    <div>
                      <dt className="text-slate-500">Slug</dt>
                      <dd className="mt-1 font-medium">{authorProfile.slug}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Cập nhật gần nhất</dt>
                      <dd className="mt-1"><UpdatedTime value={authorProfile.updatedAt} /></dd>
                    </div>
                  </dl>
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-500">Chưa có hồ sơ tác giả</p>
              )}
            </section>
          </div>
        </section>
      </PortalShell>
    </div>
  )
}
