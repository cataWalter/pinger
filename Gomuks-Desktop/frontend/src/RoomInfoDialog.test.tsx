import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Room } from '../bindings/mychat/desktop/models.js'
import { RoomInfoDialog } from './RoomInfoDialog'

const room = { id: '!room:example.org', name: 'Test room', topic: '' } as Room

function renderRoomInfo(learningLanguage = '', explanationLanguage = '', onLearningLanguageChange = vi.fn(), onExplanationLanguageChange = vi.fn()) {
  render(<RoomInfoDialog
    room={room}
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
  return { onLearningLanguageChange, onExplanationLanguageChange }
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
