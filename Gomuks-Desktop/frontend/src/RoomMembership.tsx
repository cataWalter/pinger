import { useState, type FormEvent } from 'react'
import { Check, UserPlus, X } from 'lucide-react'
import type { GroupRoomRequest, Invite } from '../bindings/mychat/desktop/models.js'
import { DialogSurface } from './DialogSurface'
import { Avatar, describeError } from './appShared'

export type NewRoomMode = 'join' | 'create'

export function parseMatrixIDList(text: string) {
  return text.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean)
}

export function sameInviteList(left: Invite[], right: Invite[]) {
  return left.length === right.length && left.every((invite, index) => {
    const other = right[index]
    return invite.roomId === other.roomId && invite.name === other.name && invite.inviter === other.inviter
      && invite.inviterName === other.inviterName && invite.direct === other.direct && invite.invitedAt === other.invitedAt
  })
}

export function InviteList({ invites, busyRoomID, onAccept, onDecline }: {
  invites: Invite[]
  busyRoomID: string
  onAccept: (invite: Invite) => void
  onDecline: (invite: Invite) => void
}) {
  if (invites.length === 0) return null
  return (
    <section className="invite-list" aria-label="Invitations">
      <div className="room-section-label"><span>INVITES</span><span>{invites.length.toString().padStart(2, '0')}</span></div>
      {invites.map((invite) => {
        const busy = busyRoomID === invite.roomId
        const inviter = invite.inviterName || invite.inviter
        const name = invite.name || invite.roomId
        return (
          <div className="invite-row" key={invite.roomId} aria-busy={busy}>
            {/* Invite state is unverified, so its avatar is not loaded. */}
            <Avatar label={name} className="room-avatar" />
            <span className="room-copy">
              <span className="room-name"><span className="room-name-text" title={name}>{name}</span></span>
              <span className="room-preview" title={invite.inviter}>{inviter ? `${invite.direct ? 'Wants to chat' : 'Invited by'}: ${inviter}` : 'Invitation'}</span>
            </span>
            <span className="invite-actions">
              <button type="button" aria-label={`Accept invitation to ${name}`} title="Accept" disabled={Boolean(busyRoomID)} onClick={() => onAccept(invite)}><Check size={14} /></button>
              <button type="button" className="is-decline" aria-label={`Decline invitation to ${name}`} title="Decline" disabled={Boolean(busyRoomID)} onClick={() => onDecline(invite)}><X size={14} /></button>
            </span>
          </div>
        )
      })}
    </section>
  )
}

export function NewRoomDialog({ initialMode = 'join', onClose, onJoin, onCreate }: {
  initialMode?: NewRoomMode
  onClose: () => void
  onJoin: (target: string) => Promise<void>
  onCreate: (request: GroupRoomRequest) => Promise<void>
}) {
  const [mode, setMode] = useState<NewRoomMode>(initialMode)
  const [address, setAddress] = useState('')
  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  const [people, setPeople] = useState('')
  const [encrypted, setEncrypted] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ready = mode === 'join' ? Boolean(address.trim()) : Boolean(name.trim())

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !ready) return
    setBusy(true)
    setError('')
    try {
      if (mode === 'join') await onJoin(address.trim())
      else await onCreate({ name: name.trim(), topic: topic.trim(), invitees: parseMatrixIDList(people), encrypted })
    } catch (submitError) {
      setError(describeError(submitError))
      setBusy(false)
    }
  }

  function switchMode(next: NewRoomMode) {
    if (busy) return
    setMode(next)
    setError('')
  }

  return (
    <div className="confirm-scrim" role="presentation">
      <DialogSurface className="confirm-dialog new-room-dialog" labelledBy="new-room-title" onClose={onClose}>
        <h2 id="new-room-title">{mode === 'join' ? 'Join a room' : 'Create a group'}</h2>
        <div className="new-room-tabs" role="tablist" aria-label="New room">
          <button type="button" role="tab" aria-selected={mode === 'join'} className={mode === 'join' ? 'is-active' : ''} onClick={() => switchMode('join')}>Join</button>
          <button type="button" role="tab" aria-selected={mode === 'create'} className={mode === 'create' ? 'is-active' : ''} onClick={() => switchMode('create')}>Create</button>
        </div>
        <form className="new-room-form" onSubmit={(event) => void submit(event)}>
          {mode === 'join' ? <>
            <label><span>Room address</span><input key="address" autoFocus value={address} maxLength={2048} placeholder="#room:example.org" spellCheck={false} autoCorrect="off" autoCapitalize="off" onChange={(event) => setAddress(event.target.value)} /></label>
            <p>Use a room alias, a room ID or a matrix.to link.</p>
          </> : <>
            <label><span>Name</span><input key="name" autoFocus value={name} maxLength={255} onChange={(event) => setName(event.target.value)} /></label>
            <label><span>Topic (optional)</span><input value={topic} maxLength={1000} onChange={(event) => setTopic(event.target.value)} /></label>
            <label><span>Invite people (optional)</span><textarea rows={2} value={people} placeholder="@name:example.org" spellCheck={false} autoCorrect="off" autoCapitalize="off" onChange={(event) => setPeople(event.target.value)} /></label>
            <label className="new-room-check"><input type="checkbox" checked={encrypted} onChange={(event) => setEncrypted(event.target.checked)} /><span>End-to-end encryption</span></label>
            <p>{encrypted ? 'Encryption cannot be turned off later.' : 'Messages will be readable by the servers in this room.'}</p>
          </>}
          {error && <p className="room-info-state is-error" role="alert">{error}</p>}
          <div className="new-room-actions">
            <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
            <button type="submit" disabled={busy || !ready}>{mode === 'join' ? (busy ? 'Joining…' : 'Join room') : (busy ? 'Creating…' : 'Create group')}</button>
          </div>
        </form>
      </DialogSurface>
    </div>
  )
}

export function InvitePeopleForm({ onInvite }: { onInvite: (userIDs: string[]) => Promise<void> }) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const userIDs = parseMatrixIDList(draft)
    if (busy || userIDs.length === 0) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await onInvite(userIDs)
      setDraft('')
      setNotice(userIDs.length === 1 ? `Invited ${userIDs[0]}` : `Invited ${userIDs.length} people`)
    } catch (inviteError) {
      setError(describeError(inviteError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="room-invite-form" onSubmit={(event) => void submit(event)}>
      <label className="room-agent-field"><span>Invite people</span><input value={draft} placeholder="@name:example.org" spellCheck={false} autoCorrect="off" autoCapitalize="off" onChange={(event) => setDraft(event.target.value)} /></label>
      <button className="settings-command" type="submit" disabled={busy || !draft.trim()}><UserPlus size={14} />{busy ? 'Inviting…' : 'Invite'}</button>
      {error && <p className="room-info-state is-error" role="alert">{error}</p>}
      {notice && <p className="room-info-state" role="status">{notice}</p>}
    </form>
  )
}
