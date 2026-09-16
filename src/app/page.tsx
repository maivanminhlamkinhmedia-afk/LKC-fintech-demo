'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react'
import { Navbar } from '@/features/landing/components/Navbar'
import { Footer } from '@/features/landing/components/Footer'
import { SLIDES, STATS } from '@/features/landing/data'
import { useInView } from '@/features/landing/hooks/useInView'

export default function HomePage() {
  const [slide, setSlide] = useState(0)
  const { ref: statsRef, inView: statsIn } = useInView()
  const { ref: cardsRef, inView: cardsIn } = useInView()

  useEffect(() => {
    const t = setInterval(() => setSlide(s => (s + 1) % SLIDES.length), 5500)
    return () => clearInterval(t)
  }, [])

  const prevSlide = () => setSlide(s => (s - 1 + SLIDES.length) % SLIDES.length)
  const nextSlide = () => setSlide(s => (s + 1) % SLIDES.length)

  return (
    <div className="min-h-screen bg-[#F8FAFC]" style={{ fontFamily: "var(--font-inter), 'Inter', system-ui, sans-serif" }}>
      <Navbar />

      {/* ── HERO ──────────────────────────────────────────────────────── */}
      <section className="relative h-screen min-h-[600px] overflow-hidden bg-[#0A1628]">
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.04] z-0"
          style={{
            backgroundImage: 'linear-gradient(#0AACB5 1px, transparent 1px), linear-gradient(90deg, #0AACB5 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />
        <div className="absolute inset-0">
          {SLIDES.map((s, i) => (
            <div
              key={i}
              aria-hidden={i !== slide}
              className={`absolute inset-0 h-full flex items-center overflow-hidden transition-opacity duration-200 ease-out ${
                i === slide ? 'opacity-100 z-[1]' : 'opacity-0 pointer-events-none z-0'
              }`}
            >
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-1/4 left-1/6 w-[500px] h-[500px] rounded-full blur-none md:blur-[80px] opacity-25"
                  style={{ background: `radial-gradient(circle, ${s.orb1}, transparent)` }} />
                <div className="absolute bottom-1/4 right-1/6 w-[400px] h-[400px] rounded-full blur-none md:blur-[70px] opacity-20"
                  style={{ background: `radial-gradient(circle, ${s.orb2}, transparent)` }} />
              </div>
              <div className="relative z-10 w-full">
                <div className="max-w-7xl mx-auto px-6">
                  <div className="max-w-3xl">
                    <div className={`inline-flex items-center gap-2 mb-6 px-3 py-1.5 rounded-full border border-[#0AACB5]/40 bg-[#0AACB5]/10 ${i === 0 ? 'lkc-a1' : ''}`}>
                      <div className="w-1.5 h-1.5 rounded-full bg-[#0AACB5] animate-pulse" />
                      <span className="text-[#0AACB5] text-xs font-medium tracking-wider uppercase">{s.badge}</span>
                    </div>
                    <h1 className={`text-4xl md:text-6xl font-bold text-white leading-[1.3] mb-6 tracking-tight ${i === 0 ? 'lkc-a2' : ''}`}>
                      {s.headline[0]}<br />
                      <span className="bg-gradient-to-r from-[#0AACB5] to-[#10B981] bg-clip-text text-transparent pt-[0.15em] inline-block">{s.headline[1]}</span>
                    </h1>
                    <p className={`text-white/75 text-lg leading-relaxed mb-8 max-w-xl ${i === 0 ? 'lkc-a3' : ''}`}>{s.sub}</p>
                    <div className={`flex flex-wrap gap-4 ${i === 0 ? 'lkc-a4' : ''}`}>
                      <Link href="/san-pham" className="h-12 px-7 rounded-full bg-gradient-to-r from-[#0891B2] to-[#10B981] text-white font-semibold hover:opacity-90 transition-opacity flex items-center gap-2 cursor-pointer">
                        {s.cta} <ArrowRight size={16} />
                      </Link>
                      <Link href="/gioi-thieu" className="h-12 px-7 rounded-full border border-white/30 text-white font-medium hover:bg-white/10 transition-colors flex items-center cursor-pointer">
                        {s.cta2}
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="absolute bottom-8 left-0 right-0 flex items-center justify-center gap-6 z-10">
          <button onClick={prevSlide} className="w-8 h-8 rounded-full border border-white/30 flex items-center justify-center text-white hover:bg-white/10 transition cursor-pointer">
            <ChevronLeft size={16} />
          </button>
          <div className="flex gap-2">
            {SLIDES.map((_, i) => (
              <button key={i} onClick={() => setSlide(i)}
                className={`transition-all duration-300 rounded-full cursor-pointer ${i === slide ? 'w-6 h-2 bg-[#0AACB5]' : 'w-2 h-2 bg-white/30 hover:bg-white/50'}`} />
            ))}
          </div>
          <button onClick={nextSlide} className="w-8 h-8 rounded-full border border-white/30 flex items-center justify-center text-white hover:bg-white/10 transition cursor-pointer">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/10 z-10">
          <div className="h-full bg-gradient-to-r from-[#0891B2] to-[#10B981]"
            style={{ width: `${((slide + 1) / SLIDES.length) * 100}%`, transition: 'width 0.5s ease-in-out' }} />
        </div>
      </section>

      {/* ── STATS BAR ─────────────────────────────────────────────────── */}
      <section className="bg-white border-y border-slate-200">
        <div ref={statsRef} className="max-w-7xl mx-auto px-6 py-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {STATS.map((s, i) => (
              <div key={s.label}
                style={{ transitionDelay: statsIn ? `${i * 100}ms` : '0ms' }}
                className={`flex flex-col items-center text-center gap-2 transition-all duration-700 ease-out ${statsIn ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'}`}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[#0AACB5]/10">
                  <s.icon size={20} className="text-[#0AACB5]" />
                </div>
                <div className="text-3xl font-bold bg-gradient-to-r from-[#0891B2] to-[#10B981] bg-clip-text text-transparent">{s.value}</div>
                <div className="text-sm text-[#475569]">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── NAV CARDS ─────────────────────────────────────────────────── */}
      <section className="py-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div ref={cardsRef} className="text-center mb-12">
            <h2 className={`text-3xl font-bold text-[#0F172A] transition-all duration-700 ease-out ${cardsIn ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'}`}>
              Khám phá LKC Fintech
            </h2>
            <p className={`mt-3 text-[#475569] transition-all duration-700 ease-out delay-100 ${cardsIn ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'}`}>
              Chọn chủ đề bạn quan tâm để bắt đầu
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { label: 'Giới thiệu', href: '/gioi-thieu', desc: 'Về LKC Fintech', color: '#0AACB5' },
              { label: 'Sản phẩm', href: '/san-pham', desc: 'Tư vấn & quản lý danh mục', color: '#10B981' },
              { label: 'Góc nhìn TT', href: '/goc-nhin', desc: 'Phân tích thị trường', color: '#6366F1' },
              { label: 'Kiến thức', href: '/kien-thuc', desc: 'Học đầu tư cùng LKC', color: '#D4A843' },
              { label: 'Nhà đầu tư', href: '/nha-dau-tu', desc: 'FAQ & liên hệ', color: '#EC4899' },
            ].map((item, i) => (
              <Link key={item.href} href={item.href}
                style={{ transitionDelay: cardsIn ? `${i * 80}ms` : '0ms' }}
                className={`group p-6 rounded-2xl bg-white border border-slate-200 hover:border-[#0AACB5]/50 hover:shadow-md transition-all text-center cursor-pointer ${cardsIn ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-95'}`}>
                <div className="w-10 h-10 rounded-xl mx-auto mb-3 flex items-center justify-center" style={{ background: `${item.color}18` }}>
                  <div className="w-3 h-3 rounded-full" style={{ background: item.color }} />
                </div>
                <div className="font-semibold text-sm text-[#0F172A] group-hover:text-[#0AACB5] transition-colors">{item.label}</div>
                <div className="text-xs text-[#64748B] mt-1">{item.desc}</div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
