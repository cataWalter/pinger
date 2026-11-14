import { useState } from 'react'
import EmojiPicker from 'emoji-picker-react'
import { Plus } from 'lucide-react'
import { type PreferenceValues } from './appTypes'
import { quickReactionOptions } from './preferences'
import { type ThemeMode } from './themes'

export function MessageReactionPicker({ preferences, colorScheme, onSendReaction }: {
  preferences: PreferenceValues
  colorScheme?: ThemeMode
  onSendReaction: (emoji: string) => void
}) {
  const [moreOpen, setMoreOpen] = useState(false)
  return (
    <div className="reaction-picker" aria-label="Quick reactions">
      {quickReactionOptions(preferences).map((emoji) => <button key={emoji} type="button" aria-label={`React with ${emoji}`} title={`React with ${emoji}`} onClick={() => onSendReaction(emoji)}>{emoji}</button>)}
      <button className="reaction-picker-more" type="button" aria-label="More reactions" title="More reactions" aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}>
        <Plus size={14} aria-hidden="true" />
      </button>
      {moreOpen && <div className="reaction-more-popover" role="dialog" aria-label="All reactions">
        <EmojiPicker
          className="reaction-emoji-picker"
          colorScheme={colorScheme}
          width="100%"
          height={360}
          autoFocusSearch
          previewConfig={{ showPreview: false }}
          onEmojiClick={(emojiData) => onSendReaction(emojiData.emoji)}
        />
      </div>}
    </div>
  )
}
