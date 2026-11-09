import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import type { WebSocket } from 'ws'
import type { Author, Role, Store, VersionKind, VersionMeta } from './db.js'

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
const MESSAGE_QUERY_AWARENESS = 3
const SYNC_STEP_1 = 0

/** Name of the Yjs XML fragment that holds the document body (Tiptap's default). */
export const CONTENT_FIELD = 'default'
/** Name of the Yjs map that holds document metadata such as the title. */
export const META_FIELD = 'meta'

/** Close codes the client understands. */
export const CLOSE_NOT_FOUND = 4404
export const CLOSE_DELETED = 4410

export interface CollabOptions {
  /** How long after the last change the document is written to disk. */
  persistDebounceMs: number
  /** While people keep editing, an automatic version is saved at most this often. */
  autoVersionIntervalMs: number
  /** How many unnamed automatic versions are kept per document. */
  maxAutoVersions: number
}

export const defaultCollabOptions: CollabOptions = {
  persistDebounceMs: 1500,
  autoVersionIntervalMs: 5 * 60 * 1000,
  maxAutoVersions: 150,
}

interface Conn {
  ws: WebSocket
  role: Role
  /** Awareness client ids this connection announced, so they can be cleared when it drops. */
  clientIds: Set<number>
  alive: boolean
}

interface Room {
  id: string
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  conns: Map<WebSocket, Conn>
  dirty: boolean
  dirtySinceVersion: boolean
  contributors: Map<string, Author>
  persistTimer: NodeJS.Timeout | null
  versionTimer: NodeJS.Timeout | null
}

export function sanitizeAuthor(input: unknown): Author | null {
  if (!input || typeof input !== 'object') return null
  const { name, color } = input as Record<string, unknown>
  if (typeof name !== 'string' || !name.trim()) return null
  return {
    name: name.trim().slice(0, 60),
    color: typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : '#5d5f60',
  }
}

function nodeText(node: Y.XmlFragment | Y.XmlElement | Y.XmlText | Y.XmlHook): string {
  if (node instanceof Y.XmlText) {
    return (node.toDelta() as { insert: unknown }[]).map((op) => (typeof op.insert === 'string' ? op.insert : ' ')).join('')
  }
  if (node instanceof Y.XmlHook) return ''
  return node
    .toArray()
    .map((child) => nodeText(child as Y.XmlElement | Y.XmlText))
    .join('\n')
}

export function countWords(doc: Y.Doc): number {
  const text = nodeText(doc.getXmlFragment(CONTENT_FIELD))
  return text.split(/\s+/).filter(Boolean).length
}

export function docTitle(doc: Y.Doc): string {
  const title = doc.getMap(META_FIELD).get('title')
  return typeof title === 'string' ? title.slice(0, 200) : ''
}

export class Collab {
  private rooms = new Map<string, Room>()
  private heartbeat: NodeJS.Timeout

  constructor(
    private store: Store,
    private options: CollabOptions = defaultCollabOptions,
  ) {
    // Drop connections that stopped answering pings (closed laptops, lost networks).
    this.heartbeat = setInterval(() => {
      for (const room of this.rooms.values()) {
        for (const conn of room.conns.values()) {
          if (!conn.alive) {
            conn.ws.terminate()
            continue
          }
          conn.alive = false
          conn.ws.ping()
        }
      }
    }, 30_000)
    this.heartbeat.unref()
  }

  // ── Rooms ────────────────────────────────────────────────────────────────

  private openRoom(id: string): Room {
    const existing = this.rooms.get(id)
    if (existing) return existing

    const doc = new Y.Doc()
    const state = this.store.loadState(id)
    if (state) Y.applyUpdate(doc, state)

    const awareness = new awarenessProtocol.Awareness(doc)
    awareness.setLocalState(null)

    const latest = this.store.latestVersion(id)
    const resolved = this.store.resolve(id)
    const room: Room = {
      id,
      doc,
      awareness,
      conns: new Map(),
      dirty: false,
      // If the server stopped before a version was cut, the stored document is newer than the last version.
      dirtySinceVersion: state !== null && (!latest || (resolved?.doc.updated_at ?? 0) > latest.createdAt),
      contributors: new Map(),
      persistTimer: null,
      versionTimer: null,
    }

    doc.on('update', (update: Uint8Array, origin: unknown) => {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      syncProtocol.writeUpdate(encoder, update)
      const message = encoding.toUint8Array(encoder)
      for (const conn of room.conns.values()) {
        if (conn !== origin) this.send(conn, message)
      }

      room.dirty = true
      room.dirtySinceVersion = true
      const author = this.authorOf(room, origin)
      if (author) room.contributors.set(author.name, author)
      this.schedulePersist(room)
      this.scheduleAutoVersion(room)
    })

    awareness.on(
      'update',
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        const changed = [...added, ...updated, ...removed]
        const conn = this.connOf(room, origin)
        if (conn) {
          for (const id of added) conn.clientIds.add(id)
          for (const id of removed) conn.clientIds.delete(id)
        }
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
        encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed))
        const message = encoding.toUint8Array(encoder)
        for (const c of room.conns.values()) this.send(c, message)
      },
    )

    this.rooms.set(id, room)
    return room
  }

  private connOf(room: Room, origin: unknown): Conn | null {
    for (const conn of room.conns.values()) if (conn === origin) return conn
    return null
  }

  private authorOf(room: Room, origin: unknown): Author | null {
    const conn = this.connOf(room, origin)
    if (!conn) return null
    for (const clientId of conn.clientIds) {
      const author = sanitizeAuthor(room.awareness.getStates().get(clientId)?.user)
      if (author) return author
    }
    return null
  }

  private send(conn: Conn, message: Uint8Array) {
    if (conn.ws.readyState !== conn.ws.OPEN) return
    conn.ws.send(message, (err) => {
      if (err) conn.ws.terminate()
    })
  }

  private schedulePersist(room: Room) {
    if (room.persistTimer) clearTimeout(room.persistTimer)
    room.persistTimer = setTimeout(() => this.persist(room), this.options.persistDebounceMs)
  }

  private scheduleAutoVersion(room: Room) {
    if (room.versionTimer) return
    room.versionTimer = setTimeout(() => {
      room.versionTimer = null
      if (room.dirtySinceVersion) this.cutVersion(room, 'auto')
    }, this.options.autoVersionIntervalMs)
  }

  private persist(room: Room) {
    if (room.persistTimer) clearTimeout(room.persistTimer)
    room.persistTimer = null
    if (!room.dirty) return
    this.store.saveState(room.id, Y.encodeStateAsUpdate(room.doc), docTitle(room.doc))
    room.dirty = false
  }

  /** Unload a room once nobody is connected any more. A finished editing session becomes a version. */
  private releaseRoom(room: Room, endOfSession: boolean) {
    if (room.conns.size > 0) return
    if (endOfSession && room.dirtySinceVersion) this.cutVersion(room, 'auto')
    this.persist(room)
    if (room.versionTimer) clearTimeout(room.versionTimer)
    room.awareness.destroy()
    room.doc.destroy()
    this.rooms.delete(room.id)
  }

  /** Run `fn` against the live document, loading it for the duration if nobody has it open. */
  private withRoom<T>(id: string, fn: (room: Room) => T): T {
    const room = this.openRoom(id)
    try {
      return fn(room)
    } finally {
      this.releaseRoom(room, false)
    }
  }

  // ── Versions ─────────────────────────────────────────────────────────────

  private cutVersion(
    room: Room,
    kind: VersionKind,
    extra: { name?: string | null; restoredFrom?: number | null; author?: Author | null } = {},
  ): VersionMeta {
    if (extra.author) room.contributors.set(extra.author.name, extra.author)
    // Write the document first so its timestamp never ends up after the version made from it.
    this.persist(room)
    const version = this.store.insertVersion(room.id, {
      kind,
      name: extra.name ?? null,
      title: docTitle(room.doc),
      authors: [...room.contributors.values()],
      words: countWords(room.doc),
      restoredFrom: extra.restoredFrom ?? null,
      state: Y.encodeStateAsUpdate(room.doc),
    })
    room.contributors.clear()
    room.dirtySinceVersion = false
    if (room.versionTimer) {
      clearTimeout(room.versionTimer)
      room.versionTimer = null
    }
    if (kind === 'auto') this.store.pruneAutoVersions(room.id, this.options.maxAutoVersions)
    return version
  }

  /**
   * Save the current state as a named version. When nothing changed since the last version,
   * that version is given the name instead of storing an identical copy.
   */
  saveVersion(documentId: string, name: string | null, author: Author | null): VersionMeta {
    return this.withRoom(documentId, (room) => {
      const latest = this.store.latestVersion(documentId)
      if (!room.dirtySinceVersion && latest) {
        return name ? (this.store.renameVersion(documentId, latest.id, name) ?? latest) : latest
      }
      return this.cutVersion(room, 'manual', { name, author: room.contributors.size === 0 ? author : null })
    })
  }

  /**
   * Bring back the content and title of an earlier version. The current state is kept as a
   * version first, so restoring never loses work, and the restore itself becomes a new version.
   */
  restoreVersion(documentId: string, versionId: string, author: Author | null): VersionMeta | null {
    const source = this.store.getVersion(documentId, versionId)
    if (!source) return null
    return this.withRoom(documentId, (room) => {
      if (room.dirtySinceVersion) this.cutVersion(room, 'auto')

      const snapshot = new Y.Doc()
      Y.applyUpdate(snapshot, source.state)
      room.doc.transact(() => {
        const target = room.doc.getXmlFragment(CONTENT_FIELD)
        target.delete(0, target.length)
        const nodes = snapshot
          .getXmlFragment(CONTENT_FIELD)
          .toArray()
          .map((node) => (node as Y.XmlElement | Y.XmlText).clone())
        target.insert(0, nodes)
        room.doc.getMap(META_FIELD).set('title', source.title)
      }, 'restore')
      snapshot.destroy()

      room.contributors.clear()
      return this.cutVersion(room, 'restore', { restoredFrom: source.createdAt, author })
    })
  }

  // ── Connections ──────────────────────────────────────────────────────────

  handleConnection(ws: WebSocket, token: string) {
    const resolved = this.store.resolve(token)
    if (!resolved) {
      ws.close(CLOSE_NOT_FOUND, 'not found')
      return
    }
    const room = this.openRoom(resolved.doc.id)
    const conn: Conn = { ws, role: resolved.role, clientIds: new Set(), alive: true }
    room.conns.set(ws, conn)

    ws.on('pong', () => {
      conn.alive = true
    })
    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      const bytes = Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? new Uint8Array(data) : data
      try {
        this.handleMessage(room, conn, bytes)
      } catch (err) {
        console.error('[collab] invalid message', err)
        ws.close(1003, 'invalid message')
      }
    })
    ws.on('close', () => {
      if (!room.conns.delete(ws)) return
      awarenessProtocol.removeAwarenessStates(room.awareness, [...conn.clientIds], null)
      this.releaseRoom(room, true)
    })
    ws.on('error', () => ws.terminate())

    // Open the handshake: ask the client for what we are missing and tell it who is here.
    const sync = encoding.createEncoder()
    encoding.writeVarUint(sync, MESSAGE_SYNC)
    syncProtocol.writeSyncStep1(sync, room.doc)
    this.send(conn, encoding.toUint8Array(sync))

    const states = room.awareness.getStates()
    if (states.size > 0) {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]))
      this.send(conn, encoding.toUint8Array(encoder))
    }
  }

  private handleMessage(room: Room, conn: Conn, data: Uint8Array) {
    const decoder = decoding.createDecoder(data)
    const type = decoding.readVarUint(decoder)
    switch (type) {
      case MESSAGE_SYNC: {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_SYNC)
        if (conn.role === 'view') {
          // Readers may ask for the document but their changes are never applied.
          if (decoding.readVarUint(decoder) === SYNC_STEP_1) syncProtocol.readSyncStep1(decoder, encoder, room.doc)
        } else {
          syncProtocol.readSyncMessage(decoder, encoder, room.doc, conn)
        }
        if (encoding.length(encoder) > 1) this.send(conn, encoding.toUint8Array(encoder))
        break
      }
      case MESSAGE_AWARENESS:
        awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), conn)
        break
      case MESSAGE_QUERY_AWARENESS: {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...room.awareness.getStates().keys()]),
        )
        this.send(conn, encoding.toUint8Array(encoder))
        break
      }
    }
  }

  /** Disconnect everyone from a document that is being deleted, without saving it again. */
  dropDocument(documentId: string) {
    const room = this.rooms.get(documentId)
    if (!room) return
    this.rooms.delete(documentId)
    if (room.persistTimer) clearTimeout(room.persistTimer)
    if (room.versionTimer) clearTimeout(room.versionTimer)
    const conns = [...room.conns.values()]
    room.conns.clear()
    for (const conn of conns) conn.ws.close(CLOSE_DELETED, 'deleted')
    room.awareness.destroy()
    room.doc.destroy()
  }

  /** Write everything to disk and disconnect; used on shutdown. */
  close() {
    clearInterval(this.heartbeat)
    for (const room of [...this.rooms.values()]) {
      if (room.dirtySinceVersion) this.cutVersion(room, 'auto')
      this.persist(room)
      if (room.versionTimer) clearTimeout(room.versionTimer)
      const conns = [...room.conns.values()]
      room.conns.clear()
      for (const conn of conns) conn.ws.close(1001, 'server shutting down')
      this.rooms.delete(room.id)
    }
  }
}
