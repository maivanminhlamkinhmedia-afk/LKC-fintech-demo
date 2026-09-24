import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PortalShell } from '@/components/portal/PortalShell'
import { requirePermission } from '@/lib/authz'
import { getArticleDraftForEdit } from '@/features/cms/article-draft-query'
import { ArticleDraftForm } from '@/features/cms/components/ArticleDraftForm'

export default async function EditArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requirePermission('cms:access')
  const { id } = await params
  const result = await getArticleDraftForEdit(user, id)
  if (!result.ok && result.error.code === 'NOT_FOUND') notFound()

  return (
    <div className="min-w-0 [overflow-wrap:anywhere] [&_main]:min-w-0">
      <PortalShell user={{ name: user.name, role: user.role }}>
        <section className="mx-auto min-w-0 max-w-5xl space-y-6">
          <header>
            <p className="text-sm font-semibold uppercase tracking-wider text-[#167563]">LKC Publishing</p>
            <h1 className="mt-2 text-3xl font-bold">Chỉnh sửa bài nháp</h1>
          </header>
          {result.ok ? <ArticleDraftForm key={result.data.id} initial={result.data} /> : (
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
              <p role="alert" data-error-code={result.error.code}>{result.error.message}</p>
              <Link href="/creator/articles" className="inline-block font-medium text-emerald-800 underline">Danh sách bài viết</Link>
            </div>
          )}
        </section>
      </PortalShell>
    </div>
  )
}
