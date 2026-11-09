import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { nanoid } from 'nanoid'

export type Role = 'edit' | 'view'
export type VersionKind = 'auto' | 'manual' | 'restore'

export interface Author {
  name: string
  color: string
}

export interface DocumentRow {
  id: string
  view_id: string
  title: string
  created_at: number
  updated_at: number
}

export interface VersionMeta {
  id: string
  kind: VersionKind
  name: string | null
  title: string
  authors: Author[]
  words: number
  restoredFrom: number | null
  createdAt: number
}

interface VersionRow {
  id: string
  kind: VersionKind
  name: string | null
  title: string
  authors: string
  words: number
  restored_from: number | null
  created_at: number
}

const toMeta = (row: VersionRow): VersionMeta => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  title: row.title,
  authors: JSON.parse(row.authors) as Author[],
  words: row.words,
  restoredFrom: row.restored_from,
  createdAt: row.created_at,
})

const VERSION_COLUMNS = 'id, kind, name, title, authors, words, restored_from, created_at'

export class Store {
  private db: Database.Database

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        view_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL DEFAULT '',
        state BLOB,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS versions (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        name TEXT,
        title TEXT NOT NULL DEFAULT '',
        authors TEXT NOT NULL DEFAULT '[]',
        words INTEGER NOT NULL DEFAULT 0,
        restored_from INTEGER,
        state BLOB NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS versions_by_document ON versions(document_id, created_at);
      CREATE TABLE IF NOT EXISTS images (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        mime TEXT NOT NULL,
        data BLOB NOT NULL,
        created_at INTEGER NOT NULL
      );
    `)
  }

  close() {
    this.db.close()
  }

  // ── Documents ────────────────────────────────────────────────────────────

  createDocument(title = '', state: Uint8Array | null = null): DocumentRow {
    const now = Date.now()
    const row: DocumentRow = { id: nanoid(), view_id: nanoid(), title, created_at: now, updated_at: now }
    this.db
      .prepare('INSERT INTO documents (id, view_id, title, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(row.id, row.view_id, title, state ? Buffer.from(state) : null, now, now)
    return row
  }

  /** Resolve a link token to a document. The edit token is the document id; the view token only grants reading. */
  resolve(token: string): { doc: DocumentRow; role: Role } | null {
    const row = this.db
      .prepare('SELECT id, view_id, title, created_at, updated_at FROM documents WHERE id = ? OR view_id = ?')
      .get(token, token) as DocumentRow | undefined
    if (!row) return null
    return { doc: row, role: row.id === token ? 'edit' : 'view' }
  }

  loadState(id: string): Uint8Array | null {
    const row = this.db.prepare('SELECT state FROM documents WHERE id = ?').get(id) as { state: Buffer | null } | undefined
    return row?.state ? new Uint8Array(row.state) : null
  }

  saveState(id: string, state: Uint8Array, title: string) {
    this.db
      .prepare('UPDATE documents SET state = ?, title = ?, updated_at = ? WHERE id = ?')
      .run(Buffer.from(state), title, Date.now(), id)
  }

  deleteDocument(id: string) {
    this.db.prepare('DELETE FROM documents WHERE id = ?').run(id)
  }

  // ── Versions ─────────────────────────────────────────────────────────────

  listVersions(documentId: string): VersionMeta[] {
    const rows = this.db
      .prepare(`SELECT ${VERSION_COLUMNS} FROM versions WHERE document_id = ? ORDER BY created_at DESC, rowid DESC`)
      .all(documentId) as VersionRow[]
    return rows.map(toMeta)
  }

  latestVersion(documentId: string): VersionMeta | null {
    const row = this.db
      .prepare(`SELECT ${VERSION_COLUMNS} FROM versions WHERE document_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`)
      .get(documentId) as VersionRow | undefined
    return row ? toMeta(row) : null
  }

  getVersion(documentId: string, versionId: string): (VersionMeta & { state: Uint8Array }) | null {
    const row = this.db
      .prepare(`SELECT ${VERSION_COLUMNS}, state FROM versions WHERE document_id = ? AND id = ?`)
      .get(documentId, versionId) as (VersionRow & { state: Buffer }) | undefined
    return row ? { ...toMeta(row), state: new Uint8Array(row.state) } : null
  }

  insertVersion(
    documentId: string,
    v: { kind: VersionKind; name: string | null; title: string; authors: Author[]; words: number; restoredFrom: number | null; state: Uint8Array },
  ): VersionMeta {
    const id = nanoid(12)
    // Keep timestamps strictly increasing per document so ordering stays stable.
    const latest = this.latestVersion(documentId)
    const createdAt = Math.max(Date.now(), (latest?.createdAt ?? 0) + 1)
    this.db
      .prepare(
        'INSERT INTO versions (id, document_id, kind, name, title, authors, words, restored_from, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, documentId, v.kind, v.name, v.title, JSON.stringify(v.authors), v.words, v.restoredFrom, Buffer.from(v.state), createdAt)
    return { id, kind: v.kind, name: v.name, title: v.title, authors: v.authors, words: v.words, restoredFrom: v.restoredFrom, createdAt }
  }

  renameVersion(documentId: string, versionId: string, name: string | null): VersionMeta | null {
    this.db.prepare('UPDATE versions SET name = ? WHERE document_id = ? AND id = ?').run(name, documentId, versionId)
    const row = this.db
      .prepare(`SELECT ${VERSION_COLUMNS} FROM versions WHERE document_id = ? AND id = ?`)
      .get(documentId, versionId) as VersionRow | undefined
    return row ? toMeta(row) : null
  }

  deleteVersion(documentId: string, versionId: string): boolean {
    return this.db.prepare('DELETE FROM versions WHERE document_id = ? AND id = ?').run(documentId, versionId).changes > 0
  }

  /** Drop the oldest unnamed automatic versions beyond `keep`. Named and restore versions are never pruned. */
  pruneAutoVersions(documentId: string, keep: number) {
    this.db
      .prepare(
        `DELETE FROM versions WHERE document_id = ? AND kind = 'auto' AND name IS NULL AND id NOT IN (
           SELECT id FROM versions WHERE document_id = ? AND kind = 'auto' AND name IS NULL
           ORDER BY created_at DESC, rowid DESC LIMIT ?
         )`,
      )
      .run(documentId, documentId, keep)
  }

  // ── Images ───────────────────────────────────────────────────────────────

  insertImage(documentId: string, mime: string, data: Uint8Array): string {
    const id = nanoid()
    this.db
      .prepare('INSERT INTO images (id, document_id, mime, data, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, documentId, mime, Buffer.from(data), Date.now())
    return id
  }

  getImage(id: string): { mime: string; data: Buffer } | null {
    return (this.db.prepare('SELECT mime, data FROM images WHERE id = ?').get(id) as { mime: string; data: Buffer } | undefined) ?? null
  }
}
