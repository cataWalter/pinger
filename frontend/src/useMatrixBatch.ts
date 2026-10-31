import { useEffect, useEffectEvent } from 'react'
import { Events } from '@wailsio/runtime'
import type { Message } from '../bindings/mychat/desktop/models.js'

export type MessageItem = {
  roomId: string
  message: Message
}

export type ReadReceiptItem = {
  roomId: string
  eventId: string
  userId: string
  timestamp: number
}

export type TypingItem = {
  roomId: string
  userIds: string[]
}

export type RoomDeltaItem<TUpdate> = {
  update: TUpdate
}

export type MatrixBatchPayload<TUpdate = unknown> = {
  new_messages: MessageItem[] | null
  read_receipts: ReadReceiptItem[] | null
  typing_updates: TypingItem[] | null
  room_deltas: RoomDeltaItem<TUpdate>[] | null
}

export function useMatrixBatch<TUpdate>(onBatch: (batch: MatrixBatchPayload<TUpdate>) => void) {
  const handleBatch = useEffectEvent(onBatch)

  useEffect(() => Events.On('matrix:batch_update', (event: { data: unknown }) => {
    const batch = event.data as MatrixBatchPayload<TUpdate>
    handleBatch(batch)
  }), [])
}