import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Verification } from '../bindings/mychat/desktop/models.js'
import { VerificationDialog } from './VerificationDialog'

const service = vi.hoisted(() => ({
  AcceptSessionVerification: vi.fn(),
  CancelSessionVerification: vi.fn(),
  ConfirmSessionVerification: vi.fn(),
}))

vi.mock('../bindings/mychat/desktop', () => ({ AppService: service }))

const verification: Verification = {
  transactionId: 'txn-1',
  userId: '@alice:example.org',
  deviceId: 'ALICEPHONE',
  incoming: true,
  phase: 'requested',
  emojis: [],
  decimals: [],
  reason: '',
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('VerificationDialog', () => {
  it('accepts an incoming verification request', async () => {
    service.AcceptSessionVerification.mockResolvedValue(undefined)
    render(<VerificationDialog verification={verification} />)

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))

    await waitFor(() => expect(service.AcceptSessionVerification).toHaveBeenCalledOnce())
  })

  it('shows the SAS emojis and confirms only when they match', async () => {
    service.ConfirmSessionVerification.mockResolvedValue(undefined)
    render(<VerificationDialog verification={{
      ...verification,
      phase: 'comparing',
      emojis: [{ emoji: '🐶', description: 'Dog' }, { emoji: '🌳', description: 'Tree' }],
      decimals: [123, 456],
    }} />)

    expect(screen.getByLabelText('Compare these emoji with the other session').textContent).toContain('Dog')
    fireEvent.click(screen.getByRole('button', { name: 'They match' }))

    await waitFor(() => expect(service.ConfirmSessionVerification).toHaveBeenCalledOnce())
  })

  it('cancels mismatching SAS and dismisses a completed verification', async () => {
    service.CancelSessionVerification.mockResolvedValue(undefined)
    const { rerender } = render(<VerificationDialog verification={{ ...verification, phase: 'comparing' }} />)

    fireEvent.click(screen.getByRole('button', { name: 'They do not match' }))
    await waitFor(() => expect(service.CancelSessionVerification).toHaveBeenCalledWith(true))

    rerender(<VerificationDialog verification={{ ...verification, phase: 'done' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(service.CancelSessionVerification).toHaveBeenLastCalledWith(false))
  })
})
