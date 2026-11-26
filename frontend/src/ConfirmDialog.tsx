import { useId, useState } from 'react'
import { DialogScrim, DialogSurface } from './DialogSurface'

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  rememberLabel,
  onCancel,
  onConfirm,
}: {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  rememberLabel?: string
  onCancel: () => void
  onConfirm: (remember?: boolean) => void
}) {
  const titleID = useId()
  const [remember, setRemember] = useState(false)
  return (
    <DialogScrim variant="modal" className="confirm-scrim" onDismiss={onCancel}>
      <DialogSurface className="confirm-dialog" role="alertdialog" labelledBy={titleID} onClose={onCancel}>
        <h2 id={titleID}>{title}</h2>
        <p>{message}</p>
        {rememberLabel && (
          <label className="confirm-remember">
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            <span>{rememberLabel}</span>
          </label>
        )}
        <div>
          <button type="button" onClick={onCancel}>{cancelLabel}</button>
          <button className={danger ? 'is-danger' : undefined} type="button" onClick={() => onConfirm(remember)}>{confirmLabel}</button>
        </div>
      </DialogSurface>
    </DialogScrim>
  )
}
