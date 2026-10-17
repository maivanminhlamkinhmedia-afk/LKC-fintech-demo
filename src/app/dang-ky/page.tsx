import type { Metadata } from 'next'
import { Navbar } from '@/features/landing/components/Navbar'
import { Footer } from '@/features/landing/components/Footer'
import { ClientRegistrationEntry } from '@/features/referrals/components/ClientRegistrationEntry'

export const metadata: Metadata = {
  title: 'Tạo tài khoản',
  description: 'Thông tin đăng ký tài khoản LKC Fintech. Đăng ký trực tuyến hiện chưa sẵn sàng.',
  alternates: { canonical: '/dang-ky' },
}

export default function RegistrationPage() {
  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0A1628]">
      <Navbar />
      {/* Intentionally no adapter: enabling registration requires a separate
          C04/Auth/schema grant and an authoritative server transaction. */}
      <ClientRegistrationEntry />
      <Footer />
    </div>
  )
}
