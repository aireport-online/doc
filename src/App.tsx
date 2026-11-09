import { lazy, Suspense } from 'react'
import { Home } from './pages/Home'
import { navigate, usePath } from './lib/router'

// The editor is the heavy part; the document list loads without it.
const DocumentPage = lazy(() => import('./pages/DocumentPage').then((m) => ({ default: m.DocumentPage })))

export function App() {
  const path = usePath()
  const match = /^\/d\/([A-Za-z0-9_-]{1,64})\/?$/.exec(path)
  if (match) {
    return (
      <Suspense fallback={<div className="shell" aria-busy="true" />}>
        <DocumentPage key={match[1]} token={match[1]} />
      </Suspense>
    )
  }
  if (path !== '/') {
    return (
      <div className="shell">
        <div className="state-screen">
          <div className="state-card">
            <h1>Deze pagina bestaat niet</h1>
            <p>Het adres klopt niet. Je documenten vind je op de startpagina.</p>
            <button type="button" className="btn btn-primary" onClick={() => navigate('/')}>
              Naar mijn documenten
            </button>
          </div>
        </div>
      </div>
    )
  }
  return <Home />
}
