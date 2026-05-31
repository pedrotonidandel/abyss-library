#!/usr/bin/env node
/**
 * build-magnetz-source.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Gera um JSON de "Source" do Abyss buscando títulos populares na TMDB/RAWG e
 * encontrando seus magnets no Magnetz.
 *
 * COMO RODAR (Node 18+):
 *   node scripts/build-magnetz-source.mjs [flags]
 *
 * FLAGS:
 *   --categories=movies,series,animes,games   (padrão: movies,series,animes)
 *   --pages=3                                 (padrão: 2 — 20 títulos/página TMDB)
 *   --out=./abyss-sources.json                (padrão: ./abyss-sources.json)
 *   --min-score=5                             (padrão: 0)
 *   --tmdb-key=xxx   ou env TMDB_API_KEY
 *   --rawg-key=xxx   ou env RAWG_API_KEY
 *   --magnetz-delay=8000   ms entre requests ao Magnetz (padrão: 8000)
 *   --resume                                  retoma de .build-cache.json
 */

import fs   from 'node:fs/promises'
import path from 'node:path'

// ─── CLI args ─────────────────────────────────────────────────────────────────

const argv = Object.fromEntries(
  process.argv.slice(2).flatMap((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/)
    return m ? [[m[1], m[2] ?? true]] : []
  }),
)

const TMDB_KEY   = process.env.TMDB_API_KEY ?? argv['tmdb-key']
const RAWG_KEY   = process.env.RAWG_API_KEY ?? argv['rawg-key']
const CATEGORIES = (argv['categories'] ?? 'movies,series,animes').split(',').map(s => s.trim()).filter(Boolean)
const PAGES      = Math.max(1, Number(argv['pages']  ?? 2))
const OUT_PATH   = path.resolve(argv['out']   ?? './abyss-sources.json')
const MIN_SCORE  = Number(argv['min-score'] ?? 0)
const RESUME     = !!argv['resume']
const CACHE_PATH = path.resolve('.build-cache.json')

// Magnetz tem rate limit pouco documentado. 8s entre requests é seguro;
// reduza para 5s se quiser mais velocidade, mas não menos que isso.
const MAGNETZ_DELAY_MS = Math.max(3000, Number(argv['magnetz-delay'] ?? 8000))

// TMDB suporta ~40 req/10s com API key — 300ms é conservador e seguro.
const TMDB_DELAY_MS = 300

if (!TMDB_KEY && CATEGORIES.some(c => c !== 'games')) {
  console.error('[erro] TMDB_API_KEY é necessário para movies/series/animes.')
  process.exit(1)
}
if (!RAWG_KEY && CATEGORIES.includes('games')) {
  console.error('[erro] RAWG_API_KEY é necessário para games.')
  process.exit(1)
}

// ─── Rate limiter por API ─────────────────────────────────────────────────────
// Um RateLimiter por host garante que TMDB e Magnetz tenham filas separadas.
// Implementa um "token bucket" simples com execução sequencial via fila.

class RateLimiter {
  #delayMs
  #queue = []
  #running = false

  constructor(delayMs) {
    this.#delayMs = delayMs
  }

  /** Enfileira uma função e retorna sua Promise. */
  run(fn) {
    return new Promise((resolve, reject) => {
      this.#queue.push({ fn, resolve, reject })
      this.#drain()
    })
  }

  async #drain() {
    if (this.#running) return
    this.#running = true
    while (this.#queue.length > 0) {
      const { fn, resolve, reject } = this.#queue.shift()
      try {
        resolve(await fn())
      } catch (err) {
        reject(err)
      }
      if (this.#queue.length > 0) {
        await sleep(this.#delayMs)
      }
    }
    this.#running = false
  }
}

const tmdbLimiter     = new RateLimiter(TMDB_DELAY_MS)
const magnetzLimiter  = new RateLimiter(MAGNETZ_DELAY_MS)

// ─── Fetch helpers ────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

/**
 * Faz fetch com retry automático para 429 e 5xx.
 * - 429: respeita Retry-After (se presente) ou usa backoff exponencial.
 * - 5xx: até MAX_RETRIES tentativas com backoff crescente.
 */
async function fetchJson(url, { retries = 5, baseBackoffMs = 15_000 } = {}) {
  let attempt = 0
  while (true) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })

    if (res.ok) return res.json()

    if (res.status === 429) {
      const retryAfter = res.headers.get('retry-after')
      const waitMs = retryAfter
        ? (Number.isFinite(+retryAfter)
            ? +retryAfter * 1000          // valor em segundos
            : new Date(retryAfter).getTime() - Date.now()) // data absoluta
        : baseBackoffMs * Math.pow(2, attempt)

      const waitSafe = Math.max(5_000, Math.min(waitMs, 120_000))
      console.warn(`\n  [429] aguardando ${(waitSafe / 1000).toFixed(0)}s antes de tentar novamente (${url.split('?')[0]})`)
      await sleep(waitSafe)
      attempt++
      continue
    }

    if (res.status >= 500 && attempt < retries) {
      const wait = baseBackoffMs * Math.pow(2, attempt)
      console.warn(`\n  [${res.status}] erro no servidor, aguardando ${(wait / 1000).toFixed(0)}s...`)
      await sleep(wait)
      attempt++
      continue
    }

    throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`)
  }
}

// ─── TMDB ─────────────────────────────────────────────────────────────────────

const TMDB = 'https://api.themoviedb.org/3'

const tmdbGet = (endpoint) =>
  tmdbLimiter.run(() => fetchJson(`${TMDB}${endpoint}`))

function normMovie(m) {
  return {
    title: m.title,
    originalTitle: m.original_title,
    year: m.release_date ? +m.release_date.slice(0, 4) : null,
    tmdbId: m.id,
    posterUrl: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
    category: 'movies',
  }
}

function normTv(s, category) {
  return {
    title: s.name,
    originalTitle: s.original_name,
    year: s.first_air_date ? +s.first_air_date.slice(0, 4) : null,
    tmdbId: s.id,
    posterUrl: s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : null,
    category,
  }
}

async function fetchTmdbMovies(pages) {
  const out = []
  for (let p = 1; p <= pages; p++) {
    const data = await tmdbGet(`/movie/popular?api_key=${TMDB_KEY}&language=pt-BR&page=${p}`)
    out.push(...(data.results ?? []).map(normMovie))
  }
  return out
}

async function fetchTmdbSeries(pages) {
  const out = []
  for (let p = 1; p <= pages; p++) {
    const data = await tmdbGet(`/tv/popular?api_key=${TMDB_KEY}&language=pt-BR&page=${p}`)
    out.push(...(data.results ?? []).map(s => normTv(s, 'series')))
  }
  return out
}

async function fetchTmdbAnimes(pages) {
  const out = []
  for (let p = 1; p <= pages; p++) {
    const data = await tmdbGet(
      `/discover/tv?api_key=${TMDB_KEY}&with_genres=16&with_origin_country=JP&language=pt-BR&page=${p}&sort_by=popularity.desc`,
    )
    out.push(...(data.results ?? []).map(s => normTv(s, 'animes')))
  }
  return out
}

async function fetchRawgGames(pages) {
  const out = []
  for (let p = 1; p <= pages; p++) {
    const data = await tmdbLimiter.run(() =>
      fetchJson(`https://api.rawg.io/api/games?key=${RAWG_KEY}&page=${p}&page_size=20&ordering=-rating`),
    )
    for (const g of data.results ?? []) {
      out.push({
        title: g.name, originalTitle: g.name,
        year: g.released ? +g.released.slice(0, 4) : null,
        tmdbId: null, posterUrl: g.background_image ?? null,
        category: 'games',
      })
    }
  }
  return out
}

// ─── Magnetz ──────────────────────────────────────────────────────────────────

const MAGNETZ = 'https://magnetz.eu/api'

async function magnetzSearch(query) {
  const url = `${MAGNETZ}/magnets/search?query=${encodeURIComponent(query)}&page=1`
  const data = await magnetzLimiter.run(() => fetchJson(url))
  return (data.data ?? []).filter(m => m.is_verified === true && m.score >= MIN_SCORE)
}

function pickBest(magnets) {
  if (!magnets.length) return null
  return [...magnets].sort((a, b) =>
    b.score !== a.score ? b.score - a.score :
    b.seeders !== a.seeders ? b.seeders - a.seeders :
    b.size - a.size,
  )[0]
}

/**
 * Estratégia de busca — ordem do mais específico ao mais genérico.
 * Para na PRIMEIRA query que retornar resultado verificado.
 * Isso evita disparar 3× mais requests desnecessários.
 */
function buildQueries(item) {
  const queries = []

  // 1ª tentativa: título PT-BR + ano (mais preciso)
  if (item.year) queries.push(`${item.title} ${item.year}`)

  // 2ª tentativa: título PT-BR sem ano
  queries.push(item.title)

  // 3ª tentativa: título original (só se diferente e não for japonês/chinês/árabe etc.)
  const orig = item.originalTitle
  if (orig && orig !== item.title && /^[\x20-\x7E]+$/.test(orig)) {
    queries.push(orig)
  }

  // Remove duplicatas mantendo ordem
  return [...new Set(queries)]
}

async function findBestMagnet(item) {
  for (const query of buildQueries(item)) {
    let magnets
    try {
      magnets = await magnetzSearch(query)
    } catch (err) {
      // 404 = sem resultados; qualquer outro erro: loga e passa para a próxima query
      if (!err.message.includes('404')) {
        console.warn(`\n  [warn] magnetz falhou em "${query}": ${err.message}`)
      }
      continue
    }

    const best = pickBest(magnets)
    if (best) return { magnet: best, query }
  }
  return null
}

// ─── Progresso / cache ────────────────────────────────────────────────────────

async function loadCache() {
  if (!RESUME) return {}
  try {
    const raw = await fs.readFile(CACHE_PATH, 'utf8')
    const cache = JSON.parse(raw)
    console.log(`[resume] cache carregado com ${Object.keys(cache).length} entradas`)
    return cache
  } catch {
    return {}
  }
}

async function saveCache(cache) {
  await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8')
}

// ─── Montagem do source ───────────────────────────────────────────────────────

function buildDownloadItem(item, magnet) {
  const typeMap = { movies: 'movie', series: 'serie', animes: 'anime', games: 'game', books: 'book' }
  return {
    title:      item.title,
    uris:       [magnet.magnet_link],
    uploadDate: magnet.created_at ?? new Date().toISOString(),
    fileSize:   magnet.human_size ?? '',
    type:       typeMap[item.category],
    coverUrl:   item.posterUrl ?? undefined,
    ...(item.tmdbId ? { tmdbId: item.tmdbId } : {}),
  }
}

// ─── Pipeline por categoria ───────────────────────────────────────────────────

async function buildSourceForCategory(category, cache) {
  console.log(`\n── ${category} ${'─'.repeat(50 - category.length)}`)

  let items = []
  if (category === 'movies')  items = await fetchTmdbMovies(PAGES)
  else if (category === 'series')  items = await fetchTmdbSeries(PAGES)
  else if (category === 'animes')  items = await fetchTmdbAnimes(PAGES)
  else if (category === 'games')   items = await fetchRawgGames(PAGES)
  else { console.warn(`[warn] categoria desconhecida: ${category}`); return null }

  console.log(`  ${items.length} títulos · Magnetz delay: ${MAGNETZ_DELAY_MS / 1000}s/req · est. ${Math.ceil(items.length * MAGNETZ_DELAY_MS / 60_000)} min`)

  const downloads = []
  let matched = 0, missed = 0, cached = 0

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const cacheKey = `${category}:${item.tmdbId ?? item.title}`

    // Progresso em linha
    process.stdout.write(`\r  [${i + 1}/${items.length}] ${item.title.slice(0, 40).padEnd(40)}`)

    // Retoma do cache
    if (RESUME && cacheKey in cache) {
      const cached_item = cache[cacheKey]
      if (cached_item) downloads.push(cached_item)
      cached++
      continue
    }

    const hit = await findBestMagnet(item)

    if (hit) {
      const dl = buildDownloadItem(item, hit.magnet)
      downloads.push(dl)
      cache[cacheKey] = dl
      matched++
    } else {
      cache[cacheKey] = null   // null = "buscado, sem resultado"
      missed++
    }

    // Salva cache a cada 10 títulos para não perder progresso
    if ((i + 1) % 10 === 0) await saveCache(cache)
  }

  console.log(`\n  ✓ ${matched} encontrados · ${missed} sem magnet verificado · ${cached} do cache`)

  if (!downloads.length) return null

  return {
    id:       `magnetz-${category}-${Date.now()}`,
    name:     `Magnetz · ${category[0].toUpperCase()}${category.slice(1)}`,
    category,
    addedAt:  new Date().toISOString(),
    downloads,
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

;(async () => {
  console.log('Abyss × Magnetz — build de source')
  console.log(`  categorias : ${CATEGORIES.join(', ')}`)
  console.log(`  páginas    : ${PAGES} (~${PAGES * 20} títulos/cat)`)
  console.log(`  delay      : ${MAGNETZ_DELAY_MS / 1000}s entre requests ao Magnetz`)
  console.log(`  min score  : ${MIN_SCORE}`)
  console.log(`  saída      : ${OUT_PATH}`)
  if (RESUME) console.log(`  modo       : retomando de cache`)

  const cache = await loadCache()
  const sources = []

  for (const cat of CATEGORIES) {
    const src = await buildSourceForCategory(cat, cache)
    if (src) sources.push(src)
  }

  // Salva cache final
  await saveCache(cache)

  // Escreve output
  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true })
  await fs.writeFile(OUT_PATH, JSON.stringify(sources, null, 2), 'utf8')

  const total = sources.reduce((n, s) => n + s.downloads.length, 0)
  console.log(`\n✓ ${sources.length} source(s), ${total} downloads → ${OUT_PATH}`)
  console.log(`  Para importar: Abyss → Ajustes → Downloads → Fontes → URL/Arquivo`)
})().catch(err => { console.error('\n[fatal]', err.message); process.exit(1) })
