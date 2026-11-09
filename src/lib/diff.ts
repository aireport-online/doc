import { diffArrays } from 'diff'
import { Extension } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

interface Token {
  /** What two tokens must share to count as the same content. */
  key: string
  /** Formatting of the token: marks for text, type and attributes for blocks. */
  format: string
  from: number
  to: number
  kind: 'word' | 'space' | 'block' | 'leaf'
  text: string
}

export interface DiffStats {
  wordsAdded: number
  wordsRemoved: number
}

const LEAF_LABELS: Record<string, string> = { image: 'afbeelding', horizontalRule: 'scheidingslijn', hardBreak: '↵' }

/**
 * Flatten a document into comparable tokens: words, whitespace and punctuation inside text,
 * one token per block start, and one per leaf such as an image.
 */
function tokenize(doc: PMNode): Token[] {
  const tokens: Token[] = []
  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      const format = node.marks
        .map((mark) => mark.type.name + JSON.stringify(mark.attrs))
        .sort()
        .join('|')
      for (const match of node.text.matchAll(/\s+|[\p{L}\p{N}_'’-]+|[^\s\p{L}\p{N}_'’-]/gu)) {
        const from = pos + match.index
        const isSpace = /^\s/.test(match[0])
        tokens.push({ key: `t:${match[0]}`, format, from, to: from + match[0].length, kind: isSpace ? 'space' : 'word', text: match[0] })
      }
    } else if (node.isLeaf) {
      const label = LEAF_LABELS[node.type.name] ?? node.type.name
      tokens.push({ key: `l:${node.type.name}:${JSON.stringify(node.attrs)}`, format: '', from: pos, to: pos + node.nodeSize, kind: 'leaf', text: `[${label}]` })
    } else if (node.isTextblock) {
      tokens.push({ key: 'b', format: node.type.name + JSON.stringify(node.attrs), from: pos, to: pos + 1, kind: 'block', text: '' })
    }
    return true
  })
  return tokens
}

function deletionWidget(tokens: Token[]): HTMLElement {
  const el = document.createElement('span')
  el.className = 'diff-del'
  el.setAttribute('aria-label', 'Verwijderd')
  // A removed paragraph break is shown as a pilcrow so merged paragraphs stay readable.
  el.textContent = tokens.map((t, i) => (t.kind === 'block' ? (i === 0 ? '' : ' ¶ ') : t.text)).join('')
  if (tokens[0]?.kind === 'block') el.classList.add('diff-del-block')
  return el
}

/** Compare two documents and mark the changes on the newer one. */
export function diffDocuments(before: PMNode, after: PMNode): { decorations: DecorationSet; stats: DiffStats } {
  const oldTokens = tokenize(before)
  const newTokens = tokenize(after)
  const changes = diffArrays(
    oldTokens.map((t) => t.key),
    newTokens.map((t) => t.key),
  )

  const decorations: Decoration[] = []
  const stats: DiffStats = { wordsAdded: 0, wordsRemoved: 0 }
  let i = 0 // index in oldTokens
  let j = 0 // index in newTokens
  let cursor = 0 // position in the new document where removed content is shown

  for (const change of changes) {
    const count = change.value.length
    if (change.removed) {
      const removed = oldTokens.slice(i, i + count)
      i += count
      stats.wordsRemoved += removed.filter((t) => t.kind === 'word').length
      if (removed.some((t) => t.kind !== 'block' && t.text.trim() !== '') || removed.some((t) => t.kind === 'block')) {
        decorations.push(Decoration.widget(cursor, () => deletionWidget(removed), { side: -1, key: `del-${i}-${cursor}` }))
      }
    } else if (change.added) {
      for (const token of newTokens.slice(j, j + count)) {
        if (token.kind === 'word') stats.wordsAdded += 1
        if (token.kind === 'leaf') decorations.push(Decoration.node(token.from, token.to, { class: 'diff-ins-node' }))
        else if (token.kind !== 'block') decorations.push(Decoration.inline(token.from, token.to, { class: 'diff-ins' }))
        cursor = token.to
      }
      j += count
    } else {
      for (let k = 0; k < count; k++) {
        const oldToken = oldTokens[i + k]
        const newToken = newTokens[j + k]
        if (oldToken.format !== newToken.format) {
          if (newToken.kind === 'block') {
            const node = after.nodeAt(newToken.from)
            if (node) decorations.push(Decoration.node(newToken.from, newToken.from + node.nodeSize, { class: 'diff-format-block', title: 'Opmaak gewijzigd' }))
          } else if (newToken.kind !== 'space') {
            decorations.push(Decoration.inline(newToken.from, newToken.to, { class: 'diff-format', title: 'Opmaak gewijzigd' }))
          }
        }
        cursor = newToken.to
      }
      i += count
      j += count
    }
  }

  return { decorations: DecorationSet.create(after, decorations), stats }
}

const diffKey = new PluginKey<{ decorations: DecorationSet; stats: DiffStats }>('versionDiff')

export interface VersionDiffOptions {
  /** The older document to compare against. */
  before: JSONContent | null
  /** Whether the changes are marked in the text; the counts are computed either way. */
  show: boolean
}

export const getDiffStats = (state: EditorState): DiffStats | null => diffKey.getState(state)?.stats ?? null

/** Marks what a version added, removed and reformatted compared with the one before it. */
export const VersionDiff = Extension.create<VersionDiffOptions>({
  name: 'versionDiff',
  addOptions: () => ({ before: null, show: true }),
  addProseMirrorPlugins() {
    const { before, show } = this.options
    return [
      new Plugin({
        key: diffKey,
        state: {
          init(_config, state) {
            if (!before) return { decorations: DecorationSet.empty, stats: { wordsAdded: 0, wordsRemoved: 0 } }
            return diffDocuments(state.schema.nodeFromJSON(before), state.doc)
          },
          apply: (_tr, value) => value,
        },
        props: {
          decorations: (state) => (show ? diffKey.getState(state)?.decorations : undefined),
        },
      }),
    ]
  },
})
