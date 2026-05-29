import express from 'express'
import cors from 'cors'
import path from 'path'
import { MongoClient, type Db } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'

const app = express()
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3777
const API_KEY = process.env.API_KEY ?? 'dev-key'
const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`
const MONGO_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/abyss-library'

// ── DB connection ──────────────────────────────────────────────────────────────

let db: Db

async function connectDb() {
  const client = new MongoClient(MONGO_URI)
  await client.connect()
  db = client.db()
  console.log('MongoDB connected')
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

// ── Middleware ─────────────────────────────────────────────────────────────────

app.use(cors())
app.use(express.json({ limit: '50mb' }))

function requireKey(req: express.Request, res: express.Response): boolean {
  const key = req.headers['x-api-key'] ?? req.query['key']
  if (key !== API_KEY) { res.status(401).json({ error: 'Unauthorized' }); return false }
  return true
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

// ── Routes ────────────────────────────────────────────────────────────────────

// List all addons metadata (public)
app.get('/api/addons', async (_req, res) => {
  const docs = await db.collection<AddonDoc>('addons')
    .find({}, { projection: { downloads: 0 } })
    .sort({ createdAt: -1 })
    .toArray()
  res.json(docs.map(toPublic))
})

// Get addon JSON in Abyss format — this is the URL users copy into the app
app.get('/api/addons/:id', async (req, res) => {
  const doc = await db.collection<AddonDoc>('addons').findOne({ _id: req.params.id })
  if (!doc) return res.status(404).json({ error: 'Not found' })
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.json({ name: doc.name, downloads: doc.downloads })
})

// Create addon (protected)
app.post('/api/addons', async (req, res) => {
  if (!requireKey(req, res)) return
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
  await db.collection<AddonDoc>('addons').insertOne(doc)
  res.status(201).json(toPublic(doc))
})

// Update addon (protected)
app.put('/api/addons/:id', async (req, res) => {
  if (!requireKey(req, res)) return
  const { name, description, author, category, downloads } = req.body
  const update: Partial<AddonDoc> = {
    ...(name        && { name }),
    ...(description !== undefined && { description }),
    ...(author      && { author }),
    ...(category    && { category }),
    ...(downloads   && { downloads, itemCount: downloads.length }),
    updatedAt: new Date().toISOString(),
  }
  const result = await db.collection<AddonDoc>('addons')
    .findOneAndUpdate({ _id: req.params.id }, { $set: update }, { returnDocument: 'after' })
  if (!result) return res.status(404).json({ error: 'Not found' })
  res.json(toPublic(result))
})

// Delete addon (protected)
app.delete('/api/addons/:id', async (req, res) => {
  if (!requireKey(req, res)) return
  const result = await db.collection<AddonDoc>('addons').deleteOne({ _id: req.params.id })
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

connectDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Abyss Library running on http://localhost:${PORT}`)
    console.log(`NODE_ENV: ${process.env.NODE_ENV ?? 'development'}`)
    console.log(`API_KEY set: ${!!API_KEY}`)
  })
}).catch(err => {
  console.error('Failed to connect to MongoDB:', err)
  process.exit(1)
})
