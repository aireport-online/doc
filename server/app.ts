import express, { type Request, type Response, type NextFunction } from 'express'
import { createServer, type Server } from 'node:http'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { WebSocketServer } from 'ws'
import { Store, type DocumentRow, type Role } from './db.js'
import { Collab, defaultCollabOptions, sanitizeAuthor, type CollabOptions } from './collab.js'

export interface AppOptions {
  dbPath: string
  /** Folder with the built web app; served when it exists. */
  staticDir?: string
  collab?: Partial<CollabOptions>
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_WS_PAYLOAD = 16 * 1024 * 1024

const describe = (doc: DocumentRow, role: Role) => ({
  token: role === 'edit' ? doc.id : doc.view_id,
  role,
  title: doc.title,
  viewToken: doc.view_id,
  createdAt: doc.created_at,
  updatedAt: doc.updated_at,
})

const cleanName = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const name = value.trim().slice(0, 120)
  return name || null
}

export function createApp(options: AppOptions) {
  const store = new Store(options.dbPath)
  const collab = new Collab(store, { ...defaultCollabOptions, ...options.collab })
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '100kb' }))

  type Locals = { doc: DocumentRow; role: Role }

  /** Look up the document behind a link token; `edit` additionally requires the edit link. */
  const withDocument = (need: Role) => (req: Request, res: Response, next: NextFunction) => {
    const resolved = store.resolve(String(req.params.token))
    if (!resolved) return void res.status(404).json({ error: 'not_found' })
    if (need === 'edit' && resolved.role !== 'edit') return void res.status(403).json({ error: 'read_only' })
    Object.assign(res.locals, resolved)
    next()
  }

  app.post('/api/documents', (req, res) => {
    const doc = store.createDocument(cleanName(req.body?.title) ?? '')
    res.status(201).json(describe(doc, 'edit'))
  })

  // The home screen keeps its own list of links; this returns what is known about each of them.
  app.post('/api/documents/lookup', (req, res) => {
    const tokens: unknown[] = Array.isArray(req.body?.tokens) ? req.body.tokens.slice(0, 200) : []
    const found = tokens
      .filter((t): t is string => typeof t === 'string')
      .map((token) => store.resolve(token))
      .filter((r) => r !== null)
      .map((r) => describe(r.doc, r.role))
    res.json(found)
  })

  app.get('/api/documents/:token', withDocument('view'), (_req, res) => {
    const { doc, role } = res.locals as Locals
    res.json(describe(doc, role))
  })

  app.delete('/api/documents/:token', withDocument('edit'), (_req, res) => {
    const { doc } = res.locals as Locals
    collab.dropDocument(doc.id)
    store.deleteDocument(doc.id)
    res.status(204).end()
  })

  // ── Versions (edit link only) ──────────────────────────────────────────────

  app.get('/api/documents/:token/versions', withDocument('edit'), (_req, res) => {
    res.json(store.listVersions((res.locals as Locals).doc.id))
  })

  app.post('/api/documents/:token/versions', withDocument('edit'), (req, res) => {
    const version = collab.saveVersion((res.locals as Locals).doc.id, cleanName(req.body?.name), sanitizeAuthor(req.body?.author))
    res.status(201).json(version)
  })

  app.patch('/api/documents/:token/versions/:versionId', withDocument('edit'), (req, res) => {
    const version = store.renameVersion((res.locals as Locals).doc.id, String(req.params.versionId), cleanName(req.body?.name))
    if (!version) return void res.status(404).json({ error: 'not_found' })
    res.json(version)
  })

  app.delete('/api/documents/:token/versions/:versionId', withDocument('edit'), (req, res) => {
    const deleted = store.deleteVersion((res.locals as Locals).doc.id, String(req.params.versionId))
    res.status(deleted ? 204 : 404).end()
  })

  app.get('/api/documents/:token/versions/:versionId/state', withDocument('edit'), (req, res) => {
    const version = store.getVersion((res.locals as Locals).doc.id, String(req.params.versionId))
    if (!version) return void res.status(404).json({ error: 'not_found' })
    res.type('application/octet-stream').set('Cache-Control', 'private, max-age=31536000, immutable').send(Buffer.from(version.state))
  })

  app.post('/api/documents/:token/versions/:versionId/restore', withDocument('edit'), (req, res) => {
    const version = collab.restoreVersion(
      (res.locals as Locals).doc.id,
      String(req.params.versionId),
      sanitizeAuthor(req.body?.author),
    )
    if (!version) return void res.status(404).json({ error: 'not_found' })
    res.status(201).json(version)
  })

  // ── Images ─────────────────────────────────────────────────────────────────

  app.post(
    '/api/documents/:token/images',
    withDocument('edit'),
    express.raw({ type: [...IMAGE_TYPES], limit: MAX_IMAGE_BYTES }),
    (req, res) => {
      const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim()
      if (!IMAGE_TYPES.has(mime) || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        return void res.status(415).json({ error: 'unsupported_image' })
      }
      const id = store.insertImage((res.locals as Locals).doc.id, mime, req.body)
      res.status(201).json({ url: `/api/images/${id}` })
    },
  )

  app.get('/api/images/:id', (req, res) => {
    const image = store.getImage(String(req.params.id))
    if (!image) return void res.status(404).end()
    res
      .type(image.mime)
      .set('Cache-Control', 'public, max-age=31536000, immutable')
      .set('X-Content-Type-Options', 'nosniff')
      .set('Content-Security-Policy', "default-src 'none'")
      .send(image.data)
  })

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found' })
  })

  // ── Web app ────────────────────────────────────────────────────────────────

  if (options.staticDir && existsSync(join(options.staticDir, 'index.html'))) {
    const staticDir = options.staticDir
    app.use('/assets', express.static(join(staticDir, 'assets'), { immutable: true, maxAge: '1y' }))
    app.use(express.static(staticDir, { index: false }))
    app.get(/.*/, (_req, res) => {
      res.set('Cache-Control', 'no-cache').sendFile(join(staticDir, 'index.html'))
    })
  }

  app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === 'entity.too.large') return void res.status(413).json({ error: 'too_large' })
    if (err.status && err.status < 500) return void res.status(err.status).json({ error: 'bad_request' })
    console.error(err)
    res.status(500).json({ error: 'server_error' })
  })

  const server: Server = createServer(app)
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD })

  server.on('upgrade', (req, socket, head) => {
    const match = /^\/ws\/([A-Za-z0-9_-]{1,64})(?:\?.*)?$/.exec(req.url ?? '')
    if (!match) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => collab.handleConnection(ws, match[1]))
  })

  const close = () =>
    new Promise<void>((resolve) => {
      collab.close()
      for (const client of wss.clients) client.terminate()
      wss.close()
      server.close(() => {
        store.close()
        resolve()
      })
      server.closeAllConnections()
    })

  return { app, server, store, collab, close }
}
