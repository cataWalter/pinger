export const storageMediaOptions: Array<{ value: string; label: string }> = [
  { value: '', label: 'All media' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
  { value: 'audio', label: 'Audio' },
  { value: 'file', label: 'Files' },
  { value: 'other', label: 'Other' },
]

export const storageAgeOptions: Array<{ value: string; label: string }> = [
  { value: '', label: 'Any age' },
  { value: '30', label: 'Older than 30 days' },
  { value: '90', label: 'Older than 90 days' },
  { value: '365', label: 'Older than 1 year' },
]

export const storageChatLimit = 10

export type BulkChatExportProgressEvent = { done: number; total: number; room: string; failed: number }

export const recentExportMaxMessages = 1000

export type RecentExportOptions = { privateChats: boolean; groupChats: boolean; myMessages: boolean; theirMessages: boolean; deletedMessages: boolean }

export const defaultRecentExportOptions: RecentExportOptions = { privateChats: true, groupChats: true, myMessages: true, theirMessages: true, deletedMessages: false }
