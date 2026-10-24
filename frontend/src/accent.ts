/** Accent presets and helpers that turn a stored accent choice into CSS variables. */

export interface AccentPalette {
  /** Stored preference value, e.g. "Ocean", or "Custom" for a hex color. */
  name: string
  /** Main accent used for buttons, badges, and the default outgoing bubble. */
  base: string
  /** Lighter accent used for highlights and selected-state tints. */
  bright: string
  /** Translucent accent used for soft backgrounds. */
  soft: string
  /** Deep sidebar surface tinted toward the accent. */
  sidebarDeep: string
}

export const DEFAULT_ACCENT_NAME = 'Ocean'

const sidebarShadow = '#0b120f'
const highlightTarget = '#ffffff'
const accentHexPattern = /^#[0-9a-fA-F]{6}$/

const presetAccents = [
  { name: 'Forest', base: '#2f7653', bright: '#3f9464', soft: 'rgba(47, 118, 83, 0.15)' },
  { name: 'Ocean', base: '#28718f', bright: '#3d91ad', soft: 'rgba(40, 113, 143, 0.15)' },
  { name: 'Rose', base: '#a74761', bright: '#c45f79', soft: 'rgba(167, 71, 97, 0.15)' },
  { name: 'Gold', base: '#98702d', bright: '#b58d45', soft: 'rgba(152, 112, 45, 0.16)' },
]

export const accentPresets: AccentPalette[] = presetAccents.map((palette) => ({
  ...palette,
  sidebarDeep: mixHex(sidebarShadow, palette.base, 0.3),
}))

/** Whether a stored accent value is a six-digit hex color. */
export function isAccentHex(value: string): boolean {
  return accentHexPattern.test(value)
}

/** Resolve a stored accent preference: a preset name, a hex color, or the default preset. */
export function accentPaletteFor(value: string): AccentPalette {
  const preset = accentPresets.find((palette) => palette.name === value)
  if (preset) return preset
  if (isAccentHex(value)) return customAccentPalette(value.toLowerCase())
  return accentPresets.find((palette) => palette.name === DEFAULT_ACCENT_NAME) ?? accentPresets[0]
}

/** Inline CSS variables that recolor every accent-driven surface. */
export function accentCssVariables(palette: AccentPalette): Record<string, string> {
  return {
    '--accent': palette.base,
    '--accent-bright': palette.bright,
    '--forest': palette.base,
    '--forest-bright': palette.bright,
    '--forest-deep': palette.sidebarDeep,
    '--green': palette.base,
    '--green-soft': palette.soft,
  }
}

function customAccentPalette(base: string): AccentPalette {
  return {
    name: 'Custom',
    base,
    bright: mixHex(base, highlightTarget, 0.25),
    soft: rgba(base, 0.15),
    sidebarDeep: mixHex(sidebarShadow, base, 0.3),
  }
}

function hexChannels(hex: string): number[] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

function mixHex(from: string, to: string, amount: number): string {
  const start = hexChannels(from)
  const end = hexChannels(to)
  const channels = start.map((channel, index) => Math.round(channel + (end[index] - channel) * amount))
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

function rgba(hex: string, alpha: number): string {
  const [red, green, blue] = hexChannels(hex)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}
