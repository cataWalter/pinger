import { useEffect, useRef, useState } from 'react'
import { Languages } from 'lucide-react'
import type { LanguageEntry } from './aiSettings'
import { IconTooltip } from './appShared'

export function RoomLanguageMenu({ learningLanguage, explanationLanguage, learningDefaultName, explanationDefaultName, languages, onLearningLanguageChange, onExplanationLanguageChange }: {
  learningLanguage: string
  explanationLanguage: string
  learningDefaultName: string
  explanationDefaultName: string
  languages: readonly LanguageEntry[]
  onLearningLanguageChange: (code: string) => void
  onExplanationLanguageChange: (code: string) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLSelectElement>('select')?.focus()
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return <div className="conversation-language-control" ref={rootRef}>
    <IconTooltip label="Chat languages">
      <button ref={triggerRef} className="icon-button" type="button" aria-label="Chat languages" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <Languages size={16} aria-hidden="true" />
      </button>
    </IconTooltip>
    {open && <div className="action-menu conversation-language-menu" role="dialog" aria-label="Chat language settings" ref={menuRef}>
      <label className="conversation-language-field"><span>Language to learn</span><select aria-label="Language to learn" value={learningLanguage} onChange={(event) => onLearningLanguageChange(event.target.value)}>
        <option value="">Default ({learningDefaultName})</option>
        {languages.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}
      </select></label>
      <label className="conversation-language-field"><span>Translations and explanations</span><select aria-label="Translations and explanations" value={explanationLanguage} onChange={(event) => onExplanationLanguageChange(event.target.value)}>
        <option value="">Default ({explanationDefaultName})</option>
        {languages.map((language) => <option key={language.code} value={language.code}>{language.name}</option>)}
      </select></label>
    </div>}
  </div>
}