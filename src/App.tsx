import { useState } from 'react'
import { HomePage } from './pages/HomePage'
import { CreatePage } from './pages/CreatePage'

export type Page = 'home' | 'create'

export function App() {
  const [page, setPage] = useState<Page>('home')
  const [editId, setEditId] = useState<string | null>(null)

  const goCreate = () => { setEditId(null); setPage('create') }
  const goEdit = (id: string) => { setEditId(id); setPage('create') }
  const goHome = () => { setEditId(null); setPage('home') }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* ── Nav ── */}
      <nav
        className="sticky top-0 z-50 flex items-center justify-between px-6 h-14"
        style={{ background: 'rgba(10,10,10,0.85)', borderBottom: '1px solid var(--border)', backdropFilter: 'blur(12px)' }}
      >
        <button onClick={goHome} className="flex items-center gap-2.5 group">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-sm"
            style={{ background: 'var(--accent)', color: '#0a0a0a' }}
          >
            A
          </div>
          <span className="font-semibold text-sm" style={{ color: 'var(--text)' }}>Abyss Library</span>
          <span className="text-xs px-1.5 py-0.5 rounded-md mono" style={{ background: 'var(--panel-2)', color: 'var(--muted)', border: '1px solid var(--border)' }}>beta</span>
        </button>

        <div className="flex items-center gap-3">
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="text-xs px-3 py-1.5 rounded-lg transition-colors"
            style={{ color: 'var(--muted)', border: '1px solid var(--border)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
          >
            GitHub
          </a>
          <button
            onClick={goCreate}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-opacity"
            style={{ background: 'var(--accent)', color: '#0a0a0a' }}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.85')}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.opacity = '1')}
          >
            + Publicar Addon
          </button>
        </div>
      </nav>

      {/* ── Pages ── */}
      {page === 'home'   && <HomePage onCreate={goCreate} onEdit={goEdit} />}
      {page === 'create' && <CreatePage onDone={goHome} editId={editId} />}
    </div>
  )
}
