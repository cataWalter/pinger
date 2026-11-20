import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BootScreen } from './AuthScreens'

describe('BootScreen', () => {
  afterEach(cleanup)

  it('announces the loader as a status while Pinger starts', () => {
    render(<BootScreen error="" />)

    expect(screen.getByRole('status', { name: 'Loading Pinger' }).classList.contains('is-failed')).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the startup error as an alert and marks the loader as failed', () => {
    render(<BootScreen error="Could not open the local store" />)

    expect(screen.getByRole('alert').textContent).toBe('Could not open the local store')
    expect(screen.getByRole('status', { name: 'Pinger could not start' }).classList.contains('is-failed')).toBe(true)
  })
})
