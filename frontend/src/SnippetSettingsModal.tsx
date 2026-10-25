import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Download, Pencil, Plus, Search, Trash2, Upload, X } from 'lucide-react'
import { DialogSurface } from './DialogSurface'
import { createSnippetID, mergeImportedSnippets, parseSnippetImport, serializeSnippets, type Snippet, type SnippetDraft } from './snippets'

interface SnippetSettingsModalProps {
  open: boolean
  snippets: Snippet[]
  onSnippetsChange: (snippets: Snippet[]) => void
  onClose: () => void
}

export function SnippetSettingsModal({ open, snippets, onSnippetsChange, onClose }: SnippetSettingsModalProps) {
  const [draft, setDraft] = useState<SnippetDraft | null>(null)
  const [editingID, setEditingID] = useState('')
  const [editorError, setEditorError] = useState('')
  const [managerError, setManagerError] = useState('')
  const [managerStatus, setManagerStatus] = useState('')
  const [search, setSearch] = useState('')
  const contentRef = useRef<HTMLTextAreaElement>(null)

  if (!open) return null

  function close() {
    setDraft(null)
    setEditingID('')
    setEditorError('')
    setManagerError('')
    setManagerStatus('')
    setSearch('')
    onClose()
  }

  function editSnippet(snippet?: Snippet) {
    setEditingID(snippet?.id ?? '')
    setDraft(snippet
      ? { prefix: snippet.prefix, trigger: snippet.trigger, title: snippet.title, content: snippet.content, category: snippet.category ?? '' }
      : { prefix: ';', trigger: '', title: '', content: '', category: '' })
    setEditorError('')
    setManagerError('')
  }

  function insertVariable(variable: string) {
    if (!draft) return
    const content = contentRef.current
    const start = content?.selectionStart ?? draft.content.length
    const end = content?.selectionEnd ?? start
    const nextContent = draft.content.slice(0, start) + variable + draft.content.slice(end)
    const caret = start + variable.length
    setDraft({ ...draft, content: nextContent })
    requestAnimationFrame(() => {
      contentRef.current?.focus()
      contentRef.current?.setSelectionRange(caret, caret)
    })
  }

  function saveSnippetDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft) return
    const prefix = draft.prefix.trim()
    const trigger = draft.trigger.trim()
    const title = draft.title.trim()
    const content = draft.content
    const category = draft.category?.trim() ?? ''
    if (!prefix || prefix.length > 8 || /\s/.test(prefix)) {
      setEditorError('Use a prefix of 1 to 8 characters with no spaces.')
      return
    }
    if (!trigger || trigger.length > 64 || /\s/.test(trigger)) {
      setEditorError('Use a one-word trigger of up to 64 characters.')
      return
    }
    if (!title || title.length > 100 || !content.trim() || content.length > 10000) {
      setEditorError('Add a title and non-empty content of up to 10,000 characters.')
      return
    }
    const duplicate = snippets.some((snippet) => snippet.id !== editingID
      && snippet.prefix.toLocaleLowerCase() === prefix.toLocaleLowerCase()
      && snippet.trigger.toLocaleLowerCase() === trigger.toLocaleLowerCase())
    if (duplicate) {
      setEditorError('A snippet already uses that prefix and trigger.')
      return
    }
    const existing = snippets.find((snippet) => snippet.id === editingID)
    const nextSnippet: Snippet = {
      id: existing?.id ?? createSnippetID(),
      prefix,
      trigger,
      title,
      content,
      ...(category ? { category } : {}),
      createdAt: existing?.createdAt ?? Date.now(),
    }
    onSnippetsChange(existing
      ? snippets.map((snippet) => snippet.id === existing.id ? nextSnippet : snippet)
      : [...snippets, nextSnippet])
    setDraft(null)
    setEditingID('')
    setEditorError('')
    setManagerError('')
    setManagerStatus('Snippet saved.')
  }

  function deleteSnippet(snippet: Snippet) {
    onSnippetsChange(snippets.filter((candidate) => candidate.id !== snippet.id))
    if (editingID === snippet.id) {
      setDraft(null)
      setEditingID('')
    }
    setManagerStatus('Snippet deleted.')
    setManagerError('')
  }

  function exportSnippetFile() {
    try {
      const file = new Blob([serializeSnippets(snippets)], { type: 'application/json' })
      const url = URL.createObjectURL(file)
      const link = document.createElement('a')
      link.href = url
      link.download = 'pinger-snippets.json'
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setManagerStatus('Snippets exported.')
      setManagerError('')
    } catch {
      setManagerError('Could not create the snippets download.')
      setManagerStatus('')
    }
  }

  async function importSnippetFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      setManagerError('Snippet files must be smaller than 2 MiB.')
      setManagerStatus('')
      return
    }
    try {
      const imported = parseSnippetImport(await file.text())
      onSnippetsChange(mergeImportedSnippets(snippets, imported))
      setManagerStatus(`Imported ${imported.length} snippet${imported.length === 1 ? '' : 's'}.`)
      setManagerError('')
    } catch (importError) {
      setManagerError(importError instanceof Error ? importError.message : String(importError))
      setManagerStatus('')
    }
  }

  const normalizedSearch = search.trim().toLocaleLowerCase()
  const filteredSnippets = normalizedSearch
    ? snippets.filter((snippet) => [snippet.title, snippet.prefix, snippet.trigger, snippet.category ?? '', snippet.content]
      .some((value) => value.toLocaleLowerCase().includes(normalizedSearch)))
    : snippets

  return <div className="room-info-scrim snippet-manager-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <DialogSurface className="room-info-dialog snippet-manager-dialog" labelledBy="snippet-manager-title" onClose={close} onClick={(event) => event.stopPropagation()}>
      <header className="room-info-header">
        <div><span className="eyebrow">COMPOSER</span><h2 id="snippet-manager-title">Text snippets</h2></div>
        <button className="icon-button" type="button" aria-label="Close text snippets" title="Close text snippets" onClick={close}><X size={16} /></button>
      </header>
      <div className="snippet-manager-content">
        <div className="snippet-manager-toolbar">
          <button className="settings-command" type="button" onClick={() => editSnippet()}><Plus size={14} />New snippet</button>
          <button className="settings-command" type="button" disabled={snippets.length === 0} onClick={exportSnippetFile}><Download size={14} />Export JSON</button>
          <label className="settings-command file-command"><Upload size={14} />Import JSON<input type="file" accept=".json,application/json" aria-label="Import snippets" onChange={(event) => void importSnippetFile(event)} /></label>
        </div>
        <label className="settings-search snippet-manager-search">
          <Search size={15} />
          <input type="search" value={search} placeholder="Search snippets" aria-label="Search snippets" spellCheck={false} autoCorrect="off" autoCapitalize="off" onChange={(event) => setSearch(event.target.value)} />
        </label>
        {managerError && <p className="settings-error" role="alert">{managerError}</p>}
        {managerStatus && <p className="settings-note" role="status">{managerStatus}</p>}
        {draft && <form className="snippet-manager-editor" onSubmit={saveSnippetDraft}>
          <h3>{editingID ? 'Edit snippet' : 'New snippet'}</h3>
          <div className="snippet-manager-fields">
            <label className="snippet-manager-field"><span>Prefix</span><input aria-label="Snippet prefix" spellCheck={false} autoCorrect="off" autoCapitalize="off" value={draft.prefix} maxLength={8} onChange={(event) => setDraft((current) => current ? { ...current, prefix: event.target.value } : current)} /></label>
            <label className="snippet-manager-field"><span>Trigger</span><input aria-label="Snippet trigger" spellCheck={false} autoCorrect="off" autoCapitalize="off" value={draft.trigger} maxLength={64} onChange={(event) => setDraft((current) => current ? { ...current, trigger: event.target.value } : current)} /></label>
            <label className="snippet-manager-field"><span>Title</span><input aria-label="Snippet title" spellCheck={false} autoCorrect="off" autoCapitalize="off" value={draft.title} maxLength={100} onChange={(event) => setDraft((current) => current ? { ...current, title: event.target.value } : current)} /></label>
            <label className="snippet-manager-field"><span>Category</span><input aria-label="Snippet category" spellCheck={false} autoCorrect="off" autoCapitalize="off" value={draft.category ?? ''} maxLength={40} onChange={(event) => setDraft((current) => current ? { ...current, category: event.target.value } : current)} /></label>
          </div>
          <label className="snippet-manager-field"><span>Content</span><textarea ref={contentRef} aria-label="Snippet content" spellCheck={false} autoCorrect="off" autoCapitalize="off" value={draft.content} maxLength={10000} rows={5} onChange={(event) => setDraft((current) => current ? { ...current, content: event.target.value } : current)} /></label>
          <div className="snippet-variable-actions" aria-label="Insert snippet variable">
            <button className="settings-command" type="button" onClick={() => insertVariable('{date}')}>+ Insert {'{date}'}</button>
            <button className="settings-command" type="button" onClick={() => insertVariable('{time}')}>+ Insert {'{time}'}</button>
            <button className="settings-command" type="button" onClick={() => insertVariable('{clipboard}')}>+ Insert {'{clipboard}'}</button>
            <button className="settings-command" type="button" onClick={() => insertVariable('{cursor}')}>+ Insert {'{cursor}'}</button>
          </div>
          {editorError && <p className="settings-error" role="alert">{editorError}</p>}
          <div className="snippet-manager-actions">
            <button className="settings-command" type="button" onClick={() => { setDraft(null); setEditingID(''); setEditorError('') }}>Cancel</button>
            <button className="settings-command is-primary" type="submit">{editingID ? 'Save changes' : 'Save snippet'}</button>
          </div>
        </form>}
        <ul className="snippet-manager-list" aria-label="Saved text snippets">
          {filteredSnippets.map((snippet) => <li className="snippet-manager-item" key={snippet.id}>
            <div className="snippet-manager-item-top">
              <div><strong>{snippet.title}</strong><code>{snippet.prefix}{snippet.trigger}</code></div>
              <div className="snippet-manager-item-actions">
                <button className="icon-button" type="button" aria-label={`Edit snippet ${snippet.title}`} title="Edit snippet" onClick={() => editSnippet(snippet)}><Pencil size={14} /></button>
                <button className="icon-button" type="button" aria-label={`Delete snippet ${snippet.title}`} title="Delete snippet" onClick={() => deleteSnippet(snippet)}><Trash2 size={14} /></button>
              </div>
            </div>
            <p>{snippet.content}</p>
            <small>{snippet.category || 'Uncategorized'}</small>
          </li>)}
          {filteredSnippets.length === 0 && <li className="snippet-manager-empty">{snippets.length === 0 ? 'No snippets saved.' : 'No snippets match your search.'}</li>}
        </ul>
      </div>
      <footer className="room-info-footer"><button className="settings-command" type="button" onClick={close}>Close</button></footer>
    </DialogSurface>
  </div>
}