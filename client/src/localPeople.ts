import { PAGE_SIZE, type Direction, type PageResult, type Person, type PersonInput, type SortKey } from './types'

const SEED_COUNT = 10_000
const FIRST = ['Ada', 'Bo', 'Cid', 'Dee', 'Eli', 'Fay', 'Gus', 'Hua', 'Ian', 'Joy']
const LAST = ['Chen', 'Lin', 'Wang', 'Park', 'Ng', 'Ito', 'Berg', 'Cole', 'Diaz', 'Shah']
const POSITIONS = ['Engineer', 'Manager', 'Analyst', 'Designer', 'Support', 'Researcher', 'Coordinator', 'Specialist']
const LOCATIONS = ['Taipei', 'Tokyo', 'Singapore', 'Berlin', 'Austin', 'London', 'Seoul', 'Sydney']

type Row = {
  id: number
  userName: string
  position: string
  location: string
  age: number
  dateStart: string
  pinSlot: number | null
  updatedAt: string
}

type Cursor = {
  pageStart: number
  after: { value: string | number; id: number } | null
}

class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const DATES = Array.from({ length: 3650 }, (_, index) => {
  const date = new Date(Date.UTC(2014, 0, 1))
  date.setUTCDate(date.getUTCDate() + index)
  return date.toISOString().slice(0, 10)
})

let rows: Row[] | null = null
let nextId = SEED_COUNT + 1

export function listPeople(params: {
  sort: SortKey
  dir: Direction
  q: string
  cursor: string | null
}): Promise<PageResult> {
  const people = catalog()
  const cursor = decodeCursor(params.cursor, params.sort)
  const query = params.q.trim().slice(0, 100)
  const page = query
    ? listSearch(people, params, cursor, people.length, query)
    : listPinned(people, params, cursor, people.length)
  return Promise.resolve(page)
}

export function createPerson(input: PersonInput): Promise<Person> {
  const parsed = validateInput(input)
  const people = catalog()
  const row: Row = { id: nextId, ...parsed, pinSlot: null, updatedAt: new Date().toISOString() }
  nextId += 1
  people.push(row)
  return Promise.resolve(mapPerson(row, people.length))
}

export function updatePerson(id: number, input: PersonInput, updatedAt: string): Promise<Person> {
  const parsed = validateInput(input)
  if (!updatedAt) throw new ApiError(400, 'Missing update timestamp')
  const row = requireRow(id)
  if (row.updatedAt !== updatedAt) throw new ApiError(409, 'This record was changed by someone else')
  Object.assign(row, parsed, { updatedAt: new Date().toISOString() })
  return Promise.resolve(mapPerson(row, row.pinSlot ?? 0))
}

export function deletePerson(id: number, updatedAt: string): Promise<void> {
  if (!updatedAt) throw new ApiError(400, 'Missing update timestamp')
  const people = catalog()
  const index = people.findIndex((row) => row.id === id)
  if (index < 0) throw new ApiError(404, 'Record not found')
  if (people[index].updatedAt !== updatedAt) throw new ApiError(409, 'This record was changed by someone else')
  people.splice(index, 1)
  return Promise.resolve()
}

export function pinPerson(id: number, slot: number | null): Promise<void> {
  const people = catalog()
  const person = requireRow(id)
  if (slot !== null && (!Number.isInteger(slot) || slot < 1 || slot > people.length)) {
    throw new ApiError(400, `Pin position must be an integer from 1 to ${people.length}`)
  }
  person.pinSlot = null
  if (slot !== null) {
    const chain = people
      .filter((row) => row.pinSlot !== null && row.pinSlot >= slot)
      .sort((left, right) => (left.pinSlot ?? 0) - (right.pinSlot ?? 0))
    const contiguous: Row[] = []
    let expected = slot
    for (const item of chain) {
      if (item.pinSlot !== expected) break
      contiguous.push(item)
      expected += 1
    }
    for (let index = contiguous.length - 1; index >= 0; index -= 1) {
      const current = contiguous[index].pinSlot ?? slot
      const next = current + 1
      contiguous[index].pinSlot = next > people.length ? null : next
    }
    person.pinSlot = slot
  }
  return Promise.resolve()
}

function catalog(): Row[] {
  if (rows) return rows
  const now = new Date().toISOString()
  rows = Array.from({ length: SEED_COUNT }, (_, index) => ({
    id: index + 1,
    userName: `${FIRST[index % FIRST.length]} ${LAST[(index * 3) % LAST.length]} ${index + 1}`,
    position: POSITIONS[index % POSITIONS.length],
    location: LOCATIONS[index % LOCATIONS.length],
    age: 18 + (index % 48),
    dateStart: DATES[index % DATES.length],
    pinSlot: null,
    updatedAt: now,
  }))
  return rows
}

function listPinned(
  people: Row[],
  params: { sort: SortKey; dir: Direction },
  cursor: Cursor,
  total: number,
): PageResult {
  const pageStart = cursor.pageStart
  if (pageStart >= total) return { rows: [], nextCursor: null, total, pageSize: PAGE_SIZE }
  const slotsThisPage = Math.min(PAGE_SIZE, total - pageStart)
  const pinnedBySlot = new Map<number, Row>()
  for (const row of people) {
    if (row.pinSlot !== null && row.pinSlot > pageStart && row.pinSlot <= pageStart + slotsThisPage) {
      pinnedBySlot.set(row.pinSlot, row)
    }
  }
  const unpinned = fetchUnpinned(people, params, cursor.after, slotsThisPage - pinnedBySlot.size)
  const page: Person[] = []
  let unpinnedIndex = 0
  for (let slot = pageStart + 1; slot <= pageStart + slotsThisPage; slot += 1) {
    const source = pinnedBySlot.get(slot) ?? unpinned[unpinnedIndex++]
    if (!source) throw new Error('分頁合併時缺少未釘選資料')
    page.push(mapPerson(source, slot))
  }
  const lastUnpinned = unpinned.length > 0 ? unpinned[unpinned.length - 1] : null
  const nextAfter = lastUnpinned ? { value: sortValue(lastUnpinned, params.sort), id: lastUnpinned.id } : cursor.after
  const hasMore = pageStart + slotsThisPage < total
  return {
    rows: page,
    nextCursor: hasMore ? encodeCursor({ pageStart: pageStart + slotsThisPage, after: nextAfter }) : null,
    total,
    pageSize: PAGE_SIZE,
  }
}

function listSearch(people: Row[], params: { sort: SortKey; dir: Direction }, cursor: Cursor, total: number, query: string): PageResult {
  const match = buildSearch(query)
  if (match.empty) return { rows: [], nextCursor: null, total, pageSize: PAGE_SIZE }
  const matched = people
    .filter((row) => matches(row, match) && isAfter(row, cursor.after, params.sort, params.dir))
    .sort((left, right) => compare(left, right, params.sort, params.dir))
    .slice(0, PAGE_SIZE)
  const last = matched[matched.length - 1]
  const hasMore = matched.length === PAGE_SIZE && last !== undefined
  return {
    rows: matched.map((row, index) => mapPerson(row, cursor.pageStart + index + 1)),
    nextCursor: hasMore
      ? encodeCursor({
          pageStart: cursor.pageStart + matched.length,
          after: { value: sortValue(last, params.sort), id: last.id },
        })
      : null,
    total,
    pageSize: PAGE_SIZE,
  }
}

function fetchUnpinned(
  people: Row[],
  params: { sort: SortKey; dir: Direction },
  after: Cursor['after'],
  limit: number,
): Row[] {
  if (limit <= 0) return []
  return people
    .filter((row) => row.pinSlot === null && isAfter(row, after, params.sort, params.dir))
    .sort((left, right) => compare(left, right, params.sort, params.dir))
    .slice(0, limit)
}

type SearchMatch =
  | { empty: true }
  | { empty: false; kind: 'date'; date: string }
  | { empty: false; kind: 'text'; tokens: string[]; age: number | null }

function buildSearch(raw: string): SearchMatch {
  const trimmed = raw.trim()
  if (isValidDate(trimmed)) return { empty: false, kind: 'date', date: trimmed }
  const age = /^\d{1,3}$/.test(trimmed) ? Number(trimmed) : null
  const tokens = trimmed
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 40).toLowerCase())
    .filter((token) => token.length > 0)
  if (tokens.length === 0) {
    if (age === null) return { empty: true }
    return { empty: false, kind: 'text', tokens: [String(age)], age }
  }
  return { empty: false, kind: 'text', tokens, age }
}

function matches(row: Row, match: Exclude<SearchMatch, { empty: true }>): boolean {
  if (match.kind === 'date') return row.dateStart === match.date
  const haystack = [row.userName, row.position, row.location, String(row.age), row.dateStart]
    .join(' ')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0)
  const textHit = match.tokens.every((token) => haystack.some((part) => part.startsWith(token)))
  return textHit || (match.age !== null && row.age === match.age)
}

function isAfter(row: Row, after: Cursor['after'], sort: SortKey, dir: Direction): boolean {
  if (!after) return true
  const value = sortValue(row, sort)
  const ahead = dir === 'asc' ? greater(value, after.value) : greater(after.value, value)
  if (ahead) return true
  if (value !== after.value) return false
  return dir === 'asc' ? row.id > after.id : row.id < after.id
}

function compare(left: Row, right: Row, sort: SortKey, dir: Direction): number {
  const leftValue = sortValue(left, sort)
  const rightValue = sortValue(right, sort)
  const valueOrder = greater(leftValue, rightValue) ? 1 : greater(rightValue, leftValue) ? -1 : 0
  const order = valueOrder !== 0 ? valueOrder : left.id - right.id
  return dir === 'asc' ? order : -order
}

function greater(left: string | number, right: string | number): boolean {
  return left > right
}

function sortValue(row: Row, sort: SortKey): string | number {
  switch (sort) {
    case 'userName':
      return row.userName
    case 'position':
      return row.position
    case 'location':
      return row.location
    case 'age':
      return row.age
    case 'dateStart':
      return row.dateStart
  }
}

function mapPerson(row: Row, displayIndex: number): Person {
  return {
    id: row.id,
    userName: row.userName,
    position: row.position,
    location: row.location,
    age: row.age,
    dateStart: row.dateStart,
    pinSlot: row.pinSlot,
    updatedAt: row.updatedAt,
    displayIndex,
  }
}

function requireRow(id: number): Row {
  const row = catalog().find((item) => item.id === id)
  if (!row) throw new ApiError(404, 'Record not found')
  return row
}

function validateInput(input: PersonInput): PersonInput {
  return {
    userName: requiredText(input.userName, 'Name'),
    position: requiredText(input.position, 'Position'),
    location: requiredText(input.location, 'Location'),
    age: validAge(input.age),
    dateStart: validDate(input.dateStart),
  }
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new ApiError(400, `${label} is required`)
  const trimmed = value.trim()
  if (!trimmed) throw new ApiError(400, `${label} is required`)
  if (trimmed.length > 80) throw new ApiError(400, `${label} must be 80 characters or fewer`)
  return trimmed
}

function validAge(age: number): number {
  if (!Number.isInteger(age) || age < 0 || age > 150) throw new ApiError(400, 'Age must be an integer from 0 to 150')
  return age
}

function validDate(value: string): string {
  if (!isValidDate(value)) throw new ApiError(400, 'Start date must be YYYY-MM-DD')
  return value
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function encodeCursor(cursor: Cursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

function decodeCursor(raw: string | null, sort: SortKey): Cursor {
  if (!raw) return { pageStart: 0, after: null }
  let parsed: unknown
  try {
    const padded = raw.replaceAll('-', '+').replaceAll('_', '/')
    const binary = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '='))
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    parsed = JSON.parse(new TextDecoder().decode(bytes))
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
  if (!valueOk || typeof id !== 'number' || !Number.isInteger(id)) throw new ApiError(400, 'Invalid page cursor')
  return { pageStart, after: { value, id } }
}
