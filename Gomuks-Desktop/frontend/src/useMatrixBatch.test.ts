import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const eventHandlers = vi.hoisted(() => new Map<string, (event: { data: unknown }) => void>())

vi.mock('@wailsio/runtime', () => ({
  Events: {
    On: vi.fn((name: string, handler: (event: { data: unknown }) => void) => {
      eventHandlers.set(name, handler)
      return () => eventHandlers.delete(name)
    }),
  },
}))

import { useMatrixBatch } from './useMatrixBatch'

describe('useMatrixBatch', () => {
  afterEach(() => eventHandlers.clear())

  it('dispatches one consolidated batch and unsubscribes on unmount', () => {
    const onBatch = vi.fn()
    const { unmount } = renderHook(() => useMatrixBatch(onBatch))
    const payload = {
      new_messages: [],
      read_receipts: [],
      typing_updates: [],
      room_deltas: [{ update: { rooms: [] } }],
    }

    act(() => eventHandlers.get('matrix:batch_update')?.({ data: payload }))

    expect(onBatch).toHaveBeenCalledOnce()
    expect(onBatch).toHaveBeenCalledWith(payload)
    unmount()
    expect(eventHandlers.has('matrix:batch_update')).toBe(false)
  })
})