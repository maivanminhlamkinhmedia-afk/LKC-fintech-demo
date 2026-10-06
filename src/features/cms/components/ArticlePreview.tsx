import Link from 'next/link'
import type { ArticlePreviewData, PreviewTerm } from '../article-preview'
import { PREVIEW_STATUS_LABELS, PREVIEW_TYPE_LABELS, previewDate } from '../article-preview'
import { SOURCE_TYPE_LABELS } from '../article-sources'
import { PreviewCover } from './PreviewCover'
import { PreviewRichText } from './PreviewRichText'

function Terms({ title, terms }: { title: string; terms: PreviewTerm[] }) {
  return <div><h3 className="font-semibold">{title}</h3>
    {terms.length ? <ul className="mt-2 flex flex-wrap gap-2">{terms.map((item, index) =>
      <li key={index} className="rounded-full bg-slate-100 px-3 py-1 text-sm">{item.name}{item.isActive === false ? ' · Ngừng sử dụng' : ''}</li>)}</ul>
      : <p className="mt-1 text-sm text-slate-500">Chưa có</p>}
  </div>
}

export function ArticlePreview({ article }: { article: ArticlePreviewData }) {
  return <div className="mx-auto min-w-0 max-w-5xl space-y-7 [overflow-wrap:anywhere]">
    <nav aria-label="Điều hướng xem trước" className="flex flex-wrap gap-4 text-sm">
      <Link href="/creator/articles" className="font-medium text-emerald-800 underline">Danh sách bài viết</Link>
    </nav>
    <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 font-semibold text-amber-950">Bản xem trước nội bộ — nội dung đã lưu</p>
    <header className="space-y-3">
      <p className="text-sm font-semibold text-emerald-800">{PREVIEW_TYPE_LABELS[article.articleType]} · {PREVIEW_STATUS_LABELS[article.status]}</p>
      <h1 className="text-3xl font-bold leading-tight md:text-4xl">{article.title}</h1>
      {article.excerpt && <p className="text-lg text-slate-700">{article.excerpt}</p>}
      <p className="text-sm text-slate-600">{article.author ? <>{article.author.displayName}{article.author.jobTitle ? ` · ${article.author.jobTitle}` : ''}</> : 'Tác giả chưa có hồ sơ công khai'}</p>
      <p className="text-sm text-slate-600">Bản lưu cập nhật: <time dateTime={article.updatedAt}>{previewDate(article.updatedAt)}</time></p>
    </header>
    {article.cover ? <PreviewCover {...article.cover} /> : <p className="rounded-xl bg-slate-100 p-5 text-slate-600">Bài viết chưa có ảnh bìa khả dụng.</p>}
    <article aria-label="Nội dung bài viết đã lưu" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 md:p-8">
      <PreviewRichText document={article.contentJson} />
    </article>
    <section aria-labelledby="preview-classification" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 md:p-8">
      <h2 id="preview-classification" className="mb-5 text-xl font-bold">Phân loại</h2>
      <div className="grid gap-5 sm:grid-cols-2"><Terms title="Danh mục" terms={article.category ? [article.category] : []} />
        <Terms title="Chủ đề" terms={article.topics} /><Terms title="Thẻ" terms={article.tags} />
        <div><h3 className="font-semibold">Công cụ tài chính</h3>
          {article.instruments.length ? <ul className="mt-2 flex flex-wrap gap-2">{article.instruments.map((item, index) =>
            <li key={index} className="rounded-full bg-slate-100 px-3 py-1 text-sm">{item.name} ({item.symbol}){item.isPrimary ? ' · Chính' : ''}{item.isActive === false ? ' · Ngừng sử dụng' : ''}</li>)}</ul>
            : <p className="mt-1 text-sm text-slate-500">Chưa có</p>}
        </div>
      </div>
    </section>
    <section aria-labelledby="preview-sources" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 md:p-8">
      <h2 id="preview-sources" className="mb-5 text-xl font-bold">Nguồn tham khảo</h2>
      {article.sources.length ? <ol className="space-y-4">{article.sources.map((source, index) => <li key={index} className="min-w-0 border-b border-slate-100 pb-4 last:border-0">
        <p className="font-semibold">{source.safeUrl ? <a href={source.safeUrl} target="_blank" rel="noopener noreferrer nofollow"
          referrerPolicy="no-referrer" className="text-emerald-800 underline focus-visible:outline-2 focus-visible:outline-emerald-600">{source.title}</a> : source.title}</p>
        <p className="text-sm text-slate-600">{SOURCE_TYPE_LABELS[source.sourceType]}{source.publisher ? ` · ${source.publisher}` : ''}</p>
        {!source.safeUrl && <p className="text-xs text-slate-500">Không có liên kết an toàn để mở.</p>}
        <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-600">
          {source.publishedAt && <span>Xuất bản: <time dateTime={source.publishedAt}>{previewDate(source.publishedAt)}</time></span>}
          {source.accessedAt && <span>Truy cập: <time dateTime={source.accessedAt}>{previewDate(source.accessedAt)}</time></span>}
          {source.dataTimestamp && <span>Dữ liệu: <time dateTime={source.dataTimestamp}>{previewDate(source.dataTimestamp)}</time></span>}
        </div>
      </li>)}</ol> : <p className="text-slate-500">Chưa có nguồn tham khảo.</p>}
    </section>
  </div>
}
