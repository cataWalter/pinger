import { describe, expect, it } from 'vitest'
import { SYSTEM_THEME_NAME, defaultBubbleColorForTheme, findThemeByName, themeIdForPreference, themeModeForPreference, themes } from './themes'

describe('themes', () => {
  it('defines ten unique themes that are each light or dark', () => {
    expect(themes).toHaveLength(10)
    expect(new Set(themes.map((theme) => theme.id)).size).toBe(10)
    expect(new Set(themes.map((theme) => theme.name)).size).toBe(10)
    expect(themes.every((theme) => theme.mode === 'light' || theme.mode === 'dark')).toBe(true)
    expect(themes.filter((theme) => theme.mode === 'light')).toHaveLength(5)
    expect(themes.filter((theme) => theme.mode === 'dark')).toHaveLength(5)
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
    expect(findThemeByName('bosco')?.mode).toBe('light')
    expect(themeModeForPreference('Dracula', false)).toBe('dark')
    expect(themeModeForPreference('Sepia', true)).toBe('light')
    expect(defaultBubbleColorForTheme('bosco')).toBe('#276d4b')
    expect(defaultBubbleColorForTheme('rosa')).toBe('#ad3f60')
    expect(defaultBubbleColorForTheme('midnight')).toBe('#3e6fc2')
    expect(defaultBubbleColorForTheme('solarized')).toBe('#268bd2')
  })
})
