import TurndownService from 'turndown'

function download(filename: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const fileName = (title: string) => (title.trim() || 'Naamloos document').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80)

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Images are stored on this server; exported files need their full address. */
const absoluteImages = (html: string) => html.replace(/src="\/api\/images\//g, `src="${location.origin}/api/images/`)

export function exportHtml(title: string, html: string) {
  const page = `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title || 'Naamloos document')}</title>
<style>
body{font-family:"IBM Plex Sans",system-ui,sans-serif;font-size:16px;line-height:1.6;color:#131416;max-width:720px;margin:48px auto;padding:0 24px}
h1{font-size:30px;line-height:1.2}h2{font-size:22px;line-height:1.3}h3{font-size:18px}
blockquote{margin:16px 0;padding-left:16px;border-left:3px solid #cdced1;color:#5d5f60}
pre{background:#f4f6f8;padding:12px 16px;border-radius:8px;overflow:auto}code{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:14px}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #cdced1;padding:6px 10px;text-align:left;vertical-align:top}
img{max-width:100%}mark{background:#fdf0b6}ul[data-type="taskList"]{list-style:none;padding-left:0}ul[data-type="taskList"] li{display:flex;gap:8px}ul[data-type="taskList"] li p{margin:0}
</style>
</head>
<body>
${absoluteImages(html)}
</body>
</html>
`
  download(`${fileName(title)}.html`, 'text/html;charset=utf-8', page)
}

export function exportMarkdown(title: string, html: string) {
  const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*' })
  turndown.addRule('taskItem', {
    filter: (node) => node.nodeName === 'LI' && node.hasAttribute('data-checked'),
    replacement: (content, node) => `- [${(node as HTMLElement).getAttribute('data-checked') === 'true' ? 'x' : ' '}] ${content.trim().replace(/\n+/g, '\n  ')}\n`,
  })
  turndown.addRule('strike', { filter: ['s', 'del'], replacement: (content) => `~~${content}~~` })
  // Markdown has no portable table of this shape with merged cells; keep tables as HTML.
  turndown.keep(['table'])
  download(`${fileName(title)}.md`, 'text/markdown;charset=utf-8', turndown.turndown(absoluteImages(html)) + '\n')
}
