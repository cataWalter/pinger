import { useCallback, useEffect, useState } from 'react'
import { AppService } from '../bindings/mychat/desktop'
import type { AIMessage, LocalAIChatAttachment, LocalAIChatFolder, LocalAIChatMessage, LocalAIChatSummary, Room } from '../bindings/mychat/desktop/models.js'

export const LOCAL_AI_HISTORY_TURN_LIMIT = 40
export const LOCAL_AI_ATTACHMENT_LIMIT = 6
export const LOCAL_AI_IMAGE_LIMIT = 4
export const LOCAL_AI_IMAGE_BYTES = 8 * 1024 * 1024
export const LOCAL_AI_TEXT_BYTES = 32 * 1024
export const LOCAL_AI_MESSAGE_CHARACTERS = 512 * 1024
export const LOCAL_AI_ATTACHMENT_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,text/*,.md,.markdown,.csv,.json,.yaml,.yml,.toml,.xml,.log,.go,.ts,.tsx,.js,.jsx,.py,.rs,.java,.kt,.swift,.c,.h,.cpp,.hpp,.sh,.sql'

const LOCAL_AI_NAME_CHARACTERS = 200
const LOCAL_AI_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const LOCAL_AI_TEXT_TYPES = ['application/json', 'application/xml', 'application/yaml', 'application/x-yaml', 'application/toml', 'application/javascript', 'application/sql', 'application/x-sh']
const LOCAL_AI_TEXT_EXTENSION = /\.(txt|md|markdown|csv|tsv|json|ya?ml|toml|xml|log|ini|conf|html?|css|jsx?|tsx?|go|py|rs|java|kt|swift|c|h|cpp|hpp|sh|sql)$/i

export const LOCAL_AI_STARTER_PROMPTS = [
    { label: 'Plan my day', prompt: 'Help me plan my day. Ask one question at a time if you need more detail.' },
    { label: 'Draft a message', prompt: 'Draft a short, friendly message about ' },
    { label: 'Explain a concept', prompt: 'Explain this concept simply, then give one practical example: ' },
    { label: 'Review my writing', prompt: 'Review the text below for clarity and tone. Suggest concise edits.\n\n' },
]

export const LOCAL_AI_TITLE_CHARACTERS = 120
export const LOCAL_AI_FOLDER_NAME_CHARACTERS = 60
export const LOCAL_AI_ROOM_PREFIX = 'local-ai:'
export const LOCAL_AI_FAVORITE_PREFIX = 'ai.local_chat.favorite.'
export const LOCAL_AI_IN_ALL_CHATS_PREFIX = 'ai.local_chat.in_all.'

export function localAIRoomID(chatID: string) {
    return `${LOCAL_AI_ROOM_PREFIX}${chatID}`
}

// Matrix room IDs start with "!", so this prefix cannot match a real room.
export function isLocalAIRoomID(roomID: string) {
    return roomID.startsWith(LOCAL_AI_ROOM_PREFIX)
}

export function localAIChatIDFromRoomID(roomID: string) {
    return isLocalAIRoomID(roomID) ? roomID.slice(LOCAL_AI_ROOM_PREFIX.length) : null
}

export function localAIFavoritePreference(chatID: string) {
    return `${LOCAL_AI_FAVORITE_PREFIX}${chatID}`
}

export function localAIIncludeInAllPreference(chatID: string) {
    return `${LOCAL_AI_IN_ALL_CHATS_PREFIX}${chatID}`
}

export type LocalAIChatKind = 'chat' | 'summary'
export type LocalAIChatIcon = 'chat' | 'summary' | 'agent'

// Summaries and chats with an agent get their own row icon. Everything else uses the plain chat icon.
export function localAIChatIcon(chat: Pick<LocalAIChatSummary, 'kind' | 'agentId'>): LocalAIChatIcon {
    if (chat.kind === 'summary') return 'summary'
    return chat.agentId ? 'agent' : 'chat'
}

// Shapes a private model chat as a chat-list row. Local rows have no account, read state, or Matrix event.
export function localAIChatToRoom(chat: LocalAIChatSummary, favorite: boolean): Room {
    return {
        id: localAIRoomID(chat.id),
        name: chat.title || 'Untitled chat',
        topic: '',
        avatar: '',
        preview: chat.preview,
        lastSeen: chat.updatedAt,
        direct: false,
        favorite,
        muted: false,
        unread: 0,
        markedUnread: false,
        mentions: 0,
        unanswered: chat.unanswered,
        needsReply: false,
        lastEventId: '',
        lastEventSender: '',
        lastEventAt: chat.updatedAt,
        bridge: '',
        accountId: '',
    }
}

export function newLocalAIMessage(role: string, content: string, status: string, attachments: LocalAIChatAttachment[]): LocalAIChatMessage {
    return { seq: 0, role, content, status, attachments, createdAt: 0 }
}

// Escaping keeps file text from closing the <attached_file> tag that marks it as data.
function escapeAttachmentText(text: string) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function localAIMessageText(content: string, attachments: LocalAIChatAttachment[]) {
    const blocks = attachments
        .filter((attachment) => attachment.kind === 'text' && attachment.text)
        .map((attachment) => `<attached_file name="${escapeAttachmentText(attachment.name).replace(/"/g, '&quot;')}">\n${escapeAttachmentText(attachment.text ?? '')}\n</attached_file>`)
    return [content, ...blocks].filter((part) => part.trim() !== '').join('\n\n')
}

export function localAIMessageLength(content: string, attachments: LocalAIChatAttachment[]) {
    return Array.from(localAIMessageText(content, attachments)).length
}

// Generated images are stored as assistant turns. The chat model gets only this note, never the image bytes.
export const LOCAL_AI_GENERATED_IMAGE_NOTE = '[Generated image]'

export function isLocalAIImageTurn(message: Pick<LocalAIChatMessage, 'role' | 'attachments'>) {
    return message.role === 'assistant' && (message.attachments ?? []).some((attachment) => attachment.kind === 'image')
}

// Keeps the last turns, starting on a user turn, with text and images expanded for the model.
export function buildLocalAIModelMessages(history: LocalAIChatMessage[]): AIMessage[] {
    const turns = history.slice(-LOCAL_AI_HISTORY_TURN_LIMIT)
    while (turns[0]?.role === 'assistant') turns.shift()
    return turns.map((message) => {
        if (isLocalAIImageTurn(message)) return { role: message.role, content: LOCAL_AI_GENERATED_IMAGE_NOTE }
        const attachments = message.attachments ?? []
        const images = attachments
            .filter((attachment) => attachment.kind === 'image' && attachment.data)
            .map((attachment) => ({ mediaType: attachment.mediaType ?? '', data: attachment.data ?? '' }))
        const model: AIMessage = { role: message.role, content: localAIMessageText(message.content, attachments) }
        if (images.length > 0) model.images = images
        return model
    })
}

export function chatToMarkdown(title: string, messages: LocalAIChatMessage[]) {
    const sections = messages.map((message) => {
        const speaker = message.role === 'user' ? 'You' : 'Local AI'
        const attachments = (message.attachments ?? []).map((attachment) => `_Attached: ${attachment.name}_`)
        const stopped = message.status === 'stopped' ? '_Stopped before completion._' : ''
        return [`## ${speaker}`, ...attachments, message.content, stopped].filter((part) => part !== '').join('\n\n')
    })
    return [`# ${title.trim() || 'Local AI chat'}`, ...sections].join('\n\n') + '\n'
}

export function localAIChatExportName(title: string) {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '')
    return `${slug || 'local-ai-chat'}.md`
}

// Resolves to the saved path, or an empty string when the save dialog is cancelled.
export function exportLocalAIChat(title: string, messages: LocalAIChatMessage[]) {
    return AppService.ExportLocalAIChat(localAIChatExportName(title), chatToMarkdown(title, messages))
}

function isLocalAITextFile(file: File) {
    return file.type.startsWith('text/') || LOCAL_AI_TEXT_TYPES.includes(file.type) || LOCAL_AI_TEXT_EXTENSION.test(file.name)
}

function readFileAsDataURL(file: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
        reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'))
        reader.readAsDataURL(file)
    })
}

export async function readLocalAIAttachment(file: File): Promise<LocalAIChatAttachment> {
    const name = Array.from(file.name.trim() || 'attachment').slice(0, LOCAL_AI_NAME_CHARACTERS).join('')
    if (LOCAL_AI_IMAGE_TYPES.includes(file.type)) {
        if (file.size > LOCAL_AI_IMAGE_BYTES) throw new Error(`${name} is larger than 8 MB.`)
        const dataURL = await readFileAsDataURL(file)
        const data = dataURL.slice(dataURL.indexOf(',') + 1)
        if (!data) throw new Error(`${name} could not be read.`)
        return { name, kind: 'image', mediaType: file.type, size: file.size, data }
    }
    if (isLocalAITextFile(file)) {
        if (file.size > LOCAL_AI_TEXT_BYTES) throw new Error(`${name} is larger than 32 KB.`)
        const text = await file.text()
        if (!text.trim()) throw new Error(`${name} is empty.`)
        if (new TextEncoder().encode(text).byteLength > LOCAL_AI_TEXT_BYTES) throw new Error(`${name} is larger than 32 KB.`)
        return { name, kind: 'text', size: file.size, text }
    }
    throw new Error(`${name} is not a supported image or text file.`)
}

export function localAIErrorMessage(error: unknown, fallback: string) {
    const message = typeof error === 'string' ? error : error instanceof Error ? error.message : ''
    // Wails reports these when the running backend and the frontend bindings disagree on a method's shape.
    if (/unknown bound method|could not parse argument|expects \d+ arguments/i.test(message)) return 'Local AI is out of date. Quit and reopen the app to load it.'
    return message || fallback
}

export function useLocalAIChatList(enabled: boolean) {
    const [chats, setChats] = useState<LocalAIChatSummary[]>([])
    const [folders, setFolders] = useState<LocalAIChatFolder[]>([])
    const [error, setError] = useState('')
    const [revision, setRevision] = useState(0)

    useEffect(() => {
        if (!enabled) return undefined
        let active = true
        Promise.all([AppService.ListLocalAIChats(), AppService.ListLocalAIChatFolders()])
            .then(([list, folderList]) => {
                if (!active) return
                setChats(list ?? [])
                setFolders(folderList ?? [])
                setError('')
            })
            .catch((listError: unknown) => {
                if (active) setError(localAIErrorMessage(listError, 'Chats could not be loaded.'))
            })
        return () => {
            active = false
        }
    }, [enabled, revision])

    const reload = useCallback(() => setRevision((current) => current + 1), [])
    return { chats, folders, error, reload }
}
