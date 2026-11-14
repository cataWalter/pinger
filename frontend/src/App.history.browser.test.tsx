import { fireEvent, screen, waitFor } from '@testing-library/react'
import { page } from 'vitest/browser'
import { describe, expect, it, vi } from 'vitest'
import { service } from './appBrowserMocks'
import { installAppBrowserCleanup, renderApp } from './appBrowserHarness'

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

describe('browser smoke: history', () => {
  it.each([100, 1000, 10000])('measures large history with %i messages without replacing rows while typing', async (count) => {
    await page.viewport(1100, 780)
    const history = await service.History()
    const template = history.messages[0]
    service.History.mockResolvedValueOnce({
      ...history,
      messages: Array.from({ length: count }, (_, index) => ({
        ...template,
        id: `$benchmark-${index}`,
        body: `Benchmark message ${index + 1}`,
        timestamp: template.timestamp + index * 1000,
        timelineCursor: index + 1,
      })),
    })
    const commits: number[] = []
    const started = performance.now()
    const { container } = renderApp((_id, _phase, actualDuration) => commits.push(actualDuration))
    await waitFor(() => expect(container.querySelector(`[data-event-id="$benchmark-${count - 1}"]`)).not.toBeNull(), { timeout: 45000 })
    const paint = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    await paint()
    const renderMs = performance.now() - started
    const trackedRowSelector = `[data-event-id="$benchmark-${count - 1}"]`
    const trackedRow = container.querySelector(trackedRowSelector)
    const rows = container.querySelectorAll('.message-row').length
    expect(rows).toBeGreaterThan(0)
    expect(rows).toBeLessThanOrEqual(Math.min(count, 200))
    const composer = container.querySelector<HTMLTextAreaElement>('.composer textarea')!
    const inputMs: number[] = []
    for (let sample = 0; sample < 5; sample++) {
      const inputStarted = performance.now()
      fireEvent.change(composer, { target: { value: `Draft ${sample}` } })
      await paint()
      inputMs.push(performance.now() - inputStarted)
      expect(container.querySelector(trackedRowSelector)).toBe(trackedRow)
    }
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
    console.info('Timeline performance', JSON.stringify({
      messages: count,
      rows,
      nodes: container.querySelectorAll('*').length,
      renderMs: Math.round(renderMs),
      inputMs: inputMs.map((value) => Math.round(value)),
      maxCommitMs: Math.round(Math.max(...commits)),
      heapBytes: memory?.usedJSHeapSize ?? null,
    }))
  }, 60000)

  it('navigates to unmounted virtual timeline rows with Home, End, and arrow keys', async () => {
    await page.viewport(1100, 780)
    const history = await service.History()
    const template = history.messages[0]
    service.History.mockResolvedValueOnce({
      ...history, messages: Array.from({ length: 1000 }, (_, index) => ({
        ...template, id: `$keyboard-${index}`, body: `Virtual keyboard message ${index}`, timestamp: template.timestamp + index * 1000,
      }))
    })
    const { container } = renderApp()
    await waitFor(() => expect(container.querySelector('[data-event-id="$keyboard-999"]')).not.toBeNull())
    const timeline = screen.getByRole('region', { name: 'Message timeline' })
    await waitFor(() => expect(timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight).toBeLessThanOrEqual(4))
    fireEvent.keyDown(timeline, { key: 'Home' })
    await waitFor(() => expect((document.activeElement as HTMLElement)?.dataset.eventId).toBe('$keyboard-0'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    await waitFor(() => expect((document.activeElement as HTMLElement)?.dataset.eventId).toBe('$keyboard-1'))
    fireEvent.keyDown(timeline, { key: 'End' })
    await waitFor(() => expect((document.activeElement as HTMLElement)?.dataset.eventId).toBe('$keyboard-999'))
    expect(container.querySelectorAll('.message-row').length).toBeLessThan(200)
  })

  it('retains the virtual reading anchor when an older negative-cursor page arrives', async () => {
    await page.viewport(1100, 780)
    const history = await service.History()
    const template = history.messages[0]
    service.History.mockResolvedValueOnce({
      ...history, before: -1000, hasMore: true, messages: Array.from({ length: 1000 }, (_, index) => ({
        ...template, id: `$anchor-${index}`, body: `Anchor message ${index}`, timestamp: template.timestamp + index * 1000,
      }))
    })
    let resolveOlder!: (page: typeof history) => void
    service.History.mockReturnValueOnce(new Promise<typeof history>((resolve) => { resolveOlder = resolve }))
    const { container } = renderApp()
    await waitFor(() => expect(container.querySelector('[data-event-id="$anchor-999"]')).not.toBeNull())
    const timeline = screen.getByRole('region', { name: 'Message timeline' })
    await waitFor(() => expect(timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight).toBeLessThanOrEqual(4))
    await waitFor(() => expect(getComputedStyle(container.querySelector('[data-event-id="$anchor-999"]')!).visibility).toBe('visible'))
    fireEvent.keyDown(timeline, { key: 'Home' })
    await waitFor(() => expect((document.activeElement as HTMLElement)?.dataset.eventId).toBe('$anchor-0'))
    await waitFor(() => expect(service.History).toHaveBeenCalledWith('!browser-smoke:example.org', -1000))
    const original = container.querySelector<HTMLElement>('[data-event-id="$anchor-0"]')!
    const top = original.getBoundingClientRect().top
    resolveOlder({
      ...history, before: -1050, hasMore: true, messages: Array.from({ length: 50 }, (_, index) => ({
        ...template, id: `$older-${index}`, body: `Older message ${index}`, timestamp: template.timestamp - (50 - index) * 1000,
      }))
    })
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Load older messages' }).disabled).toBe(false))
    await waitFor(() => {
      const current = container.querySelector<HTMLElement>('[data-event-id="$anchor-0"]')
      expect(current).not.toBeNull()
      expect(Math.abs(current!.getBoundingClientRect().top - top)).toBeLessThanOrEqual(4)
    })
  })

})
