'use client'

import { useEffect, useRef, useState } from 'react'

export function PreviewCover({ src, alt, caption }: { src: string; alt: string; caption: string | null }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const image = useRef<HTMLImageElement>(null)
  useEffect(() => {
    // A failed SSR image request can finish before hydration attaches onError.
    if (image.current?.complete && image.current.naturalWidth === 0) setFailedSrc(src)
  }, [src])
  if (failedSrc === src) return <p role="status" className="rounded-xl bg-slate-100 p-5 text-slate-600">Ảnh bìa hiện không khả dụng.</p>
  return <figure className="min-w-0">
    {/* Private same-origin content is authenticated and must not pass through an image optimizer. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img ref={image} src={src} alt={alt} className="h-auto max-h-[32rem] w-full rounded-2xl object-contain"
      referrerPolicy="no-referrer" onError={() => setFailedSrc(src)} />
    {caption && <figcaption className="mt-2 text-sm text-slate-600">{caption}</figcaption>}
  </figure>
}
