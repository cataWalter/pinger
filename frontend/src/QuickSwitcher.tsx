import { Search, X } from 'lucide-react'
import type { Dispatch, KeyboardEvent, RefObject, SetStateAction } from 'react'
import type { Room } from '../bindings/mychat/desktop/models.js'
import { DialogSurface } from './DialogSurface'
import { Avatar } from './appShared'

export function QuickSwitcher({ results, query, activeIndex, inputRef, onQueryChange, onActiveIndexChange, onSelect, onClose }: {
  results: Room[]
  query: string
  activeIndex: number
  inputRef: RefObject<HTMLInputElement>
  onQueryChange: (query: string) => void
  onActiveIndexChange: Dispatch<SetStateAction<number>>
  onSelect: (roomID: string) => void
  onClose: () => void
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      if (results.length > 0) onActiveIndexChange((current) => (current + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      const room = results[activeIndex]
      if (room) onSelect(room.id)
    }
  }

  return (
    <div className="quick-switcher-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <DialogSurface className="quick-switcher" label="Quick switcher" onClose={onClose}>
        <div className="quick-switcher-input"><Search size={17} /><input ref={inputRef} value={query} onChange={(event) => onQueryChange(event.target.value)} onKeyDown={handleKeyDown} placeholder="Search rooms" aria-label="Search rooms" autoComplete="off" spellCheck={false} autoCorrect="off" autoCapitalize="off" />
          <button className="icon-button" type="button" aria-label="Close quick switcher" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="quick-switcher-results" role="listbox" aria-label="Matching rooms">
          {results.map((room, index) => <button key={room.id} type="button" role="option" aria-selected={activeIndex === index} className={`quick-switcher-option ${activeIndex === index ? 'is-active' : ''}`} onMouseEnter={() => onActiveIndexChange(index)} onClick={() => onSelect(room.id)}>
            <Avatar uri={room.avatar} label={room.name || room.id} className="quick-switcher-avatar" />
            <span className="quick-switcher-copy"><strong>{room.name || room.id}</strong><small>{room.id}</small></span>
            {room.unread > 0 && <span className="quick-switcher-unread">{room.unread}</span>}
          </button>)}
          {results.length === 0 && <div className="quick-switcher-empty">No matching rooms</div>}
        </div>
      </DialogSurface>
    </div>
  )
}
