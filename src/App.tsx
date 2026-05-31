import { useState } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { HomePage } from './pages/HomePage'
import { CreatePage } from './pages/CreatePage'
import { LibraryLoginPage } from './pages/LibraryLoginPage'
import { AdminQueuePage } from './pages/AdminQueuePage'

export type Page = 'home' | 'create' | 'queue' | 'login'

function AppContent() {
  const { user, loading, logout } = useAuth()
  const [page, setPage] = useState<Page>('home')
  const [editId, setEditId] = useState<string | null>(null)

  const goCreate = () => {
    // Redirect to login if not authenticated yet
    if (!user) { setPage('login'); return }
    setEditId(null); setPage('create')
  }
  const goEdit   = (id: string) => { setEditId(id); setPage('create') }
  const goHome   = () => { setEditId(null); setPage('home') }
  const goQueue  = () => setPage('queue')
  const goLogin  = () => setPage('login')

  // After login, go back to home (or create if that's where we were headed)
  const handleLoggedIn = () => setPage('home')

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36, border: '3px solid var(--border)',
            borderTopColor: 'var(--accent)', borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Carregando...</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  // Login page is a standalone overlay — no nav needed
  if (page === 'login') {
    return <LibraryLoginPage onBack={goHome} onLoggedIn={handleLoggedIn} />
  }

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
          {user ? (
            <>
              {/* Logged-in: show username + admin badge */}
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: 'var(--muted)' }}>@{user.username}</span>
                {user.isAdmin && (
                  <span className="text-xs px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(234,179,8,0.15)', color: '#eab308', border: '1px solid rgba(234,179,8,0.3)' }}>
                    admin
                  </span>
                )}
              </div>

              {/* Admin: queue link */}
              {user.isAdmin && (
                <button
                  onClick={goQueue}
                  className="text-xs px-3 py-1.5 rounded-lg transition-colors"
                  style={{
                    color: page === 'queue' ? 'var(--text)' : 'var(--muted)',
                    border: `1px solid ${page === 'queue' ? 'var(--accent-border)' : 'var(--border)'}`,
                    background: page === 'queue' ? 'var(--accent-dim)' : 'transparent',
                  }}
                  onMouseEnter={e => { if (page !== 'queue') (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)' }}
                  onMouseLeave={e => { if (page !== 'queue') (e.currentTarget as HTMLButtonElement).style.color = 'var(--muted)' }}
                >
                  Fila
                </button>
              )}

              <button
                onClick={goCreate}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-opacity"
                style={{ background: 'var(--accent)', color: '#0a0a0a' }}
                onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.85')}
                onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.opacity = '1')}
              >
                {user.isAdmin ? '+ Publicar Addon' : '+ Enviar Addon'}
              </button>

              <button
                onClick={logout}
                className="text-xs px-3 py-1.5 rounded-lg transition-colors"
                style={{ color: 'var(--muted)', border: '1px solid var(--border)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#ef4444'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(239,68,68,0.4)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--muted)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)' }}
              >
                Sair
              </button>
            </>
          ) : (
            /* Not logged in: show login button */
            <button
              onClick={goLogin}
              className="text-xs px-3 py-1.5 rounded-lg transition-colors"
              style={{ color: 'var(--muted)', border: '1px solid var(--border)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent-border)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--muted)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)' }}
            >
              Entrar
            </button>
          )}
        </div>
      </nav>

      {/* ── Pages ── */}
      {page === 'home'   && <HomePage onCreate={goCreate} onEdit={goEdit} onLogin={goLogin} />}
      {page === 'create' && user && <CreatePage onDone={goHome} editId={editId} />}
      {page === 'queue'  && user?.isAdmin && <AdminQueuePage onBack={goHome} />}
    </div>
  )
}

export function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}
