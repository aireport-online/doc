import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { TextAlign } from '@tiptap/extension-text-align'
import { Highlight } from '@tiptap/extension-highlight'
import { Image } from '@tiptap/extension-image'
import type { Extensions } from '@tiptap/core'

/**
 * The document schema, shared by the live editor and the read-only version preview so that
 * a stored version always renders with exactly the nodes and marks it was written with.
 */
export const schemaExtensions = (): Extensions => [
  StarterKit.configure({
    // Undo and redo come from the collaboration history, which only undoes your own changes.
    undoRedo: false,
    heading: { levels: [1, 2, 3] },
    link: {
      openOnClick: false,
      autolink: true,
      defaultProtocol: 'https',
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
    },
  }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Highlight,
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: false } }),
  Image.configure({ allowBase64: false }),
]
