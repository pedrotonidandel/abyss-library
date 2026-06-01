import { useState, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import type { DownloadItem, SeriesSeason, SeriesEpisode } from '../types'

// ─── Magnetz API result ────────────────────────────────────────────────────────

interface MagnetzResult {
  name:         string
  magnet_link:  string
  score:        number
  seeders:      number
  size:         number
  human_size:   string
  created_at:   string
  is_verified:  boolean
  largest_file: string
}

// O campo `name` da API é sempre o título da série (ex: "Breaking Bad").
// O nome real do torrent com info de episódio está em `largest_file`.
function torrentLabel(m: MagnetzResult): string {
  if (!m.largest_file) return m.name
  // pega apenas o basename do caminho
  const parts = m.largest_file.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || m.name
}

// ─── Quality extraction ───────────────────────────────────────────────────────

const QUALITY_ORDER: [RegExp, number][] = [
  [/\b2160p\b|\b4k\b|\buhd\b/i,  2160],
  [/\b1080p\b/i,                  1080],
  [/\b720p\b/i,                    720],
  [/\b480p\b/i,                    480],
  [/\b360p\b/i,                    360],
]

function extractQuality(name: string): number {
  for (const [re, q] of QUALITY_ORDER) if (re.test(name)) return q
  return 0  // unknown / XviD / etc — lowest
}

// ─── Sort results ─────────────────────────────────────────────────────────────

type SortMode = 'episode' | 'relevance'

function sortByEpisode(items: MagnetzResult[]): MagnetzResult[] {
  return [...items].sort((a, b) => {
    const pa = parseTorrentName(torrentLabel(a))
    const pb = parseTorrentName(torrentLabel(b))

    // Season: null (unknown) → pushed to end
    const sa = pa.season ?? 999
    const sb = pb.season ?? 999
    if (sa !== sb) return sa - sb

    // Within same season: packs (no episode) come first
    const ea = pa.episode ?? -1   // -1 so packs sort before ep 1
    const eb = pb.episode ?? -1
    if (ea !== eb) return ea - eb

    // Same S/E: higher quality first
    return extractQuality(b.name) - extractQuality(a.name)
  })
}

// ─── Season / episode detection ───────────────────────────────────────────────

interface ParsedTorrent {
  season:  number | null
  episode: number | null
  isPack:  boolean   // true = season pack (not an individual episode)
}

function parseTorrentName(name: string): ParsedTorrent {
  const t = name.toLowerCase()

  // S01E01 — individual episode
  const epMatch = t.match(/\bs(\d{1,2})e(\d{1,2})\b/)
  if (epMatch) return { season: +epMatch[1], episode: +epMatch[2], isPack: false }

  // S01-S05 or S01-05 — multi-season pack
  if (/\bs\d{1,2}\s*[-–]\s*s?\d{1,2}\b/.test(t))
    return { season: null, episode: null, isPack: true }

  // "Temporada N" ou "Season N"
  const wordMatch = t.match(/(?:temporada[s]?|season[s]?)\s*(\d{1,2})/)
  if (wordMatch) return { season: +wordMatch[1], episode: null, isPack: true }

  // S01 sem E — season pack
  const sMatch = t.match(/\bs(\d{1,2})\b/)
  if (sMatch) return { season: +sMatch[1], episode: null, isPack: true }

  return { season: null, episode: null, isPack: false }
}

// Badge colorido que indica o tipo detectado (pack / episódio / ?)
function SeasonBadge({ name }: { name: string }) {
  const p = parseTorrentName(name)

  const base: React.CSSProperties = {
    fontSize: 10, padding: '1px 6px', borderRadius: 4,
    fontFamily: 'monospace', flexShrink: 0, whiteSpace: 'nowrap',
  }

  if (p.isPack && p.season === null) return (
    <span style={{ ...base, background: 'rgba(234,179,8,0.15)', color: '#eab308' }}>MULTI</span>
  )
  if (p.season === null) return (
    <span style={{ ...base, color: 'var(--muted-2)' }}>?</span>
  )
  if (p.isPack) return (
    <span style={{ ...base, background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>
      S{String(p.season).padStart(2, '0')}
    </span>
  )
  return (
    <span style={{ ...base, background: 'rgba(99,102,241,0.12)', color: '#818cf8' }}>
      S{String(p.season).padStart(2, '0')}E{String(p.episode!).padStart(2, '0')}
    </span>
  )
}

// ─── JSON builder ─────────────────────────────────────────────────────────────

function buildSeriesItem(
  title: string,
  coverUrl: string,
  items: MagnetzResult[],
): DownloadItem {
  // Deduplicate by magnet_link — Magnetz API sometimes returns the same torrent
  // under different results pages or quality variants with identical links.
  const unique = [...new Map(items.map(m => [m.magnet_link, m])).values()]

  // Organise by season. Items with no detectable season go to top-level uris.
  const seasonsMap = new Map<number, { uri?: string; episodes: SeriesEpisode[] }>()
  const topUris: string[] = []

  for (const m of unique) {
    const p = parseTorrentName(torrentLabel(m))

    if (p.isPack && p.season === null) {
      // Multi-season pack — put in top-level uris
      topUris.push(m.magnet_link)
      continue
    }
    if (p.season === null) {
      topUris.push(m.magnet_link)
      continue
    }

    if (!seasonsMap.has(p.season)) seasonsMap.set(p.season, { uri: undefined, episodes: [] })
    const season = seasonsMap.get(p.season)!

    if (p.isPack) {
      // Season pack → uri of the season
      season.uri = m.magnet_link
    } else {
      // Individual episode
      season.episodes.push({
        title:      torrentLabel(m),
        uri:        m.magnet_link,
        fileSize:   m.human_size,
        uploadDate: m.created_at,
      })
    }
  }

  // Sort seasons; sort episodes within each season
  const seasons: SeriesSeason[] = [...seasonsMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([season, data]) => ({
      season,
      ...(data.uri ? { uri: data.uri } : {}),
      episodes: data.episodes.sort((a, b) => {
        const pa = parseTorrentName(a.title)
        const pb = parseTorrentName(b.title)
        return (pa.episode ?? 0) - (pb.episode ?? 0)
      }),
    }))

  return {
    title:      title || 'Série',
    uris:       topUris,
    uploadDate: new Date().toISOString(),
    fileSize:   '',
    category:   'series',
    ...(coverUrl ? { coverUrl } : {}),
    ...(seasons.length > 0 ? { seasons } : {}),
  }
}

// ─── Series Picker ────────────────────────────────────────────────────────────

interface SeriesPickerPageProps {
  addonName?: string
  onBack?: () => void
}

export function SeriesPickerPage({ addonName, onBack }: SeriesPickerPageProps) {
  const { token, user } = useAuth()

  // ── Search ────────────────────────────────────────────────────────────────────
  const [query,       setQuery]       = useState('')
  const [minScore,    setMinScore]    = useState(0)
  const [results,     setResults]     = useState<MagnetzResult[]>([])
  const [searching,   setSearching]   = useState(false)
  const [searchErr,   setSearchErr]   = useState<string | null>(null)
  const [page,        setPage]        = useState(1)
  const [hasMore,     setHasMore]     = useState(false)
  const [sortMode,    setSortMode]    = useState<SortMode>('episode')

  // ── Selection ─────────────────────────────────────────────────────────────────
  const [selectedKeys,  setSelectedKeys]  = useState<Set<string>>(new Set())
  const [selectedItems, setSelectedItems] = useState<MagnetzResult[]>([])

  // ── Builder ───────────────────────────────────────────────────────────────────
  const [seriesTitle,    setSeriesTitle]    = useState('')
  const [coverUrl,       setCoverUrl]       = useState('')
  const [showJson,       setShowJson]       = useState(false)
  const [publishing,     setPublishing]     = useState(false)
  const [publishErr,     setPublishErr]     = useState<string | null>(null)
  const [publishSuccess, setPublishSuccess] = useState(false)

  // ── Search handler ────────────────────────────────────────────────────────────

  const doSearch = useCallback(async (pageNum: number) => {
    if (!query.trim()) return
    setSearching(true)
    setSearchErr(null)
    if (pageNum === 1) setResults([])

    try {
      const r = await fetch(
        `/api/magnetz/search?q=${encodeURIComponent(query.trim())}&minScore=${minScore}&page=${pageNum}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      const data = await r.json() as { results?: MagnetzResult[]; error?: string }
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`)

      const items = data.results ?? []
      setResults(prev => pageNum === 1 ? items : [...prev, ...items])
      setHasMore(items.length >= 20)
      setPage(pageNum)
    } catch (err) {
      setSearchErr((err as Error).message)
    } finally {
      setSearching(false)
    }
  }, [query, minScore, token])

  // ── Selection helpers ─────────────────────────────────────────────────────────

  const toggle = (item: MagnetzResult) => {
    const key = item.magnet_link
    setSelectedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
        setSelectedItems(si => si.filter(i => i.magnet_link !== key))
      } else {
        next.add(key)
        setSelectedItems(si => [...si, item])
      }
      return next
    })
  }

  const removeSelected = (key: string) => {
    setSelectedKeys(prev => { const n = new Set(prev); n.delete(key); return n })
    setSelectedItems(si => si.filter(i => i.magnet_link !== key))
  }

  const clearAll = () => { setSelectedKeys(new Set()); setSelectedItems([]) }

  // ── Built JSON ────────────────────────────────────────────────────────────────

  const builtItem = selectedItems.length > 0
    ? buildSeriesItem(seriesTitle || query, coverUrl, selectedItems)
    : null

  // ── Publish ───────────────────────────────────────────────────────────────────

  const handlePublish = async () => {
    if (!builtItem) return
    setPublishing(true)
    setPublishErr(null)
    try {
      const endpoint = user?.isAdmin ? '/api/addons' : '/api/addons/submit'
      const r = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({
          name:        builtItem.title,
          description: `Série curada via Magnetz${addonName ? ` · ${addonName}` : ''}`,
          author:      user?.username ?? 'anonimo',
          category:    'series',
          downloads:   [builtItem],
        }),
      })
      const data = await r.json() as { error?: string }
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`)
      setPublishSuccess(true)
    } catch (err) {
      setPublishErr((err as Error).message)
    } finally {
      setPublishing(false)
    }
  }

  const handleDownload = () => {
    if (!builtItem) return
    const blob = new Blob([JSON.stringify([builtItem], null, 2)], { type: 'application/json' })
    const a = Object.assign(document.createElement('a'), {
      href:     URL.createObjectURL(blob),
      download: `serie-${(builtItem.title).replace(/\s+/g, '-').toLowerCase()}.json`,
    })
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // ── Styles ────────────────────────────────────────────────────────────────────

  const input: React.CSSProperties = {
    background: 'var(--panel-2)', border: '1px solid var(--border)',
    color: 'var(--text)', borderRadius: 8, padding: '8px 12px',
    fontSize: 13, outline: 'none',
  }
  const label: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 4, display: 'block',
  }
  const panel: React.CSSProperties = {
    background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14,
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 24px' }}>

      {onBack && (
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 13, marginBottom: 24, padding: 0, display: 'flex', alignItems: 'center', gap: 6 }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
        >
          ← Voltar
        </button>
      )}

      <div style={{ marginBottom: 28 }}>
        <h2 style={{ color: 'var(--text)', fontWeight: 800, fontSize: 28, margin: 0, letterSpacing: '-0.5px' }}>
          Buscar no Magnetz
        </h2>
        <p style={{ color: 'var(--muted)', fontSize: 14, margin: '6px 0 0' }}>
          Pesquise uma série pelo nome, selecione os torrents e{user?.isAdmin ? ' publique diretamente na biblioteca.' : ' envie para revisão.'}
        </p>
      </div>

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20, alignItems: 'start' }}>

      {/* ── LEFT: busca + resultados ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Search bar */}
        <div style={{ ...panel, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              style={{ ...input, flex: 1 }}
              placeholder="Nome da série — ex: Breaking Bad, Dark, Severance"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doSearch(1)}
            />
            <button
              onClick={() => doSearch(1)}
              disabled={searching || !query.trim()}
              style={{
                padding: '8px 22px', borderRadius: 8, border: 'none',
                fontSize: 13, fontWeight: 700, flexShrink: 0,
                background: (!query.trim() || searching) ? 'var(--border)' : 'var(--accent)',
                color: '#0a0a0a',
                cursor: (!query.trim() || searching) ? 'not-allowed' : 'pointer',
              }}
            >
              {searching ? 'Buscando…' : 'Buscar'}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ ...label, marginBottom: 0, flexShrink: 0 }}>
              Score mínimo: <strong style={{ color: 'var(--text)' }}>{minScore}</strong>
            </span>
            <input
              type="range" min={0} max={10} step={0.5} value={minScore}
              onChange={e => setMinScore(+e.target.value)}
              style={{ flex: 1, accentColor: 'var(--accent)' }}
            />
          </div>
        </div>

        {/* Search error */}
        {searchErr && (
          <div style={{
            padding: '10px 16px', borderRadius: 10, fontSize: 13,
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444',
          }}>
            ✗ {searchErr}
          </div>
        )}

        {/* Legend */}
        {results.length > 0 && (
          <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--muted)', alignItems: 'center', paddingLeft: 2 }}>
            <span style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace' }}>S01</span>
            <span style={{ color: 'var(--muted)' }}>= season pack (recomendado)</span>
            <span style={{ background: 'rgba(99,102,241,0.12)', color: '#818cf8', padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace' }}>S01E03</span>
            <span style={{ color: 'var(--muted)' }}>= episódio avulso</span>
            <span style={{ background: 'rgba(234,179,8,0.15)', color: '#eab308', padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace' }}>MULTI</span>
            <span style={{ color: 'var(--muted)' }}>= multi-temporada</span>
          </div>
        )}

        {/* Results list */}
        {results.length > 0 && (() => {
          const visibleResults = sortMode === 'episode' ? sortByEpisode(results) : results
          return (
          <div style={{ ...panel, overflow: 'hidden' }}>
            <div style={{
              padding: '10px 16px', borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            }}>
              <span style={{ ...label, marginBottom: 0 }}>
                {results.length} resultado{results.length !== 1 ? 's' : ''}
                {selectedKeys.size > 0 && (
                  <span style={{ color: 'var(--accent)', marginLeft: 8 }}>· {selectedKeys.size} selecionado{selectedKeys.size !== 1 ? 's' : ''}</span>
                )}
              </span>

              {/* Sort toggle */}
              <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
                {(['episode', 'relevance'] as SortMode[]).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setSortMode(mode)}
                    style={{
                      padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                      background: sortMode === mode ? 'var(--accent)' : 'transparent',
                      color: sortMode === mode ? '#0a0a0a' : 'var(--muted)',
                      border: `1px solid ${sortMode === mode ? 'var(--accent)' : 'var(--border)'}`,
                      cursor: 'pointer',
                    }}
                  >
                    {mode === 'episode' ? 'S/E + Qualidade' : 'Relevância'}
                  </button>
                ))}
              </div>

              {selectedKeys.size > 0 && (
                <button
                  onClick={clearAll}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--muted-2)', flexShrink: 0 }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#ef4444' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--muted-2)' }}
                >
                  Limpar seleção
                </button>
              )}
            </div>

            <div style={{ overflowY: 'auto', maxHeight: 540 }}>
              {visibleResults.map((item, idx) => {
                const sel = selectedKeys.has(item.magnet_link)
                return (
                  <button
                    key={idx}
                    onClick={() => toggle(item)}
                    style={{
                      width: '100%', textAlign: 'left', padding: '9px 16px',
                      background: sel ? 'rgba(214,188,102,0.06)' : 'transparent',
                      display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                      border: 'none', borderBottom: '1px solid var(--border)',
                    } as React.CSSProperties}
                    onMouseEnter={e => { if (!sel) (e.currentTarget as HTMLButtonElement).style.background = 'var(--panel-2)' }}
                    onMouseLeave={e => { if (!sel) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                  >
                    {/* Checkbox */}
                    <div style={{
                      width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                      border: `2px solid ${sel ? 'var(--accent)' : 'rgba(255,255,255,0.15)'}`,
                      background: sel ? 'var(--accent)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.1s',
                    }}>
                      {sel && <span style={{ fontSize: 9, color: '#0a0a0a', lineHeight: 1, fontWeight: 900 }}>✓</span>}
                    </div>

                    <SeasonBadge name={torrentLabel(item)} />

                    <span style={{
                      flex: 1, fontSize: 13, color: 'var(--text)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {torrentLabel(item)}
                    </span>

                    <span style={{ fontSize: 11, color: 'var(--accent)', flexShrink: 0, fontFamily: 'monospace' }}>
                      {item.score.toFixed(1)}★
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--muted-2)', flexShrink: 0, minWidth: 56, textAlign: 'right', fontFamily: 'monospace' }}>
                      {item.human_size}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--muted-2)', flexShrink: 0, minWidth: 36, textAlign: 'right', fontFamily: 'monospace' }}>
                      {item.seeders}↑
                    </span>
                  </button>
                )
              })}

              {hasMore && (
                <div style={{ padding: 12, textAlign: 'center' }}>
                  <button
                    onClick={() => doSearch(page + 1)}
                    disabled={searching}
                    style={{
                      padding: '7px 24px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                      background: 'var(--panel-2)', color: 'var(--muted)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    {searching ? 'Carregando…' : 'Carregar mais'}
                  </button>
                </div>
              )}
            </div>
          </div>
          )
        })()}

        {!searching && results.length === 0 && query.trim() && !searchErr && (
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--muted)', fontSize: 13 }}>
            Nenhum resultado verificado para "{query}"
          </div>
        )}
      </div>

      {/* ── RIGHT: builder ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 78 }}>

        {/* Série metadata */}
        <div style={{ ...panel, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span style={label}>Configurar série</span>

          <div>
            <label style={label}>Título</label>
            <input
              style={{ ...input, width: '100%' }}
              placeholder={query || 'Nome da série'}
              value={seriesTitle}
              onChange={e => setSeriesTitle(e.target.value)}
            />
          </div>

          <div>
            <label style={label}>Cover URL (opcional)</label>
            <input
              style={{ ...input, width: '100%' }}
              placeholder="https://image.tmdb.org/..."
              value={coverUrl}
              onChange={e => setCoverUrl(e.target.value)}
            />
          </div>
        </div>

        {/* Itens selecionados */}
        <div style={{ ...panel, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ ...label, marginBottom: 0 }}>Selecionados ({selectedItems.length})</span>
            {selectedItems.length > 0 && (
              <button
                onClick={clearAll}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--muted-2)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#ef4444' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--muted-2)' }}
              >
                Limpar
              </button>
            )}
          </div>

          {selectedItems.length === 0 ? (
            <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--muted-2)', fontSize: 12 }}>
              Clique nos resultados para selecionar
            </div>
          ) : (
            <div style={{ overflowY: 'auto', maxHeight: 260 }}>
              {selectedItems.map((item, idx) => (
                <div key={idx} style={{
                  padding: '7px 14px', borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <SeasonBadge name={torrentLabel(item)} />
                  <span style={{
                    flex: 1, fontSize: 12, color: 'var(--text)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {torrentLabel(item)}
                  </span>
                  <button
                    onClick={() => removeSelected(item.magnet_link)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted-2)', fontSize: 15, lineHeight: 1, padding: 2, flexShrink: 0 }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#ef4444' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--muted-2)' }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Prévia da estrutura de seasons */}
        {builtItem && (builtItem.seasons?.length ?? 0) > 0 && (
          <div style={{ ...panel, padding: 16 }}>
            <span style={{ ...label, marginBottom: 10 }}>Estrutura detectada</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {builtItem.seasons!.map(s => (
                <div key={s.season} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontSize: 11, fontFamily: 'monospace', fontWeight: 700,
                    background: 'rgba(34,197,94,0.12)', color: '#22c55e',
                    padding: '1px 6px', borderRadius: 4, flexShrink: 0,
                  }}>
                    T{String(s.season).padStart(2, '0')}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {s.uri ? 'pack' : ''}
                    {s.uri && s.episodes.length > 0 ? ' + ' : ''}
                    {s.episodes.length > 0 ? `${s.episodes.length} episódio${s.episodes.length !== 1 ? 's' : ''}` : ''}
                  </span>
                </div>
              ))}
              {(builtItem.uris?.length ?? 0) > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, fontFamily: 'monospace', background: 'rgba(234,179,8,0.12)', color: '#eab308', padding: '1px 6px', borderRadius: 4 }}>
                    MULTI
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {builtItem.uris.length} magnet{builtItem.uris.length !== 1 ? 's' : ''} sem temporada
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* JSON preview (colapsável) */}
        {builtItem && (
          <div style={{ ...panel, overflow: 'hidden' }}>
            <button
              onClick={() => setShowJson(p => !p)}
              style={{
                width: '100%', padding: '10px 16px', background: 'none', border: 'none',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <span style={{ ...label, marginBottom: 0 }}>Preview JSON</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{showJson ? '▲ fechar' : '▼ ver'}</span>
            </button>
            {showJson && (
              <pre style={{
                margin: 0, padding: '0 14px 14px',
                fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace',
                lineHeight: 1.55, overflowX: 'auto', maxHeight: 200, overflowY: 'auto',
              }}>
                {JSON.stringify(builtItem, null, 2)}
              </pre>
            )}
          </div>
        )}

        {/* Ações */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={handleDownload}
            disabled={!builtItem}
            style={{
              padding: '10px 0', borderRadius: 9, fontSize: 13, fontWeight: 600,
              background: builtItem ? 'var(--panel-2)' : 'var(--border)',
              color: builtItem ? 'var(--muted)' : 'var(--muted-2)',
              border: '1px solid var(--border)',
              cursor: builtItem ? 'pointer' : 'not-allowed',
            }}
            onMouseEnter={e => { if (builtItem) (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)' }}
            onMouseLeave={e => { if (builtItem) (e.currentTarget as HTMLButtonElement).style.color = 'var(--muted)' }}
          >
            ↓ Baixar JSON
          </button>

          <button
            onClick={handlePublish}
            disabled={!builtItem || publishing || publishSuccess}
            style={{
              padding: '10px 0', borderRadius: 9, fontSize: 13, fontWeight: 700,
              border: 'none',
              background: publishSuccess
                ? 'rgba(34,197,94,0.2)'
                : (!builtItem || publishing) ? 'var(--border)' : 'var(--accent)',
              color: publishSuccess ? '#22c55e' : (!builtItem || publishing) ? 'var(--muted-2)' : '#0a0a0a',
              cursor: (!builtItem || publishing || publishSuccess) ? 'not-allowed' : 'pointer',
              opacity: publishing ? 0.7 : 1,
            }}
          >
            {publishing ? 'Enviando…'
              : publishSuccess
                ? (user?.isAdmin ? '✓ Publicado na biblioteca' : '✓ Enviado para revisão')
                : (user?.isAdmin ? 'Publicar na biblioteca' : 'Enviar para revisão')}
          </button>

          {publishErr && (
            <p style={{ fontSize: 12, color: '#ef4444', textAlign: 'center', margin: 0 }}>{publishErr}</p>
          )}
        </div>
      </div>
    </div>
    </div>
  )
}
