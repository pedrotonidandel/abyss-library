import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

const app = express()
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3777
const API_KEY = process.env.API_KEY ?? 'dev-key'
const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`

const DATA_DIR = path.join(process.cwd(), 'data')
const ADDONS_DIR = path.join(DATA_DIR, 'addons')
const META_DIR = path.join(DATA_DIR, 'meta')

for (const dir of [DATA_DIR, ADDONS_DIR, META_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

app.use(cors())
app.use(express.json({ limit: '50mb' }))

// ── Types ──────────────────────────────────────────────────────────────────────

interface AddonMeta {
  id: string
  name: string
  description: string
  author: string
  category: string
  itemCount: number
  createdAt: string
  updatedAt: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function readMeta(id: string): AddonMeta | null {
  const file = path.join(META_DIR, `${id}.json`)
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

function writeMeta(meta: AddonMeta) {
  fs.writeFileSync(path.join(META_DIR, `${meta.id}.json`), JSON.stringify(meta, null, 2))
}

function writeAddon(id: string, data: object) {
  fs.writeFileSync(path.join(ADDONS_DIR, `${id}.json`), JSON.stringify(data, null, 2))
}

function listAllMeta(): AddonMeta[] {
  if (!fs.existsSync(META_DIR)) return []
  return fs.readdirSync(META_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(META_DIR, f), 'utf-8')) as AddonMeta)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

function requireKey(req: express.Request, res: express.Response): boolean {
  const key = req.headers['x-api-key'] ?? req.query['key']
  if (key !== API_KEY) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}

// ── Routes ────────────────────────────────────────────────────────────────────

// List all addons (public)
app.get('/api/addons', (_req, res) => {
  const list = listAllMeta().map(m => ({
    ...m,
    url: `${PUBLIC_URL}/api/addons/${m.id}`,
  }))
  res.json(list)
})

// Get single addon JSON in Abyss format (public) — this is the URL users copy
app.get('/api/addons/:id', (req, res) => {
  const file = path.join(ADDONS_DIR, `${req.params.id}.json`)
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' })
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.sendFile(file)
})

// Create addon (protected)
app.post('/api/addons', (req, res) => {
  if (!requireKey(req, res)) return

  const { name, description, author, category, downloads } = req.body as {
    name: string
    description: string
    author: string
    category: string
    downloads: unknown[]
  }

  if (!name || !Array.isArray(downloads) || downloads.length === 0) {
    return res.status(400).json({ error: 'name and downloads[] are required' })
  }

  const id = uuidv4()
  const now = new Date().toISOString()

  const meta: AddonMeta = {
    id, name,
    description: description ?? '',
    author: author ?? 'Anônimo',
    category: category ?? 'mixed',
    itemCount: downloads.length,
    createdAt: now,
    updatedAt: now,
  }

  writeMeta(meta)
  writeAddon(id, { name, downloads })

  res.status(201).json({
    ...meta,
    url: `${PUBLIC_URL}/api/addons/${id}`,
  })
})

// Update addon (protected)
app.put('/api/addons/:id', (req, res) => {
  if (!requireKey(req, res)) return

  const existing = readMeta(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Not found' })

  const { name, description, author, category, downloads } = req.body as {
    name?: string
    description?: string
    author?: string
    category?: string
    downloads?: unknown[]
  }

  const updated: AddonMeta = {
    ...existing,
    name: name ?? existing.name,
    description: description ?? existing.description,
    author: author ?? existing.author,
    category: category ?? existing.category,
    itemCount: downloads ? downloads.length : existing.itemCount,
    updatedAt: new Date().toISOString(),
  }

  writeMeta(updated)
  if (downloads) writeAddon(req.params.id, { name: updated.name, downloads })

  res.json({ ...updated, url: `${PUBLIC_URL}/api/addons/${req.params.id}` })
})

// Delete addon (protected)
app.delete('/api/addons/:id', (req, res) => {
  if (!requireKey(req, res)) return

  const metaFile = path.join(META_DIR, `${req.params.id}.json`)
  const addonFile = path.join(ADDONS_DIR, `${req.params.id}.json`)

  if (!fs.existsSync(metaFile)) return res.status(404).json({ error: 'Not found' })

  fs.unlinkSync(metaFile)
  if (fs.existsSync(addonFile)) fs.unlinkSync(addonFile)

  res.json({ ok: true })
})

// Health
app.get('/api/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }))

app.listen(PORT, () => {
  console.log(`Abyss Library API running on http://localhost:${PORT}`)
  console.log(`API_KEY: ${API_KEY}`)
})
