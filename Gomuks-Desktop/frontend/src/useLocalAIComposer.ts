import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent } from 'react'
import type { LocalAIChatAttachment } from '../bindings/mychat/desktop/models.js'
import { LOCAL_AI_ATTACHMENT_LIMIT, LOCAL_AI_IMAGE_LIMIT, localAIErrorMessage, readLocalAIAttachment } from './localAIChats'
import { namePastedImage } from './localAIChatUtils'
import type { LocalAIComposerDraft, LocalAIComposerSlot, LocalAIComposerTicket } from './localAIChatTypes'

type LocalAIComposerOptions = {
  chatId: string | null
  initialDraft: string
  initialDraftVersion: number
}

// Owns the unsent text and files, keeping each chat's composer separate.
export function useLocalAIComposer({ chatId, initialDraft, initialDraftVersion }: LocalAIComposerOptions) {
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<LocalAIChatAttachment[]>([])
  const [composerError, setComposerError] = useState('')
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Unsent drafts by chat ID; the empty key is the new-chat composer.
  const composerDraftsRef = useRef(new Map<string, LocalAIComposerDraft>())
  const composerSlotRef = useRef<LocalAIComposerSlot | null>(null)
  const latestComposerRef = useRef<LocalAIComposerDraft>({ draft: '', attachments: [] })
  // Changes whenever the visible composer starts belonging to a different chat.
  const composerGenerationRef = useRef(0)
  const createdChatIdRef = useRef<string | null>(null)

  useEffect(() => {
    latestComposerRef.current = { draft, attachments }
  }, [draft, attachments])

  // Saves the composer of the chat being left and restores the next one. A new initial draft always wins.
  useEffect(() => {
    const key = chatId ?? ''
    const previous = composerSlotRef.current
    composerSlotRef.current = { key, initialDraft, version: initialDraftVersion }
    const initialChanged = !previous || previous.version !== initialDraftVersion || previous.initialDraft !== initialDraft
    const switched = previous !== null && previous.key !== key
    if (switched && previous.key === '' && key === createdChatIdRef.current) {
      // The first message created this chat, so the composer already belongs to it.
      createdChatIdRef.current = null
      if (!initialChanged) return
    } else if (switched) {
      const latest = latestComposerRef.current
      if (latest.draft || latest.attachments.length > 0) composerDraftsRef.current.set(previous.key, latest)
      else composerDraftsRef.current.delete(previous.key)
    }
    if (initialChanged || switched) composerGenerationRef.current++
    if (initialChanged) {
      composerDraftsRef.current.delete(key)
      setDraft(initialDraft)
      setAttachments([])
      setComposerError('')
    } else if (switched) {
      const saved = composerDraftsRef.current.get(key)
      composerDraftsRef.current.delete(key)
      setDraft(saved?.draft ?? '')
      setAttachments(saved?.attachments ?? [])
    }
  }, [chatId, initialDraft, initialDraftVersion])

  useEffect(() => {
    const textarea = composerRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [draft])

  function composerTicket(): LocalAIComposerTicket {
    return { key: composerSlotRef.current?.key ?? '', generation: composerGenerationRef.current }
  }

  // Puts unsent text and files back in the chat that sent them, even after the user switched chats.
  function restoreUnsentComposer(ticket: LocalAIComposerTicket, content: string, pending: LocalAIChatAttachment[], message: string) {
    if (ticket.generation === composerGenerationRef.current) {
      setDraft((current) => (current === '' ? content : current))
      setAttachments((current) => (current.length === 0 ? pending : current))
      setComposerError(message)
      return
    }
    const saved = composerDraftsRef.current.get(ticket.key)
    composerDraftsRef.current.set(ticket.key, {
      draft: saved?.draft || content,
      attachments: saved && saved.attachments.length > 0 ? saved.attachments : pending,
    })
  }

  async function attachFiles(files: File[]) {
    const ticket = composerTicket()
    const next: LocalAIChatAttachment[] = []
    let problem = ''
    for (const file of files) {
      if (attachments.length + next.length >= LOCAL_AI_ATTACHMENT_LIMIT) {
        problem = `Attach up to ${LOCAL_AI_ATTACHMENT_LIMIT} files per message.`
        break
      }
      try {
        const attachment = await readLocalAIAttachment(file)
        const images = [...attachments, ...next].filter((item) => item.kind === 'image').length
        if (attachment.kind === 'image' && images >= LOCAL_AI_IMAGE_LIMIT) {
          problem = `Attach up to ${LOCAL_AI_IMAGE_LIMIT} images per message.`
          break
        }
        next.push(attachment)
      } catch (readError) {
        problem = localAIErrorMessage(readError, `${file.name} could not be attached.`)
        break
      }
    }
    if (ticket.generation !== composerGenerationRef.current) {
      // The chat changed while files were read, so they go to the chat that picked them.
      if (next.length > 0) {
        const saved = composerDraftsRef.current.get(ticket.key)
        composerDraftsRef.current.set(ticket.key, { draft: saved?.draft ?? '', attachments: [...(saved?.attachments ?? []), ...next] })
      }
      return
    }
    if (next.length > 0) setAttachments((current) => [...current, ...next])
    setComposerError(problem)
  }

  // Images paste as attachments. Text pastes fall through to the textarea unchanged.
  function handleComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const images = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (images.length === 0) return
    event.preventDefault()
    void attachFiles(images.map(namePastedImage))
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    const picked: File[] = event.currentTarget.files ? Array.from(event.currentTarget.files) : []
    event.currentTarget.value = ''
    if (picked.length > 0) void attachFiles(picked)
  }

  function removeAttachment(index: number) {
    setAttachments((current) => current.filter((_, position) => position !== index))
  }

  function insertStarter(prompt: string) {
    setDraft((current) => (current.trim() ? `${current}\n\n${prompt}` : prompt))
    composerRef.current?.focus()
  }

  function copyMessage(content: string) {
    if (!navigator.clipboard?.writeText) {
      setComposerError('Clipboard access is unavailable.')
      return
    }
    navigator.clipboard.writeText(content).catch(() => setComposerError('Clipboard access is unavailable.'))
  }

  return {
    draft,
    setDraft,
    attachments,
    setAttachments,
    composerError,
    setComposerError,
    composerRef,
    fileInputRef,
    createdChatIdRef,
    composerTicket,
    restoreUnsentComposer,
    handleComposerPaste,
    handleFileInput,
    removeAttachment,
    insertStarter,
    copyMessage,
  }
}
