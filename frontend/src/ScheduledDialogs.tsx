import { memo, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, RotateCcw, X } from 'lucide-react'
import type { Room, ScheduledJob } from '../bindings/mychat/desktop/models.js'
import { DialogScrim, DialogSurface } from './DialogSurface'
import { formatScheduledTime, formatTimeSuggestion, localDateTimeInputValue, type ScheduledDraft } from './appShared'

export type ScheduledJobAction = 'reschedule' | 'cancel' | 'retry' | 'dismiss'

export type ScheduledJobsDialogProps = {
  rooms: Room[]
  jobs: ScheduledJob[]
  loading: boolean
  error: string
  times: Record<string, string>
  setTimes: Dispatch<SetStateAction<Record<string, string>>>
  busyID: string
  onManage: (id: string, action: ScheduledJobAction) => void
  onClose: () => void
}

export const ScheduledJobsDialog = memo(function ScheduledJobsDialog({ rooms, jobs, loading, error, times, setTimes, busyID, onManage, onClose }: ScheduledJobsDialogProps) {
  const { t } = useTranslation()
  return (
    <DialogScrim variant="modal" onDismiss={onClose}>
      <DialogSurface className="dialog-modal-card scheduled-dialog" labelledBy="scheduled-jobs-title" onClose={onClose}>
        <header className="room-info-header">
          <div><span className="eyebrow">{t('scheduled.queueEyebrow')}</span><h2 id="scheduled-jobs-title">{t('scheduled.jobsTitle')}</h2></div>
          <button className="icon-button" type="button" aria-label={t('scheduled.closeJobs')} onClick={onClose}><X size={16} /></button>
        </header>
        <div className="room-info-content scheduled-job-list" aria-live="polite">
          {error && <p className="room-info-state is-error" role="alert">{error}</p>}
          {loading && <div className="room-info-state"><span className="loading-mark" />{t('scheduled.loadingJobs')}</div>}
          {!loading && jobs.length === 0 && <p className="room-info-state">{t('scheduled.emptyJobs')}</p>}
          {jobs.map((job) => {
            const roomName = rooms.find((room) => room.id === job.roomId)?.name || job.roomId
            const editable = job.status === 'pending' || job.status === 'failed'
            const dismissible = job.status === 'fired' || job.status === 'sent-late'
            const statusLabel = job.status === 'pending' ? t('scheduled.statusScheduled')
              : job.status === 'sending' ? t('scheduled.statusSending')
                : job.status === 'failed' ? t('scheduled.statusFailed')
                  : job.status === 'fired' ? t('scheduled.statusDueNow')
                    : job.status === 'sent-late' ? t('scheduled.statusSentLate') : job.status
            return <article className="scheduled-job" key={job.id}>
              <div className="scheduled-job-heading">
                <div><strong>{job.kind === 'message' ? t('scheduled.kindMessage') : t('scheduled.kindReminder')}</strong><span className={`scheduled-job-status is-${job.status}`}>{statusLabel}</span></div>
                <time>{formatScheduledTime(job.dueAt)}</time>
              </div>
              <span className="scheduled-job-room">{roomName}</span>
              {job.replyToEventId && <span className="scheduled-job-room">{t('scheduled.replyToEvent', { eventId: job.replyToEventId })}</span>}
              <p>{job.text || (job.kind === 'reminder' ? t('scheduled.reminderFallback') : '')}</p>
              {editable && <label className="scheduled-job-time">{t('scheduled.newTime')}
                <input type="datetime-local" value={times[job.id] ?? localDateTimeInputValue(job.dueAt)} onChange={(event) => setTimes((current) => ({ ...current, [job.id]: event.target.value }))} />
              </label>}
              {job.error && <p className="scheduled-job-error" role="alert">{job.error}</p>}
              <div className="scheduled-job-actions">
                {editable && <button className="settings-command" type="button" disabled={busyID === job.id} onClick={() => void onManage(job.id, 'reschedule')}><Check size={14} />{t('scheduled.saveTime')}</button>}
                {job.status === 'failed' && job.kind === 'message' && <button className="settings-command" type="button" disabled={busyID === job.id} onClick={() => void onManage(job.id, 'retry')}><RotateCcw size={14} />{t('scheduled.retry')}</button>}
                {editable && <button className="settings-command is-danger" type="button" disabled={busyID === job.id} onClick={() => void onManage(job.id, 'cancel')}><X size={14} />{t('common.cancel')}</button>}
                {dismissible && <button className="settings-command" type="button" disabled={busyID === job.id} onClick={() => void onManage(job.id, 'dismiss')}><Check size={14} />{t('scheduled.dismiss')}</button>}
              </div>
            </article>
          })}
        </div>
        <footer className="room-info-footer"><button className="settings-command" type="button" onClick={onClose}>{t('common.close')}</button></footer>
      </DialogSurface>
    </DialogScrim>
  )
})

export type ScheduledDraftDialogProps = {
  draft: ScheduledDraft
  rooms: Room[]
  dueAt: string
  setDueAt: (value: string) => void
  setDraft: Dispatch<SetStateAction<ScheduledDraft | null>>
  saving: boolean
  error: string
  suggestions: number[]
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
  onClose: () => void
}

export const ScheduledDraftDialog = memo(function ScheduledDraftDialog({ draft, rooms, dueAt, setDueAt, setDraft, saving, error, suggestions, onSubmit, onClose }: ScheduledDraftDialogProps) {
  const { t } = useTranslation()
  const close = () => { if (!saving) onClose() }
  return (
    <DialogScrim variant="modal" onDismiss={close}>
      <DialogSurface className="dialog-modal-card scheduled-editor" labelledBy="scheduled-editor-title" onClose={close}>
        <header className="room-info-header">
          <div><span className="eyebrow">{draft.kind === 'message' ? draft.replyToEventID ? t('scheduled.eyebrowReply') : t('scheduled.eyebrowSend') : t('scheduled.eyebrowReminder')}</span><h2 id="scheduled-editor-title">{draft.kind === 'message' ? draft.replyToEventID ? t('scheduled.titleReply') : t('scheduled.titleMessage') : t('scheduled.titleReminder')}</h2></div>
          <button className="icon-button" type="button" aria-label={t('scheduled.closeDraftDialog')} disabled={saving} onClick={close}><X size={16} /></button>
        </header>
        <form className="scheduled-editor-form" aria-busy={saving} onSubmit={onSubmit}>
          <div className="room-info-content scheduled-editor-content">
            <p className="scheduled-editor-room">{t('scheduled.toRoom', { room: rooms.find((room) => room.id === draft.roomID)?.name || draft.roomID })}</p>
            {draft.kind === 'message'
              ? <>
                {draft.replyToEventID && <div className="scheduled-reply-context"><strong>{t('scheduled.replyingTo', { sender: draft.replyToSender })}</strong><span>{draft.replyToPreview}</span></div>}
                <p className="scheduled-draft-preview">{draft.text}</p>
              </>
              : <>
                <label>{t('scheduled.reminderNote')} <input type="text" disabled={saving} value={draft.text} onChange={(event) => setDraft((current) => current?.kind === 'reminder' ? { ...current, text: event.target.value } : current)} placeholder={t('scheduled.optionalNote')} spellCheck={false} autoCorrect="off" autoCapitalize="off" /></label>
                <label className="scheduled-archive-toggle">
                  <input type="checkbox" aria-label={t('scheduled.archiveAfterLabel')} checked={Boolean(draft.archiveAfter)} disabled={saving} onChange={(event) => setDraft((current) => current?.kind === 'reminder' ? { ...current, archiveAfter: event.target.checked } : current)} />
                  <span>{t('scheduled.archiveAfterText')}</span>
                </label>
              </>}
            <label>{draft.kind === 'message' ? t('scheduled.sendAt') : t('scheduled.remindMeAt')}
              <input type="datetime-local" required disabled={saving} value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
            </label>
            <div className="scheduled-time-suggestions" role="group" aria-label={t('scheduled.timeSuggestions')}>
              {suggestions.map((minutes) => <button key={minutes} className="settings-command" type="button" disabled={saving} onClick={() => setDueAt(localDateTimeInputValue(Date.now() + minutes * 60_000))}>{formatTimeSuggestion(minutes)}</button>)}
            </div>
            {error && <p className="room-info-state is-error" role="alert">{error}</p>}
          </div>
          <footer className="room-info-footer">
            <button className="settings-command" type="button" disabled={saving} onClick={onClose}>{t('common.cancel')}</button>
            <button className="settings-command is-primary" type="submit" disabled={saving}>{saving ? t('scheduled.saving') : draft.kind === 'message' ? draft.replyToEventID ? t('scheduled.titleReply') : t('scheduled.titleMessage') : t('scheduled.titleReminder')}</button>
          </footer>
        </form>
      </DialogSurface>
    </DialogScrim>
  )
})
