import { fireEvent, screen, within } from '@testing-library/react'
import { vi } from 'vitest'
import type { Message, Room, Snapshot } from '../bindings/mychat/desktop/models.js'

export const harness = {
  eventHandlers: new Map<string, (event: { data: unknown }) => void>(),
  markdownRenderCount: 0,
  service: {
    Snapshot: vi.fn(),
    Verify: vi.fn(),
    OpenExternalURL: vi.fn(),
    Logout: vi.fn(),
    AddAccount: vi.fn(),
    SwitchAccount: vi.fn(),
    AccountRooms: vi.fn(),
    History: vi.fn(),
    SearchMessages: vi.fn(),
    ScheduledJobs: vi.fn(),
    ScheduleMessage: vi.fn(),
    ScheduleReply: vi.fn(),
    ScheduleReminder: vi.fn(),
    UpdateScheduledJob: vi.fn(),
    CancelScheduledJob: vi.fn(),
    RetryScheduledMessage: vi.fn(),
    DismissScheduledJob: vi.fn(),
    RoomMembers: vi.fn(),
    SetActiveRoom: vi.fn(),
    UpdateVisibleRange: vi.fn(),
    SetRoomUnanswered: vi.fn(),
    SetTyping: vi.fn(),
    MarkRead: vi.fn(),
    MarkUnread: vi.fn(),
    SetBooleanPreference: vi.fn(),
    SetStringPreference: vi.fn(),
    SetStringPreferences: vi.fn(),
    NativeNotificationsSupported: vi.fn(),
    NotificationPermission: vi.fn(),
    RequestNotificationPermission: vi.fn(),
    OpenNotificationSettings: vi.fn(),
    SendNotification: vi.fn(),
    SendMessage: vi.fn(),
    SendReply: vi.fn(),
    SendMessageWithMentions: vi.fn(),
    SaveMedia: vi.fn(),
    RevealFile: vi.fn(),
    React: vi.fn(),
    RemoveReaction: vi.fn(),
    StartDirectChat: vi.fn(),
    AcceptInvite: vi.fn(),
    DeclineInvite: vi.fn(),
    JoinRoom: vi.fn(),
    CreateGroupRoom: vi.fn(),
    InviteToRoom: vi.fn(),
    URLPreview: vi.fn(),
    ThreadMessages: vi.fn(),
    SendThreadReply: vi.fn(),
    AIComplete: vi.fn(),
    AICancel: vi.fn(),
    AIGenerateReplyDraft: vi.fn(),
    AIDetectChatLanguage: vi.fn(),
    AISuggestReplies: vi.fn(),
    GenerateRoomImage: vi.fn(),
    SendRoomImage: vi.fn(),
    AIFeatureDefaults: vi.fn(),
    LocalAIChat: vi.fn(),
    ListLocalAIChats: vi.fn(),
    LoadLocalAIChatMessages: vi.fn(),
    CreateLocalAIChat: vi.fn(),
    GenerateLocalAIChatTitle: vi.fn(),
    AppendLocalAIChatMessage: vi.fn(),
    TruncateLocalAIChat: vi.fn(),
    SetLocalAIChatAgent: vi.fn(),
    RenameLocalAIChat: vi.fn(),
    DeleteLocalAIChat: vi.fn(),
    ListLocalAIChatFolders: vi.fn(),
    CreateLocalAIChatFolder: vi.fn(),
    RenameLocalAIChatFolder: vi.fn(),
    DeleteLocalAIChatFolder: vi.fn(),
    SetLocalAIChatFolder: vi.fn(),
    ExportLocalAIChat: vi.fn(),
    ChooseDownloadFolder: vi.fn(),
    ExportRoomChat: vi.fn(),
    CancelChatExport: vi.fn(),
    AITranscribeMedia: vi.fn(),
    TestAIEndpoint: vi.fn(),
    StorageUsage: vi.fn(),
    MediaCacheUsage: vi.fn(),
    ClearMediaCache: vi.fn(),
    OptimizeDatabase: vi.fn(),
    RoomStorageUsage: vi.fn(),
    ClearCachedMedia: vi.fn(),
    ExportRecentMessagesForAllChats: vi.fn(),
    AppVersion: vi.fn(),
    AppBuildInfo: vi.fn(),
    CheckForUpdates: vi.fn(),
    Devices: vi.fn(),
    RevokeDevice: vi.fn(),
    StartSessionVerification: vi.fn(),
    AcceptSessionVerification: vi.fn(),
    ConfirmSessionVerification: vi.fn(),
    CancelSessionVerification: vi.fn(),
    SetMenuState: vi.fn(),
  },
  tutorService: {
    Analyze: vi.fn(),
  },
}

export const clipboardSetText = vi.fn()

export const room: Room = {
  id: '!room:example.org',
  name: 'Test room',
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
  lastEventSeenAt: 0,
  accountId: 'primary',
  bridge: '',
}

export const secondRoom: Room = { ...room, id: '!second:example.org', name: 'Second room', unanswered: true, needsReply: true }

export function message(id: string, body: string, timestamp: number): Message {
  return {
    id,
    transactionId: '',
    sender: '@alice:example.org',
    senderName: 'Alice',
    avatar: '',
    body,
    formattedBody: '',
    replyToEventId: '',
    replyToSender: '',
    replyToPreview: '',
    threadRootId: '',
    timestamp,
    seenAt: 0,
    timelineCursor: timestamp,
    sending: false,
    sendError: '',
    own: false,
    reactions: {},
    reacted: {},
    mediaUri: '',
    mediaType: '',
    mediaMime: '',
    mediaSize: 0,
    mediaWidth: 0,
    mediaHeight: 0,
    mediaDurationMs: 0,
    encrypted: false,
    decryptionError: '',
    edited: false,
    editHistory: [],
    redacted: false,
  }
}

// Message actions live in a right-click menu now, so tests open it the same way
// a user would.
export function openMessageMenu(container: HTMLElement, eventID = '$latest') {
  const row = container.querySelector<HTMLElement>(`[data-event-id="${eventID}"]`)
  if (!row) throw new Error(`Missing timeline row for ${eventID}`)
  fireEvent.contextMenu(row, { clientX: 48, clientY: 48 })
}

export function menuCommand(label: string) {
  const direct = screen.queryByRole('button', { name: label })
  if (direct) return direct
  const roomCommands = ['Media gallery', 'Export chat', 'Scheduled messages and reminders', 'Add to Favorites', 'Remove from Favorites', 'Mute room', 'Unmute room']
  const deliveryCommands = ['Record video message', 'Schedule message', 'Schedule reply']
  const menuName = roomCommands.includes(label) ? 'Room actions' : deliveryCommands.includes(label) ? 'Delivery options' : 'AI tools'
  if (!screen.queryByRole('menu', { name: menuName })) fireEvent.click(screen.getByRole('button', { name: menuName }))
  return within(screen.getByRole('menu', { name: menuName })).getByRole(/Favorites|Mute room|Unmute room/.test(label) ? 'menuitemcheckbox' : 'menuitem', { name: label })
}

export const suggestedReplyFixture = [
  { tone: 'Direct', text: 'Sounds good!', translation: 'Sounds good!' },
  { tone: 'Playful', text: 'Maybe later?', translation: 'Maybe later?' },
  { tone: 'Formal', text: 'Let me check and tell you.', translation: 'Let me check and tell you.' },
  { tone: 'Curious', text: 'What time works for you?', translation: 'What time works for you?' },
  { tone: 'Empathetic', text: 'That sounds tough. Want to talk?', translation: 'That sounds tough. Want to talk?' },
]

export const snapshot: Snapshot = {
  loggedIn: true,
  needsVerification: false,
  verification: null,
  syncReady: true,
  connectionState: 'connected',
  profile: {
    userId: '@me:example.org',
    displayName: 'Me',
    homeserver: 'https://example.org',
    deviceId: 'DEVICE',
    avatarUri: '',
    verified: true,
  },
  accounts: [],
  activeAccountId: 'primary',
  rooms: [room],
  invites: [],
  slidingSyncListCounts: { main: 1 },
  preferences: {},
}
