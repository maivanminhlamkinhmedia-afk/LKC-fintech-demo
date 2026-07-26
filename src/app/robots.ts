import type { MetadataRoute } from 'next'
import { SITE } from '@/lib/seo'

// Tạo /robots.txt — cho phép Google quét toàn site, chặn khu vực nội bộ, trỏ tới sitemap.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/'],
    },
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  }
}
