'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import type { Editor, JSONContent } from '@tiptap/core'
import { createEditorExtensions, isSafeEditorLink } from '@/features/cms/editor-schema'
import styles from './ArticleEditor.module.css'

export function ArticleEditor({ initialContent, disabled, invalid, onChange, onReady }: {
  initialContent: JSONContent
  disabled: boolean
  invalid?: boolean
  onChange: (document: JSONContent) => void
  onReady: (editor: Editor | null) => void
}) {
  const extensions = useMemo(() => createEditorExtensions(), [])
  const linkId = useId()
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkError, setLinkError] = useState('')
  const editor = useEditor({
    extensions,
    content: initialContent,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': 'Nội dung bài viết',
        'aria-multiline': 'true',
        'aria-describedby': 'article-content-help article-content-error',
      },
    },
    onUpdate: ({ editor: currentEditor }) => onChange(currentEditor.getJSON()),
  })

  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => current ? {
      paragraph: current.isActive('paragraph'),
      h2: current.isActive('heading', { level: 2 }),
      h3: current.isActive('heading', { level: 3 }),
      bold: current.isActive('bold'), italic: current.isActive('italic'),
      underline: current.isActive('underline'), strike: current.isActive('strike'),
      code: current.isActive('code'), bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'), blockquote: current.isActive('blockquote'),
      codeBlock: current.isActive('codeBlock'), link: current.isActive('link'),
      undo: current.can().undo(), redo: current.can().redo(),
    } : null,
  })

  useEffect(() => {
    onReady(editor)
    return () => onReady(null)
  }, [editor, onReady])

  useEffect(() => { editor?.setEditable(!disabled, false) }, [editor, disabled])
  useEffect(() => {
    if (editor) editor.view.dom.setAttribute('aria-invalid', String(!!invalid))
  }, [editor, invalid])

  const buttonClass = 'rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-40 aria-pressed:border-emerald-600 aria-pressed:bg-emerald-50 aria-pressed:text-emerald-800'
  const commands = editor && active ? [
    { label: 'Đoạn văn', pressed: active.paragraph, run: () => editor.chain().focus().setParagraph().run() },
    { label: 'H2', pressed: active.h2, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: 'H3', pressed: active.h3, run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { label: 'Đậm', pressed: active.bold, run: () => editor.chain().focus().toggleBold().run() },
    { label: 'Nghiêng', pressed: active.italic, run: () => editor.chain().focus().toggleItalic().run() },
    { label: 'Gạch chân', pressed: active.underline, run: () => editor.chain().focus().toggleUnderline().run() },
    { label: 'Gạch ngang', pressed: active.strike, run: () => editor.chain().focus().toggleStrike().run() },
    { label: 'Mã nội dòng', pressed: active.code, run: () => editor.chain().focus().toggleCode().run() },
    { label: 'Danh sách chấm', pressed: active.bulletList, run: () => editor.chain().focus().toggleBulletList().run() },
    { label: 'Danh sách số', pressed: active.orderedList, run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: 'Trích dẫn', pressed: active.blockquote, run: () => editor.chain().focus().toggleBlockquote().run() },
    { label: 'Khối mã', pressed: active.codeBlock, run: () => editor.chain().focus().toggleCodeBlock().run() },
    { label: 'Xuống dòng', run: () => editor.chain().focus().setHardBreak().run() },
    { label: 'Đường phân cách', run: () => editor.chain().focus().setHorizontalRule().run() },
    { label: 'Hoàn tác', unavailable: !active.undo, run: () => editor.chain().focus().undo().run() },
    { label: 'Làm lại', unavailable: !active.redo, run: () => editor.chain().focus().redo().run() },
  ] : []

  function applyLink() {
    if (!editor || disabled) return
    const href = linkUrl.trim()
    if (!isSafeEditorLink(href)) {
      setLinkError('Nhập URL http/https tuyệt đối, không chứa thông tin đăng nhập.')
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    setLinkOpen(false)
    setLinkError('')
  }

  return (
    <div className="min-w-0 rounded-xl border border-slate-300 bg-white">
      <div role="group" aria-label="Định dạng bài viết" className="flex flex-wrap gap-2 border-b border-slate-200 p-3">
        {commands.map(command => (
          <button key={command.label} type="button" className={buttonClass} aria-pressed={command.pressed}
            disabled={disabled || command.unavailable} onClick={() => command.run()}>{command.label}</button>
        ))}
        <button type="button" className={buttonClass} disabled={disabled || !editor} aria-expanded={linkOpen} aria-pressed={active?.link}
          onClick={() => {
            setLinkUrl(String(editor?.getAttributes('link').href ?? ''))
            setLinkError('')
            setLinkOpen(!linkOpen)
          }}>Liên kết</button>
        <button type="button" className={buttonClass} disabled={disabled || !active?.link}
          onClick={() => editor?.chain().focus().extendMarkRange('link').unsetLink().run()}>Gỡ liên kết</button>
      </div>
      {linkOpen && (
        <div className="space-y-2 border-b border-slate-200 bg-slate-50 p-3">
          <label htmlFor={linkId} className="block text-sm font-medium">URL liên kết</label>
          <input id={linkId} type="url" value={linkUrl} disabled={disabled} onChange={event => setLinkUrl(event.target.value)}
            aria-invalid={!!linkError} aria-describedby={`${linkId}-error`} className="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2" />
          <p id={`${linkId}-error`} className="text-sm text-red-700" aria-live="polite">{linkError}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={disabled} className={buttonClass} onClick={applyLink}>Áp dụng liên kết</button>
            <button type="button" disabled={disabled} className={buttonClass} onClick={() => setLinkOpen(false)}>Hủy liên kết</button>
          </div>
        </div>
      )}
      {!editor && <p role="status" className="p-5 text-sm text-slate-500">Đang tải trình soạn thảo…</p>}
      <EditorContent editor={editor} className={styles.editor} />
    </div>
  )
}
