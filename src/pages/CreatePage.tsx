import { useState, useEffect, useMemo, useRef } from 'react'
import type { ContentCategory, DownloadItem, SeriesSeason, SeriesEpisode } from '../types'
import { useAuth } from '../context/AuthContext'

// ── Helpers ────────────────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<ContentCategory, string> = {
  movies: 'Filmes', series: 'Series', animes: 'Animes',
  games: 'Jogos', books: 'Livros', mixed: 'Misto',
}
const CATEGORY_EMOJI: Record<ContentCategory, string> = {
  movies: '🎬', series: '📺', animes: '🌸', games: '🎮', books: '📚', mixed: '📦',
}

function emptyItem(category: ContentCategory): DownloadItem {
  const base: DownloadItem = {
    title: '',
    uris: [''],
    uploadDate: new Date().toISOString().slice(0, 10),
    fileSize: '',
    category,
    coverUrl: '',
  }
  if (category === 'series' || category === 'animes') {
    base.seasons = [{ season: 1, episodes: [{ title: 'S01E01', uri: '', fileSize: '', uploadDate: '' }] }]
  }
  return base
}

// Syntax-highlighted JSON preview
function JsonPreview({ data }: { data: object }) {
  const highlighted = useMemo(() => {
    const json = JSON.stringify(data, null, 2)
    return json
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
      .replace(/: "([^"]*)"/g, ': <span class="json-str">"$1"</span>')
      .replace(/: (\d+\.?\d*)/g, ': <span class="json-num">$1</span>')
      .replace(/: (true|false)/g, ': <span class="json-bool">$1</span>')
      .replace(/: null/g, ': <span class="json-null">null</span>')
  }, [data])

  return (
    <pre
      className="mono text-xs leading-relaxed overflow-auto p-4 rounded-xl h-full"
      style={{ background: '#0d0d0d', border: '1px solid var(--border)', color: '#ccc', maxHeight: '70vh' }}
      dangerouslySetInnerHTML={{ __html: highlighted }}
    />
  )
}

// ── Manual item editor ─────────────────────────────────────────────────────────

function ItemEditor({
  item, index, category, onChange, onRemove,
}: {
  item: DownloadItem
  index: number
  category: ContentCategory
  onChange: (item: DownloadItem) => void
  onRemove: () => void
}) {
  const field = (key: keyof DownloadItem, label: string, placeholder = '') => (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium" style={{ color: 'var(--muted)' }}>{label}</label>
      <input
        className="px-3 py-2 rounded-lg text-sm outline-none"
        style={{ background: 'var(--panel-2)', border: '1px solid var(--border-2)', color: 'var(--text)' }}
        placeholder={placeholder}
        value={(item[key] as string) ?? ''}
        onChange={e => onChange({ ...item, [key]: e.target.value })}
      />
    </div>
  )

  const isSeries = category === 'series' || category === 'animes'

  const updateSeason = (si: number, season: SeriesSeason) => {
    const seasons = [...(item.seasons ?? [])]
    seasons[si] = season
    onChange({ ...item, seasons })
  }

  const addSeason = () => {
    const seasons = [...(item.seasons ?? [])]
    seasons.push({ season: seasons.length + 1, episodes: [{ title: `S${String(seasons.length + 1).padStart(2,'0')}E01`, uri: '', fileSize: '', uploadDate: '' }] })
    onChange({ ...item, seasons })
  }

  const removeSeason = (si: number) => {
    const seasons = (item.seasons ?? []).filter((_, i) => i !== si)
    onChange({ ...item, seasons })
  }

  const addEpisode = (si: number) => {
    const seasons = [...(item.seasons ?? [])]
    const s = seasons[si]
    const epNum = s.episodes.length + 1
    s.episodes = [...s.episodes, {
      title: `S${String(s.season).padStart(2,'0')}E${String(epNum).padStart(2,'0')}`,
      uri: '', fileSize: '', uploadDate: ''
    }]
    seasons[si] = s
    onChange({ ...item, seasons })
  }

  const removeEpisode = (si: number, ei: number) => {
    const seasons = [...(item.seasons ?? [])]
    seasons[si] = { ...seasons[si], episodes: seasons[si].episodes.filter((_, i) => i !== ei) }
    onChange({ ...item, seasons })
  }

  const updateEpisode = (si: number, ei: number, updates: Partial<SeriesEpisode>) => {
    const seasons = [...(item.seasons ?? [])]
    const eps = [...seasons[si].episodes]
    eps[ei] = { ...eps[ei], ...updates }
    seasons[si] = { ...seasons[si], episodes: eps }
    onChange({ ...item, seasons })
  }

  const updateUri = (i: number, val: string) => {
    const uris = [...item.uris]
    uris[i] = val
    onChange({ ...item, uris })
  }

  return (
    <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: 'var(--panel-2)', border: '1px solid var(--border-2)' }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Item #{index + 1}</span>
        <button onClick={onRemove} className="text-xs transition-colors" style={{ color: 'var(--muted-2)' }}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#ef4444')}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--muted-2)')}>
          ✕ Remover
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {field('title', 'Titulo *', 'Ex: Inception')}
        {field('fileSize', 'Tamanho', 'Ex: 4.2 GB')}
        {field('uploadDate', 'Data (YYYY-MM-DD)', '2024-01-01')}
        {field('coverUrl', 'Cover URL', 'https://...')}
        {(category === 'movies' || category === 'games' || category === 'books') && (
          <>
            {field('tmdbId' as keyof DownloadItem, 'TMDB ID (opcional)', '12345')}
            {category === 'games' && field('rawgId' as keyof DownloadItem, 'RAWG ID (opcional)', '67890')}
          </>
        )}
      </div>

      {/* URIs (for non-series) */}
      {!isSeries && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium" style={{ color: 'var(--muted)' }}>Links / Magnets *</label>
            <button
              onClick={() => onChange({ ...item, uris: [...item.uris, ''] })}
              className="text-xs" style={{ color: 'var(--accent)' }}>
              + Adicionar link
            </button>
          </div>
          {item.uris.map((uri, i) => (
            <div key={i} className="flex gap-2">
              <input
                className="flex-1 px-3 py-2 rounded-lg text-xs mono outline-none"
                style={{ background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text)' }}
                placeholder="magnet:?xt=urn:btih:... ou https://..."
                value={uri}
                onChange={e => updateUri(i, e.target.value)}
              />
              {item.uris.length > 1 && (
                <button onClick={() => onChange({ ...item, uris: item.uris.filter((_, j) => j !== i) })}
                  className="px-2 text-sm" style={{ color: 'var(--muted-2)' }}>✕</button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Seasons/Episodes for series */}
      {isSeries && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Temporadas</label>
            <button onClick={addSeason} className="text-xs" style={{ color: 'var(--accent)' }}>+ Temporada</button>
          </div>
          {(item.seasons ?? []).map((season, si) => (
            <div key={si} className="rounded-lg p-3 flex flex-col gap-2" style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>Temporada {season.season}</span>
                <div className="flex items-center gap-3">
                  <button onClick={() => addEpisode(si)} className="text-xs" style={{ color: 'var(--muted)' }}>+ Ep</button>
                  {(item.seasons ?? []).length > 1 && (
                    <button onClick={() => removeSeason(si)} className="text-xs" style={{ color: 'var(--muted-2)' }}>Remover temp.</button>
                  )}
                </div>
              </div>
              {/* Season-pack URI */}
              <input
                className="px-2 py-1.5 rounded-md text-xs mono outline-none w-full"
                style={{ background: 'var(--panel-2)', border: '1px solid var(--border-2)', color: 'var(--text)' }}
                placeholder="Magnet da temporada completa (opcional)"
                value={season.uri ?? ''}
                onChange={e => updateSeason(si, { ...season, uri: e.target.value })}
              />
              {/* Episodes */}
              <div className="flex flex-col gap-1.5">
                {season.episodes.map((ep, ei) => (
                  <div key={ei} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2">
                    <input
                      className="px-2 py-1.5 rounded-md text-xs outline-none"
                      style={{ background: 'var(--panel-2)', border: '1px solid var(--border-2)', color: 'var(--text)', width: 90 }}
                      placeholder="Titulo ep"
                      value={ep.title}
                      onChange={e => updateEpisode(si, ei, { title: e.target.value })}
                    />
                    <input
                      className="px-2 py-1.5 rounded-md text-xs mono outline-none"
                      style={{ background: 'var(--panel-2)', border: '1px solid var(--border-2)', color: 'var(--text)' }}
                      placeholder="magnet:?xt=..."
                      value={ep.uri}
                      onChange={e => updateEpisode(si, ei, { uri: e.target.value })}
                    />
                    <input
                      className="px-2 py-1.5 rounded-md text-xs outline-none"
                      style={{ background: 'var(--panel-2)', border: '1px solid var(--border-2)', color: 'var(--text)', width: 70 }}
                      placeholder="Tam."
                      value={ep.fileSize ?? ''}
                      onChange={e => updateEpisode(si, ei, { fileSize: e.target.value })}
                    />
                    {season.episodes.length > 1 && (
                      <button onClick={() => removeEpisode(si, ei)} className="text-xs px-1" style={{ color: 'var(--muted-2)' }}>✕</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main CreatePage ────────────────────────────────────────────────────────────

interface CreatePageProps {
  onDone: () => void
  editId: string | null
}

type Mode = 'bulk' | 'manual'

export function CreatePage({ onDone, editId }: CreatePageProps) {
  const { user, token } = useAuth()
  const isAdmin = user?.isAdmin ?? false

  const [mode, setMode] = useState<Mode>('manual')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [author, setAuthor] = useState('')
  const [category, setCategory] = useState<ContentCategory>('movies')
  const [items, setItems] = useState<DownloadItem[]>([])
  const [bulkText, setBulkText] = useState('')
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Load existing addon for editing
  useEffect(() => {
    if (!editId) return
    fetch(`/api/addons/${editId}`)
      .then(r => r.json())
      .then(data => {
        setName(data.name ?? '')
        setItems(data.downloads ?? [])
      })
    fetch('/api/addons')
      .then(r => r.json())
      .then((list: { id: string; description: string; author: string; category: ContentCategory }[]) => {
        const meta = list.find(a => a.id === editId)
        if (meta) {
          setDescription(meta.description)
          setAuthor(meta.author)
          setCategory(meta.category)
        }
      })
  }, [editId])

  // Parse bulk JSON (array of DownloadItem OR { name, downloads } envelope)
  const parseBulk = (text: string) => {
    setBulkError(null)
    try {
      const parsed = JSON.parse(text)
      let arr: DownloadItem[]
      if (Array.isArray(parsed)) {
        arr = parsed
      } else if (parsed.downloads && Array.isArray(parsed.downloads)) {
        arr = parsed.downloads
        if (parsed.name && !name) setName(parsed.name)
      } else {
        throw new Error('Esperava um array ou { name, downloads[] }')
      }
      setItems(arr)
      setBulkText(text)
    } catch (e) {
      setBulkError((e as Error).message)
    }
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => parseBulk(ev.target?.result as string)
    reader.readAsText(file)
    if (fileRef.current) fileRef.current.value = ''
  }

  const addItem = () => setItems(prev => [...prev, emptyItem(category)])
  const updateItem = (i: number, item: DownloadItem) => setItems(prev => { const n = [...prev]; n[i] = item; return n })
  const removeItem = (i: number) => setItems(prev => prev.filter((_, j) => j !== i))

  const previewData = useMemo(() => ({
    name: name || '(nome do addon)',
    downloads: items,
  }), [name, items])

  const canSave = name.trim() && items.length > 0

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    setSuccessMsg(null)
    try {
      const body = { name: name.trim(), description, author, category, downloads: items }

      if (isAdmin) {
        // Admin: publish directly
        const url = editId ? `/api/addons/${editId}` : '/api/addons'
        const method = editId ? 'PUT' : 'POST'
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const err = await res.json() as { error?: string }
          throw new Error(err.error ?? 'Erro ao salvar')
        }
        onDone()
      } else {
        // Regular user: submit to pending queue
        const res = await fetch('/api/addons/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const err = await res.json() as { error?: string }
          throw new Error(err.error ?? 'Erro ao enviar')
        }
        setSuccessMsg('Addon enviado para revisao! Um admin ira aprovar em breve.')
        // Reset form
        setName(''); setDescription(''); setAuthor(''); setItems([])
      }
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button onClick={onDone} className="text-sm transition-colors" style={{ color: 'var(--muted)' }}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--text)')}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--muted)')}>
          ← Voltar
        </button>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>
          {editId ? 'Editar Addon' : isAdmin ? 'Publicar Addon' : 'Enviar Addon para Revisao'}
        </h1>
        {!isAdmin && (
          <span className="text-xs px-2 py-1 rounded-lg" style={{ background: 'rgba(234,179,8,0.1)', color: '#eab308', border: '1px solid rgba(234,179,8,0.25)' }}>
            Sera revisado por um admin antes de aparecer na biblioteca
          </span>
        )}
      </div>

      {successMsg && (
        <div style={{ marginBottom: 24, padding: '14px 18px', borderRadius: 12, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)' }}>
          <p style={{ margin: 0, fontSize: 14, color: '#22c55e' }}>✓ {successMsg}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT — Form */}
        <div className="flex flex-col gap-5">

          {/* Metadata */}
          <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Informacoes do Addon</h2>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium" style={{ color: 'var(--muted)' }}>Nome *</label>
              <input
                className="px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: 'var(--panel-2)', border: '1px solid var(--border-2)', color: 'var(--text)' }}
                placeholder="Ex: Filmes Classicos HD"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium" style={{ color: 'var(--muted)' }}>Descricao</label>
              <textarea
                className="px-3 py-2 rounded-lg text-sm outline-none resize-none"
                style={{ background: 'var(--panel-2)', border: '1px solid var(--border-2)', color: 'var(--text)', minHeight: 64 }}
                placeholder="Descreva o conteudo deste addon..."
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              {isAdmin && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium" style={{ color: 'var(--muted)' }}>Autor</label>
                  <input
                    className="px-3 py-2 rounded-lg text-sm outline-none"
                    style={{ background: 'var(--panel-2)', border: '1px solid var(--border-2)', color: 'var(--text)' }}
                    placeholder="Seu nome"
                    value={author}
                    onChange={e => setAuthor(e.target.value)}
                  />
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium" style={{ color: 'var(--muted)' }}>Categoria</label>
                <select
                  className="px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: 'var(--panel-2)', border: '1px solid var(--border-2)', color: 'var(--text)' }}
                  value={category}
                  onChange={e => setCategory(e.target.value as ContentCategory)}
                >
                  {(Object.entries(CATEGORY_LABEL) as [ContentCategory, string][]).map(([val, label]) => (
                    <option key={val} value={val}>{CATEGORY_EMOJI[val]} {label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Mode toggle */}
          <div className="flex rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            {(['manual', 'bulk'] as Mode[]).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="flex-1 py-2.5 text-sm font-medium transition-all"
                style={{
                  background: mode === m ? 'var(--accent-dim)' : 'var(--panel)',
                  color: mode === m ? 'var(--accent)' : 'var(--muted)',
                }}
              >
                {m === 'manual' ? '✏️ Entrada Manual' : '📋 Bulk / Upload'}
              </button>
            ))}
          </div>

          {/* Bulk mode */}
          {mode === 'bulk' && (
            <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>JSON / Upload</h2>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="text-xs px-3 py-1.5 rounded-lg"
                  style={{ background: 'var(--panel-2)', color: 'var(--muted)', border: '1px solid var(--border-2)' }}
                >
                  📂 Carregar arquivo
                </button>
              </div>
              <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFile} />
              <textarea
                className="px-3 py-2.5 rounded-lg text-xs mono outline-none resize-none"
                style={{
                  background: 'var(--panel-2)', border: `1px solid ${bulkError ? '#ef4444' : 'var(--border-2)'}`,
                  color: 'var(--text)', minHeight: 220, fontFamily: 'JetBrains Mono, monospace',
                }}
                placeholder={'Cole aqui um array de itens:\n[\n  {\n    "title": "Inception",\n    "uris": ["magnet:?xt=..."],\n    "uploadDate": "2024-01-01",\n    "fileSize": "4.2 GB"\n  }\n]\n\nOu um envelope { "name": "...", "downloads": [...] }'}
                value={bulkText}
                onChange={e => parseBulk(e.target.value)}
              />
              {bulkError && (
                <p className="text-xs" style={{ color: '#ef4444' }}>⚠ {bulkError}</p>
              )}
              {!bulkError && items.length > 0 && (
                <p className="text-xs" style={{ color: 'var(--green)' }}>
                  ✓ {items.length} item{items.length !== 1 ? 's' : ''} carregado{items.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          )}

          {/* Manual mode */}
          {mode === 'manual' && (
            <div className="flex flex-col gap-3">
              {items.map((item, i) => (
                <ItemEditor
                  key={i}
                  item={item}
                  index={i}
                  category={category}
                  onChange={updated => updateItem(i, updated)}
                  onRemove={() => removeItem(i)}
                />
              ))}
              <button
                onClick={addItem}
                className="py-3 rounded-xl text-sm font-medium transition-all"
                style={{ background: 'var(--panel)', border: '1px dashed var(--border-2)', color: 'var(--muted)' }}
                onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.color = 'var(--accent)'; b.style.borderColor = 'var(--accent-border)' }}
                onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.color = 'var(--muted)'; b.style.borderColor = 'var(--border-2)' }}
              >
                + Adicionar item
              </button>
            </div>
          )}

          {/* Save / Submit */}
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="w-full py-3 rounded-xl text-sm font-bold transition-opacity"
            style={{
              background: canSave ? 'var(--accent)' : 'var(--panel-2)',
              color: canSave ? '#0a0a0a' : 'var(--muted-2)',
              opacity: saving ? 0.7 : 1,
              cursor: canSave ? 'pointer' : 'not-allowed',
            }}
          >
            {saving
              ? (isAdmin ? 'Salvando...' : 'Enviando...')
              : isAdmin
                ? (editId ? `Atualizar Addon (${items.length} itens)` : `Publicar Addon (${items.length} itens)`)
                : `Enviar para Revisao (${items.length} itens)`
            }
          </button>
        </div>

        {/* RIGHT — Live preview */}
        <div className="lg:sticky lg:top-20 h-fit flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--muted)' }}>
              Preview do JSON
            </h2>
            <span className="text-xs mono px-2 py-0.5 rounded-md" style={{ background: 'var(--panel)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
              {items.length} item{items.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Card preview */}
          <div className="rounded-xl p-4 flex flex-col gap-2" style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>Como vai aparecer na biblioteca</p>
            <div className="rounded-xl p-4" style={{ background: 'var(--panel-2)', border: '1px solid var(--border-2)' }}>
              <div className="flex items-start justify-between mb-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg"
                  style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-border)' }}>
                  {CATEGORY_EMOJI[category]}
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                  style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}>
                  {CATEGORY_LABEL[category]}
                </span>
              </div>
              <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text)' }}>{name || '(nome do addon)'}</p>
              {description && <p className="text-xs mb-2" style={{ color: 'var(--muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{description}</p>}
              <p className="text-xs mb-3" style={{ color: 'var(--muted-2)' }}>
                por <span style={{ color: 'var(--muted)' }}>{author || user?.username || 'Anonimo'}</span>
                {' · '}{items.length} item{items.length !== 1 ? 's' : ''}
              </p>
              <div className="py-2 rounded-lg text-center text-xs font-semibold"
                style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}>
                Copiar URL
              </div>
            </div>
          </div>

          {/* JSON Preview */}
          <JsonPreview data={previewData} />
        </div>
      </div>
    </div>
  )
}
