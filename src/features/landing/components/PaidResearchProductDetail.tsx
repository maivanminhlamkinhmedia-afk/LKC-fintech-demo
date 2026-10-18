import 'server-only'

import Link from 'next/link'
import { ArrowLeft, ArrowUpRight, BookOpen, Layers3, MessageCircle } from 'lucide-react'
import { Navbar } from './Navbar'
import { Footer } from './Footer'

const productKinds = {
  equities: 'Chứng khoán cơ sở',
  equityDerivatives: 'Chứng khoán phái sinh',
  commodityDerivatives: 'Hàng hóa phái sinh',
  gold: 'Vàng',
  digitalAssets: 'Tài sản số',
} as const

const benefitGroups = [
  { key: 'manual', name: 'Khuyến nghị thủ công', description: 'Nghiên cứu và khuyến nghị do chuyên viên biên soạn.' },
  { key: 'automated', name: 'Khuyến nghị tự động', description: 'Nội dung có thể được tiếp nhận từ server/hệ thống máy hoặc webhook khi có nguồn được cấu hình và kiểm chứng.' },
  { key: 'probability', name: 'Vùng và xu hướng xác suất', description: 'Nhóm nghiên cứu vùng giá và xu hướng xác suất theo thiết kế.' },
] as const

type BenefitGroup = typeof benefitGroups[number]['key']
type Availability = 'available' | 'not_ready' | 'unconfirmed'

/**
 * Presentation DTO only, not a public API or access contract.
 * The server caller must supply only metadata cleared for public publication,
 * including each availability claim. This component cannot verify provenance;
 * publication is a display state, never runtime authorization.
 * Kind keys are UI categories, not Product IDs or commercial slugs.
 */
export type PublicResearchProductDetailDTO = Readonly<{
  publication: 'published'
  kind: keyof typeof productKinds
  name: string
  description: string
  availability?: Readonly<Partial<Record<BenefitGroup, Availability>>>
}>

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0F172A]'

function isDisplayable(product: PublicResearchProductDetailDTO | null): product is PublicResearchProductDetailDTO {
  return !!product && product.publication === 'published'
    && Object.hasOwn(productKinds, product.kind)
    && typeof product.name === 'string' && product.name.trim().length > 0
    && typeof product.description === 'string' && product.description.trim().length > 0
}

function availabilityLabel(value: Availability | undefined) {
  if (value === 'available') return 'Đã sẵn sàng cung cấp'
  if (value === 'not_ready') return 'Chưa sẵn sàng cung cấp'
  return 'Chưa xác nhận sẵn sàng'
}

export function PaidResearchProductDetail({ product }: { product: PublicResearchProductDetailDTO | null }) {
  const published = isDisplayable(product)

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A]">
      <a href="#product-detail" className={`sr-only focus:not-sr-only focus:fixed focus:top-20 focus:left-6 focus:z-50 focus:rounded-lg focus:bg-white focus:p-4 ${focus}`}>
        Đến nội dung sản phẩm
      </a>
      <Navbar />
      <main id="product-detail" tabIndex={-1} className="pt-24 pb-20">
        <div className="mx-auto max-w-7xl px-6">
          <Link href="/san-pham" className={`inline-flex min-h-12 items-center gap-2 rounded-lg text-sm font-semibold text-[#1B4FA0] ${focus}`}>
            <ArrowLeft size={16} aria-hidden="true" /> Sản phẩm &amp; dịch vụ
          </Link>

          {!published ? (
            <section aria-labelledby="unpublished-title" className="mt-6 rounded-3xl border border-slate-200 bg-white px-6 py-14 text-center sm:px-12">
              <BookOpen size={32} aria-hidden="true" className="mx-auto mb-6 text-[#1B4FA0]" />
              <p className="mb-3 text-sm font-semibold text-[#1B4FA0]">Nghiên cứu trả phí</p>
              <h1 id="unpublished-title" className="text-3xl font-bold tracking-tight">Chưa có thông tin sản phẩm công bố</h1>
              <p role="status" className="mx-auto mt-5 max-w-xl leading-7 text-[#475569]">
                Thông tin chi tiết sẽ hiển thị khi được công bố. Bạn có thể xem các dịch vụ hiện có hoặc liên hệ để được tư vấn.
              </p>
              <Link href="/nha-dau-tu" className={`mt-8 inline-flex min-h-12 items-center justify-center rounded-xl bg-[#1B4FA0] px-6 py-3 font-semibold text-white hover:bg-[#153E7E] ${focus}`}>
                Liên hệ tư vấn
              </Link>
            </section>
          ) : (
            <>
              <header className="relative mt-6 overflow-hidden rounded-3xl border border-blue-100 bg-gradient-to-br from-[#EFF6FF] via-white to-emerald-50 px-6 py-10 sm:px-10 sm:py-12">
                <p className="text-sm font-semibold tracking-wide text-[#1B4FA0]">Nghiên cứu trả phí</p>
                <p className="mt-5 inline-flex rounded-full border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-[#1B4FA0]">
                  {productKinds[product.kind]}
                </p>
                <h1 className="mt-6 max-w-4xl break-words text-3xl leading-tight font-bold tracking-tight sm:text-5xl">{product.name}</h1>
                <p className="mt-5 max-w-3xl break-words whitespace-pre-line text-base leading-8 text-[#475569] sm:text-lg">{product.description}</p>
                <p className="mt-7 text-sm text-[#475569]">Thông tin giới thiệu đã công bố · Tình trạng cung cấp được ghi riêng bên dưới.</p>
              </header>

              <div className="mt-8 grid items-start gap-8 lg:grid-cols-3">
                <section aria-labelledby="benefits-title" className="min-w-0 rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 lg:col-span-2">
                  <div className="flex items-center gap-3">
                    <Layers3 size={22} aria-hidden="true" className="shrink-0 text-[#1B4FA0]" />
                    <h2 id="benefits-title" className="text-2xl font-bold">Quyền lợi theo thiết kế</h2>
                  </div>
                  <p className="mt-4 leading-7 text-[#475569]">Gói bao gồm khuyến nghị thủ công, khuyến nghị tự động, vùng và xu hướng xác suất. Ba nhóm đi kèm cùng một sản phẩm, không phải ba gói bán riêng. Mô tả thiết kế không đồng nghĩa với việc dữ liệu đang hoạt động.</p>
                  <ul className="mt-7 space-y-4">
                    {benefitGroups.map((group, index) => (
                      <li key={group.key} className="rounded-2xl border border-slate-200 bg-[#F8FAFC] p-5 sm:p-6">
                        <div className="flex items-start gap-4">
                          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-sm font-bold text-[#1B4FA0]">0{index + 1}</span>
                          <div className="min-w-0">
                            <h3 className="text-lg font-bold">{group.name}</h3>
                            <p className="mt-2 leading-7 text-[#475569]">{group.description}</p>
                            <p className="mt-4 text-sm leading-6 text-[#334155]">
                              <span className="font-semibold">Tình trạng cung cấp: </span>
                              {availabilityLabel(product.availability?.[group.key])}
                            </p>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-6 text-sm leading-6 text-[#475569]">Thông tin nghiên cứu mang tính tham khảo, không bảo đảm kết quả đầu tư.</p>
                </section>

                <aside aria-labelledby="consultation-title" className="min-w-0 rounded-3xl border border-blue-100 bg-white p-6 sm:p-8">
                  <MessageCircle size={26} aria-hidden="true" className="text-[#1B4FA0]" />
                  <h2 id="consultation-title" className="mt-5 text-2xl font-bold">Tìm hiểu cùng LKC</h2>
                  <p className="mt-4 leading-7 text-[#475569]">Trao đổi với đội ngũ tư vấn để hiểu phạm vi nghiên cứu và tình trạng cung cấp phù hợp với nhu cầu của bạn.</p>
                  <Link href="/nha-dau-tu" className={`mt-6 flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#1B4FA0] px-5 py-3 text-center font-semibold text-white hover:bg-[#153E7E] ${focus}`}>
                    Liên hệ tư vấn <ArrowUpRight size={18} aria-hidden="true" className="shrink-0" />
                  </Link>
                  <p className="mt-4 text-sm leading-6 text-[#475569]">Liên hệ tư vấn không phải đăng ký sử dụng hay xác nhận quyền truy cập.</p>
                </aside>
              </div>
            </>
          )}
        </div>
      </main>
      <Footer />
    </div>
  )
}
