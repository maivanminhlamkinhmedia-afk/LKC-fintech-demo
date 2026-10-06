import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PortalShell } from '@/components/portal/PortalShell'
import { requirePermission } from '@/lib/authz'
import { getArticlePreview } from '@/features/cms/article-preview-query'
import { ArticlePreview } from '@/features/cms/components/ArticlePreview'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const metadata: Metadata = {
  title: 'Xem trước nội bộ', description: 'Bản xem trước nội bộ của nội dung đã lưu.',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
  alternates: { canonical: null }, openGraph: null, twitter: null,
}

export default async function PreviewArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requirePermission('cms:access')
  const { id } = await params
  const result = await getArticlePreview(user, id)
  if (!result.ok && result.error === 'NOT_FOUND') notFound()
  return <div className="min-w-0 [overflow-wrap:anywhere] [&_main]:min-w-0">
    <PortalShell user={{ name: user.name, role: user.role }}>
      {result.ok ? <ArticlePreview article={result.data} /> : <section className="mx-auto max-w-5xl rounded-2xl border border-slate-200 bg-white p-6">
        <h1 className="text-xl font-bold">Không thể mở bản xem trước</h1>
        <p role="alert" data-error-code={result.error} className="mt-3 text-slate-700">
          {result.error === 'UNSUPPORTED_DOCUMENT' ? 'Nội dung bài viết chưa được trình xem trước hỗ trợ.'
            : result.error === 'FORBIDDEN' ? 'Bạn không còn quyền xem bài viết này.' : 'Không thể tải bản xem trước. Vui lòng thử lại.'}
        </p>
      </section>}
    </PortalShell>
  </div>
}
