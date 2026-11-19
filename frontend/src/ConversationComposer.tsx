import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { Bold, Check, Clock3, Code, Paperclip, Pencil, Reply, Send, Smile, X, Heading1, Italic, Link, List, ListOrdered, Mic, Quote, Square, SquareCode, Strikethrough, Video } from 'lucide-react'
import EmojiPicker from 'emoji-picker-react'
import { parseCustomEmoticonReplacements, replaceEmoticonsAtCursor, type ComposerFormat } from './composerText'
import { themeModeForPreference } from './themes'
import { SnippetPopover } from './SnippetPopover'
import { SuggestedRepliesPicker } from './SuggestedRepliesPicker'
import { initials, preferenceBoolean, preferenceString, IconTooltip, primaryShiftShortcutHint } from './appShared'
import type { AppState } from './appState'

const formattingTools: { action: ComposerFormat; label: string; caption: string; icon: ReactNode }[] = [
  { action: 'bold', label: 'Bold', caption: 'Bold', icon: <Bold size={15} /> },
  { action: 'italic', label: 'Italic', caption: 'Italic', icon: <Italic size={15} /> },
  { action: 'strikethrough', label: 'Strikethrough', caption: 'Strike', icon: <Strikethrough size={15} /> },
  { action: 'inlineCode', label: 'Inline code', caption: 'Code', icon: <Code size={15} /> },
  { action: 'link', label: 'Insert link', caption: 'Link', icon: <Link size={15} /> },
  { action: 'heading', label: 'Heading', caption: 'Heading', icon: <Heading1 size={15} /> },
  { action: 'bulletList', label: 'Bulleted list', caption: 'Bulleted', icon: <List size={15} /> },
  { action: 'numberedList', label: 'Numbered list', caption: 'Numbered', icon: <ListOrdered size={15} /> },
  { action: 'quote', label: 'Quote', caption: 'Quote', icon: <Quote size={15} /> },
  { action: 'codeBlock', label: 'Code block', caption: 'Block', icon: <SquareCode size={15} /> },
]

export function ConversationComposer({ app }: { app: AppState }) {
  const { applyEmojiSuggestion, applyFormatting, applyMention, attachmentInputRef, busy, cancelSuggestedReplies, captureNoun, chatTutorLanguage, composeText, composeTextRef, composerAIItems, composerContextMessage, composerEmojiControlRef, composerInputRef, editTarget, emojiActiveIndex, emojiOptions, emojiPickerOpen, focusTimelineMessage, handleAttachmentInput, handleComposerKeyDown, handleComposerPaste, imageRunHere, imageRunStatus, insertPickedEmoji, mentionActiveIndex, mentionOptions, openScheduleMessage, preferencesRef, removeStagedAttachment, replyTarget, roomDrafts, selectedRoom, selectedRoomID, sendableStagedAttachments, setComposeDraft, setComposeText, setEditTarget, setEmojiActiveIndex, setMentionActiveIndex, setMentionBindings, setMentionStart, setReplyTarget, snippetExpander, snippetMatch, snippetMenuVisible, snippetOptions, stagedRoomAttachments, startRecording, stopImageGeneration, stopRecording, submitMessage, suggestRepliesForRoom, suggestedReplies, summaryStatus, systemPrefersDark, themePreference, toggleComposerEmojiPicker, updateEmojiQuery, updateMentionQuery, useSuggestedReply, videoPreviewRef, videoRecordingActive, voiceCaptureStatus, voiceRecordingActive } = app
  return (
    <form className="composer" onSubmit={submitMessage}>
      <input ref={attachmentInputRef} className="visually-hidden" type="file" aria-hidden="true" tabIndex={-1} onChange={handleAttachmentInput} />
      {emojiOptions.length > 0 && <div className="mention-menu emoji-menu" role="listbox" aria-label="Emoji suggestions">
        {emojiOptions.map(([name, emoji], index) => <button key={name} className={`mention-option ${index === emojiActiveIndex ? 'is-active' : ''}`} type="button" role="option" aria-selected={index === emojiActiveIndex} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setEmojiActiveIndex(index)} onClick={() => applyEmojiSuggestion(emoji)}><span aria-hidden="true">{emoji}</span> :{name}:</button>)}
      </div>}
      {mentionOptions.length > 0 && <div className="mention-menu" role="listbox" aria-label="Mention someone">
        {mentionOptions.map((member, index) => <button key={member.id} className={`mention-option ${index === mentionActiveIndex ? 'is-active' : ''}`} type="button" role="option" aria-selected={index === mentionActiveIndex} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setMentionActiveIndex(index)} onClick={() => applyMention(member)}>
          <span className="room-member-avatar">{initials(member.displayName || member.id)}</span><span><strong>{member.displayName || member.id}</strong><small>{member.id}</small></span>
        </button>)}
      </div>}
      {composerContextMessage && <div className={`composer-context ${editTarget ? 'is-editing' : 'is-replying'}`}>
        <span className="composer-context-icon" aria-hidden="true">{editTarget ? <Pencil size={15} /> : <Reply size={15} />}</span>
        <div className="composer-context-copy">
          <strong>{editTarget ? 'Editing message' : `Replying to ${replyTarget?.senderName || replyTarget?.sender}`}</strong>
          <span title={composerContextMessage.body}>{composerContextMessage.body}</span>
        </div>
        <button className="composer-context-link" type="button" title="View message in the timeline" onClick={() => focusTimelineMessage(composerContextMessage.id)}>View message</button>
        <button type="button" className="icon-button" aria-label="Cancel reply or edit" title="Cancel" onClick={() => {
          const nextDraft = editTarget ? roomDrafts.get(selectedRoomID) ?? '' : ''
          if (!editTarget) roomDrafts.delete(selectedRoomID)
          setReplyTarget(null)
          setEditTarget(null)
          setComposeText(nextDraft)
          setMentionBindings([])
          setMentionStart(-1)
        }}><X size={14} /></button>
      </div>}
      {stagedRoomAttachments.length > 0 && <ul className="composer-staged-attachments" aria-label="Attachments to send">
        {stagedRoomAttachments.map((item) => (
          <li key={item.id} className={item.previewURL ? 'is-image' : 'is-file'}>
            {item.previewURL ? <img src={item.previewURL} alt="Image attachment preview" /> : <><Paperclip size={14} /><span>{item.file.name || 'Attachment'}</span></>}
            <button className="icon-button attachment-remove" type="button" aria-label={`Remove ${item.file.name || 'attachment'}`} title="Remove attachment" disabled={busy} onClick={() => removeStagedAttachment(item)}><X size={14} /></button>
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
          placeholder={selectedRoom ? `Message ${selectedRoom.name || selectedRoom.id}` : 'Select a room to start'}
          aria-label="Message"
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
      {videoRecordingActive && <div className="video-capture-preview"><video ref={videoPreviewRef} muted playsInline autoPlay aria-label="Camera preview" /></div>}
      <div className="composer-footer">
        <div className="composer-toolbar-row composer-toolbar-row-compose">
          <div className="composer-tool-group composer-tool-group-message" role="group" aria-label="Message tools">
            <div className="composer-tool-cluster composer-tool-cluster--format" role="group" aria-label="Formatting">
              {formattingTools.map((tool) => <ComposerToolButton key={tool.action} caption={tool.caption} icon={tool.icon} aria-label={tool.label} title={tool.label} disabled={!selectedRoom || busy} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormatting(tool.action)} />)}
            </div>
            <div className="composer-tool-cluster composer-tool-cluster--attach" role="group" aria-label="Add content">
              <ComposerToolButton caption="Attach" icon={<Paperclip size={15} />} aria-label="Attach file" title="Attach a file" disabled={!selectedRoom || busy || voiceCaptureStatus !== null} onClick={() => attachmentInputRef.current?.click()} />
              <div className="composer-emoji-control" ref={composerEmojiControlRef}>
                <ComposerToolButton caption="Emoji" icon={<Smile size={15} />} aria-label="Emoji picker" aria-haspopup="dialog" aria-expanded={emojiPickerOpen} title="Insert an emoji" disabled={!selectedRoom || busy || voiceCaptureStatus !== null} onMouseDown={(event) => event.preventDefault()} onClick={toggleComposerEmojiPicker} />
                {emojiPickerOpen && <div className="composer-emoji-popover" role="dialog" aria-label="Choose an emoji">
                  <EmojiPicker
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
            <div className="composer-tool-cluster composer-tool-cluster--delivery" role="group" aria-label="Delivery">
              <ComposerToolButton caption={voiceRecordingActive ? 'Stop' : 'Voice'} icon={voiceRecordingActive ? <Square size={15} /> : <Mic size={15} />} aria-label={voiceRecordingActive ? 'Stop and send voice note' : 'Record voice note'} aria-pressed={voiceRecordingActive} className={voiceRecordingActive ? 'is-recording' : undefined} title={voiceRecordingActive ? 'Stop and send voice note' : 'Record a voice note'} disabled={!selectedRoom || busy || voiceCaptureStatus === 'processing' || videoRecordingActive} onClick={() => voiceRecordingActive ? stopRecording() : void startRecording('voice')} />
              {videoRecordingActive
                ? <ComposerToolButton caption="Stop" icon={<Square size={15} />} aria-label="Stop and send video message" title="Stop and send video message" className="is-recording" onClick={stopRecording} />
                : <ComposerToolButton caption="Video" icon={<Video size={15} />} aria-label="Record video message" title="Record a video message" disabled={!selectedRoom || busy || voiceCaptureStatus !== null} onClick={() => void startRecording('video')} />}
              <ComposerToolButton caption="Schedule" icon={<Clock3 size={15} />} aria-label={replyTarget ? 'Schedule reply' : 'Schedule message'} title="Schedule this message for later" disabled={!selectedRoom || busy || voiceCaptureStatus !== null || !composeText.trim() || Boolean(editTarget)} onClick={() => openScheduleMessage()} />
            </div>
            <div className="composer-tool-cluster composer-ai-cluster composer-tool-cluster--ai" role="group" aria-label="AI tools">
              {composerAIItems().map((item) => <ComposerToolButton key={item.label} caption={item.caption ?? item.label} icon={item.icon} shortcut={item.primaryShiftKey ? primaryShiftShortcutHint(item.primaryShiftKey) : undefined} aria-label={item.label} aria-keyshortcuts={item.primaryShiftKey ? `Control+Shift+${item.primaryShiftKey} Meta+Shift+${item.primaryShiftKey}` : undefined} title={item.title ?? item.label} disabled={item.disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => item.onSelect()} />)}
              {imageRunHere && <ComposerToolButton caption="Stop" icon={<Square size={15} />} aria-label="Stop image generation" title="Stop image generation" className="is-recording" onClick={stopImageGeneration} />}
            </div>
          </div>
        </div>
        {suggestedReplies && suggestedReplies.roomId === selectedRoomID && (
          <SuggestedRepliesPicker state={suggestedReplies} hasDraft={composeText.trim() !== ''} explanationLanguage={chatTutorLanguage} onUse={useSuggestedReply} onRegenerate={() => void suggestRepliesForRoom(suggestedReplies.roomId)} onClose={cancelSuggestedReplies} />
        )}
        {(voiceCaptureStatus !== null || busy || imageRunHere || summaryStatus) && <span className="composer-operation-status" role="status">{voiceCaptureStatus === 'recording' ? `Recording ${captureNoun}` : voiceCaptureStatus === 'processing' ? `Preparing ${captureNoun}…` : imageRunHere ? imageRunStatus : summaryStatus || 'Sending…'}</span>}
        <IconTooltip label={editTarget ? 'Save edit' : 'Send message'} className="send-tooltip">
          <button className="send-button" type="submit" aria-label={editTarget ? 'Save edit' : 'Send message'} disabled={!selectedRoom || (!composeText.trim() && sendableStagedAttachments.length === 0) || busy || voiceCaptureStatus !== null}>
            {editTarget ? <Check size={17} /> : <Send size={17} />}
          </button>
        </IconTooltip>
      </div>
    </form>
  )
}

function ComposerToolButton({ caption, icon, shortcut, className, ...buttonProps }: ComponentPropsWithoutRef<'button'> & { caption: string; icon: ReactNode; shortcut?: string }) {
  return (
    <button className={className ? `composer-tool-button ${className}` : 'composer-tool-button'} type="button" {...buttonProps}>
      {icon}
      <span className="composer-tool-caption">{caption}</span>
      {shortcut && <kbd aria-hidden="true">{shortcut}</kbd>}
    </button>
  )
}
