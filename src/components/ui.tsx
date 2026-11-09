import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Author } from '../lib/api'
import { initials, USER_COLORS } from '../lib/user'

const safeColor = (color: string) => (/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#5a5e5f')

/** The product mark: a sheet with a folded corner and a text caret. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M7 3h12l7 7v19H7z" fill="#131416" />
      <path d="M19 3l7 7h-7z" fill="#1b6c80" />
      <rect x="12" y="15" width="2.5" height="9" fill="#fff" />
    </svg>
  )
}

export function Avatar({ user, small, title }: { user: Author; small?: boolean; title?: string }) {
  return (
    <span className={`avatar${small ? ' avatar-sm' : ''}`} style={{ '--c': safeColor(user.color) } as CSSProperties} title={title ?? user.name}>
      {initials(user.name)}
    </span>
  )
}

export function AuthorDot({ color }: { color: string }) {
  return <span className="author-dot" style={{ '--c': safeColor(color) } as CSSProperties} />
}

export function ColorSwatches({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Kleur">
      {USER_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={`Kleur ${USER_COLORS.indexOf(color) + 1}`}
          className="swatch"
          style={{ '--c': color } as CSSProperties}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  )
}

export function Dialog({ title, onClose, children }: { title: string; onClose?: () => void; children: ReactNode }) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const focusable = ref.current?.querySelector<HTMLElement>('[autofocus], input, button')
    focusable?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onClose) {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      previous?.focus?.()
    }
  }, [onClose])

  return createPortal(
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  )
}

interface PopoverProps {
  /** Renders the control that opens the popover. */
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' | 'dialog' }) => ReactNode
  children: (close: () => void) => ReactNode
  align?: 'start' | 'end'
  role?: 'menu' | 'dialog'
}

/** A floating panel anchored to its trigger; closes on outside click, Escape, scroll and resize. */
export function Popover({ trigger, children, align = 'start', role = 'menu' }: PopoverProps) {
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' })
  const anchor = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])

  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return
    const a = anchor.current.getBoundingClientRect()
    const p = panel.current.getBoundingClientRect()
    const left = align === 'end' ? a.right - p.width : a.left
    const below = a.bottom + 6
    setStyle({
      left: Math.max(8, Math.min(left, window.innerWidth - p.width - 8)),
      top: below + p.height > window.innerHeight - 8 ? Math.max(8, a.top - p.height - 6) : below,
    })
    panel.current.querySelector<HTMLElement>('input, button')?.focus()
  }, [open, align])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (!panel.current?.contains(target) && !anchor.current?.contains(target)) close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
        anchor.current?.querySelector<HTMLElement>('button')?.focus()
      }
    }
    const onScroll = (event: Event) => {
      if (!panel.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, close])

  return (
    <span className="popover-anchor" ref={anchor}>
      {trigger({
        onClick: () => {
          setStyle({ visibility: 'hidden' })
          setOpen((value) => !value)
        },
        'aria-expanded': open,
        'aria-haspopup': role,
      })}
      {open &&
        createPortal(
          <div className="popover" role={role} style={style} ref={panel}>
            {children(close)}
          </div>,
          document.body,
        )}
    </span>
  )
}

export function MenuItem({ icon, children, danger, onSelect }: { icon?: ReactNode; children: ReactNode; danger?: boolean; onSelect: () => void }) {
  return (
    <button type="button" role="menuitem" className={`menu-item${danger ? ' menu-item-danger' : ''}`} onClick={onSelect}>
      {icon}
      {children}
    </button>
  )
}

/** A short confirmation at the foot of the screen that leaves by itself. */
export function useToast(): [ReactNode, (message: string) => void] {
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => setMessage(null), 3200)
    return () => clearTimeout(timer)
  }, [message])
  const node = message
    ? createPortal(
        <div className="toast" role="status">
          {message}
        </div>,
        document.body,
      )
    : null
  return [node, setMessage]
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
