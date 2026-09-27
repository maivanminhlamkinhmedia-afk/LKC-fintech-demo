'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createArticleSource, updateArticleSource, deleteArticleSource } from '@/features/cms/article-source-actions'
import { SOURCE_TYPES, SOURCE_TYPE_LABELS, sourceDateToLocal, type ArticleSourcesSnapshot } from '@/features/cms/article-sources'
import { createSourcePanel, type SourceFormValues } from '@/features/cms/article-source-panel'

const inputClass = 'w-full min-w-0 rounded-xl border border-slate-300 bg-white px-4 py-3 focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:bg-slate-100'
const buttonClass = 'rounded-xl border border-slate-300 px-4 py-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50'
const fields: { key: Exclude<keyof SourceFormValues, 'sourceType'>; label: string; date?: boolean }[] = [
  { key: 'title', label: 'Tên tài liệu' }, { key: 'publisher', label: 'Đơn vị xuất bản/cung cấp' },
  { key: 'url', label: 'URL' }, { key: 'publishedAt', label: 'Thời điểm công bố (UTC+7)', date: true },
  { key: 'accessedAt', label: 'Thời điểm truy cập (UTC+7)', date: true },
  { key: 'dataTimestamp', label: 'Thời điểm dữ liệu (UTC+7)', date: true }, { key: 'note', label: 'Ghi chú' },
]
const displayDate = (value: string | null) => value ? `${sourceDateToLocal(value).replace('T', ' ')} (UTC+7)` : 'Không cung cấp'

export function ArticleSources({ initial }: { initial: ArticleSourcesSnapshot }) {
  // Same-article revalidation must not remount a dirty/pending form. Different
  // IDs own distinct controllers, so a late ACK cannot enter the next article.
  return <SourcePanel key={initial.id} initial={initial} />
}

function SourcePanel({ initial }: { initial: ArticleSourcesSnapshot }) {
  const [controller] = useState(() => createSourcePanel(initial, {
    create: createArticleSource, update: updateArticleSource, remove: deleteArticleSource,
  }))
  const [state, setState] = useState(controller.getState)
  const formRef = useRef<HTMLFormElement>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const { snapshot, selected, values, pending, blocked, leaving, error } = state
  const disabled = !snapshot.canMutate || pending || blocked || leaving
  const confirm = (question: string) => window.confirm(question)
  const focusForm = () => queueMicrotask(() => formRef.current?.querySelector<HTMLInputElement>('#source-title')?.focus())

  useEffect(() => {
    controller.activate()
    const unsubscribe = controller.subscribe(setState)
    controller.setOnline(navigator.onLine !== false)
    const online = () => controller.setOnline(true)
    const offline = () => controller.setOnline(false)
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!controller.shouldWarn()) return
      event.preventDefault()
      event.returnValue = ''
    }
    function beforeLink(event: MouseEvent) {
      if (!controller.shouldWarn() || event.defaultPrevented || event.button !== 0
        || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return
      const target = new URL(link.href, window.location.href)
      if (target.origin === window.location.origin && target.pathname === window.location.pathname && target.search === window.location.search) return
      if (!window.confirm('Nguồn chưa lưu hoặc chưa xác nhận kết quả có thể bị mất. Bạn có muốn rời trang?')) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
      } else controller.leave()
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', beforeLink, true)
    return () => {
      unsubscribe()
      controller.deactivate()
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', beforeLink, true)
    }
  }, [controller])
  useEffect(() => { controller.sync(initial) }, [controller, initial])
  useEffect(() => {
    if (selected !== undefined) formRef.current?.querySelector<HTMLInputElement>('#source-title')?.focus()
  }, [selected])
  useEffect(() => {
    if (error?.fieldErrors) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [error])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Consult the browser immediately as well as online/offline events.
    controller.setOnline(navigator.onLine !== false)
    await controller.save()
  }

  return (
    <section className="min-w-0 space-y-6 [overflow-wrap:anywhere]" aria-busy={pending}>
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Nguồn tham khảo</h1>
        <h2 className="text-xl font-semibold">{snapshot.title}</h2>
        <p className="text-sm text-slate-600">{snapshot.status} · {snapshot.sources.length} nguồn</p>
        <p className="text-sm text-slate-600">Nguồn tham khảo được lưu riêng khi bạn nhấn Lưu nguồn.</p>
        <p className="text-sm text-slate-600">Tránh chỉnh nội dung bài và nguồn ở nhiều tab cùng lúc; thay đổi ở tab khác cần được đối chiếu trước khi lưu.</p>
      </header>
      <nav aria-label="Điều hướng nguồn" className="flex flex-wrap gap-4 text-sm font-medium text-emerald-800 underline">
        {snapshot.canMutate && <Link href={`/creator/articles/${encodeURIComponent(snapshot.id)}/edit`}>Quay lại bài viết</Link>}
        <Link href="/creator/articles">Danh sách bài viết</Link>
      </nav>
      {!snapshot.canMutate && <p role="status" data-read-only-reason={snapshot.readOnlyReason} className="rounded-xl bg-amber-50 p-4 text-amber-900">
        {snapshot.readOnlyReason === 'UNSUPPORTED_DOCUMENT'
          ? 'Chỉ đọc: nội dung bài chưa được trình soạn thảo hỗ trợ. Không thể thay đổi nguồn.'
          : 'Chỉ đọc: chỉ có thể thay đổi nguồn của bài Nháp hoặc Yêu cầu chỉnh sửa.'}
      </p>}
      {snapshot.canMutate && <button ref={addRef} type="button" disabled={disabled} className={buttonClass} onClick={() => {
        if (controller.add(confirm)) focusForm()
      }}>Thêm nguồn</button>}
      {selected !== undefined && <form ref={formRef} onSubmit={save} className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6" aria-label={selected ? 'Sửa nguồn' : 'Thêm nguồn'}>
        <fieldset disabled={pending || leaving} className="min-w-0 space-y-4">
          <legend className="mb-4 text-lg font-semibold">{selected ? 'Sửa nguồn' : 'Thêm nguồn mới'}</legend>
          <div>
            <label htmlFor="source-type" className="mb-2 block font-medium">Loại nguồn</label>
            <select id="source-type" name="sourceType" className={inputClass} value={values.sourceType}
              aria-invalid={!!error?.fieldErrors?.sourceType} aria-describedby="source-type-error"
              onChange={event => controller.setField('sourceType', event.target.value as SourceFormValues['sourceType'])}>
              {SOURCE_TYPES.map(type => <option key={type} value={type}>{SOURCE_TYPE_LABELS[type]}</option>)}
            </select>
            <p id="source-type-error" className="text-sm text-red-700">{error?.fieldErrors?.sourceType}</p>
          </div>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            {fields.map(field => <div key={field.key} className={`min-w-0 ${field.key === 'note' || field.key === 'title' ? 'sm:col-span-2' : ''}`}>
              <label htmlFor={`source-${field.key}`} className="mb-2 block font-medium">{field.label}</label>
              {field.key === 'note' ? <textarea id="source-note" name="note" rows={5} className={inputClass} value={values.note}
                aria-invalid={!!error?.fieldErrors?.note} aria-describedby="source-note-error"
                onChange={event => controller.setField('note', event.target.value)} /> : <input id={`source-${field.key}`} name={field.key}
                type={field.date ? 'datetime-local' : 'text'} step={field.date ? '0.001' : undefined} required={field.key === 'title'}
                className={inputClass} value={values[field.key]} aria-invalid={!!error?.fieldErrors?.[field.key]}
                aria-describedby={`source-${field.key}-error${field.date ? ' source-time-help' : ''}`}
                onChange={event => controller.setField(field.key, event.target.value)} />}
              <p id={`source-${field.key}-error`} className="mt-1 text-sm text-red-700">{error?.fieldErrors?.[field.key]}</p>
            </div>)}
          </div>
          <p id="source-time-help" className="text-sm text-slate-600">Thời gian theo UTC+7 (Việt Nam), giữ giây và mili giây. Để trống nếu không biết; thời điểm công bố, truy cập và dữ liệu là ba mốc độc lập.</p>
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={disabled} className={`${buttonClass} bg-[#167563] text-white`}>Lưu nguồn</button>
          <button type="button" disabled={disabled} className={buttonClass} onClick={() => {
            if (controller.cancel(confirm)) addRef.current?.focus()
          }}>Hủy</button>
        </div>
      </form>}
      <div aria-live="polite" aria-atomic="true" className="space-y-2">
        <p role="status">{state.message || (state.dirty ? 'Nguồn có thay đổi chưa lưu.' : '')}</p>
        {error && <p role="alert" data-error-code={error.code} className="text-red-700">{error.message}</p>}
        {state.warning && <p className="text-amber-800">{state.warning}</p>}
        {blocked && <p className="text-sm">Giữ hoặc sao chép nội dung đang nhập để đối chiếu. Tải lại sẽ bỏ nội dung chưa lưu trong tab này.</p>}
        {blocked && <button type="button" className={buttonClass} disabled={pending} onClick={() => {
          if (window.confirm('Tải lại sẽ bỏ nội dung nguồn chưa lưu. Bạn có muốn tiếp tục?')) {
            controller.leave()
            window.location.reload()
          }
        }}>Tải lại bản mới nhất</button>}
      </div>
      {snapshot.sources.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-600">Chưa có nguồn tham khảo.</p> : <ul aria-label="Danh sách nguồn" className="min-w-0 space-y-4">
        {snapshot.sources.map(source => <li key={source.id} data-source-id={source.id} className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <h3 className="font-semibold">{source.title}</h3>
          <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
            <div><dt className="font-medium">Loại nguồn</dt><dd>{SOURCE_TYPE_LABELS[source.sourceType]}</dd></div>
            <div><dt className="font-medium">Đơn vị xuất bản/cung cấp</dt><dd>{source.publisher ?? 'Không cung cấp'}</dd></div>
            <div className="min-w-0 sm:col-span-2"><dt className="font-medium">URL</dt><dd>
              {source.safeUrl ? <a href={source.safeUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-800 underline" aria-label={`Mở nguồn ${source.title} (tab mới)`}>{source.url}</a>
                : source.url ? <><span>{source.url}</span><p className="text-amber-800">URL không đáp ứng quy tắc liên kết; chỉ hiển thị văn bản.</p></> : 'Không cung cấp'}
            </dd></div>
            <div><dt className="font-medium">Thời điểm công bố</dt><dd>{displayDate(source.publishedAt)}</dd></div>
            <div><dt className="font-medium">Thời điểm truy cập</dt><dd>{displayDate(source.accessedAt)}</dd></div>
            <div><dt className="font-medium">Thời điểm dữ liệu</dt><dd>{displayDate(source.dataTimestamp)}</dd></div>
            <div className="sm:col-span-2"><dt className="font-medium">Ghi chú</dt><dd className="whitespace-pre-wrap">{source.note ?? 'Không cung cấp'}</dd></div>
          </dl>
          {snapshot.canMutate && <div className="flex flex-wrap gap-3">
            <button type="button" disabled={disabled} className={buttonClass} aria-label={`Sửa nguồn ${source.title}`} onClick={() => {
              if (controller.edit(source.id, confirm)) focusForm()
            }}>Sửa</button>
            <button type="button" disabled={disabled} className={buttonClass} aria-label={`Xóa nguồn ${source.title}`} onClick={async () => {
              controller.setOnline(navigator.onLine !== false)
              if (await controller.remove(source.id, confirm)) addRef.current?.focus()
            }}>Xóa</button>
          </div>}
        </li>)}
      </ul>}
    </section>
  )
}
