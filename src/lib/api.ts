export type Role = 'edit' | 'view'

export interface DocumentInfo {
  token: string
  role: Role
  title: string
  viewToken: string
  createdAt: number
  updatedAt: number
}

export interface Author {
  name: string
  color: string
}

export interface Version {
  id: string
  kind: 'auto' | 'manual' | 'restore'
  name: string | null
  title: string
  authors: Author[]
  words: number
  restoredFrom: number | null
  createdAt: number
}

export class ApiError extends Error {
  constructor(public status: number) {
    super(`Request failed with status ${status}`)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status)
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

const versionStates = new Map<string, Promise<Uint8Array>>()

export const api = {
  createDocument: (title = '') => request<DocumentInfo>('POST', '/documents', { title }),
  getDocument: (token: string) => request<DocumentInfo>('GET', `/documents/${token}`),
  lookup: (tokens: string[]) => request<DocumentInfo[]>('POST', '/documents/lookup', { tokens }),
  deleteDocument: (token: string) => request<void>('DELETE', `/documents/${token}`),

  listVersions: (token: string) => request<Version[]>('GET', `/documents/${token}/versions`),
  saveVersion: (token: string, name: string | null, author: Author) =>
    request<Version>('POST', `/documents/${token}/versions`, { name, author }),
  renameVersion: (token: string, id: string, name: string | null) =>
    request<Version>('PATCH', `/documents/${token}/versions/${id}`, { name }),
  deleteVersion: (token: string, id: string) => request<void>('DELETE', `/documents/${token}/versions/${id}`),
  restoreVersion: (token: string, id: string, author: Author) =>
    request<Version>('POST', `/documents/${token}/versions/${id}/restore`, { author }),

  /** The stored Yjs state of a version. Versions never change, so the bytes are cached for the session. */
  versionState(token: string, id: string): Promise<Uint8Array> {
    const key = `${token}/${id}`
    let pending = versionStates.get(key)
    if (!pending) {
      pending = fetch(`/api/documents/${token}/versions/${id}/state`).then(async (res) => {
        if (!res.ok) throw new ApiError(res.status)
        return new Uint8Array(await res.arrayBuffer())
      })
      pending.catch(() => versionStates.delete(key))
      versionStates.set(key, pending)
    }
    return pending
  },

  async uploadImage(token: string, file: File): Promise<string> {
    const res = await fetch(`/api/documents/${token}/images`, {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file,
    })
    if (!res.ok) throw new ApiError(res.status)
    return ((await res.json()) as { url: string }).url
  },
}
