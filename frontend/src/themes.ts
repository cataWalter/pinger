import { accessibleColor, mixHex, readableForeground, type AccentPalette } from './accent'

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
  { name: 'VS Code', id: 'vs-code', mode: 'dark', bubbleColor: '#264f78' },
  { name: 'OLED black', id: 'oled-black', mode: 'dark', bubbleColor: '#236b52' },
  { name: 'Bosco', id: 'bosco', mode: 'light', bubbleColor: '#276d4b' },
  { name: 'Rosa', id: 'rosa', mode: 'light', bubbleColor: '#ad3f60' },
  { name: 'Dracula', id: 'dracula', mode: 'dark', bubbleColor: '#7c5fc7' },
  { name: 'Midnight', id: 'midnight', mode: 'dark', bubbleColor: '#3e6fc2' },
  { name: 'Slate', id: 'slate', mode: 'dark', bubbleColor: '#5f7592' },
  { name: 'Solarized', id: 'solarized', mode: 'light', bubbleColor: '#268bd2' },
  { name: 'Sepia', id: 'sepia', mode: 'light', bubbleColor: '#8a5a2b' },
]

export interface ThemePalette {
  canvas: string
  surface: string
  panel: string
  text: string
  muted: string
  border: string
  sidebar: string
  sidebarText: string
  sidebarMuted: string
  danger: string
}

const themePalettes: Record<string, ThemePalette> = {
  light: {
    canvas: '#f2f4f7', surface: '#ffffff', panel: '#f7f8fa', text: '#232933', muted: '#606a78', border: '#dce1e8',
    sidebar: '#f8f9fb', sidebarText: '#232933', sidebarMuted: '#606a78', danger: '#b5343b',
  },
  dark: {
    canvas: '#1b1e24', surface: '#242830', panel: '#2b3039', text: '#edf0f5', muted: '#a9b2c2', border: '#393f4a',
    sidebar: '#171a20', sidebarText: '#edf0f5', sidebarMuted: '#a9b2c2', danger: '#ff9c9f',
  },
  'vs-code': {
    canvas: '#1e1e1e', surface: '#252526', panel: '#2d2d30', text: '#ececec', muted: '#afb3bb', border: '#404044',
    sidebar: '#202023', sidebarText: '#ececec', sidebarMuted: '#afb3bb', danger: '#f99d9d',
  },
  'oled-black': {
    canvas: '#000000', surface: '#0c0e12', panel: '#171a20', text: '#f3f5f9', muted: '#a9b2c2', border: '#303642',
    sidebar: '#000000', sidebarText: '#f3f5f9', sidebarMuted: '#a9b2c2', danger: '#ffa5a8',
  },
  bosco: {
    canvas: '#edf3ee', surface: '#fcfefc', panel: '#f2f7f3', text: '#22382c', muted: '#5c7063', border: '#d2dfd6',
    sidebar: '#193b2c', sidebarText: '#f2f8f3', sidebarMuted: '#bfcec3', danger: '#ae333b',
  },
  rosa: {
    canvas: '#f8f0f3', surface: '#fffafb', panel: '#faeef3', text: '#402735', muted: '#7b5e70', border: '#e9d6df',
    sidebar: '#3b2332', sidebarText: '#fff1f7', sidebarMuted: '#dbc1d0', danger: '#ad303c',
  },
  dracula: {
    canvas: '#282a36', surface: '#303241', panel: '#383b4d', text: '#f8f8f2', muted: '#b2b3ce', border: '#4b4e66',
    sidebar: '#21222c', sidebarText: '#f8f8f2', sidebarMuted: '#b2b3ce', danger: '#ff9baf',
  },
  midnight: {
    canvas: '#101b2b', surface: '#17263b', panel: '#1e3048', text: '#e8effb', muted: '#adbed8', border: '#354762',
    sidebar: '#0c1523', sidebarText: '#e8effb', sidebarMuted: '#adbed8', danger: '#ffaaa5',
  },
  slate: {
    canvas: '#1c222b', surface: '#262e39', panel: '#303a47', text: '#edf1f8', muted: '#b2bece', border: '#435164',
    sidebar: '#161d26', sidebarText: '#edf1f8', sidebarMuted: '#b2bece', danger: '#ffa5a5',
  },
  solarized: {
    canvas: '#eee8d5', surface: '#fdf6e3', panel: '#f6efd9', text: '#3e565e', muted: '#52686e', border: '#d5ccb2',
    sidebar: '#073642', sidebarText: '#fdf6e3', sidebarMuted: '#b4c6c4', danger: '#b42f31',
  },
  sepia: {
    canvas: '#f2eadc', surface: '#fcf7ee', panel: '#f6efe2', text: '#493b2e', muted: '#75624f', border: '#dfd2bd',
    sidebar: '#443429', sidebarText: '#fff5e6', sidebarMuted: '#d6c5ad', danger: '#a93531',
  },
}

export function themePaletteFor(themeID: string): ThemePalette {
  return themePalettes[themeID] ?? themePalettes.light
}

export function themeCssVariables(themeID: string, accent: AccentPalette, bubbleColor: string): Record<string, string> {
  const palette = themePaletteFor(themeID)
  const muted = accessibleColor(palette.muted, palette.surface)
  const sidebarActive = mixHex(palette.sidebar, palette.sidebarText, 0.13)
  const sidebarMuted = accessibleColor(palette.sidebarMuted, sidebarActive)
  const signal = accessibleColor('#b17b12', palette.surface)
  const selected = mixHex(palette.surface, accent.base, 0.12)
  return {
    '--canvas': palette.canvas,
    '--paper': palette.surface,
    '--canvas-warm': palette.panel,
    '--ink': palette.text,
    '--ink-soft': muted,
    '--muted': muted,
    '--faint': muted,
    '--line': palette.border,
    '--line-soft': palette.panel,
    '--surface-hover': palette.panel,
    '--surface-selected': selected,
    '--selected-text': accessibleColor(accent.base, selected),
    '--control-border': accessibleColor(palette.border, palette.panel, 3),
    '--accent-text': accessibleColor(accent.base, palette.surface),
    '--focus-ring': accessibleColor(accent.base, palette.surface, 3),
    '--on-accent': readableForeground(accent.base),
    '--accent-hover': mixHex(accent.base, readableForeground(accent.base) === '#ffffff' ? '#000000' : '#ffffff', 0.08),
    '--on-bubble': readableForeground(bubbleColor),
    '--danger': accessibleColor(palette.danger, palette.surface),
    '--warning': accessibleColor(palette.danger, palette.surface),
    '--coral': accessibleColor(palette.danger, palette.surface),
    '--signal': signal,
    '--on-signal': readableForeground(signal),
    '--sidebar-attention': accessibleColor(signal, palette.sidebar, 3),
    '--signal-soft': mixHex(palette.surface, signal, 0.12),
    '--mint': accessibleColor(accent.base, palette.surface),
    '--mint-soft': selected,
    '--sidebar-bg': palette.sidebar,
    '--sidebar-ink': palette.sidebarText,
    '--sidebar-muted': sidebarMuted,
    '--sidebar-border': mixHex(palette.sidebar, palette.sidebarText, 0.15),
    '--sidebar-panel': mixHex(palette.sidebar, palette.sidebarText, 0.06),
    '--sidebar-hover': mixHex(palette.sidebar, palette.sidebarText, 0.09),
    '--sidebar-active': sidebarActive,
    '--sidebar-accent': accessibleColor(accent.base, palette.sidebar),
    '--scrollbar-thumb': mixHex(palette.surface, palette.text, 0.3),
    '--scrollbar-hover': mixHex(palette.surface, palette.text, 0.45),
  }
}

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
