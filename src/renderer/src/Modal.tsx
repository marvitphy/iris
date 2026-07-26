import { useEffect } from 'react'
import { Close } from './Icons'

interface ModalProps {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}

/**
 * The one modal primitive for Iris. Native-feeling: dimmed backdrop, a single elevated sheet,
 * Escape to close, click-outside to close, focus kept inside the app chrome. Every dialog in the app
 * uses this so they all look and behave identically.
 */
export function Modal({ title, subtitle, onClose, children, footer }: ModalProps): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div className="modal-titles">
            <div className="modal-title">{title}</div>
            {subtitle && <div className="modal-sub">{subtitle}</div>}
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            <Close size={16} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  )
}
