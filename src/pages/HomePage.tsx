import { useState, useEffect, useMemo } from 'react'
import type { AddonMeta, ContentCategory } from '../types'
import { useAuth } from '../context/AuthContext'

const CATEGORY_LABEL: Record<string, string> = {
  movies: 'Filmes', series: 'Series', animes: 'Animes',
  games: 'Jogos', books: 'Livros', mixed: 'Misto',
}
const CATEGORY_EMOJI: Record<string, string> = {
  movies: '🎬', series: '📺', animes: '🌸', games: '🎮', books: '📚', mixed: '📦',
}
const CATEGORY_COLOR: Record<string, string> = {
  movies: '#6366f1', series: '#0ea5e9', animes: '#ec4899',
  games: '#22c55e',  books: '#f59e0b',  mixed: '#8b5cf6',
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {
    const el = document.createElement('textarea')
    el.value = text
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
  })
}

function AddonCard({ addon, onEdit }: { addon: AddonMeta; onEdit: (id: string) => void }) {
  const { user, token } = useAuth()
  const [copied, setCopied] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleCopy = () => {
    copyToClipboard(addon.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDelete = async () => {
    if (!confirm(`Deletar "${addon.name}"?`)) return
    setDeleting(true)
    await fetch(`/api/addons/${addon.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    window.location.reload()
  }

  const color = CATEGORY_COLOR[addon.category] ?? '#8b5cf6'
  const emoji = CATEGORY_EMOJI[addon.category] ?? '📦'
  const label = CATEGORY_LABEL[addon.category] ?? addon.category

  return (
    <div
      className="addon-card rounded-2xl p-5 flex flex-col gap-4"
      style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
          style={{ background: `${color}18`, border: `1px solid ${color}30` }}
        >
          {emoji}
        </div>
        <span
          className="text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{ background: `${color}18`, color, border: `1px solid ${color}30` }}
        >
          {label}
        </span>
      </div>

      {/* Info */}
      <div className="flex-1">
        <h3 className="font-semibold text-sm leading-snug mb-1" style={{ color: 'var(--text)' }}>
          {addon.name}
        </h3>
        {addon.description && (
          <p className="text-xs leading-relaxed mb-2" style={{ color: 'var(--muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {addon.description}
          </p>
        )}
        <p className="text-xs" style={{ color: 'var(--muted-2)' }}>
          por <span style={{ color: 'var(--muted)' }}>{addon.author}</span>
          {' · '}{addon.itemCount.toLocaleString('pt-BR')} item{addon.itemCount !== 1 ? 's' : ''}
        </p>
      </div>

      {/* URL bar */}
      <div
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg mono text-xs overflow-hidden"
        style={{ background: 'var(--panel-2)', border: '1px solid var(--border)' }}
      >
        <span className="truncate flex-1" style={{ color: 'var(--muted)' }}>{addon.url}</span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleCopy}
          className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all"
          style={{
            background: copied ? 'var(--green-dim)' : 'var(--accent-dim)',
            color: copied ? 'var(--green)' : 'var(--accent)',
            border: `1px solid ${copied ? 'rgba(74,222,128,0.3)' : 'var(--accent-border)'}`,
          }}
        >
          {copied ? '✓ Copiado!' : 'Copiar URL'}
        </button>
        {user?.isAdmin && (
          <>
            <button
              onClick={() => onEdit(addon.id)}
              className="px-3 py-2 rounded-xl text-xs font-medium transition-colors"
              style={{ background: 'var(--panel-2)', color: 'var(--muted)', border: '1px solid var(--border)' }}
              onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--text)')}
              onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--muted)')}
            >
              Editar
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-3 py-2 rounded-xl text-xs font-medium transition-colors"
              style={{ background: 'var(--panel-2)', color: 'var(--muted-2)', border: '1px solid var(--border)' }}
              onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#ef4444')}
              onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--muted-2)')}
              title="Deletar addon"
            >
              🗑
            </button>
          </>
        )}
      </div>
    </div>
  )
}

interface HomePageProps {
  onCreate: () => void
  onEdit: (id: string) => void
}

export function HomePage({ onCreate, onEdit }: HomePageProps) {
  const { user } = useAuth()
  const [addons, setAddons] = useState<AddonMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<ContentCategory | 'all'>('all')

  useEffect(() => {
    fetch('/api/addons')
      .then(r => r.json())
      .then(data => { setAddons(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const categories = useMemo<ContentCategory[]>(() => {
    const cats = [...new Set(addons.map(a => a.category))] as ContentCategory[]
    return cats
  }, [addons])

  const filtered = useMemo(() => addons.filter(a => {
    const matchCat = category === 'all' || a.category === category
    const q = search.toLowerCase()
    const matchSearch = !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.author.toLowerCase().includes(q)
    return matchCat && matchSearch
  }), [addons, category, search])

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">

      {/* Hero */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs mb-4"
          style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}>
          ✦ Biblioteca de Addons para o Abyss
        </div>
        <h1 className="text-4xl font-bold mb-3" style={{ color: 'var(--text)' }}>
          Abyss Library
        </h1>
        <p className="text-base max-w-md mx-auto" style={{ color: 'var(--muted)' }}>
          Navegue pelos addons disponíveis, copie a URL e cole no Abyss para adicionar conteúdo.
        </p>
        <div className="flex items-center justify-center gap-3 mt-6">
          <button
            onClick={onCreate}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--accent)', color: '#0a0a0a' }}
          >
            {user?.isAdmin ? '+ Publicar Addon' : '+ Enviar Addon'}
          </button>
          <a
            href="/api/addons"
            target="_blank"
            rel="noreferrer"
            className="px-5 py-2.5 rounded-xl text-sm font-medium mono"
            style={{ background: 'var(--panel)', color: 'var(--muted)', border: '1px solid var(--border)' }}
          >
            /api/addons
          </a>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: 'var(--muted)' }}>🔍</span>
          <input
            type="text"
            placeholder="Buscar addon..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text)' }}
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {(['all', ...categories] as const).map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat as ContentCategory | 'all')}
              className="px-3 py-2 rounded-xl text-xs font-medium transition-all"
              style={{
                background: category === cat ? 'var(--accent-dim)' : 'var(--panel)',
                color: category === cat ? 'var(--accent)' : 'var(--muted)',
                border: `1px solid ${category === cat ? 'var(--accent-border)' : 'var(--border)'}`,
              }}
            >
              {cat === 'all' ? 'Todos' : CATEGORY_LABEL[cat] ?? cat}
            </button>
          ))}
        </div>
      </div>

      {/* Stats bar */}
      <p className="text-xs mb-5" style={{ color: 'var(--muted-2)' }}>
        {filtered.length} addon{filtered.length !== 1 ? 's' : ''} encontrado{filtered.length !== 1 ? 's' : ''}
        {addons.length !== filtered.length && ` de ${addons.length} total`}
      </p>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-24" style={{ color: 'var(--muted)' }}>
          <span className="text-sm">Carregando...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <div className="text-4xl opacity-20">📦</div>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {addons.length === 0 ? 'Nenhum addon publicado ainda.' : 'Nenhum addon encontrado.'}
          </p>
          {addons.length === 0 && (
            <button onClick={onCreate} className="mt-2 text-sm font-semibold" style={{ color: 'var(--accent)' }}>
              {user?.isAdmin ? 'Publicar o primeiro →' : 'Enviar o primeiro →'}
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {filtered.map(addon => (
            <AddonCard key={addon.id} addon={addon} onEdit={onEdit} />
          ))}
        </div>
      )}
    </div>
  )
}
