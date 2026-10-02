import Fastify from 'fastify'
import { openDatabase } from './db.ts'
import { deletePerson, listPeopleCached, parseListQuery, setPin, updatePerson, createPerson, countPeople } from './query.ts'
import { initSchema } from './schema.ts'
import { seedDatabase } from './seed.ts'
import { ApiError, PAGE_SIZE, type PersonInput } from './types.ts'

const db = openDatabase()
initSchema(db)
if (countPeople(db) === 0) {
  seedDatabase(db, 10_000)
}

const app = Fastify({ logger: true })

app.setErrorHandler((error, request, reply) => {
  if (error instanceof ApiError) {
    reply.status(error.status).send({ error: error.message })
    return
  }
  request.log.error(error)
  reply.status(500).send({ error: 'Server error' })
})

app.get('/api/health', async () => ({ ok: true }))

app.get('/api/people', async (request, reply) => {
  const { page, hit } = listPeopleCached(db, parseListQuery(request.query as Record<string, unknown>, PAGE_SIZE))
  reply.header('x-cache', hit ? 'HIT' : 'MISS')
  return page
})

app.post('/api/people', async (request, reply) => {
  const row = createPerson(db, readInput(request.body))
  return reply.code(201).send(row)
})

app.patch('/api/people/:id', async (request) => {
  const id = readId(request.params)
  const body = request.body as PersonInput & { updatedAt?: string }
  return updatePerson(db, id, readInput(body), typeof body?.updatedAt === 'string' ? body.updatedAt : '')
})

app.delete('/api/people/:id', async (request, reply) => {
  const id = readId(request.params)
  const query = request.query as { updatedAt?: string }
  deletePerson(db, id, typeof query.updatedAt === 'string' ? query.updatedAt : '')
  return reply.code(204).send()
})

app.put('/api/people/:id/pin', async (request, reply) => {
  const id = readId(request.params)
  const body = request.body as { slot?: number | null }
  if (body?.slot !== null && typeof body?.slot !== 'number') {
    throw new ApiError(400, 'Pin position is required')
  }
  setPin(db, id, body.slot ?? null)
  return reply.code(204).send()
})

function readId(params: unknown): number {
  const id = Number((params as { id?: string })?.id)
  if (!Number.isInteger(id) || id < 1) throw new ApiError(400, 'Record not found')
  return id
}

function readInput(body: unknown): PersonInput {
  const value = body as Partial<PersonInput> | null
  return {
    userName: typeof value?.userName === 'string' ? value.userName : '',
    position: typeof value?.position === 'string' ? value.position : '',
    location: typeof value?.location === 'string' ? value.location : '',
    age: typeof value?.age === 'number' ? value.age : Number.NaN,
    dateStart: typeof value?.dateStart === 'string' ? value.dateStart : '',
  }
}

const port = Number(process.env.PORT ?? 3001)
await app.listen({ port, host: '127.0.0.1' })
