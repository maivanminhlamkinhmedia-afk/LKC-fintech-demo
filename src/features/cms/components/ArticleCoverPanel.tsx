'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { saveArticleCover, searchMediaLibrary } from '../media-actions'
import type { MediaFailure } from '../media-contract'
import type { CoverSnapshot, MediaDTO } from '../media-store'

const button = 'rounded-xl border border-slate-300 px-4 py-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:opacity-50'
const input = 'w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-emerald-600'
export function ArticleCoverPanel({ initial }: { initial: CoverSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial), [chosen, setChosen] = useState<MediaDTO | null>(initial.cover)
  const [query, setQuery] = useState(''), [items, setItems] = useState<MediaDTO[]>([])
  const [page, setPage] = useState(1), [pages, setPages] = useState(1)
  const [pending, setPending] = useState(false), [blocked, setBlocked] = useState(false), [searching, setSearching] = useState(false)
  const [online, setOnline] = useState(true), [error, setError] = useState<MediaFailure | null>(null), [message, setMessage] = useState('')
  const flight = useRef(false), generation = useRef(0), alive = useRef(false)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const dirty = chosen?.id !== snapshot.cover?.id
  useEffect(() => {
    alive.current = true
    const requestGeneration = generation
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { alive.current = false; requestGeneration.current++; window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  useEffect(() => { if (error) errorRef.current?.focus() }, [error])
  useEffect(() => {
    const warn = dirty || pending || blocked
    const unload = (event: BeforeUnloadEvent) => { if (warn) { event.preventDefault(); event.returnValue = '' } }
    const link = (event: MouseEvent) => {
      if (!warn || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return
      const target = new URL(anchor.href, location.href)
      if (target.origin === location.origin && target.pathname === location.pathname && target.search === location.search) return
      if (!window.confirm('Lựa chọn ảnh bìa chưa lưu có thể bị mất. Rời trang?')) { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation() }
    }
    window.addEventListener('beforeunload', unload); document.addEventListener('click', link, true)
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', link, true) }
  }, [dirty, pending, blocked])
  async function search(q: string, nextPage: number) {
    const request = ++generation.current; setSearching(true)
    try {
      const result = await searchMediaLibrary({ q, page: nextPage })
      if (!alive.current || request !== generation.current) return
      if (result.ok) { setItems(result.data.items.filter(item => item.managed)); setPage(result.data.page); setPages(result.data.totalPages); setError(null) }
      else setError(result.error)
    } catch { if (alive.current && request === generation.current) setError({ code: 'INTERNAL_ERROR', message: 'Không tải được thư viện ảnh.' }) }
    finally { if (alive.current && request === generation.current) setSearching(false) }
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (flight.current || blocked || !online || !snapshot.canMutate) return
    flight.current = true; setPending(true); setError(null)
    try {
      const result = await saveArticleCover(snapshot.id, { mediaId: chosen?.id ?? null, expectedUpdatedAt: snapshot.updatedAt,
        expectedMediaUpdatedAt: chosen?.updatedAt ?? null })
      if (!alive.current) return
      if (!result.ok) { setError(result.error); if (['EDIT_CONFLICT', 'MEDIA_CONFLICT', 'UNKNOWN_OUTCOME', 'INTERNAL_ERROR'].includes(result.error.code)) setBlocked(true); return }
      setSnapshot(result.data); setChosen(result.data.cover); setMessage(result.warning ?? 'Ảnh bìa đã được lưu.')
    } catch { if (alive.current) { setBlocked(true); setError({ code: 'UNKNOWN_OUTCOME', message: 'Chưa xác nhận được kết quả. Tải lại để đối chiếu.' }) } }
    finally { flight.current = false; if (alive.current) setPending(false) }
  }
  return <section className="mx-auto min-w-0 max-w-5xl space-y-6 [overflow-wrap:anywhere]" aria-busy={pending}>
    <header><h1 className="text-3xl font-bold">Ảnh bìa bài viết</h1><h2 className="mt-2 text-xl font-semibold">{snapshot.title}</h2>
      <p className="text-sm text-slate-600">{snapshot.status} · Lưu thủ công; thay đổi bài viết ở tab khác cần tải lại trước khi lưu.</p></header>
    <nav className="flex flex-wrap gap-4 text-emerald-800 underline" aria-label="Điều hướng ảnh bìa">
      <Link href={`/creator/articles/${encodeURIComponent(snapshot.id)}/edit`}>Bài viết</Link>
      <Link href={`/creator/articles/${encodeURIComponent(snapshot.id)}/sources`}>Nguồn</Link>
      <Link href={`/creator/articles/${encodeURIComponent(snapshot.id)}/classification`}>Phân loại</Link>
      <Link href="/creator/media">Thư viện ảnh</Link></nav>
    {!snapshot.canMutate && <p role="status" className="rounded-xl bg-amber-50 p-4 text-amber-900">Chỉ bài Nháp hoặc Yêu cầu chỉnh sửa với nội dung hỗ trợ mới đổi được ảnh bìa.</p>}
    <div className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <h3 className="font-semibold">Ảnh bìa hiện tại</h3>
      {snapshot.cover ? <><p>{snapshot.cover.originalFilename}</p>{snapshot.cover.contentUrl && snapshot.cover.width && snapshot.cover.height
        ? <Image unoptimized src={snapshot.cover.contentUrl} width={snapshot.cover.width} height={snapshot.cover.height}
          alt={snapshot.cover.altText ?? ''} className="max-h-48 w-auto max-w-full rounded-lg object-contain" />
        : <p role="status">Ảnh cũ không được quản lý; có thể giữ hoặc gỡ, không tải URL bên ngoài.</p>}</> : <p>Chưa có ảnh bìa.</p>}
    </div>
    {snapshot.canMutate && <>
      <form onSubmit={event => { event.preventDefault(); void search(query, 1) }} className="flex min-w-0 flex-wrap items-end gap-3" aria-label="Tìm ảnh bìa">
        <label className="min-w-0 flex-1">Tìm trong thư viện<input className={input} value={query} maxLength={100} onChange={event => setQuery(event.target.value)} /></label>
        <button className={button} disabled={searching}>Tìm kiếm</button>
      </form>
      <fieldset className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4" disabled={pending || blocked}>
        <legend className="font-semibold">Chọn ảnh bìa</legend>
        <label className="flex gap-3"><input type="radio" name="cover" checked={chosen === null} onChange={() => setChosen(null)} />Không dùng ảnh bìa</label>
        {snapshot.cover && !items.some(item => item.id === snapshot.cover!.id) && <label className="flex gap-3"><input type="radio" name="cover"
          checked={chosen?.id === snapshot.cover.id} onChange={() => setChosen(snapshot.cover)} />Giữ ảnh bìa hiện tại ({snapshot.cover.originalFilename})</label>}
        {items.map(item => <label key={item.id} className="flex min-w-0 gap-3"><input type="radio" name="cover" data-media-id={item.id}
          checked={chosen?.id === item.id} onChange={() => setChosen(item)} /><span>{item.originalFilename} · {item.altText}</span></label>)}
      </fieldset>
      <nav className="flex flex-wrap items-center gap-3" aria-label="Phân trang ảnh bìa"><button className={button} disabled={page <= 1 || searching} onClick={() => void search(query, page - 1)}>Trang trước</button>
        <span>Trang {page}/{pages}</span><button className={button} disabled={page >= pages || searching} onClick={() => void search(query, page + 1)}>Trang sau</button></nav>
      <form onSubmit={save} className="flex flex-wrap gap-3" aria-label="Lưu ảnh bìa">
        <button className={`${button} bg-[#167563] text-white`} disabled={pending || blocked || !online}>Lưu ảnh bìa</button>
        <button type="button" className={button} disabled={pending || blocked} onClick={() => setChosen(snapshot.cover)}>Hủy</button>
      </form>
    </>}
    <p role="status" aria-live="polite">{message || (dirty ? 'Lựa chọn ảnh bìa chưa lưu.' : '')}</p>
    {error && <p ref={errorRef} tabIndex={-1} role="alert" data-error-code={error.code} className="text-red-700">{error.message}</p>}
    {blocked && <button className={button} onClick={() => { if (window.confirm('Tải lại sẽ bỏ lựa chọn chưa lưu. Tiếp tục?')) location.reload() }}>Tải lại để đối chiếu</button>}
  </section>
}
