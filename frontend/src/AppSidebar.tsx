import { Archive, ArchiveRestore, Bell, BellOff, Check, CircleDot, MessageCircleMore, Pencil, Reply, Search, Settings, Sparkles, Star, Trash2, X, Folder, FolderPlus, Plus } from 'lucide-react'
import { type Room } from '../bindings/mychat/desktop/models.js'
import { InviteList } from './RoomMembership'
import { ConnectionStatusBanner } from './ConnectionStatusBanner'
import { localAIFavoritePreference, localAIIncludeInAllPreference, LOCAL_AI_FOLDER_NAME_CHARACTERS } from './localAIChats'
import { preferenceBoolean, isNeedsReplyRoom, primaryModifierLabel, RoomButton, reportRoomListVisibleRange, VirtualRoomList } from './appShared'
import { ROOM_ROW_HEIGHT, ROOM_ROW_HEIGHT_COMPACT } from './appConstants'
import { SidebarResizeHandle } from './SidebarResizeHandle'
import type { AppState } from './appState'
import { getVolatileAIDraft } from './volatileAIDrafts'

export function AppSidebar({ app, sidebarWidth, sidebarZoom, onSidebarWidthChange }: {
  app: AppState
  sidebarWidth: number | null
  sidebarZoom: number
  onSidebarWidthChange: (width: number) => void
}) {
  const { acceptInvite, activeAccountID, activeListRoomID, answeredShortcut, applyBulkRoomAction, applyMenuFilter, clearRoomSelection, connectionProblem, contextMenuChatID, contextMenuHasUnread, contextMenuIsBulk, contextMenuLocalAIFolderID, contextMenuLocalAIInAll, contextMenuLocalAIRoom, contextMenuNeedsArchive, contextMenuNeedsFavorite, contextMenuNeedsMute, contextMenuNeedsReplyAddCount, contextMenuNeedsReplyAddRooms, contextMenuRooms, declineInvite, deleteLocalAIChat, deleteLocalAIFolder, filteredRooms, handleMarkAnsweredKeyDown, inviteBusyRoomID, isLastMessageByCurrentUser, listRooms, localAIActiveFolder, localAIChatList, localAIDeleteArmedID, localAIFolderDeleteArmedID, localAIFolderDraft, localAIFolderFilter, localAIIconByRoomID, markRoomAnswered, markRoomRead, markRoomUnread, menuFilter, moveLocalAIChatToFolder, needsReplyCount, preferences, roomButtonActionsRef, roomContextMenu, roomListRef, roomRefinements, roomScope, roomSearchInputRef, saveLocalAIFolderDraft, search, selectLocalAIChat, selectedRoomID, selectedRoomIDs, selectedRoomListIndex, setLocalAIDeleteArmedID, setLocalAIFolderDeleteArmedID, setLocalAIFolderDraft, setLocalAIFolderFilter, setLocalAIRenameDraft, setPreference, setRoomArchived, setRoomContextMenu, setRoomScope, setSearch, setSettingsOpen, snapshot, startLocalAIChat, toggleRoomRefinement } = app
  const { aiEnabled, aiReplyDraftBatch, busy, cancelAIDraftBatch, editTarget, generateNeedsReplyDrafts, volatileAIDrafts } = app
  const draftBatchTitle = aiReplyDraftBatch.status === 'running'
    ? `Generating AI drafts: ${aiReplyDraftBatch.completed} of ${aiReplyDraftBatch.total}`
    : aiReplyDraftBatch.failures.length > 0
      ? aiReplyDraftBatch.failures.join('\n')
      : 'Generate a reply draft for each chat that needs a reply'
  const draftProgressText = `Drafting ${aiReplyDraftBatch.completed} of ${aiReplyDraftBatch.total}${aiReplyDraftBatch.failures.length > 0 ? ` · ${aiReplyDraftBatch.failures.length} failed` : ''}`
  const draftProgressPercent = aiReplyDraftBatch.total > 0 ? Math.round((aiReplyDraftBatch.completed / aiReplyDraftBatch.total) * 100) : 0
  const aiDraftPreview = (room: Room) => {
    if (!isNeedsReplyRoom(room)) return undefined
    return getVolatileAIDraft(volatileAIDrafts, activeAccountID, room.id)?.text.replace(/\s+/g, ' ').trim() || undefined
  }
  return (
    <aside className="sidebar">
      {/* Empty drag strip under the macOS traffic lights; the window title bar is transparent. */}
      <div className="sidebar-titlebar" aria-hidden="true" style={{ '--wails-draggable': 'drag' } as React.CSSProperties} />
      <ConnectionStatusBanner problem={connectionProblem} />
      <>
        <div className="room-search-row">
          <label className="room-search">
            <Search size={16} />
            <input ref={roomSearchInputRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a room" aria-label="Find a room" spellCheck={false} autoCorrect="off" autoCapitalize="off" />
            {search && <button type="button" aria-label="Clear room search" title="Clear room search" onClick={() => setSearch('')}><X size={16} /></button>}
          </label>
          <button className="sidebar-icon" type="button" aria-label="Settings" title="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings size={16} />
          </button>
        </div>
        <div className="room-filters" role="group" aria-label="Filter rooms">
          <div className="room-scope-filters" role="group" aria-label="Room visibility">
            <button type="button" className={roomScope === 'all' ? 'is-active' : ''} aria-label="All" aria-pressed={roomScope === 'all'} aria-keyshortcuts="Control+Shift+A Meta+Shift+A" title="All rooms (Ctrl / ⌘ + Shift + A)" onClick={() => setRoomScope('all')}><span className="filter-symbol"><MessageCircleMore size={14} /></span><span className="filter-label">All</span></button>
            <button type="button" className={roomScope === 'archived' ? 'is-active' : ''} aria-label="Archived rooms" aria-pressed={roomScope === 'archived'} aria-keyshortcuts="Control+Shift+H Meta+Shift+H" title="Archived rooms (Ctrl / ⌘ + Shift + H)" onClick={() => applyMenuFilter('archived')}><span className="filter-symbol"><Archive size={14} /></span><span className="filter-label">Archive</span></button>
            <button type="button" className={roomScope === 'local-ai' ? 'is-active' : ''} aria-label="AI chats" aria-pressed={roomScope === 'local-ai'} title="Private AI chats" onClick={() => applyMenuFilter('private')}><span className="filter-symbol"><Sparkles size={14} /></span><span className="filter-label">AI chats</span></button>
          </div>
          <div className="room-refinement-filters" role="group" aria-label="Room categories">
            <button type="button" className={roomRefinements.unanswered ? 'is-active' : ''} aria-label="Unanswered rooms" aria-pressed={roomRefinements.unanswered} aria-keyshortcuts="Control+Shift+R Meta+Shift+R" title="Unanswered rooms (Ctrl / ⌘ + Shift + R)" onClick={() => toggleRoomRefinement('unanswered')}><span className="filter-symbol"><Reply size={14} /></span><span className="filter-label">Unanswered</span></button>
            <button type="button" className={roomRefinements.needsReply ? 'is-active' : ''} aria-label="Needs reply" aria-pressed={roomRefinements.needsReply} aria-keyshortcuts={`${answeredShortcut} Control+Shift+U Meta+Shift+U`} title={`Needs reply (Ctrl / ⌘ + Shift + U; ${answeredShortcut} marks answered)`} onClick={() => toggleRoomRefinement('needsReply')} onKeyDown={(event) => handleMarkAnsweredKeyDown(event, selectedRoomID)}>
              <span className="filter-symbol"><CircleDot size={14} /></span><span className="filter-label">Needs reply</span>{needsReplyCount > 0 && <span className="filter-count">{needsReplyCount}</span>}
            </button>
            <button type="button" className={roomRefinements.favorite ? 'is-active' : ''} aria-label="Favorite rooms" aria-pressed={roomRefinements.favorite} aria-keyshortcuts="Control+Shift+F Meta+Shift+F" title="Favorites (Ctrl / ⌘ + Shift + F)" onClick={() => applyMenuFilter('favorites')}><span className="filter-symbol"><Star size={14} /></span><span className="filter-label">Favorites</span></button>
          </div>
        </div>
        {roomScope === 'local-ai' && <div className="local-ai-folder-bar" role="group" aria-label="AI chat folders">
          <button type="button" className={localAIFolderFilter === null ? 'is-active' : ''} aria-label="All AI chats" aria-pressed={localAIFolderFilter === null} onClick={() => setLocalAIFolderFilter(null)}>All</button>
          <button type="button" className={localAIFolderFilter === '' ? 'is-active' : ''} aria-label="Unfiled AI chats" aria-pressed={localAIFolderFilter === ''} onClick={() => setLocalAIFolderFilter('')}>Unfiled</button>
          {localAIChatList.folders.map((folder) => (
            <button key={folder.id} type="button" className={localAIFolderFilter === folder.id ? 'is-active' : ''} title={folder.name} aria-pressed={localAIFolderFilter === folder.id} onClick={() => setLocalAIFolderFilter(folder.id)}>
              <Folder size={12} /><span>{folder.name}</span>
            </button>
          ))}
          <button type="button" className="local-ai-folder-action" aria-label="New folder" title="New folder" onClick={() => {
            setLocalAIFolderDeleteArmedID('')
            setLocalAIFolderDraft({ folderID: '', name: '' })
          }}><FolderPlus size={13} /></button>
          {localAIActiveFolder && <button type="button" className="local-ai-folder-action" aria-label="Rename folder" title="Rename folder" onClick={() => {
            setLocalAIFolderDeleteArmedID('')
            setLocalAIFolderDraft({ folderID: localAIActiveFolder.id, name: localAIActiveFolder.name })
          }}><Pencil size={13} /></button>}
          {localAIActiveFolder && <button type="button" className={`local-ai-folder-action${localAIFolderDeleteArmedID === localAIActiveFolder.id ? ' is-armed' : ''}`} aria-label={localAIFolderDeleteArmedID === localAIActiveFolder.id ? 'Confirm delete folder' : 'Delete folder'} title="Delete folder. Its chats stay in the list." onClick={() => {
            if (localAIFolderDeleteArmedID !== localAIActiveFolder.id) {
              setLocalAIFolderDeleteArmedID(localAIActiveFolder.id)
              return
            }
            void deleteLocalAIFolder(localAIActiveFolder.id)
          }}><Trash2 size={13} />{localAIFolderDeleteArmedID === localAIActiveFolder.id && <span>Confirm</span>}</button>}
          {localAIFolderDraft && <input className="local-ai-folder-input" aria-label={localAIFolderDraft.folderID ? 'Folder name' : 'New folder name'} placeholder="Folder name" spellCheck={false} autoCorrect="off" autoCapitalize="off" value={localAIFolderDraft.name} maxLength={LOCAL_AI_FOLDER_NAME_CHARACTERS} autoFocus onChange={(event) => setLocalAIFolderDraft({ folderID: localAIFolderDraft.folderID, name: event.currentTarget.value })} onBlur={() => setLocalAIFolderDraft(null)} onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setLocalAIFolderDraft(null)
            } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void saveLocalAIFolderDraft(localAIFolderDraft.folderID, event.currentTarget.value)
            }
          }} />}
        </div>}
        {menuFilter === 'all' && <InviteList invites={snapshot.invites ?? []} busyRoomID={inviteBusyRoomID} onAccept={(invite) => void acceptInvite(invite)} onDecline={(invite) => void declineInvite(invite)} />}
        <div className="room-section-label"><span>{roomScope === 'archived' ? 'ARCHIVED' : roomScope === 'local-ai' ? 'AI CHATS' : 'ROOMS'}</span><span className="room-section-actions">{aiReplyDraftBatch.notice && <span className="room-section-notice" role="status">{aiReplyDraftBatch.notice}</span>}{roomScope === 'all' && roomRefinements.needsReply && <button className="room-archive-all" type="button" aria-label={aiReplyDraftBatch.status === 'running' ? `Generating AI reply drafts, ${aiReplyDraftBatch.completed} of ${aiReplyDraftBatch.total} complete` : 'Generate AI reply drafts'} title={draftBatchTitle} disabled={!aiEnabled || busy || Boolean(editTarget) || aiReplyDraftBatch.status === 'running'} onClick={() => void generateNeedsReplyDrafts()}><Sparkles size={13} /></button>}{roomScope === 'local-ai' && <button className="local-ai-new-chat" type="button" title="New private chat (Ctrl / ⌘ + Shift + M)" onClick={() => startLocalAIChat()}><Plus size={13} /><span>New private chat</span></button>}<span className="room-section-count">{filteredRooms.length.toString().padStart(2, '0')}</span></span></div>
        {aiReplyDraftBatch.status === 'running' && (
          <div className="draft-progress">
            <div className="draft-progress-track" role="progressbar" aria-label="AI reply drafts" aria-valuemin={0} aria-valuemax={aiReplyDraftBatch.total} aria-valuenow={aiReplyDraftBatch.completed} aria-valuetext={draftProgressText}>
              <span className="draft-progress-fill" style={{ width: `${draftProgressPercent}%` }} />
            </div>
            <span className="draft-progress-text">{draftProgressText}</span>
            <button className="room-archive-all" type="button" aria-label="Cancel AI reply draft generation" title="Cancel AI reply draft generation" onClick={cancelAIDraftBatch}><X size={13} /></button>
          </div>
        )}
        <VirtualRoomList
          listRef={roomListRef}
          rooms={filteredRooms}
          selectedRoomIndex={selectedRoomListIndex}
          rowHeight={preferenceBoolean(preferences, 'sidebar.compact_chat_list') ? ROOM_ROW_HEIGHT_COMPACT : ROOM_ROW_HEIGHT}
          listCount={Math.max(filteredRooms.length, snapshot?.slidingSyncListCounts?.main ?? 0)}
          rangeKey={snapshot?.accountId ?? ''}
          onVisibleRange={reportRoomListVisibleRange}
          renderRoom={(room, index) => (
            <RoomButton
              key={`${room.accountId}:${room.id}`}
              room={room}
              index={index}
              active={room.id === activeListRoomID}
              needsReply={isNeedsReplyRoom(room)}
              aiDraft={aiDraftPreview(room)}
              multiSelected={selectedRoomIDs.length > 1 && selectedRoomIDs.includes(room.id)}
              lastMessageByMe={isLastMessageByCurrentUser(room)}
              use24Hour={preferenceBoolean(preferences, 'appearance.time_24_hour')}
              showNetwork={preferenceBoolean(preferences, 'sidebar.network_icons')}
              showUnreadCounts={preferenceBoolean(preferences, 'sidebar.show_unread_counts', true)}
              aiIcon={localAIIconByRoomID.get(room.id)}
              actionsRef={roomButtonActionsRef}
            />
          )}
          emptyContent={filteredRooms.length === 0 && (
            <div className="room-empty">{listRooms.length === 0 ? 'No rooms yet' : search ? 'No matching rooms' : roomScope === 'archived' ? 'No archived rooms' : roomScope === 'local-ai' ? (localAIFolderFilter === null ? 'No private model chats yet' : 'No chats in this folder') : 'No rooms match these filters'}</div>
          )}
        />
        {roomContextMenu && contextMenuChatID !== null && contextMenuLocalAIRoom && <div className="room-context-menu" role="menu" style={{ left: roomContextMenu.x, top: roomContextMenu.y }}>
          <button type="button" role="menuitem" onClick={() => {
            setRoomContextMenu(null)
            selectLocalAIChat(contextMenuChatID)
            // Seed the raw title so an untitled chat is not renamed to the "Untitled chat" placeholder.
            setLocalAIRenameDraft(localAIChatList.chats.find((chat) => chat.id === contextMenuChatID)?.title ?? '')
          }}>
            <Pencil size={15} /><span>Rename chat</span>
          </button>
          <button type="button" role="menuitem" aria-keyshortcuts="Control+Shift+G Meta+Shift+G" title={`${contextMenuLocalAIInAll ? 'Remove from' : 'Add to'} All rooms (Ctrl / ⌘ + Shift + G)`} onClick={() => {
            setRoomContextMenu(null)
            const preferenceKey = localAIIncludeInAllPreference(contextMenuChatID)
            void setPreference(preferenceKey, !contextMenuLocalAIInAll)
          }}>
            <MessageCircleMore size={15} /><span>{contextMenuLocalAIInAll ? 'Remove from All rooms' : 'Add to All rooms'}</span><kbd aria-hidden="true">{primaryModifierLabel()}⇧G</kbd>
          </button>
          <button type="button" role="menuitem" onClick={() => {
            setRoomContextMenu(null)
            clearRoomSelection()
            void setPreference(localAIFavoritePreference(contextMenuChatID), !contextMenuLocalAIRoom.favorite)
          }}>
            <Star size={15} /><span>{contextMenuLocalAIRoom.favorite ? 'Remove from Favorites' : 'Add to Favorites'}</span>
          </button>
          <div className="room-context-menu-group" role="group" aria-label="Move to folder">
            <div className="room-context-menu-label">Move to folder</div>
            <button type="button" role="menuitemradio" aria-checked={contextMenuLocalAIFolderID === ''} onClick={() => {
              setRoomContextMenu(null)
              void moveLocalAIChatToFolder(contextMenuChatID, '')
            }}>
              <Folder size={15} /><span>No folder</span>
            </button>
            <div className="room-context-menu-folders">
              {localAIChatList.folders.map((folder) => (
                <button key={folder.id} type="button" role="menuitemradio" aria-checked={contextMenuLocalAIFolderID === folder.id} onClick={() => {
                  setRoomContextMenu(null)
                  void moveLocalAIChatToFolder(contextMenuChatID, folder.id)
                }}>
                  <Folder size={15} /><span>{folder.name}</span>
                </button>
              ))}
            </div>
          </div>
          <button type="button" role="menuitem" onClick={() => {
            if (localAIDeleteArmedID !== contextMenuChatID) {
              setLocalAIDeleteArmedID(contextMenuChatID)
              return
            }
            setRoomContextMenu(null)
            clearRoomSelection()
            setLocalAIDeleteArmedID('')
            void deleteLocalAIChat(contextMenuChatID)
          }}>
            <Trash2 size={15} /><span>{localAIDeleteArmedID === contextMenuChatID ? 'Confirm delete' : 'Delete chat'}</span>
          </button>
        </div>}
        {roomContextMenu && contextMenuChatID === null && <div className="room-context-menu" role="menu" style={{ left: roomContextMenu.x, top: roomContextMenu.y }}>
          {contextMenuIsBulk && <div className="room-context-menu-count">{contextMenuRooms.length} chats selected</div>}
          {contextMenuNeedsReplyAddCount > 0 && <button type="button" role="menuitem" aria-keyshortcuts="N" title="Add to Needs reply (N)" onClick={() => void applyBulkRoomAction('needs-reply', contextMenuNeedsReplyAddRooms)}>
            <Reply size={15} /><span>{contextMenuIsBulk ? `Add ${contextMenuNeedsReplyAddCount} to Needs reply` : 'Add to Needs reply'}</span><kbd aria-hidden="true">N</kbd>
          </button>}
          {contextMenuRooms.some((room) => isNeedsReplyRoom(room)) && <button type="button" role="menuitem" aria-keyshortcuts={answeredShortcut} onClick={() => contextMenuIsBulk ? void applyBulkRoomAction('answered', contextMenuRooms) : void markRoomAnswered(roomContextMenu.roomID)} onKeyDown={(event) => {
            if (!contextMenuIsBulk) {
              handleMarkAnsweredKeyDown(event, roomContextMenu.roomID)
              return
            }
            if (event.altKey || event.ctrlKey || event.metaKey || event.key.toUpperCase() !== answeredShortcut) return
            event.preventDefault()
            event.stopPropagation()
            void applyBulkRoomAction('answered', contextMenuRooms)
          }}>
            <Check size={15} /><span>{contextMenuIsBulk ? `Remove ${contextMenuRooms.length} from Needs reply` : 'Remove from Needs reply'}</span><kbd aria-hidden="true">{answeredShortcut}</kbd>
          </button>}
          {contextMenuRooms.length > 0 && <button type="button" role="menuitem" aria-keyshortcuts="U" title="Toggle room unread (U)" onClick={() => {
            if (contextMenuIsBulk) void applyBulkRoomAction(contextMenuHasUnread ? 'read' : 'unread', contextMenuRooms)
            else void (contextMenuHasUnread ? markRoomRead(roomContextMenu.roomID) : markRoomUnread(roomContextMenu.roomID))
          }}>
            {contextMenuHasUnread ? <><Check size={15} /><span>{contextMenuIsBulk ? `Mark ${contextMenuRooms.length} chats read` : 'Mark room read'}</span></> : <><CircleDot size={15} /><span>{contextMenuIsBulk ? `Mark ${contextMenuRooms.length} chats unread` : 'Mark room unread'}</span></>}<kbd aria-hidden="true">U</kbd>
          </button>}
          {contextMenuRooms.length > 0 && <button type="button" role="menuitem" aria-keyshortcuts="A" title="Archive or restore room (A)" onClick={() => {
            if (contextMenuIsBulk) void applyBulkRoomAction(contextMenuNeedsArchive ? 'archive' : 'restore', contextMenuRooms)
            else void setRoomArchived(roomContextMenu.roomID, contextMenuNeedsArchive)
          }}>
            {contextMenuNeedsArchive ? <Archive size={15} /> : <ArchiveRestore size={15} />}
            <span>{contextMenuIsBulk ? `${contextMenuNeedsArchive ? 'Archive' : 'Restore'} ${contextMenuRooms.length} chats` : contextMenuNeedsArchive ? 'Archive room' : 'Restore room'}</span><kbd aria-hidden="true">A</kbd>
          </button>}
          {contextMenuRooms.length > 0 && <button type="button" role="menuitem" aria-keyshortcuts="F" title="Toggle favorite (F)" onClick={() => {
            if (contextMenuIsBulk) void applyBulkRoomAction(contextMenuNeedsFavorite ? 'favorite' : 'unfavorite', contextMenuRooms)
            else {
              setRoomContextMenu(null)
              clearRoomSelection()
              void setPreference(`room.favorite.${roomContextMenu.roomID}`, contextMenuNeedsFavorite)
            }
          }}>
            <Star size={15} fill={contextMenuNeedsFavorite ? 'none' : 'currentColor'} />
            <span>{contextMenuIsBulk ? `${contextMenuNeedsFavorite ? 'Add' : 'Remove'} ${contextMenuRooms.length} ${contextMenuNeedsFavorite ? 'to' : 'from'} Favorites` : contextMenuNeedsFavorite ? 'Add to Favorites' : 'Remove from Favorites'}</span><kbd aria-hidden="true">F</kbd>
          </button>}
          {contextMenuRooms.length > 0 && <button type="button" role="menuitem" aria-keyshortcuts="M" title="Mute or unmute notifications (M)" onClick={() => void applyBulkRoomAction(contextMenuNeedsMute ? 'mute' : 'unmute', contextMenuRooms)}>
            {contextMenuNeedsMute ? <BellOff size={15} /> : <Bell size={15} />}
            <span>{contextMenuIsBulk ? `${contextMenuNeedsMute ? 'Mute' : 'Unmute'} notifications for ${contextMenuRooms.length} chats` : contextMenuNeedsMute ? 'Mute notifications' : 'Unmute notifications'}</span><kbd aria-hidden="true">M</kbd>
          </button>}
        </div>}
      </>
      <SidebarResizeHandle width={sidebarWidth} zoom={sidebarZoom} onWidthChange={onSidebarWidthChange} />
    </aside>
  )
}
