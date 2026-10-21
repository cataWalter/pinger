import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContactDossierSnapshot } from '../bindings/mychat/desktop/models.js'
import ContactHUD from './ContactHUD'

const harness = vi.hoisted(() => ({
  eventHandlers: new Map<string, (event: { data: any }) => void>(),
  service: {
    ContactDossier: vi.fn(),
    RefreshContactDossier: vi.fn(),
  },
}))

vi.mock('@wailsio/runtime', () => ({
  Events: {
    On: vi.fn((name: string, handler: (event: { data: any }) => void) => {
      harness.eventHandlers.set(name, handler)
      return () => harness.eventHandlers.delete(name)
    }),
  },
}))

vi.mock('../bindings/mychat/desktop', () => ({ AppService: harness.service }))

const dossier: ContactDossierSnapshot = {
  accountId: 'primary',
  roomId: '!room:example.org',
  contactId: '@alex:example.org',
  displayName: 'Alex Rivera',
  tier: 'VIP',
  linkedChannels: ['Matrix', 'Telegram'],
  enabled: true,
  analyzing: false,
  insufficientData: false,
  keyFacts: ['Moving to Berlin', 'Likes Rust'],
  lastRecap: 'They discussed the move to Berlin. They agreed to compare apartments next week.',
  unresolvedCommitments: ['Send the apartment listing'],
  updatedAt: 1792600000000,
  error: '',
}

describe('ContactHUD', () => {
  afterEach(cleanup)

  beforeEach(() => {
    harness.eventHandlers.clear()
    harness.service.ContactDossier.mockResolvedValue(dossier)
    harness.service.RefreshContactDossier.mockResolvedValue({ ...dossier, lastRecap: 'They chose a neighborhood. They plan to visit it next month.' })
  })

  it('shows contact badges and its dossier accordion sections', async () => {
    render(<ContactHUD accountID="primary" roomID={dossier.roomId} onClose={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: 'Alex Rivera' })).toBeTruthy()
    expect(screen.getByText('VIP')).toBeTruthy()
    expect(screen.getByText('Telegram')).toBeTruthy()
    expect(screen.getByText('Moving to Berlin')).toBeTruthy()
    expect(screen.getByText('Likes Rust')).toBeTruthy()
    expect(screen.getByText('They discussed the move to Berlin. They agreed to compare apartments next week.')).toBeTruthy()
    expect(screen.getByText('Send the apartment listing')).toBeTruthy()
  })

  it('refreshes the dossier without blocking the panel', async () => {
    const user = userEvent.setup()
    render(<ContactHUD accountID="primary" roomID={dossier.roomId} onClose={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'Refresh Dossier' }))
    await waitFor(() => expect(harness.service.RefreshContactDossier).toHaveBeenCalledWith(dossier.roomId))
    expect(await screen.findByText('They chose a neighborhood. They plan to visit it next month.')).toBeTruthy()
  })

  it('applies asynchronous dossier updates for the active room', async () => {
    render(<ContactHUD accountID="primary" roomID={dossier.roomId} onClose={vi.fn()} />)
    await screen.findByRole('heading', { name: 'Alex Rivera' })

    act(() => harness.eventHandlers.get('contact-dossier:update')?.({ data: { ...dossier, keyFacts: ['Location: Berlin', 'Prefers Signal'] } }))
    expect(await screen.findByText('Prefers Signal')).toBeTruthy()
  })

  it('explains when a new contact has fewer than three messages', async () => {
    harness.service.ContactDossier.mockResolvedValue({ ...dossier, keyFacts: [], lastRecap: '', unresolvedCommitments: [], insufficientData: true })
    render(<ContactHUD accountID="primary" roomID={dossier.roomId} onClose={vi.fn()} />)

    expect(await screen.findByText(/at least three messages/i)).toBeTruthy()
  })
})