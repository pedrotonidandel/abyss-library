import { useState, useRef, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'

// ─── Types ────────────────────────────────────────────────────────────────────

type EventType =
  | { type: 'info';     message: string }
  | { type: 'category'; category: string; total: number }
  | { type: 'item';     index: number; total: number; title: string; status: 'found' | 'missed'; score?: number; size?: string }
  | { type: 'warn';     message: string }
  | { type: 'done';     sources: Source[] }
  | { type: 'error';    message: string }

interface Source {
  id:        string
  name:      string
  category:  string
  addedAt:   string
  downloads: unknown[]
}

interface CategoryProgress {
  category: string
  total:    number
  current:  number
  found:    number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_OPTIONS = [
  { id: 'movies',  label: 'Filmes',  emoji: '🎬' },
  { id: 'series',  label: 'Séries',  emoji: '📺' },
  { id: 'animes',  label: 'Animes',  emoji: '🌸' },
  { id: 'games',   label: 'Jogos',   emoji: '🎮' },
]

// ─── Components ───────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        position: 'relative', width: 36, height: 20, flexShrink: 0,
        background: checked ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
        borderRadius: 10, transition: 'background 0.2s',
        border: 'none', cursor: 'pointer',
      }}
    >
      <span style={{
        position: 'absolute', top: 2,
        left: checked ? 18 : 2,
        width: 16, height: 16, borderRadius: '50%',
        background: '#fff', transition: 'left 0.2s',
        display: 'block',
      }} />
    </button>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

interface MagnetzBuilderPageProps {
  onBack: () => void
}

export function MagnetzBuilderPage({ onBack }: MagnetzBuilderPageProps) {
  const { token } = useAuth()

  // ── Config ──────────────────────────────────────────────────────────────────
  const [categories,    setCategories]    = useState<string[]>(['movies', 'series'])
  const [pages,         setPages]         = useState(2)
  const [minScore,      setMinScore]      = useState(0)
  const [magnetzDelay,  setMagnetzDelay]  = useState(8000)
  const [tmdbKey,       setTmdbKey]       = useState('')
  const [rawgKey,       setRawgKey]       = useState('')

  // ── State ───────────────────────────────────────────────────────────────────
  const [running,       setRunning]       = useState(false)
  const [done,          setDone]          = useState(false)
  const [log,           setLog]           = useState<{ id: number; event: EventType }[]>([])
  const [categoryStats, setCategoryStats] = useState<CategoryProgress | null>(null)
  const [sources,       setSources]       = useState<Source[]>([])
  const [publishing,    setPublishing]    = useState(false)
  const [published,     setPublished]     = useState(false)

  const logEndRef    = useRef<HTMLDivElement>(null)
  const abortRef     = useRef<AbortController | null>(null)
  const logIdRef     = useRef(0)

  // Auto-scroll do log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [log])

  const addLog = useCallback((event: EventType) => {
    setLog(prev => [...prev, { id: logIdRef.current++, event }])
  }, [])

  const toggleCategory = (id: string) => {
    setCategories(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id],
    )
  }

  // ── Build ───────────────────────────────────────────────────────────────────

  const handleStart = async () => {
    if (!categories.length) { alert('Selecione ao menos uma categoria.'); return }

    setRunning(true)
    setDone(false)
    setLog([])
    setCategoryStats(null)
    setSources([])
    setPublished(false)

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const resp = await fetch('/api/admin/magnetz/build', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ categories, pages, minScore, magnetzDelay, tmdbKey: tmdbKey || undefined, rawgKey: rawgKey || undefined }),
        signal: abort.signal,
      })

      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }))
        addLog({ type: 'error', message: (err as { error?: string }).error ?? 'Erro desconhecido' })
        setRunning(false)
        return
      }

      // Read SSE stream
      const reader  = resp.body.getReader()
      const decoder = new TextDecoder()
      let   buffer  = ''

      while (true) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break

        buffer += decoder.decode(value, { stream: true })

        // Parse complete SSE lines
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''   // keep incomplete last line in buffer

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6)) as EventType
            addLog(event)

            if (event.type === 'category') {
              setCategoryStats({ category: event.category, total: event.total, current: 0, found: 0 })
            }
            if (event.type === 'item') {
              setCategoryStats(prev => prev ? {
                ...prev,
                current: event.index,
                found:   prev.found + (event.status === 'found' ? 1 : 0),
              } : null)
            }
            if (event.type === 'done') {
              setSources(event.sources)
              setDone(true)
            }
          } catch { /* malformed JSON — skip */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        addLog({ type: 'error', message: (err as Error).message })
      }
    } finally {
      setRunning(false)
    }
  }

  const handleStop = () => {
    abortRef.current?.abort()
    addLog({ type: 'warn', message: 'Build cancelado pelo usuário.' })
    setRunning(false)
  }

  // ── Publish ──────────────────────────────────────────────────────────────────

  const handlePublish = async () => {
    setPublishing(true)
    try {
      const r = await fetch('/api/admin/magnetz/publish', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body:    JSON.stringify({ sources }),
      })
      const data = await r.json() as { inserted?: number }
      if (!r.ok) throw new Error((data as { error?: string }).error ?? 'Erro')
      addLog({ type: 'info', message: `✓ ${data.inserted} addon(s) publicados na biblioteca.` })
      setPublished(true)
    } catch (err) {
      addLog({ type: 'error', message: (err as Error).message })
    } finally {
      setPublishing(false)
    }
  }

  const handleDownload = () => {
    const blob = new Blob([JSON.stringify(sources, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `magnetz-source-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Computed ─────────────────────────────────────────────────────────────────

  const totalDownloads = sources.reduce((n, s) => n + s.downloads.length, 0)
  const progressPct    = categoryStats && categoryStats.total > 0
    ? (categoryStats.current / categoryStats.total) * 100
    : 0

  // ── Render ───────────────────────────────────────────────────────────────────

  const inputStyle: React.CSSProperties = {
    background: 'var(--panel-2)', border: '1px solid var(--border)',
    color: 'var(--text)', borderRadius: 8, padding: '8px 12px',
    fontSize: 13, outline: 'none', width: '100%',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 6, display: 'block',
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 24px' }}>

      {/* ── Header ── */}
      <button
        onClick={onBack}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 13, marginBottom: 24, padding: 0, display: 'flex', alignItems: 'center', gap: 6 }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
      >
        ← Voltar
      </button>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 32 }}>
        <div>
          <h2 style={{ color: 'var(--text)', fontWeight: 800, fontSize: 28, margin: 0, letterSpacing: '-0.5px' }}>
            Magnetz Builder
          </h2>
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: '6px 0 0' }}>
            Busca magnets verificados no Magnetz.eu e publica como addons na biblioteca.
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 24, alignItems: 'start' }}>

        {/* ── Left: config ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px' }}>
            <p style={{ ...labelStyle, marginBottom: 12 }}>Categorias</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {CATEGORY_OPTIONS.map(opt => (
                <label key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <Toggle
                    checked={categories.includes(opt.id)}
                    onChange={() => toggleCategory(opt.id)}
                  />
                  <span style={{ fontSize: 13, color: 'var(--text)' }}>{opt.emoji} {opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={labelStyle}>Páginas TMDB</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="range" min={1} max={10} value={pages}
                  onChange={e => setPages(+e.target.value)}
                  style={{ flex: 1, accentColor: 'var(--accent)' }}
                />
                <span style={{ fontSize: 13, color: 'var(--text)', minWidth: 60, textAlign: 'right' }}>
                  {pages}p · ~{pages * 20} títulos
                </span>
              </div>
            </div>

            <div>
              <label style={labelStyle}>Score mínimo (Magnetz)</label>
              <input
                type="number" min={0} max={10} step={0.5}
                value={minScore} onChange={e => setMinScore(+e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Delay entre requests (ms)</label>
              <input
                type="number" min={3000} max={30000} step={500}
                value={magnetzDelay} onChange={e => setMagnetzDelay(+e.target.value)}
                style={inputStyle}
              />
              <p style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 4 }}>
                Mínimo recomendado: 8000ms. Abaixo de 5000ms você vai receber 429.
              </p>
            </div>
          </div>

          <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={labelStyle}>Chave TMDB</label>
              <input
                type="password" placeholder="Usa TMDB_API_KEY do servidor se vazio"
                value={tmdbKey} onChange={e => setTmdbKey(e.target.value)}
                style={inputStyle}
              />
            </div>
            {categories.includes('games') && (
              <div>
                <label style={labelStyle}>Chave RAWG</label>
                <input
                  type="password" placeholder="Usa RAWG_API_KEY do servidor se vazio"
                  value={rawgKey} onChange={e => setRawgKey(e.target.value)}
                  style={inputStyle}
                />
              </div>
            )}
          </div>

          {/* Action button */}
          {!running ? (
            <button
              onClick={handleStart}
              disabled={categories.length === 0}
              style={{
                padding: '12px 0', borderRadius: 10, border: 'none',
                background: categories.length === 0 ? 'var(--border)' : 'var(--accent)',
                color: '#0a0a0a', fontSize: 14, fontWeight: 700,
                cursor: categories.length === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              ▶ Iniciar Build
            </button>
          ) : (
            <button
              onClick={handleStop}
              style={{
                padding: '12px 0', borderRadius: 10,
                background: 'rgba(239,68,68,0.15)', color: '#ef4444',
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
                border: '1px solid rgba(239,68,68,0.3)',
              }}
            >
              ⏹ Cancelar
            </button>
          )}
        </div>

        {/* ── Right: progress + log ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Progress bar */}
          {(running || done) && categoryStats && (
            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                  {categoryStats.category[0].toUpperCase() + categoryStats.category.slice(1)}
                </span>
                <span style={{ fontSize: 13, color: 'var(--muted)', fontFamily: 'monospace' }}>
                  {categoryStats.current}/{categoryStats.total} · {categoryStats.found} encontrados
                </span>
              </div>
              <div style={{ background: 'var(--border)', borderRadius: 6, height: 6, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 6,
                  background: done ? '#22c55e' : 'var(--accent)',
                  width: `${progressPct}%`,
                  transition: 'width 0.3s ease',
                }} />
              </div>
            </div>
          )}

          {/* Results summary + actions */}
          {done && sources.length > 0 && (
            <div style={{
              background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)',
              borderRadius: 14, padding: 20,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
            }}>
              <div>
                <p style={{ fontWeight: 700, fontSize: 15, color: '#22c55e', margin: 0 }}>
                  ✓ Build concluído
                </p>
                <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0' }}>
                  {totalDownloads} magnets em {sources.length} addon{sources.length !== 1 ? 's' : ''}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleDownload}
                  style={{
                    padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                    background: 'var(--panel-2)', color: 'var(--muted)',
                    border: '1px solid var(--border)', cursor: 'pointer',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
                >
                  ↓ Baixar JSON
                </button>
                <button
                  onClick={handlePublish}
                  disabled={publishing || published}
                  style={{
                    padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                    background: published ? 'rgba(34,197,94,0.2)' : 'var(--accent)',
                    color: published ? '#22c55e' : '#0a0a0a',
                    border: published ? '1px solid rgba(34,197,94,0.4)' : 'none',
                    cursor: publishing || published ? 'not-allowed' : 'pointer',
                    opacity: publishing ? 0.7 : 1,
                  }}
                >
                  {publishing ? 'Publicando…' : published ? '✓ Publicado' : `Publicar ${totalDownloads} magnets`}
                </button>
              </div>
            </div>
          )}

          {/* Log */}
          <div style={{
            background: 'var(--panel)', border: '1px solid var(--border)',
            borderRadius: 14, overflow: 'hidden',
            minHeight: 400,
          }}>
            <div style={{
              padding: '12px 16px', borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Log
              </span>
              {log.length > 0 && (
                <button
                  onClick={() => setLog([])}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--muted-2)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--muted)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted-2)')}
                >
                  Limpar
                </button>
              )}
            </div>

            <div style={{ height: 480, overflowY: 'auto', padding: '12px 0', fontFamily: 'monospace', fontSize: 12 }}>
              {log.length === 0 ? (
                <p style={{ color: 'var(--muted-2)', textAlign: 'center', marginTop: 60, fontSize: 13, fontFamily: 'inherit' }}>
                  O log aparecerá aqui quando o build iniciar.
                </p>
              ) : (
                log.map(({ id, event }) => <LogLine key={id} event={event} />)
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Log line ─────────────────────────────────────────────────────────────────

function LogLine({ event }: { event: EventType }) {
  const base: React.CSSProperties = {
    padding: '3px 16px', lineHeight: 1.5, display: 'flex', alignItems: 'baseline', gap: 8,
  }

  if (event.type === 'info') return (
    <div style={{ ...base, color: 'var(--muted)' }}>
      <span style={{ color: 'var(--accent)', userSelect: 'none' }}>›</span>
      {event.message}
    </div>
  )

  if (event.type === 'category') return (
    <div style={{ ...base, color: 'var(--accent)', fontWeight: 700, marginTop: 8 }}>
      <span>── {event.category} ── {event.total} títulos</span>
    </div>
  )

  if (event.type === 'item') {
    const found = event.status === 'found'
    return (
      <div style={{ ...base, color: found ? 'var(--text)' : 'var(--muted-2)' }}>
        <span style={{ color: found ? '#22c55e' : 'var(--muted-2)', minWidth: 10, userSelect: 'none' }}>
          {found ? '✓' : '·'}
        </span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {event.title}
        </span>
        {found && event.score !== undefined && (
          <span style={{ color: 'var(--muted)', fontSize: 11, flexShrink: 0 }}>
            {event.score.toFixed(1)}★ {event.size}
          </span>
        )}
        <span style={{ color: 'var(--muted-2)', fontSize: 11, minWidth: 50, textAlign: 'right', flexShrink: 0 }}>
          {event.index}/{event.total}
        </span>
      </div>
    )
  }

  if (event.type === 'warn') return (
    <div style={{ ...base, color: '#f59e0b' }}>
      <span style={{ userSelect: 'none' }}>⚠</span>
      {event.message}
    </div>
  )

  if (event.type === 'error') return (
    <div style={{ ...base, color: '#ef4444' }}>
      <span style={{ userSelect: 'none' }}>✗</span>
      {event.message}
    </div>
  )

  if (event.type === 'done') return (
    <div style={{ ...base, color: '#22c55e', fontWeight: 700, marginTop: 8 }}>
      <span>✓ Concluído — {event.sources.reduce((n, s) => n + s.downloads.length, 0)} magnets em {event.sources.length} addon(s)</span>
    </div>
  )

  return null
}
