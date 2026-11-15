import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUpRight, Bot, CheckCheck, FileText, MessageSquare, Sparkles, Star } from 'lucide-react'
import { AppService } from '../bindings/mychat/desktop'
import { type Room } from '../bindings/mychat/desktop/models.js'
import { isLocalAIRoomID, type LocalAIChatIcon } from './localAIChats'
import { type RoomButtonActions } from './appTypes'
import { ROOM_LIST_VIRTUALIZATION_THRESHOLD, ROOM_LIST_RANGE_PREFETCH, ROOM_LIST_MAX_SYNC_RANGE } from './appConstants'
import { avatarStyle, Avatar, networkHue } from './avatar'
import { formatTimeOrDate } from './format'
import { roomActivityAt } from './rooms'

export const LOCAL_AI_ROW_ICONS: Record<LocalAIChatIcon, typeof MessageSquare> = { agent: Bot, chat: MessageSquare, summary: FileText }

export const RoomButton = memo(function RoomButton({ room, index, active, needsReply, multiSelected, lastMessageByMe, use24Hour, showNetwork, showUnreadCounts, aiIcon, aiDraft, actionsRef }: { room: Room; index: number; active: boolean; needsReply: boolean; multiSelected: boolean; lastMessageByMe: boolean; use24Hour: boolean; showNetwork: boolean; showUnreadCounts: boolean; aiIcon?: LocalAIChatIcon; aiDraft?: string; actionsRef: { current: RoomButtonActions } }) {
  const RowIcon = LOCAL_AI_ROW_ICONS[aiIcon ?? 'chat']
  const hasUnread = room.unread > 0 || room.markedUnread
  // Rooms without a message time show their sorting time, which the sidebar is already ordered by.
  const activityAt = roomActivityAt(room)
  return (
    <button data-room-index={index} className={`room-button ${active ? 'is-active' : ''} ${multiSelected ? 'is-multiselected' : ''} ${room.muted ? 'is-muted' : ''} ${hasUnread ? 'has-unread' : ''}`} onClick={(event) => actionsRef.current.onSelect(room, index, event)} onKeyDown={(event) => actionsRef.current.onKeyDown(room, index, event)} onContextMenu={(event) => actionsRef.current.onContextMenu(room, event)} aria-current={active ? 'page' : undefined} title={room.name || room.id}>
      {isLocalAIRoomID(room.id)
        ? <span className="room-avatar room-avatar-ai" aria-hidden="true"><RowIcon size={16} /></span>
        : <Avatar uri={room.avatar} label={room.name || room.id} className="room-avatar" style={avatarStyle(room.name || room.id)} deferLoad />}
      <span className="room-copy">
        <span className="room-name">{room.favorite && <Star size={10} fill="currentColor" aria-label="Favorite" />}<span className="room-name-text">{room.name || room.id}</span>{room.muted && <span className="room-muted-mark" title="Muted">· muted</span>}{showNetwork && room.bridge && <span className="room-network" style={{ '--network-hue': networkHue(room.bridge) } as React.CSSProperties}>{room.bridge}</span>}</span>
        <span className="room-preview">
          {aiDraft
            ? <span className="room-preview-text" title="AI reply draft"><Sparkles size={11} aria-hidden="true" /> {aiDraft}</span>
            : <>
              {lastMessageByMe && room.preview && (room.lastEventSeenAt > 0
                ? <span className="room-preview-sent is-seen" role="img" aria-label="Seen" title="Seen"><CheckCheck size={11} /></span>
                : <span className="room-preview-sent" role="img" aria-label="Sent by you" title="Sent by you"><ArrowUpRight size={11} /></span>)}
              <span className={`room-preview-text ${room.preview && room.lastEventSender && !lastMessageByMe ? 'is-received' : ''}`}>{room.preview || room.topic}</span>
            </>}
        </span>
      </span>
      <span className="room-meta">
        {room.unread > 0 ? <span className="unread-count">{room.unread > 99 ? '99+' : room.unread}</span> : room.markedUnread && <span className="unread-dot" aria-label="Unread" />}
        {needsReply && !(showUnreadCounts && room.unread > 0) && <span className="needs-reply-dot" aria-label="Needs reply" title="Needs reply" />}
        {activityAt > 0 && <time>{formatTimeOrDate(activityAt, use24Hour)}</time>}
      </span>
    </button>
  )
})

export function reportRoomListVisibleRange(startIndex: number, endIndex: number) {
  void Promise.resolve(AppService.UpdateVisibleRange('main', startIndex, endIndex)).catch(() => undefined)
}

export function VirtualRoomList({ listRef, rooms, selectedRoomIndex, rowHeight, listCount, rangeKey, onVisibleRange, renderRoom, emptyContent }: {
  listRef: { current: HTMLElement | null }
  rooms: Room[]
  selectedRoomIndex: number
  rowHeight: number
  listCount: number
  rangeKey: string
  onVisibleRange: (startIndex: number, endIndex: number) => void
  renderRoom: (room: Room, index: number) => ReactNode
  emptyContent: ReactNode
}) {
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)
  const pendingScrollTop = useRef(0)
  const scrollFrame = useRef(0)
  const virtualized = rooms.length > ROOM_LIST_VIRTUALIZATION_THRESHOLD
  const overscan = 8
  const first = Math.min(rooms.length, Math.max(0, Math.floor(scrollTop / rowHeight) - overscan))
  const visibleEnd = Math.min(rooms.length, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan)
  const knownListCount = Math.max(rooms.length, listCount)
  const requestedEnd = visibleEnd >= rooms.length && rooms.length < knownListCount
    ? Math.min(knownListCount, rooms.length + ROOM_LIST_RANGE_PREFETCH)
    : visibleEnd
  const rangeEnd = Math.min(requestedEnd, first + ROOM_LIST_MAX_SYNC_RANGE)

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const updateSize = () => {
      setViewportHeight(list.clientHeight || 600)
      pendingScrollTop.current = list.scrollTop
      setScrollTop(list.scrollTop)
    }
    updateSize()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize)
      return () => window.removeEventListener('resize', updateSize)
    }
    const observer = new ResizeObserver(updateSize)
    observer.observe(list)
    return () => observer.disconnect()
  }, [listRef])

  useEffect(() => () => {
    if (scrollFrame.current) window.cancelAnimationFrame(scrollFrame.current)
  }, [])

  useEffect(() => {
    if (rangeEnd <= first) return
    onVisibleRange(first, rangeEnd)
  }, [first, onVisibleRange, rangeEnd, rangeKey])

  useEffect(() => {
    const list = listRef.current
    if (!virtualized || !list || selectedRoomIndex < 0) return
    const top = selectedRoomIndex * rowHeight
    if (top < list.scrollTop || top + rowHeight > list.scrollTop + viewportHeight) {
      list.scrollTop = top
      pendingScrollTop.current = top
      setScrollTop(top)
    }
  }, [listRef, rowHeight, selectedRoomIndex, virtualized, viewportHeight])

  function handleScroll(event: React.UIEvent<HTMLElement>) {
    pendingScrollTop.current = event.currentTarget.scrollTop
    if (scrollFrame.current) return
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = 0
      setScrollTop(pendingScrollTop.current)
    })
  }

  let content: ReactNode
  if (rooms.length === 0) {
    content = emptyContent
  } else if (!virtualized) {
    content = rooms.map((room, index) => renderRoom(room, index))
  } else {
    content = (
      <div className="room-list-virtual-content" style={{ height: rooms.length * rowHeight }}>
        {rooms.slice(first, visibleEnd).map((room, offset) => {
          const index = first + offset
          return <div className="room-list-virtual-row" key={`${room.accountId}:${room.id}`} style={{ top: index * rowHeight }}>{renderRoom(room, index)}</div>
        })}
      </div>
    )
  }

  return (
    <nav
      ref={(element) => { listRef.current = element }}
      className={`room-list ${virtualized ? 'is-virtualized' : ''}`}
      aria-label="Rooms"
      onScroll={handleScroll}
      style={virtualized ? { '--room-row-height': `${rowHeight}px` } as React.CSSProperties : undefined}
    >
      {content}
    </nav>
  )
}
