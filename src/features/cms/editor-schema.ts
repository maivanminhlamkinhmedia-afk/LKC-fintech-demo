import { getSchema, type Extensions, type JSONContent, type Mark } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'

export const EDITOR_SCHEMA_VERSION = 1
export const EDITOR_LIMITS = {
  maxBytes: 256 * 1024,
  maxNodes: 5000,
  maxDepth: 32,
  maxTextCodePoints: 200000,
} as const

export const EMPTY_EDITOR_DOCUMENT: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }
const LINK_REL = 'noopener noreferrer nofollow'
const encoder = new TextEncoder()

// Extend StarterKit's existing Link, keeping one registration and its URL checks.
// Pasted HTML may carry presentation attributes that are outside our JSON contract.
const DraftStarterKit = StarterKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map(extension => {
      if (extension.name !== 'link' || extension.type !== 'mark') return extension
      return (extension as Mark).extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            target: { default: '_blank', parseHTML: () => '_blank' },
            rel: { default: LINK_REL, parseHTML: () => LINK_REL },
            class: { default: null, parseHTML: () => null },
            title: { default: null, parseHTML: () => null },
          }
        },
      })
    })
  },
})

export function isSafeEditorLink(value: unknown): value is string {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value) || value !== value.trim() || value.includes('\\')) return false
  if (/^https?:\/\/[^/?#]*@/i.test(value)) return false
  if (Array.from(value).some(character => {
    const code = character.codePointAt(0)!
    return code <= 32 || (code >= 127 && code <= 159)
  })) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname && !url.username && !url.password
  } catch { return false }
}

export function createEditorExtensions(): Extensions {
  return [DraftStarterKit.configure({
    heading: { levels: [2, 3] },
    link: {
      openOnClick: false,
      autolink: false,
      linkOnPaste: false,
      markdownLinks: false,
      HTMLAttributes: { target: '_blank', rel: LINK_REL, class: null },
      isAllowedUri: isSafeEditorLink,
    },
    // Keep the saved document independent of an editor-only trailing paragraph plugin.
    trailingNode: false,
  })]
}

const schema = getSchema(createEditorExtensions())
type RecordValue = Record<string, unknown>

export class EditorDocumentError extends Error {
  readonly code: 'VALIDATION_ERROR' | 'UNSUPPORTED_DOCUMENT'
  constructor(code: 'VALIDATION_ERROR' | 'UNSUPPORTED_DOCUMENT' = 'VALIDATION_ERROR') {
    super(code === 'UNSUPPORTED_DOCUMENT' ? 'Nội dung chưa được trình soạn thảo hỗ trợ.' : 'Nội dung bài viết không hợp lệ hoặc vượt giới hạn.')
    this.name = 'EditorDocumentError'
    this.code = code
  }
}

function invalid(): never { throw new EditorDocumentError() }

// Inspect data descriptors rather than invoking getters or toJSON on untrusted input.
function record(input: unknown, keys: readonly string[]): RecordValue {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid()
  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) return invalid()
  const result: RecordValue = {}
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !keys.includes(key)) return invalid()
    const descriptor = Object.getOwnPropertyDescriptor(input, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable || descriptor.value === undefined) return invalid()
    result[key] = descriptor.value
  }
  return result
}

function array(input: unknown, max: number): unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) return invalid()
  const length = Object.getOwnPropertyDescriptor(input, 'length')?.value
  if (!Number.isSafeInteger(length) || length < 0 || length > max || Reflect.ownKeys(input).length !== length + 1) return invalid()
  const result: unknown[] = []
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index))
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return invalid()
    result.push(descriptor.value)
  }
  return result
}

export type ValidatedEditorDocument = { contentJson: JSONContent; contentText: string }

export function validateEditorDocument(input: unknown): ValidatedEditorDocument {
  try {
    let nodes = 0
    let stringBytes = 0
    const ancestors = new Set<object>()
    const string = (value: unknown): string => {
      if (typeof value !== 'string' || value.length > EDITOR_LIMITS.maxBytes) return invalid()
      stringBytes += encoder.encode(value).length
      if (stringBytes > EDITOR_LIMITS.maxBytes) return invalid()
      return value
    }
    const attributes = (type: string, inputAttrs: unknown): RecordValue | undefined => {
      if (inputAttrs === undefined) return undefined
      const keys = type === 'heading' ? ['level'] : type === 'orderedList' ? ['start', 'type']
        : type === 'codeBlock' ? ['language'] : type === 'link' ? ['href', 'target', 'rel', 'class', 'title'] : []
      const attrs = record(inputAttrs, keys)
      for (const [key, value] of Object.entries(attrs)) {
        if (typeof value === 'string') string(value)
        if (type === 'heading' && key === 'level' && value !== 2 && value !== 3) return invalid()
        if (type === 'orderedList' && key === 'start' && (!Number.isSafeInteger(value) || (value as number) < 1)) return invalid()
        if (type === 'orderedList' && key === 'type' && ![null, '1', 'a', 'A', 'i', 'I'].includes(value as string | null)) return invalid()
        if (type === 'codeBlock' && value !== null && (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_+-]{0,31}$/i.test(value))) return invalid()
        if (type === 'link') {
          if (key === 'href' && !isSafeEditorLink(value)) return invalid()
          if (key === 'target' && value !== '_blank') return invalid()
          if (key === 'rel' && value !== LINK_REL) return invalid()
          if ((key === 'class' || key === 'title') && value !== null) return invalid()
        }
      }
      return attrs
    }
    const mark = (inputMark: unknown): NonNullable<JSONContent['marks']>[number] => {
      const value = record(inputMark, ['type', 'attrs'])
      const type = string(value.type)
      if (!['bold', 'italic', 'underline', 'strike', 'code', 'link'].includes(type)) return invalid()
      const attrs = attributes(type, value.attrs)
      if (type === 'link' && !isSafeEditorLink(attrs?.href)) return invalid()
      return { type, ...(attrs === undefined ? {} : { attrs }) }
    }
    // Depth counts content-tree nodes, with the doc root at depth 1. The bound is
    // checked before descending, so cyclic/deep input never reaches ProseMirror.
    const node = (inputNode: unknown, depth: number): JSONContent => {
      if (depth > EDITOR_LIMITS.maxDepth || ++nodes > EDITOR_LIMITS.maxNodes) return invalid()
      const value = record(inputNode, ['type', 'attrs', 'content', 'marks', 'text'])
      if (ancestors.has(inputNode as object)) return invalid()
      ancestors.add(inputNode as object)
      const type = string(value.type)
      if (!['doc', 'paragraph', 'text', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock', 'hardBreak', 'horizontalRule'].includes(type)) return invalid()
      if ((depth === 1) !== (type === 'doc')) return invalid()
      if (type === 'text' && ('attrs' in value || 'content' in value)) return invalid()
      if (type !== 'text' && 'text' in value) return invalid()
      if (type !== 'text' && type !== 'hardBreak' && 'marks' in value) return invalid()
      const attrs = attributes(type, value.attrs)
      if (type === 'heading' && attrs?.level !== 2 && attrs?.level !== 3) return invalid()
      const result: JSONContent = { type }
      if (attrs !== undefined) result.attrs = attrs
      if (type === 'text') {
        result.text = string(value.text)
        if (!result.text) return invalid()
      }
      if ('marks' in value) result.marks = array(value.marks, 6).map(mark)
      if ('content' in value) result.content = array(value.content, EDITOR_LIMITS.maxNodes).map(child => node(child, depth + 1))
      ancestors.delete(inputNode as object)
      return result
    }
    const checked = node(input, 1)
    if (encoder.encode(JSON.stringify(checked)).length > EDITOR_LIMITS.maxBytes) return invalid()
    if (!checked.content?.length) checked.content = [{ type: 'paragraph' }]
    const document = schema.nodeFromJSON(checked)
    document.check()
    // Only serialize the strictly checked, schema-validated document. Do not
    // clone untrusted input first: that could invoke hooks or erase invalid data.
    const canonicalJson = JSON.stringify(document.toJSON())
    if (encoder.encode(canonicalJson).length > EDITOR_LIMITS.maxBytes) return invalid()
    const contentText = document.textBetween(0, document.content.size, '\n', leaf => leaf.type.name === 'hardBreak' ? '\n' : '')
    if (Array.from(contentText).length > EDITOR_LIMITS.maxTextCodePoints) return invalid()
    // node/mark.toJSON retains ProseMirror's null-prototype attrs. Reopened
    // editor props must be ordinary JSON objects at the Server Component boundary.
    const contentJson: JSONContent = JSON.parse(canonicalJson)
    return { contentJson, contentText }
  } catch { throw new EditorDocumentError() }
}

export function validateStoredEditorDocument(contentJson: unknown, version: unknown): ValidatedEditorDocument {
  if (version !== EDITOR_SCHEMA_VERSION) throw new EditorDocumentError('UNSUPPORTED_DOCUMENT')
  try { return validateEditorDocument(contentJson) } catch { throw new EditorDocumentError('UNSUPPORTED_DOCUMENT') }
}
