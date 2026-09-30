import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** A focused decision surface. The owner controls open state and retains drafts. */
export function FocusDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose }, [onClose])
  useEffect(() => {
    const previous = document.activeElement
    heading.current?.focus()
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); return }
      if (event.key !== 'Tab') return
      const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]') ?? [])
      const first = controls[0], last = controls.at(-1)
      if (!first || !last) { event.preventDefault(); heading.current?.focus(); return }
      const active = document.activeElement
      if (event.shiftKey && (active === first || !controls.some(control => control === active))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (active === last || !controls.some(control => control === active))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keyboard, true)
    return () => { document.removeEventListener('keydown', keyboard, true); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  return createPortal(<div className="reservation-dialog-backdrop"><div className="reservation-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panel}>
    <h2 id={titleId} tabIndex={-1} ref={heading}>{title}</h2>{children}
  </div></div>, document.body)
}
