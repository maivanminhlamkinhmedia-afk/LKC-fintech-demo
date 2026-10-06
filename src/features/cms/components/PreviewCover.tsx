'use client'

import { useState } from 'react'

export function PreviewCover({ src, alt, caption }: { src: string; alt: string; caption: string | null }) {
  const [unavailable, setUnavailable] = useState(false)
  if (unavailable) return <p role="status" className="rounded-xl bg-slate-100 p-5 text-slate-600">Ảnh bìa hiện không khả dụng.</p>
  return <figure className="min-w-0">
    {/* Private same-origin content is authenticated and must not pass through an image optimizer. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={src} alt={alt} className="h-auto max-h-[32rem] w-full rounded-2xl object-contain"
      referrerPolicy="no-referrer" onError={() => setUnavailable(true)} />
    {caption && <figcaption className="mt-2 text-sm text-slate-600">{caption}</figcaption>}
  </figure>
}
