import { Paperclip } from 'lucide-react'
import { DialogScrim, DialogSurface } from './DialogSurface'
import { formatBytes, mediaApprovalKindLabels, type MediaApprovalRequest } from './appShared'

export function MediaApprovalDialog({ request, onResolve }: { request: MediaApprovalRequest; onResolve: (approved: boolean) => void }) {
  return (
    <DialogScrim variant="modal" className="confirm-scrim">
      <DialogSurface className="confirm-dialog media-approval-dialog" role="alertdialog" labelledBy="media-approval-title" onClose={() => onResolve(false)}>
        <h2 id="media-approval-title">Send media to this room?</h2>
        <p>Review each item. Nothing is uploaded until you approve.</p>
        <ul className="media-approval-list" aria-label="Media to send">
          {request.items.map((item) => (
            <li key={item.key} className={item.previewURL && (item.kind === 'audio' || item.kind === 'video') ? 'is-playable' : undefined}>
              <div className="media-approval-row">
                {item.previewURL && item.kind === 'image' ? <img src={item.previewURL} alt="" /> : <Paperclip size={14} />}
                <span className="media-approval-name" title={item.name}>{item.name}</span>
                <small>{mediaApprovalKindLabels[item.kind]} · {formatBytes(item.sizeBytes)}</small>
              </div>
              {item.previewURL && item.kind === 'audio' && <audio className="media-approval-player" controls src={item.previewURL} />}
              {item.previewURL && item.kind === 'video' && <video className="media-approval-player" controls playsInline src={item.previewURL} />}
            </li>
          ))}
        </ul>
        <div><button type="button" onClick={() => onResolve(false)}>Cancel</button><button type="button" onClick={() => onResolve(true)}>Approve and send</button></div>
      </DialogSurface>
    </DialogScrim>
  )
}

export function GeneratedImageDialog({ review, onDiscard, onApprove }: { review: { prompt: string; encoded: string }; onDiscard: () => void; onApprove: () => void }) {
  return (
    <DialogScrim variant="modal" className="confirm-scrim">
      <DialogSurface className="confirm-dialog generated-image-dialog" role="alertdialog" labelledBy="generated-image-title" onClose={onDiscard}>
        <h2 id="generated-image-title">Send generated image to this room?</h2>
        <p>Discarding keeps your draft. Nothing is sent until you approve.</p>
        <figure className="generated-image-preview">
          <img src={`data:image/png;base64,${review.encoded}`} alt="Generated image preview" />
          <figcaption>{review.prompt}</figcaption>
        </figure>
        <div><button type="button" onClick={onDiscard}>Discard</button><button type="button" onClick={onApprove}>Approve and send</button></div>
      </DialogSurface>
    </DialogScrim>
  )
}

export function LeaveRoomDialog({ roomName, error, leaving, onCancel, onConfirm }: { roomName: string; error: string; leaving: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <DialogScrim variant="modal" className="confirm-scrim">
      <DialogSurface className="confirm-dialog" role="alertdialog" labelledBy="leave-room-title" onClose={onCancel}>
        <h2 id="leave-room-title">Leave this room?</h2>
        <p>You will leave {roomName} and stop receiving its messages.</p>
        {error && <p className="room-info-state is-error" role="alert">{error}</p>}
        <div><button type="button" disabled={leaving} onClick={onCancel}>Cancel</button><button className="is-danger" type="button" disabled={leaving} onClick={onConfirm}>{leaving ? 'Leaving…' : 'Leave room'}</button></div>
      </DialogSurface>
    </DialogScrim>
  )
}

export function RedactDialog({ busy, onCancel, onConfirm }: { busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <DialogScrim variant="modal" className="confirm-scrim">
      <DialogSurface className="confirm-dialog" role="alertdialog" labelledBy="redact-title" onClose={onCancel}>
        <h2 id="redact-title">Delete message?</h2>
        <p>This removes the message for everyone in the room.</p>
        <div><button type="button" onClick={onCancel}>Cancel</button><button className="is-danger" type="button" disabled={busy} onClick={onConfirm}>{busy ? 'Deleting…' : 'Delete'}</button></div>
      </DialogSurface>
    </DialogScrim>
  )
}
