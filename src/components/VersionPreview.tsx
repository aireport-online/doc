import { useEffect, useState } from 'react'
import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import * as Y from 'yjs'
import { yDocToProsemirrorJSON } from '@tiptap/y-tiptap'
import { api, type Version } from '../lib/api'
import { schemaExtensions } from '../lib/extensions'
import { getDiffStats, VersionDiff, type DiffStats } from '../lib/diff'

const EMPTY: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

/** Turn the stored state of a version back into a document the editor can show. */
function toDocument(state: Uint8Array): JSONContent {
  const ydoc = new Y.Doc()
  Y.applyUpdate(ydoc, state)
  const json = yDocToProsemirrorJSON(ydoc, 'default') as JSONContent
  ydoc.destroy()
  return json.content && json.content.length > 0 ? json : EMPTY
}

interface Props {
  token: string
  version: Version
  /** The version saved just before this one; null for the first version. */
  previous: Version | null
  showChanges: boolean
  onStats: (stats: DiffStats | null) => void
}

function Preview({ content, before, showChanges, onStats }: { content: JSONContent; before: JSONContent | null; showChanges: boolean; onStats: Props['onStats'] }) {
  const editor = useEditor(
    {
      editable: false,
      extensions: [...schemaExtensions(), VersionDiff.configure({ before, show: showChanges })],
      content,
      editorProps: { attributes: { 'aria-label': 'Inhoud van deze versie' } },
    },
    [content, before, showChanges],
  )

  useEffect(() => {
    if (editor) onStats(getDiffStats(editor.state))
  }, [editor, onStats])

  return <EditorContent editor={editor} />
}

export function VersionPreview({ token, version, previous, showChanges, onStats }: Props) {
  const [loaded, setLoaded] = useState<{ id: string; content: JSONContent; before: JSONContent | null } | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setFailed(false)
    onStats(null)
    Promise.all([api.versionState(token, version.id), previous ? api.versionState(token, previous.id) : null])
      .then(([state, older]) => {
        if (!cancelled) setLoaded({ id: version.id, content: toDocument(state), before: older ? toDocument(older) : null })
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [token, version.id, previous?.id, attempt, onStats])

  if (failed) {
    return (
      <div className="inline-error" role="alert">
        Deze versie kon niet worden geladen.
        <button type="button" className="btn btn-ghost" onClick={() => setAttempt((n) => n + 1)}>
          Opnieuw
        </button>
      </div>
    )
  }

  if (loaded?.id !== version.id) {
    return (
      <div aria-busy="true" style={{ display: 'grid', gap: 14 }}>
        {[62, 96, 88, 40].map((width) => (
          <span key={width} className="skeleton" style={{ width: `${width}%`, height: 14 }} />
        ))}
      </div>
    )
  }

  return <Preview content={loaded.content} before={loaded.before} showChanges={showChanges} onStats={onStats} />
}
