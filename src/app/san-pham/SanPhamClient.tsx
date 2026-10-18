'use client'

import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { Navbar } from '@/features/landing/components/Navbar'
import { Footer } from '@/features/landing/components/Footer'
import { SectionLabel } from '@/features/landing/components/SectionLabel'
import { PaidResearchCatalogSection } from '@/features/landing/components/PaidResearchCatalogSection'
import { PRODUCTS } from '@/features/landing/data'
import { useInView } from '@/features/landing/hooks/useInView'

export default function SanPhamPage() {
  const { ref: productsRef, inView: productsIn } = useInView()
  const { ref: flagshipRef, inView: flagshipIn } = useInView()
  const { ref: ctaRef, inView: ctaIn } = useInView()

  return (
    <div className="min-h-screen bg-[#F8FAFC]" style={{ fontFamily: "var(--font-inter), 'Inter', system-ui, sans-serif" }}>
      <Navbar />

      {/* PAGE HEADER */}
      <section className="pt-32 pb-16 px-6 bg-gradient-to-br from-[#EFF6FF] to-slate-100 border-b border-slate-200">
        <div className="max-w-7xl mx-auto text-center">
          <div className="lkc-a1"><SectionLabel>Sản phẩm & Dịch vụ</SectionLabel></div>
          <h1 className="lkc-a2 text-4xl md:text-5xl font-bold text-[#0F172A]">Giải pháp đầu tư toàn diện</h1>
          <p className="lkc-a3 mt-4 text-[#475569] max-w-lg mx-auto text-lg leading-relaxed">
            Từ tư vấn đến quản lý danh mục — LKC Fintech đồng hành cùng bạn trên mọi hành trình đầu tư
          </p>
        </div>
      </section>

      {/* 3 CORE PRODUCTS */}
      <section className="py-20 px-6">
        <div ref={productsRef} className="max-w-7xl mx-auto">
          <div className={`text-center mb-14 transition-all duration-700 ease-out ${productsIn ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'}`}>
            <SectionLabel>Dịch vụ</SectionLabel>
            <h2 className="text-3xl font-bold text-[#0F172A]">Ba dịch vụ cốt lõi</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {PRODUCTS.map((p, i) => (
              <div key={p.title}
                style={{ transitionDelay: productsIn ? `${i * 120}ms` : '0ms' }}
                className={`p-6 rounded-2xl bg-white border border-slate-200 hover:border-[#0AACB5]/40 hover:shadow-lg transition-all group ${productsIn ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-6 scale-95'}`}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4" style={{ background: `${p.color}18` }}>
                  <p.icon size={24} style={{ color: p.color }} />
                </div>
                <h3 className="text-lg font-bold mb-3 text-[#0F172A] group-hover:text-[#0AACB5] transition-colors">{p.title}</h3>
                {p.desc && <p className="text-sm text-[#475569] leading-relaxed mb-4">{p.desc}</p>}
                {p.options && (
                  <div className="flex flex-col gap-2 mb-4">
                    {p.options.map(opt => (
                      <div key={opt}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-[#64748B]"
                        style={{ background: `${p.color}0D`, borderLeft: `2px solid ${p.color}50` }}>
                        {opt}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {p.tags.map(t => (
                    <span key={t} className="text-xs px-2.5 py-1 rounded-full border border-slate-200 text-[#475569] bg-slate-50">{t}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 2 FLAGSHIP PRODUCTS */}
      <section className="py-20 px-6 bg-slate-100">
        <div ref={flagshipRef} className="max-w-7xl mx-auto">
          <div className={`text-center mb-14 transition-all duration-700 ease-out ${flagshipIn ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'}`}>
            <SectionLabel>Sản phẩm nổi bật</SectionLabel>
            <h2 className="text-3xl font-bold text-[#0F172A]">Danh mục đầu tư</h2>
            <p className="mt-3 text-[#475569]">Giao vốn — chuyên gia quản lý — bạn nhận lợi nhuận</p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <div
              className={`relative overflow-hidden rounded-2xl p-8 text-white transition-all duration-700 ease-out motion-reduce:transition-none motion-reduce:transform-none motion-reduce:opacity-100 ${flagshipIn ? 'opacity-100 translate-x-0 translate-y-0' : 'opacity-0 translate-y-6 md:translate-y-0 md:-translate-x-8'}`}
              style={{ background: 'linear-gradient(135deg, #0891B2 0%, #0AACB5 60%, #0B9FA7 100%)' }}>
              <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full blur-3xl opacity-20 bg-white" />
              <span className="inline-block px-3 py-1 rounded-full bg-white/20 text-xs font-semibold mb-4">Sản phẩm nổi bật</span>
              <h3 className="text-2xl font-bold mb-1">LKC Stock</h3>
              <p className="text-white/80 text-sm mb-5">Danh mục chứng khoán được quản lý chuyên nghiệp</p>
              <p className="text-white/90 text-sm leading-relaxed mb-6">
                Đầu tư chứng khoán cơ sở tập trung vào cổ phiếu blue-chip, tăng trưởng và cổ tức tại thị trường Việt Nam. Phù hợp nhà đầu tư dài hạn không muốn theo dõi thị trường hàng ngày.
              </p>
              <ul className="space-y-2 mb-6">
                {['Hiệu suất vượt VN-Index', 'Báo cáo hiệu suất hàng tháng', 'Quản lý rủi ro chuyên nghiệp'].map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm text-white/90">
                    <div className="w-1.5 h-1.5 rounded-full bg-white shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link href="/nha-dau-tu" className="min-h-12 px-6 py-3 rounded-full bg-white text-[#0E7490] font-semibold text-sm hover:bg-white/90 transition inline-flex items-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0F172A]">
                Tư vấn LKC Stock <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>

            <div
              className={`relative overflow-hidden rounded-2xl p-8 text-white transition-all duration-700 ease-out delay-150 motion-reduce:transition-none motion-reduce:transform-none motion-reduce:opacity-100 ${flagshipIn ? 'opacity-100 translate-x-0 translate-y-0' : 'opacity-0 translate-y-6 md:translate-y-0 md:translate-x-8'}`}
              style={{ background: 'linear-gradient(135deg, #059669 0%, #10B981 60%, #0FCA9A 100%)' }}>
              <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full blur-3xl opacity-20 bg-white" />
              <span className="inline-block px-3 py-1 rounded-full bg-white/20 text-xs font-semibold mb-4">Sản phẩm mới</span>
              <h3 className="text-2xl font-bold mb-1">LKC Crypto</h3>
              <p className="text-white/80 text-sm mb-5">Đầu tư tài sản số an toàn & có chiến lược</p>
              <p className="text-white/90 text-sm leading-relaxed mb-6">
                Quản lý danh mục tài sản số theo chiến lược, tập trung vào BTC, ETH và các layer-1 tiềm năng theo chu kỳ thị trường.
              </p>
              <ul className="space-y-2 mb-6">
                {['Kiểm soát rủi ro', 'Phân bổ danh mục khoa học', 'Báo cáo NAV định kỳ'].map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm text-white/90">
                    <div className="w-1.5 h-1.5 rounded-full bg-white shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link href="/nha-dau-tu" className="min-h-12 px-6 py-3 rounded-full bg-white text-[#047857] font-semibold text-sm hover:bg-white/90 transition inline-flex items-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0F172A]">
                Tư vấn LKC Crypto <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* No approved public catalogue source is connected yet. */}
      <PaidResearchCatalogSection state={{ status: 'ready', products: [] }} />

      {/* CTA */}
      <section className="py-20 px-6">
        <div ref={ctaRef}
          className={`max-w-3xl mx-auto text-center transition-all duration-700 ease-out ${ctaIn ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
          <h2 className="text-3xl font-bold text-[#0F172A] mb-4">Sẵn sàng bắt đầu?</h2>
          <p className="text-[#475569] mb-8">Đội ngũ tư vấn LKC Fintech sẵn sàng hỗ trợ bạn chọn sản phẩm phù hợp</p>
          <div className="flex flex-wrap gap-4 justify-center">
            <a href="/nha-dau-tu"
              className="h-12 px-8 rounded-full bg-gradient-to-r from-[#0891B2] to-[#10B981] text-white font-semibold hover:opacity-90 transition flex items-center gap-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1B4FA0]">
              Liên hệ tư vấn <ArrowRight size={16} />
            </a>
            <a href="/goc-nhin"
              className="h-12 px-8 rounded-full border border-[#0AACB5] text-[#0891B2] font-medium hover:bg-[#0AACB5]/10 transition flex items-center cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1B4FA0]">
              Xem góc nhìn thị trường
            </a>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
