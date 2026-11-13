import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RoomLanguageMenu } from './RoomLanguageMenu'

const languages = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'French' },
  { code: 'es', name: 'Spanish' },
]

afterEach(() => {
  cleanup()
})

describe('RoomLanguageMenu', () => {
  it('lets the chat choose its learning and translation languages independently', async () => {
    const user = userEvent.setup()
    const onLearningLanguageChange = vi.fn()
    const onExplanationLanguageChange = vi.fn()
    render(<RoomLanguageMenu
      learningLanguage="es"
      explanationLanguage="fr"
      learningDefaultName="Turkish"
      explanationDefaultName="English"
      languages={languages}
      onLearningLanguageChange={onLearningLanguageChange}
      onExplanationLanguageChange={onExplanationLanguageChange}
    />)

    await user.click(screen.getByRole('button', { name: 'Chat languages' }))
    expect(screen.getByRole('dialog', { name: 'Chat language settings' })).toBeTruthy()
    expect((screen.getByRole('combobox', { name: 'Language to learn' }) as HTMLSelectElement).value).toBe('es')
    expect((screen.getByRole('combobox', { name: 'Translations and explanations' }) as HTMLSelectElement).value).toBe('fr')
    expect(screen.getByRole('option', { name: 'Default (English)' })).toBeTruthy()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Language to learn' }), 'fr')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Translations and explanations' }), 'en')

    expect(onLearningLanguageChange).toHaveBeenCalledWith('fr')
    expect(onExplanationLanguageChange).toHaveBeenCalledWith('en')
  })

  it('closes on Escape and restores focus to the trigger', async () => {
    const user = userEvent.setup()
    render(<RoomLanguageMenu
      learningLanguage=""
      explanationLanguage=""
      learningDefaultName="Turkish"
      explanationDefaultName="English"
      languages={languages}
      onLearningLanguageChange={() => {}}
      onExplanationLanguageChange={() => {}}
    />)

    const trigger = screen.getByRole('button', { name: 'Chat languages' })
    await user.click(trigger)
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: 'Chat language settings' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})