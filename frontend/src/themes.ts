export type ThemeMode = 'light' | 'dark'

export interface ThemeDefinition {
  /** Stored preference value, e.g. "OLED black". */
  name: string
  /** Value used for the `data-theme` attribute, e.g. "oled-black". */
  id: string
  /** Whether the theme is a light or dark theme. */
  mode: ThemeMode
  /** Default outgoing message bubble color for this theme. */
  bubbleColor: string
}

export const SYSTEM_THEME_NAME = 'System default'

export const themes: ThemeDefinition[] = [
  { name: 'Light', id: 'light', mode: 'light', bubbleColor: '#236b52' },
  { name: 'Dark', id: 'dark', mode: 'dark', bubbleColor: '#236b52' },
  { name: 'OLED black', id: 'oled-black', mode: 'dark', bubbleColor: '#236b52' },
  { name: 'Bosco', id: 'bosco', mode: 'light', bubbleColor: '#276d4b' },
  { name: 'Rosa', id: 'rosa', mode: 'light', bubbleColor: '#ad3f60' },
  { name: 'Dracula', id: 'dracula', mode: 'dark', bubbleColor: '#7c5fc7' },
  { name: 'Midnight', id: 'midnight', mode: 'dark', bubbleColor: '#3e6fc2' },
  { name: 'Slate', id: 'slate', mode: 'dark', bubbleColor: '#5f7592' },
  { name: 'Solarized', id: 'solarized', mode: 'light', bubbleColor: '#268bd2' },
  { name: 'Sepia', id: 'sepia', mode: 'light', bubbleColor: '#8a5a2b' },
]

export function findThemeByName(name: string): ThemeDefinition | undefined {
  const normalized = name.trim().toLowerCase()
  return themes.find((theme) => theme.name.toLowerCase() === normalized)
}

export function findThemeById(id: string): ThemeDefinition | undefined {
  return themes.find((theme) => theme.id === id)
}

export function isSystemTheme(name: string): boolean {
  return name.trim().toLowerCase() === SYSTEM_THEME_NAME.toLowerCase()
}

/** Resolve a stored theme preference into the `data-theme` slug applied to the app shell. */
export function themeIdForPreference(preference: string, systemPrefersDark: boolean): string {
  const theme = findThemeByName(preference)
  if (theme) return theme.id
  if (isSystemTheme(preference)) return systemPrefersDark ? 'dark' : 'light'
  return preference.trim().toLowerCase().replace(/ /g, '-')
}

/** Default outgoing message bubble color for the active theme. */
export function defaultBubbleColorForTheme(themeId: string): string {
  return findThemeById(themeId)?.bubbleColor ?? '#236b52'
}

/** Whether the given theme preference resolves to a light or dark theme. */
export function themeModeForPreference(preference: string, systemPrefersDark: boolean): ThemeMode {
  const theme = findThemeByName(preference)
  if (theme) return theme.mode
  return systemPrefersDark ? 'dark' : 'light'
}
