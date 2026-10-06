import type { ArticleStatus, ArticleType, SourceType } from '@prisma/client'
import type { JSONContent } from '@tiptap/core'

export type PreviewTerm = { name: string; isActive: boolean | null }
export type PreviewInstrument = PreviewTerm & { symbol: string; isPrimary: boolean }
export type PreviewSource = {
  title: string; sourceType: SourceType; publisher: string | null; safeUrl: string | null
  publishedAt: string | null; accessedAt: string | null; dataTimestamp: string | null
}
export type ArticlePreviewData = {
  id: string; title: string; excerpt: string; articleType: ArticleType; status: ArticleStatus; updatedAt: string
  contentJson: JSONContent; author: { displayName: string; jobTitle: string | null } | null
  cover: { src: string; alt: string; caption: string | null } | null
  category: PreviewTerm | null; topics: PreviewTerm[]; tags: PreviewTerm[]; instruments: PreviewInstrument[]
  sources: PreviewSource[]
}
export type PreviewFailureCode = 'NOT_FOUND' | 'FORBIDDEN' | 'UNSUPPORTED_DOCUMENT' | 'INTERNAL_ERROR'
export type PreviewResult = { ok: true; data: ArticlePreviewData } | { ok: false; error: PreviewFailureCode }

export const PREVIEW_TYPE_LABELS: Record<ArticleType, string> = {
  NEWS: 'Tin tức', MARKET_UPDATE: 'Cập nhật thị trường', ANALYSIS: 'Phân tích',
  EDUCATION: 'Kiến thức', RESEARCH: 'Nghiên cứu', OPINION: 'Góc nhìn',
}
export const PREVIEW_STATUS_LABELS: Record<ArticleStatus, string> = {
  DRAFT: 'Bản nháp', SUBMITTED: 'Đã gửi duyệt', EDITORIAL_REVIEW: 'Đang biên tập',
  CHANGES_REQUESTED: 'Cần chỉnh sửa', FACT_CHECK: 'Đang kiểm chứng', APPROVED: 'Đã duyệt',
  SCHEDULED: 'Đã lên lịch', PUBLISHED: 'Đã xuất bản', CORRECTED: 'Đã đính chính', ARCHIVED: 'Đã lưu trữ',
}

export function previewDate(iso: string): string {
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}
