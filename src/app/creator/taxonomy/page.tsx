import Link from 'next/link'
import { requirePermission } from '@/lib/authz'
import { getTaxonomyCatalog } from '@/features/cms/taxonomy-query'
import { TAXONOMY_KINDS } from '@/features/cms/taxonomy'
import { TaxonomyCatalog } from '@/features/cms/components/TaxonomyCatalog'
import { PortalShell } from '@/components/portal/PortalShell'

export default async function TaxonomyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await requirePermission('cms:admin')
  const params = await searchParams
  const kind = typeof params.kind === 'string' && TAXONOMY_KINDS.some(value => value === params.kind) ? params.kind : 'category'
  const page = typeof params.page === 'string' && /^[1-9]\d{0,5}$/.test(params.page) && Number(params.page) <= 100000 ? Number(params.page) : 1
  const q = typeof params.q === 'string' ? params.q : ''
  const result = await getTaxonomyCatalog(user, kind, { q, page, active: params.active === 'active' ? 'active' : 'all' })
  return <div className="min-w-0 [overflow-wrap:anywhere] [&_main]:min-w-0"><PortalShell user={{ name: user.name, role: user.role }}><div className="mx-auto min-w-0 max-w-5xl">
    {result.ok ? <TaxonomyCatalog initial={result.data} /> : <section className="space-y-4"><h1 className="text-3xl font-bold">Danh mục phân loại</h1><p role="alert" data-error-code={result.error.code}>{result.error.message}</p><Link href="/creator">Trang quản trị nội dung</Link></section>}
  </div></PortalShell></div>
}
