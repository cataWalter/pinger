import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Room } from '../bindings/mychat/desktop/models.js'
import { RoomInfoDialog } from './RoomInfoDialog'

const room = { id: '!room:example.org', name: 'Test room', topic: '' } as Room

function renderRoomInfo(tutorLanguage: string, onTutorLanguageChange = vi.fn()) {
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
    tutorLanguage={tutorLanguage}
    tutorLanguageOptions={[{ code: 'de', name: 'German' }, { code: 'fr', name: 'French' }]}
    defaultTutorLanguageName="English"
    onTutorLanguageChange={onTutorLanguageChange}
  />)
  return onTutorLanguageChange
}

afterEach(() => {
  cleanup()
})

describe('RoomInfoDialog tutor language', () => {
  it('shows the default tutor language when the chat has no choice', () => {
    renderRoomInfo('')

    const select = screen.getByLabelText('Tutor language') as HTMLSelectElement
    expect(select.value).toBe('')
    expect(screen.getByRole('option', { name: 'Default (English)' })).toBeTruthy()
  })

  it('saves the chosen tutor language for this chat', async () => {
    const onTutorLanguageChange = renderRoomInfo('')

    await userEvent.setup().selectOptions(screen.getByLabelText('Tutor language'), 'fr')

    expect(onTutorLanguageChange).toHaveBeenCalledWith('fr')
  })
})
