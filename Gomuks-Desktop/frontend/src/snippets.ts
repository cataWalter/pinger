export interface Snippet {
  id: string
  prefix: string
  trigger: string
  title: string
  content: string
  category?: string
  createdAt: number
}

export interface SnippetDraft {
  prefix: string
  trigger: string
  title: string
  content: string
  category?: string
}

export const SNIPPETS_STORAGE_KEY = 'pinger.text-snippets.v1'

const DEFAULT_SNIPPET_IDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
]

export function createSnippetID(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function createDefaultSnippets(createdAt = Date.now()): Snippet[] {
  return [
    {
      id: DEFAULT_SNIPPET_IDS[0],
      prefix: ';',
      trigger: 'meet',
      title: 'Suggest a meeting time',
      content: 'Would {date} at {time} work for you?',
      category: 'Work',
      createdAt,
    },
    {
      id: DEFAULT_SNIPPET_IDS[1],
      prefix: ';',
      trigger: 'thanks',
      title: 'Say thanks',
      content: 'Thanks for the update! I appreciate it.',
      category: 'Personal',
      createdAt,
    },
    {
      id: DEFAULT_SNIPPET_IDS[2],
      prefix: ';',
      trigger: 'support',
      title: 'Ask for support',
      content: 'Hi, I need help with: {cursor}\n\nThanks!',
      category: 'Support',
      createdAt,
    },
  ]
}

type SnippetStorage = Pick<Storage, 'getItem' | 'setItem'>

function localStorageOrNull(): SnippetStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeImportedSnippet(value: unknown, index: number): Snippet | null {
  if (!isRecord(value)) return null
  const prefix = typeof value.prefix === 'string' ? value.prefix.trim() : ''
  const trigger = typeof value.trigger === 'string' ? value.trigger.trim() : ''
  const title = typeof value.title === 'string' ? value.title.trim() : ''
  const content = typeof value.content === 'string' ? value.content : ''
  const category = typeof value.category === 'string' ? value.category.trim() : ''
  if (!prefix || prefix.length > 8 || /\s/.test(prefix)
    || !trigger || trigger.length > 64 || /\s/.test(trigger)
    || !title || title.length > 100 || !content.trim() || content.length > 10000
    || category.length > 40) return null
  const createdAt = typeof value.createdAt === 'number' && Number.isFinite(value.createdAt)
    ? value.createdAt
    : Date.now() + index
  const id = typeof value.id === 'string' && value.id.trim() ? value.id : createSnippetID()
  return { id, prefix, trigger, title, content, ...(category ? { category } : {}), createdAt }
}

function parseStoredSnippets(source: string): Snippet[] | null {
  try {
    const parsed: unknown = JSON.parse(source)
    const entries = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.snippets)
        ? parsed.snippets
        : null
    if (!entries || entries.some((entry) => normalizeImportedSnippet(entry, 0) === null)) return null
    return entries.map((entry, index) => normalizeImportedSnippet(entry, index) as Snippet)
  } catch {
    return null
  }
}

export function loadSnippets(storage: SnippetStorage | null = localStorageOrNull()): Snippet[] {
  if (!storage) return createDefaultSnippets()
  let source: string | null
  try {
    source = storage.getItem(SNIPPETS_STORAGE_KEY)
  } catch {
    return createDefaultSnippets()
  }
  if (source !== null) {
    const stored = parseStoredSnippets(source)
    if (stored) return stored
  }
  const defaults = createDefaultSnippets()
  saveSnippets(defaults, storage)
  return defaults
}

export function saveSnippets(snippets: Snippet[], storage: SnippetStorage | null = localStorageOrNull()): boolean {
  if (!storage) return false
  try {
    storage.setItem(SNIPPETS_STORAGE_KEY, serializeSnippets(snippets))
    return true
  } catch {
    return false
  }
}

export function serializeSnippets(snippets: Snippet[]): string {
  return JSON.stringify({ version: 1, snippets }, null, 2)
}

export function parseSnippetImport(source: string): Snippet[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new Error('The selected file is not valid JSON.')
  }
  const entries = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.snippets)
      ? parsed.snippets
      : null
  if (!entries) throw new Error('The JSON file must contain a snippets array.')
  const snippets = entries.map((entry, index) => normalizeImportedSnippet(entry, index))
  if (snippets.some((snippet) => snippet === null)) {
    throw new Error('Each snippet needs a valid prefix, trigger, title, and non-empty content within the editor limits.')
  }
  return snippets as Snippet[]
}

export function mergeImportedSnippets(current: Snippet[], imported: Snippet[]): Snippet[] {
  const merged = [...current]
  for (const snippet of imported) {
    const index = merged.findIndex((candidate) =>
      candidate.prefix.toLocaleLowerCase() === snippet.prefix.toLocaleLowerCase()
      && candidate.trigger.toLocaleLowerCase() === snippet.trigger.toLocaleLowerCase(),
    )
    if (index < 0) {
      const uniqueSnippet = merged.some((candidate) => candidate.id === snippet.id)
        ? { ...snippet, id: createSnippetID() }
        : snippet
      merged.push(uniqueSnippet)
    } else {
      merged[index] = { ...snippet, id: merged[index].id }
    }
  }
  return merged
}