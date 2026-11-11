import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LanguageSettings } from './LanguageSettings'
import { MAX_CUSTOM_LANGUAGES, resolveLanguageRoles } from './aiSettings'

const brazilian = JSON.stringify([{ code: 'pt-BR', name: 'Brazilian Portuguese' }])

function renderSettings(preferences: Record<string, string | boolean> = {}, saved = true) {
  const onPreferencesChange = vi.fn(async (_entries: Record<string, string>) => saved)
  render(<LanguageSettings roles={resolveLanguageRoles(preferences)} onPreferencesChange={onPreferencesChange} />)
  return { onPreferencesChange, user: userEvent.setup() }
}

afterEach(() => {
  cleanup()
})

describe('LanguageSettings', () => {
  it('saves the language to learn in one batch', async () => {
    const { onPreferencesChange, user } = renderSettings()

    await user.selectOptions(screen.getByLabelText('Language to learn'), 'de')

    await waitFor(() => expect(onPreferencesChange).toHaveBeenCalledWith({ 'ai.tutor_language': 'de' }))
    expect(await screen.findByText('Language to learn saved.')).toBeTruthy()
  })

  it('saves the default language together with the known list', async () => {
    const { onPreferencesChange, user } = renderSettings()

    await user.selectOptions(screen.getByLabelText('Default language'), 'fr')

    await waitFor(() => expect(onPreferencesChange).toHaveBeenCalledWith({
      'ai.default_language': 'fr',
      'ai.known_languages': '["en","fr"]',
    }))
    expect(onPreferencesChange).toHaveBeenCalledTimes(1)
  })

  it('reports when the batch was not saved', async () => {
    const { user } = renderSettings({}, false)

    await user.selectOptions(screen.getByLabelText('Language to learn'), 'de')

    expect(await screen.findByText('Not saved.')).toBeTruthy()
  })

  it('refuses to remove a custom language that is still the language to learn', async () => {
    const { onPreferencesChange, user } = renderSettings({ 'ai.tutor_language': 'pt-BR', 'ai.custom_languages': brazilian })

    await user.click(screen.getByRole('button', { name: 'Remove Brazilian Portuguese' }))

    expect(await screen.findByText('Choose another language to learn or default language before removing this one.')).toBeTruthy()
    expect(onPreferencesChange).not.toHaveBeenCalled()
  })

  it('removes an unused custom language from the custom and known lists in one batch', async () => {
    const { onPreferencesChange, user } = renderSettings({ 'ai.custom_languages': brazilian, 'ai.known_languages': '["en","pt-BR"]' })

    await user.click(screen.getByRole('button', { name: 'Remove Brazilian Portuguese' }))

    await waitFor(() => expect(onPreferencesChange).toHaveBeenCalledTimes(1))
    const entries = onPreferencesChange.mock.calls[0][0]
    expect(entries['ai.custom_languages']).not.toContain('pt-BR')
    expect(entries['ai.known_languages']).toBe('["en"]')
    expect(await screen.findByText('Custom language removed.')).toBeTruthy()
  })

  it('adds a custom language with a free-text name in one batch', async () => {
    const { onPreferencesChange, user } = renderSettings()

    await user.type(screen.getByLabelText('Code'), 'pt-BR')
    await user.type(screen.getByLabelText('Name'), 'Brazilian Portuguese')
    await user.click(screen.getByRole('button', { name: 'Add language' }))

    await waitFor(() => expect(onPreferencesChange).toHaveBeenCalledTimes(1))
    const entries = onPreferencesChange.mock.calls[0][0]
    expect(entries['ai.custom_languages']).toContain('"code":"pt-BR"')
    expect(entries['ai.custom_languages']).toContain('"name":"Brazilian Portuguese"')
    expect(await screen.findByText('Custom language added.')).toBeTruthy()
  })

  it('rejects a custom code that matches a built-in language without saving', async () => {
    const { onPreferencesChange, user } = renderSettings()

    await user.type(screen.getByLabelText('Code'), 'de')
    await user.type(screen.getByLabelText('Name'), 'Deutsch')
    await user.click(screen.getByRole('button', { name: 'Add language' }))

    expect(await screen.findByRole('status')).toBeTruthy()
    expect(onPreferencesChange).not.toHaveBeenCalled()
  })

  it('disables adding custom languages once the limit is reached', () => {
    const codes = ['pt-BR', 'ga', 'hi', 'th', 'vi', 'id', 'fa', 'he']
    expect(codes).toHaveLength(MAX_CUSTOM_LANGUAGES)
    renderSettings({ 'ai.custom_languages': JSON.stringify(codes.map((code) => ({ code, name: `Language ${code}` }))) })

    expect((screen.getByRole('button', { name: 'Add language' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
