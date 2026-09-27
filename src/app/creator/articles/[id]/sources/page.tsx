import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PortalShell } from '@/components/portal/PortalShell'
import { requirePermission } from '@/lib/authz'
import { getArticleSources } from '@/features/cms/article-source-query'
import { ArticleSources } from '@/features/cms/components/ArticleSources'

export default async function ArticleSourcesPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requirePermission('cms:access')
  const { id } = await params
  const result = await getArticleSources(user, id)
  if (!result.ok && result.error.code === 'NOT_FOUND') notFound()
  return (
    <div className="min-w-0 [overflow-wrap:anywhere] [&_main]:min-w-0">
      <PortalShell user={{ name: user.name, role: user.role }}>
        <div className="mx-auto min-w-0 max-w-5xl">
          {result.ok ? <ArticleSources initial={result.data} /> : <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
            <h1 className="text-3xl font-bold">Nguồn tham khảo</h1>
            <p role="alert" data-error-code={result.error.code}>{result.error.message}</p>
            <Link href="/creator/articles" className="font-medium text-emerald-800 underline">Danh sách bài viết</Link>
          </section>}
        </div>
      </PortalShell>
    </div>
  )
}
