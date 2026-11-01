import { describe, expect, it } from 'vitest'
import de from './de'
import en from './en'
import es from './es'
import fr from './fr'
import italian from './it'

function leafKeys(value: object, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof child === 'object' && child !== null
      ? leafKeys(child, path)
      : [path]
  }).sort()
}

describe('translation catalogs', () => {
  it('keeps every locale in parity with English', () => {
    const englishKeys = leafKeys(en)
    for (const [locale, catalog] of Object.entries({ it: italian, es, de, fr })) {
      expect(leafKeys(catalog), `${locale} catalog keys`).toEqual(englishKeys)
    }
  })
})