'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogIn, Menu, X } from 'lucide-react'
import { Logo } from './Logo'
import { NAV_LINKS } from '@/features/landing/data'

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-[#1B4FA0] via-[#2BAD97] to-[#5DC9A0] shadow-lg shadow-black/20">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Logo />

          <div className="hidden md:flex items-center gap-8">
            {NAV_LINKS.map(l => (
              <Link
                key={l.href}
                href={l.href}
                className={`text-sm font-medium transition-colors cursor-pointer ${
                  pathname === l.href
                    ? 'text-white font-semibold underline underline-offset-4 decoration-white/60'
                    : 'text-white/80 hover:text-white'
                }`}
              >
                {l.label}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/dang-nhap"
              className="hidden md:flex h-9 px-4 items-center gap-2 rounded-full border border-white/30 text-white text-sm font-semibold hover:bg-white/10 transition-colors"
            >
              <LogIn size={15} /> Đăng nhập
            </Link>
            <Link
              href="/san-pham"
              className="hidden lg:flex h-9 px-5 items-center rounded-full bg-white text-[#1B4FA0] text-sm font-semibold hover:bg-white/90 transition-opacity cursor-pointer"
            >
              Bắt đầu đầu tư
            </Link>

            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X size={18} className="text-white" /> : <Menu size={18} className="text-white" />}
            </button>
          </div>
        </div>
      </nav>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-gradient-to-b from-[#1B4FA0] to-[#2BAD97] pt-16 flex flex-col">
          <div className="flex flex-col px-6 py-8 gap-6">
            {NAV_LINKS.map(l => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setMobileOpen(false)}
                className={`text-xl font-semibold transition-colors cursor-pointer ${
                  pathname === l.href
                    ? 'text-white'
                    : 'text-white/80 hover:text-white'
                }`}
              >
                {l.label}
              </Link>
            ))}
            <Link
              href="/dang-nhap"
              onClick={() => setMobileOpen(false)}
              className="mt-2 h-12 flex items-center justify-center gap-2 rounded-full border border-white/30 text-white font-semibold"
            >
              <LogIn size={17} /> Đăng nhập hệ thống
            </Link>
            <Link
              href="/san-pham"
              onClick={() => setMobileOpen(false)}
              className="h-12 flex items-center justify-center rounded-full bg-white text-[#1B4FA0] font-semibold"
            >
              Bắt đầu đầu tư →
            </Link>
          </div>
        </div>
      )}
    </>
  )
}
