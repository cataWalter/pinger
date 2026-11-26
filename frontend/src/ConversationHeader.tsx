import { memo } from 'react'
import { ArrowLeft, BellOff, Check, Clock3, MoreHorizontal, Search, Star, UsersRound, Download, EyeOff, Images } from 'lucide-react'
import { languageName, roomLearningLanguageChoice, roomLearningLanguageKey, roomTutorLanguageChoice, roomTutorLanguageKey } from './aiSettings'
import { ActionMenu } from './appShared'
import { RoomLanguageMenu } from './RoomLanguageMenu'
import { LOCAL_AI_TITLE_CHARACTERS } from './localAIChats'
import { Avatar, preferenceBoolean, isDirectLikeRoom, isNeedsReplyRoom, IconTooltip } from './appShared'
import { useSessionRooms } from './AppDomainContexts'

export const ConversationHeader = memo(function ConversationHeader() {
  const { activeAccountID, chatExport, exportSelectedRoomChat, languageRoles, loadingHistory, localAIActiveChat, localAIChatOpen, localAIRenameDraft, markRoomAnswered, openMediaGallery, openRoomInfo, openScheduledJobs, preferences, saveLocalAIRename, scheduledJobCount, selectedRoom, selectedRoomAvatar, selectedRoomAvatarSource, selectedRoomID, setLocalAIRenameDraft, setMobilePane, setPreference, setProfilePhotoPreview, setSearchOpen } = useSessionRooms()
  return (
    <header className="conversation-header">
      <button className="mobile-back-button icon-button" type="button" aria-label="Back to rooms" title="Back to rooms" onClick={() => setMobilePane('rooms')}>
        <ArrowLeft size={17} />
      </button>
      {preferenceBoolean(preferences, 'privacy.incognito') && <span className="content-blur-indicator" role="status" aria-label="Content blur is on" title="Content blur is on"><EyeOff size={14} /></span>}
      {localAIChatOpen ? (
        <>
          <div className="conversation-title">
            {localAIRenameDraft === null ? <h2>{localAIActiveChat?.title || 'AI chat'}</h2> : <input className="local-ai-title-input" aria-label="Chat title" spellCheck={false} autoCorrect="off" autoCapitalize="off" value={localAIRenameDraft} maxLength={LOCAL_AI_TITLE_CHARACTERS} autoFocus onChange={(event) => setLocalAIRenameDraft(event.currentTarget.value)} onBlur={() => setLocalAIRenameDraft(null)} onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                setLocalAIRenameDraft(null)
              } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void saveLocalAIRename(event.currentTarget.value)
              }
            }} />}
            <span>Private model chat</span>
          </div>
        </>
      ) : selectedRoom ? (
        <>
          {selectedRoomAvatarSource ? (
            <button
              className="profile-photo-trigger"
              type="button"
              aria-label={`Open profile photo for ${selectedRoom.name || selectedRoom.id}`}
              title="Open profile photo"
              onClick={() => setProfilePhotoPreview({ source: selectedRoomAvatarSource, label: selectedRoom.name || selectedRoom.id })}
            >
              <Avatar uri={selectedRoomAvatar} label={selectedRoom.name || selectedRoom.id} className="conversation-room-avatar" />
            </button>
          ) : (
            <Avatar uri={selectedRoomAvatar} label={selectedRoom.name || selectedRoom.id} className="conversation-room-avatar" />
          )}
          <div className="conversation-title">
            <h2>{selectedRoom.name || selectedRoom.id}</h2>
            {!isDirectLikeRoom(selectedRoom) && selectedRoom.topic && <span title={selectedRoom.topic}>{selectedRoom.topic}</span>}
          </div>
          <span className="conversation-state-icons">
            {selectedRoom.favorite && <Star size={13} fill="currentColor" aria-label="Favorite room" />}
            {selectedRoom.muted && <BellOff size={13} aria-label="Notifications muted" />}
          </span>
          <div className="conversation-actions">
            <div className="conversation-action-group" role="group" aria-label="Conversation utilities">
              <IconTooltip label="Search messages">
                <button className="icon-button" type="button" aria-label="Search messages" onClick={() => setSearchOpen(true)}>
                  <Search size={16} />
                </button>
              </IconTooltip>
            </div>
            <div className="conversation-action-group" role="group" aria-label="Room controls">
              {isNeedsReplyRoom(selectedRoom) && <IconTooltip label="Mark room answered"><button className="icon-button" type="button" aria-label="Mark room answered" onClick={() => void markRoomAnswered(selectedRoom.id)}><Check size={16} /></button></IconTooltip>}
            </div>
            <div className="conversation-action-group" role="group" aria-label="Room language">
              <RoomLanguageMenu
                learningLanguage={roomLearningLanguageChoice(preferences, selectedRoom.id)}
                explanationLanguage={roomTutorLanguageChoice(preferences, selectedRoom.id)}
                learningDefaultName={languageName(languageRoles.learning, languageRoles.languages)}
                explanationDefaultName={languageName(languageRoles.defaultLanguage, languageRoles.languages)}
                languages={languageRoles.languages}
                onLearningLanguageChange={(code) => void setPreference(roomLearningLanguageKey(selectedRoom.id), code)}
                onExplanationLanguageChange={(code) => void setPreference(roomTutorLanguageKey(selectedRoom.id), code)}
              />
            </div>
            <div className="conversation-action-group" role="group" aria-label="Room details">
              <IconTooltip label="Room details">
                <button className="icon-button" type="button" aria-label="Room details" onClick={() => void openRoomInfo()}>
                  <UsersRound size={16} />
                </button>
              </IconTooltip>
              <ActionMenu key={`${activeAccountID}:${selectedRoomID}`} label="Room actions" icon={<MoreHorizontal size={18} />} count={scheduledJobCount} items={[
                { label: 'Scheduled messages and reminders', icon: <Clock3 size={16} />, onSelect: openScheduledJobs, count: scheduledJobCount },
                { label: 'Media gallery', icon: <Images size={16} />, onSelect: () => void openMediaGallery(), disabled: loadingHistory },
                { label: 'Export chat', icon: <Download size={16} />, onSelect: () => void exportSelectedRoomChat(), disabled: chatExport?.phase === 'running' },
                { label: selectedRoom.favorite ? 'Remove from Favorites' : 'Add to Favorites', icon: <Star size={16} />, active: selectedRoom.favorite, onSelect: () => void setPreference(`room.favorite.${selectedRoom.id}`, !selectedRoom.favorite) },
                { label: selectedRoom.muted ? 'Unmute room' : 'Mute room', icon: <BellOff size={16} />, active: selectedRoom.muted, onSelect: () => void setPreference(`room.muted.${selectedRoom.id}`, !selectedRoom.muted) },
              ]} />
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="conversation-title">
            <h2>Pinger</h2>
            <span>Choose a room to start chatting</span>
          </div>
          <div className="conversation-actions">
            <div className="conversation-action-group" role="group" aria-label="Conversation utilities">
              <IconTooltip label="Scheduled messages">
                <button className="icon-button scheduled-jobs-button" type="button" aria-label="Scheduled messages and reminders" onClick={openScheduledJobs}>
                  <Clock3 size={16} />{scheduledJobCount > 0 && <span className="scheduled-job-count">{scheduledJobCount}</span>}
                </button>
              </IconTooltip>
              <IconTooltip label="Search messages">
                <button className="icon-button" type="button" aria-label="Search messages" onClick={() => setSearchOpen(true)}>
                  <Search size={16} />
                </button>
              </IconTooltip>
            </div>
          </div>
        </>
      )}
    </header>
  )
})
