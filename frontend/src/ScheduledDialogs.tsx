import { Check, RotateCcw, X } from 'lucide-react'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import type { Room, ScheduledJob } from '../bindings/mychat/desktop/models.js'
import { DialogSurface } from './DialogSurface'
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

export function ScheduledJobsDialog({ rooms, jobs, loading, error, times, setTimes, busyID, onManage, onClose }: ScheduledJobsDialogProps) {
  return (
    <div className="room-info-scrim" role="presentation" onClick={onClose}>
      <DialogSurface className="room-info-dialog scheduled-dialog" labelledBy="scheduled-jobs-title" onClose={onClose} onClick={(event) => event.stopPropagation()}>
        <header className="room-info-header">
          <div><span className="eyebrow">YOUR QUEUE</span><h2 id="scheduled-jobs-title">Scheduled messages and reminders</h2></div>
          <button className="icon-button" type="button" aria-label="Close scheduled jobs" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="room-info-content scheduled-job-list" aria-live="polite">
          {error && <p className="room-info-state is-error" role="alert">{error}</p>}
          {loading && <div className="room-info-state"><span className="loading-mark" />Loading scheduled jobs</div>}
          {!loading && jobs.length === 0 && <p className="room-info-state">No scheduled messages or reminders.</p>}
          {jobs.map((job) => {
            const roomName = rooms.find((room) => room.id === job.roomId)?.name || job.roomId
            const editable = job.status === 'pending' || job.status === 'failed'
            const dismissible = job.status === 'fired' || job.status === 'sent-late'
            const statusLabel = job.status === 'pending' ? 'Scheduled'
              : job.status === 'sending' ? 'Sending'
                : job.status === 'failed' ? 'Failed'
                  : job.status === 'fired' ? 'Due now'
                    : job.status === 'sent-late' ? 'Sent late' : job.status
            return <article className="scheduled-job" key={job.id}>
              <div className="scheduled-job-heading">
                <div><strong>{job.kind === 'message' ? 'Scheduled message' : 'Reminder'}</strong><span className={`scheduled-job-status is-${job.status}`}>{statusLabel}</span></div>
                <time>{formatScheduledTime(job.dueAt)}</time>
              </div>
              <span className="scheduled-job-room">{roomName}</span>
              {job.replyToEventId && <span className="scheduled-job-room">Reply to {job.replyToEventId}</span>}
              <p>{job.text || (job.kind === 'reminder' ? 'Reminder for a message' : '')}</p>
              {editable && <label className="scheduled-job-time">New time
                <input type="datetime-local" value={times[job.id] ?? localDateTimeInputValue(job.dueAt)} onChange={(event) => setTimes((current) => ({ ...current, [job.id]: event.target.value }))} />
              </label>}
              {job.error && <p className="scheduled-job-error" role="alert">{job.error}</p>}
              <div className="scheduled-job-actions">
                {editable && <button className="settings-command" type="button" disabled={busyID === job.id} onClick={() => void onManage(job.id, 'reschedule')}><Check size={14} />Save time</button>}
                {job.status === 'failed' && job.kind === 'message' && <button className="settings-command" type="button" disabled={busyID === job.id} onClick={() => void onManage(job.id, 'retry')}><RotateCcw size={14} />Retry</button>}
                {editable && <button className="settings-command is-danger" type="button" disabled={busyID === job.id} onClick={() => void onManage(job.id, 'cancel')}><X size={14} />Cancel</button>}
                {dismissible && <button className="settings-command" type="button" disabled={busyID === job.id} onClick={() => void onManage(job.id, 'dismiss')}><Check size={14} />Dismiss</button>}
              </div>
            </article>
          })}
        </div>
        <footer className="room-info-footer"><button className="settings-command" type="button" onClick={onClose}>Close</button></footer>
      </DialogSurface>
    </div>
  )
}

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

export function ScheduledDraftDialog({ draft, rooms, dueAt, setDueAt, setDraft, saving, error, suggestions, onSubmit, onClose }: ScheduledDraftDialogProps) {
  return (
    <div className="room-info-scrim" role="presentation" onClick={onClose}>
      <DialogSurface className="room-info-dialog scheduled-editor" labelledBy="scheduled-editor-title" onClose={onClose} onClick={(event) => event.stopPropagation()}>
        <header className="room-info-header">
          <div><span className="eyebrow">{draft.kind === 'message' ? draft.replyToEventID ? 'SCHEDULE REPLY' : 'SCHEDULE SEND' : 'MESSAGE REMINDER'}</span><h2 id="scheduled-editor-title">{draft.kind === 'message' ? draft.replyToEventID ? 'Schedule reply' : 'Schedule message' : 'Set reminder'}</h2></div>
          <button className="icon-button" type="button" aria-label="Close schedule dialog" onClick={onClose}><X size={16} /></button>
        </header>
        <form className="scheduled-editor-form" onSubmit={onSubmit}>
          <div className="room-info-content scheduled-editor-content">
            <p className="scheduled-editor-room">To {rooms.find((room) => room.id === draft.roomID)?.name || draft.roomID}</p>
            {draft.kind === 'message'
              ? <>
                {draft.replyToEventID && <div className="scheduled-reply-context"><strong>Replying to {draft.replyToSender}</strong><span>{draft.replyToPreview}</span></div>}
                <p className="scheduled-draft-preview">{draft.text}</p>
              </>
              : <>
                <label>Reminder note <input type="text" value={draft.text} onChange={(event) => setDraft((current) => current?.kind === 'reminder' ? { ...current, text: event.target.value } : current)} placeholder="Optional note" spellCheck={false} autoCorrect="off" autoCapitalize="off" /></label>
                <label className="scheduled-archive-toggle">
                  <input type="checkbox" aria-label="Archive room after setting reminder" checked={Boolean(draft.archiveAfter)} disabled={saving} onChange={(event) => setDraft((current) => current?.kind === 'reminder' ? { ...current, archiveAfter: event.target.checked } : current)} />
                  <span>Archive this room after setting the reminder</span>
                </label>
              </>}
            <label>{draft.kind === 'message' ? 'Send at' : 'Remind me at'}
              <input type="datetime-local" required value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
            </label>
            <div className="scheduled-time-suggestions" role="group" aria-label="Time suggestions">
              {suggestions.map((minutes) => <button key={minutes} className="settings-command" type="button" onClick={() => setDueAt(localDateTimeInputValue(Date.now() + minutes * 60_000))}>{formatTimeSuggestion(minutes)}</button>)}
            </div>
            {error && <p className="room-info-state is-error" role="alert">{error}</p>}
          </div>
          <footer className="room-info-footer">
            <button className="settings-command" type="button" disabled={saving} onClick={onClose}>Cancel</button>
            <button className="settings-command is-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : draft.kind === 'message' ? draft.replyToEventID ? 'Schedule reply' : 'Schedule message' : 'Set reminder'}</button>
          </footer>
        </form>
      </DialogSurface>
    </div>
  )
}
