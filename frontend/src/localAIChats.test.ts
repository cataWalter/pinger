import { describe, expect, it, vi } from 'vitest'
import { buildLocalAIModelMessages, isLocalAIImageTurn, isLocalAIRoomID, localAIChatIcon, localAIChatIDFromRoomID, localAIChatToRoom, localAIErrorMessage, localAIFavoritePreference, localAIRoomID } from './localAIChats'

vi.mock('../bindings/mychat/desktop', () => ({
    AppService: {},
}))

describe('localAIErrorMessage', () => {
    it('explains a stale backend instead of showing the binding id', () => {
        const error = new Error('Binding call failed: unknown bound method id 3542693216')

        expect(localAIErrorMessage(error, 'Chats could not be loaded.')).toBe('Local AI is out of date. Quit and reopen the app to load it.')
    })

    it('explains an argument mismatch between the app and its bindings', () => {
        const parse = new Error('could not parse argument #0: json: cannot unmarshal array into Go value of type desktop.LocalAIChatRequest')
        const count = new Error('desktop.AppService.LocalAIChat expects 1 arguments, got 2')

        expect(localAIErrorMessage(parse, 'Fallback')).toBe('Local AI is out of date. Quit and reopen the app to load it.')
        expect(localAIErrorMessage(count, 'Fallback')).toBe('Local AI is out of date. Quit and reopen the app to load it.')
    })

    it('returns other error messages and falls back when there is none', () => {
        expect(localAIErrorMessage(new Error('Disk is full'), 'Fallback')).toBe('Disk is full')
        expect(localAIErrorMessage('Plain text', 'Fallback')).toBe('Plain text')
        expect(localAIErrorMessage(new Error(''), 'Fallback')).toBe('Fallback')
        expect(localAIErrorMessage({}, 'Fallback')).toBe('Fallback')
    })
})

describe('local AI chat rows', () => {
    const chat = { id: 'chat-1', title: 'Trip plan', agentId: 'tutor', kind: 'chat', folderId: '', updatedAt: 1_700_000_000_000, preview: 'Here is a draft', unanswered: false }

    it('maps a chat to a list row with its preview and activity time', () => {
        expect(localAIChatToRoom(chat, true)).toMatchObject({
            id: 'local-ai:chat-1',
            name: 'Trip plan',
            preview: 'Here is a draft',
            favorite: true,
            lastSeen: chat.updatedAt,
            lastEventAt: chat.updatedAt,
            accountId: '',
            unread: 0,
            unanswered: false,
            direct: false,
        })
    })

    it('marks a chat unanswered when the model spoke last', () => {
        expect(localAIChatToRoom({ ...chat, unanswered: true }, false)).toMatchObject({ unanswered: true, direct: false })
    })

    it('uses a fallback name for untitled chats', () => {
        expect(localAIChatToRoom({ ...chat, title: '' }, false).name).toBe('Untitled chat')
    })

    it('picks a row icon from the chat kind and agent', () => {
        expect(localAIChatIcon({ kind: 'chat', agentId: '' })).toBe('chat')
        expect(localAIChatIcon({ kind: 'chat', agentId: 'tutor' })).toBe('agent')
        expect(localAIChatIcon({ kind: 'summary', agentId: '' })).toBe('summary')
        expect(localAIChatIcon({ kind: 'summary', agentId: 'tutor' })).toBe('summary')
    })

    it('tells local rows apart from Matrix room IDs', () => {
        expect(isLocalAIRoomID(localAIRoomID('chat-1'))).toBe(true)
        expect(isLocalAIRoomID('!room:example.org')).toBe(false)
        expect(localAIChatIDFromRoomID('local-ai:chat-1')).toBe('chat-1')
        expect(localAIChatIDFromRoomID('!room:example.org')).toBeNull()
    })

    it('stores favorites under the local AI chat preference key', () => {
        expect(localAIFavoritePreference('chat-1')).toBe('ai.local_chat.favorite.chat-1')
    })
})

describe('buildLocalAIModelMessages', () => {
    const image = { name: 'generated-image.png', kind: 'image', mediaType: 'image/png', size: 4, data: 'iVBORw0KGgo=' }

    it('keeps only a note for generated images so the model never receives image bytes', () => {
        const messages = buildLocalAIModelMessages([
            { seq: 1, role: 'user', content: 'A red fox', status: 'complete', attachments: [], createdAt: 1 },
            { seq: 2, role: 'assistant', content: '', status: 'complete', attachments: [image], createdAt: 2 },
            { seq: 3, role: 'user', content: 'Make it blue', status: 'complete', attachments: [], createdAt: 3 },
        ])

        expect(messages).toEqual([
            { role: 'user', content: 'A red fox' },
            { role: 'assistant', content: '[Generated image]' },
            { role: 'user', content: 'Make it blue' },
        ])
        expect(messages.some((message) => 'images' in message)).toBe(false)
    })

    it('still sends images attached to user turns', () => {
        const messages = buildLocalAIModelMessages([
            { seq: 1, role: 'user', content: 'Describe this', status: 'complete', attachments: [image], createdAt: 1 },
        ])

        expect(messages).toEqual([{ role: 'user', content: 'Describe this', images: [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }] }])
    })

    it('identifies assistant turns that carry an image', () => {
        expect(isLocalAIImageTurn({ role: 'assistant', attachments: [image] })).toBe(true)
        expect(isLocalAIImageTurn({ role: 'assistant', attachments: [] })).toBe(false)
        expect(isLocalAIImageTurn({ role: 'user', attachments: [image] })).toBe(false)
    })
})
