import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import {
  Bold,
  Code,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Redo2,
  RemoveFormatting,
  SquareCode,
  Strikethrough,
  Table,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  TextAlignStart,
  TextQuote,
  Underline,
  Undo2,
  Unlink,
} from 'lucide-react'
import { MenuItem, Popover } from './ui'

const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

function Tool({ label, shortcut, active, disabled, onClick, children }: { label: string; shortcut?: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      // Keep the selection in the document while clicking a tool.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function LinkForm({ editor, close }: { editor: Editor; close: () => void }) {
  const current = (editor.getAttributes('link').href as string | undefined) ?? ''
  const [url, setUrl] = useState(current)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const typed = url.trim()
    const href = /^[a-z][a-z0-9+.-]*:/i.test(typed) ? typed : `https://${typed}`
    if (!typed) editor.chain().focus().extendMarkRange('link').unsetLink().run()
    else if (editor.state.selection.empty && !editor.isActive('link')) {
      // Nothing selected: put the address itself in the text as a link.
      editor
        .chain()
        .focus()
        .insertContent({ type: 'text', text: typed, marks: [{ type: 'link', attrs: { href } }] })
        .run()
    } else editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    close()
  }
  return (
    <form className="popover-form" onSubmit={submit}>
      <input className="input input-sm" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label="Adres van de link" inputMode="url" />
      <button type="submit" className="btn btn-primary">
        Toepassen
      </button>
      {current && (
        <button
          type="button"
          className="icon-btn"
          aria-label="Link verwijderen"
          title="Link verwijderen"
          onClick={() => {
            editor.chain().focus().extendMarkRange('link').unsetLink().run()
            close()
          }}
        >
          <Unlink size={16} />
        </button>
      )}
    </form>
  )
}

export function Toolbar({ editor, onImage }: { editor: Editor; onImage: (file: File) => void }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: e.isActive('heading', { level: 1 }) ? 'h1' : e.isActive('heading', { level: 2 }) ? 'h2' : e.isActive('heading', { level: 3 }) ? 'h3' : 'p',
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      highlight: e.isActive('highlight'),
      link: e.isActive('link'),
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      taskList: e.isActive('taskList'),
      blockquote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      table: e.isActive('table'),
      align: (['center', 'right', 'justify'] as const).find((a) => e.isActive({ textAlign: a })) ?? 'left',
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  })

  const chain = () => editor.chain().focus()
  const setBlock = (value: string) => {
    if (value === 'p') chain().setParagraph().run()
    else chain().setHeading({ level: Number(value[1]) as 1 | 2 | 3 }).run()
  }

  return (
    <div className="toolbar" role="toolbar" aria-label="Opmaak">
      <Tool label="Ongedaan maken" shortcut={`${mod}Z`} disabled={!state.canUndo} onClick={() => chain().undo().run()}>
        <Undo2 size={16} />
      </Tool>
      <Tool label="Opnieuw" shortcut={`${mod}Shift+Z`} disabled={!state.canRedo} onClick={() => chain().redo().run()}>
        <Redo2 size={16} />
      </Tool>
      <span className="toolbar-sep" />
      <select className="select" aria-label="Tekststijl" value={state.block} onChange={(e) => setBlock(e.target.value)}>
        <option value="p">Tekst</option>
        <option value="h1">Kop 1</option>
        <option value="h2">Kop 2</option>
        <option value="h3">Kop 3</option>
      </select>
      <span className="toolbar-sep" />
      <Tool label="Vet" shortcut={`${mod}B`} active={state.bold} onClick={() => chain().toggleBold().run()}>
        <Bold size={16} />
      </Tool>
      <Tool label="Cursief" shortcut={`${mod}I`} active={state.italic} onClick={() => chain().toggleItalic().run()}>
        <Italic size={16} />
      </Tool>
      <Tool label="Onderstrepen" shortcut={`${mod}U`} active={state.underline} onClick={() => chain().toggleUnderline().run()}>
        <Underline size={16} />
      </Tool>
      <Tool label="Doorhalen" active={state.strike} onClick={() => chain().toggleStrike().run()}>
        <Strikethrough size={16} />
      </Tool>
      <Tool label="Markeren" active={state.highlight} onClick={() => chain().toggleHighlight().run()}>
        <Highlighter size={16} />
      </Tool>
      <Tool label="Code" active={state.code} onClick={() => chain().toggleCode().run()}>
        <Code size={16} />
      </Tool>
      <Popover
        role="dialog"
        trigger={(props) => (
          <button type="button" className="icon-btn" aria-label="Link" title="Link" aria-pressed={state.link} onMouseDown={(e) => e.preventDefault()} {...props}>
            <Link2 size={16} />
          </button>
        )}
      >
        {(close) => <LinkForm editor={editor} close={close} />}
      </Popover>
      <Tool label="Opmaak wissen" onClick={() => chain().unsetAllMarks().clearNodes().run()}>
        <RemoveFormatting size={16} />
      </Tool>
      <span className="toolbar-sep" />
      <Tool label="Opsomming" active={state.bulletList} onClick={() => chain().toggleBulletList().run()}>
        <List size={16} />
      </Tool>
      <Tool label="Genummerde lijst" active={state.orderedList} onClick={() => chain().toggleOrderedList().run()}>
        <ListOrdered size={16} />
      </Tool>
      <Tool label="Takenlijst" active={state.taskList} onClick={() => chain().toggleTaskList().run()}>
        <ListTodo size={16} />
      </Tool>
      <span className="toolbar-sep" />
      <Tool label="Links uitlijnen" active={state.align === 'left'} onClick={() => chain().setTextAlign('left').run()}>
        <TextAlignStart size={16} />
      </Tool>
      <Tool label="Centreren" active={state.align === 'center'} onClick={() => chain().setTextAlign('center').run()}>
        <TextAlignCenter size={16} />
      </Tool>
      <Tool label="Rechts uitlijnen" active={state.align === 'right'} onClick={() => chain().setTextAlign('right').run()}>
        <TextAlignEnd size={16} />
      </Tool>
      <Tool label="Uitvullen" active={state.align === 'justify'} onClick={() => chain().setTextAlign('justify').run()}>
        <TextAlignJustify size={16} />
      </Tool>
      <span className="toolbar-sep" />
      <Tool label="Citaat" active={state.blockquote} onClick={() => chain().toggleBlockquote().run()}>
        <TextQuote size={16} />
      </Tool>
      <Tool label="Codeblok" active={state.codeBlock} onClick={() => chain().toggleCodeBlock().run()}>
        <SquareCode size={16} />
      </Tool>
      <Tool label="Scheidingslijn" onClick={() => chain().setHorizontalRule().run()}>
        <Minus size={16} />
      </Tool>
      <Popover
        trigger={(props) => (
          <button type="button" className="icon-btn" aria-label="Tabel" title="Tabel" aria-pressed={state.table} onMouseDown={(e) => e.preventDefault()} {...props}>
            <Table size={16} />
          </button>
        )}
      >
        {(close) => {
          const run = (fn: () => void) => () => {
            fn()
            close()
          }
          return state.table ? (
            <>
              <MenuItem onSelect={run(() => chain().addRowAfter().run())}>Rij toevoegen</MenuItem>
              <MenuItem onSelect={run(() => chain().addColumnAfter().run())}>Kolom toevoegen</MenuItem>
              <MenuItem onSelect={run(() => chain().toggleHeaderRow().run())}>Koprij aan of uit</MenuItem>
              <div className="menu-sep" />
              <MenuItem onSelect={run(() => chain().deleteRow().run())}>Rij verwijderen</MenuItem>
              <MenuItem onSelect={run(() => chain().deleteColumn().run())}>Kolom verwijderen</MenuItem>
              <MenuItem danger onSelect={run(() => chain().deleteTable().run())}>
                Tabel verwijderen
              </MenuItem>
            </>
          ) : (
            <MenuItem onSelect={run(() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}>Tabel van 3 × 3 invoegen</MenuItem>
          )
        }}
      </Popover>
      <Tool label="Afbeelding" onClick={() => fileInput.current?.click()}>
        <ImagePlus size={16} />
      </Tool>
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onImage(file)
          event.target.value = ''
        }}
      />
    </div>
  )
}
