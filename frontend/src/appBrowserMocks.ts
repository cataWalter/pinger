import { vi } from 'vitest'
import type { Invite } from '../bindings/mychat/desktop/models.js'

export const service = (() => {
  const room = {
    id: '!browser-smoke:example.org',
    name: 'Browser smoke room',
    topic: '',
    avatar: '',
    preview: '',
    lastSeen: 0,
    direct: true,
    favorite: false,
    muted: false,
    unread: 0,
    markedUnread: false,
    mentions: 0,
    unanswered: false,
    needsReply: false,
    lastEventId: '',
    lastEventSender: '',
    lastEventAt: 0,
    accountId: 'primary',
    bridge: '',
  }
  const snapshot = {
    loggedIn: true,
    needsVerification: false,
    verification: null,
    syncReady: true,
    connectionState: 'connected',
    profile: {
      userId: '@me:example.org',
      displayName: 'Me',
      homeserver: 'https://example.org',
      deviceId: 'BROWSER',
      avatarUri: '',
      verified: true,
    },
    accountId: 'primary',
    invites: [] as Invite[],
    rooms: [room,
      { ...room, id: '!design:example.org', name: 'Design review and accessibility working group', preview: 'The updated conversation layout is ready to review.', unread: 12, mentions: 2, needsReply: true, favorite: true },
      { ...room, id: '!release:example.org', name: 'Release planning', preview: 'Can we ship the desktop improvements on Friday?', unread: 3 },
      { ...room, id: '!morgan:example.org', name: 'Morgan Lee', preview: 'Thanks, see you tomorrow.', muted: true },
    ],
    slidingSyncListCounts: { main: 1 },
    preferences: {},
  }
  const methods = {
    Snapshot: vi.fn(() => Promise.resolve(snapshot)),
    OpenExternalURL: vi.fn(() => Promise.resolve()),
    NativeNotificationsSupported: vi.fn(() => Promise.resolve(false)),
    ScheduledJobs: vi.fn(() => Promise.resolve([])),
    ThreadMessages: vi.fn((): Promise<object[]> => Promise.resolve([])),
    DeclineInvite: vi.fn(() => Promise.resolve()),
    History: vi.fn(() => Promise.resolve({
      messages: [
        { id: '$hello', transactionId: '', sender: '@morgan:example.org', senderName: 'Morgan Lee', avatar: '', body: 'I have the desktop review ready. The room list and conversation should both stay readable in a smaller window.', formattedBody: '', timestamp: 1793447100000, timelineCursor: 1, own: false, reactions: {}, reacted: {}, mediaType: '', mediaUri: '', replyToEventId: '', edited: false },
        { id: '$detail', transactionId: '', sender: '@morgan:example.org', senderName: 'Morgan Lee', avatar: '', body: 'Could you also check the theme colors and keyboard focus?', formattedBody: '', timestamp: 1793447120000, timelineCursor: 2, own: false, reactions: { '👍': 2 }, reacted: { '👍': true }, mediaType: '', mediaUri: '', replyToEventId: '', edited: true },
        { id: '$answer', transactionId: '', sender: '@me:example.org', senderName: 'Me', avatar: '', body: 'Yes. I will check the small window first, then the light and dark themes.', formattedBody: '', timestamp: 1793447160000, timelineCursor: 3, own: true, reactions: {}, reacted: {}, mediaType: '', mediaUri: '', replyToEventId: '$detail', replyToSender: 'Morgan Lee', replyToPreview: 'Could you also check the theme colors and keyboard focus?', edited: false },
        { id: '$next', transactionId: '', sender: '@morgan:example.org', senderName: 'Morgan Lee', avatar: '', body: 'Perfect. Here is the checklist:\n\n- Minimum desktop window\n- Long room names\n- Custom accent colors\n- Reduced motion', formattedBody: '', timestamp: 1793447200000, timelineCursor: 4, own: false, reactions: {}, reacted: {}, mediaType: '', mediaUri: '', replyToEventId: '', edited: false },
      ].map((message) => ({ seenAt: 0, sending: false, sendError: '', mediaMime: '', mediaSize: 0, mediaWidth: 0, mediaHeight: 0, mediaDurationMs: 0, encrypted: false, decryptionError: '', editHistory: [], redacted: false, replyToSender: '', replyToPreview: '', threadRootId: '', ...message })), before: 0, hasMore: false
    })),
    RoomMembers: vi.fn(() => Promise.resolve([])),
    ListLocalAIChats: vi.fn(() => Promise.resolve([])),
    ListLocalAIChatFolders: vi.fn(() => Promise.resolve([])),
    AIComplete: vi.fn(() => Promise.resolve('')),
    SetActiveRoom: vi.fn(() => Promise.resolve()),
    UpdateVisibleRange: vi.fn(() => Promise.resolve()),
  }
  return new Proxy(methods, {
    get(target, property) {
      return Reflect.get(target, property) ?? vi.fn(() => Promise.resolve(undefined))
    },
  })
})()
