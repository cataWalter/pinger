import { test } from 'vitest'
import type { Message, Room } from '../bindings/mychat/desktop/models.js'
import { mergeTimelineMessages, reconcileRoomSnapshots } from './appShared'

const currentMessages = Array.from({ length: 5_000 }, (_, index) => ({
  id: `$event-${index}`,
  transactionId: '',
  timestamp: index,
}) as Message)

const incomingMessages = Array.from({ length: 5_000 }, (_, index) => ({
  id: `$event-${index < 2_500 ? index : 5_000 + index}`,
  transactionId: '',
  timestamp: index,
}) as Message)

const currentRooms = Array.from({ length: 1_000 }, (_, index) => ({
  id: `!room-${index}:example.org`,
  accountId: 'primary',
  name: `Room ${index}`,
}) as Room)

const incomingRooms = currentRooms.map((room) => ({ ...room }))

test('large collection performance', async ({ bench }) => {
  await bench('merge 5,000 current and 5,000 incoming messages under 250 ms', () => {
    const started = performance.now()
    const merged = mergeTimelineMessages(currentMessages, incomingMessages)
    const elapsed = performance.now() - started
    if (merged.length !== 7_500) throw new Error(`Expected 7,500 messages, got ${merged.length}.`)
    if (elapsed > 250) throw new Error(`Message merge took ${elapsed.toFixed(1)} ms.`)
  }).run()

  await bench('reconcile 1,000 rooms under 100 ms', () => {
    const started = performance.now()
    const reconciled = reconcileRoomSnapshots(currentRooms, incomingRooms)
    const elapsed = performance.now() - started
    if (reconciled !== currentRooms) throw new Error('Unchanged room snapshots should preserve the current array.')
    if (elapsed > 100) throw new Error(`Room reconciliation took ${elapsed.toFixed(1)} ms.`)
  }).run()
})