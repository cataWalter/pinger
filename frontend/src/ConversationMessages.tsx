import { Fragment, useCallback } from 'react'
import { ArrowUp, BellRing, Check, CircleAlert, MessageCircleMore, RotateCcw, Search, X, Download } from 'lucide-react'
import { activeLocale } from './i18n'
import { DialogPresence } from './DialogPresence'
import { primaryShiftShortcutLabel, VIRTUAL_TIMELINE_THRESHOLD } from './appShared'
import { chatExportStatusText, preferenceBoolean, isDirectLikeRoom, TimelineMessageList } from './appShared'
import { themeModeForPreference } from './themes'
import { dropUnloadedChatTranslations } from './chatTranslationStash'
import type { AppState } from './appState'

export function ConversationMessages({ app }: { app: AppState }) {
  const { activeAccountID, activeUnreadMarker, appZoom, autoPlayNextMessageId, cancelChatExport, chatExportForSelectedRoom, chatTranslation, clearScheduledNotice, clearUndoToast, closeMessageSearch, dismissChatExport, editTarget, error, focusTimelineMessage, handleTimelineKeyDown, hasOlder, hasOlderRef, isNearBottom, isNearTop, loadMoreSearchResults, loadOlderMessages, loadingHistory, loadingOlder, loadingOlderRef, messageContextMenu, messageContextMenuItems, messageSearch, messages, observeUnreadDivider, openScheduledJobs, openSearchResult, pinnedScrollTopRef, preferences, reactingMessageID, revealChatExport, rooms, scheduledNotice, searchFrom, searchNextBatch, searchOpen, searchResults, searchRoomID, searchSender, searchStatus, searchTo, searching, selectedRoom, selectedRoomID, setChatTranslation, setError, setMessageContextMenu, setMessageSearch, setSearchFrom, setSearchRoomID, setSearchSender, setSearchTo, setUnreadMarker, snapshot, stickToBottomRef, submitMessageSearch, threadSummaries, timelineListRef, timelineMessageActionsRef, timelineMessages, timelineRef, typingStatus, undoAnswered, undoRoomID, unreadMarkerID, visibleMessages } = app
  // Finished translations for rows that virtual loading unloads are discarded from RAM.
  // Stable identity keeps the memoized TimelineMessageList from re-rendering on every composer keystroke.
  const discardUnloadedTranslations = useCallback((messageIDs: string[]) => {
    setChatTranslation((current) => dropUnloadedChatTranslations(current, selectedRoomID, messageIDs))
  }, [selectedRoomID, setChatTranslation])
  return (
    <>
      {(chatExportForSelectedRoom || scheduledNotice || undoRoomID) && <div className="chat-notice-stack" aria-label="Notifications">
        {chatExportForSelectedRoom?.phase === 'running' && <div className="scheduled-notice chat-export-notice" role="status">
          <Download size={16} />
          <span>{chatExportStatusText(chatExportForSelectedRoom)}</span>
          <button type="button" onClick={() => void cancelChatExport()}>Cancel export</button>
        </div>}
        {chatExportForSelectedRoom?.phase === 'done' && chatExportForSelectedRoom.result && <div className="scheduled-notice chat-export-notice" role="status">
          <Download size={16} />
          <span>Exported {chatExportForSelectedRoom.result.messages} messages.</span>
          <button type="button" title={chatExportForSelectedRoom.result.path} onClick={() => void revealChatExport(chatExportForSelectedRoom.result?.path ?? '')}>Show in file manager</button>
          <button className="icon-button" type="button" aria-label="Dismiss export notice" title="Dismiss export notice" onClick={dismissChatExport}><X size={15} /></button>
        </div>}
        {chatExportForSelectedRoom?.error && <div className="scheduled-notice chat-export-notice" role="alert">
          <CircleAlert size={16} />
          <span>{chatExportForSelectedRoom.error}</span>
          <button className="icon-button" type="button" aria-label="Dismiss export error" title="Dismiss export error" onClick={dismissChatExport}><X size={15} /></button>
        </div>}
        {scheduledNotice && <div className="scheduled-notice" role="status">
          <BellRing size={16} />
          <span>{scheduledNotice}</span>
          <button type="button" title="Open reminders" onClick={openScheduledJobs}>View reminders</button>
          <button className="icon-button" type="button" aria-label="Dismiss reminder notice" title="Dismiss reminder notice" onClick={clearScheduledNotice}><X size={15} /></button>
        </div>}
        <DialogPresence open={!!undoRoomID}>{undoRoomID && <div className="triage-toast" role="status">
          <Check className="triage-toast-icon" size={16} aria-hidden="true" />
          <span>Marked {rooms.find((room) => room.id === undoRoomID)?.name || 'room'} answered</span>
          <button type="button" onClick={() => void undoAnswered()}><RotateCcw size={14} />Undo</button>
          <button className="icon-button" type="button" aria-label="Dismiss notification" title="Dismiss notification" onClick={clearUndoToast}><X size={15} /></button>
        </div>}</DialogPresence>
      </div>}

      {searchOpen && (
        <section className="message-search-panel" aria-label="Search messages across rooms">
          <div className="message-search-heading">
            <h3>Search messages</h3>
            <button className="icon-button" type="button" aria-label="Close message search" title="Close search" onClick={closeMessageSearch}>
              <X size={16} />
            </button>
          </div>
          <form className="message-search-form" onSubmit={submitMessageSearch}>
            <input
              autoFocus
              value={messageSearch}
              onChange={(event) => setMessageSearch(event.target.value)}
              placeholder="Search all chats"
              aria-label="Search local message history"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />
            <button className="search-submit" type="submit" aria-label="Search" title="Search messages" disabled={!messageSearch.trim() || searching}>
              <Search size={16} />
            </button>
          </form>
          <details className="message-search-filters">
            <summary>Filters</summary>
            <div className="message-search-filter-grid">
              <label>
                <span>Chat</span>
                <select aria-label="Filter by room" value={searchRoomID} onChange={(event) => setSearchRoomID(event.target.value)}>
                  <option value="">All chats</option>
                  {rooms.map((room) => <option key={room.id} value={room.id}>{room.name || room.id}</option>)}
                </select>
              </label>
              <label>
                <span>Sender</span>
                <input aria-label="Filter by sender" value={searchSender} onChange={(event) => setSearchSender(event.target.value)} placeholder="@user:server" spellCheck={false} autoCorrect="off" autoCapitalize="off" />
              </label>
              <label>
                <span>From</span>
                <input aria-label="Search from date" type="date" value={searchFrom} onChange={(event) => setSearchFrom(event.target.value)} />
              </label>
              <label>
                <span>To</span>
                <input aria-label="Search to date" type="date" value={searchTo} onChange={(event) => setSearchTo(event.target.value)} />
              </label>
            </div>
          </details>
          {searchStatus && <p className="message-search-status" role="status">{searchStatus}</p>}
          <div className="message-search-results" aria-live="polite">
            {searching && <div className="message-search-empty"><span className="loading-mark" />Searching local history</div>}
            {!searching && searchResults.map((result, index) => {
              const room = rooms.find((candidate) => candidate.id === result.roomID)
              const message = result.message
              return <button className="message-search-result" key={`${result.roomID}:${message.id || message.transactionId || index}`} type="button" aria-label={`Open message in ${room?.name || result.roomID}`} title={`Open message in ${room?.name || result.roomID}`} onClick={() => openSearchResult(result)}>
                <span className="message-search-room">{room?.name || result.roomID}{room?.bridge && <small>{room.bridge}</small>}</span>
                <div className="message-search-meta">
                  <strong>{message.senderName || message.sender}</strong>
                  {message.timestamp > 0 && <time>{new Intl.DateTimeFormat(activeLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(message.timestamp))}</time>}
                </div>
                <p>{message.body}</p>
              </button>
            })}
            {!searching && searchNextBatch && <button className="message-search-more" type="button" onClick={() => void loadMoreSearchResults()}>Load more results</button>}
          </div>
        </section>
      )}

      {error && <div className="inline-error" role="alert"><CircleAlert size={15} />{error}<button aria-label="Dismiss error" title="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}

      {activeUnreadMarker?.messageID && !activeUnreadMarker.seen && activeUnreadMarker.offscreen && <div className="unread-jump-anchor">
        <button className="unread-jump-pill" type="button" onClick={() => {
          setUnreadMarker((current) => current ? { ...current, seen: true } : current)
          focusTimelineMessage(activeUnreadMarker.messageID)
        }}><ArrowUp size={14} aria-hidden="true" />{activeUnreadMarker.count === 1 ? '1 new message' : `${activeUnreadMarker.count} new messages`}</button>
      </div>}
      <div className="timeline" key={selectedRoomID} ref={timelineRef} role="region" aria-label="Message timeline" data-virtualized={visibleMessages.length > VIRTUAL_TIMELINE_THRESHOLD} style={visibleMessages.length > VIRTUAL_TIMELINE_THRESHOLD ? { zoom: 100 / appZoom } : undefined} tabIndex={0} onKeyDown={handleTimelineKeyDown} onScroll={(event) => {
        const element = event.currentTarget
        const atPinnedPosition = pinnedScrollTopRef.current !== null && Math.abs(element.scrollTop - pinnedScrollTopRef.current) < 1
        // Only a scroll away from the bottom that is not our own pin stops following the newest message.
        if (isNearBottom(element)) stickToBottomRef.current = true
        else if (!atPinnedPosition) stickToBottomRef.current = false
        // Infinite scroll: reaching the top of the loaded history fetches the
        // next older page. The refs keep a burst of scroll events from
        // starting several fetches before `loadingOlder` commits.
        if (hasOlderRef.current && !loadingOlderRef.current && isNearTop(element)) {
          void loadOlderMessages()
        }
      }}>
        {!selectedRoom && <div className="timeline-empty"><MessageCircleMore size={25} /><span>Select a room</span></div>}
        {selectedRoom && loadingHistory && messages.length === 0 && <div className="timeline-empty"><span className="loading-mark" />Loading messages</div>}
        {selectedRoom && !loadingHistory && visibleMessages.length === 0 && <div className="timeline-empty"><MessageCircleMore size={25} /><span>{messages.length > 0 ? 'Deleted messages are hidden' : hasOlder ? 'No messages in the past 24 hours' : 'No messages yet'}</span></div>}
        <TimelineMessageList
          messages={timelineMessages}
          reactionColorScheme={themeModeForPreference(app.themePreference, app.systemPrefersDark)}
          threadSummaries={threadSummaries}
          header={selectedRoom && hasOlder ? (
            <button className="load-older" type="button" title={loadingOlder ? 'Loading older messages' : 'Load older messages'} onClick={loadOlderMessages} disabled={loadingOlder}>
              {loadingOlder ? <><span className="loading-mark" />Loading older messages</> : 'Load older messages'}
            </button>
          ) : null}
          hideDeleted={preferenceBoolean(preferences, 'appearance.hide_deleted_messages')}
          preferences={preferences}
          currentUserID={snapshot?.profile.userId ?? ''}
          accountID={activeAccountID}
          selectedRoomID={selectedRoomID}
          groupChat={Boolean(selectedRoom && !isDirectLikeRoom(selectedRoom))}
          chatTranslation={chatTranslation?.roomID === selectedRoomID ? chatTranslation : null}
          contextMessageID={messageContextMenu?.message.id || messageContextMenu?.message.transactionId || ''}
          reactingMessageID={reactingMessageID}
          autoPlayNextMessageId={autoPlayNextMessageId}
          canUseTranscriptAsDraft={!editTarget}
          actionsRef={timelineMessageActionsRef}
          scrollParentRef={timelineRef}
          listHandleRef={timelineListRef}
          unreadMarkerID={unreadMarkerID}
          unreadDividerRef={observeUnreadDivider}
          onAnalysesUnloaded={discardUnloadedTranslations}
        />
        {chatTranslation?.roomID === selectedRoomID && <div className="chat-translation-status">
          {chatTranslation.busy && <p role="status">{chatTranslation.status}</p>}
          {chatTranslation.error && <p role="alert">{chatTranslation.error}</p>}
        </div>}
      </div>
      {typingStatus && <div className="typing-indicator" aria-live="polite"><span className="typing-indicator-dots" aria-hidden="true"><span /><span /><span /></span><span>{typingStatus}</span></div>}
      {messageContextMenu && <div className="message-context-scrim" aria-hidden="true">
        <div className="message-context-scrim-panel message-context-scrim-top" style={{ height: messageContextMenu.targetBounds.top }} />
        <div className="message-context-scrim-panel message-context-scrim-left" style={{ top: messageContextMenu.targetBounds.top, width: messageContextMenu.targetBounds.left, height: messageContextMenu.targetBounds.bottom - messageContextMenu.targetBounds.top }} />
        <div className="message-context-scrim-panel message-context-scrim-right" style={{ left: messageContextMenu.targetBounds.right, top: messageContextMenu.targetBounds.top, height: messageContextMenu.targetBounds.bottom - messageContextMenu.targetBounds.top }} />
        <div className="message-context-scrim-panel message-context-scrim-bottom" style={{ top: messageContextMenu.targetBounds.bottom }} />
      </div>}
      {messageContextMenu && <div className="message-context-menu" role="menu" aria-label="Message actions" style={{ left: messageContextMenu.x, top: messageContextMenu.y }}>
        {messageContextMenuItems(messageContextMenu.message).map((item) => (
          <Fragment key={item.key}>
            {item.separatorBefore && <div className="message-context-separator" role="separator" />}
            {item.meta
              ? <div className="message-context-meta">{item.icon}<span>{item.label}</span></div>
              : <button
                type="button"
                role="menuitem"
                className={item.danger ? 'is-danger' : undefined}
                aria-label={item.ariaLabel}
                aria-keyshortcuts={item.primaryShiftKey ? `Control+Shift+${item.primaryShiftKey} Meta+Shift+${item.primaryShiftKey}` : undefined}
                title={item.ariaLabel}
                disabled={item.disabled}
                onClick={() => { setMessageContextMenu(null); item.run() }}
              >
                {item.icon}<span>{item.label}</span>{item.primaryShiftKey && <kbd aria-hidden="true">{primaryShiftShortcutLabel(item.primaryShiftKey)}</kbd>}
              </button>}
          </Fragment>
        ))}
      </div>}
    </>
  )
}
