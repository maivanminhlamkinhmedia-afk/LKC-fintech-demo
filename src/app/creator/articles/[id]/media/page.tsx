import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PortalShell } from '@/components/portal/PortalShell'
import { requirePermission } from '@/lib/authz'
import { getArticleCover } from '@/features/cms/media-query'
import { ArticleCoverPanel } from '@/features/cms/components/ArticleCoverPanel'

export default async function ArticleMediaPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requirePermission('cms:access')
  const { id } = await params
  const result = await getArticleCover(user, id)
  if (!result.ok && result.error.code === 'NOT_FOUND') notFound()
  return <div className="min-w-0 [overflow-wrap:anywhere] [&_main]:min-w-0"><PortalShell user={{ name: user.name, role: user.role }}>
    {result.ok ? <ArticleCoverPanel initial={result.data} /> : <section className="mx-auto max-w-5xl space-y-4 rounded-2xl bg-white p-6">
      <h1 className="text-3xl font-bold">Ảnh bìa bài viết</h1><p role="alert" data-error-code={result.error.code}>{result.error.message}</p>
      <Link href="/creator/articles" className="text-emerald-800 underline">Danh sách bài viết</Link></section>}
  </PortalShell></div>
}
