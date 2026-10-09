import type { JSONContent } from '@tiptap/core'
import { validateStoredEditorDocument } from './editor-schema'
import { safeSourceUrl, SOURCE_TYPES } from './article-sources'

export type ReviewSnapshotError = 'UNSUPPORTED_SNAPSHOT' | 'INCOMPLETE_SNAPSHOT' | 'INVALID_SNAPSHOT'
export type ReviewSnapshot = Readonly<{
  articleId: string; versionId: string; versionNumber: number; basisUpdatedAt: string
  title: string; slug: string; excerpt: string; articleType: string
  contentJson: JSONContent; contentText: string; editorSchemaVersion: number
  seoTitle: string | null; seoDescription: string | null; featured: boolean
  category: { id: string; name: string } | null
  topics: readonly { id: string; name: string }[]
  tags: readonly { id: string; name: string }[]
  instruments: readonly { id: string; name: string; symbol: string; isPrimary: boolean }[]
  sources: readonly { id: string; sourceType: string; title: string; publisher: string | null
    safeUrl: string | null; publishedAt: string | null; accessedAt: string | null; dataTimestamp: string | null }[]
  disclosures: readonly { id: string; statement: string; conflictType: string | null }[]
  cover: { assetId: string; altText: string | null; caption: string | null } | null
  activation: 'FOUNDATION_ONLY' // No audience/Product binding or approval authority in CMS-011.1.
}>
export type ReviewSnapshotResult = { ok: true; data: ReviewSnapshot }
  | { ok: false; error: ReviewSnapshotError }

class SnapshotFault extends Error {
  readonly code: ReviewSnapshotError
  constructor(code: ReviewSnapshotError) { super(code); this.code = code }
}
function fault(code: ReviewSnapshotError): never { throw new SnapshotFault(code) }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fault('INVALID_SNAPSHOT')
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return fault('INVALID_SNAPSHOT')
  return value as Record<string, unknown>
}
function field(value: unknown, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record(value), key)
  if (!descriptor) return fault('INCOMPLETE_SNAPSHOT')
  if (!('value' in descriptor)) return fault('INVALID_SNAPSHOT')
  return descriptor.value
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,191}$/u.test(value)) return fault('INVALID_SNAPSHOT')
  return value
}
function nonempty(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return fault('INVALID_SNAPSHOT')
  return value
}
function string(value: unknown): string {
  if (typeof value !== 'string') return fault('INVALID_SNAPSHOT')
  return value
}
function nullable(value: unknown): string | null {
  return value === null ? null : nonempty(value)
}
function timestamp(value: unknown): string {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return fault('INVALID_SNAPSHOT')
    return value.toISOString()
  }
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)) {
    return fault('INVALID_SNAPSHOT')
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) return fault('INVALID_SNAPSHOT')
  return value
}
function nullableTimestamp(value: unknown): string | null { return value === null ? null : timestamp(value) }
function rows(value: unknown): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return fault('INVALID_SNAPSHOT')
  const result: unknown[] = []
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !('value' in descriptor)) fault('INVALID_SNAPSHOT')
    result.push(descriptor.value)
  }
  return result
}
function scoped(row: unknown, articleId: string, versionId: string): void {
  if (id(field(row, 'articleId')) !== articleId || id(field(row, 'versionId')) !== versionId) {
    fault('INVALID_SNAPSHOT')
  }
}
function unique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) fault('INVALID_SNAPSHOT')
}

// Supplied persisted version and typed child rows only. This does not read a DB,
// capture a revision, validate Product access, or authorize a transition.
export function inspectReviewSnapshot(input: unknown): ReviewSnapshotResult {
  try {
    const version = field(input, 'version')
    const format = field(version, 'snapshotFormatVersion')
    if (format !== 1) return { ok: false, error: 'UNSUPPORTED_SNAPSHOT' }
    const articleId = id(field(version, 'articleId'))
    const versionId = id(field(version, 'id'))
    const versionNumber = field(version, 'versionNumber')
    if (!Number.isSafeInteger(versionNumber) || (versionNumber as number) < 1) fault('INVALID_SNAPSHOT')
    const basisUpdatedAt = timestamp(field(version, 'basisUpdatedAt'))
    const editorSchemaVersion = field(version, 'editorSchemaVersion')
    const checked = validateStoredEditorDocument(field(version, 'contentJson'), editorSchemaVersion)
    if (field(version, 'contentText') !== checked.contentText) fault('INVALID_SNAPSHOT')
    const articleType = field(version, 'articleType')
    if (!['NEWS', 'MARKET_UPDATE', 'ANALYSIS', 'EDUCATION', 'RESEARCH', 'OPINION'].includes(articleType as string)) {
      fault('INVALID_SNAPSHOT')
    }
    const featured = field(version, 'featured')
    if (typeof featured !== 'boolean') fault('INVALID_SNAPSHOT')

    const categoryRows = rows(field(input, 'categories'))
    if (categoryRows.length > 1) fault('INVALID_SNAPSHOT')
    const category = categoryRows[0] === undefined ? null : (() => {
      scoped(categoryRows[0], articleId, versionId)
      return { id: id(field(categoryRows[0], 'categoryId')), name: nonempty(field(categoryRows[0], 'nameAtCapture')) }
    })()
    const terms = (key: 'topics' | 'tags', idKey: 'topicId' | 'tagId') => {
      const items = rows(field(input, key)).map(row => {
        scoped(row, articleId, versionId)
        return { id: id(field(row, idKey)), name: nonempty(field(row, 'nameAtCapture')) }
      })
      unique(items.map(item => item.id))
      return items
    }
    const topics = terms('topics', 'topicId'), tags = terms('tags', 'tagId')
    const instruments = rows(field(input, 'instruments')).map(row => {
      scoped(row, articleId, versionId)
      const isPrimary = field(row, 'isPrimary')
      if (typeof isPrimary !== 'boolean') fault('INVALID_SNAPSHOT')
      return { id: id(field(row, 'instrumentId')), name: nonempty(field(row, 'nameAtCapture')),
        symbol: nonempty(field(row, 'symbolAtCapture')), isPrimary }
    })
    unique(instruments.map(item => item.id))
    if (instruments.filter(item => item.isPrimary).length > 1) fault('INVALID_SNAPSHOT')

    const ordered = <T>(key: 'sources' | 'disclosures', project: (row: unknown) => T): T[] => {
      const entries = rows(field(input, key)).map(row => {
        scoped(row, articleId, versionId)
        const position = field(row, 'position')
        if (!Number.isSafeInteger(position) || (position as number) < 0) fault('INVALID_SNAPSHOT')
        return { position: position as number, value: project(row) }
      }).sort((left, right) => left.position - right.position)
      if (entries.some((entry, index) => entry.position !== index)) fault('INVALID_SNAPSHOT')
      return entries.map(entry => entry.value)
    }
    const sources = ordered('sources', row => {
      const sourceType = field(row, 'sourceType')
      if (!SOURCE_TYPES.includes(sourceType as typeof SOURCE_TYPES[number])) fault('INVALID_SNAPSHOT')
      const url = field(row, 'url')
      if (url !== null && (typeof url !== 'string' || safeSourceUrl(url) === null)) fault('INVALID_SNAPSHOT')
      return { id: id(field(row, 'sourceIdAtCapture')), sourceType: sourceType as string,
        title: nonempty(field(row, 'title')), publisher: nullable(field(row, 'publisher')),
        safeUrl: url === null ? null : safeSourceUrl(url),
        publishedAt: nullableTimestamp(field(row, 'publishedAt')),
        accessedAt: nullableTimestamp(field(row, 'accessedAt')),
        dataTimestamp: nullableTimestamp(field(row, 'dataTimestamp')) }
    })
    unique(sources.map(item => item.id))
    const disclosures = ordered('disclosures', row => ({
      id: id(field(row, 'disclosureIdAtCapture')), statement: nonempty(field(row, 'statement')),
      conflictType: nullable(field(row, 'conflictType')),
    }))
    unique(disclosures.map(item => item.id))

    const media = rows(field(input, 'media'))
    if (media.length > 1) fault('INVALID_SNAPSHOT') // Editor schema v1: cover only.
    const cover = media[0] === undefined ? null : (() => {
      scoped(media[0], articleId, versionId)
      if (field(media[0], 'context') !== 'COVER') fault('UNSUPPORTED_SNAPSHOT')
      return { assetId: id(field(media[0], 'assetId')),
        altText: nullable(field(media[0], 'altTextAtCapture')),
        caption: nullable(field(media[0], 'captionAtCapture')) }
    })()
    return { ok: true, data: {
      articleId, versionId, versionNumber: versionNumber as number, basisUpdatedAt,
      title: nonempty(field(version, 'title')), slug: nonempty(field(version, 'slug')),
      excerpt: string(field(version, 'excerpt')), articleType: articleType as string,
      contentJson: checked.contentJson, contentText: checked.contentText,
      editorSchemaVersion: editorSchemaVersion as number,
      seoTitle: nullable(field(version, 'seoTitle')),
      seoDescription: nullable(field(version, 'seoDescription')),
      featured, category, topics, tags, instruments, sources, disclosures, cover,
      activation: 'FOUNDATION_ONLY',
    } }
  } catch (error) {
    if (error instanceof SnapshotFault) return { ok: false, error: error.code }
    return { ok: false, error: 'INVALID_SNAPSHOT' }
  }
}
