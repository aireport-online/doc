import { useRef, useState, type FormEvent } from 'react'
import { Check, Copy } from 'lucide-react'
import type { Author, DocumentInfo } from '../lib/api'
import { randomColor, saveUser } from '../lib/user'
import { documentUrl } from '../lib/router'
import { ColorSwatches, copyText, Dialog } from './ui'

/** Asks how others should see this person. Required once before joining a document. */
export function ProfileDialog({ user, onClose }: { user: Author | null; onClose?: () => void }) {
  const [name, setName] = useState(user?.name ?? '')
  const [color, setColor] = useState(() => user?.color ?? randomColor())
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    saveUser({ name, color })
    onClose?.()
  }
  return (
    <Dialog title={user ? 'Je naam en kleur' : 'Hoe heet je?'} onClose={user ? onClose : undefined}>
      <p className="dialog-body">Anderen zien je naam bij je cursor en bij de versies waaraan je hebt meegeschreven.</p>
      <form onSubmit={submit}>
        <div className="dialog-fields">
          <label className="field">
            <span className="field-label">Naam</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus autoComplete="name" />
          </label>
          <div className="field">
            <span className="field-label">Kleur</span>
            <ColorSwatches value={color} onChange={setColor} />
          </div>
        </div>
        <div className="dialog-actions">
          {user && onClose && (
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Annuleren
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
            {user ? 'Opslaan' : 'Verder'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function LinkRow({ label, hint, url }: { label: string; hint: string; url: string }) {
  const [copied, setCopied] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const copy = async () => {
    if (!(await copyText(url))) input.current?.select()
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="joined">
        <input ref={input} className="input" readOnly value={url} aria-label={label} onFocus={(e) => e.target.select()} />
        <button type="button" className="btn btn-secondary" onClick={copy}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? 'Gekopieerd' : 'Kopiëren'}
        </button>
      </div>
      <p className="field-hint">{hint}</p>
    </div>
  )
}

export function ShareDialog({ info, onClose }: { info: DocumentInfo; onClose: () => void }) {
  return (
    <Dialog title="Document delen" onClose={onClose}>
      <p className="dialog-body">
        Iedereen met een link kan het document openen, zonder account. Stuur de link alleen naar mensen die erbij mogen.
      </p>
      <div className="dialog-fields">
        {info.role === 'edit' && (
          <LinkRow label="Link om mee te schrijven" hint="Wie deze link heeft, kan bewerken, versies herstellen en het document verwijderen." url={documentUrl(info.token)} />
        )}
        <LinkRow label="Link om alleen te lezen" hint="Lezers zien wijzigingen direct, maar kunnen niets aanpassen." url={documentUrl(info.viewToken)} />
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Klaar
        </button>
      </div>
    </Dialog>
  )
}

interface ConfirmProps {
  title: string
  body: string
  confirm: string
  danger?: boolean
  onConfirm: () => Promise<void> | void
  onClose: () => void
}

export function ConfirmDialog({ title, body, confirm, danger, onConfirm, onClose }: ConfirmProps) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const run = async () => {
    setBusy(true)
    setFailed(false)
    try {
      await onConfirm()
      onClose()
    } catch {
      setFailed(true)
      setBusy(false)
    }
  }
  return (
    <Dialog title={title} onClose={busy ? undefined : onClose}>
      <p className="dialog-body">{body}</p>
      {failed && (
        <p className="dialog-body" role="alert" style={{ color: 'var(--negative)' }}>
          Dat is niet gelukt. Controleer je verbinding en probeer het opnieuw.
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
          Annuleren
        </button>
        <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={run} disabled={busy}>
          {confirm}
        </button>
      </div>
    </Dialog>
  )
}
