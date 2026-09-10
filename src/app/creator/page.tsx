import Link from 'next/link'
import { requirePermission } from '@/lib/authz'

export default async function CreatorPage() {
  await requirePermission('content:write')
  return (
    <section>
      <h1 className="text-3xl font-bold">Khu người tạo nội dung</h1>
      <p className="mt-2 text-slate-500">Điểm vào dành cho Creator/Analyst/Admin. Module CMS bài viết và khóa học sẽ dùng cùng RBAC này.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/kien-thuc" className="rounded-xl bg-white px-5 py-3 shadow-sm">Kho kiến thức</Link>
        <Link href="/goc-nhin" className="rounded-xl bg-white px-5 py-3 shadow-sm">Góc nhìn / phân tích</Link>
      </div>
    </section>
  )
}
