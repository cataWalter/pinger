import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Message } from '../bindings/mychat/desktop/models.js'
import { linkPreviewsEnabled } from './appShared'
import { firstPreviewableURL, LinkPreviewCard } from './LinkPreview'

const service = vi.hoisted(() => ({
  URLPreview: vi.fn(),
  OpenExternalURL: vi.fn(),
}))

vi.mock('../bindings/mychat/desktop', () => ({ AppService: service }))

describe('firstPreviewableURL', () => {
  it.each([
    ['See https://example.com/a.', 'https://example.com/a'],
    ['(https://example.com/b)', 'https://example.com/b'],
    ['https://en.wikipedia.org/wiki/Go_(game), nice', 'https://en.wikipedia.org/wiki/Go_(game)'],
    ['**https://example.com/bold**', 'https://example.com/bold'],
    ['[docs](https://example.com/docs)', 'https://example.com/docs'],
    ['http://example.com/#top', 'http://example.com/#top'],
  ])('extracts the link from %s', (body, expected) => {
    expect(firstPreviewableURL(body)).toBe(expected)
  })

  it('ignores code, credentials and non-web links', () => {
    expect(firstPreviewableURL('`https://example.com/inline`')).toBe('')
    expect(firstPreviewableURL('```\nhttps://example.com/block\n```')).toBe('')
    expect(firstPreviewableURL('https://user:secret@example.com/')).toBe('')
    expect(firstPreviewableURL('ftp://example.com/file mailto:a@example.com')).toBe('')
    expect(firstPreviewableURL('no links here')).toBe('')
  })

  it('picks the first prose link after skipped code', () => {
    expect(firstPreviewableURL('`https://example.com/code` then https://example.com/real')).toBe('https://example.com/real')
  })
})

describe('linkPreviewsEnabled', () => {
  const base = { mediaUri: '', redacted: false, decryptionError: '', sending: false, sendError: '', encrypted: false } as Message

  it('defaults on for unencrypted text and off for encrypted text', () => {
    expect(linkPreviewsEnabled({}, base)).toBe(true)
    expect(linkPreviewsEnabled({}, { ...base, encrypted: true })).toBe(false)
    expect(linkPreviewsEnabled({ 'messages.url_previews_encrypted': true }, { ...base, encrypted: true })).toBe(true)
    expect(linkPreviewsEnabled({ 'messages.url_previews': false, 'messages.url_previews_encrypted': true }, { ...base, encrypted: true })).toBe(false)
  })

  it('skips media, redacted, undecryptable and unsent messages', () => {
    expect(linkPreviewsEnabled({}, { ...base, mediaUri: 'mxc://example.org/a' })).toBe(false)
    expect(linkPreviewsEnabled({}, { ...base, redacted: true })).toBe(false)
    expect(linkPreviewsEnabled({}, { ...base, decryptionError: 'missing key' })).toBe(false)
    expect(linkPreviewsEnabled({}, { ...base, sending: true })).toBe(false)
    expect(linkPreviewsEnabled({}, { ...base, sendError: 'failed' })).toBe(false)
  })
})

describe('LinkPreviewCard', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders the preview with an image and reports open failures', async () => {
    const user = userEvent.setup()
    service.URLPreview.mockResolvedValueOnce({ url: 'https://example.com/card', title: '', description: 'Only a summary', siteName: '', image: 'mxc://example.org/thumb', imageWidth: 100, imageHeight: 100 })
    service.OpenExternalURL.mockRejectedValueOnce(new Error('no browser'))
    const { container } = render(<LinkPreviewCard url="https://example.com/card" showImage />)

    const card = await screen.findByRole('link', { name: 'Link preview: example.com' })
    expect(card.className).toContain('has-image')
    expect(container.querySelector('.link-preview-image')?.getAttribute('src')).toContain('example.org/thumb')
    expect(screen.getByText('Only a summary')).toBeTruthy()

    await user.click(card)
    expect(service.OpenExternalURL).toHaveBeenCalledWith('https://example.com/card')
    expect((await screen.findByRole('alert')).textContent).toBe('Could not open link: no browser')
  })

  it('hides the image when media is hidden and renders nothing without a preview', async () => {
    service.URLPreview.mockResolvedValueOnce({ url: 'https://example.com/noimage', title: 'Title', description: '', siteName: 'Site', image: 'mxc://example.org/thumb', imageWidth: 0, imageHeight: 0 })
    service.URLPreview.mockResolvedValueOnce(null)
    const { container } = render(<>
      <LinkPreviewCard url="https://example.com/noimage" showImage={false} />
      <LinkPreviewCard url="https://example.com/missing" showImage />
    </>)

    expect(await screen.findByRole('link', { name: 'Link preview: Title' })).toBeTruthy()
    expect(container.querySelector('.link-preview-image')).toBeNull()
    await waitFor(() => expect(service.URLPreview).toHaveBeenCalledWith('https://example.com/missing'))
    expect(container.querySelectorAll('.link-preview')).toHaveLength(1)
  })

  it('shares one request per URL and retries after a failure', async () => {
    service.URLPreview.mockRejectedValueOnce(new Error('offline'))
    const first = render(<LinkPreviewCard url="https://example.com/retry" showImage />)
    await waitFor(() => expect(service.URLPreview).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 0))
    first.unmount()

    service.URLPreview.mockResolvedValueOnce({ url: 'https://example.com/retry', title: 'Back online', description: '', siteName: '', image: '', imageWidth: 0, imageHeight: 0 })
    render(<>
      <LinkPreviewCard url="https://example.com/retry" showImage />
      <LinkPreviewCard url="https://example.com/retry" showImage />
    </>)

    expect(await screen.findAllByRole('link', { name: 'Link preview: Back online' })).toHaveLength(2)
    expect(service.URLPreview).toHaveBeenCalledTimes(2)
  })
})
