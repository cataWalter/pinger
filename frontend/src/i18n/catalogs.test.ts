import { describe, expect, it } from 'vitest'
import de from './de'
import en from './en'
import es from './es'
import fr from './fr'
import italian from './it'
import { i18n } from './index'
import { localizedSettingsEntries, searchSettings } from '../settings'

function leafKeys(value: object, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof child === 'object' && child !== null
      ? leafKeys(child, path)
      : [path]
  }).sort()
}

describe('translation catalogs', () => {
  it('finds localized settings labels and keeps their English search terms', () => {
    const entries = localizedSettingsEntries(i18n.getFixedT('de'))
    expect(searchSettings('Sprache', entries)[0]).toMatchObject({ id: 'general.language', title: 'Sprache' })
    expect(searchSettings('language', entries)).toContainEqual(expect.objectContaining({ id: 'general.language' }))
    expect(searchSettings('Tastatur', entries).slice(0, 3).map((entry) => entry.tab)).toEqual(['Keyboard', 'Keyboard', 'Keyboard'])
  })

  it('keeps every locale in parity with English', () => {
    const englishKeys = leafKeys(en)
    for (const [locale, catalog] of Object.entries({ it: italian, es, de, fr })) {
      expect(leafKeys(catalog), `${locale} catalog keys`).toEqual(englishKeys)
    }
  })
})