import { describe, expect, it } from 'vitest'
import { SYSTEM_THEME_NAME, defaultBubbleColorForTheme, findThemeByName, themeCssVariables, themeIdForPreference, themeModeForPreference, themePaletteFor, themes } from './themes'
import { accentPaletteFor, contrastRatio } from './accent'

describe('themes', () => {
  it('provides readable surfaces and custom accent roles in every theme', () => {
    for (const theme of themes) {
      const palette = themePaletteFor(theme.id)
      expect(contrastRatio(palette.text, palette.surface), theme.name).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(palette.sidebarText, palette.sidebar), theme.name).toBeGreaterThanOrEqual(4.5)
      for (const color of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#00ffff', '#ff00ff']) {
        const variables = themeCssVariables(theme.id, accentPaletteFor(color), color)
        expect(contrastRatio(variables['--accent-text'], palette.surface), `${theme.name} ${color}`).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(variables['--on-bubble'], color)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(variables['--sidebar-accent'], palette.sidebar)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(variables['--muted'], palette.surface)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(variables['--selected-text'], variables['--surface-selected'])).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(variables['--on-accent'], variables['--accent-hover'])).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(variables['--sidebar-muted'], variables['--sidebar-active'])).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(variables['--control-border'], palette.panel)).toBeGreaterThanOrEqual(3)
        expect(contrastRatio(variables['--on-signal'], variables['--signal'])).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('defines eleven unique themes that are each light or dark', () => {
    expect(themes).toHaveLength(11)
    expect(new Set(themes.map((theme) => theme.id)).size).toBe(11)
    expect(new Set(themes.map((theme) => theme.name)).size).toBe(11)
    expect(themes.every((theme) => theme.mode === 'light' || theme.mode === 'dark')).toBe(true)
    expect(themes.filter((theme) => theme.mode === 'light')).toHaveLength(5)
    expect(themes.filter((theme) => theme.mode === 'dark')).toHaveLength(6)
  })

  it('keeps ids compatible with legacy slugified preference values', () => {
    for (const theme of themes) {
      expect(theme.id).toBe(theme.name.toLowerCase().replace(/ /g, '-'))
      expect(themeIdForPreference(theme.name, false)).toBe(theme.id)
      expect(themeIdForPreference(theme.name, true)).toBe(theme.id)
    }
  })

  it('follows the system scheme for System default and degrades gracefully for unknown values', () => {
    expect(themeIdForPreference(SYSTEM_THEME_NAME, true)).toBe('dark')
    expect(themeIdForPreference(SYSTEM_THEME_NAME, false)).toBe('light')
    expect(themeModeForPreference(SYSTEM_THEME_NAME, true)).toBe('dark')
    expect(themeModeForPreference(SYSTEM_THEME_NAME, false)).toBe('light')
    expect(themeIdForPreference('Something else', true)).toBe('something-else')
    expect(defaultBubbleColorForTheme('something-else')).toBe('#236b52')
  })

  it('resolves modes and bubble colors per theme', () => {
    expect(findThemeByName('oled black')?.mode).toBe('dark')
    expect(findThemeByName('vs code')?.id).toBe('vs-code')
    expect(findThemeByName('bosco')?.mode).toBe('light')
    expect(themeModeForPreference('Dracula', false)).toBe('dark')
    expect(themeModeForPreference('Sepia', true)).toBe('light')
    expect(defaultBubbleColorForTheme('bosco')).toBe('#276d4b')
    expect(defaultBubbleColorForTheme('rosa')).toBe('#ad3f60')
    expect(defaultBubbleColorForTheme('midnight')).toBe('#3e6fc2')
    expect(defaultBubbleColorForTheme('solarized')).toBe('#268bd2')
    expect(defaultBubbleColorForTheme('vs-code')).toBe('#264f78')
  })
})
