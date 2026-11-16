import type { Message } from '../bindings/mychat/desktop/models.js'

export type ThreadSummary = { count: number; latest: Message }

// Counts loaded replies per thread root. Messages arrive oldest first, so the last one seen is the latest.
export function summarizeThreads(messages: Message[]) {
  const summaries = new Map<string, ThreadSummary>()
  for (const message of messages) {
    const root = message.threadRootId
    if (!root) continue
    summaries.set(root, { count: (summaries.get(root)?.count ?? 0) + 1, latest: message })
  }
  return summaries
}

// Replies move under their root. A reply stays in the main timeline when its root is not loaded.
export function mainTimelineMessages(messages: Message[]) {
  const loaded = new Set<string>()
  for (const message of messages) if (message.id) loaded.add(message.id)
  if (!messages.some((message) => message.threadRootId && loaded.has(message.threadRootId))) return messages
  return messages.filter((message) => !message.threadRootId || !loaded.has(message.threadRootId))
}
