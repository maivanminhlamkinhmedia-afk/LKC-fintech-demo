import Link from 'next/link'
import { PortalShell } from '@/components/portal/PortalShell'
import { requirePermission } from '@/lib/authz'
import { getMediaLibrary } from '@/features/cms/media-query'
import { MediaLibrary } from '@/features/cms/components/MediaLibrary'

export default async function MediaPage() {
  const { user } = await requirePermission('cms:access')
  const result = await getMediaLibrary(user, { q: '', page: 1 })
  return <div className="min-w-0 [overflow-wrap:anywhere] [&_main]:min-w-0"><PortalShell user={{ name: user.name, role: user.role }}>
    {result.ok ? <MediaLibrary initial={result.data} /> : <section className="mx-auto max-w-5xl space-y-4 rounded-2xl bg-white p-6">
      <h1 className="text-3xl font-bold">Thư viện ảnh</h1><p role="alert" data-error-code={result.error.code}>{result.error.message}</p>
      <Link href="/creator" className="text-emerald-800 underline">Tổng quan</Link></section>}
  </PortalShell></div>
}
