import { describe, expect, it } from 'vitest'
import {
  createDefaultSnippets,
  loadSnippets,
  mergeImportedSnippets,
  parseSnippetImport,
  saveSnippets,
  serializeSnippets,
  SNIPPETS_STORAGE_KEY,
} from './snippets'

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

describe('snippet persistence', () => {
  it('seeds three useful defaults on first load and persists them', () => {
    const storage = memoryStorage()
    const snippets = loadSnippets(storage)
    expect(snippets).toHaveLength(3)
    expect(snippets.map(({ prefix, trigger }) => `${prefix}${trigger}`)).toEqual([';meet', ';thanks', ';support'])
    expect(storage.getItem(SNIPPETS_STORAGE_KEY)).toContain('"version"')
  })

  it('loads valid saved snippets and restores defaults from corrupt storage', () => {
    const snippets = createDefaultSnippets(123)
    expect(loadSnippets(memoryStorage({ [SNIPPETS_STORAGE_KEY]: JSON.stringify(snippets) }))).toEqual(snippets)
    expect(loadSnippets(memoryStorage({ [SNIPPETS_STORAGE_KEY]: '{broken' }))).toHaveLength(3)
  })

  it('round trips import and export data and rejects invalid records', () => {
    const snippets = createDefaultSnippets(456)
    const imported = parseSnippetImport(serializeSnippets(snippets))
    expect(imported).toEqual(snippets)
    expect(() => parseSnippetImport('{bad')).toThrow('not valid JSON')
    expect(() => parseSnippetImport('{"snippets":[{}]}')).toThrow('valid prefix')
    expect(() => parseSnippetImport(JSON.stringify([{ ...snippets[0], prefix: 'too long prefix' }]))).toThrow('editor limits')
  })

  it('merges imported shortcuts by prefix and trigger', () => {
    const current = createDefaultSnippets(1)
    const imported = parseSnippetImport(JSON.stringify([{
      ...current[0],
      title: 'Updated meeting',
      createdAt: 2,
    }, {
      id: 'new-id', prefix: '/', trigger: 'status', title: 'Status', content: 'Available', createdAt: 3,
    }]))
    const merged = mergeImportedSnippets(current, imported)
    expect(merged).toHaveLength(4)
    expect(merged[0].title).toBe('Updated meeting')
    expect(merged[0].id).toBe(current[0].id)
  })

  it('returns false when persistence is unavailable', () => {
    expect(saveSnippets([], null)).toBe(false)
  })
})