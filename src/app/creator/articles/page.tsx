import Link from 'next/link'
import { PortalShell } from '@/components/portal/PortalShell'
import { requirePermission } from '@/lib/authz'
import { canCreateArticle } from '@/features/cms/access'
import { canEditArticleDraft } from '@/features/cms/article-draft'
import { getArticleDraftList } from '@/features/cms/article-draft-query'

export default async function ArticleListPage({ searchParams }: {
  searchParams: Promise<{ page?: string | string[] }>
}) {
  const { user } = await requirePermission('cms:access')
  const { page: requestedPage } = await searchParams
  const { articles, total, page, pageCount } = await getArticleDraftList(user, requestedPage)

  return (
    <div className="min-w-0 [overflow-wrap:anywhere]">
      <PortalShell user={{ name: user.name, role: user.role }}>
        <section className="min-w-0 space-y-6">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">Danh sách bài viết</h1>
              <p className="mt-2 text-sm text-slate-500">{total.toLocaleString('vi-VN')} bài viết trong phạm vi của bạn.</p>
            </div>
            {canCreateArticle(user) && <Link href="/creator/articles/new" className="rounded-xl bg-[#167563] px-5 py-3 font-semibold text-white">Tạo bài nháp</Link>}
          </header>
          <Link href="/creator" className="inline-block text-sm font-medium text-emerald-800 underline">Tổng quan nội dung</Link>
          {articles.length === 0 ? (
            <p className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-500">Chưa có bài viết</p>
          ) : (
            <ul className="min-w-0 divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
              {articles.map(article => (
                <li key={article.id} className="flex min-w-0 flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-2">
                    <h2 className="font-semibold">{article.title}</h2>
                    <p className="text-sm text-slate-500">{article.slug}</p>
                    <p className="text-xs text-slate-500"><time dateTime={article.updatedAt.toISOString()}>{article.updatedAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</time> · {article.status}</p>
                  </div>
                  {canEditArticleDraft(user, article) && (
                    <Link href={`/creator/articles/${encodeURIComponent(article.id)}/edit`} className="shrink-0 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium">Chỉnh sửa</Link>
                  )}
                </li>
              ))}
            </ul>
          )}
          <nav aria-label="Phân trang bài viết" className="flex flex-wrap items-center gap-4 text-sm">
            {page > 1 && <Link href={`/creator/articles?page=${page - 1}`} className="rounded-lg border border-slate-300 px-4 py-2">Trang trước</Link>}
            <span>Trang {page} / {pageCount}</span>
            {page < pageCount && <Link href={`/creator/articles?page=${page + 1}`} className="rounded-lg border border-slate-300 px-4 py-2">Trang sau</Link>}
          </nav>
        </section>
      </PortalShell>
    </div>
  )
}
