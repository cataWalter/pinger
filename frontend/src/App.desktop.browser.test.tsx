import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { commands, page } from 'vitest/browser'
import { describe, expect, it, vi } from 'vitest'
import { accentPaletteFor, contrastRatio } from './accent'
import { themeCssVariables, themes } from './themes'
import { captureScreenshot, installAppBrowserCleanup, renderApp, rgbHex, settleSurfaces } from './appBrowserHarness'

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

describe('browser smoke: desktop', () => {
  it('shows real staged image previews without filenames and keeps file attachments named', async () => {
    const user = userEvent.setup()
    await page.viewport(760, 600)
    renderApp()
    await screen.findByText('Minimum desktop window', {}, { timeout: 5000 })
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 200
    const context = canvas.getContext('2d')!
    context.fillStyle = '#e7edf2'
    context.fillRect(0, 0, 320, 200)
    context.fillStyle = '#2b7389'
    context.fillRect(24, 24, 168, 152)
    context.fillStyle = '#b75a56'
    context.fillRect(208, 24, 88, 64)
    context.fillStyle = '#578362'
    context.fillRect(208, 104, 88, 72)
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG fixture could not be created')), 'image/png'))
    const input = document.querySelector<HTMLInputElement>('.composer input[type="file"]')!
    await user.upload(input, new File([png], 'image.png', { type: 'image/png' }))
    const attachments = await screen.findByRole('list', { name: 'Attachments to send' })
    const preview = within(attachments).getByRole<HTMLImageElement>('img', { name: 'Image attachment preview' })
    await preview.decode()
    expect(preview.complete).toBe(true)
    expect(preview.naturalWidth).toBe(320)
    expect(getComputedStyle(preview).objectFit).toBe('contain')
    expect(preview.closest('li')!.getBoundingClientRect().width).toBe(120)
    expect(preview.closest('li')!.getBoundingClientRect().height).toBe(96)
    expect(within(attachments).queryByText('image.png')).toBeNull()
    expect(within(attachments).getByRole('button', { name: 'Remove image.png' }).getAttribute('title')).toBe('Remove attachment')
    await captureScreenshot({ path: '../.vitest/ui/staged-image-760.png' })

    for (const name of ['second.png', 'third.png', 'fourth.png']) {
      await user.upload(input, new File([png], name, { type: 'image/png' }))
    }
    await user.upload(input, new File(['Review notes'], 'notes.txt', { type: 'text/plain' }))
    expect(within(attachments).getByText('notes.txt')).toBeTruthy()
    expect(within(attachments).getAllByRole('img', { name: 'Image attachment preview' })).toHaveLength(4)
    const shell = document.querySelector<HTMLElement>('.app-shell')!
    for (const themeID of ['light', 'dark']) {
      shell.dataset.theme = themeID
      shell.dataset.themeMode = themeID
      for (const [key, value] of Object.entries(themeCssVariables(themeID, accentPaletteFor('Ocean'), '#236b52'))) shell.style.setProperty(key, value)
      document.documentElement.style.fontSize = '125%'
      shell.dataset.fontSize = 'large'
      expect(attachments.scrollHeight).toBeGreaterThan(attachments.clientHeight)
      expect(attachments.getBoundingClientRect().right).toBeLessThanOrEqual(761)
      expect(screen.getByRole('button', { name: 'Send message' }).getBoundingClientRect().bottom).toBeLessThanOrEqual(601)
      await captureScreenshot({ path: `../.vitest/ui/staged-images-${themeID}-125-percent.png` })
    }
    document.documentElement.style.fontSize = ''
    await user.click(within(attachments).getByRole('button', { name: 'Remove image.png' }))
    expect(within(attachments).getAllByRole('img', { name: 'Image attachment preview' })).toHaveLength(3)
    expect(within(attachments).getByText('notes.txt')).toBeTruthy()
    await page.viewport(1100, 780)
  })

  it('keeps themes and menus usable across native desktop window sizes', async () => {
    const user = userEvent.setup()
    renderApp()
    await screen.findByText('I have the desktop review ready. The room list and conversation should both stay readable in a smaller window.')
    await screen.findByText('Minimum desktop window')
    expect(document.querySelector<HTMLElement>('.markdown-message ul')!.clientHeight).toBeLessThan(140)
    await document.fonts.ready
    const shell = document.querySelector<HTMLElement>('.app-shell')!

    for (const [width, height] of [[760, 600], [1100, 780], [1440, 900]]) {
      await page.viewport(width, height)
      expect(shell.getBoundingClientRect().right).toBeLessThanOrEqual(width + 1)
      for (const theme of themes) {
        shell.dataset.theme = theme.id
        shell.dataset.themeMode = theme.mode
        const variables = themeCssVariables(theme.id, accentPaletteFor('Ocean'), theme.bubbleColor)
        for (const [key, value] of Object.entries(variables)) shell.style.setProperty(key, value)
        shell.style.setProperty('--own-bubble', theme.bubbleColor)
        for (const selector of ['.conversation-header', '.composer', '.timeline']) {
          const element = document.querySelector<HTMLElement>(selector)!
          const bounds = element.getBoundingClientRect()
          expect(bounds.left, `${theme.name} ${selector}`).toBeGreaterThanOrEqual(0)
          expect(bounds.right, `${theme.name} ${selector}`).toBeLessThanOrEqual(width + 1)
          expect(bounds.bottom, `${theme.name} ${selector}`).toBeLessThanOrEqual(height + 1)
        }
        const header = getComputedStyle(document.querySelector('.conversation-header')!)
        expect(contrastRatio(rgbHex(header.color), rgbHex(header.backgroundColor)), theme.name).toBeGreaterThanOrEqual(4.5)
        const unread = getComputedStyle(document.querySelector('.unread-count')!)
        expect(contrastRatio(rgbHex(unread.color), rgbHex(unread.backgroundColor)), `${theme.name} unread count`).toBeGreaterThanOrEqual(4.5)
        const actionIcons = shell.querySelectorAll<SVGSVGElement>('.icon-button > .lucide')
        expect(actionIcons.length).toBeGreaterThan(5)
        for (const icon of actionIcons) {
          const style = getComputedStyle(icon)
          expect(style.width).toBe('18px')
          expect(style.height).toBe('18px')
          expect(style.strokeWidth).toBe('1.8px')
          const bounds = icon.getBoundingClientRect()
          const button = icon.parentElement!.getBoundingClientRect()
          expect(bounds.left).toBeGreaterThanOrEqual(button.left)
          expect(bounds.right).toBeLessThanOrEqual(button.right)
          expect(bounds.top).toBeGreaterThanOrEqual(button.top)
          expect(bounds.bottom).toBeLessThanOrEqual(button.bottom)
        }
        if (width !== 1440 || theme.id === 'light') await captureScreenshot({ path: `../.vitest/ui/${theme.id}-${width}.png` })
      }
    }

    await page.viewport(760, 600)
    shell.dataset.fontSize = 'large'
    document.documentElement.style.fontSize = '125%'
    const send = screen.getByRole('button', { name: 'Send message' }).getBoundingClientRect()
    expect(send.right).toBeLessThanOrEqual(761)
    expect(send.bottom).toBeLessThanOrEqual(601)
    await user.click(screen.getByRole('button', { name: 'Room actions' }))
    const roomMenu = await screen.findByRole('menu', { name: 'Room actions' })
    expect(within(roomMenu).getByRole('menuitem', { name: 'Media gallery' })).toBeTruthy()
    await user.keyboard('{End}')
    expect(document.activeElement?.textContent).toContain('Mute room')
    await user.keyboard('{Escape}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Room actions' }))
    await user.click(screen.getByRole('button', { name: 'Room actions' }))
    await user.click(screen.getByRole('button', { name: 'Room actions' }))
    expect(screen.queryByRole('menu', { name: 'Room actions' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Room actions' }))
    expect(screen.queryByRole('toolbar', { name: 'Formatting' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Formatting' }))
    const bold = within(await screen.findByRole('toolbar', { name: 'Formatting' })).getByRole('button', { name: 'Bold' })
    expect(bold.getBoundingClientRect().top).toBeGreaterThanOrEqual(0)
    await user.click(screen.getByRole('button', { name: 'Formatting' }))
    const aiTools = screen.getByRole('group', { name: 'AI tools' })
    expect(aiTools.getBoundingClientRect().right).toBeLessThanOrEqual(761)
    expect(aiTools.getBoundingClientRect().top).toBeGreaterThanOrEqual(0)
    await captureScreenshot({ path: '../.vitest/ui/large-font-125-percent.png' })
    document.documentElement.style.fontSize = ''
    await page.viewport(1100, 780)
  })

  it('keeps settings and room details bounded at large-font minimum desktop size', async () => {
    const user = userEvent.setup()
    await page.viewport(760, 600)
    renderApp()
    await screen.findByRole('textbox', { name: 'Message' })
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    const settings = await screen.findByRole('dialog', { name: 'Settings' })
    await user.click(within(settings).getByRole('tab', { name: 'Appearance' }))
    await settleSurfaces()
    for (const theme of themes) {
      await user.click(within(settings).getByRole('button', { name: `${theme.name} theme` }))
      await waitFor(() => expect(document.querySelector<HTMLElement>('.app-shell')!.dataset.theme).toBe(theme.id))
      expect(settings.getBoundingClientRect().right).toBeLessThanOrEqual(761)
      expect(settings.getBoundingClientRect().bottom).toBeLessThanOrEqual(601)
      await captureScreenshot({ path: `../.vitest/ui/settings-${theme.id}-760.png` })
    }
    await user.selectOptions(within(settings).getByRole('combobox', { name: /Font size/ }), 'Large')
    const zoom = within(settings).getByRole('slider', { name: 'App zoom' })
    fireEvent.change(zoom, { target: { value: '125' } })
    fireEvent.pointerUp(zoom)
    expect(settings.getBoundingClientRect().right).toBeLessThanOrEqual(761)
    expect(settings.getBoundingClientRect().bottom).toBeLessThanOrEqual(601)
    await captureScreenshot({ path: '../.vitest/ui/settings-large-font-125-percent.png' })
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Room details' }))
    const details = await screen.findByRole('dialog', { name: 'Browser smoke room' })
    await settleSurfaces()
    expect(details.getBoundingClientRect().right).toBeLessThanOrEqual(761)
    expect(details.getBoundingClientRect().bottom).toBeLessThanOrEqual(601)
    await captureScreenshot({ path: '../.vitest/ui/room-details-large-font.png' })
    await user.keyboard('{Escape}')
    await page.viewport(1100, 780)
  })

  it('suppresses decorative motion when reduced motion is requested', async () => {
    await commands.setReducedMotion(true)
    try {
      renderApp()
      await screen.findByRole('textbox', { name: 'Message' })
      await screen.findByText('I have the desktop review ready. The room list and conversation should both stay readable in a smaller window.')
      expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true)
      const row = document.querySelector<HTMLElement>('.message-row')!
      row.dataset.liveMessage = 'true'
      expect(getComputedStyle(row).animationName).toBe('none')
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'Room actions' }))
      const menu = await screen.findByRole('menu', { name: 'Room actions' })
      expect(parseFloat(getComputedStyle(menu).animationDuration)).toBeLessThanOrEqual(0.00001)
    } finally {
      await commands.setReducedMotion(false)
    }
  })

})
