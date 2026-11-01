import { useEffect, useState } from 'react'
import { AppService } from '../bindings/mychat/desktop'
import type { LinkPreview } from '../bindings/mychat/desktop/models.js'
import { matrixMXCMediaURL } from './ChatMediaRenderer'

const MAX_CACHED_PREVIEWS = 200
const previewRequests = new Map<string, Promise<LinkPreview | null>>()
const urlPattern = /\bhttps?:\/\/[^\s<>"'`]+/i
const trailingPunctuation = /[.,;:!?'"\])}*_~]$/

function countOf(text: string, character: string) {
  return text.split(character).length - 1
}

export function firstPreviewableURL(body: string) {
  const prose = body.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ')
  const match = urlPattern.exec(prose)
  if (!match) return ''
  let candidate = match[0]
  while (trailingPunctuation.test(candidate)) {
    // Keep a closing parenthesis that balances one inside the URL, e.g. Wikipedia links.
    if (candidate.endsWith(')') && countOf(candidate, '(') >= countOf(candidate, ')')) break
    candidate = candidate.slice(0, -1)
  }
  try {
    const parsed = new URL(candidate)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname || parsed.username || parsed.password) return ''
    return parsed.href
  } catch {
    return ''
  }
}

export function loadLinkPreview(url: string) {
  const cached = previewRequests.get(url)
  if (cached) return cached
  const request = Promise.resolve(AppService.URLPreview(url)).catch(() => {
    previewRequests.delete(url)
    return null
  })
  previewRequests.set(url, request)
  if (previewRequests.size > MAX_CACHED_PREVIEWS) {
    const oldest = previewRequests.keys().next().value
    if (oldest !== undefined) previewRequests.delete(oldest)
  }
  return request
}

export function LinkPreviewCard({ url, showImage }: { url: string; showImage: boolean }) {
  const [loaded, setLoaded] = useState<{ url: string; preview: LinkPreview | null }>({ url: '', preview: null })
  const [linkError, setLinkError] = useState('')

  useEffect(() => {
    let active = true
    void loadLinkPreview(url).then((preview) => {
      if (active) setLoaded({ url, preview })
    })
    return () => { active = false }
  }, [url])

  const preview = loaded.url === url ? loaded.preview : null
  if (!preview) return null
  let host: string
  try {
    host = new URL(preview.url).hostname
  } catch {
    return null
  }
  const image = showImage && preview.image ? matrixMXCMediaURL(preview.image) : ''
  const label = preview.siteName || host
  const target = preview.url

  async function open() {
    setLinkError('')
    try {
      await AppService.OpenExternalURL(target)
    } catch (error) {
      setLinkError(`Could not open link: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return (
    <>
      <a className={`link-preview ${image ? 'has-image' : ''}`} href={preview.url} target="_blank" rel="noreferrer" title={preview.url} aria-label={`Link preview: ${preview.title || label}`} onClick={(event) => {
        event.preventDefault()
        void open()
      }}>
        <span className="link-preview-copy">
          <span className="link-preview-site">{label}</span>
          {preview.title && <strong className="link-preview-title">{preview.title}</strong>}
          {preview.description && <span className="link-preview-description">{preview.description}</span>}
        </span>
        {image && <img className="link-preview-image" src={image} alt="" loading="lazy" decoding="async" />}
      </a>
      {linkError && <span className="message-error" role="alert">{linkError}</span>}
    </>
  )
}
