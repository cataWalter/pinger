import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MarkdownMessage from './MarkdownMessage'

const openURL = vi.hoisted(() => vi.fn())

vi.mock('@wailsio/runtime', () => ({
  Call: { ByName: openURL },
  Clipboard: { SetText: vi.fn().mockResolvedValue(undefined) },
}))

describe('MarkdownMessage', () => {
  beforeEach(() => {
    openURL.mockReset()
    openURL.mockResolvedValue(undefined)
  })

  it('opens links in the system browser', () => {
    const url = 'https://www.instagram.com/reel/example'
    render(<MarkdownMessage body={`[Instagram](${url})`} />)

    fireEvent.click(screen.getByRole('link', { name: 'Instagram' }))

    expect(openURL).toHaveBeenCalledWith('mychat/desktop.AppService.OpenExternalURL', url)
  })

  it('opens bare URLs auto-linked from message text', () => {
    const url = 'https://open.spotify.com/track/example?si=abc123'
    render(<MarkdownMessage body={url} />)

    fireEvent.click(screen.getByRole('link', { name: url }))

    expect(openURL).toHaveBeenCalledWith('mychat/desktop.AppService.OpenExternalURL', url)
  })

  it('does not load Markdown images before an explicit user action', () => {
    const url = 'https://example.invalid/recipient-tracker.png'
    const { container } = render(<MarkdownMessage body={`![Shared image](${url})`} />)

    expect(container.querySelector('img')).toBeNull()
    expect(openURL).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('link', { name: 'Shared image' }))
    expect(openURL).toHaveBeenCalledWith('mychat/desktop.AppService.OpenExternalURL', url)
  })

  it('renders images with unsafe URLs without a loadable element', () => {
    const { container } = render(<MarkdownMessage body="![Unsafe image](javascript:alert%281%29)" />)
    expect(container.querySelector('img, a')).toBeNull()
    expect(screen.getByText('Unsafe image')).toBeTruthy()
  })

  it('renders inline and display mathematics without KaTeX errors', () => {
    const { container } = render(<MarkdownMessage body={'Inline $x^2$.\n\n$$\n\\frac{1}{2}\n$$'} />)
    expect(container.querySelectorAll('.katex')).toHaveLength(2)
    expect(container.querySelector('.katex-display')).not.toBeNull()
    expect(container.querySelector('.katex-error')).toBeNull()
  })

  it('shows an error if the system browser cannot open a link', async () => {
    openURL.mockRejectedValueOnce(new Error('launcher failed'))
    const url = 'https://example.com'
    render(<MarkdownMessage body={url} />)

    fireEvent.click(screen.getByRole('link', { name: url }))

    expect((await screen.findByRole('status')).textContent).toBe('Could not open link: launcher failed')
  })

  it('applies the message body class by default and accepts a custom class', () => {
    const { container, rerender } = render(<MarkdownMessage body="Hello" />)
    expect(container.querySelector('.markdown-message')?.className).toBe('markdown-message message-body')

    rerender(<MarkdownMessage body="Hello" className="custom-markdown" />)
    expect(container.querySelector('.markdown-message')?.className).toBe('markdown-message custom-markdown')
  })
})
