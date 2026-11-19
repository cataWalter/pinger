import { useState, type FormEvent } from 'react'
import { Check, UserPlus, X } from 'lucide-react'
import type { Invite } from '../bindings/mychat/desktop/models.js'
import { Avatar, describeError } from './appShared'

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
