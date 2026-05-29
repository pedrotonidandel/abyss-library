// Load .env — use explicit path so it works regardless of CWD
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
const __dirname_env = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname_env, '..', '.env') })

import express from 'express'
import cors from 'cors'
import path from 'path'
import { MongoClient, type Db } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'

const app = express()
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3777
const API_KEY = process.env.API_KEY ?? 'dev-key'
const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`
const MONGO_URI = process.env.MONGODB_URI ?? ''
const ABYSS_API_URL = process.env.ABYSS_API_URL ?? 'http://localhost:3000'

console.log(`[init] MONGODB_URI set: ${!!MONGO_URI}`)
console.log(`[init] ABYSS_API_URL: ${ABYSS_API_URL}`)

// ── DB connection ──────────────────────────────────────────────────────────────

let db: Db | null = null
let dbReady = false

async function connectDb() {
  if (!MONGO_URI) {
    console.warn('[db] MONGODB_URI not set — database features disabled')
    return
  }
  try {
    const client = new MongoClient(MONGO_URI)
    await client.connect()
    db = client.db()
    dbReady = true
    console.log('[db] MongoDB connected')
  } catch (err) {
    console.error('[db] MongoDB connection failed:', (err as Error).message)
    console.warn('[db] Continuing without database — addon endpoints will fail gracefully')
  }
}

function requireDb(res: express.Response): boolean {
  if (!dbReady || !db) {
    res.status(503).json({ error: 'Database unavailable' })
    return false
  }
  return true
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface AddonDoc {
  _id: string
  name: string
  description: string
  author: string
  category: string
  itemCount: number
  createdAt: string
  updatedAt: string
  downloads: unknown[]
}

interface PendingAddonDoc {
  _id: string
  name: string
  description: string
  category: string
  downloads: unknown[]
  itemCount: number
  submittedAt: string
  submittedBy: string  // username of submitter
  userId: number       // abyss user ID
}

// ── Middleware ─────────────────────────────────────────────────────────────────

app.use(cors())
app.use(express.json({ limit: '50mb' }))

async function validateToken(authHeader: string | undefined): Promise<{ id: number; username: string; isAdmin: boolean } | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  try {
    const r = await fetch(`${ABYSS_API_URL}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!r.ok) return null
    const u = await r.json() as { id: number; username: string; isAdmin: boolean }
    return u
  } catch { return null }
}

async function requireAdmin(req: express.Request, res: express.Response): Promise<boolean> {
  // Accept either admin user token OR API_KEY header
  const user = await validateToken(req.headers.authorization)
  if (user?.isAdmin) return true
  const key = req.headers['x-api-key'] ?? req.query['key']
  if (key === API_KEY) return true
  res.status(403).json({ error: 'Forbidden — admin required' })
  return false
}

function toPublic(doc: AddonDoc) {
  return {
    id: doc._id,
    name: doc.name,
    description: doc.description,
    author: doc.author,
    category: doc.category,
    itemCount: doc.itemCount,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    url: `${PUBLIC_URL}/api/addons/${doc._id}`,
  }
}

// ── Auth Routes ───────────────────────────────────────────────────────────────

// Proxy login to abyss-api
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body ?? {}
  if (!email || !password) return res.status(400).json({ error: 'email and password required' })
  try {
    const r = await fetch(`${ABYSS_API_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const data = await r.json() as { accessToken?: string; user?: { id: number; username: string; isAdmin: boolean } }
    if (!r.ok) return res.status(401).json({ error: 'Credenciais inválidas' })
    res.json({ token: data.accessToken, user: data.user })
  } catch {
    res.status(500).json({ error: 'Erro ao conectar à API principal' })
  }
})

// Validate token and return user
app.get('/api/auth/me', async (req, res) => {
  const user = await validateToken(req.headers.authorization)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })
  res.json(user)
})

// ── Addon Routes ──────────────────────────────────────────────────────────────

// List all addons metadata (public)
app.get('/api/addons', async (_req, res) => {
  if (!requireDb(res)) return
  const docs = await db!.collection<AddonDoc>('addons')
    .find({}, { projection: { downloads: 0 } })
    .sort({ createdAt: -1 })
    .toArray()
  res.json(docs.map(toPublic))
})

// Create addon (admin only — via token or API key)
app.post('/api/addons', async (req, res) => {
  if (!requireDb(res)) return
  if (!await requireAdmin(req, res)) return
  const { name, description, author, category, downloads } = req.body
  if (!name || !Array.isArray(downloads) || downloads.length === 0)
    return res.status(400).json({ error: 'name and downloads[] are required' })

  const now = new Date().toISOString()
  const doc: AddonDoc = {
    _id: uuidv4(),
    name, downloads,
    description: description ?? '',
    author: author ?? 'Anônimo',
    category: category ?? 'mixed',
    itemCount: downloads.length,
    createdAt: now,
    updatedAt: now,
  }
  await db!.collection<AddonDoc>('addons').insertOne(doc)
  res.status(201).json(toPublic(doc))
})

// ── Pending Queue Routes (must be BEFORE /api/addons/:id to avoid wildcard clash) ──

// Non-admin users submit to pending queue
app.post('/api/addons/submit', async (req, res) => {
  if (!requireDb(res)) return
  const user = await validateToken(req.headers.authorization)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })
  const { name, description, category, downloads } = req.body
  if (!name || !Array.isArray(downloads) || downloads.length === 0)
    return res.status(400).json({ error: 'name and downloads[] are required' })

  const doc: PendingAddonDoc = {
    _id: uuidv4(),
    name, downloads,
    description: description ?? '',
    category: category ?? 'mixed',
    itemCount: downloads.length,
    submittedAt: new Date().toISOString(),
    submittedBy: user.username,
    userId: user.id,
  }
  await db!.collection<PendingAddonDoc>('pending_addons').insertOne(doc)
  res.status(201).json({ ok: true, message: 'Addon enviado para revisão' })
})

// Admin only — list pending addons
app.get('/api/addons/pending', async (req, res) => {
  if (!requireDb(res)) return
  const user = await validateToken(req.headers.authorization)
  if (!user?.isAdmin) return res.status(403).json({ error: 'Forbidden' })
  const docs = await db!.collection<PendingAddonDoc>('pending_addons')
    .find({}).sort({ submittedAt: -1 }).toArray()
  res.json(docs)
})

// Admin approves a pending addon
app.post('/api/addons/pending/:id/approve', async (req, res) => {
  if (!requireDb(res)) return
  const user = await validateToken(req.headers.authorization)
  if (!user?.isAdmin) return res.status(403).json({ error: 'Forbidden' })
  const pending = await db!.collection<PendingAddonDoc>('pending_addons').findOne({ _id: req.params.id })
  if (!pending) return res.status(404).json({ error: 'Not found' })

  const now = new Date().toISOString()
  const doc: AddonDoc = {
    _id: uuidv4(),
    name: pending.name,
    description: pending.description,
    author: pending.submittedBy,
    category: pending.category,
    downloads: pending.downloads,
    itemCount: pending.itemCount,
    createdAt: now,
    updatedAt: now,
  }
  await db!.collection<AddonDoc>('addons').insertOne(doc)
  await db!.collection<PendingAddonDoc>('pending_addons').deleteOne({ _id: req.params.id })
  res.json(toPublic(doc))
})

// Admin rejects (deletes) a pending addon
app.delete('/api/addons/pending/:id', async (req, res) => {
  if (!requireDb(res)) return
  const user = await validateToken(req.headers.authorization)
  if (!user?.isAdmin) return res.status(403).json({ error: 'Forbidden' })
  const result = await db!.collection<PendingAddonDoc>('pending_addons').deleteOne({ _id: req.params.id })
  if (result.deletedCount === 0) return res.status(404).json({ error: 'Not found' })
  res.json({ ok: true })
})

// ── Parameterised addon routes (after specific paths) ─────────────────────────

// Get addon JSON in Abyss format — this is the URL users copy into the app
app.get('/api/addons/:id', async (req, res) => {
  if (!requireDb(res)) return
  const doc = await db!.collection<AddonDoc>('addons').findOne({ _id: req.params.id })
  if (!doc) return res.status(404).json({ error: 'Not found' })
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.json({ name: doc.name, downloads: doc.downloads })
})

// Update addon (admin only)
app.put('/api/addons/:id', async (req, res) => {
  if (!requireDb(res)) return
  if (!await requireAdmin(req, res)) return
  const { name, description, author, category, downloads } = req.body
  const update: Partial<AddonDoc> = {
    ...(name        && { name }),
    ...(description !== undefined && { description }),
    ...(author      && { author }),
    ...(category    && { category }),
    ...(downloads   && { downloads, itemCount: downloads.length }),
    updatedAt: new Date().toISOString(),
  }
  const result = await db!.collection<AddonDoc>('addons')
    .findOneAndUpdate({ _id: req.params.id }, { $set: update }, { returnDocument: 'after' })
  if (!result) return res.status(404).json({ error: 'Not found' })
  res.json(toPublic(result))
})

// Delete addon (admin only)
app.delete('/api/addons/:id', async (req, res) => {
  if (!requireDb(res)) return
  if (!await requireAdmin(req, res)) return
  const result = await db!.collection<AddonDoc>('addons').deleteOne({ _id: req.params.id })
  if (result.deletedCount === 0) return res.status(404).json({ error: 'Not found' })
  res.json({ ok: true })
})

// Health
app.get('/api/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }))

// Serve built React app in production
if (process.env.NODE_ENV === 'production') {
  const distDir = path.join(process.cwd(), 'dist')
  app.use(express.static(distDir))
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')))
}

// ── Start ──────────────────────────────────────────────────────────────────────

// Start server regardless of MongoDB status — auth endpoints work without DB
connectDb().finally(() => {
  app.listen(PORT, () => {
    console.log(`Abyss Library running on http://localhost:${PORT}`)
    console.log(`NODE_ENV: ${process.env.NODE_ENV ?? 'development'}`)
    console.log(`ABYSS_API_URL: ${ABYSS_API_URL}`)
    console.log(`DB ready: ${dbReady}`)
  })
})
