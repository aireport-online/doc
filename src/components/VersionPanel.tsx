import { useState, type FormEvent } from 'react'
import { Ellipsis, Pencil, Trash2, X } from 'lucide-react'
import type { Version } from '../lib/api'
import { formatDay, formatMoment, formatNumber, formatTime, joinNames, plural } from '../lib/format'
import { AuthorDot, MenuItem, Popover } from './ui'

interface Props {
  versions: Version[] | null
  failed: boolean
  onRetry: () => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  onSave: (name: string | null) => Promise<void>
  onRename: (id: string, name: string | null) => Promise<void>
  onDelete: (version: Version) => void
  onClose: () => void
}

/** What a version is called when nobody named it. */
export function versionLabel(version: Version): string | null {
  if (version.name) return version.name
  if (version.kind === 'restore' && version.restoredFrom) return `Versie van ${formatMoment(version.restoredFrom).toLowerCase()} hersteld`
  return null
}

function wordDelta(version: Version, older: Version | undefined): string {
  const delta = version.words - (older?.words ?? 0)
  if (delta === 0) return ''
  return ` (${delta > 0 ? '+' : '−'}${formatNumber(Math.abs(delta))})`
}

function VersionRow({ version, older, selected, onSelect, onRename, onDelete }: { version: Version; older: Version | undefined; selected: boolean; onSelect: () => void; onRename: (name: string | null) => Promise<void>; onDelete: () => void }) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(version.name ?? '')
  const label = versionLabel(version)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    await onRename(name.trim() || null)
    setRenaming(false)
  }

  return (
    <li className="version" aria-current={selected} data-named={Boolean(version.name)}>
      {renaming ? (
        <form className="version-rename joined" onSubmit={submit}>
          <span className="version-dot" />
          <input
            className="input input-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)}
            placeholder="Naam van deze versie"
            aria-label="Naam van deze versie"
            maxLength={120}
            autoFocus
          />
          <button type="submit" className="btn btn-secondary">
            Opslaan
          </button>
        </form>
      ) : (
        <>
          <button type="button" className="version-main" onClick={onSelect}>
            <span className="version-dot" />
            <span className="version-line">
              <span className="version-time num">{formatTime(version.createdAt)}</span>
              {label && <span className={version.name ? 'version-name' : 'version-name muted'}>{label}</span>}
            </span>
            <span className="version-meta">
              {version.authors.length > 0 && (
                <span className="version-authors">
                  {version.authors.map((author) => (
                    <AuthorDot key={author.name} color={author.color} />
                  ))}
                  {joinNames(version.authors.map((author) => author.name))}
                </span>
              )}
              <span className="num">
                {plural(version.words, 'woord', 'woorden')}
                {wordDelta(version, older)}
              </span>
            </span>
          </button>
          <span className="version-menu">
            <Popover
              align="end"
              trigger={(props) => (
                <button type="button" className="icon-btn" aria-label={`Meer voor de versie van ${formatTime(version.createdAt)}`} {...props}>
                  <Ellipsis size={16} />
                </button>
              )}
            >
              {(close) => (
                <>
                  <MenuItem
                    icon={<Pencil size={16} />}
                    onSelect={() => {
                      close()
                      setName(version.name ?? '')
                      setRenaming(true)
                    }}
                  >
                    {version.name ? 'Naam wijzigen' : 'Naam geven'}
                  </MenuItem>
                  <MenuItem
                    danger
                    icon={<Trash2 size={16} />}
                    onSelect={() => {
                      close()
                      onDelete()
                    }}
                  >
                    Versie verwijderen
                  </MenuItem>
                </>
              )}
            </Popover>
          </span>
        </>
      )}
    </li>
  )
}

export function VersionPanel({ versions, failed, onRetry, selectedId, onSelect, onSave, onRename, onDelete, onClose }: Props) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await onSave(name.trim() || null)
      setName('')
    } finally {
      setSaving(false)
    }
  }

  // Versions arrive newest first; group them under the day they were saved.
  const days: { label: string; items: { version: Version; older: Version | undefined }[] }[] = []
  versions?.forEach((version, index) => {
    const label = formatDay(version.createdAt)
    if (days[days.length - 1]?.label !== label) days.push({ label, items: [] })
    days[days.length - 1].items.push({ version, older: versions[index + 1] })
  })

  return (
    <aside className="panel" aria-label="Versiegeschiedenis">
      <div className="panel-head">
        <h2>Versiegeschiedenis</h2>
        <button type="button" className="icon-btn" aria-label="Versiegeschiedenis sluiten" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <form className="panel-save" onSubmit={save}>
        <label className="field-label" htmlFor="version-name">
          Deze stand bewaren
        </label>
        <div className="joined">
          <input id="version-name" className="input input-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Bijvoorbeeld: Na de redactieronde" maxLength={120} />
          <button type="submit" className="btn btn-secondary" disabled={saving}>
            Bewaren
          </button>
        </div>
        <p className="hint">Tijdens het schrijven komt er elke paar minuten vanzelf een versie bij, en na elke schrijfsessie.</p>
      </form>

      <div className="panel-scroll">
        <button type="button" className="live-row" aria-current={selectedId === null} onClick={() => onSelect(null)}>
          <span className="live-dot" />
          <span>
            <strong style={{ fontWeight: 500 }}>Huidig document</strong>
            <span className="muted" style={{ display: 'block', fontSize: 12, lineHeight: '18px' }}>
              Wat iedereen nu ziet en bewerkt
            </span>
          </span>
        </button>

        {failed && (
          <div className="inline-error" role="alert">
            De versies konden niet worden geladen.
            <button type="button" className="btn btn-ghost" onClick={onRetry}>
              Opnieuw
            </button>
          </div>
        )}

        {versions === null && !failed && (
          <ul className="timeline" aria-busy="true">
            {[120, 160, 96].map((width) => (
              <li key={width} style={{ padding: '10px 4px 10px 32px' }}>
                <span className="skeleton" style={{ width }} />
              </li>
            ))}
          </ul>
        )}

        {versions?.length === 0 && <p className="empty">Nog geen versies. De eerste verschijnt zodra er iets is geschreven, of bewaar hierboven zelf een stand.</p>}

        {days.map((day) => (
          <section key={day.label}>
            <h3 className="timeline-day" style={{ fontWeight: 400 }}>
              {day.label}
            </h3>
            <ol className="timeline">
              {day.items.map(({ version, older }) => (
                <VersionRow
                  key={version.id}
                  version={version}
                  older={older}
                  selected={selectedId === version.id}
                  onSelect={() => onSelect(version.id)}
                  onRename={(value) => onRename(version.id, value)}
                  onDelete={() => onDelete(version)}
                />
              ))}
            </ol>
          </section>
        ))}
      </div>
    </aside>
  )
}
