import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST ?? '0.0.0.0'
const dbPath = process.env.DATABASE_PATH ?? join(root, 'data', 'doc.sqlite')

const minutes = Number(process.env.AUTO_VERSION_MINUTES ?? 5)
const { server, close } = createApp({
  dbPath,
  staticDir: join(root, 'dist'),
  collab: { autoVersionIntervalMs: Math.max(0.1, minutes) * 60_000 },
})

server.listen(port, host, () => {
  console.log(`Doc luistert op http://${host === '0.0.0.0' ? 'localhost' : host}:${port} (database: ${dbPath})`)
})

let stopping = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return
    stopping = true
    // Flush open documents to disk before exiting.
    void close().then(() => process.exit(0))
  })
}
