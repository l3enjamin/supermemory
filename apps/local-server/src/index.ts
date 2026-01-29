import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from 'bun'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'

const app = new Hono()

// Configuration
const PORT = 3001
const WORKSPACE_ROOT = path.resolve(import.meta.dir, '../../../')
const MEMORY_DIR = path.join(WORKSPACE_ROOT, '.gitmemory')
const DATA_DIR = path.join(MEMORY_DIR, 'data')
const FILES_DIR = path.join(MEMORY_DIR, 'files')

// Ensure directories exist
if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR)
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR)
if (!existsSync(FILES_DIR)) mkdirSync(FILES_DIR)

// CORS
app.use('/*', cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Cookie'],
}))

// Mock User
const MOCK_USER = {
  id: 'local-user',
  email: 'local@supermemory.ai',
  name: 'Local User',
  emailVerified: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const MOCK_SESSION = {
  id: 'local-session',
  userId: 'local-user',
  expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
  token: 'local-token',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ipAddress: '127.0.0.1',
  userAgent: 'local-agent',
  activeOrganizationId: 'local-org',
}

const MOCK_ORG = {
    id: 'local-org',
    name: 'Local Workspace',
    slug: 'local-workspace',
    metadata: { isConsumer: true },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
}

// Auth Endpoints
app.get('/api/auth/session', (c) => {
  return c.json({
    session: MOCK_SESSION,
    user: MOCK_USER
  })
})

app.post('/api/auth/sign-in/email', (c) => {
    return c.json({
        status: true,
        user: MOCK_USER,
        session: MOCK_SESSION
    })
})

app.post('/api/auth/sign-out', (c) => {
    return c.json({ success: true })
})

// Organization Endpoints (Better Auth)
app.get('/api/auth/organization/list', (c) => {
    return c.json([MOCK_ORG])
})

app.get('/api/auth/organization/get-full-organization', (c) => {
    return c.json(MOCK_ORG)
})


// Projects (Mock)
app.get('/v3/projects', (c) => {
  return c.json({
    projects: [
      {
        id: 'default',
        name: 'Default Project',
        containerTag: 'default',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isExperimental: false,
        documentCount: 0,
        emoji: '📁'
      }
    ]
  })
})

// Connections (Mock)
app.get('/v3/connections', (c) => {
  return c.json([])
})

app.get('/v3/settings', (c) => {
    return c.json({ settings: {} })
})

// Helper to read all memories
async function getAllMemories() {
  const files = await fs.readdir(DATA_DIR)
  const memories = []
  for (const file of files) {
    if (file.endsWith('.json')) {
      try {
        const content = await fs.readFile(path.join(DATA_DIR, file), 'utf-8')
        memories.push(JSON.parse(content))
      } catch (e) {
        console.error(`Failed to read memory ${file}`, e)
      }
    }
  }
  return memories.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

// Helper to save memory
async function saveMemory(memory: any) {
  const filePath = path.join(DATA_DIR, `${memory.id}.json`)
  await fs.writeFile(filePath, JSON.stringify(memory, null, 2))
  return memory
}

// Documents / Memories API

// List Documents (POST /documents/documents - as used in use-memories.ts)
app.post('/v3/documents/documents', async (c) => {
  const body = await c.req.json()
  const { page = 1, limit = 10, containerTags } = body

  let memories = await getAllMemories()

  if (containerTags && containerTags.length > 0) {
    memories = memories.filter(m =>
       m.containerTags && m.containerTags.some((t: string) => containerTags.includes(t))
    )
  }

  const totalItems = memories.length
  const totalPages = Math.ceil(totalItems / limit)
  const offset = (page - 1) * limit
  const paginated = memories.slice(offset, offset + limit)

  // Map to DocumentWithMemories format if needed (it seems to be the same + memoryEntries)
  const documents = paginated.map(m => ({
      ...m,
      memoryEntries: [] // Simplified for now
  }))

  return c.json({
    documents,
    pagination: {
      currentPage: page,
      limit,
      totalItems,
      totalPages
    }
  })
})

// Add Document (POST /documents)
app.post('/v3/documents', async (c) => {
  const body = await c.req.json()
  const { content, containerTags, metadata } = body

  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  // Basic URL detection
  const type = content.startsWith('http') ? 'link' : 'note'

  const memory = {
    id,
    content,
    url: type === 'link' ? content : null,
    title: type === 'link' ? content : content.slice(0, 50),
    type,
    status: 'done', // Immediate success
    createdAt: now,
    updatedAt: now,
    containerTags: containerTags || [],
    metadata: metadata || {},
    memoryEntries: []
  }

  await saveMemory(memory)
  return c.json(memory)
})

// Upload File (POST /documents/file)
app.post('/v3/documents/file', async (c) => {
  const body = await c.req.parseBody()
  const file = body['file']
  const containerTagsStr = body['containerTags'] as string
  const metadataStr = body['metadata'] as string

  if (!(file instanceof File)) {
      return c.json({ error: 'No file uploaded' }, 400)
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const fileName = file.name
  const filePath = path.join(FILES_DIR, `${id}-${fileName}`)

  await Bun.write(filePath, file)

  const containerTags = containerTagsStr ? JSON.parse(containerTagsStr) : []
  const metadata = metadataStr ? JSON.parse(metadataStr) : {}

  const memory = {
    id,
    content: '',
    url: null,
    title: fileName,
    type: 'file',
    status: 'done',
    createdAt: now,
    updatedAt: now,
    containerTags,
    metadata: {
        ...metadata,
        fileName,
        fileSize: file.size,
        mimeType: file.type,
        localPath: filePath
    },
    memoryEntries: []
  }

  await saveMemory(memory)
  return c.json(memory)
})

// Update Document (PATCH /documents/:id)
app.patch('/v3/documents/:id', async (c) => {
    const id = c.req.param('id')
    const body = await c.req.json()

    // Read existing
    const filePath = path.join(DATA_DIR, `${id}.json`)
    try {
        const content = await fs.readFile(filePath, 'utf-8')
        const memory = JSON.parse(content)

        // Update fields
        const updated = {
            ...memory,
            ...body,
            metadata: {
                ...memory.metadata,
                ...body.metadata
            },
            updatedAt: new Date().toISOString()
        }

        await saveMemory(updated)
        return c.json(updated)
    } catch (e) {
        return c.json({ error: 'Document not found' }, 404)
    }
})

// Delete Document (DELETE /documents/:id)
app.delete('/v3/documents/:id', async (c) => {
    const id = c.req.param('id')
    const filePath = path.join(DATA_DIR, `${id}.json`)

    try {
        await fs.unlink(filePath)
        return c.json({ success: true })
    } catch (e) {
        return c.json({ error: 'Document not found' }, 404)
    }
})

// Get Document (GET /documents/:id)
app.get('/v3/documents/:id', async (c) => {
    const id = c.req.param('id')
    const filePath = path.join(DATA_DIR, `${id}.json`)

    try {
        const content = await fs.readFile(filePath, 'utf-8')
        return c.json(JSON.parse(content))
    } catch (e) {
        return c.json({ error: 'Document not found' }, 404)
    }
})

// List by IDs
app.post('/v3/documents/documents/by-ids', async (c) => {
    const body = await c.req.json()
    const { ids } = body
    const all = await getAllMemories()
    const found = all.filter(m => ids.includes(m.id))
    return c.json({ documents: found })
})

// Waitlist (Mock)
app.get('/v3/waitlist/status', (c) => {
    return c.json({
        inWaitlist: false,
        accessGranted: true,
        createdAt: new Date().toISOString()
    })
})

console.log(`Local Memory Server running on port ${PORT}`)
console.log(`Storing data in ${MEMORY_DIR}`)

export default {
    port: PORT,
    fetch: app.fetch
}
