import { describe, expect, it, vi } from 'vitest'
import { isLocalAIRoomID, localAIChatIDFromRoomID, localAIChatToRoom, localAIErrorMessage, localAIFavoritePreference, localAIRoomID } from './localAIChats'

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
    const chat = { id: 'chat-1', title: 'Trip plan', agentId: 'tutor', updatedAt: 1_700_000_000_000, preview: 'Here is a draft' }

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

    it('uses a fallback name for untitled chats', () => {
        expect(localAIChatToRoom({ ...chat, title: '' }, false).name).toBe('Untitled chat')
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
