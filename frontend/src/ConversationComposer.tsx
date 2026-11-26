import { memo, useEffect, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Bold, Check, Clock3, Code, Paperclip, Pencil, Reply, Send, Smile, Type, X, Heading1, Italic, Link, List, ListOrdered, Mic, Quote, Square, SquareCode, Strikethrough, Video } from 'lucide-react'
import { LazyEmojiPicker } from './LazyEmojiPicker'
import { parseCustomEmoticonReplacements, replaceEmoticonsAtCursor, type ComposerFormat } from './composerText'
import { useComposeText } from './composerDraftStore'
import { themeModeForPreference } from './themes'
import { SnippetPopover } from './SnippetPopover'
import { SuggestedRepliesPicker } from './SuggestedRepliesPicker'
import { formatAudioTime } from './VoiceMessagePlayer'
import { initials, preferenceBoolean, preferenceString, IconTooltip, primaryShiftShortcutHint } from './appShared'
import { useComposer } from './AppDomainContexts'

const formattingTools: { action: ComposerFormat; labelKey: string; captionKey: string; icon: ReactNode }[] = [
  { action: 'bold', labelKey: 'composer.bold', captionKey: 'composer.bold', icon: <Bold size={15} /> },
  { action: 'italic', labelKey: 'composer.italic', captionKey: 'composer.italic', icon: <Italic size={15} /> },
  { action: 'strikethrough', labelKey: 'composer.strikethrough', captionKey: 'composer.strikeCaption', icon: <Strikethrough size={15} /> },
  { action: 'inlineCode', labelKey: 'composer.inlineCode', captionKey: 'composer.codeCaption', icon: <Code size={15} /> },
  { action: 'link', labelKey: 'composer.insertLink', captionKey: 'composer.linkCaption', icon: <Link size={15} /> },
  { action: 'heading', labelKey: 'composer.heading', captionKey: 'composer.heading', icon: <Heading1 size={15} /> },
  { action: 'bulletList', labelKey: 'composer.bulletedList', captionKey: 'composer.bulletedCaption', icon: <List size={15} /> },
  { action: 'numberedList', labelKey: 'composer.numberedList', captionKey: 'composer.numberedCaption', icon: <ListOrdered size={15} /> },
  { action: 'quote', labelKey: 'composer.quote', captionKey: 'composer.quote', icon: <Quote size={15} /> },
  { action: 'codeBlock', labelKey: 'composer.codeBlock', captionKey: 'composer.blockCaption', icon: <SquareCode size={15} /> },
]

export const ConversationComposer = memo(function ConversationComposer() {
  const { t } = useTranslation()
  const { applyEmojiSuggestion, applyFormatting, applyMention, attachmentInputRef, busy, cancelSuggestedReplies, captureNoun, chatTutorLanguage, composeDraftStore, composeTextRef, composerAIItems, composerContextMessage, composerEmojiControlRef, composerInputRef, editTarget, emojiActiveIndex, emojiOptions, emojiPickerOpen, focusTimelineMessage, handleAttachmentInput, handleComposerKeyDown, handleComposerPaste, imageRunHere, imageRunStatus, improveRestore, insertPickedEmoji, mentionActiveIndex, mentionOptions, openScheduleMessage, preferencesRef, removeStagedAttachment, replyTarget, restoreImprovedDraft, roomChatGoal, roomDrafts, saveChatGoal, selectedRoom, selectedRoomID, sendableStagedAttachments, setComposeDraft, setComposeText, setEditTarget, setEmojiActiveIndex, setMentionActiveIndex, setMentionBindings, setMentionStart, setReplyTarget, snippetExpander, snippetMatch, snippetMenuVisible, snippetOptions, stagedRoomAttachments, startRecording, stopImageGeneration, stopRecording, submitMessage, suggestRepliesForRoom, suggestedReplies, summaryStatus, systemPrefersDark, themePreference, toggleComposerEmojiPicker, updateEmojiQuery, updateMentionQuery, useSuggestedReply, videoPreviewRef, videoRecordingActive, voiceCaptureStatus, voiceRecordingActive } = useComposer()
  const composeText = useComposeText(composeDraftStore)
  useLayoutEffect(() => {
    snippetExpander.flushCaret(composeText)
  }, [composeText, snippetExpander])
  const [formattingOpen, setFormattingOpen] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const emojiMenuRef = useRef<HTMLDivElement>(null)
  const mentionMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (voiceCaptureStatus !== 'recording') {
      setRecordingSeconds(0)
      return
    }
    setRecordingSeconds(0)
    const timer = window.setInterval(() => setRecordingSeconds((current) => current + 1), 1000)
    return () => window.clearInterval(timer)
  }, [voiceCaptureStatus])

  useEffect(() => {
    const active = emojiMenuRef.current?.querySelector<HTMLElement>('.mention-option.is-active')
    if (active && typeof active.scrollIntoView === 'function') active.scrollIntoView({ block: 'nearest' })
  }, [emojiActiveIndex, emojiOptions.length])

  useEffect(() => {
    const active = mentionMenuRef.current?.querySelector<HTMLElement>('.mention-option.is-active')
    if (active && typeof active.scrollIntoView === 'function') active.scrollIntoView({ block: 'nearest' })
  }, [mentionActiveIndex, mentionOptions.length])

  return (
    <form className="composer" onSubmit={submitMessage}>
      <input ref={attachmentInputRef} className="visually-hidden" type="file" aria-hidden="true" tabIndex={-1} onChange={handleAttachmentInput} />
      {emojiOptions.length > 0 && <div ref={emojiMenuRef} className="mention-menu emoji-menu" role="listbox" aria-label={t('composer.emojiSuggestions')}>
        {emojiOptions.map(([name, emoji], index) => <button key={name} className={`mention-option ${index === emojiActiveIndex ? 'is-active' : ''}`} type="button" role="option" aria-selected={index === emojiActiveIndex} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setEmojiActiveIndex(index)} onClick={() => applyEmojiSuggestion(emoji)}><span aria-hidden="true">{emoji}</span> :{name}:</button>)}
      </div>}
      {mentionOptions.length > 0 && <div ref={mentionMenuRef} className="mention-menu" role="listbox" aria-label={t('composer.mentionSomeone')}>
        {mentionOptions.map((member, index) => <button key={member.id} className={`mention-option ${index === mentionActiveIndex ? 'is-active' : ''}`} type="button" role="option" aria-selected={index === mentionActiveIndex} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setMentionActiveIndex(index)} onClick={() => applyMention(member)}>
          <span className="room-member-avatar">{initials(member.displayName || member.id)}</span><span><strong>{member.displayName || member.id}</strong><small>{member.id}</small></span>
        </button>)}
      </div>}
      {composerContextMessage && <div className={`composer-context ${editTarget ? 'is-editing' : 'is-replying'}`}>
        <span className="composer-context-icon" aria-hidden="true">{editTarget ? <Pencil size={15} /> : <Reply size={15} />}</span>
        <div className="composer-context-copy">
          <strong>{editTarget ? t('composer.editingMessage') : t('composer.replyingTo', { sender: replyTarget?.senderName || replyTarget?.sender })}</strong>
          <span title={composerContextMessage.body}>{composerContextMessage.body}</span>
        </div>
        <button className="composer-context-link" type="button" title={t('composer.viewInTimeline')} onClick={() => focusTimelineMessage(composerContextMessage.id)}>{t('composer.viewMessage')}</button>
        <button type="button" className="icon-button" aria-label={t('composer.cancelReplyOrEdit')} title={t('common.cancel')} onClick={() => {
          const nextDraft = editTarget ? roomDrafts.get(selectedRoomID) ?? '' : ''
          if (!editTarget) roomDrafts.delete(selectedRoomID)
          setReplyTarget(null)
          setEditTarget(null)
          setComposeText(nextDraft)
          setMentionBindings([])
          setMentionStart(-1)
        }}><X size={14} /></button>
      </div>}
      {stagedRoomAttachments.length > 0 && <ul className="composer-staged-attachments" aria-label={t('composer.attachmentsToSend')}>
        {stagedRoomAttachments.map((item) => (
          <li key={item.id} className={item.previewURL ? 'is-image' : 'is-file'}>
            {item.previewURL ? <img src={item.previewURL} alt={t('composer.imagePreviewAlt')} /> : <><Paperclip size={14} /><span>{item.file.name || t('composer.attachmentFallback')}</span></>}
            <button className="icon-button attachment-remove" type="button" aria-label={t('composer.removeAttachmentNamed', { name: item.file.name || t('composer.attachmentFallback').toLowerCase() })} title={t('composer.removeAttachment')} disabled={busy} onClick={() => removeStagedAttachment(item)}><X size={14} /></button>
          </li>
        ))}
      </ul>}
      <div className="composer-input-wrap">
        <textarea
          ref={composerInputRef}
          value={composeText}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          onChange={(event) => {
            const rawValue = event.currentTarget.value
            const rawCursor = event.currentTarget.selectionStart
            const customReplacements = parseCustomEmoticonReplacements(preferenceString(preferencesRef.current, 'emoji.emoticon_replacements', ''))
            const converted = preferenceBoolean(preferencesRef.current, 'emoji.replace_emoticons', true)
              ? replaceEmoticonsAtCursor(rawValue, rawCursor, customReplacements)
              : { text: rawValue, cursor: rawCursor }
            const value = converted.text
            if (value !== rawValue) {
              requestAnimationFrame(() => {
                // Skip the restore when the user has typed again, so a stale cursor cannot move the caret back.
                if (composeTextRef.current === value && document.activeElement === composerInputRef.current) composerInputRef.current?.setSelectionRange(converted.cursor, converted.cursor)
              })
            }
            setComposeDraft(value)
            setMentionBindings((current) => current.every(({ token }) => value.includes(token))
              ? current
              : current.filter(({ token }) => value.includes(token)))
            updateMentionQuery(value, converted.cursor)
            updateEmojiQuery(value, converted.cursor)
            snippetExpander.handleChange(value, converted.cursor)
          }}
          onKeyDown={handleComposerKeyDown}
          onClick={(event) => {
            snippetExpander.handleClick(event.currentTarget.value, event.currentTarget.selectionStart)
          }}
          onKeyUp={(event) => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
              snippetExpander.handleKeyUp(event.currentTarget.value, event.currentTarget.selectionStart)
            }
          }}
          onPaste={handleComposerPaste}
          placeholder={selectedRoom ? t('composer.messageRoomPlaceholder', { room: selectedRoom.name || selectedRoom.id }) : t('composer.selectRoomPlaceholder')}
          aria-label={t('composer.messageLabel')}
          aria-controls={snippetMenuVisible ? 'snippet-suggestions' : undefined}
          aria-activedescendant={snippetMenuVisible ? `snippet-option-${snippetExpander.activeIndex}` : undefined}
          disabled={!selectedRoom || busy || voiceCaptureStatus !== null}
          rows={1}
        />
        {snippetMenuVisible && snippetMatch && <SnippetPopover
          inputRef={composerInputRef}
          value={composeText}
          caret={snippetExpander.caret}
          snippets={snippetOptions}
          activeIndex={snippetExpander.activeIndex}
          onActiveIndexChange={snippetExpander.setActiveIndex}
          onSelect={snippetExpander.select}
        />}
      </div>
      {videoRecordingActive && <div className="video-capture-preview"><video ref={videoPreviewRef} muted playsInline autoPlay aria-label={t('composer.cameraPreview')} /></div>}
      {formattingOpen && <div
        id="composer-formatting-toolbar"
        className="composer-formatting-bar"
        role="toolbar"
        aria-label={t('composer.formatting')}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            setFormattingOpen(false)
            composerInputRef.current?.focus()
          }
        }}
      >
        {formattingTools.map((tool) => <ComposerToolButton key={tool.action} caption={t(tool.captionKey)} icon={tool.icon} aria-label={t(tool.labelKey)} title={t(tool.labelKey)} disabled={!selectedRoom || busy} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormatting(tool.action)} />)}
      </div>}
      <div className="composer-footer">
        <div className="composer-toolbar-row composer-toolbar-row-compose">
          <div className="composer-tool-group composer-tool-group-message" role="group" aria-label={t('composer.messageTools')}>
            <div className="composer-tool-cluster composer-tool-cluster--format">
              <ComposerToolButton
                caption={t('composer.formatCaption')}
                icon={<Type size={15} />}
                aria-label={t('composer.formatting')}
                aria-expanded={formattingOpen}
                aria-pressed={formattingOpen}
                aria-controls="composer-formatting-toolbar"
                title={t('composer.formattingTools')}
                className={formattingOpen ? 'is-active' : undefined}
                disabled={!selectedRoom || busy}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setFormattingOpen((open) => !open)}
              />
            </div>
            <div className="composer-tool-cluster composer-tool-cluster--attach" role="group" aria-label={t('composer.addContent')}>
              <ComposerToolButton caption={t('composer.attachCaption')} icon={<Paperclip size={15} />} aria-label={t('composer.attachFile')} title={t('composer.attachFileTitle')} disabled={!selectedRoom || busy || voiceCaptureStatus !== null} onClick={() => attachmentInputRef.current?.click()} />
              <div className="composer-emoji-control" ref={composerEmojiControlRef}>
                <ComposerToolButton caption={t('composer.emojiCaption')} icon={<Smile size={15} />} aria-label={t('composer.emojiPicker')} aria-haspopup="dialog" aria-expanded={emojiPickerOpen} title={t('composer.insertEmoji')} disabled={!selectedRoom || busy || voiceCaptureStatus !== null} onMouseDown={(event) => event.preventDefault()} onClick={toggleComposerEmojiPicker} />
                {emojiPickerOpen && <div className="composer-emoji-popover" role="dialog" aria-label={t('composer.chooseEmoji')}>
                  <LazyEmojiPicker
                    className="composer-emoji-picker-widget"
                    colorScheme={themeModeForPreference(themePreference, systemPrefersDark)}
                    width="100%"
                    height={360}
                    autoFocusSearch
                    previewConfig={{ showPreview: false }}
                    onEmojiClick={(emojiData) => insertPickedEmoji(emojiData.emoji)}
                  />
                </div>}
              </div>
            </div>
            <div className="composer-tool-cluster composer-tool-cluster--delivery" role="group" aria-label={t('composer.delivery')}>
              <ComposerToolButton caption={voiceRecordingActive ? t('composer.stopCaption') : t('composer.voiceCaption')} icon={voiceRecordingActive ? <Square size={15} /> : <Mic size={15} />} aria-label={voiceRecordingActive ? t('composer.stopVoiceNote') : t('composer.recordVoiceNote')} aria-pressed={voiceRecordingActive} className={voiceRecordingActive ? 'is-recording' : undefined} title={voiceRecordingActive ? t('composer.stopVoiceNote') : t('composer.recordVoiceNoteTitle')} disabled={!selectedRoom || busy || voiceCaptureStatus === 'processing' || videoRecordingActive} onClick={() => voiceRecordingActive ? stopRecording() : void startRecording('voice')} />
              {videoRecordingActive
                ? <ComposerToolButton caption={t('composer.stopCaption')} icon={<Square size={15} />} aria-label={t('composer.stopVideoMessage')} title={t('composer.stopVideoMessage')} className="is-recording" onClick={stopRecording} />
                : <ComposerToolButton caption={t('composer.videoCaption')} icon={<Video size={15} />} aria-label={t('composer.recordVideoMessage')} title={t('composer.recordVideoMessageTitle')} disabled={!selectedRoom || busy || voiceCaptureStatus !== null} onClick={() => void startRecording('video')} />}
              <ComposerToolButton caption={t('composer.scheduleCaption')} icon={<Clock3 size={15} />} aria-label={replyTarget ? t('composer.scheduleReply') : t('composer.scheduleMessage')} title={t('composer.scheduleTitle')} disabled={!selectedRoom || busy || voiceCaptureStatus !== null || !composeText.trim() || Boolean(editTarget)} onClick={() => openScheduleMessage()} />
            </div>
            <div className="composer-tool-cluster composer-ai-cluster composer-tool-cluster--ai" role="group" aria-label={t('composer.aiTools')}>
              {composerAIItems(composeText).map((item) => <ComposerToolButton key={item.label} caption={item.caption ?? item.label} icon={item.icon} shortcut={item.primaryShiftKey ? primaryShiftShortcutHint(item.primaryShiftKey) : undefined} aria-label={item.label} aria-keyshortcuts={item.primaryShiftKey ? `Control+Shift+${item.primaryShiftKey} Meta+Shift+${item.primaryShiftKey}` : undefined} title={item.title ?? item.label} disabled={item.disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => item.onSelect()} />)}
              {imageRunHere && <ComposerToolButton caption={t('composer.stopCaption')} icon={<Square size={15} />} aria-label={t('composer.stopImageGeneration')} title={t('composer.stopImageGeneration')} className="is-recording" onClick={stopImageGeneration} />}
            </div>
          </div>
        </div>
        {improveRestore && improveRestore.roomId === selectedRoomID && composeText === improveRestore.applied && (
          <div className="composer-restore-draft" role="status">
            <span>{t('composer.draftImproved')}</span>
            <button type="button" className="composer-assist-button" onClick={restoreImprovedDraft}>{t('composer.restoreOriginalDraft')}</button>
          </div>
        )}
        {suggestedReplies && suggestedReplies.roomId === selectedRoomID && (
          <SuggestedRepliesPicker state={suggestedReplies} hasDraft={composeText.trim() !== ''} explanationLanguage={chatTutorLanguage} chatGoal={roomChatGoal} onSaveChatGoal={saveChatGoal} onUse={useSuggestedReply} onRegenerate={() => void suggestRepliesForRoom(suggestedReplies.roomId)} onClose={cancelSuggestedReplies} />
        )}
        {(voiceCaptureStatus !== null || busy || imageRunHere || summaryStatus) && (
          <span className={`composer-operation-status${voiceCaptureStatus === 'recording' ? ' is-recording' : ''}`} role="status">
            {voiceCaptureStatus === 'recording'
              ? <><span className="recording-live-dot" aria-hidden="true" />{t('composer.recordingMedia', { kind: captureNoun })} · {formatAudioTime(recordingSeconds)}</>
              : voiceCaptureStatus === 'processing'
                ? t('composer.preparingMedia', { kind: captureNoun })
                : imageRunHere
                  ? imageRunStatus
                  : summaryStatus || t('composer.sending')}
          </span>
        )}
        <IconTooltip label={editTarget ? t('composer.saveEdit') : t('composer.sendMessage')} className="send-tooltip">
          <button className="send-button" type="submit" aria-label={editTarget ? t('composer.saveEdit') : t('composer.sendMessage')} disabled={!selectedRoom || (!composeText.trim() && sendableStagedAttachments.length === 0) || busy || voiceCaptureStatus !== null}>
            {editTarget ? <Check size={17} /> : <Send size={17} />}
          </button>
        </IconTooltip>
      </div>
    </form>
  )
})

function ComposerToolButton({ caption, icon, shortcut, className, ...buttonProps }: ComponentPropsWithoutRef<'button'> & { caption: string; icon: ReactNode; shortcut?: string }) {
  return (
    <button className={className ? `composer-tool-button ${className}` : 'composer-tool-button'} type="button" {...buttonProps}>
      {icon}
      <span className="composer-tool-caption">{caption}</span>
      {shortcut && <kbd aria-hidden="true">{shortcut}</kbd>}
    </button>
  )
}
