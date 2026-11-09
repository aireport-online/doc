import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { Collaboration } from '@tiptap/extension-collaboration'
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret'
import { Placeholder } from '@tiptap/extensions'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { Check, CloudOff, Ellipsis, Eye, FileCode, FileDown, History, LoaderCircle, Printer, RotateCcw, Trash2, UserRound, X } from 'lucide-react'
import { api, ApiError, type Author, type DocumentInfo, type Version } from '../lib/api'
import { schemaExtensions } from '../lib/extensions'
import type { DiffStats } from '../lib/diff'
import { exportHtml, exportMarkdown } from '../lib/export'
import { formatMoment, formatNumber, joinNames, plural } from '../lib/format'
import { forgetDocument, rememberDocument, updateRecentTitle } from '../lib/recents'
import { navigate } from '../lib/router'
import { useUser } from '../lib/user'
import { ConfirmDialog, ProfileDialog, ShareDialog } from '../components/dialogs'
import { Toolbar } from '../components/Toolbar'
import { Avatar, Logo, MenuItem, Popover, useToast } from '../components/ui'
import { VersionPanel, versionLabel } from '../components/VersionPanel'
import { VersionPreview } from '../components/VersionPreview'

const UNTITLED = 'Naamloos document'
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const CLOSE_NOT_FOUND = 4404
const CLOSE_DELETED = 4410

type Problem = 'missing' | 'deleted' | 'error'
interface Connection {
  ydoc: Y.Doc
  provider: WebsocketProvider
}

const safeColor = (color: unknown) => (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#5a5e5f')

function HomeLink() {
  return (
    <a
      className="brand"
      href="/"
      aria-label="Doc: alle documenten"
      title="Alle documenten"
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return
        event.preventDefault()
        navigate('/')
      }}
    >
      <Logo />
    </a>
  )
}

function StateScreen({ title, children, action }: { title: string; children: ReactNode; action: ReactNode }) {
  return (
    <div className="shell">
      <header className="topbar">
        <HomeLink />
      </header>
      <div className="workspace">
        <main className="sheet">
          <div className="state-screen">
            <div className="state-card">
              <h1>{title}</h1>
              <p>{children}</p>
              {action}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

function LoadingShell({ title }: { title?: string }) {
  return (
    <div className="shell" aria-busy="true">
      <header className="topbar">
        <HomeLink />
        <h1 style={{ fontSize: 16, fontWeight: 600, padding: '0 9px' }}>{title ?? <span className="skeleton" style={{ width: 160 }} />}</h1>
      </header>
      <div className="workspace">
        <main className="sheet">
          <div className="toolbar" />
          <div className="page" style={{ display: 'grid', gap: 14, width: '100%' }}>
            {[52, 94, 88, 70].map((width) => (
              <span key={width} className="skeleton" style={{ width: `${width}%`, height: 14 }} />
            ))}
          </div>
        </main>
      </div>
    </div>
  )
}

export function DocumentPage({ token }: { token: string }) {
  const user = useUser()
  const [info, setInfo] = useState<DocumentInfo | null>(null)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setInfo(null)
    setProblem(null)
    api
      .getDocument(token)
      .then((doc) => {
        if (cancelled) return
        rememberDocument(doc)
        setInfo(doc)
      })
      .catch((error) => {
        if (!cancelled) setProblem(error instanceof ApiError && error.status === 404 ? 'missing' : 'error')
      })
    return () => {
      cancelled = true
    }
  }, [token, attempt])

  useEffect(() => {
    if (problem === 'missing' || problem === 'deleted') forgetDocument(token)
  }, [problem, token])

  const home = (
    <button type="button" className="btn btn-primary" onClick={() => navigate('/')}>
      Naar mijn documenten
    </button>
  )
  if (problem === 'missing') {
    return (
      <StateScreen title="Dit document bestaat niet" action={home}>
        De link klopt niet, of het document is verwijderd. Vraag degene die de link stuurde om een nieuwe.
      </StateScreen>
    )
  }
  if (problem === 'deleted') {
    return (
      <StateScreen title="Dit document is verwijderd" action={home}>
        Iemand met de bewerklink heeft het document zojuist verwijderd. Het is voor niemand meer te openen.
      </StateScreen>
    )
  }
  if (problem === 'error') {
    return (
      <StateScreen
        title="Het document kon niet worden geladen"
        action={
          <button type="button" className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>
            Opnieuw proberen
          </button>
        }
      >
        De server gaf geen antwoord. Controleer je internetverbinding.
      </StateScreen>
    )
  }
  if (!info) return <LoadingShell />
  if (!user) {
    return (
      <>
        <LoadingShell title={info.title || UNTITLED} />
        <ProfileDialog user={null} />
      </>
    )
  }
  return <Session key={info.token} info={info} user={user} onGone={setProblem} />
}

/** Owns the shared document and its connection for as long as the page is open. */
function Session({ info, user, onGone }: { info: DocumentInfo; user: Author; onGone: (problem: Problem) => void }) {
  const [connection, setConnection] = useState<Connection | null>(null)

  useEffect(() => {
    const ydoc = new Y.Doc()
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const provider = new WebsocketProvider(`${protocol}://${location.host}/ws`, info.token, ydoc)
    provider.on('connection-close', (event) => {
      if (event?.code === CLOSE_DELETED) onGone('deleted')
      else if (event?.code === CLOSE_NOT_FOUND) onGone('missing')
    })
    setConnection({ ydoc, provider })
    return () => {
      provider.destroy()
      ydoc.destroy()
    }
  }, [info.token, onGone])

  if (!connection) return <LoadingShell title={info.title || UNTITLED} />
  return <Workspace key={connection.ydoc.clientID} info={info} user={user} connection={connection} />
}

function Workspace({ info, user, connection }: { info: DocumentInfo; user: Author; connection: Connection }) {
  const { ydoc, provider } = connection
  const token = info.token
  const canEdit = info.role === 'edit'
  const meta = useMemo(() => ydoc.getMap<string>('meta'), [ydoc])
  const [toast, showToast] = useToast()

  const [title, setTitle] = useState(info.title)
  const [synced, setSynced] = useState(provider.synced)
  const [online, setOnline] = useState(provider.wsconnected)
  const [everSynced, setEverSynced] = useState(provider.synced)
  const [saving, setSaving] = useState(false)
  const [peers, setPeers] = useState<Author[]>([])
  const [words, setWords] = useState(0)

  const [dialog, setDialog] = useState<'share' | 'profile' | 'delete' | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [versions, setVersions] = useState<Version[] | null>(null)
  const [versionsFailed, setVersionsFailed] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showChanges, setShowChanges] = useState(true)
  const [stats, setStats] = useState<DiffStats | null>(null)
  const [restoring, setRestoring] = useState<Version | null>(null)
  const [deletingVersion, setDeletingVersion] = useState<Version | null>(null)

  const imageHandler = useRef<(file: File) => void>(() => {})
  const unsyncedEdits = useRef(false)

  const editor = useEditor({
    editable: canEdit,
    extensions: [
      ...schemaExtensions(),
      Placeholder.configure({ placeholder: canEdit ? 'Begin met schrijven…' : 'Dit document is nog leeg.' }),
      Collaboration.configure({ document: ydoc }),
      CollaborationCaret.configure({
        provider,
        user,
        render: (peer) => {
          const caret = document.createElement('span')
          caret.className = 'collab-caret'
          caret.style.setProperty('--c', safeColor(peer.color))
          const label = document.createElement('span')
          label.className = 'collab-caret-label'
          label.textContent = String(peer.name ?? '').slice(0, 60)
          caret.append(label)
          return caret
        },
        selectionRender: (peer) => ({ class: 'collab-selection', style: `--c: ${safeColor(peer.color)}` }),
      }),
    ],
    editorProps: {
      attributes: { 'aria-label': 'Documenttekst', lang: 'nl', spellcheck: 'true' },
      handlePaste: (_view, event) => {
        const file = [...(event.clipboardData?.files ?? [])].find((f) => IMAGE_TYPES.includes(f.type))
        if (!file) return false
        imageHandler.current(file)
        return true
      },
      handleDrop: (_view, event) => {
        const file = [...(event.dataTransfer?.files ?? [])].find((f) => IMAGE_TYPES.includes(f.type))
        if (!file) return false
        event.preventDefault()
        imageHandler.current(file)
        return true
      },
    },
  })

  imageHandler.current = async (file: File) => {
    if (!editor || !canEdit) return
    if (!IMAGE_TYPES.includes(file.type)) return showToast('Kies een PNG-, JPEG-, GIF- of WebP-afbeelding.')
    if (file.size > MAX_IMAGE_BYTES) return showToast('De afbeelding is groter dan 5 MB.')
    try {
      const src = await api.uploadImage(token, file)
      editor.chain().focus().setImage({ src, alt: file.name }).run()
    } catch {
      showToast('De afbeelding kon niet worden geüpload.')
    }
  }

  // Others see this name and colour at the caret.
  useEffect(() => {
    editor?.commands.updateUser(user)
  }, [editor, user])

  // Connection, sync and save state.
  useEffect(() => {
    const onStatus = ({ status }: { status: string }) => setOnline(status === 'connected')
    const onSync = (isSynced: boolean) => {
      setSynced(isSynced)
      if (isSynced) {
        setEverSynced(true)
        unsyncedEdits.current = false
        setTitle(meta.get('title') ?? '')
      }
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const onUpdate = (_update: Uint8Array, origin: unknown) => {
      if (origin === provider) return
      if (!provider.wsconnected) unsyncedEdits.current = true
      setSaving(true)
      clearTimeout(timer)
      timer = setTimeout(() => setSaving(false), 1200)
    }
    const onTitle = () => setTitle(meta.get('title') ?? '')
    const onLeave = (event: BeforeUnloadEvent) => {
      if (unsyncedEdits.current) event.preventDefault()
    }

    provider.on('status', onStatus)
    provider.on('sync', onSync)
    ydoc.on('update', onUpdate)
    meta.observe(onTitle)
    window.addEventListener('beforeunload', onLeave)
    return () => {
      clearTimeout(timer)
      provider.off('status', onStatus)
      provider.off('sync', onSync)
      ydoc.off('update', onUpdate)
      meta.unobserve(onTitle)
      window.removeEventListener('beforeunload', onLeave)
    }
  }, [provider, ydoc, meta])

  // Who else has the document open.
  useEffect(() => {
    const read = () => {
      const seen = new Map<string, Author>()
      provider.awareness.getStates().forEach((state, clientId) => {
        const name = state.user?.name
        if (clientId === ydoc.clientID || typeof name !== 'string' || !name) return
        seen.set(`${name}|${state.user.color}`, { name, color: safeColor(state.user.color) })
      })
      setPeers([...seen.values()])
    }
    read()
    provider.awareness.on('change', read)
    return () => provider.awareness.off('change', read)
  }, [provider, ydoc])

  // Word count, a moment after typing stops.
  useEffect(() => {
    if (!editor) return
    let timer: ReturnType<typeof setTimeout>
    const count = () => setWords(editor.getText().split(/\s+/).filter(Boolean).length)
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(count, 250)
    }
    schedule()
    editor.on('update', schedule)
    return () => {
      clearTimeout(timer)
      editor.off('update', schedule)
    }
  }, [editor])

  useEffect(() => {
    document.title = `${title || UNTITLED} · Doc`
    if (everSynced) updateRecentTitle(token, title)
    return () => {
      document.title = 'Doc'
    }
  }, [title, token, everSynced])

  // ── Versions ───────────────────────────────────────────────────────────────

  const loadVersions = useCallback(async () => {
    try {
      setVersions(await api.listVersions(token))
      setVersionsFailed(false)
    } catch {
      setVersionsFailed(true)
    }
  }, [token])

  useEffect(() => {
    if (!historyOpen) return
    void loadVersions()
    const timer = setInterval(loadVersions, 20_000)
    return () => clearInterval(timer)
  }, [historyOpen, loadVersions])

  const selectedIndex = versions?.findIndex((v) => v.id === selectedId) ?? -1
  const selected = selectedIndex >= 0 ? versions![selectedIndex] : null
  const previous = selected ? (versions![selectedIndex + 1] ?? null) : null

  useEffect(() => {
    if (selectedId && versions && selectedIndex < 0) setSelectedId(null)
  }, [selectedId, versions, selectedIndex])

  const closeHistory = () => {
    setHistoryOpen(false)
    setSelectedId(null)
  }

  const saveVersion = async (name: string | null) => {
    try {
      await api.saveVersion(token, name, user)
      await loadVersions()
      showToast(name ? `Versie “${name}” bewaard` : 'Versie bewaard')
    } catch {
      showToast('De versie kon niet worden bewaard.')
    }
  }

  const renameVersion = async (id: string, name: string | null) => {
    try {
      await api.renameVersion(token, id, name)
      await loadVersions()
    } catch {
      showToast('De naam kon niet worden gewijzigd.')
    }
  }

  // ── What the top bar says about saving ─────────────────────────────────────

  let saveState: { key: string; icon: ReactNode; label: string }
  if (!online && everSynced) saveState = { key: 'offline', icon: <CloudOff size={14} />, label: 'Geen verbinding' }
  else if (!synced) saveState = { key: 'connecting', icon: <LoaderCircle size={14} className="spin" />, label: 'Verbinden…' }
  else if (saving) saveState = { key: 'saving', icon: <LoaderCircle size={14} className="spin" />, label: 'Opslaan…' }
  else saveState = { key: 'saved', icon: <Check size={14} />, label: canEdit ? 'Opgeslagen' : 'Actueel' }

  const shownPeers = peers.slice(0, 4)
  const presenceText =
    peers.length === 0
      ? 'Alleen jij hebt dit document open'
      : `${joinNames(peers.slice(0, 3).map((p) => p.name))}${peers.length > 3 ? ` en ${peers.length - 3} anderen` : ''} ${peers.length === 1 ? 'heeft' : 'hebben'} dit document ook open`

  return (
    <div className="shell">
      <header className="topbar">
        <HomeLink />
        <h1 className="sr-only">{title || UNTITLED}</h1>
        <div className="title-wrap">
          <span className="title-sizer" data-value={title || UNTITLED}>
            <input
              className="title-input"
              value={title}
              placeholder={UNTITLED}
              aria-label="Titel van het document"
              maxLength={200}
              readOnly={!canEdit || !synced}
              onChange={(event) => meta.set('title', event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  editor?.commands.focus()
                }
              }}
            />
          </span>
          {!canEdit && (
            <span className="pill">
              <Eye size={12} />
              Alleen lezen
            </span>
          )}
          <span className="save-state hide-narrow" data-state={saveState.key} role="status">
            {saveState.icon}
            {saveState.label}
          </span>
        </div>
        <div className="topbar-spacer" />
        <div className="topbar-actions">
          {shownPeers.length > 0 && (
            <div className="presence" aria-label={presenceText}>
              {shownPeers.map((peer) => (
                <Avatar key={`${peer.name}|${peer.color}`} user={peer} />
              ))}
              {peers.length > shownPeers.length && (
                <span className="avatar presence-more" style={{ '--c': '#131416' } as CSSProperties}>
                  +{peers.length - shownPeers.length}
                </span>
              )}
            </div>
          )}
          <button type="button" className="user-chip" onClick={() => setDialog('profile')} aria-label={`Jij bent ${user.name}. Naam en kleur wijzigen`} title="Je naam en kleur">
            <Avatar user={user} title={`${user.name} (jij)`} />
          </button>
          {canEdit && (
            <button
              type="button"
              className="btn btn-secondary"
              aria-pressed={historyOpen}
              aria-label="Versiegeschiedenis"
              onClick={() => (historyOpen ? closeHistory() : setHistoryOpen(true))}
            >
              <History size={16} />
              <span className="hide-narrow">Versies</span>
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => setDialog('share')}>
            Delen
          </button>
          <Popover
            align="end"
            trigger={(props) => (
              <button type="button" className="icon-btn" aria-label="Meer" {...props}>
                <Ellipsis size={16} />
              </button>
            )}
          >
            {(close) => (
              <>
                <MenuItem
                  icon={<UserRound size={16} />}
                  onSelect={() => {
                    close()
                    setDialog('profile')
                  }}
                >
                  Je naam en kleur
                </MenuItem>
                <div className="menu-sep" />
                <MenuItem
                  icon={<Printer size={16} />}
                  onSelect={() => {
                    close()
                    window.print()
                  }}
                >
                  Afdrukken of opslaan als pdf
                </MenuItem>
                <MenuItem
                  icon={<FileCode size={16} />}
                  onSelect={() => {
                    close()
                    if (editor) exportHtml(title, editor.getHTML())
                  }}
                >
                  Downloaden als html
                </MenuItem>
                <MenuItem
                  icon={<FileDown size={16} />}
                  onSelect={() => {
                    close()
                    if (editor) exportMarkdown(title, editor.getHTML())
                  }}
                >
                  Downloaden als markdown
                </MenuItem>
                {canEdit && (
                  <>
                    <div className="menu-sep" />
                    <MenuItem
                      danger
                      icon={<Trash2 size={16} />}
                      onSelect={() => {
                        close()
                        setDialog('delete')
                      }}
                    >
                      Document verwijderen
                    </MenuItem>
                  </>
                )}
              </>
            )}
          </Popover>
        </div>
      </header>

      <div className="workspace" data-preview={selected !== null}>
        <main className="sheet">
          {selected ? (
            <div className="preview-bar">
              <div className="preview-what">
                <h2>
                  Versie van {formatMoment(selected.createdAt).toLowerCase()}
                  {versionLabel(selected) ? ` · ${versionLabel(selected)}` : ''}
                </h2>
                <p className="num">
                  {!previous ? (
                    'De eerste versie van dit document'
                  ) : !stats ? (
                    'Vergelijken…'
                  ) : stats.wordsAdded === 0 && stats.wordsRemoved === 0 ? (
                    `Geen woorden gewijzigd sinds ${formatMoment(previous.createdAt).toLowerCase()}`
                  ) : (
                    <>
                      <span className="stat-add">+{formatNumber(stats.wordsAdded)}</span> <span className="stat-del">−{formatNumber(stats.wordsRemoved)}</span> woorden sinds de versie van{' '}
                      {formatMoment(previous.createdAt).toLowerCase()}
                    </>
                  )}
                </p>
              </div>
              {previous && (
                <label className="switch">
                  <input type="checkbox" checked={showChanges} onChange={(event) => setShowChanges(event.target.checked)} />
                  <span className="switch-track" />
                  Wijzigingen tonen
                </label>
              )}
              <button type="button" className="btn btn-primary" onClick={() => setRestoring(selected)}>
                <RotateCcw size={16} />
                Herstellen
              </button>
              <button type="button" className="icon-btn" aria-label="Terug naar het huidige document" title="Terug naar het huidige document" onClick={() => setSelectedId(null)}>
                <X size={16} />
              </button>
            </div>
          ) : (
            canEdit && editor && <Toolbar editor={editor} onImage={(file) => imageHandler.current(file)} />
          )}

          {!online && everSynced && !selected && (
            <div className="notice" role="status">
              <CloudOff size={14} />
              {canEdit ? 'Geen verbinding. Je kunt doorschrijven; je wijzigingen worden verstuurd zodra de verbinding terug is.' : 'Geen verbinding. Je ziet de laatst ontvangen stand.'}
            </div>
          )}

          <div className="sheet-scroll" hidden={selected !== null}>
            <div className="page">
              <EditorContent editor={editor} />
            </div>
          </div>
          {selected && (
            <div className="sheet-scroll">
              <div className="page">
                <VersionPreview token={token} version={selected} previous={previous} showChanges={showChanges} onStats={setStats} />
              </div>
            </div>
          )}

          <footer className="sheet-foot">
            <span className="num">{selected ? plural(selected.words, 'woord', 'woorden') : plural(words, 'woord', 'woorden')}</span>
            <span className="hide-narrow">{presenceText}</span>
          </footer>
        </main>

        {historyOpen && (
          <VersionPanel
            versions={versions}
            failed={versionsFailed}
            onRetry={loadVersions}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onSave={saveVersion}
            onRename={renameVersion}
            onDelete={setDeletingVersion}
            onClose={closeHistory}
          />
        )}
      </div>

      {dialog === 'share' && <ShareDialog info={info} onClose={() => setDialog(null)} />}
      {dialog === 'profile' && <ProfileDialog user={user} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && (
        <ConfirmDialog
          danger
          title={`“${title || UNTITLED}” verwijderen?`}
          body="Het document en alle versies verdwijnen voor iedereen die de link heeft. Dit kan niet ongedaan worden gemaakt."
          confirm="Document verwijderen"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api.deleteDocument(token)
            forgetDocument(token)
            navigate('/', { replace: true })
          }}
        />
      )}
      {restoring && (
        <ConfirmDialog
          title={`Versie van ${formatMoment(restoring.createdAt).toLowerCase()} herstellen?`}
          body="Het document krijgt weer de inhoud en titel van deze versie, voor iedereen die het open heeft. De huidige stand blijft als versie bewaard, dus je raakt niets kwijt."
          confirm="Versie herstellen"
          onClose={() => setRestoring(null)}
          onConfirm={async () => {
            await api.restoreVersion(token, restoring.id, user)
            setSelectedId(null)
            await loadVersions()
            showToast('Versie hersteld')
          }}
        />
      )}
      {deletingVersion && (
        <ConfirmDialog
          danger
          title={`Versie van ${formatMoment(deletingVersion.createdAt).toLowerCase()} verwijderen?`}
          body="Alleen deze bewaarde stand verdwijnt uit de geschiedenis. Het document zelf verandert niet."
          confirm="Versie verwijderen"
          onClose={() => setDeletingVersion(null)}
          onConfirm={async () => {
            await api.deleteVersion(token, deletingVersion.id)
            await loadVersions()
          }}
        />
      )}
      {toast}
    </div>
  )
}
