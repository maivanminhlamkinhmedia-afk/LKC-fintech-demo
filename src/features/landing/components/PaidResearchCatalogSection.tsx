import { useId } from 'react'
import Link from 'next/link'
import { ArrowRight, BookOpen, CircleAlert, LoaderCircle } from 'lucide-react'

// Presentation-only input. The caller must supply metadata approved for public
// display; this shape proves neither catalogue provenance nor product access.
export type PublicResearchProduct = Readonly<{
  id: string
  name: string
  description: string
}>

export type PublicResearchCatalogState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'error' }>
  | Readonly<{ status: 'ready'; products: readonly PublicResearchProduct[] }>

const contactStyle = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1B4FA0]'

export function PaidResearchCatalogSection({ state }: { state: PublicResearchCatalogState }) {
  const headingId = useId()
  const hasProducts = state.status === 'ready' && state.products.length > 0

  return (
    <section aria-labelledby={headingId} className="border-y border-slate-200 bg-gradient-to-br from-[#EFF6FF] via-white to-emerald-50 px-6 py-16 md:py-20">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col items-start gap-6 md:mb-10 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#176B63]">Nghiên cứu & phân tích</p>
            <h2 id={headingId} className="text-3xl font-bold tracking-tight text-[#0F172A] md:text-4xl">Nghiên cứu trả phí</h2>
            <p className="mt-4 text-base leading-relaxed text-[#475569]">Tìm hiểu các sản phẩm nghiên cứu được LKC công bố và trao đổi cùng đội ngũ tư vấn.</p>
          </div>
          <Link href="/nha-dau-tu" className={`${contactStyle} shrink-0 border border-[#1B4FA0] bg-white text-[#1B4FA0] hover:bg-blue-50`}>
            Liên hệ tư vấn <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>

        {hasProducts && state.status === 'ready' ? (
          <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {state.products.map(product => (
              <li key={product.id} className="min-w-0">
                <article className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <BookOpen size={24} aria-hidden="true" className="mb-5 text-[#176B63]" />
                  <h3 className="break-words text-xl font-semibold text-[#0F172A]">{product.name}</h3>
                  <p className="mb-6 mt-3 break-words text-sm leading-relaxed text-[#475569]">{product.description}</p>
                  <Link href="/nha-dau-tu" aria-label={`Liên hệ tư vấn về ${product.name}`} className={`${contactStyle} mt-auto self-start bg-[#1B4FA0] text-white hover:bg-[#163F80]`}>
                    Liên hệ tư vấn <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                </article>
              </li>
            ))}
          </ul>
        ) : (
          <div role={state.status === 'error' ? 'alert' : 'status'} aria-atomic="true" className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm md:py-16">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#EFF6FF] text-[#1B4FA0]" aria-hidden="true">
              {state.status === 'loading' ? <LoaderCircle size={26} className="animate-spin motion-reduce:animate-none" /> : state.status === 'error' ? <CircleAlert size={26} /> : <BookOpen size={26} />}
            </div>
            <h3 className="text-xl font-semibold text-[#0F172A]">
              {state.status === 'loading' ? 'Đang tải danh sách sản phẩm' : state.status === 'error' ? 'Chưa thể tải danh sách sản phẩm' : 'Chưa có dữ liệu công bố'}
            </h3>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-[#475569]">
              {state.status === 'loading' ? 'Vui lòng chờ trong giây lát.' : state.status === 'error' ? 'Bạn có thể quay lại sau hoặc liên hệ đội ngũ LKC để được tư vấn.' : 'Danh sách sản phẩm nghiên cứu sẽ được hiển thị khi có thông tin chính thức.'}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
