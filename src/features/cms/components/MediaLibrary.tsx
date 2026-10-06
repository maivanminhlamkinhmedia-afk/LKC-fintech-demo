'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { beginMediaUpload, deleteUnusedMedia, searchMediaLibrary, updateMediaMetadata } from '../media-actions'
import { MEDIA_LIMITS, type MediaFailure } from '../media-contract'
import type { MediaListResult } from '../media-query'
import type { MediaDTO } from '../media-store'

const button = 'rounded-xl border border-slate-300 px-4 py-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:opacity-50'
const input = 'w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-emerald-600'
function useDirtyNavigation(shouldWarn: boolean) {
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (shouldWarn) { event.preventDefault(); event.returnValue = '' } }
    const link = (event: MouseEvent) => {
      if (!shouldWarn || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return
      const target = new URL(anchor.href, location.href)
      if (target.origin === location.origin && target.pathname === location.pathname && target.search === location.search) return
      if (!window.confirm('Ảnh hoặc metadata chưa lưu có thể bị mất. Bạn có muốn rời trang?')) {
        event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation()
      }
    }
    window.addEventListener('beforeunload', unload); document.addEventListener('click', link, true)
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', link, true) }
  }, [shouldWarn])
}
function MediaPreview({ item }: { item: MediaDTO }) {
  if (!item.contentUrl || !item.width || !item.height) return <p role="status" className="text-amber-800">Ảnh cũ không được quản lý; chỉ hiển thị metadata.</p>
  return <Image unoptimized loading="lazy" src={item.contentUrl} width={item.width} height={item.height}
    alt={item.altText ?? ''} className="max-h-48 w-auto max-w-full rounded-lg object-contain" />
}
export function MediaLibrary({ initial }: { initial: Extract<MediaListResult, { ok: true }>['data'] }) {
  const [result, setResult] = useState(initial), [query, setQuery] = useState(initial.q)
  const [selected, setSelected] = useState<MediaDTO | null>(null), [file, setFile] = useState<File | null>(null)
  const [filename, setFilename] = useState(''), [alt, setAlt] = useState(''), [caption, setCaption] = useState('')
  const [editAlt, setEditAlt] = useState(''), [editCaption, setEditCaption] = useState('')
  const [pending, setPending] = useState(false), [searching, setSearching] = useState(false), [blocked, setBlocked] = useState(false)
  const [operationId, setOperationId] = useState<string | null>(null), [error, setError] = useState<MediaFailure | null>(null)
  const [message, setMessage] = useState(''), [online, setOnline] = useState(true)
  const flight = useRef(false), generation = useRef(0), alive = useRef(false), section = useRef<HTMLElement>(null), errorRef = useRef<HTMLParagraphElement>(null)
  const dirty = !!file || !!selected && (editAlt !== (selected.altText ?? '') || editCaption !== (selected.caption ?? ''))
  useDirtyNavigation(pending || blocked || dirty)
  useEffect(() => {
    alive.current = true
    const requestGeneration = generation
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { alive.current = false; requestGeneration.current++; window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  useEffect(() => { if (error) (section.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? errorRef.current)?.focus() }, [error])
  async function refresh(q: string, page: number) {
    const request = ++generation.current
    setSearching(true)
    try {
      const response = await searchMediaLibrary({ q, page })
      if (!alive.current || request !== generation.current) return
      if (response.ok) { setResult(response.data); setError(null) } else setError(response.error)
    } catch { if (alive.current && request === generation.current) setError({ code: 'INTERNAL_ERROR', message: 'Không tải được danh sách. Vui lòng thử lại.' }) }
    finally { if (alive.current && request === generation.current) setSearching(false) }
  }
  function select(item: MediaDTO) { setSelected(item); setEditAlt(item.altText ?? ''); setEditCaption(item.caption ?? ''); setError(null); setMessage('') }
  async function upload(event: FormEvent) {
    event.preventDefault()
    if (flight.current || blocked || !online) return
    if (!file || !file.size || file.size > MEDIA_LIMITS.bytes || !['image/png', 'image/jpeg'].includes(file.type)) {
      setError({ code: 'VALIDATION_ERROR', message: 'Chọn một ảnh PNG/JPEG không quá 5 MiB.' }); return
    }
    flight.current = true; setPending(true); setError(null); setMessage('')
    let dispatched = false
    try {
      const begun = await beginMediaUpload({ originalFilename: filename, altText: alt, caption: caption || null, mimeType: file.type })
      if (!begun.ok) { setError(begun.error); return }
      const id = begun.data.operationId; setOperationId(id)
      dispatched = true
      const response = await fetch(`/api/cms/media/uploads/${encodeURIComponent(id)}`, { method: 'POST', body: file,
        headers: { 'Content-Type': file.type }, cache: 'no-store' })
      const data = await response.json()
      if (!response.ok || !data.ok) {
        if ([400, 413].includes(response.status) && ['FILE_TOO_LARGE', 'UNSUPPORTED_MEDIA', 'IMAGE_LIMIT_EXCEEDED'].includes(data.error?.code)) {
          dispatched = false
          if (alive.current) { setOperationId(null); setError(data.error) }
          return
        }
        throw new Error('upload-result')
      }
      if (!alive.current) return
      setOperationId(null); setBlocked(false); setFile(null); setFilename(''); setAlt(''); setCaption('')
      setMessage('Ảnh đã được lưu.'); await refresh(result.q, 1)
    } catch { if (alive.current) { setBlocked(dispatched); setError({ code: dispatched ? 'UNKNOWN_OUTCOME' : 'INTERNAL_ERROR',
      message: dispatched ? 'Chưa xác nhận kết quả upload. Kiểm tra trạng thái thao tác trước khi thử lại.' : 'Chưa chuẩn bị được upload.' }) } }
    finally { flight.current = false; if (alive.current) setPending(false) }
  }
  async function checkStatus() {
    if (!operationId || flight.current) return
    flight.current = true; setPending(true)
    try {
      const response = await fetch(`/api/cms/media/uploads/${encodeURIComponent(operationId)}`, { cache: 'no-store' })
      const data = await response.json()
      if (!alive.current) return
      if (response.ok && data.ok && data.state === 'COMMITTED') {
        setBlocked(false); setOperationId(null); setFile(null); setFilename(''); setAlt(''); setCaption(''); setError(null)
        setMessage('Upload đã hoàn tất.'); await refresh(result.q, 1)
      } else if (response.ok && data.ok && data.state === 'ABANDONED') {
        setBlocked(false); setOperationId(null)
        setError({ code: 'UNSUPPORTED_MEDIA', message: 'Ảnh không hợp lệ; chọn hoặc sửa tệp rồi thử lại.' })
      } else setMessage('Kết quả vẫn chưa xác định; giữ tệp và mã thao tác để đối chiếu.')
    } catch { if (alive.current) setMessage('Không kiểm tra được trạng thái; giữ nguyên dữ liệu.') }
    finally { flight.current = false; if (alive.current) setPending(false) }
  }
  async function saveMetadata(event: FormEvent) {
    event.preventDefault()
    if (!selected || flight.current || blocked || !online) return
    flight.current = true; setPending(true); setError(null)
    try {
      const response = await updateMediaMetadata(selected.id, { altText: editAlt, caption: editCaption || null, expectedUpdatedAt: selected.updatedAt })
      if (!alive.current) return
      if (!response.ok) { setError(response.error); if (['UNKNOWN_OUTCOME', 'INTERNAL_ERROR', 'MEDIA_CONFLICT'].includes(response.error.code)) setBlocked(true); return }
      select(response.data); setMessage(response.warning ?? 'Metadata đã được lưu.'); await refresh(result.q, result.page)
    } catch { if (alive.current) { setBlocked(true); setError({ code: 'UNKNOWN_OUTCOME', message: 'Chưa xác nhận kết quả. Tải lại để đối chiếu.' }) } }
    finally { flight.current = false; if (alive.current) setPending(false) }
  }
  async function remove(item: MediaDTO) {
    if (flight.current || blocked || !online || !window.confirm(`Xóa ảnh ${item.originalFilename}?`)) return
    flight.current = true; setPending(true); setError(null)
    try {
      const response = await deleteUnusedMedia(item.id, { expectedUpdatedAt: item.updatedAt })
      if (!alive.current) return
      if (!response.ok) { setError(response.error); if (['UNKNOWN_OUTCOME', 'INTERNAL_ERROR'].includes(response.error.code)) setBlocked(true); return }
      setSelected(null); setMessage(response.warning ?? 'Ảnh đã xóa.'); await refresh(result.q, result.page)
    } catch { if (alive.current) { setBlocked(true); setError({ code: 'UNKNOWN_OUTCOME', message: 'Chưa xác nhận kết quả xóa. Tải lại để đối chiếu.' }) } }
    finally { flight.current = false; if (alive.current) setPending(false) }
  }
  return <section ref={section} className="mx-auto min-w-0 max-w-6xl space-y-6 [overflow-wrap:anywhere]" aria-busy={pending}>
    <header><h1 className="text-3xl font-bold">Thư viện ảnh</h1><p className="mt-2 text-slate-600">Ảnh PNG/JPEG riêng tư; tối đa 5 MiB, 4096 px mỗi chiều.</p></header>
    <nav className="flex flex-wrap gap-4 text-emerald-800 underline" aria-label="Điều hướng thư viện ảnh"><Link href="/creator/articles">Danh sách bài viết</Link><Link href="/creator">Tổng quan</Link></nav>
    <form onSubmit={upload} className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6" aria-label="Tải ảnh lên">
      <h2 className="text-xl font-semibold">Tải ảnh mới</h2>
      <label className="block">Tệp PNG/JPEG<input type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" className={input} disabled={pending || blocked}
        onChange={event => { const chosen = event.target.files?.[0] ?? null; setFile(chosen); setFilename(chosen?.name ?? '') }} /></label>
      <label className="block">Tên tệp<input className={input} value={filename} maxLength={180} disabled={pending || blocked} aria-invalid={error?.fieldErrors?.originalFilename ? true : undefined} onChange={event => setFilename(event.target.value)} /></label>
      <label className="block">Văn bản thay thế<input className={input} value={alt} maxLength={300} disabled={pending || blocked} aria-invalid={error?.fieldErrors?.altText ? true : undefined} onChange={event => setAlt(event.target.value)} /></label>
      <label className="block">Chú thích<textarea className={input} value={caption} maxLength={2000} disabled={pending || blocked} aria-invalid={error?.fieldErrors?.caption ? true : undefined} onChange={event => setCaption(event.target.value)} /></label>
      <button className={`${button} bg-[#167563] text-white`} disabled={pending || blocked || !online}>Tải ảnh lên</button>
      {blocked && operationId && <button type="button" className={button} disabled={pending} onClick={() => void checkStatus()}>Kiểm tra trạng thái upload</button>}
    </form>
    <form onSubmit={event => { event.preventDefault(); void refresh(query, 1) }} className="flex min-w-0 flex-wrap items-end gap-3" aria-label="Tìm ảnh">
      <label className="min-w-0 flex-1">Tìm theo tên, alt hoặc chú thích<input className={input} value={query} maxLength={100} onChange={event => setQuery(event.target.value)} /></label>
      <button className={button} disabled={searching}>Tìm kiếm</button>
    </form>
    <p role="status" aria-live="polite">{message || (searching ? 'Đang tìm…' : `${result.total} ảnh trong phạm vi của bạn.`)}</p>
    {error && <p ref={errorRef} tabIndex={-1} role="alert" data-error-code={error.code} className="text-red-700">{error.message}</p>}
    {blocked && <button className={button} type="button" onClick={() => { if (window.confirm('Tải lại sẽ bỏ nội dung chưa lưu. Tiếp tục?')) location.reload() }}>Tải lại để đối chiếu</button>}
    <ul className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Danh sách ảnh">
      {result.items.map(item => <li key={item.id} className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4" data-media-id={item.id}>
        <MediaPreview item={item} /><p className="font-semibold">{item.originalFilename}</p><p className="text-sm text-slate-600">{item.width}×{item.height} · {item.mimeType}</p>
        <p className="text-sm">{item.altText}</p>{item.caption && <p className="text-sm">{item.caption}</p>}
        {item.managed && <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={pending || blocked} onClick={() => select(item)}>Sửa metadata</button>
          <button type="button" className={button} disabled={pending || blocked} onClick={() => void remove(item)}>Xóa ảnh chưa dùng</button></div>}
      </li>)}
    </ul>
    <nav className="flex flex-wrap items-center gap-3" aria-label="Phân trang ảnh">
      <button className={button} disabled={searching || result.page <= 1} onClick={() => void refresh(result.q, result.page - 1)}>Trang trước</button>
      <span>Trang {result.page}/{result.totalPages}</span>
      <button className={button} disabled={searching || result.page >= result.totalPages} onClick={() => void refresh(result.q, result.page + 1)}>Trang sau</button>
    </nav>
    {selected && <form onSubmit={saveMetadata} className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4" aria-label="Sửa metadata ảnh">
      <h2 className="text-xl font-semibold">{selected.originalFilename}</h2>
      <label className="block">Văn bản thay thế<input className={input} value={editAlt} maxLength={300} disabled={pending || blocked} aria-invalid={error?.fieldErrors?.altText ? true : undefined} onChange={event => setEditAlt(event.target.value)} /></label>
      <label className="block">Chú thích<textarea className={input} value={editCaption} maxLength={2000} disabled={pending || blocked} aria-invalid={error?.fieldErrors?.caption ? true : undefined} onChange={event => setEditCaption(event.target.value)} /></label>
      <div className="flex flex-wrap gap-2"><button className={button} disabled={pending || blocked || !online}>Lưu metadata</button>
        <button type="button" className={button} disabled={pending} onClick={() => { setSelected(null); setError(null) }}>Hủy</button></div>
    </form>}
  </section>
}
