import type { Metadata } from "next"

import "./globals.css"
import { FloatingContact } from '@/features/landing/components/FloatingContact'
import { SITE } from '@/lib/seo'



export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: SITE.title,
    template: `%s | ${SITE.name}`,
  },
  description: SITE.description,
  keywords: [
    'LKC Fintech',
    'tư vấn đầu tư',
    'quản lý danh mục chứng khoán',
    'đầu tư chứng khoán',
    'đầu tư FX',
    'đầu tư Crypto',
    'quản lý tài sản',
    'tài chính Việt Nam',
  ],
  applicationName: SITE.name,
  authors: [{ name: SITE.name }],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: SITE.locale,
    url: SITE.url,
    siteName: SITE.name,
    title: SITE.title,
    description: SITE.description,
    images: [{ url: SITE.ogImage, width: 1200, height: 630, alt: SITE.name }],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE.title,
    description: SITE.description,
    images: [SITE.ogImage],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
  // Favicon dùng file-convention của App Router: src/app/icon.png + apple-icon.png.
  // Next.js tự thêm hash vào URL (vd /icon.png?<hash>) nên khi đổi icon, trình duyệt
  // bị buộc tải lại — tránh kẹt cache favicon cũ (quả địa cầu) như trước.
}

// Khai báo "đây là tổ chức tài chính gì" cho Google (rich results / Knowledge panel).
const orgJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FinancialService',
  name: SITE.name,
  url: SITE.url,
  logo: `${SITE.url}/lkc-logo-color.png`,
  image: `${SITE.url}${SITE.ogImage}`,
  description: SITE.description,
  areaServed: 'VN',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body className="min-h-full flex flex-col antialiased bg-white text-[#0A1628]">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
        />
        {children}
        <FloatingContact />
      </body>
    </html>
  )
}
