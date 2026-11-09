import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getSchema, type JSONContent } from '@tiptap/core'
import { diffDocuments } from '../src/lib/diff.ts'
import { schemaExtensions } from '../src/lib/extensions.ts'

const schema = getSchema(schemaExtensions())

type Inline = string | { text: string; marks: string[] }
const paragraph = (...parts: Inline[]): JSONContent => ({
  type: 'paragraph',
  content: parts.map((part) =>
    typeof part === 'string' ? { type: 'text', text: part } : { type: 'text', text: part.text, marks: part.marks.map((type) => ({ type })) },
  ),
})
const doc = (...content: JSONContent[]) => schema.nodeFromJSON({ type: 'doc', content })

/** Summarise the decorations as the text they cover in the newer document. */
function marks(before: ReturnType<typeof doc>, after: ReturnType<typeof doc>) {
  const { decorations, stats } = diffDocuments(before, after)
  const found = decorations.find().map((d) => {
    const spec = d as unknown as { type: { attrs?: { class?: string }; spec?: { key?: string } } }
    return { class: spec.type.attrs?.class ?? 'widget', text: after.textBetween(d.from, d.to, '¶'), at: d.from }
  })
  const of = (cls: string) => found.filter((f) => f.class === cls).map((f) => f.text).join('')
  return { stats, inserted: of('diff-ins'), formatted: of('diff-format'), widgets: found.filter((f) => f.class === 'widget').length, blocks: found.filter((f) => f.class === 'diff-format-block').length }
}

test('identical documents have no changes', () => {
  const a = doc(paragraph('Hallo wereld'))
  const result = marks(a, doc(paragraph('Hallo wereld')))
  assert.deepEqual(result, { stats: { wordsAdded: 0, wordsRemoved: 0 }, inserted: '', formatted: '', widgets: 0, blocks: 0 })
})

test('marks inserted words and counts them', () => {
  const result = marks(doc(paragraph('Het plan is klaar.')), doc(paragraph('Het nieuwe plan is bijna klaar.')))
  assert.equal(result.inserted.replace(/\s+/g, ' ').trim(), 'nieuwe bijna')
  assert.deepEqual(result.stats, { wordsAdded: 2, wordsRemoved: 0 })
  assert.equal(result.widgets, 0)
})

test('shows removed words where they used to be', () => {
  const before = doc(paragraph('Een twee drie vier'))
  const after = doc(paragraph('Een vier'))
  const { decorations, stats } = diffDocuments(before, after)
  assert.deepEqual(stats, { wordsAdded: 0, wordsRemoved: 2 })
  const [widget] = decorations.find()
  assert.equal(decorations.find().length, 1)
  // Position 1 is the start of the paragraph; "Een " is four characters long.
  assert.equal(widget.from, 5)
})

test('a replaced word is one removal and one insertion', () => {
  const result = marks(doc(paragraph('Doorlooptijd halveren')), doc(paragraph('Doorlooptijd verkorten')))
  assert.equal(result.inserted, 'verkorten')
  assert.equal(result.widgets, 1)
  assert.deepEqual(result.stats, { wordsAdded: 1, wordsRemoved: 1 })
})

test('new and removed paragraphs', () => {
  const added = marks(doc(paragraph('Eerste')), doc(paragraph('Eerste'), paragraph('Tweede alinea')))
  assert.equal(added.inserted, 'Tweede alinea')
  assert.deepEqual(added.stats, { wordsAdded: 2, wordsRemoved: 0 })

  const removed = marks(doc(paragraph('Eerste'), paragraph('Tweede alinea'), paragraph('Derde')), doc(paragraph('Eerste'), paragraph('Derde')))
  assert.equal(removed.inserted, '')
  assert.equal(removed.widgets, 1)
  assert.deepEqual(removed.stats, { wordsAdded: 0, wordsRemoved: 2 })
})

test('formatting-only changes are marked without counting as text changes', () => {
  const result = marks(doc(paragraph('Dit is belangrijk nieuws')), doc(paragraph('Dit is ', { text: 'belangrijk', marks: ['bold'] }, ' nieuws')))
  assert.equal(result.formatted, 'belangrijk')
  assert.equal(result.inserted, '')
  assert.deepEqual(result.stats, { wordsAdded: 0, wordsRemoved: 0 })

  const heading = marks(doc(paragraph('Titel')), doc({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Titel' }] }))
  assert.equal(heading.blocks, 1)
  assert.deepEqual(heading.stats, { wordsAdded: 0, wordsRemoved: 0 })
})

test('everything is new compared with an empty document', () => {
  const result = marks(doc({ type: 'paragraph' }), doc(paragraph('Drie nieuwe woorden')))
  assert.equal(result.inserted, 'Drie nieuwe woorden')
  assert.deepEqual(result.stats, { wordsAdded: 3, wordsRemoved: 0 })
})
