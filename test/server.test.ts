import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { createApp } from '../server/app.ts'
import { CLOSE_DELETED } from '../server/collab.ts'

const dir = mkdtempSync(join(tmpdir(), 'doc-test-'))
const dbPath = join(dir, 'test.sqlite')

let instance: ReturnType<typeof createApp>
let base: string
let wsBase: string

async function start() {
  instance = createApp({ dbPath, collab: { persistDebounceMs: 20, autoVersionIntervalMs: 60_000 } })
  await new Promise<void>((resolve) => instance.server.listen(0, '127.0.0.1', resolve))
  const { port } = instance.server.address() as AddressInfo
  base = `http://127.0.0.1:${port}`
  wsBase = `ws://127.0.0.1:${port}/ws`
}

before(start)
after(async () => {
  await instance.close()
  rmSync(dir, { recursive: true, force: true })
})

const api = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(check: () => boolean | Promise<boolean>, label: string, timeout = 3000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await sleep(15)
  }
  assert.fail(`timed out waiting for: ${label}`)
}

interface Client {
  doc: Y.Doc
  provider: WebsocketProvider
  text: () => string
  write: (text: string) => void
  close: () => Promise<void>
}

async function connect(token: string, user = { name: 'Test', color: '#1b6c80' }): Promise<Client> {
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(wsBase, token, doc, {
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    disableBc: true,
  })
  provider.awareness.setLocalStateField('user', user)
  await until(() => provider.synced, `sync of ${token}`)
  const fragment = doc.getXmlFragment('default')
  return {
    doc,
    provider,
    text: () =>
      fragment
        .toArray()
        .map((node) => (node as Y.XmlElement).toArray().map((t) => (t as Y.XmlText).toString()).join(''))
        .join('\n'),
    write: (text) => {
      const paragraph = new Y.XmlElement('paragraph')
      paragraph.insert(0, [new Y.XmlText(text)])
      fragment.insert(fragment.length, [paragraph])
    },
    close: async () => {
      provider.destroy()
      doc.destroy()
      await sleep(60)
    },
  }
}

test('creates a document with separate edit and read-only links', async () => {
  const created = await api('POST', '/api/documents', { title: 'Jaarplan' })
  assert.equal(created.status, 201)
  assert.equal(created.body.role, 'edit')
  assert.notEqual(created.body.token, created.body.viewToken)

  const viaEdit = await api('GET', `/api/documents/${created.body.token}`)
  assert.equal(viaEdit.body.role, 'edit')
  assert.equal(viaEdit.body.title, 'Jaarplan')

  const viaView = await api('GET', `/api/documents/${created.body.viewToken}`)
  assert.equal(viaView.body.role, 'view')
  assert.equal(viaView.body.token, created.body.viewToken, 'the read-only link never reveals the edit link')
  assert.ok(!JSON.stringify(viaView.body).includes(created.body.token))

  assert.equal((await api('GET', '/api/documents/does-not-exist')).status, 404)

  const lookup = await api('POST', '/api/documents/lookup', { tokens: [created.body.token, 'nope', created.body.viewToken] })
  assert.deepEqual(
    lookup.body.map((d: { role: string }) => d.role),
    ['edit', 'view'],
  )
})

test('syncs edits between collaborators in real time and stores them', async () => {
  const { body: doc } = await api('POST', '/api/documents', {})
  const anna = await connect(doc.token, { name: 'Anna', color: '#1b6c80' })
  const bram = await connect(doc.token, { name: 'Bram', color: '#a86f0c' })

  anna.write('Hallo van Anna')
  await until(() => bram.text() === 'Hallo van Anna', 'Bram sees Anna')
  bram.write('Hallo van Bram')
  bram.doc.getMap('meta').set('title', 'Notulen')
  await until(() => anna.text() === 'Hallo van Anna\nHallo van Bram', 'Anna sees Bram')

  // Presence: each sees the other's name.
  await until(
    () => [...anna.provider.awareness.getStates().values()].some((s) => s.user?.name === 'Bram'),
    'Anna sees Bram in the presence list',
  )

  await until(async () => (await api('GET', `/api/documents/${doc.token}`)).body.title === 'Notulen', 'title stored')

  await anna.close()
  await bram.close()

  const later = await connect(doc.token)
  assert.equal(later.text(), 'Hallo van Anna\nHallo van Bram')
  await later.close()
})

test('read-only link receives changes but cannot make them', async () => {
  const { body: doc } = await api('POST', '/api/documents', {})
  const editor = await connect(doc.token)
  const reader = await connect(doc.viewToken, { name: 'Lezer', color: '#2f70bb' })

  editor.write('Alleen de redacteur schrijft')
  await until(() => reader.text() === 'Alleen de redacteur schrijft', 'reader receives edits')

  reader.write('Dit mag niet')
  await sleep(150)
  assert.equal(editor.text(), 'Alleen de redacteur schrijft')

  assert.equal((await api('GET', `/api/documents/${doc.viewToken}/versions`)).status, 403)
  assert.equal((await api('DELETE', `/api/documents/${doc.viewToken}`)).status, 403)

  await editor.close()
  await reader.close()

  const fresh = await connect(doc.token)
  assert.equal(fresh.text(), 'Alleen de redacteur schrijft')
  await fresh.close()
})

test('saves, names, restores and deletes versions', async () => {
  const { body: doc } = await api('POST', '/api/documents', {})
  const versions = `/api/documents/${doc.token}/versions`
  const anna = await connect(doc.token, { name: 'Anna', color: '#1b6c80' })

  anna.doc.getMap('meta').set('title', 'Eerste titel')
  anna.write('Eerste alinea met vijf woorden')
  await sleep(80)
  const first = await api('POST', versions, { name: 'Eerste opzet', author: { name: 'Anna', color: '#1b6c80' } })
  assert.equal(first.status, 201)
  assert.equal(first.body.kind, 'manual')
  assert.equal(first.body.name, 'Eerste opzet')
  assert.equal(first.body.words, 5)
  assert.deepEqual(first.body.authors, [{ name: 'Anna', color: '#1b6c80' }])

  // Naming again without changes labels the existing version instead of duplicating it.
  const renamedHead = await api('POST', versions, { name: 'Opzet' })
  assert.equal(renamedHead.body.id, first.body.id)
  assert.equal(renamedHead.body.name, 'Opzet')

  anna.doc.getMap('meta').set('title', 'Tweede titel')
  anna.write('Tweede alinea')
  await sleep(80)

  const restored = await api('POST', `${versions}/${first.body.id}/restore`, { author: { name: 'Anna', color: '#1b6c80' } })
  assert.equal(restored.status, 201)
  assert.equal(restored.body.kind, 'restore')
  assert.equal(restored.body.restoredFrom, first.body.createdAt)
  await until(() => anna.text() === 'Eerste alinea met vijf woorden', 'restored content reaches the open editor')
  assert.equal(anna.doc.getMap('meta').get('title'), 'Eerste titel')

  // Restoring keeps the state from just before as its own version.
  const list = (await api('GET', versions)).body as { id: string; kind: string; words: number; name: string | null }[]
  assert.deepEqual(
    list.map((v) => v.kind),
    ['restore', 'auto', 'manual'],
  )
  assert.equal(list[1].words, 7)

  const state = await fetch(`${base}${versions}/${list[1].id}/state`)
  const snapshot = new Y.Doc()
  Y.applyUpdate(snapshot, new Uint8Array(await state.arrayBuffer()))
  assert.equal(snapshot.getXmlFragment('default').length, 2)
  assert.equal(snapshot.getMap('meta').get('title'), 'Tweede titel')

  const renamed = await api('PATCH', `${versions}/${list[1].id}`, { name: 'Vóór herstel' })
  assert.equal(renamed.body.name, 'Vóór herstel')
  assert.equal((await api('DELETE', `${versions}/${list[1].id}`)).status, 204)
  assert.equal((await api('GET', versions)).body.length, 2)
  assert.equal((await api('POST', `${versions}/missing/restore`, {})).status, 404)

  await anna.close()
})

test('an editing session ends with an automatic version, and nothing is duplicated', async () => {
  const { body: doc } = await api('POST', '/api/documents', {})
  const versions = `/api/documents/${doc.token}/versions`

  const anna = await connect(doc.token, { name: 'Anna', color: '#1b6c80' })
  anna.write('Sessie één')
  await sleep(80)
  await anna.close()
  await until(async () => (await api('GET', versions)).body.length === 1, 'auto version after session')
  const [auto] = (await api('GET', versions)).body
  assert.equal(auto.kind, 'auto')
  assert.deepEqual(auto.authors, [{ name: 'Anna', color: '#1b6c80' }])

  // Opening and closing without changes must not add a version.
  const visitor = await connect(doc.token)
  await visitor.close()
  await sleep(80)
  assert.equal((await api('GET', versions)).body.length, 1)

  // Restoring while nobody has the document open works on the stored copy.
  const bram = await connect(doc.token, { name: 'Bram', color: '#a86f0c' })
  bram.write('Sessie twee')
  await sleep(80)
  await bram.close()
  await until(async () => (await api('GET', versions)).body.length === 2, 'second auto version')
  await api('POST', `${versions}/${auto.id}/restore`, {})
  const check = await connect(doc.token)
  assert.equal(check.text(), 'Sessie één')
  await check.close()
})

test('documents and versions survive a restart', async () => {
  const { body: doc } = await api('POST', '/api/documents', {})
  const anna = await connect(doc.token)
  anna.doc.getMap('meta').set('title', 'Blijft bewaard')
  anna.write('Dit staat er na een herstart nog')
  await sleep(60)
  await anna.close()

  await instance.close()
  await start()

  assert.equal((await api('GET', `/api/documents/${doc.token}`)).body.title, 'Blijft bewaard')
  assert.equal((await api('GET', `/api/documents/${doc.token}/versions`)).body.length, 1)
  const again = await connect(doc.token)
  assert.equal(again.text(), 'Dit staat er na een herstart nog')
  await again.close()
  assert.equal((await api('GET', `/api/documents/${doc.token}/versions`)).body.length, 1)
})

test('deleting a document disconnects everyone and removes it', async () => {
  const { body: doc } = await api('POST', '/api/documents', {})
  const anna = await connect(doc.token)
  anna.write('Weg ermee')
  let closeCode = 0
  anna.provider.on('connection-close', (event) => {
    closeCode = event?.code ?? 0
  })

  assert.equal((await api('DELETE', `/api/documents/${doc.token}`)).status, 204)
  await until(() => closeCode === CLOSE_DELETED, 'client is told the document is gone')
  assert.equal((await api('GET', `/api/documents/${doc.token}`)).status, 404)
  assert.equal((await api('GET', `/api/documents/${doc.viewToken}`)).status, 404)
  await anna.close()
})

test('stores uploaded images and rejects other files', async () => {
  const { body: doc } = await api('POST', '/api/documents', {})
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

  const upload = await fetch(`${base}/api/documents/${doc.token}/images`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png })
  assert.equal(upload.status, 201)
  const { url } = (await upload.json()) as { url: string }
  const image = await fetch(base + url)
  assert.equal(image.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png)

  const svg = await fetch(`${base}/api/documents/${doc.token}/images`, { method: 'POST', headers: { 'Content-Type': 'image/svg+xml' }, body: '<svg/>' })
  assert.equal(svg.status, 415)
  const viaView = await fetch(`${base}/api/documents/${doc.viewToken}/images`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png })
  assert.equal(viaView.status, 403)
})
