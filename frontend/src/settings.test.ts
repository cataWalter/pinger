import { describe, expect, it } from 'vitest'
import { SETTINGS_TABS, groupSettingsByTab, searchSettings, settingsEntries } from './settings'

describe('settings search', () => {
  it('returns nothing for a blank query', () => {
    expect(searchSettings('')).toEqual([])
    expect(searchSettings('   ')).toEqual([])
  })

  it('finds settings by title, description and keywords', () => {
    expect(searchSettings('launch').map((entry) => entry.id)).toContain('general.launch-at-login')
    expect(searchSettings('dark mode').map((entry) => entry.id)).toContain('appearance.theme')
    expect(searchSettings('llama').map((entry) => entry.id)).toContain('help.ai')
    expect(searchSettings('busy mode').map((entry) => entry.id)).toContain('notifications.busy-mode')
    expect(searchSettings('ghostwriter').map((entry) => entry.id)).toContain('integrations.ghostwriter')
    expect(searchSettings('localhost').map((entry) => entry.id)).toContain('integrations.ghostwriter-endpoint')
    expect(searchSettings('keep in touch').map((entry) => entry.id)).toContain('integrations.relationship-health')
  })

  it('ignores the case of the query', () => {
    expect(searchSettings('DARK MODE').map((entry) => entry.id)).toContain(searchSettings('dark mode')[0].id)
  })

  it('requires every term to match', () => {
    expect(searchSettings('theme zzzzz')).toEqual([])
  })

  it('ranks an exact title match first', () => {
    expect(searchSettings('theme')[0].id).toBe('appearance.theme')
  })

  it('searches across every tab', () => {
    const tabs = new Set(searchSettings('encrypt').map((entry) => entry.tab))
    expect(tabs.has('Security')).toBe(true)
    expect(tabs.has('Help')).toBe(true)
  })

  it('groups results by tab in display order', () => {
    const grouped = groupSettingsByTab(searchSettings('keyboard'))
    expect(Array.from(grouped.keys())).toEqual(['Keyboard', 'Help'])
    expect(grouped.get('Keyboard')?.length).toBeGreaterThan(0)
  })

  it('keeps every entry on a known tab with a unique id', () => {
    const ids = settingsEntries.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of settingsEntries) expect(SETTINGS_TABS).toContain(entry.tab)
  })
})
