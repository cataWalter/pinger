import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { harness } from './appTestSetup'
import { AIStatusBanner } from './AIStatusBanner'
import { StorageSettingsTab } from './StorageUsageSettings'

vi.mock('@wailsio/runtime', async () => {
  const { harness } = await import('./appTestSetup')
  return {
    Events: {
      On: vi.fn((name: string, handler: (event: { data: unknown }) => void) => {
        harness.eventHandlers.set(name, handler)
        return () => harness.eventHandlers.delete(name)
      }),
    },
  }
})

vi.mock('../bindings/mychat/desktop', async () => {
  const { harness } = await import('./appTestSetup')
  return { AppService: harness.service }
})

describe('AIStatusBanner and StorageSettingsTab enhancements', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    harness.eventHandlers.clear()
    harness.service.AccountCleanupPending.mockResolvedValue(false)
    harness.service.StorageUsage.mockResolvedValue({ databaseBytes: 1024, walBytes: 256 })
    harness.service.MediaCacheUsage.mockResolvedValue({ bytes: 2048, files: 3 })
    harness.service.RoomStorageUsage.mockResolvedValue([])
    harness.service.TestAIEndpoint.mockResolvedValue(undefined)
  })

  it('shows AI provider cooldown warning and clears it on retry', async () => {
    render(<AIStatusBanner />)
    expect(screen.queryByRole('status')).toBeNull()

    await act(async () => {
      harness.eventHandlers.get('ai:provider_status')?.({
        data: {
          status: 'cooldown',
          provider: 'openai-compatible',
          endpoint: 'http://127.0.0.1:8080',
          error: 'connection refused',
          failureCount: 2,
        },
      })
    })

    expect(screen.getByRole('status').textContent).toContain('AI endpoint unreachable; pausing requests briefly.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry AI connection' }))
    await waitFor(() => expect(harness.service.TestAIEndpoint).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })

  it('lets users configure automatic media cache size and age limits', async () => {
    const onPreferenceChange = vi.fn()
    render(<StorageSettingsTab preferences={{ 'storage.media_max_size_mb': '512', 'storage.media_max_age_days': '30' }} onPreferenceChange={onPreferenceChange} />)

    const sizeSelect = await screen.findByLabelText('Media cache size limit') as HTMLSelectElement
    const ageSelect = screen.getByLabelText('Delete cached media older than') as HTMLSelectElement
    expect(sizeSelect.value).toBe('512')
    expect(ageSelect.value).toBe('30')

    fireEvent.change(sizeSelect, { target: { value: '1024' } })
    fireEvent.change(ageSelect, { target: { value: '90' } })
    expect(onPreferenceChange).toHaveBeenCalledWith('storage.media_max_size_mb', '1024')
    expect(onPreferenceChange).toHaveBeenCalledWith('storage.media_max_age_days', '90')
  })
})
