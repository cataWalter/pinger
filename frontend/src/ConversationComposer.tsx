import { Bold, ChevronDown, Check, Clock3, Code, Paperclip, Pencil, Reply, Send, Smile, X, Heading1, Italic, Link, List, ListOrdered, Mic, Quote, Square, SquareCode, Strikethrough, Video } from 'lucide-react'
import EmojiPicker from 'emoji-picker-react'
import { parseCustomEmoticonReplacements, replaceEmoticonsAtCursor } from './composerText'
import { themeModeForPreference } from './themes'
import { SnippetPopover } from './SnippetPopover'
import { ActionMenu } from './appShared'
import { SuggestedRepliesPicker } from './SuggestedRepliesPicker'
import { initials, preferenceBoolean, preferenceString, IconTooltip, primaryShiftShortcutHint } from './appShared'
import type { AppState } from './appState'

export function ConversationComposer({ app }: { app: AppState }) {
  const { activeAccountID, applyEmojiSuggestion, applyFormatting, applyMention, attachmentInputRef, busy, cancelSuggestedReplies, captureNoun, chatTutorLanguage, composeText, composeTextRef, composerAIItems, composerContextMessage, composerEmojiControlRef, composerInputRef, editTarget, emojiActiveIndex, emojiOptions, emojiPickerOpen, focusTimelineMessage, handleAttachmentInput, handleComposerKeyDown, handleComposerPaste, imageRunHere, imageRunStatus, insertPickedEmoji, mentionActiveIndex, mentionOptions, openScheduleMessage, preferences, preferencesRef, removeStagedAttachment, replyTarget, roomDrafts, selectedRoom, selectedRoomID, sendableStagedAttachments, setComposeDraft, setComposeText, setEditTarget, setEmojiActiveIndex, setMentionActiveIndex, setMentionBindings, setMentionStart, setPreference, setReplyTarget, snippetExpander, snippetMatch, snippetMenuVisible, snippetOptions, stagedRoomAttachments, startRecording, stopImageGeneration, stopRecording, submitMessage, suggestRepliesForRoom, suggestedReplies, summaryStatus, systemPrefersDark, themePreference, toggleComposerEmojiPicker, updateEmojiQuery, updateMentionQuery, useSuggestedReply, videoPreviewRef, videoRecordingActive, voiceCaptureStatus, voiceRecordingActive } = app
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
      {preferenceBoolean(preferences, 'composer.formatting_toolbar') && <div className="composer-format-toolbar" role="toolbar" aria-label="Formatting">
        <div className="composer-format-group" role="group" aria-label="Inline formatting">
          <IconTooltip label="Bold text"><button className="icon-button" type="button" aria-label="Bold" disabled={!selectedRoom || busy} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormatting('bold')}><Bold size={15} /></button></IconTooltip>
          <IconTooltip label="Italic text"><button className="icon-button" type="button" aria-label="Italic" disabled={!selectedRoom || busy} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormatting('italic')}><Italic size={15} /></button></IconTooltip>
          <IconTooltip label="Strikethrough text"><button className="icon-button" type="button" aria-label="Strikethrough" disabled={!selectedRoom || busy} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormatting('strikethrough')}><Strikethrough size={15} /></button></IconTooltip>
          <IconTooltip label="Inline code"><button className="icon-button" type="button" aria-label="Inline code" disabled={!selectedRoom || busy} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormatting('inlineCode')}><Code size={15} /></button></IconTooltip>
        </div>
        <div className="composer-format-group" role="group" aria-label="Link insertion">
          <IconTooltip label="Insert link"><button className="icon-button" type="button" aria-label="Insert link" disabled={!selectedRoom || busy} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormatting('link')}><Link size={15} /></button></IconTooltip>
        </div>
        <div className="composer-format-group" role="group" aria-label="Block formatting">
          <IconTooltip label="Format as heading"><button className="icon-button" type="button" aria-label="Heading" disabled={!selectedRoom || busy} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormatting('heading')}><Heading1 size={15} /></button></IconTooltip>
          <IconTooltip label="Start a bulleted list"><button className="icon-button" type="button" aria-label="Bulleted list" disabled={!selectedRoom || busy} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormatting('bulletList')}><List size={15} /></button></IconTooltip>
          <IconTooltip label="Start a numbered list"><button className="icon-button" type="button" aria-label="Numbered list" disabled={!selectedRoom || busy} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormatting('numberedList')}><ListOrdered size={15} /></button></IconTooltip>
          <IconTooltip label="Format as quote"><button className="icon-button" type="button" aria-label="Quote" disabled={!selectedRoom || busy} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormatting('quote')}><Quote size={15} /></button></IconTooltip>
          <IconTooltip label="Insert a code block"><button className="icon-button" type="button" aria-label="Code block" disabled={!selectedRoom || busy} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormatting('codeBlock')}><SquareCode size={15} /></button></IconTooltip>
        </div>
        <IconTooltip label="Hide formatting toolbar" className="composer-format-close"><button className="icon-button" type="button" aria-label="Hide formatting toolbar" onMouseDown={(event) => event.preventDefault()} onClick={() => void setPreference('composer.formatting_toolbar', false)}><X size={14} /></button></IconTooltip>
      </div>}
      <div className="composer-footer">
        <div className="composer-toolbar-row composer-toolbar-row-compose">
          <div className="composer-tool-group composer-tool-group-message" role="group" aria-label="Message tools">
            {!preferenceBoolean(preferences, 'composer.formatting_toolbar') && <ActionMenu key={`format:${activeAccountID}:${selectedRoomID}`} label="Formatting" icon={<Bold size={16} />} side="top" disabled={!selectedRoom || busy} items={[
              { label: 'Bold', icon: <Bold size={15} />, onSelect: () => applyFormatting('bold') },
              { label: 'Italic', icon: <Italic size={15} />, onSelect: () => applyFormatting('italic') },
              { label: 'Strikethrough', icon: <Strikethrough size={15} />, onSelect: () => applyFormatting('strikethrough') },
              { label: 'Inline code', icon: <Code size={15} />, onSelect: () => applyFormatting('inlineCode') },
              { label: 'Insert link', icon: <Link size={15} />, onSelect: () => applyFormatting('link') },
              { label: 'Heading', icon: <Heading1 size={15} />, onSelect: () => applyFormatting('heading') },
              { label: 'Bulleted list', icon: <List size={15} />, onSelect: () => applyFormatting('bulletList') },
              { label: 'Numbered list', icon: <ListOrdered size={15} />, onSelect: () => applyFormatting('numberedList') },
              { label: 'Quote', icon: <Quote size={15} />, onSelect: () => applyFormatting('quote') },
              { label: 'Code block', icon: <SquareCode size={15} />, onSelect: () => applyFormatting('codeBlock') },
              { label: 'Show formatting toolbar', icon: <Bold size={15} />, onSelect: () => void setPreference('composer.formatting_toolbar', true) },
            ]} />}
            <div className="composer-tool-cluster" role="group" aria-label="Add content">
              <IconTooltip label="Attach file"><button className="icon-button" type="button" aria-label="Attach file" disabled={!selectedRoom || busy || voiceCaptureStatus !== null} onClick={() => attachmentInputRef.current?.click()}><Paperclip size={15} /></button></IconTooltip>
              <div className="composer-emoji-control" ref={composerEmojiControlRef}>
                <IconTooltip label="Choose an emoji"><button className="icon-button" type="button" aria-label="Emoji picker" aria-haspopup="dialog" aria-expanded={emojiPickerOpen} disabled={!selectedRoom || busy || voiceCaptureStatus !== null} onMouseDown={(event) => event.preventDefault()} onClick={toggleComposerEmojiPicker}><Smile size={15} /></button></IconTooltip>
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
            <div className="composer-tool-cluster" role="group" aria-label="Delivery options">
              <IconTooltip label={voiceRecordingActive ? 'Stop and send voice note' : 'Record voice note'}><button className="icon-button" type="button" aria-label={voiceRecordingActive ? 'Stop and send voice note' : 'Record voice note'} aria-pressed={voiceRecordingActive} disabled={!selectedRoom || busy || voiceCaptureStatus === 'processing' || videoRecordingActive} onClick={() => voiceRecordingActive ? stopRecording() : void startRecording('voice')}>{voiceRecordingActive ? <Square size={15} /> : <Mic size={15} />}</button></IconTooltip>
              {videoRecordingActive && <IconTooltip label="Stop and send video message"><button className="icon-button is-recording" type="button" aria-label="Stop and send video message" onClick={stopRecording}><Square size={15} /></button></IconTooltip>}
              <ActionMenu key={`delivery:${activeAccountID}:${selectedRoomID}`} label="Delivery options" icon={<ChevronDown size={16} />} side="top" disabled={!selectedRoom || busy || voiceCaptureStatus !== null} items={[
                { label: 'Record video message', icon: <Video size={15} />, onSelect: () => void startRecording('video') },
                { label: replyTarget ? 'Schedule reply' : 'Schedule message', icon: <Clock3 size={15} />, onSelect: openScheduleMessage, disabled: !composeText.trim() || Boolean(editTarget) },
              ]} />
            </div>
            <div className="composer-tool-cluster composer-ai-cluster" role="group" aria-label="AI tools">
              {composerAIItems().map((item) => {
                const shortcut = item.primaryShiftKey ? primaryShiftShortcutHint(item.primaryShiftKey) : ''
                return <IconTooltip key={item.label} label={item.label}>
                  <button className="icon-button" type="button" aria-label={item.label} title={item.title} aria-keyshortcuts={item.primaryShiftKey ? `Control+Shift+${item.primaryShiftKey} Meta+Shift+${item.primaryShiftKey}` : undefined} disabled={item.disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => item.onSelect()}>{item.icon}{shortcut && <kbd aria-hidden="true">{shortcut}</kbd>}</button>
                </IconTooltip>
              })}
            </div>
            {imageRunHere && <IconTooltip label="Stop image generation"><button className="icon-button is-recording" type="button" aria-label="Stop image generation" onClick={stopImageGeneration}><Square size={15} /></button></IconTooltip>}
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
