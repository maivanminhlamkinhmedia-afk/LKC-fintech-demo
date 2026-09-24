'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { Editor, JSONContent } from '@tiptap/core'
import type { ArticleType } from '@prisma/client'
import { ARTICLE_TYPES, canonicalizeArticleSlug, type DraftFailure } from '@/features/cms/article-draft'
import { EMPTY_EDITOR_DOCUMENT } from '@/features/cms/editor-schema'
import { createArticleDraft, updateArticleDraft } from '@/features/cms/article-draft-actions'
import type { DraftEditorData } from '@/features/cms/article-draft-query'
import { ArticleEditor } from './ArticleEditor'

const TYPE_LABELS: Record<ArticleType, string> = {
  NEWS: 'Tin tức', MARKET_UPDATE: 'Cập nhật thị trường', ANALYSIS: 'Phân tích',
  EDUCATION: 'Kiến thức', RESEARCH: 'Nghiên cứu', OPINION: 'Góc nhìn',
}
const inputClass = 'w-full min-w-0 rounded-xl border border-slate-300 bg-white px-4 py-3 focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:bg-slate-100'

export function ArticleDraftForm({ initial }: { initial?: DraftEditorData }) {
  const router = useRouter()
  const [values, setValues] = useState(() => ({
    title: initial?.title ?? '', slug: initial?.slug ?? '', excerpt: initial?.excerpt ?? '',
    articleType: initial?.articleType ?? 'NEWS' as ArticleType,
    contentJson: initial?.contentJson ?? EMPTY_EDITOR_DOCUMENT,
  }))
  const [saved, setSaved] = useState(() => initial ? { id: initial.id, updatedAt: initial.updatedAt } : null)
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

  const onEditorReady = useCallback((editor: Editor | null) => {
    editorRef.current = editor
    setReady(!!editor)
  }, [])
  const onDocumentChange = useCallback((contentJson: JSONContent) => {
    if (pendingRef.current) return
    dirtyRef.current = true
    setValues(current => ({ ...current, contentJson }))
    setStatus('unsaved')
    setWarning('')
  }, [])

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!dirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    function beforeLink(event: MouseEvent) {
      if (!dirtyRef.current || event.defaultPrevented || event.button !== 0
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
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', beforeLink, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', beforeLink, true)
    }
  }, [])

  function changed() {
    dirtyRef.current = true
    setStatus('unsaved')
    setWarning('')
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pendingRef.current || !editorRef.current) return
    pendingRef.current = true
    // Lock synchronously before capturing the document; a second event cannot submit again.
    editorRef.current.setEditable(false, false)
    const payload = { ...values, contentJson: editorRef.current.getJSON() }
    setStatus('pending')
    setError(null)
    setWarning('')
    let committed = false
    let openingSavedArticle = false
    try {
      const result = saved
        ? await updateArticleDraft(saved.id, { ...payload, expectedUpdatedAt: saved.updatedAt })
        : await createArticleDraft(payload)
      if (!result.ok) {
        setError(result.error)
        setStatus('failed')
        dirtyRef.current = true
        return
      }
      committed = true
      setSaved({ id: result.data.id, updatedAt: result.data.updatedAt })
      setValues(current => ({ ...current, slug: result.data.slug }))
      setSlugEdited(true)
      dirtyRef.current = false
      setStatus('saved')
      setWarning(result.warning ?? '')
      if (!saved) {
        // Keep inputs locked until the edit route mounts its persisted snapshot.
        // Otherwise typing during navigation would be discarded on that remount.
        openingSavedArticle = true
        setNavigating(true)
        router.replace(`/creator/articles/${encodeURIComponent(result.data.id)}/edit`)
      }
    } catch {
      if (committed) {
        openingSavedArticle = false
        setNavigating(false)
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

  const pending = status === 'pending' || navigating
  const fieldErrors = error?.fieldErrors
  return (
    <form onSubmit={save} className="min-w-0 space-y-6" aria-busy={pending}>
      <fieldset disabled={pending} className="min-w-0 space-y-5">
        <legend className="sr-only">Thông tin bài nháp</legend>
        <div>
          <label htmlFor="article-title" className="mb-2 block font-medium">Tiêu đề</label>
          <input id="article-title" name="title" required value={values.title} className={inputClass}
            aria-invalid={!!fieldErrors?.title} aria-describedby="article-title-error"
            onChange={event => {
              changed()
              const title = event.target.value
              let slug = values.slug
              if (!slugEdited && !saved) {
                try { slug = canonicalizeArticleSlug(title) } catch { slug = '' }
              }
              setValues(current => ({ ...current, title, slug }))
            }} />
          <p id="article-title-error" className="mt-1 text-sm text-red-700">{fieldErrors?.title}</p>
        </div>
        <div className="grid min-w-0 gap-5 md:grid-cols-2">
          <div className="min-w-0">
            <label htmlFor="article-slug" className="mb-2 block font-medium">Slug</label>
            <input id="article-slug" name="slug" required value={values.slug} className={inputClass}
              aria-invalid={!!fieldErrors?.slug} aria-describedby="article-slug-help article-slug-error"
              onChange={event => { changed(); setSlugEdited(true); setValues(current => ({ ...current, slug: event.target.value })) }} />
            <p id="article-slug-help" className="mt-1 text-xs text-slate-500">Định danh duy nhất của bài viết, tối đa 150 ký tự sau chuẩn hóa.</p>
            <p id="article-slug-error" className="mt-1 text-sm text-red-700">{fieldErrors?.slug}</p>
          </div>
          <div className="min-w-0">
            <label htmlFor="article-type" className="mb-2 block font-medium">Loại bài viết</label>
            <select id="article-type" name="articleType" value={values.articleType} className={inputClass}
              aria-invalid={!!fieldErrors?.articleType} aria-describedby="article-type-error"
              onChange={event => { changed(); setValues(current => ({ ...current, articleType: event.target.value as ArticleType })) }}>
              {ARTICLE_TYPES.map(type => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
            </select>
            <p id="article-type-error" className="mt-1 text-sm text-red-700">{fieldErrors?.articleType}</p>
          </div>
        </div>
        <div>
          <label htmlFor="article-excerpt" className="mb-2 block font-medium">Tóm tắt</label>
          <textarea id="article-excerpt" name="excerpt" rows={3} value={values.excerpt} className={inputClass}
            aria-invalid={!!fieldErrors?.excerpt} aria-describedby="article-excerpt-error"
            onChange={event => { changed(); setValues(current => ({ ...current, excerpt: event.target.value })) }} />
          <p id="article-excerpt-error" className="mt-1 text-sm text-red-700">{fieldErrors?.excerpt}</p>
        </div>
        <div className="min-w-0">
          <p className="mb-2 font-medium">Nội dung bài viết</p>
          <p id="article-content-help" className="mb-3 text-sm text-slate-500">Có thể để trống nội dung khi lưu nháp. Nhấn Lưu nháp để lưu thay đổi.</p>
          <ArticleEditor initialContent={initialDocument} disabled={pending} invalid={!!fieldErrors?.contentJson}
            onChange={onDocumentChange} onReady={onEditorReady} />
          <p id="article-content-error" className="mt-2 text-sm text-red-700">{fieldErrors?.contentJson}</p>
        </div>
      </fieldset>
      <div aria-live="polite" aria-atomic="true" className="space-y-2">
        <p role="status" className="font-medium">{({ unsaved: 'Chưa lưu', pending: 'Đang lưu…', saved: 'Đã lưu', failed: 'Lưu thất bại' })[status]}</p>
        {error && <p data-error-code={error.code} className="text-sm text-red-700">{error.message}</p>}
        {warning && <p className="text-sm text-amber-800">{warning}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || !ready} className="rounded-xl bg-[#167563] px-5 py-3 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50">Lưu nháp</button>
        <Link href="/creator/articles" className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-medium">Danh sách bài viết</Link>
        {error?.code === 'EDIT_CONFLICT' && <button type="button" disabled={pending} className="rounded-xl border border-amber-500 px-5 py-3 text-sm" onClick={() => {
          if (window.confirm('Tải lại sẽ bỏ nội dung chưa lưu trong tab này. Bạn có muốn tiếp tục?')) {
            dirtyRef.current = false
            window.location.reload()
          }
        }}>Tải lại bản mới nhất</button>}
      </div>
    </form>
  )
}
