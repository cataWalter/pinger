import { type Room } from '../bindings/mychat/desktop/models.js'
import { fuzzyScore } from './fuzzy'
import { isLocalAIRoomID } from './localAIChats'
import { isSameDay } from './format'

export function sameRoomSnapshot(leftRoom: Room, rightRoom: Room) {
  return leftRoom.id === rightRoom.id
    && leftRoom.name === rightRoom.name
    && leftRoom.topic === rightRoom.topic
    && leftRoom.avatar === rightRoom.avatar
    && leftRoom.preview === rightRoom.preview
    && leftRoom.lastSeen === rightRoom.lastSeen
    && leftRoom.direct === rightRoom.direct
    && leftRoom.favorite === rightRoom.favorite
    && leftRoom.muted === rightRoom.muted
    && leftRoom.unread === rightRoom.unread
    && leftRoom.markedUnread === rightRoom.markedUnread
    && leftRoom.mentions === rightRoom.mentions
    && leftRoom.unanswered === rightRoom.unanswered
    && leftRoom.needsReply === rightRoom.needsReply
    && leftRoom.lastEventId === rightRoom.lastEventId
    && leftRoom.lastEventSender === rightRoom.lastEventSender
    && leftRoom.lastEventAt === rightRoom.lastEventAt
    && leftRoom.bridge === rightRoom.bridge
    && leftRoom.accountId === rightRoom.accountId
}

export function reconcileRoomSnapshots(currentRooms: Room[] | null, incomingRooms: Room[]) {
  if (!currentRooms) return incomingRooms
  const previousByKey = new Map(currentRooms.map((room) => [`${room.accountId}\u0000${room.id}`, room]))
  let unchanged = currentRooms.length === incomingRooms.length
  const rooms = incomingRooms.map((room, index) => {
    const previous = previousByKey.get(`${room.accountId}\u0000${room.id}`)
    if (!previous || !sameRoomSnapshot(previous, room)) {
      unchanged = false
      return room
    }
    if (currentRooms[index] !== previous) unchanged = false
    return previous
  })
  return unchanged ? currentRooms : rooms
}

export function isDirectLikeRoom(room: Room) {
  return room.direct || room.bridge === 'IG'
}

// Matrix flags rooms whose last message is not from you. Only direct and Instagram chats count; Local AI chats never do.
export function isUnansweredRoom(room: Room) {
  return !isLocalAIRoomID(room.id) && room.unanswered && isDirectLikeRoom(room)
}

// Unanswered rooms that are not marked answered for their latest event.
export function isNeedsReplyRoom(room: Room) {
  return isUnansweredRoom(room) && room.needsReply
}

export function isUnreadRoom(room: Room) {
  return room.unread > 0 || room.markedUnread
}

export function roomActivityAt(room: Room) {
  return room.lastEventAt > 0 ? room.lastEventAt : room.lastSeen
}

export function compareRoomActivity(left: Room, right: Room, today: number) {
  const leftActivity = roomActivityAt(left)
  const rightActivity = roomActivityAt(right)
  const leftDate = new Date(leftActivity)
  const rightDate = new Date(rightActivity)
  leftDate.setHours(0, 0, 0, 0)
  rightDate.setHours(0, 0, 0, 0)
  const dateOrder = rightDate.getTime() - leftDate.getTime()
  if (dateOrder !== 0) return dateOrder
  if (leftActivity > 0 && isSameDay(leftActivity, today)) return rightActivity - leftActivity
  return 0
}

export function rankQuickSwitcherRooms(rooms: Room[], query: string) {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return rooms
  const ranked: { room: Room; score: number; index: number }[] = []
  rooms.forEach((room, index) => {
    const nameScore = fuzzyScore(normalizedQuery, room.name)
    const idScore = fuzzyScore(normalizedQuery, room.id)
    if (nameScore === null && idScore === null) return
    ranked.push({ room, score: Math.max(nameScore ?? Number.NEGATIVE_INFINITY, idScore ?? Number.NEGATIVE_INFINITY), index })
  })
  return ranked.sort((left, right) => right.score - left.score || left.index - right.index).map(({ room }) => room)
}
