import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { DialogSurface } from './DialogSurface'

export function ProfilePhotoViewer({ source, label, onClose }: { source: string; label: string; onClose: () => void }) {
  return createPortal(
    <div className="profile-photo-viewer-scrim" role="presentation" onClick={onClose}>
      <DialogSurface
        className="profile-photo-viewer"
        label={`Profile photo for ${label}`}
        onClose={onClose}
        onClick={(event) => event.stopPropagation()}
      >
        <button className="icon-button profile-photo-viewer-close" type="button" aria-label="Close profile photo" title="Close profile photo" onClick={onClose}>
          <X size={16} />
        </button>
        <img className="profile-photo-viewer-image" src={source} alt={label} />
      </DialogSurface>
    </div>,
    document.body,
  )
}
