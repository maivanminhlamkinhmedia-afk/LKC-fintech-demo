'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createTaxonomy, updateTaxonomy, deleteTaxonomy, searchTaxonomy } from '../taxonomy-actions'
import { INSTRUMENT_TYPES, TAXONOMY_KINDS, TAXONOMY_LABELS, type TaxonomyKind, type TaxonomyPage } from '../taxonomy'
import { createTaxonomyPanel, type TaxonomyForm } from '../taxonomy-panel'

const inputClass = 'w-full min-w-0 rounded-xl border border-slate-300 bg-white px-4 py-3 focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:bg-slate-100'
const buttonClass = 'rounded-xl border border-slate-300 px-4 py-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:opacity-50'

export function TaxonomyCatalog({ initial }: { initial: TaxonomyPage }) {
  const [controller] = useState(() => createTaxonomyPanel(initial, { create: createTaxonomy, update: updateTaxonomy, remove: deleteTaxonomy, search: searchTaxonomy }))
  const [state, setState] = useState(controller.getState)
  const [q, setQ] = useState(initial.q)
  const formRef = useRef<HTMLFormElement>(null), addRef = useRef<HTMLButtonElement>(null)
  const { snapshot, values, selected, error, pending, blocked, leaving } = state
  const disabled = pending || blocked || leaving
  const confirm = (question: string) => window.confirm(question)
  useEffect(() => {
    controller.activate()
    const unsubscribe = controller.subscribe(setState)
    controller.setOnline(navigator.onLine !== false)
    const online = () => controller.setOnline(true), offline = () => controller.setOnline(false)
    function beforeUnload(event: BeforeUnloadEvent) { if (controller.shouldWarn()) { event.preventDefault(); event.returnValue = '' } }
    function beforeLink(event: MouseEvent) {
      if (!controller.shouldWarn() || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return
      const target = new URL(link.href, window.location.href)
      if (target.origin === window.location.origin && target.pathname === window.location.pathname && target.search === window.location.search) return
      if (!window.confirm('Danh mục chưa lưu hoặc chưa xác nhận kết quả có thể bị mất. Bạn có muốn rời trang?')) {
        event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation()
      } else controller.leave()
    }
    window.addEventListener('online', online); window.addEventListener('offline', offline)
    window.addEventListener('beforeunload', beforeUnload); document.addEventListener('click', beforeLink, true)
    return () => { unsubscribe(); controller.deactivate(); window.removeEventListener('online', online); window.removeEventListener('offline', offline); window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', beforeLink, true) }
  }, [controller])
  useEffect(() => { controller.sync(initial) }, [controller, initial])
  useEffect(() => { if (selected !== undefined) formRef.current?.querySelector<HTMLInputElement>('#taxonomy-name')?.focus() }, [selected])
  useEffect(() => { if (error?.fieldErrors) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus() }, [error])
  async function search(kind = snapshot.kind, page = 1, active = snapshot.active) {
    if (await controller.search(kind, { q, page, active }, confirm)) {
      const next = controller.getState().snapshot
      const params = new URLSearchParams({ kind: next.kind, q: next.q, page: String(next.page), active: next.active })
      window.history.replaceState(null, '', `/creator/taxonomy?${params}`)
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); controller.setOnline(navigator.onLine !== false); await controller.save() }
  const field = (key: keyof TaxonomyForm, label: string, multiline = false) => <div className="min-w-0" key={key}>
    <label htmlFor={`taxonomy-${key}`} className="mb-2 block font-medium">{label}</label>
    {multiline ? <textarea id={`taxonomy-${key}`} rows={4} className={inputClass} value={String(values[key])} onChange={event => controller.setField(key, event.target.value)} aria-invalid={!!error?.fieldErrors?.[key]} aria-describedby={`taxonomy-${key}-error`} />
      : <input id={`taxonomy-${key}`} className={inputClass} type={key === 'sortOrder' ? 'number' : 'text'} required={['name', 'slug', 'symbol'].includes(key)} value={String(values[key])} onChange={event => controller.setField(key, event.target.value)} aria-invalid={!!error?.fieldErrors?.[key]} aria-describedby={`taxonomy-${key}-error`} />}
    <p id={`taxonomy-${key}-error`} className="text-sm text-red-700">{error?.fieldErrors?.[key]}</p>
  </div>
  return <section className="min-w-0 space-y-6 [overflow-wrap:anywhere]" aria-busy={pending}>
    <header className="space-y-2"><h1 className="text-3xl font-bold">Danh mục phân loại</h1><p>Quản lý danh mục dùng chung. Thay đổi chỉ được lưu khi bạn xác nhận.</p></header>
    <Link href="/creator" className="text-emerald-800 underline">Trang quản trị nội dung</Link>
    <form aria-label="Tìm danh mục" className="grid min-w-0 gap-4 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); void search() }}>
      <div><label htmlFor="taxonomy-kind" className="mb-2 block font-medium">Loại danh mục</label><select id="taxonomy-kind" className={inputClass} value={snapshot.kind} disabled={disabled} onChange={event => void search(event.target.value as TaxonomyKind, 1, 'all')}>
        {TAXONOMY_KINDS.map(kind => <option value={kind} key={kind}>{TAXONOMY_LABELS[kind]}</option>)}
      </select></div>
      <div><label htmlFor="taxonomy-search" className="mb-2 block font-medium">Tìm danh mục</label><input id="taxonomy-search" className={inputClass} value={q} onChange={event => setQ(event.target.value)} /></div>
      {snapshot.kind !== 'tag' && <div><label htmlFor="taxonomy-active-filter" className="mb-2 block font-medium">Trạng thái danh mục</label><select id="taxonomy-active-filter" value={snapshot.active} disabled={disabled} className={inputClass} onChange={event => void search(snapshot.kind, 1, event.target.value as 'all' | 'active')}><option value="all">Tất cả</option><option value="active">Đang hoạt động</option></select></div>}
      <div className="self-end"><button type="submit" className={buttonClass} disabled={disabled}>Tìm kiếm</button></div>
    </form>
    {state.searching && <p role="status">Đang tải danh mục…</p>}
    <button ref={addRef} type="button" className={buttonClass} disabled={disabled} onClick={() => controller.add(confirm)}>Thêm danh mục</button>
    {selected !== undefined && <form ref={formRef} aria-label={selected ? 'Sửa danh mục' : 'Thêm danh mục'} onSubmit={save} className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
      <fieldset disabled={pending || leaving} className="min-w-0 space-y-4"><legend className="mb-4 font-semibold">{selected ? 'Sửa danh mục' : 'Thêm danh mục mới'} — {TAXONOMY_LABELS[snapshot.kind]}</legend>
        {field('name', 'Tên')}
        {selected ? <div className="rounded-lg bg-slate-50 p-3"><p>Định danh không thể sửa. Danh mục chưa được sử dụng có thể xóa và tạo lại.</p><p>Định danh: <span data-taxonomy-identity>{selected.canonicalKey ?? selected.slug}</span></p>{selected.instrumentType && <p>{selected.instrumentType} · {selected.exchange ?? 'Không có sàn'} · {selected.symbol}</p>}</div>
          : snapshot.kind === 'instrument' ? <div className="grid min-w-0 gap-4 sm:grid-cols-2">{field('symbol', 'Mã công cụ')}<div><label htmlFor="taxonomy-instrumentType" className="mb-2 block font-medium">Loại công cụ</label><select id="taxonomy-instrumentType" className={inputClass} value={values.instrumentType} onChange={event => controller.setField('instrumentType', event.target.value as TaxonomyForm['instrumentType'])} aria-invalid={!!error?.fieldErrors?.instrumentType} aria-describedby="taxonomy-instrumentType-error">{INSTRUMENT_TYPES.map(type => <option key={type} value={type}>{type}</option>)}</select><p id="taxonomy-instrumentType-error">{error?.fieldErrors?.instrumentType}</p></div>{field('exchange', 'Sàn giao dịch')}<p className="sm:col-span-2 text-sm">FX/CRYPTO không dùng sàn. Định danh được tạo từ loại, sàn và mã công cụ; không sửa sau khi tạo.</p></div> : field('slug', 'Slug')}
        {(snapshot.kind === 'category' || snapshot.kind === 'topic') && field('description', 'Mô tả', true)}
        {snapshot.kind === 'category' && field('sortOrder', 'Thứ tự')}
        {snapshot.kind === 'instrument' && <div className="grid min-w-0 gap-4 sm:grid-cols-2">{field('countryCode', 'Mã quốc gia')}{field('currency', 'Tiền tệ')}</div>}
        {snapshot.kind !== 'tag' && <div><label className="flex items-center gap-2"><input type="checkbox" checked={values.isActive} onChange={event => controller.setField('isActive', event.target.checked)} />Đang hoạt động</label><p className="text-sm text-slate-600">Tắt hoạt động giữ nguyên các bài đã gắn danh mục, chỉ ngăn lựa chọn mới.</p></div>}
      </fieldset>
      <div className="flex flex-wrap gap-3"><button type="submit" disabled={disabled} className={`${buttonClass} bg-emerald-800 text-white`}>Lưu danh mục</button><button type="button" disabled={disabled} className={buttonClass} onClick={() => { if (controller.cancel(confirm)) addRef.current?.focus() }}>Hủy</button></div>
    </form>}
    <div aria-live="polite" aria-atomic="true" className="space-y-2"><p role="status">{state.message || (state.dirty ? 'Danh mục có thay đổi chưa lưu.' : '')}</p>{error && <p role="alert" data-error-code={error.code} className="text-red-700">{error.message}</p>}{state.warning && <p className="text-amber-800">{state.warning}</p>}{blocked && <><p>Giữ hoặc sao chép nội dung để đối chiếu. Tải lại sẽ bỏ thay đổi chưa lưu.</p><button type="button" className={buttonClass} disabled={pending} onClick={() => { if (confirm('Tải lại sẽ bỏ thay đổi chưa lưu. Tiếp tục?')) { controller.leave(); window.location.reload() } }}>Tải lại bản mới nhất</button></>}</div>
    <p>{snapshot.total} danh mục · Trang {snapshot.page}/{snapshot.totalPages}</p>
    {snapshot.items.length === 0 ? <p>Chưa có danh mục phù hợp.</p> : <ul aria-label="Danh sách danh mục" className="min-w-0 space-y-4">{snapshot.items.map(item => <li key={item.id} data-taxonomy-id={item.id} className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">{item.name}</h2><p>{item.canonicalKey ?? item.slug}</p>{item.description && <p className="whitespace-pre-wrap">{item.description}</p>}{item.isActive !== null && <p>{item.isActive ? 'Đang hoạt động' : 'Ngừng hoạt động'}</p>}
      <div className="flex flex-wrap gap-3"><button type="button" className={buttonClass} disabled={disabled} aria-label={`Sửa ${item.name}`} onClick={() => controller.edit(item.id, confirm)}>Sửa</button><button type="button" className={buttonClass} disabled={disabled} aria-label={`Xóa ${item.name}`} onClick={() => { controller.setOnline(navigator.onLine !== false); void controller.remove(item.id, confirm) }}>Xóa</button></div>
    </li>)}</ul>}
    <nav aria-label="Phân trang danh mục" className="flex flex-wrap gap-3"><button type="button" className={buttonClass} disabled={disabled || snapshot.page <= 1} onClick={() => void search(snapshot.kind, snapshot.page - 1)}>Trang trước</button><button type="button" className={buttonClass} disabled={disabled || snapshot.page >= snapshot.totalPages} onClick={() => void search(snapshot.kind, snapshot.page + 1)}>Trang sau</button></nav>
  </section>
}
