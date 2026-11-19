import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { page } from 'vitest/browser'
import { describe, expect, it, vi } from 'vitest'
import { LanguageTutorService } from '../bindings/mychat/desktop'
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

describe('browser smoke: chat layout', () => {
  it.each([
    [390, 844, 100, 'Light', true],
    [760, 600, 125, 'Dark', true],
    [1440, 900, 100, 'Light', false],
  ] as const)('keeps the refreshed chat view readable at %i x %i and %i percent zoom in %s with formatting %s', async (width, height, zoom, theme, formatting) => {
    const user = userEvent.setup()
    await page.viewport(width, height)
    const snapshot = await service.Snapshot()
    const history = await service.History()
    const historyImplementation = service.History.getMockImplementation()!
    const conversation = [
      [false, 'Found a lovely place for Saturday.'],
      [false, 'Small tables, good coffee, and a terrace by the water.'],
      [true, 'That sounds perfect.'],
      [true, 'Shall we go after the market?'],
      [false, 'Yes! I can be there around 11.'],
      [false, 'I saved the address for us.'],
      [true, 'See you there.'],
    ] as const
    service.Snapshot.mockResolvedValueOnce({ ...snapshot, rooms: [{ ...snapshot.rooms[0], name: 'Nora Bennett', topic: 'Coffee, markets, and weekend plans' }], preferences: { 'appearance.theme': theme, 'appearance.zoom': String(zoom), 'appearance.font_size': zoom === 125 ? 'Large' : 'Medium', 'composer.formatting_toolbar': formatting } })
    service.History.mockResolvedValue({
      ...history, messages: conversation.map(([own, body], index) => ({
        ...history.messages[index === 1 ? 1 : 0], id: `$chat-preview-${index}`, own, body,
        sender: own ? '@me:example.org' : '@nora:example.org', senderName: own ? 'Me' : 'Nora Bennett',
        timestamp: history.messages[0].timestamp + index * 20000, timelineCursor: index + 1,
        replyToEventId: index === 6 ? '$chat-preview-4' : '', replyToSender: index === 6 ? 'Nora Bennett' : '', replyToPreview: index === 6 ? conversation[4][1] : '',
      }))
    })
    try {
      const { container } = renderApp()
      const roomList = await screen.findByRole('navigation', { name: 'Rooms' })
      await user.click(await within(roomList).findByRole('button', { name: /Nora Bennett/ }))
      await screen.findByText('See you there.')
      await document.fonts.ready
      await settleSurfaces()
      const draft = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
      await user.type(draft, 'I will bring my camera.')
      if (formatting) {
        await user.click(screen.getByRole('button', { name: 'Hide formatting toolbar' }))
        await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Formatting' })).toBeNull())
        await user.click(screen.getByRole('button', { name: 'Formatting' }))
        await user.click(screen.getByRole('menuitem', { name: 'Show formatting toolbar' }))
        await waitFor(() => expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeTruthy())
        const toolbar = screen.getByRole('toolbar', { name: 'Formatting' })
        expect(getComputedStyle(toolbar).overflowY).toBe('visible')
        const buttons = within(toolbar).getAllByRole('button')
        for (let index = 1; index < buttons.length; index++) {
          const previous = buttons[index - 1].getBoundingClientRect()
          const current = buttons[index].getBoundingClientRect()
          if (Math.abs(current.top - previous.top) < 1) expect(current.left).toBeGreaterThanOrEqual(previous.right)
        }
        const bold = within(toolbar).getByRole('button', { name: 'Bold' })
        await page.getByRole('button', { name: /^Bold$/ }).hover()
        await waitFor(() => expect(getComputedStyle(bold.parentElement!, '::after').opacity).toBe('1'))
        await page.getByRole('textbox', { name: 'Message' }).hover()
      }
      expect(draft.value).toBe('I will bring my camera.')
      const composer = container.querySelector<HTMLElement>('.composer')!
      const composerBounds = composer.getBoundingClientRect()
      expect(composerBounds.left).toBeGreaterThanOrEqual(0)
      expect(composerBounds.right).toBeLessThanOrEqual(width + 1)
      expect(composerBounds.bottom).toBeLessThanOrEqual(height + 1)
      expect(composer.scrollWidth).toBeLessThanOrEqual(composer.clientWidth)
      const aiButtons = within(screen.getByRole('group', { name: 'AI tools' })).getAllByRole('button')
      const controls = [...['Attach file', 'Emoji picker', 'Record voice note', 'Delivery options', 'Send message'].map((name) => screen.getByRole('button', { name })), ...aiButtons]
      for (const control of controls) {
        const bounds = control.getBoundingClientRect()
        expect(bounds.width).toBeGreaterThanOrEqual(32)
        expect(bounds.height).toBeGreaterThanOrEqual(32)
        expect(bounds.left).toBeGreaterThanOrEqual(composerBounds.left)
        expect(bounds.right).toBeLessThanOrEqual(composerBounds.right)
        expect(bounds.top).toBeGreaterThanOrEqual(draft.getBoundingClientRect().bottom)
      }
      const bodies = Array.from(container.querySelectorAll<HTMLElement>('.timeline .message-body'))
      expect(bodies).toHaveLength(conversation.length)
      for (let index = 0; index < bodies.length; index++) {
        expect(parseFloat(getComputedStyle(bodies[index]).fontSize)).toBe(zoom === 125 ? 16 : 14)
        expect(bodies[index].scrollWidth).toBeLessThanOrEqual(bodies[index].clientWidth + 1)
        if (index > 0) expect(bodies[index].getBoundingClientRect().top).toBeGreaterThanOrEqual(bodies[index - 1].getBoundingClientRect().bottom + 3)
      }
      expect(container.querySelector('.reply-preview')?.textContent).toContain(conversation[4][1])
      await captureScreenshot({ path: `../.vitest/ui/chat-view-${width}.png` })
    } finally {
      service.History.mockImplementation(historyImplementation)
    }
  })

  it.each([
    [390, 844, 100, 'Light'],
    [760, 600, 125, 'Dark'],
    [1100, 780, 100, 'Light'],
  ] as const)('keeps exclusive room filters labeled and aligned at %i x %i and %i percent zoom in %s', async (width, height, zoom, theme) => {
    const user = userEvent.setup()
    await page.viewport(width, height)
    const snapshot = await service.Snapshot()
    service.Snapshot.mockResolvedValueOnce({ ...snapshot, rooms: snapshot.rooms.map((room) => ({ ...room, unanswered: room.needsReply })), preferences: { 'appearance.theme': theme, 'appearance.zoom': String(zoom), 'appearance.font_size': zoom === 125 ? 'Large' : 'Medium' } })
    renderApp()
    await screen.findByRole('button', { name: /Browser smoke room/ })
    await document.fonts.ready
    await settleSurfaces()
    const filters = screen.getByRole('group', { name: 'Filter rooms' })
    const scope = screen.getByRole('group', { name: 'Room visibility' })
    const categories = screen.getByRole('group', { name: 'Room categories' })
    const bounds = categories.getBoundingClientRect()
    const buttons = within(categories).getAllByRole('button')
    const initialBounds = buttons.map((button) => button.getBoundingClientRect())
    const scopeBounds = scope.getBoundingClientRect()
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(width + 1)
    expect(Math.abs(bounds.top - scopeBounds.top)).toBeLessThanOrEqual(1)
    expect(bounds.left).toBeGreaterThanOrEqual(scopeBounds.right - 1)
    expect(categories.scrollWidth).toBeLessThanOrEqual(categories.clientWidth + 1)
    expect(buttons).toHaveLength(3)
    expect(categories.querySelector('.filter-count')?.textContent).toBe('1')
    for (const button of buttons) {
      const buttonBounds = button.getBoundingClientRect()
      const label = button.querySelector<HTMLElement>('.filter-label')!
      const symbol = button.querySelector<HTMLElement>('.filter-symbol')!
      expect(getComputedStyle(label).display).toBe('none')
      expect(button.getAttribute('aria-label')).toBeTruthy()
      expect(button.getAttribute('title')).toBeTruthy()
      expect(buttonBounds.height).toBeGreaterThanOrEqual(34)
      expect(Math.abs(buttonBounds.width - initialBounds[0].width)).toBeLessThanOrEqual(1)
      expect(Math.abs(buttonBounds.top - initialBounds[0].top)).toBeLessThanOrEqual(1)
      expect(buttonBounds.left).toBeGreaterThanOrEqual(bounds.left - 1)
      expect(buttonBounds.right).toBeLessThanOrEqual(bounds.right + 1)
      expect(symbol.getBoundingClientRect().bottom).toBeLessThanOrEqual(buttonBounds.bottom)
      const badge = symbol.querySelector('.filter-count')
      if (badge) {
        const badgeBounds = badge.getBoundingClientRect()
        expect(badgeBounds.left).toBeGreaterThanOrEqual(buttonBounds.left - 1)
        expect(badgeBounds.right).toBeLessThanOrEqual(buttonBounds.right + 1)
        expect(badgeBounds.top).toBeGreaterThanOrEqual(buttonBounds.top - 1)
      }
    }
    for (const name of ['Unanswered rooms', 'Needs reply', 'Favorite rooms', 'Archived rooms', 'Local AI chats', 'All']) {
      const button = within(filters).getByRole('button', { name })
      await user.click(button)
      expect(button.getAttribute('aria-pressed')).toBe('true')
      expect(button.parentElement!.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(1)
      buttons.forEach((category, index) => {
        expect(Math.abs(category.getBoundingClientRect().width - initialBounds[index].width)).toBeLessThanOrEqual(1)
        expect(Math.abs(category.getBoundingClientRect().height - initialBounds[index].height)).toBeLessThanOrEqual(1)
      })
    }
    await user.click(within(categories).getByRole('button', { name: 'Needs reply' }))
    await captureScreenshot({ path: `../.vitest/ui/room-filters-${width}.png` })
  })

  it.each([
    [390, 844, 100],
    [760, 600, 125],
    [1100, 780, 100],
  ])('keeps AI shortcuts bounded without automatic text suggestions at %i x %i and %i percent zoom', async (width, height, zoom) => {
    const user = userEvent.setup()
    await page.viewport(width, height)
    const snapshot = await service.Snapshot()
    service.Snapshot.mockResolvedValueOnce({ ...snapshot, preferences: { 'ai.endpoint': 'http://localhost:8080', 'appearance.zoom': String(zoom), 'appearance.font_size': zoom === 125 ? 'Large' : 'Medium' } })
    renderApp()
    const roomButton = await screen.findByRole('button', { name: /Browser smoke room/ })
    if (width < 521) await user.click(roomButton)
    const composer = await screen.findByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
    await user.type(composer, 'I arrived')
    await new Promise<void>((resolve) => window.setTimeout(resolve, 500))
    expect(document.querySelector('.composer-ghost')).toBeNull()
    expect(service.AIComplete).not.toHaveBeenCalled()
    expect(composer.value).toBe('I arrived')

    const aiTools = screen.getByRole('group', { name: 'AI tools' })
    await document.fonts.ready
    await settleSurfaces()
    const bounds = aiTools.getBoundingClientRect()
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(width + 1)
    expect(bounds.top).toBeGreaterThanOrEqual(0)
    expect(bounds.bottom).toBeLessThanOrEqual(height + 1)
    const aiButtons = within(aiTools).getAllByRole('button')
    expect(aiButtons).toHaveLength(5)
    for (const button of aiButtons) {
      const buttonBounds = button.getBoundingClientRect()
      expect(buttonBounds.left).toBeGreaterThanOrEqual(bounds.left)
      expect(buttonBounds.right).toBeLessThanOrEqual(bounds.right + 1)
      expect(button.getAttribute('aria-keyshortcuts')).toContain('Control+Shift+')
      expect(button.getAttribute('aria-keyshortcuts')).toContain('Meta+Shift+')
      const hint = button.querySelector('kbd')!
      expect(hint.textContent).toMatch(/⇧/)
      const hintBounds = hint.getBoundingClientRect()
      expect(hintBounds.left).toBeGreaterThanOrEqual(buttonBounds.left)
      expect(hintBounds.right).toBeLessThanOrEqual(buttonBounds.right + 1)
      expect(hintBounds.bottom).toBeLessThanOrEqual(buttonBounds.bottom + 1)
    }
    await captureScreenshot({ path: `../.vitest/ui/ai-tools-${width}.png` })
  })

  it.each([
    [1100, 780],
    [390, 844],
  ] as const)('keeps the Language Tutor draft editor and correction inside the viewport at %i x %i', async (width, height) => {
    const user = userEvent.setup()
    await page.viewport(width, height)
    const snapshot = await service.Snapshot()
    service.Snapshot.mockResolvedValueOnce({ ...snapshot, rooms: [{ ...snapshot.rooms[0], name: 'Nora Bennett' }], preferences: { ...snapshot.preferences, 'ai.endpoint': 'http://localhost:11434' } })
    vi.mocked(LanguageTutorService.Analyze).mockResolvedValueOnce({ detected_language: 'it', corrected_text: 'Merhaba, nasılsın?', translation: '', grammar_notes: null, vocabulary: null, text_to_insert: '' })
    renderApp()
    const roomList = await screen.findByRole('navigation', { name: 'Rooms' })
    await user.click(await within(roomList).findByRole('button', { name: /Nora Bennett/ }))
    await user.type(await screen.findByRole('textbox', { name: 'Message' }), 'Ciao, come stai? Spero che tu stia bene oggi.')
    await user.click(within(screen.getByRole('group', { name: 'AI tools' })).getByRole('button', { name: 'Analyze draft with Language Tutor' }))
    const dialog = await screen.findByRole('dialog', { name: 'Tutor this draft' })
    await waitFor(() => expect(within(dialog).getByText('Merhaba, nasılsın?')).toBeTruthy())
    await document.fonts.ready
    await settleSurfaces()
    const dialogBounds = dialog.getBoundingClientRect()
    const editor = dialog.querySelector<HTMLElement>('.language-tutor-editor')!
    const editorBounds = editor.getBoundingClientRect()
    const contentBounds = dialog.querySelector('.language-tutor-content')!.getBoundingClientRect()
    expect(dialogBounds.left).toBeGreaterThanOrEqual(-1)
    expect(dialogBounds.right).toBeLessThanOrEqual(width + 1)
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1)
    expect(within(editor).getByRole('textbox', { name: 'Your text' }).getBoundingClientRect().right).toBeLessThanOrEqual(editorBounds.right + 1)
    if (width > 760) {
      expect(dialogBounds.width).toBeLessThanOrEqual(481)
    }
    expect(contentBounds.top).toBeGreaterThanOrEqual(editorBounds.bottom - 1)
  })

})
