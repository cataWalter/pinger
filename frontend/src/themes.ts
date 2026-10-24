export type ThemeMode = 'light' | 'dark'

export interface ThemeDefinition {
  /** Stored preference value, e.g. "OLED black". */
  name: string
  /** Value used for the `data-theme` attribute, e.g. "oled-black". */
  id: string
  /** Whether the theme is a light or dark theme. */
  mode: ThemeMode
}

export const SYSTEM_THEME_NAME = 'System default'

export const themes: ThemeDefinition[] = [
  { name: 'Light', id: 'light', mode: 'light' },
  { name: 'Dark', id: 'dark', mode: 'dark' },
  { name: 'VS Code', id: 'vs-code', mode: 'dark' },
  { name: 'OLED black', id: 'oled-black', mode: 'dark' },
  { name: 'Bosco', id: 'bosco', mode: 'light' },
  { name: 'Rosa', id: 'rosa', mode: 'light' },
  { name: 'Dracula', id: 'dracula', mode: 'dark' },
  { name: 'Midnight', id: 'midnight', mode: 'dark' },
  { name: 'Slate', id: 'slate', mode: 'dark' },
  { name: 'Solarized', id: 'solarized', mode: 'light' },
  { name: 'Sepia', id: 'sepia', mode: 'light' },
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

/** Whether the given theme preference resolves to a light or dark theme. */
export function themeModeForPreference(preference: string, systemPrefersDark: boolean): ThemeMode {
  const theme = findThemeByName(preference)
  if (theme) return theme.mode
  return systemPrefersDark ? 'dark' : 'light'
}
