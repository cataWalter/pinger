import { Check, ShieldCheck, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import './i18n'
import { AppService } from '../bindings/mychat/desktop'
import type { Verification } from '../bindings/mychat/desktop/models.js'
import { DialogSurface } from './DialogSurface'
import { describeError } from './appShared'
import { useState } from 'react'

function verificationMessageKey(verification: Verification) {
  switch (verification.phase) {
    case 'requested':
      return verification.incoming ? 'verification.incoming' : 'verification.outgoing'
    case 'ready':
      return 'verification.ready'
    case 'comparing':
      return 'verification.comparing'
    case 'confirmed':
      return 'verification.confirmed'
    case 'done':
      return 'verification.done'
    case 'cancelled':
      return 'verification.cancelled'
    default:
      return 'verification.inProgress'
  }
}

export function VerificationDialog({ verification }: { verification: Verification }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (actionError) {
      setError(describeError(actionError))
    } finally {
      setBusy(false)
    }
  }

  const dismiss = () => run(() => AppService.CancelSessionVerification(false))
  const message = verification.phase === 'cancelled' && verification.reason
    ? verification.reason
    : t(verificationMessageKey(verification), { userId: verification.userId })

  return (
    <div className="room-info-scrim verification-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) void dismiss() }}>
      <DialogSurface className="room-info-dialog verification-dialog" labelledBy="verification-title" onClose={() => void dismiss()} onClick={(event) => event.stopPropagation()}>
        <header className="room-info-header">
          <div><span className="eyebrow">{t('verification.eyebrow')}</span><h2 id="verification-title">{t('verification.title')}</h2></div>
          {verification.phase !== 'done' && verification.phase !== 'cancelled' && (
            <button className="icon-button" type="button" aria-label={t('verification.cancelLabel')} title={t('verification.cancelLabel')} disabled={busy} onClick={() => void dismiss()}><X size={16} /></button>
          )}
        </header>
        <div className="verification-content" aria-live="polite">
          <p>{message}</p>
          {verification.phase === 'comparing' && verification.emojis && verification.emojis.length > 0 && (
            <ul className="verification-emojis" aria-label={t('verification.compareLabel')}>
              {verification.emojis.map((item, index) => (
                <li key={`${item.emoji}-${index}`}><span aria-hidden="true">{item.emoji}</span><small>{item.description}</small></li>
              ))}
            </ul>
          )}
          {verification.phase === 'comparing' && (!verification.emojis || verification.emojis.length === 0) && verification.decimals && verification.decimals.length > 0 && (
            <p className="verification-decimals" aria-label={t('verification.numbersLabel', { numbers: verification.decimals.join(' ') })}>
              {verification.decimals.map((value, index) => <strong key={`${value}-${index}`}>{String(value).padStart(3, '0')}</strong>)}
            </p>
          )}
          {error && <p className="settings-error" role="alert">{error}</p>}
        </div>
        <footer className="verification-actions">
          {verification.phase === 'requested' && verification.incoming && <>
            <button className="settings-command" type="button" disabled={busy} onClick={() => void run(() => AppService.CancelSessionVerification(false))}>{t('verification.decline')}</button>
            <button className="primary-button" type="button" disabled={busy} onClick={() => void run(() => AppService.AcceptSessionVerification())}>{busy ? t('verification.accepting') : t('verification.accept')}<Check size={15} /></button>
          </>}
          {verification.phase === 'requested' && !verification.incoming && <button className="settings-command" type="button" disabled={busy} onClick={() => void dismiss()}>{t('verification.cancel')}</button>}
          {verification.phase === 'ready' && <button className="settings-command" type="button" disabled={busy} onClick={() => void dismiss()}>{t('verification.cancel')}</button>}
          {verification.phase === 'comparing' && <>
            <button className="settings-command is-danger" type="button" disabled={busy} onClick={() => void run(() => AppService.CancelSessionVerification(true))}>{t('verification.mismatch')}</button>
            <button className="primary-button" type="button" disabled={busy} onClick={() => void run(() => AppService.ConfirmSessionVerification())}>{busy ? t('verification.confirming') : t('verification.match')}<ShieldCheck size={15} /></button>
          </>}
          {verification.phase === 'confirmed' && <button className="settings-command" type="button" disabled={busy} onClick={() => void dismiss()}>{t('verification.cancel')}</button>}
          {(verification.phase === 'done' || verification.phase === 'cancelled') && <button className="primary-button" type="button" disabled={busy} onClick={() => void dismiss()}>{busy ? t('verification.closing') : t('verification.close')}<Check size={15} /></button>}
        </footer>
      </DialogSurface>
    </div>
  )
}
