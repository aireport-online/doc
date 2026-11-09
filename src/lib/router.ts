import { useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()
const notify = () => listeners.forEach((fn) => fn())
window.addEventListener('popstate', notify)

export function navigate(path: string, options: { replace?: boolean } = {}) {
  if (options.replace) history.replaceState(null, '', path)
  else history.pushState(null, '', path)
  notify()
}

export function usePath(): string {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => location.pathname,
  )
}

export const documentPath = (token: string) => `/d/${token}`
export const documentUrl = (token: string) => `${location.origin}${documentPath(token)}`

/** Accepts a full share link or a bare token and returns the token. */
export function tokenFromLink(input: string): string | null {
  const value = input.trim()
  const match = /\/d\/([A-Za-z0-9_-]{8,64})/.exec(value) ?? /^([A-Za-z0-9_-]{8,64})$/.exec(value)
  return match ? match[1] : null
}
