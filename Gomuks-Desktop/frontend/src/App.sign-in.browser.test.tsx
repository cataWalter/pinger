import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { page } from 'vitest/browser'
import { describe, expect, it, vi } from 'vitest'
import { service } from './appBrowserMocks'
import { captureScreenshot, installAppBrowserCleanup, renderApp, settleSurfaces } from './appBrowserHarness'

vi.mock('@wailsio/runtime', () => ({
  Call: { ByName: vi.fn(() => Promise.resolve()) },
  Clipboard: { SetText: vi.fn(() => Promise.resolve()) },
  Events: { On: vi.fn(() => () => { }) },
}))

vi.mock('../bindings/mychat/desktop', async () => ({
  AppService: (await import('./appBrowserMocks')).service,
  LanguageTutorService: { Analyze: vi.fn(() => Promise.resolve({})) },
}))

installAppBrowserCleanup()

describe('browser smoke: sign-in', () => {
  it.each([
    [390, 844],
    [760, 600],
    [1100, 780],
  ] as const)('keeps Beeper onboarding usable at %i x %i', async (width, height) => {
    await page.viewport(width, height)
    const snapshot = await service.Snapshot()
    service.Snapshot.mockResolvedValueOnce({ ...snapshot, loggedIn: false })
    const { container } = renderApp()
    await screen.findByRole('heading', { name: 'Sign in' })
    await document.fonts.ready
    await settleSurfaces()
    const main = container.querySelector<HTMLElement>('.auth-screen-signin')!
    const guide = container.querySelector<HTMLDetailsElement>('.beeper-onboarding')!
    const logo = container.querySelector<HTMLImageElement>('.auth-brand img')!
    await logo.decode()
    expect(logo.naturalWidth).toBeGreaterThan(0)
    expect(logo.getBoundingClientRect().width).toBeLessThanOrEqual(48)
    const homeserver = screen.getByLabelText('Homeserver') as HTMLInputElement
    const username = screen.getByLabelText('Username') as HTMLInputElement
    const password = screen.getByLabelText('Password') as HTMLInputElement
    fireEvent.change(homeserver, { target: { value: 'https://other.example.org/' } })
    fireEvent.change(username, { target: { value: '@test_user:beeper.com' } })
    fireEvent.change(password, { target: { value: 'test matrix password' } })
    await page.getByRole('button', { name: 'Use Beeper Homeserver' }).click()
    expect(homeserver.value).toBe('https://matrix.beeper.com/')
    expect(username.value).toBe('@test_user:beeper.com')
    expect(password.value).toBe('test matrix password')
    expect(guide.open).toBe(false)
    await expect.element(guide.querySelector('button')!).not.toBeVisible()
    expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth)
    const shortcut = screen.getByRole('button', { name: 'Use Beeper Homeserver' }).getBoundingClientRect()
    const label = screen.getByText('Homeserver').getBoundingClientRect()
    expect(shortcut.left).toBeGreaterThanOrEqual(label.right)
    expect(shortcut.bottom).toBeLessThanOrEqual(homeserver.getBoundingClientRect().top)
    await captureScreenshot({ path: `../.vitest/ui/beeper-signin-${width}.png` })
    await page.getByText('Using Beeper with Pinger?').click()
    expect(guide.open).toBe(true)
    expect(within(guide).getAllByRole('listitem')).toHaveLength(3)
    await expect.element(page.getByRole('button', { name: 'Download official Beeper app' })).toBeVisible()
    for (const element of main.querySelectorAll<HTMLElement>('.auth-form input, .auth-helper-button, .beeper-onboarding summary, .beeper-onboarding li')) {
      const bounds = element.getBoundingClientRect()
      expect(bounds.left).toBeGreaterThanOrEqual(-1)
      expect(bounds.right).toBeLessThanOrEqual(width + 1)
    }
    expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth)
    for (const button of main.querySelectorAll<HTMLElement>('.auth-helper-button')) {
      expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(32)
      expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1)
    }
    const calls = service.OpenExternalURL.mock.calls.length
    await page.getByRole('button', { name: 'Download official Beeper app' }).click()
    expect(service.OpenExternalURL.mock.calls.length).toBe(calls + 1)
    expect(service.OpenExternalURL).toHaveBeenLastCalledWith('https://www.beeper.com/download')
    expect(username.value).toBe('@test_user:beeper.com')
    expect(password.value).toBe('test matrix password')
    const downloadBounds = screen.getByRole('button', { name: 'Download official Beeper app' }).getBoundingClientRect()
    expect(downloadBounds.top).toBeGreaterThanOrEqual(0)
    expect(downloadBounds.bottom).toBeLessThanOrEqual(height + 1)
    await captureScreenshot({ path: `../.vitest/ui/beeper-onboarding-${width}.png` })
    await page.getByText('Using Beeper with Pinger?').click()
    expect(guide.open).toBe(false)
    expect(username.value).toBe('@test_user:beeper.com')
    expect(password.value).toBe('test matrix password')
  })

  it('loads the app artwork on the sign-in screen', async () => {
    await page.viewport(1100, 780)
    const snapshot = await service.Snapshot()
    service.Snapshot.mockResolvedValueOnce({ ...snapshot, loggedIn: false })
    renderApp()
    await waitFor(() => expect(document.querySelector('.auth-side-mark')).not.toBeNull())
    const artwork = document.querySelector<HTMLImageElement>('.auth-side-mark')!
    await artwork.decode()
    const brand = document.querySelector<HTMLImageElement>('.auth-brand .brand-glyph')!
    await brand.decode()
    expect(brand.src).toBe(artwork.src)
    expect(artwork.naturalWidth).toBe(1024)
    expect(artwork.naturalHeight).toBe(1024)
    const bounds = artwork.getBoundingClientRect()
    expect(bounds.width).toBe(112)
    expect(bounds.height).toBe(112)
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(1100)
    await captureScreenshot({ path: '../.vitest/ui/sign-in-artwork.png' })
  })

})
