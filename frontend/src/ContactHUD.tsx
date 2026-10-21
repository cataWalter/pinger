import { useEffect, useState } from 'react'
import { Events } from '@wailsio/runtime'
import { AppService } from '../bindings/mychat/desktop'
import type { ContactDossierSnapshot } from '../bindings/mychat/desktop/models.js'
import { RefreshCw, X } from 'lucide-react'

type ContactHUDProps = {
  accountID: string
  roomID: string
  onClose: () => void
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function updatedAtLabel(timestamp: number) {
  if (!timestamp) return ''
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp))
}

export default function ContactHUD({ accountID, roomID, onClose }: ContactHUDProps) {
  const [dossier, setDossier] = useState<ContactDossierSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    let active = true
    let receivedUpdate = false
    setDossier(null)
    setLoading(true)
    setActionError('')
    const unsubscribe = Events.On('contact-dossier:update', (event: any) => {
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
    setActionError('')
    setRefreshing(true)
    try {
      const next = await AppService.RefreshContactDossier(roomID)
      if (next.accountId === accountID && next.roomId === roomID) {
        setDossier((current) => current && current.updatedAt > next.updatedAt ? current : next)
      }
    } catch (error) {
      setActionError(describeError(error))
    } finally {
      setRefreshing(false)
    }
  }

  const busy = loading || refreshing || Boolean(dossier?.analyzing)
  const error = actionError || dossier?.error || ''
  const keyFacts = dossier?.keyFacts ?? []
  const commitments = dossier?.unresolvedCommitments ?? []
  const hasDossier = Boolean(keyFacts.length || dossier?.lastRecap || commitments.length)

  return (
    <aside className="contact-hud" aria-label="Contact dossier" aria-busy={busy}>
      <header className="contact-hud-header">
        <div className="contact-hud-title">
          <span className="eyebrow">LOCAL DOSSIER</span>
          <h2>{dossier?.displayName || 'Contact'}</h2>
          <div className="contact-hud-badges">
            {dossier?.tier && dossier.tier !== 'NONE' && <span className="contact-hud-badge is-tier">{dossier.tier.replace(/_/g, ' ')}</span>}
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