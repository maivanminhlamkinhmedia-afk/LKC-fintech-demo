'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { Editor, JSONContent } from '@tiptap/core'
import type { ArticleType } from '@prisma/client'
import { ARTICLE_TYPES, canonicalizeArticleSlug, type DraftFailure } from '@/features/cms/article-draft'
import { EMPTY_EDITOR_DOCUMENT } from '@/features/cms/editor-schema'
import { createArticleDraft, updateArticleDraft } from '@/features/cms/article-draft-actions'
import { createArticleAutosave, type DraftValues } from '@/features/cms/article-autosave'
import type { DraftEditorData } from '@/features/cms/article-draft-query'
import { ArticleEditor } from './ArticleEditor'

const TYPE_LABELS: Record<ArticleType, string> = {
  NEWS: 'Tin tức', MARKET_UPDATE: 'Cập nhật thị trường', ANALYSIS: 'Phân tích',
  EDUCATION: 'Kiến thức', RESEARCH: 'Nghiên cứu', OPINION: 'Góc nhìn',
}
const inputClass = 'w-full min-w-0 rounded-xl border border-slate-300 bg-white px-4 py-3 focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:bg-slate-100'

export function ArticleDraftForm({ initial }: { initial?: DraftEditorData }) {
  // Revalidation of the same article preserves local state; another article gets
  // a new controller/editor instance, never the previous article's late ACK.
  return <DraftFormInstance key={initial?.id ?? 'new'} initial={initial} />
}

function DraftFormInstance({ initial }: { initial?: DraftEditorData }) {
  const router = useRouter()
  const [values, setValues] = useState<DraftValues>(() => ({
    title: initial?.title ?? '', slug: initial?.slug ?? '', excerpt: initial?.excerpt ?? '',
    articleType: initial?.articleType ?? 'NEWS' as ArticleType,
    contentJson: initial?.contentJson ?? EMPTY_EDITOR_DOCUMENT,
  }))
  const valuesRef = useRef(values)
  const [controller] = useState(() => initial ? createArticleAutosave({
    id: initial.id, initial: values, updatedAt: initial.updatedAt, update: updateArticleDraft,
  }) : null)
  const [autosave, setAutosave] = useState(() => controller?.getState())
  const [slugEdited, setSlugEdited] = useState(!!initial)
  const [status, setStatus] = useState<'unsaved' | 'pending' | 'saved' | 'failed'>(initial ? 'saved' : 'unsaved')
  const [error, setError] = useState<DraftFailure | null>(null)
  const [warning, setWarning] = useState('')
  const [navigating, setNavigating] = useState(false)
  const [ready, setReady] = useState(false)
  const [initialDocument] = useState(values.contentJson)
  const editorRef = useRef<Editor | null>(null)
  const pendingRef = useRef(false)
  const dirtyRef = useRef(false)
  const composingRef = useRef(false)
  const mountedRef = useRef(false)
  const createdRef = useRef(false)

  const onEditorReady = useCallback((editor: Editor | null) => {
    editorRef.current = editor
    setReady(!!editor)
  }, [])
  const changeValues = useCallback((change: (current: DraftValues) => DraftValues) => {
    if (!controller && pendingRef.current) return
    const next = change(valuesRef.current)
    valuesRef.current = next
    setValues(next)
    if (controller) controller.setValues(next)
    else {
      dirtyRef.current = true
      setStatus('unsaved')
      setWarning('')
    }
  }, [controller])
  const onDocumentChange = useCallback((contentJson: JSONContent) => {
    changeValues(current => ({ ...current, contentJson }))
  }, [changeValues])

  useEffect(() => {
    mountedRef.current = true
    const unsubscribe = controller?.subscribe(setAutosave)
    controller?.setOnline(navigator.onLine !== false)
    controller?.activate((from, to) => {
      if (valuesRef.current.slug !== from) return
      const next = { ...valuesRef.current, slug: to }
      valuesRef.current = next
      setValues(next)
    })
    const online = () => controller?.setOnline(true)
    const offline = () => controller?.setOnline(false)
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    return () => {
      mountedRef.current = false
      unsubscribe?.()
      controller?.deactivate()
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    }
  }, [controller])

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!(controller ? controller.shouldWarn() : dirtyRef.current || (pendingRef.current && !createdRef.current))) return
      event.preventDefault()
      event.returnValue = ''
    }
    function beforeLink(event: MouseEvent) {
      if (!(controller ? controller.shouldWarn() : dirtyRef.current || (pendingRef.current && !createdRef.current)) || event.defaultPrevented || event.button !== 0
        || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return
      const target = new URL(link.href, window.location.href)
      if (target.origin === window.location.origin && target.pathname === window.location.pathname && target.search === window.location.search) return
      if (!window.confirm('Nội dung chưa lưu có thể bị mất. Bạn có muốn rời trang?')) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
      } else {
        dirtyRef.current = false
        controller?.leave()
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', beforeLink, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', beforeLink, true)
    }
  }, [controller])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editorRef.current || composingRef.current) return
    if (controller) {
      await controller.manualSave()
      return
    }
    if (pendingRef.current) return
    pendingRef.current = true
    let committed = false
    let openingSavedArticle = false
    try {
      // Lock synchronously; preparation errors must also reach catch/finally.
      editorRef.current.setEditable(false, false)
      setStatus('pending')
      setError(null)
      setWarning('')
      // ProseMirror attrs have null prototypes. Copy this trusted editor output
      // into plain JSON before React Flight can turn attrs into opaque references.
      // The action still strictly validates the received payload independently.
      const contentJson = JSON.parse(JSON.stringify(editorRef.current.getJSON())) as JSONContent
      const payload = { ...valuesRef.current, contentJson }
      const result = await createArticleDraft(payload)
      if (!mountedRef.current) return
      if (!result.ok) {
        setError(result.error)
        setStatus('failed')
        dirtyRef.current = true
        return
      }
      committed = true
      createdRef.current = true
      const next = { ...valuesRef.current, slug: result.data.slug }
      valuesRef.current = next
      setValues(next)
      setSlugEdited(true)
      dirtyRef.current = false
      setStatus('saved')
      setWarning(result.warning ?? '')
      // Only the persisted edit instance may begin autosaving after create.
      openingSavedArticle = true
      setNavigating(true)
      router.replace(`/creator/articles/${encodeURIComponent(result.data.id)}/edit`)
    } catch {
      if (!mountedRef.current) return
      if (committed) {
        openingSavedArticle = true
        setStatus('saved')
        setWarning('Bài đã được lưu. Bạn có thể mở lại từ danh sách bài viết.')
        return
      }
      setStatus('failed')
      dirtyRef.current = true
      setError({ code: 'INTERNAL_ERROR', message: 'Chưa xác nhận được kết quả lưu. Nội dung vẫn được giữ tại đây; hãy kiểm tra danh sách bài viết trước khi thử lại.' })
    } finally {
      if (!openingSavedArticle) {
        pendingRef.current = false
        editorRef.current?.setEditable(true, false)
      }
    }
  }

  const pending = controller ? !!autosave?.pending : status === 'pending' || navigating
  const locked = !controller && pending
  const currentError = controller ? autosave?.error : error
  const currentWarning = controller ? autosave?.warning : warning
  const fieldErrors = currentError?.fieldErrors
  const statusText = controller && autosave ? ({
    clean: 'Đã lưu', dirty: 'Chưa lưu', saving: 'Đang lưu…',
    offline: 'Mất kết nối — thay đổi chưa được lưu',
    'validation-blocked': 'Tự động lưu tạm dừng…', conflict: 'Tự động lưu tạm dừng…',
    terminal: 'Tự động lưu tạm dừng…', uncertain: 'Tự động lưu tạm dừng…', leaving: 'Đang rời trang…',
  })[autosave.phase] : ({ unsaved: 'Chưa lưu', pending: 'Đang lưu…', saved: 'Đã lưu', failed: 'Lưu thất bại' })[status]
  const cannotUpdate = autosave?.phase === 'conflict' || autosave?.phase === 'terminal' || autosave?.phase === 'leaving'
  return (
    <form onSubmit={save} className="min-w-0 space-y-6" aria-busy={pending}
      onCompositionStartCapture={() => { composingRef.current = true; controller?.setComposing(true) }}
      onCompositionEndCapture={() => {
        // Final input/ProseMirror document events must land before rearming.
        queueMicrotask(() => {
          if (!mountedRef.current) return
          composingRef.current = false
          controller?.setComposing(false)
        })
      }}>
      <fieldset disabled={locked} className="min-w-0 space-y-5">
        <legend className="sr-only">Thông tin bài nháp</legend>
        <div>
          <label htmlFor="article-title" className="mb-2 block font-medium">Tiêu đề</label>
          <input id="article-title" name="title" required value={values.title} className={inputClass}
            aria-invalid={!!fieldErrors?.title} aria-describedby="article-title-error"
            onChange={event => {
              const title = event.target.value
              let slug = valuesRef.current.slug
              if (!slugEdited && !initial) {
                try { slug = canonicalizeArticleSlug(title) } catch { slug = '' }
              }
              changeValues(current => ({ ...current, title, slug }))
            }} />
          <p id="article-title-error" className="mt-1 text-sm text-red-700">{fieldErrors?.title}</p>
        </div>
        <div className="grid min-w-0 gap-5 md:grid-cols-2">
          <div className="min-w-0">
            <label htmlFor="article-slug" className="mb-2 block font-medium">Slug</label>
            <input id="article-slug" name="slug" required value={values.slug} className={inputClass}
              aria-invalid={!!fieldErrors?.slug} aria-describedby="article-slug-help article-slug-error"
              onChange={event => { const slug = event.target.value; setSlugEdited(true); changeValues(current => ({ ...current, slug })) }} />
            <p id="article-slug-help" className="mt-1 text-xs text-slate-500">Định danh duy nhất của bài viết, tối đa 150 ký tự sau chuẩn hóa.</p>
            <p id="article-slug-error" className="mt-1 text-sm text-red-700">{fieldErrors?.slug}</p>
          </div>
          <div className="min-w-0">
            <label htmlFor="article-type" className="mb-2 block font-medium">Loại bài viết</label>
            <select id="article-type" name="articleType" value={values.articleType} className={inputClass}
              aria-invalid={!!fieldErrors?.articleType} aria-describedby="article-type-error"
              onChange={event => { const articleType = event.target.value as ArticleType; changeValues(current => ({ ...current, articleType })) }}>
              {ARTICLE_TYPES.map(type => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
            </select>
            <p id="article-type-error" className="mt-1 text-sm text-red-700">{fieldErrors?.articleType}</p>
          </div>
        </div>
        <div>
          <label htmlFor="article-excerpt" className="mb-2 block font-medium">Tóm tắt</label>
          <textarea id="article-excerpt" name="excerpt" rows={3} value={values.excerpt} className={inputClass}
            aria-invalid={!!fieldErrors?.excerpt} aria-describedby="article-excerpt-error"
            onChange={event => { const excerpt = event.target.value; changeValues(current => ({ ...current, excerpt })) }} />
          <p id="article-excerpt-error" className="mt-1 text-sm text-red-700">{fieldErrors?.excerpt}</p>
        </div>
        <div className="min-w-0">
          <p className="mb-2 font-medium">Nội dung bài viết</p>
          <p id="article-content-help" className="mb-3 text-sm text-slate-500">{controller
            ? 'Tự động lưu sau khi bạn ngừng nhập 2 giây. Bạn vẫn có thể nhấn Lưu nháp.'
            : 'Có thể để trống nội dung khi lưu nháp. Nhấn Lưu nháp để tạo bài lần đầu.'}</p>
          <ArticleEditor initialContent={initialDocument} disabled={locked} invalid={!!fieldErrors?.contentJson}
            onChange={onDocumentChange} onReady={onEditorReady} />
          <p id="article-content-error" className="mt-2 text-sm text-red-700">{fieldErrors?.contentJson}</p>
        </div>
      </fieldset>
      <div aria-live="polite" aria-atomic="true" className="space-y-2">
        <p role="status" className="font-medium">{statusText}</p>
        {currentError && <p data-error-code={currentError.code} className="text-sm text-red-700">{currentError.message}</p>}
        {currentWarning && <p className="text-sm text-amber-800">{currentWarning}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={locked || !ready || cannotUpdate} className="rounded-xl bg-[#167563] px-5 py-3 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50">Lưu nháp</button>
        <Link href="/creator/articles" className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-medium">Danh sách bài viết</Link>
        {currentError?.code === 'EDIT_CONFLICT' && <button type="button" disabled={pending} className="rounded-xl border border-amber-500 px-5 py-3 text-sm" onClick={() => {
          if (window.confirm('Tải lại sẽ bỏ nội dung chưa lưu trong tab này. Bạn có muốn tiếp tục?')) {
            dirtyRef.current = false
            controller?.leave()
            window.location.reload()
          }
        }}>Tải lại bản mới nhất</button>}
      </div>
    </form>
  )
}
