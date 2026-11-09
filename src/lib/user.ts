import { useSyncExternalStore } from 'react'
import type { Author } from './api'

/** Identity hues for people, spaced around the wheel so neighbours in a list read apart. */
export const USER_COLORS = ['#1b6c80', '#a8325a', '#8a5a00', '#1e7b4f', '#2a64a8', '#5f6b12']

const KEY = 'doc.user'
const listeners = new Set<() => void>()
let cached: Author | null | undefined

function read(): Author | null {
  if (cached !== undefined) return cached
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Author> | null
    cached = parsed && typeof parsed.name === 'string' && parsed.name.trim() ? { name: parsed.name, color: parsed.color ?? USER_COLORS[0] } : null
  } catch {
    cached = null
  }
  return cached
}

export function saveUser(user: Author) {
  cached = { name: user.name.trim().slice(0, 60), color: user.color }
  try {
    localStorage.setItem(KEY, JSON.stringify(cached))
  } catch {
    // Private windows may refuse storage; the name then lasts for this visit only.
  }
  listeners.forEach((notify) => notify())
}

export const randomColor = () => USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)]

/** The visitor's name and colour as others see them, or null until they chose a name. */
export function useUser(): Author | null {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify)
      return () => listeners.delete(notify)
    },
    read,
    () => null,
  )
}

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?'
