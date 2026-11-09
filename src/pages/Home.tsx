import { useCallback, useEffect, useState, type FormEvent, type MouseEvent } from 'react'
import { Ellipsis, FileText, Link2, ListX, Plus, Trash2 } from 'lucide-react'
import { api, type DocumentInfo } from '../lib/api'
import { formatMoment, plural } from '../lib/format'
import { forgetDocument, loadRecents, rememberDocument, type Recent } from '../lib/recents'
import { documentPath, documentUrl, navigate, tokenFromLink } from '../lib/router'
import { useUser } from '../lib/user'
import { ConfirmDialog, ProfileDialog } from '../components/dialogs'
import { Avatar, copyText, Logo, MenuItem, Popover, useToast } from '../components/ui'

const UNTITLED = 'Naamloos document'

interface Row extends Recent {
  /** Unknown until the server answered. */
  updatedAt: number | null
}

const followLink = (path: string) => (event: MouseEvent) => {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
  event.preventDefault()
  navigate(path)
}

export function Home() {
  const user = useUser()
  const [toast, showToast] = useToast()
  const [rows, setRows] = useState<Row[]>(() => loadRecents().map((r) => ({ ...r, updatedAt: null })))
  const [loading, setLoading] = useState(rows.length > 0)
  const [failed, setFailed] = useState(false)
  const [creating, setCreating] = useState(false)
  const [link, setLink] = useState('')
  const [linkError, setLinkError] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [deleting, setDeleting] = useState<Row | null>(null)

  const refresh = useCallback(async () => {
    const recents = loadRecents()
    if (recents.length === 0) {
      setRows([])
      setLoading(false)
      return
    }
    try {
      const found = new Map<string, DocumentInfo>((await api.lookup(recents.map((r) => r.token))).map((doc) => [doc.token, doc]))
      // Documents that were deleted since the last visit drop out of the list.
      recents.filter((r) => !found.has(r.token)).forEach((r) => forgetDocument(r.token))
      setRows(
        recents
          .filter((r) => found.has(r.token))
          .map((r) => ({ ...r, title: found.get(r.token)!.title, updatedAt: found.get(r.token)!.updatedAt }))
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
      )
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    document.title = 'Documenten · Doc'
    void refresh()
  }, [refresh])

  const create = async () => {
    setCreating(true)
    try {
      const doc = await api.createDocument()
      rememberDocument(doc)
      navigate(documentPath(doc.token))
    } catch {
      showToast('Het document kon niet worden aangemaakt.')
      setCreating(false)
    }
  }

  const open = (event: FormEvent) => {
    event.preventDefault()
    const token = tokenFromLink(link)
    if (!token) return setLinkError(true)
    navigate(documentPath(token))
  }

  const latest = rows.find((r) => r.updatedAt !== null)
  const summary =
    rows.length === 0
      ? 'Documenten die je maakt of via een link opent, komen hier te staan.'
      : latest
        ? `${plural(rows.length, 'document', 'documenten')} op dit apparaat. Laatst gewijzigd: “${latest.title || UNTITLED}”, ${formatMoment(latest.updatedAt!).toLowerCase()}.`
        : `${plural(rows.length, 'document', 'documenten')} op dit apparaat.`

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/" onClick={followLink('/')}>
          <Logo />
          Doc
        </a>
        <div className="topbar-spacer" />
        {user && (
          <button type="button" className="user-chip" onClick={() => setProfileOpen(true)} title="Je naam en kleur">
            <Avatar user={user} />
            {user.name}
          </button>
        )}
      </header>

      <main className="home">
        <div className="home-column">
          <div className="title-row">
            <div>
              <h1>Documenten</h1>
              <p>{summary}</p>
            </div>
            <button type="button" className="btn btn-primary" onClick={create} disabled={creating}>
              <Plus size={16} />
              Nieuw document
            </button>
          </div>

          <div className="home-grid">
            <section className="card doc-card" aria-label="Mijn documenten">
              <table className="doc-table">
                <thead>
                  <tr>
                    <th>Naam</th>
                    <th className="col-access">Toegang</th>
                    <th className="num">Laatst gewijzigd</th>
                    <th>
                      <span className="sr-only">Acties</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.token}>
                      <td className="doc-name-cell">
                        <a className="doc-link" href={documentPath(row.token)} onClick={followLink(documentPath(row.token))}>
                          <FileText size={16} />
                          <span>{row.title || UNTITLED}</span>
                        </a>
                      </td>
                      <td className="col-access">{row.role === 'edit' ? <span className="muted">Bewerken</span> : <span className="pill">Alleen lezen</span>}</td>
                      <td className="num muted">{row.updatedAt !== null ? formatMoment(row.updatedAt) : loading ? <span className="skeleton" style={{ width: 96 }} /> : '–'}</td>
                      <td>
                        <Popover
                          align="end"
                          trigger={(props) => (
                            <button type="button" className="icon-btn" aria-label={`Meer voor ${row.title || UNTITLED}`} {...props}>
                              <Ellipsis size={16} />
                            </button>
                          )}
                        >
                          {(close) => (
                            <>
                              <MenuItem
                                icon={<Link2 size={16} />}
                                onSelect={async () => {
                                  close()
                                  showToast((await copyText(documentUrl(row.token))) ? 'Link gekopieerd' : 'Kopiëren is niet gelukt')
                                }}
                              >
                                Link kopiëren
                              </MenuItem>
                              <MenuItem
                                icon={<ListX size={16} />}
                                onSelect={() => {
                                  close()
                                  forgetDocument(row.token)
                                  setRows((list) => list.filter((r) => r.token !== row.token))
                                }}
                              >
                                Uit deze lijst halen
                              </MenuItem>
                              {row.role === 'edit' && (
                                <>
                                  <div className="menu-sep" />
                                  <MenuItem
                                    danger
                                    icon={<Trash2 size={16} />}
                                    onSelect={() => {
                                      close()
                                      setDeleting(row)
                                    }}
                                  >
                                    Document verwijderen
                                  </MenuItem>
                                </>
                              )}
                            </>
                          )}
                        </Popover>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && (
                <div className="first-run">
                  <span>Nog geen documenten op dit apparaat. Begin met een leeg document of open een link die je hebt gekregen.</span>
                  <button type="button" className="btn btn-secondary" onClick={create} disabled={creating}>
                    <Plus size={16} />
                    Leeg document
                  </button>
                </div>
              )}
              {failed && (
                <div className="inline-error" role="alert" style={{ margin: '0 20px 20px' }}>
                  De lijst kon niet worden bijgewerkt.
                  <button type="button" className="btn btn-ghost" onClick={refresh}>
                    Opnieuw
                  </button>
                </div>
              )}
              {rows.length > 0 && (
                <p className="card-note">Deze lijst wordt alleen in deze browser onthouden. Bewaar de link van een document om het op een ander apparaat te openen.</p>
              )}
            </section>

            <aside className="card">
              <form className="card-pad card-section" onSubmit={open}>
                <h2>Openen via een link</h2>
                <p>Plak een link die iemand met je heeft gedeeld.</p>
                <div className="stack">
                  <div className="joined">
                    <input
                      className="input"
                      value={link}
                      onChange={(e) => {
                        setLink(e.target.value)
                        setLinkError(false)
                      }}
                      placeholder="https://…/d/…"
                      aria-label="Link naar een document"
                      aria-invalid={linkError}
                    />
                    <button type="submit" className="btn btn-secondary" disabled={!link.trim()}>
                      Openen
                    </button>
                  </div>
                  {linkError && (
                    <p role="alert" style={{ color: 'var(--negative)', marginTop: -8 }}>
                      Dit lijkt geen link naar een document.
                    </p>
                  )}
                </div>
              </form>
              <div className="card-pad card-section">
                <h2>Zo zien anderen je</h2>
                <p>Je naam staat bij je cursor en bij de versies waaraan je meeschreef.</p>
                <div className="stack">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 32 }}>
                    {user ? (
                      <>
                        <Avatar user={user} />
                        <span style={{ fontWeight: 500, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</span>
                      </>
                    ) : (
                      <span className="muted" style={{ flex: 1 }}>
                        Nog geen naam gekozen
                      </span>
                    )}
                    <button type="button" className="btn btn-secondary" onClick={() => setProfileOpen(true)}>
                      {user ? 'Wijzigen' : 'Naam kiezen'}
                    </button>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>

      {profileOpen && <ProfileDialog user={user ?? { name: '', color: '#1b6c80' }} onClose={() => setProfileOpen(false)} />}
      {deleting && (
        <ConfirmDialog
          danger
          title={`“${deleting.title || UNTITLED}” verwijderen?`}
          body="Het document en alle versies verdwijnen voor iedereen die de link heeft. Dit kan niet ongedaan worden gemaakt."
          confirm="Document verwijderen"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.deleteDocument(deleting.token)
            forgetDocument(deleting.token)
            setRows((list) => list.filter((r) => r.token !== deleting.token))
          }}
        />
      )}
      {toast}
    </div>
  )
}
