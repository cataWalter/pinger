import { lazy, Suspense, type ComponentProps } from 'react'
import type EmojiPickerType from 'emoji-picker-react'

const EmojiPicker = lazy(() => import('emoji-picker-react'))

export function LazyEmojiPicker(props: ComponentProps<typeof EmojiPickerType>) {
  return (
    <Suspense fallback={<div className="emoji-picker-loading" role="status"><span className="loading-mark" />Loading emojis…</div>}>
      <EmojiPicker {...props} />
    </Suspense>
  )
}
