'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { updateArticleClassification } from '../article-classification-actions'
import { searchArticleClassificationOptions } from '../article-classification-options'
import { createClassificationPanel } from '../article-classification-panel'
import type { ArticleClassificationSnapshot } from '../article-classification'
import { TAXONOMY_KINDS, TAXONOMY_LABELS, type TaxonomyKind, type TaxonomyOption } from '../taxonomy'

const buttonClass = 'rounded-xl border border-slate-300 px-4 py-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50'
const inputClass = 'w-full min-w-0 rounded-xl border border-slate-300 bg-white px-4 py-3 focus-visible:outline-2 focus-visible:outline-emerald-600'

export function ArticleClassificationPanel({ initial }: { initial: ArticleClassificationSnapshot }) {
  return <ClassificationPanel key={initial.id} initial={initial} />
}

function ClassificationPanel({ initial }: { initial: ArticleClassificationSnapshot }) {
  const [controller] = useState(() => createClassificationPanel(initial, { save: updateArticleClassification, search: searchArticleClassificationOptions }))
  const [state, setState] = useState(controller.getState)
  const [query, setQuery] = useState('')
  const panelRef = useRef<HTMLElement>(null)
  const { snapshot, values, pending, blocked, leaving, error } = state
  const disabled = !snapshot.canMutate || pending || blocked || leaving
  const selectedIds = (kind: TaxonomyKind) => kind === 'category' ? values.categoryId === null ? [] : [values.categoryId]
    : kind === 'topic' ? values.topicIds : kind === 'tag' ? values.tagIds : values.instrumentIds
  const selectedItems = (kind: TaxonomyKind) => selectedIds(kind).map(id => state.known.find(item => item.kind === kind && item.id === id)).filter((item): item is TaxonomyOption => !!item)
  const selectionField = (kind: TaxonomyKind) => kind === 'category' ? 'categoryId' : kind === 'topic' ? 'topicIds' : kind === 'tag' ? 'tagIds' : 'instrumentIds'

  useEffect(() => {
    controller.activate()
    const unsubscribe = controller.subscribe(setState)
    controller.setOnline(navigator.onLine !== false)
    if (controller.getState().snapshot.canMutate) void controller.search('category', '', 1)
    const online = () => controller.setOnline(true), offline = () => controller.setOnline(false)
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!controller.shouldWarn()) return
      event.preventDefault(); event.returnValue = ''
    }
    function beforeLink(event: MouseEvent) {
      if (!controller.shouldWarn() || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return
      const target = new URL(link.href, window.location.href)
      if (target.origin === window.location.origin && target.pathname === window.location.pathname && target.search === window.location.search) return
      if (!window.confirm('Phân loại chưa lưu hoặc chưa xác nhận kết quả có thể bị mất. Bạn có muốn rời trang?')) {
        event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation()
      } else controller.leave()
    }
    window.addEventListener('online', online); window.addEventListener('offline', offline)
    window.addEventListener('beforeunload', beforeUnload); document.addEventListener('click', beforeLink, true)
    return () => {
      unsubscribe(); controller.deactivate()
      window.removeEventListener('online', online); window.removeEventListener('offline', offline)
      window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', beforeLink, true)
    }
  }, [controller])
  useEffect(() => { controller.sync(initial) }, [controller, initial])
  useEffect(() => { if (error) panelRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus() }, [error])
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); controller.setOnline(navigator.onLine !== false); await controller.save()
  }
  const identity = (item: TaxonomyOption) => item.canonicalKey ?? item.slug ?? ''

  return <section ref={panelRef} className="min-w-0 space-y-6 [overflow-wrap:anywhere]" aria-busy={pending}>
    <header className="space-y-2">
      <h1 className="text-3xl font-bold">Phân loại bài viết</h1>
      <h2 className="text-xl font-semibold">{snapshot.title}</h2>
      <p className="text-sm text-slate-600">{snapshot.status} · Phân loại chỉ được lưu khi bạn nhấn Lưu phân loại.</p>
      <p className="text-sm text-slate-600">Tối đa 1 danh mục, 5 chủ đề, 10 thẻ, 10 công cụ và 1 công cụ chính. Tránh chỉnh cùng bài ở nhiều tab; thay đổi nội dung hoặc nguồn cũng cần được đối chiếu.</p>
    </header>
    <nav aria-label="Điều hướng phân loại" className="flex flex-wrap gap-4 text-sm font-medium text-emerald-800 underline">
      {snapshot.canMutate && <Link href={`/creator/articles/${encodeURIComponent(snapshot.id)}/edit`}>Quay lại bài viết</Link>}
      <Link href={`/creator/articles/${encodeURIComponent(snapshot.id)}/sources`}>Nguồn tham khảo</Link>
      <Link href="/creator/articles">Danh sách bài viết</Link>
    </nav>
    {!snapshot.canMutate && <p role="status" data-read-only-reason={snapshot.readOnlyReason} className="rounded-xl bg-amber-50 p-4 text-amber-900">
      {snapshot.readOnlyReason === 'UNSUPPORTED_DOCUMENT' ? 'Chỉ đọc: nội dung bài chưa được trình soạn thảo hỗ trợ.' : 'Chỉ đọc: chỉ thay đổi phân loại của bài Nháp hoặc Yêu cầu chỉnh sửa.'}
    </p>}
    {snapshot.warnings.map(warning => <p key={warning} role="status" className="rounded-xl bg-amber-50 p-4 text-amber-900">{warning}</p>)}
    <div aria-label="Phân loại đã chọn" className="grid min-w-0 gap-4 sm:grid-cols-2">
      {TAXONOMY_KINDS.map(kind => <fieldset key={kind} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4" tabIndex={-1}
        aria-invalid={!!error?.fieldErrors?.[selectionField(kind)]} aria-describedby={`classification-${kind}-error`}>
        <legend className="font-semibold">{TAXONOMY_LABELS[kind]} đã chọn ({selectedIds(kind).length})</legend>
        <p id={`classification-${kind}-error`} className="text-sm text-red-700">{error?.fieldErrors?.[selectionField(kind)]}</p>
        {selectedIds(kind).length === 0 ? <p className="text-sm text-slate-600">Chưa chọn.</p> : <ul className="mt-2 space-y-3">
          {selectedItems(kind).map(item => <li key={item.id} data-selected-kind={kind} data-taxonomy-id={item.id} className="min-w-0 space-y-1">
            <p>{item.name} <span className="text-sm text-slate-600">({identity(item)})</span></p>
            {item.isActive === false && <p className="text-sm text-amber-800">Không hoạt động — có thể giữ hoặc gỡ.</p>}
            {kind === 'instrument' && snapshot.instruments.find(row => row.id === item.id)?.isPrimary && !state.primaryResolved && <p className="text-sm text-amber-800">Công cụ chính trong dữ liệu cũ</p>}
            {kind === 'instrument' && state.primaryResolved && values.primaryInstrumentId === item.id && <p className="text-sm font-medium">Công cụ chính</p>}
            {snapshot.canMutate && <button type="button" className={buttonClass} disabled={disabled} aria-label={`Gỡ ${item.name}`} onClick={() => controller.choose(item, false)}>Gỡ</button>}
          </li>)}
        </ul>}
      </fieldset>)}
    </div>
    {snapshot.canMutate && <>
      <div className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        <div role="group" aria-label="Loại danh mục" className="flex flex-wrap gap-2">
          {TAXONOMY_KINDS.map(kind => <button key={kind} type="button" className={buttonClass} disabled={pending || leaving}
            aria-pressed={state.kind === kind} onClick={() => { setQuery(''); void controller.search(kind, '', 1) }}>{TAXONOMY_LABELS[kind]}</button>)}
        </div>
        <form onSubmit={event => { event.preventDefault(); void controller.search(state.kind, query, 1) }} className="flex min-w-0 flex-wrap items-end gap-3" aria-label="Tìm lựa chọn phân loại">
          <div className="min-w-0 flex-1"><label htmlFor="classification-search" className="mb-2 block font-medium">Tìm danh mục</label>
            <input id="classification-search" className={inputClass} value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /></div>
          <button type="submit" className={buttonClass} disabled={leaving}>Tìm kiếm</button>
        </form>
        <p role="status" aria-live="polite">{state.searching ? 'Đang tải danh mục…' : state.searchError}</p>
        <fieldset disabled={disabled} data-classification-kind={state.kind} className="min-w-0 space-y-3">
          <legend className="mb-3 font-semibold">Chọn {TAXONOMY_LABELS[state.kind].toLowerCase()}</legend>
          {state.options?.items.length === 0 && <p>Không có lựa chọn phù hợp.</p>}
          {state.options?.items.map(item => <label key={item.id} className="flex min-w-0 items-start gap-3">
            <input type={state.kind === 'category' ? 'radio' : 'checkbox'} name={`classification-${state.kind}`} data-taxonomy-id={item.id}
              checked={selectedIds(state.kind).includes(item.id)} onChange={event => controller.choose(item, event.target.checked)} className="mt-1 shrink-0" />
            <span className="min-w-0">{item.name} ({identity(item)})</span>
          </label>)}
        </fieldset>
        {state.options && <div className="flex flex-wrap items-center gap-3" aria-label="Phân trang danh mục">
          <button type="button" className={buttonClass} disabled={state.searching || state.options.page <= 1 || leaving} onClick={() => void controller.search(state.kind, state.q, state.options!.page - 1)}>Trang trước</button>
          <span>Trang {state.options.page}/{state.options.totalPages} · {state.options.total} lựa chọn</span>
          <button type="button" className={buttonClass} disabled={state.searching || state.options.page >= state.options.totalPages || leaving} onClick={() => void controller.search(state.kind, state.q, state.options!.page + 1)}>Trang sau</button>
        </div>}
      </div>
      <form onSubmit={save} aria-label="Lưu phân loại bài viết" className="min-w-0 space-y-4">
        <fieldset disabled={disabled} aria-invalid={!!error?.fieldErrors?.primaryInstrumentId} aria-describedby="classification-primary-error" tabIndex={-1}
          className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <legend className="font-semibold">Công cụ chính</legend>
          <label className="flex gap-3"><input type="radio" name="primary-instrument" checked={state.primaryResolved && values.primaryInstrumentId === null} onChange={() => controller.primary(null)} />Không chọn công cụ chính</label>
          {selectedItems('instrument').map(item => <label key={item.id} className="flex min-w-0 gap-3"><input type="radio" name="primary-instrument" data-primary-instrument-id={item.id}
            checked={state.primaryResolved && values.primaryInstrumentId === item.id} onChange={() => controller.primary(item.id)} />
            <span className="min-w-0">Chính: {item.name}</span></label>)}
          <p id="classification-primary-error" className="text-sm text-red-700">{error?.fieldErrors?.primaryInstrumentId}</p>
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={`${buttonClass} bg-[#167563] text-white`} disabled={disabled}>Lưu phân loại</button>
          <button type="button" className={buttonClass} disabled={disabled} onClick={() => controller.cancel(message => window.confirm(message))}>Hủy</button>
        </div>
      </form>
    </>}
    <div aria-live="polite" aria-atomic="true" className="space-y-2">
      <p role="status">{state.message || (state.dirty ? 'Phân loại có thay đổi chưa lưu.' : '')}</p>
      {error && <p role="alert" data-error-code={error.code} className="text-red-700">{error.message}</p>}
      {state.warning && <p className="text-amber-800">{state.warning}</p>}
      {blocked && <><p>Giữ hoặc ghi lại lựa chọn đang nhập để đối chiếu. Tải lại sẽ bỏ thay đổi chưa lưu trong tab này.</p>
        <button type="button" className={buttonClass} disabled={pending} onClick={() => {
          if (window.confirm('Tải lại sẽ bỏ lựa chọn chưa lưu. Bạn có muốn tiếp tục?')) { controller.leave(); window.location.reload() }
        }}>Tải lại bản mới nhất</button></>}
    </div>
  </section>
}
