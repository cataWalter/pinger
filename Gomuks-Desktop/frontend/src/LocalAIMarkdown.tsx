import { lazy, Suspense } from 'react'

const MarkdownMessage = lazy(() => import('./MarkdownMessage'))

export default function LocalAIMarkdown({ body }: { body: string }) {
  return (
    <Suspense fallback={<div className="message-body markdown-message">{body}</div>}>
      <MarkdownMessage body={body} />
    </Suspense>
  )
}
