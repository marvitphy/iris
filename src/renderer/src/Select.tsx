import { useEffect, useRef, useState } from 'react'

export interface SelectOption {
  value: string
  label: string
  note?: string
}

interface SelectProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
}

/**
 * Iris's own select. The native dropdown is an OS widget that ignores the app's styling entirely,
 * which looks out of place in a dark, custom-chrome window; this one is drawn by us, keyboard
 * accessible, and closes on outside click or Escape.
 */
const MENU_MAX_HEIGHT = 208

export function Select({ value, options, onChange, disabled }: SelectProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<{ left: number; width: number; top: number; up: boolean } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value) ?? options[0]

  /** The menu is positioned fixed: inside a scrolling dialog an absolute menu gets clipped, and it
   *  flips above the trigger when there isn't room below. */
  const place = (): void => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - 12
    const up = below < Math.min(MENU_MAX_HEIGHT, options.length * 44) && r.top > below
    setRect({ left: r.left, width: r.width, top: up ? r.top - 6 : r.bottom + 6, up })
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    const reposition = (): void => place()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  return (
    <div className="sel" ref={ref}>
      <button
        className={`sel-trigger ${open ? 'open' : ''}`}
        onClick={() => {
          if (disabled) return
          if (!open) place()
          setOpen((o) => !o)
        }}
        disabled={disabled}
        type="button"
      >
        <span className="sel-value">
          {current?.label}
          {current?.note && <span className="sel-note">{current.note}</span>}
        </span>
        <svg className="sel-chevron" viewBox="0 0 24 24" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && rect && (
        <div
          className="sel-menu"
          role="listbox"
          style={{
            left: rect.left,
            width: rect.width,
            top: rect.up ? undefined : rect.top,
            bottom: rect.up ? window.innerHeight - rect.top : undefined,
          }}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={`sel-option ${o.value === value ? 'selected' : ''}`}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
            >
              <span className="sel-optmain">
                <span className="sel-optlabel">{o.label}</span>
                {o.note && <span className="sel-optnote">{o.note}</span>}
              </span>
              {o.value === value && (
                <svg className="sel-tick" viewBox="0 0 24 24" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
