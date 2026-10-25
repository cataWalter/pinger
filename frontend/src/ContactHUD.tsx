import { useEffect, useRef, useState } from 'react'
import { Events } from '@wailsio/runtime'
import { AppService } from '../bindings/mychat/desktop'
import type { ContactDossierSnapshot } from '../bindings/mychat/desktop/models.js'
import type { Room } from '../bindings/mychat/desktop/models.js'
import { Link2, RefreshCw, Unlink, X } from 'lucide-react'

type ContactHUDProps = {
  accountID: string
  roomID: string
  rooms: Room[]
  onClose: () => void
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function updatedAtLabel(timestamp: number) {
  if (!timestamp) return ''
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp))
}

export default function ContactHUD({ accountID, roomID, rooms, onClose }: ContactHUDProps) {
  const activeIdentityRef = useRef({ accountID, roomID })
  activeIdentityRef.current = { accountID, roomID }
  const [dossier, setDossier] = useState<ContactDossierSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [linkTargetID, setLinkTargetID] = useState('')
  const [linkingRoomID, setLinkingRoomID] = useState('')
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    let active = true
    let receivedUpdate = false
    setDossier(null)
    setLoading(true)
    setRefreshing(false)
    setLinkingRoomID('')
    setActionError('')
    setLinkTargetID('')
    const unsubscribe = Events.On('contact-dossier:update', (event: { data: unknown }) => {
      const next = event.data as ContactDossierSnapshot | undefined
      if (!next || next.accountId !== accountID || next.roomId !== roomID) return
      receivedUpdate = true
      setDossier(next)
      setLoading(false)
    })
    void AppService.ContactDossier(roomID)
      .then((next) => {
        if (!active || receivedUpdate || next.accountId !== accountID || next.roomId !== roomID) return
        setDossier(next)
      })
      .catch((error: unknown) => {
        if (active) setActionError(describeError(error))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [accountID, roomID])

  async function refreshDossier() {
    const isCurrent = () => activeIdentityRef.current.accountID === accountID && activeIdentityRef.current.roomID === roomID
    setActionError('')
    setRefreshing(true)
    try {
      const next = await AppService.RefreshContactDossier(roomID)
      if (isCurrent() && next.accountId === accountID && next.roomId === roomID) {
        setDossier((current) => current && current.updatedAt > next.updatedAt ? current : next)
      }
    } catch (error) {
      if (isCurrent()) setActionError(describeError(error))
    } finally {
      if (isCurrent()) setRefreshing(false)
    }
  }

  async function reloadDossier() {
    const next = await AppService.ContactDossier(roomID)
    if (activeIdentityRef.current.accountID === accountID && activeIdentityRef.current.roomID === roomID && next.accountId === accountID && next.roomId === roomID) setDossier(next)
  }

  async function linkChat() {
    if (!linkTargetID) return
    const isCurrent = () => activeIdentityRef.current.accountID === accountID && activeIdentityRef.current.roomID === roomID
    setActionError('')
    setLinkingRoomID(linkTargetID)
    try {
      await AppService.LinkRelationshipContact(roomID, linkTargetID)
      if (!isCurrent()) return
      await reloadDossier()
      if (isCurrent()) setLinkTargetID('')
    } catch (error) {
      if (isCurrent()) setActionError(describeError(error))
    } finally {
      if (isCurrent()) setLinkingRoomID('')
    }
  }

  async function unlinkChat(linkedRoomID: string) {
    const isCurrent = () => activeIdentityRef.current.accountID === accountID && activeIdentityRef.current.roomID === roomID
    setActionError('')
    setLinkingRoomID(linkedRoomID)
    try {
      await AppService.UnlinkRelationshipContact(linkedRoomID)
      if (!isCurrent()) return
      await reloadDossier()
    } catch (error) {
      if (isCurrent()) setActionError(describeError(error))
    } finally {
      if (isCurrent()) setLinkingRoomID('')
    }
  }

  const busy = loading || refreshing || Boolean(dossier?.analyzing)
  const error = actionError || dossier?.error || ''
  const keyFacts = dossier?.keyFacts ?? []
  const commitments = dossier?.unresolvedCommitments ?? []
  const linkedRoomIDs = dossier?.linkedRoomIds ?? [roomID]
  const linkedRooms = rooms.filter((room) => linkedRoomIDs.includes(room.id))
  const linkableRooms = rooms.filter((room) => room.id !== roomID && !linkedRoomIDs.includes(room.id))
  const hasDossier = Boolean(keyFacts.length || dossier?.lastRecap || commitments.length)

  return (
    <aside className="contact-hud" aria-label="Contact dossier" aria-busy={busy}>
      <header className="contact-hud-header">
        <div className="contact-hud-title">
          <span className="eyebrow">LOCAL DOSSIER</span>
          <h2>{dossier?.displayName || 'Contact'}</h2>
          <div className="contact-hud-badges">
            {(dossier?.linkedChannels ?? []).map((channel) => <span className="contact-hud-badge" key={channel}>{channel}</span>)}
          </div>
        </div>
        <button className="icon-button" type="button" aria-label="Close contact dossier" title="Close dossier" onClick={onClose}><X size={15} /></button>
      </header>
      <div className="contact-hud-content">
        <button className="contact-hud-refresh" type="button" disabled={!dossier?.enabled || busy} onClick={() => void refreshDossier()}>
          <RefreshCw size={14} className={busy ? 'is-spinning' : ''} />
          {refreshing || dossier?.analyzing ? 'Refreshing dossier' : 'Refresh Dossier'}
        </button>
        {!dossier?.enabled && <p className="contact-hud-state">Enable Relationship Health in Settings to analyze this contact with your local model.</p>}
        {error && <p className="contact-hud-state is-error" role="alert">{error}</p>}
        {dossier?.insufficientData && !hasDossier && <p className="contact-hud-state">More chat history is needed. A dossier can be created after at least three messages.</p>}
        {busy && !hasDossier && <p className="contact-hud-state" role="status"><span className="loading-mark" />Analyzing linked local chats…</p>}
        {!busy && dossier?.enabled && !hasDossier && !dossier.insufficientData && <p className="contact-hud-state">No dossier yet. Refresh to analyze the recent chat history.</p>}
        {dossier && <details className="contact-hud-section" open>
          <summary>Linked chats <span>{linkedRooms.length}</span></summary>
          <ul className="contact-hud-linked-chats">
            {linkedRooms.map((room) => <li key={room.id}>
              <span>{room.name || room.id}<small>{room.bridge || 'Matrix'}</small></span>
              {linkedRooms.length > 1 && <button className="contact-hud-link-action" type="button" aria-label={`Unlink ${room.name || room.id}`} title={`Unlink ${room.name || room.id}`} disabled={Boolean(linkingRoomID)} onClick={() => void unlinkChat(room.id)}><Unlink size={13} /></button>}
            </li>)}
          </ul>
          {linkableRooms.length > 0 && <div className="contact-hud-link-controls">
            <label htmlFor="contact-hud-link-room">Link another chat</label>
            <select id="contact-hud-link-room" aria-label="Chat to link" value={linkTargetID} disabled={Boolean(linkingRoomID)} onChange={(event) => setLinkTargetID(event.target.value)}>
              <option value="">Choose a direct chat</option>
              {linkableRooms.map((room) => <option key={room.id} value={room.id}>{room.name || room.id} · {room.bridge || 'Matrix'}</option>)}
            </select>
            <button className="contact-hud-link-action is-labeled" type="button" disabled={!linkTargetID || Boolean(linkingRoomID)} onClick={() => void linkChat()}><Link2 size={13} />{linkingRoomID ? 'Linking…' : 'Link chat'}</button>
          </div>}
        </details>}
        {hasDossier && <>
          <details className="contact-hud-section" open>
            <summary>Key Facts <span>{keyFacts.length}</span></summary>
            <div className="contact-hud-tags">
              {keyFacts.map((fact, index) => <span className="contact-hud-tag" key={`${fact}-${index}`}>{fact}</span>)}
            </div>
          </details>
          <details className="contact-hud-section" open>
            <summary>Last Interaction Recap</summary>
            <p>{dossier?.lastRecap || 'No meaningful interaction recap yet.'}</p>
          </details>
          <details className="contact-hud-section" open>
            <summary>Pending Follow-ups <span>{commitments.length}</span></summary>
            {commitments.length > 0
              ? <ul>{commitments.map((commitment, index) => <li key={`${commitment}-${index}`}>{commitment}</li>)}</ul>
              : <p>No unresolved commitments.</p>}
          </details>
          {dossier?.updatedAt ? <p className="contact-hud-updated">Updated {updatedAtLabel(dossier.updatedAt)}</p> : null}
        </>}
      </div>
    </aside>
  )
}