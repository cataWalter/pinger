import { useEffect, useRef, useState } from 'react'
import { matrixMXCMediaURL } from './ChatMediaRenderer'
import { MAX_CACHED_AVATARS, MAX_MISSING_AVATARS } from './appConstants'

export function cachedAvatarSource(uri: string) {
  const cached = avatarSources.get(uri)
  if (cached) {
    avatarSources.delete(uri)
    avatarSources.set(uri, cached)
  }
  return cached
}

export function cacheMissingAvatar(uri: string) {
  avatarSources.delete(uri)
  missingAvatarSources.delete(uri)
  missingAvatarSources.add(uri)
  if (missingAvatarSources.size > MAX_MISSING_AVATARS) {
    const oldest = missingAvatarSources.values().next().value
    if (oldest) missingAvatarSources.delete(oldest)
  }
}

export function initials(label: string) {
  const words = label.trim().split(/\s+/).filter(Boolean)
  const parts = words.length > 1 ? words.slice(0, 2) : [words[0]?.slice(0, 2) ?? '?']
  return parts
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

export function avatarHue(label: string) {
  let hash = 0
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) | 0
  return Math.abs(hash) % 360
}

export function avatarStyle(label: string) {
  const hue = avatarHue(label || '?')
  return {
    '--avatar-hue': String(hue),
    background: `linear-gradient(135deg, hsl(${hue} 32% 88%) 0%, hsl(${(hue + 24) % 360} 30% 80%) 100%)`,
    color: `hsl(${hue} 32% 26%)`,
  } as React.CSSProperties
}

export const avatarSources = new Map<string, string>()

export const missingAvatarSources = new Set<string>()

export const mediaVisibilityCallbacks = new Map<Element, (isNearViewport: boolean) => void>()

export let mediaVisibilityObserver: IntersectionObserver | null = null

export function observeMediaVisibility(element: Element, callback: (isNearViewport: boolean) => void) {
  if (typeof IntersectionObserver === 'undefined') {
    callback(true)
    return () => { }
  }
  if (!mediaVisibilityObserver) {
    mediaVisibilityObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) mediaVisibilityCallbacks.get(entry.target)?.(entry.isIntersecting)
    }, { rootMargin: '240px' })
  }
  mediaVisibilityCallbacks.set(element, callback)
  mediaVisibilityObserver.observe(element)
  return () => {
    mediaVisibilityCallbacks.delete(element)
    const observer = mediaVisibilityObserver
    observer?.unobserve(element)
    if (mediaVisibilityCallbacks.size === 0) {
      observer?.disconnect()
      if (mediaVisibilityObserver === observer) mediaVisibilityObserver = null
    }
  }
}

export function loadAvatarSource(uri: string) {
  const cached = cachedAvatarSource(uri)
  if (cached) return Promise.resolve(cached)
  if (missingAvatarSources.has(uri)) return Promise.resolve(null)

  const source = matrixMXCMediaURL(uri)
  if (!source) {
    cacheMissingAvatar(uri)
    return Promise.resolve(null)
  }
  avatarSources.set(uri, source)
  if (avatarSources.size > MAX_CACHED_AVATARS) {
    const oldest = avatarSources.keys().next().value
    if (oldest) avatarSources.delete(oldest)
  }
  return Promise.resolve(source)
}

export function Avatar({ uri, label, className, style, deferLoad = false }: {
  uri?: string
  label: string
  className: string
  style?: React.CSSProperties
  deferLoad?: boolean
}) {
  const avatarRef = useRef<HTMLDivElement>(null)
  const [source, setSource] = useState(() => uri ? cachedAvatarSource(uri) ?? null : null)
  const [nearViewport, setNearViewport] = useState(!deferLoad)

  useEffect(() => {
    if (!deferLoad || nearViewport || !uri) return
    const element = avatarRef.current
    if (!element || typeof IntersectionObserver === 'undefined') {
      setNearViewport(true)
      return
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setNearViewport(true)
        observer.disconnect()
      }
    }, { rootMargin: '96px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [deferLoad, nearViewport, uri])

  useEffect(() => {
    let active = true
    const cached = uri ? cachedAvatarSource(uri) : undefined
    if (!uri || cached) {
      setSource(cached ?? null)
      return () => { active = false }
    }
    if (!nearViewport) {
      setSource(null)
      return () => { active = false }
    }

    setSource(null)
    void loadAvatarSource(uri).then((loadedSource) => {
      if (active) setSource(loadedSource)
    })
    return () => { active = false }
  }, [uri, nearViewport])

  return (
    <div ref={avatarRef} className={className} style={style}>
      {source ? <img className="avatar-image" src={source} alt="" onError={() => {
        if (uri) cacheMissingAvatar(uri)
        setSource(null)
      }} /> : initials(label)}
    </div>
  )
}

export function networkHue(label: string) {
  let hash = 0
  for (const char of label) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return hash
}
