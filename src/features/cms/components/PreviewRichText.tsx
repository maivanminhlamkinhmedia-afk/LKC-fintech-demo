import type { JSONContent } from '@tiptap/core'
import type { ReactNode } from 'react'
import { isSafeEditorLink } from '../editor-schema'

function children(node: JSONContent): ReactNode {
  return node.content?.map((child, index) => <RichNode key={index} node={child} />)
}

function RichNode({ node }: { node: JSONContent }): ReactNode {
  if (node.type === 'text') {
    let result: ReactNode = node.text
    for (const mark of node.marks ?? []) {
      switch (mark.type) {
        case 'bold': result = <strong>{result}</strong>; break
        case 'italic': result = <em>{result}</em>; break
        case 'underline': result = <u>{result}</u>; break
        case 'strike': result = <s>{result}</s>; break
        case 'code': result = <code className="rounded bg-slate-100 px-1 font-mono">{result}</code>; break
        case 'link':
          // The stored document was strictly validated; check again before making an href.
          if (isSafeEditorLink(mark.attrs?.href)) result = <a href={mark.attrs.href} target="_blank"
            rel="noopener noreferrer nofollow" referrerPolicy="no-referrer"
            className="text-emerald-800 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-emerald-600">{result}</a>
          break
      }
    }
    return result
  }
  switch (node.type) {
    case 'doc': return <>{children(node)}</>
    case 'paragraph': return <p className="my-4 leading-8">{children(node)}</p>
    case 'heading': return node.attrs?.level === 2
      ? <h2 className="mb-3 mt-8 text-2xl font-bold">{children(node)}</h2>
      : <h3 className="mb-2 mt-6 text-xl font-semibold">{children(node)}</h3>
    case 'bulletList': return <ul className="my-4 list-disc space-y-1 pl-6">{children(node)}</ul>
    case 'orderedList': return <ol className="my-4 list-outside space-y-1 pl-6"
      start={node.attrs?.start ?? 1} type={node.attrs?.type ?? '1'}>{children(node)}</ol>
    case 'listItem': return <li className="pl-1">{children(node)}</li>
    case 'blockquote': return <blockquote className="my-5 border-l-4 border-emerald-600 pl-4 italic text-slate-700">{children(node)}</blockquote>
    case 'codeBlock': return <pre className="my-5 max-w-full overflow-x-auto rounded-xl bg-slate-900 p-4 text-sm leading-6 text-slate-100"><code className="font-mono whitespace-pre">{children(node)}</code></pre>
    case 'hardBreak': return <br />
    case 'horizontalRule': return <hr className="my-8 border-slate-300" />
    default: return null
  }
}

export function PreviewRichText({ document }: { document: JSONContent }) {
  const empty = !document.content?.some(node => node.type !== 'paragraph' || !!node.content?.length)
  return <div className="min-w-0 max-w-full [overflow-wrap:anywhere]">
    {empty ? <p className="text-slate-500">Bài viết chưa có nội dung đã lưu.</p> : <RichNode node={document} />}
  </div>
}
