import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { AppService } from '../bindings/mychat/desktop'
import type { LocalAIChatMessage } from '../bindings/mychat/desktop/models.js'
import { localAIErrorMessage } from './localAIChats'
import type { LocalAIEdit } from './localAIChatTypes'

type LocalAIChatLoaderOptions = {
  chatId: string | null
  setEdit: Dispatch<SetStateAction<LocalAIEdit | null>>
  setComposerError: (message: string) => void
  shouldFollowRef: { current: boolean }
}

// Loads the saved messages when the open chat changes. Also exposes the chat id refs that the send and run actions read.
export function useLocalAIChatLoader({ chatId, setEdit, setComposerError, shouldFollowRef }: LocalAIChatLoaderOptions) {
  const [messages, setMessages] = useState<LocalAIChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const chatIdRef = useRef<string | null>(chatId)
  const loadedChatIdRef = useRef<string | null>(null)

  useEffect(() => {
    chatIdRef.current = chatId
    if (chatId === loadedChatIdRef.current) return undefined
    loadedChatIdRef.current = chatId
    shouldFollowRef.current = true
    setEdit(null)
    setComposerError('')
    setMessages([])
    if (!chatId) {
      setLoading(false)
      return undefined
    }
    let active = true
    setLoading(true)
    AppService.LoadLocalAIChatMessages(chatId)
      .then((list) => {
        if (active) setMessages(list ?? [])
      })
      .catch((loadError: unknown) => {
        if (active) setComposerError(localAIErrorMessage(loadError, 'The chat could not be opened.'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [chatId, setComposerError, setEdit, shouldFollowRef])

  return { messages, setMessages, loading, chatIdRef, loadedChatIdRef }
}
