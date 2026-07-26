'use client'

import { useState, useEffect, useRef } from 'react'
import { X, MessageCircle, Mail, Phone } from 'lucide-react'
import { FLOATING_CONTACTS } from '@/features/landing/data'

// Official Zalo app icon (source: Wikimedia Commons — Icon_of_Zalo.svg, viewBox 0 0 50 50)
function ZaloIcon({ size = 36 }: { size?: number } = {}) {
  return (
    <svg viewBox="0 0 50 50" width={size} height={size}>
      <path fillRule="evenodd" clipRule="evenodd" d="M22.782 0.166016H27.199C33.2653 0.166016 36.8103 1.05701 39.9572 2.74421C43.1041 4.4314 45.5875 6.89585 47.2557 10.0428C48.9429 13.1897 49.8339 16.7347 49.8339 22.801V27.1991C49.8339 33.2654 48.9429 36.8104 47.2557 39.9573C45.5685 43.1042 43.1041 45.5877 39.9572 47.2559C36.8103 48.9431 33.2653 49.8341 27.199 49.8341H22.8009C16.7346 49.8341 13.1896 48.9431 10.0427 47.2559C6.89583 45.5687 4.41243 43.1042 2.7442 39.9573C1.057 36.8104 0.166016 33.2654 0.166016 27.1991V22.801C0.166016 16.7347 1.057 13.1897 2.7442 10.0428C4.43139 6.89585 6.89583 4.41245 10.0427 2.74421C13.1707 1.05701 16.7346 0.166016 22.782 0.166016Z" fill="#0068FF" />
      <path opacity="0.12" fillRule="evenodd" clipRule="evenodd" d="M49.8336 26.4736V27.1994C49.8336 33.2657 48.9427 36.8107 47.2555 39.9576C45.5683 43.1045 43.1038 45.5879 39.9569 47.2562C36.81 48.9434 33.265 49.8344 27.1987 49.8344H22.8007C17.8369 49.8344 14.5612 49.2378 11.8104 48.0966L7.27539 43.4267L49.8336 26.4736Z" fill="#001A33" />
      <path fillRule="evenodd" clipRule="evenodd" d="M7.779 43.5892C10.1019 43.846 13.0061 43.1836 15.0682 42.1825C24.0225 47.1318 38.0197 46.8954 46.4923 41.4732C46.8209 40.9803 47.1279 40.4677 47.4128 39.9363C49.1062 36.7779 50.0004 33.22 50.0004 27.1316V22.7175C50.0004 16.629 49.1062 13.0711 47.4128 9.91273C45.7385 6.75436 43.2461 4.28093 40.0877 2.58758C36.9293 0.894239 33.3714 0 27.283 0H22.8499C17.6644 0 14.2982 0.652754 11.4699 1.89893C11.3153 2.03737 11.1636 2.17818 11.0151 2.32135C2.71734 10.3203 2.08658 27.6593 9.12279 37.0782C9.13064 37.0921 9.13933 37.1061 9.14889 37.1203C10.2334 38.7185 9.18694 41.5154 7.55068 43.1516C7.28431 43.399 7.37944 43.5512 7.779 43.5892Z" fill="white" />
      <path d="M20.5632 17H10.8382V19.0853H17.5869L10.9329 27.3317C10.7244 27.635 10.5728 27.9194 10.5728 28.5639V29.0947H19.748C20.203 29.0947 20.5822 28.7156 20.5822 28.2606V27.1421H13.4922L19.748 19.2938C19.8428 19.1801 20.0134 18.9716 20.0893 18.8768L20.1272 18.8199C20.4874 18.2891 20.5632 17.8341 20.5632 17.2844V17Z" fill="#0068FF" />
      <path d="M32.9416 29.0947H34.3255V17H32.2402V28.3933C32.2402 28.7725 32.5435 29.0947 32.9416 29.0947Z" fill="#0068FF" />
      <path d="M25.814 19.6924C23.1979 19.6924 21.0747 21.8156 21.0747 24.4317C21.0747 27.0478 23.1979 29.171 25.814 29.171C28.4301 29.171 30.5533 27.0478 30.5533 24.4317C30.5723 21.8156 28.4491 19.6924 25.814 19.6924ZM25.814 27.2184C24.2785 27.2184 23.0273 25.9672 23.0273 24.4317C23.0273 22.8962 24.2785 21.645 25.814 21.645C27.3495 21.645 28.6007 22.8962 28.6007 24.4317C28.6007 25.9672 27.3685 27.2184 25.814 27.2184Z" fill="#0068FF" />
      <path d="M40.4867 19.6162C37.8516 19.6162 35.7095 21.7584 35.7095 24.3934C35.7095 27.0285 37.8516 29.1707 40.4867 29.1707C43.1217 29.1707 45.2639 27.0285 45.2639 24.3934C45.2639 21.7584 43.1217 19.6162 40.4867 19.6162ZM40.4867 27.2181C38.9322 27.2181 37.681 25.9669 37.681 24.4124C37.681 22.8579 38.9322 21.6067 40.4867 21.6067C42.0412 21.6067 43.2924 22.8579 43.2924 24.4124C43.2924 25.9669 42.0412 27.2181 40.4867 27.2181Z" fill="#0068FF" />
      <path d="M29.4562 29.0944H30.5747V19.957H28.6221V28.2793C28.6221 28.7153 29.0012 29.0944 29.4562 29.0944Z" fill="#0068FF" />
    </svg>
  )
}

// Official Facebook logo (source: simple-icons, viewBox 0 0 24 24)
function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" width="40" height="40" fill="#1877F2">
      <path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z" />
    </svg>
  )
}

// Official Telegram logo (source: simple-icons, viewBox 0 0 24 24)
function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" width="40" height="40" fill="#0088CC">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  )
}

function ContactIcon({ id, color }: { id: string; color: string }) {
  if (id === 'zalo') return <ZaloIcon />
  if (id === 'facebook') return <FacebookIcon />
  if (id === 'telegram') return <TelegramIcon />
  if (id === 'email') return (
    <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ backgroundColor: color }}>
      <Mail size={20} className="text-white" />
    </div>
  )
  if (id === 'hotline') return (
    <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ backgroundColor: color }}>
      <Phone size={20} className="text-white" />
    </div>
  )
  return null
}

export function FloatingContact() {
  const [open, setOpen] = useState(false)
  const [zaloOpen, setZaloOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const zaloHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setZaloOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const showZalo = () => {
    if (zaloHideTimer.current) clearTimeout(zaloHideTimer.current)
    setZaloOpen(true)
  }
  const hideZaloDeferred = () => {
    if (zaloHideTimer.current) clearTimeout(zaloHideTimer.current)
    zaloHideTimer.current = setTimeout(() => setZaloOpen(false), 180)
  }

  return (
    <div ref={ref} className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {FLOATING_CONTACTS.map((c, i) => {
        const itemStyle = {
          opacity: open ? 1 : 0,
          transform: open ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.75)',
          pointerEvents: (open ? 'auto' : 'none') as 'auto' | 'none',
          transition: 'opacity 200ms ease-out, transform 200ms ease-out',
          transitionDelay: open ? `${i * 40}ms` : `${(FLOATING_CONTACTS.length - 1 - i) * 20}ms`,
        }

        if (c.id === 'zalo' && c.groups?.length) {
          return (
            <div
              key={c.id}
              className="relative flex items-center gap-2.5"
              style={itemStyle}
              onMouseEnter={showZalo}
              onMouseLeave={hideZaloDeferred}
            >
              {/* Sub-menu: hiệu ứng "phân thân" — 2 option tách ra từ vị trí icon Zalo */}
              <div className="absolute right-[56px] top-1/2 pointer-events-none">
                {c.groups.map((g, gi) => {
                  const dir = gi === 0 ? -1 : 1 // 0: lên trên, 1: xuống dưới
                  return (
                    <a
                      key={g.href}
                      href={g.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group/zalo absolute right-0 flex items-center gap-2 pl-1 pr-4 py-1
                                 text-xs font-semibold text-white
                                 bg-gradient-to-r from-[#0068FF] to-[#1A78FF]
                                 rounded-full whitespace-nowrap shadow-lg ring-1 ring-white/40
                                 hover:shadow-xl hover:scale-105
                                 transition-shadow cursor-pointer"
                      style={{
                        top: 0,
                        opacity: zaloOpen ? 1 : 0,
                        transform: zaloOpen
                          ? `translate(0, calc(-50% + ${dir * 28}px)) scale(1)`
                          : 'translate(36px, -50%) scale(0.3)',
                        transformOrigin: 'right center',
                        pointerEvents: zaloOpen ? 'auto' : 'none',
                        transition:
                          'opacity 240ms ease-out, transform 460ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                        transitionDelay: zaloOpen ? `${gi * 70}ms` : '0ms',
                      }}
                    >
                      <span
                        className="w-7 h-7 rounded-full bg-white flex items-center justify-center shadow-sm
                                   group-hover/zalo:scale-110 transition-transform"
                      >
                        <ZaloIcon size={22} />
                      </span>
                      {g.label}
                    </a>
                  )
                })}
              </div>
              {/* Icon button */}
              <button
                type="button"
                onClick={() => setZaloOpen(v => !v)}
                aria-label={`Liên hệ qua ${c.label}`}
                aria-expanded={zaloOpen}
                className="relative w-11 h-11 rounded-full flex items-center justify-center shadow-md
                           hover:scale-110 active:scale-95 transition-transform cursor-pointer
                           bg-white"
              >
                {/* Vòng pulse khi active — gợi cảm giác "phân thân" */}
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-full ring-2 ring-[#0068FF]/50 pointer-events-none"
                  style={{
                    opacity: zaloOpen ? 1 : 0,
                    transform: zaloOpen ? 'scale(1.45)' : 'scale(1)',
                    transition: 'opacity 480ms ease-out, transform 520ms ease-out',
                  }}
                />
                {zaloOpen && (
                  <span
                    aria-hidden
                    className="absolute inset-0 rounded-full bg-[#0068FF]/30 animate-ping pointer-events-none"
                  />
                )}
                <ContactIcon id={c.id} color={c.color} />
              </button>
            </div>
          )
        }

        return (
          <a
            key={c.id}
            href={c.href}
            target={c.id !== 'hotline' && c.id !== 'email' ? '_blank' : undefined}
            rel="noopener noreferrer"
            aria-label={`Liên hệ qua ${c.label}`}
            className="group flex items-center gap-2.5"
            style={itemStyle}
          >
            {/* Tooltip — desktop only */}
            <span className="hidden md:block opacity-0 group-hover:opacity-100 transition-opacity duration-150
                             text-xs font-medium text-white bg-[#0A1628]/90 px-3 py-1.5 rounded-full
                             whitespace-nowrap shadow-sm select-none">
              {c.tooltip}
            </span>
            {/* Icon button */}
            <div className="w-11 h-11 rounded-full flex items-center justify-center shadow-md
                            hover:scale-110 active:scale-95 transition-transform cursor-pointer overflow-hidden bg-white">
              <ContactIcon id={c.id} color={c.color} />
            </div>
          </a>
        )
      })}

      {/* Toggle button */}
      <button
        onClick={() => {
          setOpen(v => {
            if (v) setZaloOpen(false)
            return !v
          })
        }}
        aria-label={open ? 'Đóng liên hệ' : 'Mở liên hệ'}
        aria-expanded={open}
        className="relative w-[52px] h-[52px] rounded-full flex items-center justify-center
                   bg-gradient-to-br from-[#0891B2] to-[#10B981]
                   shadow-lg shadow-[#0891B2]/30
                   hover:scale-105 active:scale-95 transition-transform cursor-pointer"
      >
        {!open && (
          <span className="absolute inset-0 rounded-full bg-[#0AACB5] animate-ping opacity-30 pointer-events-none" />
        )}
        {open
          ? <X size={22} className="text-white" />
          : <MessageCircle size={22} className="text-white" />
        }
      </button>
    </div>
  )
}
