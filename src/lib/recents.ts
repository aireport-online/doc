import type { DocumentInfo, Role } from './api'

/** Without accounts, the browser remembers which document links this person has opened. */
export interface Recent {
  token: string
  role: Role
  viewToken: string
  title: string
  openedAt: number
}

const KEY = 'doc.recents'

export function loadRecents(): Recent[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Recent[]
    return Array.isArray(list) ? list.filter((r) => r && typeof r.token === 'string') : []
  } catch {
    return []
  }
}

function store(list: Recent[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 200)))
  } catch {
    // Storage unavailable: the list simply is not remembered.
  }
}

export function rememberDocument(doc: Pick<DocumentInfo, 'token' | 'role' | 'viewToken' | 'title'>) {
  // One entry per document: an edit link replaces a read-only link to the same document, never the reverse.
  const others = loadRecents().filter((r) => r.viewToken !== doc.viewToken)
  const previous = loadRecents().find((r) => r.viewToken === doc.viewToken)
  const entry: Recent =
    previous?.role === 'edit' && doc.role === 'view'
      ? { ...previous, title: doc.title, openedAt: Date.now() }
      : { token: doc.token, role: doc.role, viewToken: doc.viewToken, title: doc.title, openedAt: Date.now() }
  store([entry, ...others])
}

export function updateRecentTitle(token: string, title: string) {
  const list = loadRecents()
  const entry = list.find((r) => r.token === token)
  if (!entry || entry.title === title) return
  entry.title = title
  store(list)
}

export function forgetDocument(token: string) {
  store(loadRecents().filter((r) => r.token !== token))
}
