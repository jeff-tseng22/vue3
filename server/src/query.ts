import type { DB } from './db.ts'
import { clearCache, readCache, readTotal, writeCache, writeTotal } from './cache.ts'
import {
  ApiError,
  PAGE_SIZE,
  type Cursor,
  type DbPerson,
  type ListParams,
  type PageResult,
  type Person,
  type PersonInput,
  type SortKey,
  SORT_KEYS,
} from './types.ts'

const COLUMNS: Record<SortKey, string> = {
  userName: 'user_name',
  position: 'position',
  location: 'location',
  age: 'age',
  dateStart: 'date_start',
}

const SELECT_COLUMNS = `
  id, user_name, position, location, age, date_start, pin_slot, updated_at
`

export function countPeople(db: DB): number {
  const cached = readTotal(db)
  if (cached !== null) return cached
  const row = db.prepare('SELECT COUNT(*) AS c FROM people').get() as { c: number }
  writeTotal(db, row.c)
  return row.c
}

export function parseListQuery(query: Record<string, unknown>, limit = PAGE_SIZE): ListParams {
  const sortRaw = typeof query.sort === 'string' && query.sort ? query.sort : 'userName'
  if (!SORT_KEYS.includes(sortRaw as SortKey)) {
    throw new ApiError(400, 'Invalid sort field')
  }
  const dirRaw = typeof query.dir === 'string' && query.dir ? query.dir : 'asc'
  if (dirRaw !== 'asc' && dirRaw !== 'desc') {
    throw new ApiError(400, 'Invalid sort direction')
  }
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : ''
  const cursor = typeof query.cursor === 'string' && query.cursor ? query.cursor : null
  return { sort: sortRaw as SortKey, dir: dirRaw, q, cursor, limit }
}

export function listPeopleCached(db: DB, params: ListParams): { page: PageResult; hit: boolean } {
  const key = JSON.stringify(params)
  const cached = readCache(db, key)
  if (cached) return { page: cached, hit: true }
  const page = listPeople(db, params)
  writeCache(db, key, page)
  return { page, hit: false }
}

export function listPeople(db: DB, params: ListParams): PageResult {
  const cursor = decodeCursor(params.cursor, params.sort)
  const total = countPeople(db)
  if (params.q) return listSearch(db, params, cursor, total)
  return listPinned(db, params, cursor, total)
}

export function createPerson(db: DB, input: PersonInput): Person {
  const parsed = validateInput(input)
  const now = new Date().toISOString()
  const info = db
    .prepare(
      `INSERT INTO people (user_name, position, location, age, date_start, pin_slot, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    )
    .run(parsed.userName, parsed.position, parsed.location, parsed.age, parsed.dateStart, now)
  clearCache(db)
  const row = getDbPerson(db, Number(info.lastInsertRowid))
  if (!row) throw new ApiError(500, 'Server error')
  return mapPerson(row, countPeople(db))
}

export function updatePerson(db: DB, id: number, input: PersonInput, expectedUpdatedAt: string): Person {
  const parsed = validateInput(input)
  if (!expectedUpdatedAt) throw new ApiError(400, 'Missing update timestamp')
  const now = new Date().toISOString()
  const info = db
    .prepare(
      `UPDATE people
       SET user_name = ?, position = ?, location = ?, age = ?, date_start = ?, updated_at = ?
       WHERE id = ? AND updated_at = ?`,
    )
    .run(parsed.userName, parsed.position, parsed.location, parsed.age, parsed.dateStart, now, id, expectedUpdatedAt)
  if (info.changes === 0) {
    const exists = db.prepare('SELECT id FROM people WHERE id = ?').get(id)
    throw new ApiError(exists ? 409 : 404, exists ? 'This record was changed by someone else' : 'Record not found')
  }
  clearCache(db)
  const row = getDbPerson(db, id)
  if (!row) throw new ApiError(404, 'Record not found')
  return mapPerson(row, row.pin_slot ?? 0)
}

export function deletePerson(db: DB, id: number, expectedUpdatedAt: string): void {
  if (!expectedUpdatedAt) throw new ApiError(400, 'Missing update timestamp')
  const info = db.prepare('DELETE FROM people WHERE id = ? AND updated_at = ?').run(id, expectedUpdatedAt)
  if (info.changes === 0) {
    const exists = db.prepare('SELECT id FROM people WHERE id = ?').get(id)
    throw new ApiError(exists ? 409 : 404, exists ? 'This record was changed by someone else' : 'Record not found')
  }
  clearCache(db)
}

export function setPin(db: DB, id: number, slot: number | null): void {
  const total = db.prepare('SELECT COUNT(*) AS c FROM people').get() as { c: number }
  const exists = db.prepare('SELECT id FROM people WHERE id = ?').get(id) as { id: number } | undefined
  if (!exists) throw new ApiError(404, 'Record not found')
  if (slot !== null && (!Number.isInteger(slot) || slot < 1 || slot > total.c)) {
    throw new ApiError(400, `Pin position must be an integer from 1 to ${total.c}`)
  }

  const clearSlot = db.prepare('UPDATE people SET pin_slot = NULL WHERE id = ?')
  const readSlot = db.prepare('SELECT id, pin_slot FROM people WHERE pin_slot = ?')
  const readFrom = db.prepare(
    'SELECT id, pin_slot FROM people WHERE pin_slot >= ? ORDER BY pin_slot ASC',
  )
  const moveSlot = db.prepare('UPDATE people SET pin_slot = ? WHERE id = ?')
  const place = db.prepare('UPDATE people SET pin_slot = ? WHERE id = ?')

  const tx = db.transaction(() => {
    clearSlot.run(id)
    if (slot === null) return
    const occupant = readSlot.get(slot) as { id: number; pin_slot: number } | undefined
    if (occupant) {
      const chain = readFrom.all(slot) as { id: number; pin_slot: number }[]
      const contiguous: { id: number; pin_slot: number }[] = []
      let expected = slot
      for (const item of chain) {
        if (item.pin_slot !== expected) break
        contiguous.push(item)
        expected += 1
      }
      for (let index = contiguous.length - 1; index >= 0; index -= 1) {
        const next = contiguous[index].pin_slot + 1
        if (next > total.c) clearSlot.run(contiguous[index].id)
        else moveSlot.run(next, contiguous[index].id)
      }
    }
    place.run(slot, id)
  })
  tx()
  clearCache(db)
}

function listPinned(db: DB, params: ListParams, cursor: Cursor, total: number): PageResult {
  const pageStart = cursor.pageStart
  if (pageStart >= total) {
    return { rows: [], nextCursor: null, total, pageSize: params.limit }
  }
  const slotsThisPage = Math.min(params.limit, total - pageStart)
  const pinned = db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM people
       WHERE pin_slot > ? AND pin_slot <= ?
       ORDER BY pin_slot ASC`,
    )
    .all(pageStart, pageStart + slotsThisPage) as DbPerson[]
  const pinnedBySlot = new Map<number, DbPerson>()
  for (const row of pinned) {
    if (row.pin_slot !== null) pinnedBySlot.set(row.pin_slot, row)
  }
  const unpinnedNeeded = slotsThisPage - pinned.length
  const unpinned = unpinnedNeeded > 0 ? fetchUnpinned(db, params, cursor.after, unpinnedNeeded) : []
  const rows: Person[] = []
  let unpinnedIndex = 0
  for (let slot = pageStart + 1; slot <= pageStart + slotsThisPage; slot += 1) {
    const pinnedRow = pinnedBySlot.get(slot)
    const source = pinnedRow ?? unpinned[unpinnedIndex++]
    if (!source) throw new Error('分頁合併時缺少未釘選資料')
    rows.push(mapPerson(source, slot))
  }
  const lastUnpinned = unpinned.length > 0 ? unpinned[unpinned.length - 1] : null
  const nextAfter = lastUnpinned
    ? { value: sortValue(lastUnpinned, params.sort), id: lastUnpinned.id }
    : cursor.after
  const hasMore = pageStart + slotsThisPage < total
  return {
    rows,
    nextCursor: hasMore ? encodeCursor({ pageStart: pageStart + slotsThisPage, after: nextAfter }) : null,
    total,
    pageSize: params.limit,
  }
}

function listSearch(db: DB, params: ListParams, cursor: Cursor, total: number): PageResult {
  const match = buildSearch(params.q)
  if (match.empty) {
    return { rows: [], nextCursor: null, total, pageSize: params.limit }
  }
  const rows = fetchFiltered(db, params, cursor.after, match, params.limit)
  const last = rows[rows.length - 1]
  const hasMore = rows.length === params.limit && last !== undefined
  const mapped = rows.map((row, index) => mapPerson(row, cursor.pageStart + index + 1))
  return {
    rows: mapped,
    nextCursor: hasMore
      ? encodeCursor({
          pageStart: cursor.pageStart + rows.length,
          after: { value: sortValue(last, params.sort), id: last.id },
        })
      : null,
    total,
    pageSize: params.limit,
  }
}

function fetchUnpinned(
  db: DB,
  params: ListParams,
  after: Cursor['after'],
  limit: number,
): DbPerson[] {
  const column = COLUMNS[params.sort]
  const cmp = params.dir === 'asc' ? '>' : '<'
  const order = params.dir === 'asc' ? 'ASC' : 'DESC'
  const keyset = after ? `AND (${column} ${cmp} ? OR (${column} = ? AND id ${cmp} ?))` : ''
  const statement = db.prepare(
    `SELECT ${SELECT_COLUMNS} FROM people
     WHERE pin_slot IS NULL
     ${keyset}
     ORDER BY ${column} ${order}, id ${order}
     LIMIT ?`,
  )
  const bound = after ? [after.value, after.value, after.id, limit] : [limit]
  return statement.all(...bound) as DbPerson[]
}

type SearchMatch =
  | { empty: true }
  | { empty: false; kind: 'date'; date: string }
  | { empty: false; kind: 'text'; fts: string; age: number | null }

function fetchFiltered(
  db: DB,
  params: ListParams,
  after: Cursor['after'],
  match: Exclude<SearchMatch, { empty: true }>,
  limit: number,
): DbPerson[] {
  const column = COLUMNS[params.sort]
  const cmp = params.dir === 'asc' ? '>' : '<'
  const order = params.dir === 'asc' ? 'ASC' : 'DESC'
  const keyset = after ? `AND (${column} ${cmp} ? OR (${column} = ? AND id ${cmp} ?))` : ''
  const filter = match.kind === 'date'
    ? 'date_start = ?'
    : match.age === null
      ? 'id IN (SELECT rowid FROM people_fts WHERE people_fts MATCH ?)'
      : '(id IN (SELECT rowid FROM people_fts WHERE people_fts MATCH ?) OR age = ?)'
  const statement = db.prepare(
    `SELECT ${SELECT_COLUMNS} FROM people
     WHERE ${filter}
     ${keyset}
     ORDER BY ${column} ${order}, id ${order}
     LIMIT ?`,
  )
  const bound: Array<string | number> = []
  if (match.kind === 'date') bound.push(match.date)
  else {
    bound.push(match.fts)
    if (match.age !== null) bound.push(match.age)
  }
  if (after) bound.push(after.value, after.value, after.id)
  bound.push(limit)
  return statement.all(...bound) as DbPerson[]
}

function buildSearch(raw: string): SearchMatch {
  const trimmed = raw.trim()
  if (isValidDate(trimmed)) return { empty: false, kind: 'date', date: trimmed }
  const age = /^\d{1,3}$/.test(trimmed) ? Number(trimmed) : null
  const tokens = trimmed
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 40))
    .filter((token) => token.length > 0)
  if (tokens.length === 0) {
    if (age === null) return { empty: true }
    return { empty: false, kind: 'text', fts: `"${age}"*`, age }
  }
  return { empty: false, kind: 'text', fts: tokens.map((token) => `"${token}"*`).join(' '), age }
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeCursor(raw: string | null, sort: SortKey): Cursor {
  if (!raw) return { pageStart: 0, after: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    throw new ApiError(400, 'Invalid page cursor')
  }
  if (!parsed || typeof parsed !== 'object') throw new ApiError(400, 'Invalid page cursor')
  const pageStart = (parsed as { pageStart?: unknown }).pageStart
  const after = (parsed as { after?: unknown }).after
  if (typeof pageStart !== 'number' || !Number.isInteger(pageStart) || pageStart < 0) {
    throw new ApiError(400, 'Invalid page cursor')
  }
  if (after === null || after === undefined) return { pageStart, after: null }
  if (!after || typeof after !== 'object') throw new ApiError(400, 'Invalid page cursor')
  const value = (after as { value?: unknown }).value
  const id = (after as { id?: unknown }).id
  const valueOk = sort === 'age' ? typeof value === 'number' : typeof value === 'string'
  if (!valueOk || typeof id !== 'number' || !Number.isInteger(id)) {
    throw new ApiError(400, 'Invalid page cursor')
  }
  return { pageStart, after: { value, id } }
}

function sortValue(row: DbPerson, sort: SortKey): string | number {
  switch (sort) {
    case 'userName':
      return row.user_name
    case 'position':
      return row.position
    case 'location':
      return row.location
    case 'age':
      return row.age
    case 'dateStart':
      return row.date_start
  }
}

function mapPerson(row: DbPerson, displayIndex: number): Person {
  return {
    id: row.id,
    userName: row.user_name,
    position: row.position,
    location: row.location,
    age: row.age,
    dateStart: row.date_start,
    pinSlot: row.pin_slot,
    updatedAt: row.updated_at,
    displayIndex,
  }
}

function getDbPerson(db: DB, id: number): DbPerson | undefined {
  return db.prepare(`SELECT ${SELECT_COLUMNS} FROM people WHERE id = ?`).get(id) as DbPerson | undefined
}

export function validateInput(input: PersonInput): PersonInput {
  const userName = requiredText(input.userName, 'Name')
  const position = requiredText(input.position, 'Position')
  const location = requiredText(input.location, 'Location')
  if (!Number.isInteger(input.age) || input.age < 0 || input.age > 150) {
    throw new ApiError(400, 'Age must be an integer from 0 to 150')
  }
  if (!isValidDate(input.dateStart)) {
    throw new ApiError(400, 'Start date must be YYYY-MM-DD')
  }
  return { userName, position, location, age: input.age, dateStart: input.dateStart }
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new ApiError(400, `${label} is required`)
  const trimmed = value.trim()
  if (!trimmed) throw new ApiError(400, `${label} is required`)
  if (trimmed.length > 80) throw new ApiError(400, `${label} must be 80 characters or fewer`)
  return trimmed
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}
