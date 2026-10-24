import { describe, expect, it } from 'vitest'
import { DEFAULT_ACCENT_NAME, accentCssVariables, accentPaletteFor, accentPresets, isAccentHex } from './accent'

describe('accent palettes', () => {
  it('keeps the four presets and falls back to the default for unknown values', () => {
    expect(accentPresets.map((palette) => palette.name)).toEqual(['Forest', 'Ocean', 'Rose', 'Gold'])
    expect(DEFAULT_ACCENT_NAME).toBe('Ocean')
    expect(accentPaletteFor('Blue').name).toBe('Ocean')
    expect(accentPaletteFor('Rose').base).toBe('#a74761')
  })

  it('derives shades from a custom hex color', () => {
    const black = accentPaletteFor('#000000')
    expect(black.name).toBe('Custom')
    expect(black.base).toBe('#000000')
    expect(black.bright).toBe('#404040')
    expect(black.soft).toBe('rgba(0, 0, 0, 0.15)')
    expect(accentPaletteFor('#ffffff').sidebarDeep).toBe('#545957')
  })

  it('normalizes custom hex colors to lowercase', () => {
    expect(accentPaletteFor('#FFAA00').base).toBe('#ffaa00')
  })

  it('accepts only six-digit hex values as custom colors', () => {
    expect(isAccentHex('#28718f')).toBe(true)
    expect(isAccentHex('#28718')).toBe(false)
    expect(isAccentHex('28718f')).toBe(false)
    expect(isAccentHex('#28718g')).toBe(false)
  })

  it('exposes the accent variables that the app shell applies inline', () => {
    const variables = accentCssVariables(accentPaletteFor('Ocean'))
    expect(variables['--accent']).toBe('#28718f')
    expect(variables['--accent-bright']).toBe('#3d91ad')
    expect(variables['--forest-deep']).toMatch(/^#[0-9a-f]{6}$/)
  })
})
