import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Room } from '../bindings/mychat/desktop/models.js'
import { RoomInfoDialog } from './RoomInfoDialog'

const room = { id: '!room:example.org', name: 'Test room', topic: '' } as Room

function renderRoomInfo(learningLanguage = '', explanationLanguage = '', onLearningLanguageChange = vi.fn(), onExplanationLanguageChange = vi.fn(), chatGoal = '', onInferChatGoal = vi.fn(async () => 'Practice German for work.'), onSaveChatGoal = vi.fn(async () => true)) {
  render(<RoomInfoDialog
    room={room}
    chatGoal={chatGoal}
    aiEnabled
    onInferChatGoal={onInferChatGoal}
    onSaveChatGoal={onSaveChatGoal}
    agents={{ agents: [], defaultAgentId: '' }}
    agentEditor={null}
    agentSettingsError=""
    members={[]}
    membersLoading={false}
    membersError=""
    onClose={() => {}}
    onAgentEditorChange={() => {}}
    onDefaultAgentChange={() => {}}
    onEditAgent={() => {}}
    onDeleteAgent={() => {}}
    onSaveAgent={() => {}}
    onCreateAgent={() => {}}
    onInvite={async () => {}}
    onLeave={() => {}}
    learningLanguage={learningLanguage}
    explanationLanguage={explanationLanguage}
    languageOptions={[{ code: 'de', name: 'German' }, { code: 'fr', name: 'French' }]}
    defaultLearningLanguageName="Turkish"
    defaultExplanationLanguageName="English"
    onLearningLanguageChange={onLearningLanguageChange}
    onExplanationLanguageChange={onExplanationLanguageChange}
  />)
  return { onLearningLanguageChange, onExplanationLanguageChange, onInferChatGoal, onSaveChatGoal }
}

afterEach(() => {
  cleanup()
})

describe('RoomInfoDialog tutor language', () => {
  it('shows independent global defaults when the chat has no language overrides', () => {
    renderRoomInfo('')

    expect((screen.getByLabelText('Language to learn') as HTMLSelectElement).value).toBe('')
    expect((screen.getByLabelText('Translations and explanations') as HTMLSelectElement).value).toBe('')
    expect(screen.getByRole('option', { name: 'Default (Turkish)' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Default (English)' })).toBeTruthy()
  })

  it('saves the learning and explanation languages independently for this chat', async () => {
    const callbacks = renderRoomInfo()

    await userEvent.setup().selectOptions(screen.getByLabelText('Language to learn'), 'de')
    await userEvent.setup().selectOptions(screen.getByLabelText('Translations and explanations'), 'fr')

    expect(callbacks.onLearningLanguageChange).toHaveBeenCalledWith('de')
    expect(callbacks.onExplanationLanguageChange).toHaveBeenCalledWith('fr')
  })
})

describe('RoomInfoDialog chat goal', () => {
  it('fills the goal from chat inference without saving it', async () => {
    const callbacks = renderRoomInfo()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Infer from chat' }))

    expect(await screen.findByDisplayValue('Practice German for work.')).toBeTruthy()
    expect(callbacks.onSaveChatGoal).not.toHaveBeenCalled()
  })

  it('saves the goal without surrounding whitespace', async () => {
    const callbacks = renderRoomInfo()
    const user = userEvent.setup()

    await user.type(screen.getByRole('textbox', { name: 'Goal' }), '  Plan my move to Berlin  ')
    await user.click(screen.getByRole('button', { name: 'Save goal' }))

    expect(callbacks.onSaveChatGoal).toHaveBeenCalledWith('Plan my move to Berlin')
  })

  it('clears a saved goal by saving an empty value', async () => {
    const callbacks = renderRoomInfo('', '', undefined, undefined, 'Practice German for work.')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Clear goal' }))

    expect(callbacks.onSaveChatGoal).toHaveBeenCalledWith('')
  })
})
