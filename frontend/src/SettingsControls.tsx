import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { type PreferenceValues } from './appShared'
import './settings.css'

export type PreferenceTabProps = {
  preferences: PreferenceValues
  onPreferenceChange: (key: string, value: boolean | string) => Promise<boolean>
}

export function SettingsSection({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="settings-section">
      <h3>{title}</h3>
      {description && <p className="settings-note settings-section-note">{description}</p>}
      {children}
    </div>
  )
}

export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="settings-group">
      <h4 className="settings-group-title">{title}</h4>
      {children}
    </div>
  )
}

// The dialog sets this while a search is active or a search result is revealed on the current tab.
export const SettingsAdvancedRevealContext = createContext(false)

// Rarely used controls sit in a collapsed disclosure so each tab shows its everyday options first.
// Content mounts only once opened, so a closed section does not load data (devices, storage usage).
export function SettingsAdvanced({ description, children }: { description: string; children: ReactNode }) {
  const [opened, setOpened] = useState(false)
  const revealed = useContext(SettingsAdvancedRevealContext)
  const showBody = opened || revealed
  return (
    <details className="settings-advanced" open={showBody} onToggle={(event) => setOpened(event.currentTarget.open)}>
      <summary>
        <span>Advanced</span>
        <small>{description}</small>
      </summary>
      <div className="settings-advanced-body">{showBody ? children : null}</div>
    </details>
  )
}

// Interactive rows wrap their control in a label. Rows that hold buttons set interactive={false}
// so clicking the text does not activate a button.
export function SettingRow({ label, hint, children, className = '', interactive = true }: {
  label: string
  hint?: ReactNode
  children: ReactNode
  className?: string
  interactive?: boolean
}) {
  const classes = `setting-row${className ? ` ${className}` : ''}`
  const content = (
    <>
      <span><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
      {children}
    </>
  )
  return interactive ? <label className={classes}>{content}</label> : <div className={classes}>{content}</div>
}

export function PreferenceRange({ label, min, max, step, value, onChange }: {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (value: string) => Promise<boolean>
}) {
  const [draftValue, setDraftValue] = useState(value)
  const latestValue = useRef(value)
  const committedValue = useRef(value)

  useEffect(() => {
    latestValue.current = value
    committedValue.current = value
    setDraftValue(value)
  }, [value])

  function commitValue() {
    const nextValue = latestValue.current
    if (nextValue === committedValue.current) return
    committedValue.current = nextValue
    void onChange(String(nextValue)).then((saved) => {
      if (saved) return
      latestValue.current = value
      committedValue.current = value
      setDraftValue(value)
    })
  }

  return (
    <div className="setting-range">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={draftValue}
        aria-label={label}
        onChange={(event) => {
          const nextValue = Number(event.currentTarget.value)
          latestValue.current = nextValue
          setDraftValue(nextValue)
        }}
        onPointerUp={commitValue}
        onPointerCancel={commitValue}
        onKeyUp={commitValue}
        onBlur={commitValue}
      />
      <output>{draftValue}%</output>
    </div>
  )
}

export function PreferenceToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="setting-toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}
