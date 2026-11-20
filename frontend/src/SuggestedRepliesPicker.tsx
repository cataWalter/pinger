import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Sparkles, X } from 'lucide-react'
import { MAX_CHAT_GOAL_LENGTH } from './aiPrompts'
import { isApplePlatform } from './dom'

export type SuggestedReplyOption = {
  tone: string
  text: string
  translation: string
}

export type SuggestedRepliesState = {
  roomId: string
  requestId: string
  status: 'loading' | 'ready' | 'error'
  language: string
  inferredGoal: string
  suggestions: SuggestedReplyOption[]
  error: string
}

type SuggestedRepliesPickerProps = {
  state: SuggestedRepliesState
  hasDraft: boolean
  explanationLanguage: string
  chatGoal: string
  onSaveChatGoal: (goal: string) => Promise<boolean>
  onUse: (text: string) => void
  onRegenerate: () => void
  onClose: () => void
}

const skeletonRows = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

// isEditableTarget reports whether a key press belongs to a text field, so typing a digit there never chooses a reply.
function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

// replyIndexForPress maps a digit press to a reply index: 1–9 pick the first nine replies and 0 picks the tenth.
// ⌘/Ctrl + Option presses read event.code because Option changes event.key on macOS (Option+1 types "¡").
// AltGr arrives as Ctrl+Alt on Windows, so it is ignored to keep typing characters on those layouts.
function replyIndexForPress(event: KeyboardEvent) {
  let digit: number
  if (event.metaKey || event.ctrlKey) {
    const match = /^Digit([0-9])$/.exec(event.code)
    if (!event.altKey || !match || event.getModifierState('AltGraph')) return -1
    digit = Number(match[1])
  } else {
    if (event.altKey || !/^[0-9]$/.test(event.key) || isEditableTarget(event.target)) return -1
    digit = Number(event.key)
  }
  return digit === 0 ? 9 : digit - 1
}

// replyShortcut returns the badge text and aria-keyshortcuts value for a reply index, matching replyIndexForPress.
function replyShortcut(index: number) {
  const digit = index === 9 ? '0' : String(index + 1)
  return isApplePlatform()
    ? { label: `⌘⌥${digit}`, keys: `Meta+Alt+${digit}` }
    : { label: `Ctrl+Alt+${digit}`, keys: `Control+Alt+${digit}` }
}

// SuggestedRepliesPicker lists AI reply options above the composer. Choosing one fills the draft and never sends it.
export function SuggestedRepliesPicker({ state, hasDraft, explanationLanguage, chatGoal, onSaveChatGoal, onUse, onRegenerate, onClose }: SuggestedRepliesPickerProps) {
  const [pending, setPending] = useState<string | null>(null)
  const [editingGoal, setEditingGoal] = useState(false)
  const [goalDraft, setGoalDraft] = useState('')
  const [savingGoal, setSavingGoal] = useState(false)
  const [goalError, setGoalError] = useState('')
  const loading = state.status === 'loading'
  const ready = state.status === 'ready'
  const options = state.suggestions
  const showOptions = pending === null && options.length > 0 && state.status !== 'error'
  const goalLabel = !chatGoal && state.inferredGoal ? 'Inferred goal' : 'Goal'
  const goalText = chatGoal || state.inferredGoal || (loading ? 'Inferring from the chat…' : 'Not clear from the chat.')

  const choose = useCallback((text: string) => {
    if (hasDraft) {
      setPending(text)
      return
    }
    onUse(text)
  }, [hasDraft, onUse])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (editingGoal) {
          setEditingGoal(false)
          return
        }
        if (pending !== null) {
          setPending(null)
          return
        }
        onClose()
        return
      }
      if (!ready || pending !== null || editingGoal) return
      const index = replyIndexForPress(event)
      if (index >= 0 && index < options.length) {
        event.preventDefault()
        choose(options[index].text)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [editingGoal, pending, onClose, ready, options, choose])

  function regenerate() {
    setPending(null)
    setEditingGoal(false)
    onRegenerate()
  }

  function openGoalEditor() {
    // Prefill with the inferred goal, so accepting it takes one save.
    setGoalDraft(chatGoal || state.inferredGoal)
    setGoalError('')
    setEditingGoal(true)
  }

  // saveGoal regenerates after saving, so the new options already use the goal.
  async function saveGoal() {
    setSavingGoal(true)
    setGoalError('')
    const saved = await onSaveChatGoal(goalDraft.trim())
    setSavingGoal(false)
    if (!saved) {
      setGoalError('Could not save the chat goal.')
      return
    }
    setEditingGoal(false)
    onRegenerate()
  }

  return (
    <section className="suggested-replies" role="group" aria-label="Suggested replies">
      <div className="suggested-replies-header">
        <span className="suggested-replies-title"><Sparkles size={13} /><span>Suggested replies</span></span>
        <div className="suggested-replies-header-actions">
          <button type="button" className="icon-button" aria-label="Regenerate suggested replies" title="Regenerate" disabled={loading || savingGoal} onClick={regenerate}><RefreshCw size={14} /></button>
          <button type="button" className="icon-button" aria-label="Close suggested replies" onClick={onClose}><X size={14} /></button>
        </div>
      </div>
      <div className="suggested-replies-goal">
        <p className="suggested-replies-goal-text" title={goalText}>
          <span className="suggested-replies-goal-label">{goalLabel}</span>
          <span>{goalText}</span>
        </p>
        {!editingGoal && <button type="button" className="composer-assist-button" disabled={loading} onClick={openGoalEditor}>{chatGoal ? 'Edit goal' : 'Set goal'}</button>}
      </div>
      {!chatGoal && !editingGoal && <p className="suggested-replies-goal-hint">For the best replies, set the goal of this chat.</p>}
      {editingGoal && (
        <div className="suggested-replies-goal-editor">
          <textarea aria-label="Chat goal" maxLength={MAX_CHAT_GOAL_LENGTH} rows={2} spellCheck={false} placeholder="What should these replies help you achieve? Leave empty to clear." value={goalDraft} onChange={(event) => setGoalDraft(event.target.value)} />
          <div className="suggested-replies-actions">
            <button type="button" className="composer-assist-button" onClick={() => setEditingGoal(false)}>Cancel goal</button>
            <button type="button" className="composer-assist-button" disabled={savingGoal || goalDraft.trim() === chatGoal.trim()} onClick={() => void saveGoal()}>{savingGoal ? 'Saving…' : 'Save goal'}</button>
          </div>
          {goalError && <p className="suggested-replies-status" role="alert">{goalError}</p>}
        </div>
      )}
      {loading && (
        <div className="suggested-replies-body">
          <p className="suggested-replies-status" role="status">Reading the latest messages…</p>
          <button type="button" className="composer-assist-button" onClick={onClose}>Cancel</button>
        </div>
      )}
      {loading && options.length === 0 && (
        <ul className="suggested-replies-list suggested-replies-skeleton" aria-hidden="true">
          {skeletonRows.map((index) => (
            <li key={index}><span className="suggested-reply-skeleton-line" /></li>
          ))}
        </ul>
      )}
      {showOptions && (
        <ul className={loading ? 'suggested-replies-list is-stale' : 'suggested-replies-list'} aria-busy={loading}>
          {options.map((option, index) => {
            const shortcut = replyShortcut(index)
            return (
              <li key={`${index}-${option.tone}`}>
                <button type="button" className="suggested-reply-option" disabled={loading} aria-keyshortcuts={shortcut.keys} onClick={() => choose(option.text)}>
                  <span className="suggested-reply-tone">{option.tone}</span>
                  <span className="suggested-reply-content">
                    <span className="suggested-reply-text" lang={state.language || undefined}>{option.text}</span>
                    {option.translation && <span className="suggested-reply-translation" lang={explanationLanguage}>{option.translation}</span>}
                  </span>
                  <kbd className="suggested-reply-key" aria-hidden="true">{shortcut.label}</kbd>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {state.status === 'error' && (
        <div className="suggested-replies-body">
          <p className="suggested-replies-status" role="alert">{state.error}</p>
          <button type="button" className="composer-assist-button" onClick={regenerate}><RefreshCw size={12} /><span>Try again</span></button>
        </div>
      )}
      {ready && pending !== null && (
        <div className="suggested-replies-body">
          <p className="suggested-replies-status">Replace the current draft with this reply?</p>
          <div className="suggested-replies-actions">
            <button type="button" className="composer-assist-button" onClick={() => setPending(null)}>Keep draft</button>
            <button type="button" className="composer-assist-button" onClick={() => onUse(pending)}>Replace draft</button>
          </div>
        </div>
      )}
    </section>
  )
}
