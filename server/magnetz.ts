/**
 * server/magnetz.ts
 * Lógica de build de source Magnetz — usada tanto pela rota SSE do servidor
 * quanto (antes) pelo script CLI. Recebe um callback `onEvent` para stremar
 * progresso em tempo real.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BuildParams {
  categories:    string[]
  pages:         number
  minScore:      number
  magnetzDelay:  number   // ms entre requests ao Magnetz
  tmdbKey:       string
  rawgKey?:      string
}

export type BuildEvent =
  | { type: 'info';     message: string }
  | { type: 'category'; category: string; total: number }
  | { type: 'item';     index: number; total: number; title: string; status: 'found' | 'missed'; score?: number; size?: string }
  | { type: 'warn';     message: string }
  | { type: 'done';     sources: Source[] }
  | { type: 'error';    message: string }

interface CatalogItem {
  title:         string
  originalTitle: string
  year:          number | null
  tmdbId:        number | null
  posterUrl:     string | null
  category:      string
}

interface DownloadItem {
  title:      string
  uris:       string[]
  uploadDate: string
  fileSize:   string
  type:       string
  coverUrl?:  string
  tmdbId?:    number
}

interface Source {
  id:        string
  name:      string
  category:  string
  addedAt:   string
  downloads: DownloadItem[]
}

// ─── Rate limiter (queue sequencial por API) ──────────────────────────────────

class RateLimiter {
  private delayMs: number
  private queue: Array<{ fn: () => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void }> = []
  private running = false

  constructor(delayMs: number) { this.delayMs = delayMs }

  run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn: fn as () => Promise<unknown>, resolve: resolve as (v: unknown) => void, reject })
      this.drain()
    })
  }

  private async drain() {
    if (this.running) return
    this.running = true
    while (this.queue.length > 0) {
      const { fn, resolve, reject } = this.queue.shift()!
      try { resolve(await fn()) } catch (err) { reject(err) }
      if (this.queue.length > 0) await sleep(this.delayMs)
    }
    this.running = false
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function fetchJson<T>(url: string, baseBackoff = 15_000): Promise<T> {
  let attempt = 0
  while (true) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })

    if (res.ok) return res.json() as Promise<T>

    if (res.status === 429) {
      const ra = res.headers.get('retry-after')
      const wait = ra
        ? (isFinite(+ra) ? +ra * 1000 : new Date(ra).getTime() - Date.now())
        : baseBackoff * Math.pow(2, attempt)
      await sleep(Math.max(5_000, Math.min(wait, 120_000)))
      attempt++
      continue
    }

    if (res.status >= 500 && attempt < 5) {
      await sleep(baseBackoff * Math.pow(2, attempt))
      attempt++
      continue
    }

    throw new Error(`HTTP ${res.status} — ${url.split('?')[0]}`)
  }
}

// ─── TMDB ─────────────────────────────────────────────────────────────────────

async function fetchTmdbMovies(pages: number, key: string, limiter: RateLimiter): Promise<CatalogItem[]> {
  const out: CatalogItem[] = []
  for (let p = 1; p <= pages; p++) {
    const data = await limiter.run(() => fetchJson<{ results?: Record<string, unknown>[] }>(
      `https://api.themoviedb.org/3/movie/popular?api_key=${key}&language=pt-BR&page=${p}`,
    ))
    for (const m of data.results ?? []) out.push({
      title: m.title as string,
      originalTitle: m.original_title as string,
      year: m.release_date ? +(m.release_date as string).slice(0, 4) : null,
      tmdbId: m.id as number,
      posterUrl: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
      category: 'movies',
    })
  }
  return out
}

async function fetchTmdbSeries(pages: number, key: string, limiter: RateLimiter): Promise<CatalogItem[]> {
  const out: CatalogItem[] = []
  for (let p = 1; p <= pages; p++) {
    const data = await limiter.run(() => fetchJson<{ results?: Record<string, unknown>[] }>(
      `https://api.themoviedb.org/3/tv/popular?api_key=${key}&language=pt-BR&page=${p}`,
    ))
    for (const s of data.results ?? []) out.push({
      title: s.name as string,
      originalTitle: s.original_name as string,
      year: s.first_air_date ? +(s.first_air_date as string).slice(0, 4) : null,
      tmdbId: s.id as number,
      posterUrl: s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : null,
      category: 'series',
    })
  }
  return out
}

async function fetchTmdbAnimes(pages: number, key: string, limiter: RateLimiter): Promise<CatalogItem[]> {
  const out: CatalogItem[] = []
  for (let p = 1; p <= pages; p++) {
    const data = await limiter.run(() => fetchJson<{ results?: Record<string, unknown>[] }>(
      `https://api.themoviedb.org/3/discover/tv?api_key=${key}&with_genres=16&with_origin_country=JP&language=pt-BR&page=${p}&sort_by=popularity.desc`,
    ))
    for (const s of data.results ?? []) out.push({
      title: s.name as string,
      originalTitle: s.original_name as string,
      year: s.first_air_date ? +(s.first_air_date as string).slice(0, 4) : null,
      tmdbId: s.id as number,
      posterUrl: s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : null,
      category: 'animes',
    })
  }
  return out
}

async function fetchRawgGames(pages: number, key: string, limiter: RateLimiter): Promise<CatalogItem[]> {
  const out: CatalogItem[] = []
  for (let p = 1; p <= pages; p++) {
    const data = await limiter.run(() => fetchJson<{ results?: Record<string, unknown>[] }>(
      `https://api.rawg.io/api/games?key=${key}&page=${p}&page_size=20&ordering=-rating`,
    ))
    for (const g of data.results ?? []) out.push({
      title: g.name as string,
      originalTitle: g.name as string,
      year: g.released ? +(g.released as string).slice(0, 4) : null,
      tmdbId: null,
      posterUrl: (g.background_image as string | null) ?? null,
      category: 'games',
    })
  }
  return out
}

// ─── Magnetz ──────────────────────────────────────────────────────────────────

export interface MagnetzMagnet {
  name:        string
  magnet_link: string
  is_verified: boolean
  score:       number
  seeders:     number
  size:        number
  human_size:  string
  created_at:  string
}

async function magnetzSearch(query: string, minScore: number, limiter: RateLimiter): Promise<MagnetzMagnet[]> {
  const data = await limiter.run(() => fetchJson<{ data?: MagnetzMagnet[] }>(
    `https://magnetz.eu/api/magnets/search?query=${encodeURIComponent(query)}&page=1`,
  ))
  return (data.data ?? []).filter(m => m.is_verified && m.score >= minScore)
}

function pickBest(magnets: MagnetzMagnet[]) {
  if (!magnets.length) return null
  return [...magnets].sort((a, b) =>
    b.score !== a.score ? b.score - a.score :
    b.seeders !== a.seeders ? b.seeders - a.seeders :
    b.size - a.size,
  )[0]
}

function buildQueries(item: CatalogItem): string[] {
  const qs: string[] = []
  if (item.year) qs.push(`${item.title} ${item.year}`)
  qs.push(item.title)
  const orig = item.originalTitle
  if (orig && orig !== item.title && /^[\x20-\x7E]+$/.test(orig)) qs.push(orig)
  return [...new Set(qs)]
}

async function findBestMagnet(item: CatalogItem, minScore: number, limiter: RateLimiter, onWarn: (m: string) => void) {
  for (const query of buildQueries(item)) {
    let magnets: MagnetzMagnet[]
    try {
      magnets = await magnetzSearch(query, minScore, limiter)
    } catch (err) {
      const msg = (err as Error).message
      if (!msg.includes('404')) onWarn(`magnetz falhou em "${query}": ${msg}`)
      continue
    }
    const best = pickBest(magnets)
    if (best) return best
  }
  return null
}

// ─── Main build function ──────────────────────────────────────────────────────

export async function buildMagnetzSource(
  params:  BuildParams,
  onEvent: (e: BuildEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { categories, pages, minScore, magnetzDelay, tmdbKey, rawgKey } = params

  const tmdbLimiter    = new RateLimiter(300)
  const magnetzLimiter = new RateLimiter(magnetzDelay)
  const typeMap: Record<string, string> = {
    movies: 'movie', series: 'serie', animes: 'anime', games: 'game',
  }

  onEvent({ type: 'info', message: `Iniciando build: ${categories.join(', ')} · ${pages} página(s) · delay ${magnetzDelay}ms` })

  const sources: Source[] = []

  for (const category of categories) {
    if (signal?.aborted) break

    let items: CatalogItem[] = []
    try {
      if (category === 'movies')  items = await fetchTmdbMovies(pages, tmdbKey, tmdbLimiter)
      else if (category === 'series')  items = await fetchTmdbSeries(pages, tmdbKey, tmdbLimiter)
      else if (category === 'animes')  items = await fetchTmdbAnimes(pages, tmdbKey, tmdbLimiter)
      else if (category === 'games') {
        if (!rawgKey) { onEvent({ type: 'warn', message: 'rawgKey ausente — pulando games' }); continue }
        items = await fetchRawgGames(pages, rawgKey, tmdbLimiter)
      } else {
        onEvent({ type: 'warn', message: `Categoria desconhecida: ${category}` })
        continue
      }
    } catch (err) {
      onEvent({ type: 'error', message: `Erro ao buscar catálogo ${category}: ${(err as Error).message}` })
      continue
    }

    onEvent({ type: 'category', category, total: items.length })

    const downloads: DownloadItem[] = []

    for (let i = 0; i < items.length; i++) {
      if (signal?.aborted) break
      const item = items[i]

      const magnet = await findBestMagnet(item, minScore, magnetzLimiter,
        (msg) => onEvent({ type: 'warn', message: msg }),
      ).catch((err) => {
        onEvent({ type: 'warn', message: `${item.title}: ${(err as Error).message}` })
        return null
      })

      if (magnet) {
        downloads.push({
          title:      item.title,
          uris:       [magnet.magnet_link],
          uploadDate: magnet.created_at ?? new Date().toISOString(),
          fileSize:   magnet.human_size ?? '',
          type:       typeMap[category] ?? category,
          ...(item.posterUrl ? { coverUrl: item.posterUrl } : {}),
          ...(item.tmdbId    ? { tmdbId: item.tmdbId }     : {}),
        })
        onEvent({ type: 'item', index: i + 1, total: items.length, title: item.title, status: 'found', score: magnet.score, size: magnet.human_size })
      } else {
        onEvent({ type: 'item', index: i + 1, total: items.length, title: item.title, status: 'missed' })
      }
    }

    if (downloads.length > 0) {
      sources.push({
        id:       `magnetz-${category}-${Date.now()}`,
        name:     `Magnetz · ${category[0].toUpperCase()}${category.slice(1)}`,
        category,
        addedAt:  new Date().toISOString(),
        downloads,
      })
    }
  }

  onEvent({ type: 'done', sources })
}
