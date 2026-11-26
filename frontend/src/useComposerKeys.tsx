import { type KeyboardEvent } from 'react'
import { preferenceBoolean } from './appShared'
import type { useApplicationKeys } from './useApplicationKeys'

export function useComposerKeys(app: ReturnType<typeof useApplicationKeys>) {
  const { applyEmojiSuggestion, applyMention, composeDraftStore, emojiActiveIndex, emojiOptions, mentionActiveIndex, mentionOptions, mentionStart, preferences, setEmojiActiveIndex, setEmojiMatch, setMentionActiveIndex, setMentionStart, snippetExpander, timelineRef } = app

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const snippetHandled = snippetExpander.handleKeyDown(
      event,
      !(mentionStart >= 0 && mentionOptions.length > 0) && emojiOptions.length === 0,
    )
    if (snippetHandled) return
    if (event.key === 'ArrowUp' && !composeDraftStore.getText() && preferenceBoolean(preferences, 'composer.arrow_up_focus_timeline')) {
      event.preventDefault()
      timelineRef.current?.focus()
      return
    }
    if (mentionStart >= 0 && mentionOptions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setMentionActiveIndex((index) => (index + 1) % mentionOptions.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setMentionActiveIndex((index) => (index - 1 + mentionOptions.length) % mentionOptions.length)
        return
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        event.preventDefault()
        applyMention(mentionOptions[mentionActiveIndex] ?? mentionOptions[0])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setMentionStart(-1)
        return
      }
    }
    if (emojiOptions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setEmojiActiveIndex((index) => (index + 1) % emojiOptions.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setEmojiActiveIndex((index) => (index - 1 + emojiOptions.length) % emojiOptions.length)
        return
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        event.preventDefault()
        applyEmojiSuggestion((emojiOptions[emojiActiveIndex] ?? emojiOptions[0])[1])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setEmojiMatch(null)
        return
      }
    }
    const ctrlEnter = preferenceBoolean(preferences, 'composer.ctrl_enter')
    if (event.key === 'Enter' && !event.shiftKey && (!ctrlEnter || event.ctrlKey)) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }
  return { ...app, handleComposerKeyDown }
}
