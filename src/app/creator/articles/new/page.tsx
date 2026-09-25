import { redirect } from 'next/navigation'
import { PortalShell } from '@/components/portal/PortalShell'
import { requirePermission } from '@/lib/authz'
import { canCreateArticle } from '@/features/cms/access'
import { ArticleDraftForm } from '@/features/cms/components/ArticleDraftForm'

export default async function NewArticlePage() {
  const { user } = await requirePermission('cms:access')
  if (!canCreateArticle(user)) redirect('/creator')

  return (
    <div className="min-w-0 [overflow-wrap:anywhere] [&_main]:min-w-0">
      <PortalShell user={{ name: user.name, role: user.role }}>
        <section className="mx-auto min-w-0 max-w-5xl space-y-6">
          <header>
            <p className="text-sm font-semibold uppercase tracking-wider text-[#167563]">LKC Publishing</p>
            <h1 className="mt-2 text-3xl font-bold">Tạo bài nháp</h1>
            <p className="mt-2 text-sm text-slate-500">Bài viết được tạo khi bạn nhấn Lưu nháp.</p>
          </header>
          <ArticleDraftForm />
        </section>
      </PortalShell>
    </div>
  )
}
