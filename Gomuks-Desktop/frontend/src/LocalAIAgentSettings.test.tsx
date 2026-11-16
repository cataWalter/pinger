import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LocalAIAgentSettings from './LocalAIAgentSettings'
import { EMPTY_CHAT_AGENTS, MAX_CHAT_AGENTS, type ChatAgentCollection } from './aiPrompts'

vi.mock('../bindings/mychat/desktop', () => ({
    AppService: {},
}))

const tutor = { id: 'agent-tutor', name: 'Tutor', instructions: 'Answer in short sentences.' }
const coach = { id: 'agent-coach', name: 'Coach', instructions: 'Ask one question at a time.' }

function renderSettings(agents: ChatAgentCollection, onSave = vi.fn().mockResolvedValue(true)) {
    render(<LocalAIAgentSettings agents={agents} onSave={onSave} />)
    return { onSave, user: userEvent.setup() }
}

describe('LocalAIAgentSettings', () => {
    afterEach(() => {
        cleanup()
    })

    it('shows an empty state and a disabled default select without agents', () => {
        renderSettings(EMPTY_CHAT_AGENTS)

        expect(screen.getByText('No agents yet. Add one to give chats a role.')).toBeTruthy()
        expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true)
    })

    it('keeps Save disabled until the name and instructions are not blank', async () => {
        const { user } = renderSettings(EMPTY_CHAT_AGENTS)
        await user.click(screen.getByRole('button', { name: 'Add agent' }))
        const save = screen.getByRole('button', { name: 'Save agent' }) as HTMLButtonElement
        expect(save.disabled).toBe(true)

        await user.type(screen.getByRole('textbox', { name: 'Agent name' }), '   ')
        await user.type(screen.getByRole('textbox', { name: 'Agent instructions' }), '   ')
        expect(save.disabled).toBe(true)
    })

    it('adds an agent with trimmed name and instructions', async () => {
        const { onSave, user } = renderSettings(EMPTY_CHAT_AGENTS)
        await user.click(screen.getByRole('button', { name: 'Add agent' }))

        await user.type(screen.getByRole('textbox', { name: 'Agent name' }), '  Tutor  ')
        await user.type(screen.getByRole('textbox', { name: 'Agent instructions' }), '  Answer in short sentences.  ')
        await user.click(screen.getByRole('button', { name: 'Save agent' }))

        await waitFor(() => expect(onSave).toHaveBeenCalledWith({
            agents: [{ id: expect.any(String), name: 'Tutor', instructions: 'Answer in short sentences.' }],
            defaultAgentId: '',
        }))
        expect(screen.queryByRole('textbox', { name: 'Agent name' })).toBeNull()
    })

    it('edits an agent in place', async () => {
        const { onSave, user } = renderSettings({ agents: [tutor, coach], defaultAgentId: '' })
        await user.click(screen.getByRole('button', { name: 'Edit agent Tutor' }))

        const name = screen.getByRole('textbox', { name: 'Agent name' }) as HTMLInputElement
        expect(name.value).toBe('Tutor')
        await user.clear(name)
        await user.type(name, 'Language tutor')
        await user.click(screen.getByRole('button', { name: 'Save agent' }))

        await waitFor(() => expect(onSave).toHaveBeenCalledWith({
            agents: [{ ...tutor, name: 'Language tutor' }, coach],
            defaultAgentId: '',
        }))
    })

    it('deletes an agent only after a second click and clears it as the default', async () => {
        const { onSave, user } = renderSettings({ agents: [tutor], defaultAgentId: tutor.id })
        expect(screen.getByText('Default')).toBeTruthy()

        await user.click(screen.getByRole('button', { name: 'Delete agent Tutor' }))
        expect(onSave).not.toHaveBeenCalled()
        await user.click(screen.getByRole('button', { name: 'Confirm delete agent Tutor' }))

        await waitFor(() => expect(onSave).toHaveBeenCalledWith({ agents: [], defaultAgentId: '' }))
    })

    it('keeps the other default when deleting a different agent', async () => {
        const { onSave, user } = renderSettings({ agents: [tutor, coach], defaultAgentId: coach.id })

        await user.click(screen.getByRole('button', { name: 'Delete agent Tutor' }))
        await user.click(screen.getByRole('button', { name: 'Confirm delete agent Tutor' }))

        await waitFor(() => expect(onSave).toHaveBeenCalledWith({ agents: [coach], defaultAgentId: coach.id }))
    })

    it('sets the default agent from the select', async () => {
        const { onSave, user } = renderSettings({ agents: [tutor, coach], defaultAgentId: '' })

        await user.selectOptions(screen.getByRole('combobox'), coach.id)

        await waitFor(() => expect(onSave).toHaveBeenCalledWith({ agents: [tutor, coach], defaultAgentId: coach.id }))
    })

    it('stops adding agents at the limit', () => {
        const agents = Array.from({ length: MAX_CHAT_AGENTS }, (_, index) => ({ id: `agent-${index}`, name: `Agent ${index}`, instructions: 'Help.' }))
        renderSettings({ agents, defaultAgentId: '' })

        expect((screen.getByRole('button', { name: 'Add agent' }) as HTMLButtonElement).disabled).toBe(true)
    })

    it('keeps the form open and reports when the save is rejected', async () => {
        const { user } = renderSettings(EMPTY_CHAT_AGENTS, vi.fn().mockResolvedValue(false))
        await user.click(screen.getByRole('button', { name: 'Add agent' }))
        await user.type(screen.getByRole('textbox', { name: 'Agent name' }), 'Tutor')
        await user.type(screen.getByRole('textbox', { name: 'Agent instructions' }), 'Help.')
        await user.click(screen.getByRole('button', { name: 'Save agent' }))

        expect((await screen.findByRole('alert')).textContent).toBe('Agents could not be saved.')
        expect(screen.getByRole('textbox', { name: 'Agent name' })).toBeTruthy()
    })

    it('shows the error message when the save throws', async () => {
        const { user } = renderSettings(EMPTY_CHAT_AGENTS, vi.fn().mockRejectedValue(new Error('Disk is full')))
        await user.click(screen.getByRole('button', { name: 'Add agent' }))
        await user.type(screen.getByRole('textbox', { name: 'Agent name' }), 'Tutor')
        await user.type(screen.getByRole('textbox', { name: 'Agent instructions' }), 'Help.')
        await user.click(screen.getByRole('button', { name: 'Save agent' }))

        expect((await screen.findByRole('alert')).textContent).toBe('Disk is full')
    })
})
