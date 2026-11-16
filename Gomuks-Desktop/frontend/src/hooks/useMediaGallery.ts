import { useCallback, useEffect, useRef, useState } from 'react'
import { AppService } from '../../bindings/mychat/desktop'
import type { Message } from '../../bindings/mychat/desktop/models.js'
import { describeError, hasGalleryMedia, mediaGalleryMessageKey, type MediaGalleryFilter } from '../appShared'

type MediaGalleryOptions = {
  selectedRoomID: string
  activeAccountID: string
  loadingHistory: boolean
  historyRoomIDRef: { readonly current: string }
  messages: Message[]
  selectedRoomRef: { readonly current: string }
}

export function useMediaGallery({ selectedRoomID, activeAccountID, loadingHistory, historyRoomIDRef, messages, selectedRoomRef }: MediaGalleryOptions) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<MediaGalleryFilter>('all')
  const [items, setItems] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [scanned, setScanned] = useState(0)
  const [error, setError] = useState('')
  const requestRef = useRef(0)

  useEffect(() => {
    requestRef.current++
    setOpen(false)
    setLoading(false)
    setItems([])
  }, [selectedRoomID, activeAccountID])

  const close = useCallback(() => {
    requestRef.current++
    setOpen(false)
    setLoading(false)
  }, [])

  const openGallery = useCallback(async () => {
    if (!selectedRoomID || loadingHistory || historyRoomIDRef.current !== selectedRoomID) return
    const roomID = selectedRoomID
    const requestID = ++requestRef.current
    const initialItems = messages.filter(hasGalleryMedia)
    const seenMessageKeys = new Set(initialItems.map(mediaGalleryMessageKey))
    const collectedItems = [...initialItems]
    let cursor = 0
    let hasMore = true

    setFilter('all')
    setOpen(true)
    setLoading(true)
    setScanned(0)
    setError('')
    setItems([...collectedItems].sort((left, right) => right.timestamp - left.timestamp))

    try {
      while (hasMore) {
        const page = await AppService.History(roomID, cursor)
        if (requestRef.current !== requestID || selectedRoomRef.current !== roomID) return
        const pageMessages = page.messages ?? []
        for (const message of pageMessages) {
          if (!hasGalleryMedia(message)) continue
          const messageKey = mediaGalleryMessageKey(message)
          if (seenMessageKeys.has(messageKey)) continue
          seenMessageKeys.add(messageKey)
          collectedItems.push(message)
        }
        setItems([...collectedItems].sort((left, right) => right.timestamp - left.timestamp))
        setScanned((count) => count + pageMessages.length)
        if (page.before === cursor) {
          if (page.hasMore) throw new Error('Room history pagination did not advance.')
          break
        }
        cursor = page.before
        hasMore = page.hasMore
      }
    } catch (galleryError) {
      if (requestRef.current === requestID && selectedRoomRef.current === roomID) {
        setError(describeError(galleryError))
      }
    } finally {
      if (requestRef.current === requestID && selectedRoomRef.current === roomID) {
        setLoading(false)
      }
    }
  }, [historyRoomIDRef, loadingHistory, messages, selectedRoomID, selectedRoomRef])

  return { open, filter, setFilter, items, loading, scanned, error, close, openGallery }
}