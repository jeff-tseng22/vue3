import assert from 'node:assert/strict'
import test from 'node:test'
import { cacheStats } from '../src/cache.ts'
import { openDatabase } from '../src/db.ts'
import {
  createPerson,
  deletePerson,
  listPeople,
  listPeopleCached,
  setPin,
  updatePerson,
} from '../src/query.ts'
import { initSchema } from '../src/schema.ts'
import { seedDatabase, userNameFor } from '../src/seed.ts'
import type { DB } from '../src/db.ts'
import type { PersonInput } from '../src/types.ts'

function freshDb(): DB {
  const db = openDatabase(':memory:')
  initSchema(db)
  return db
}

function input(overrides: Partial<PersonInput> & Pick<PersonInput, 'userName'>): PersonInput {
  return {
    position: 'Engineer',
    location: 'Taipei',
    age: 30,
    dateStart: '2020-01-15',
    ...overrides,
  }
}

function names(db: DB, sort: 'userName' | 'age', dir: 'asc' | 'desc', limit: number, cursor: string | null = null) {
  const page = listPeople(db, { sort, dir, q: '', cursor, limit })
  return {
    names: page.rows.map((row) => row.userName),
    indexes: page.rows.map((row) => row.displayIndex),
    slots: page.rows.map((row) => row.pinSlot),
    nextCursor: page.nextCursor,
  }
}

test('釘選列在不同排序下都停在同一個絕對位置', () => {
  const db = freshDb()
  createPerson(db, input({ userName: 'Ada', age: 50 }))
  createPerson(db, input({ userName: 'Bo', age: 10 }))
  const cia = createPerson(db, input({ userName: 'Cia', age: 30 }))
  createPerson(db, input({ userName: 'Deo', age: 20 }))
  setPin(db, cia.id, 2)

  const byAgeAsc = names(db, 'age', 'asc', 10)
  assert.deepEqual(byAgeAsc.names, ['Bo', 'Cia', 'Deo', 'Ada'])
  assert.deepEqual(byAgeAsc.indexes, [1, 2, 3, 4])
  assert.equal(byAgeAsc.slots[1], 2)

  const byAgeDesc = names(db, 'age', 'desc', 10)
  assert.deepEqual(byAgeDesc.names, ['Ada', 'Cia', 'Deo', 'Bo'])
  assert.equal(byAgeDesc.slots[1], 2)

  const byName = names(db, 'userName', 'asc', 10)
  assert.deepEqual(byName.names, ['Ada', 'Cia', 'Bo', 'Deo'])
  assert.equal(byName.names[1], 'Cia')
})

test('釘選分頁的下一頁游標接上未釘選順序', () => {
  const db = freshDb()
  const bo = createPerson(db, input({ userName: 'Bo' }))
  const deo = createPerson(db, input({ userName: 'Deo' }))
  for (const userName of ['Ada', 'Cia', 'Eve', 'Fay']) {
    createPerson(db, input({ userName }))
  }
  setPin(db, bo.id, 1)
  setPin(db, deo.id, 4)

  const page = names(db, 'userName', 'asc', 3)
  assert.deepEqual(page.names, ['Bo', 'Ada', 'Cia'])
  assert.ok(page.nextCursor)

  const next = names(db, 'userName', 'asc', 3, page.nextCursor)
  assert.deepEqual(next.names, ['Deo', 'Eve', 'Fay'])
  assert.equal(next.nextCursor, null)

  const desc = names(db, 'userName', 'desc', 3)
  assert.deepEqual(desc.names, ['Bo', 'Fay', 'Eve'])
  const descNext = names(db, 'userName', 'desc', 3, desc.nextCursor)
  assert.deepEqual(descNext.names, ['Deo', 'Cia', 'Ada'])
})

test('目標位置已有釘選時，後面的連續釘選順延', () => {
  const db = freshDb()
  const ada = createPerson(db, input({ userName: 'Ada' }))
  const bo = createPerson(db, input({ userName: 'Bo' }))
  const cia = createPerson(db, input({ userName: 'Cia' }))
  createPerson(db, input({ userName: 'Deo' }))
  setPin(db, ada.id, 1)
  setPin(db, bo.id, 2)
  setPin(db, cia.id, 1)
  const page = names(db, 'userName', 'asc', 10)
  assert.deepEqual(page.names, ['Cia', 'Ada', 'Bo', 'Deo'])
  assert.deepEqual(page.slots, [1, 2, 3, null])
})

test('搜尋只回傳符合的列，不會把不符合的釘選列留在原位', () => {
  const db = freshDb()
  const bo = createPerson(db, input({ userName: 'Bo', location: 'Taipei' }))
  createPerson(db, input({ userName: 'Fay', location: 'Berlin', age: 42, dateStart: '2021-05-20' }))
  setPin(db, bo.id, 1)
  const page = listPeople(db, { sort: 'userName', dir: 'asc', q: 'Fay', cursor: null, limit: 10 })
  assert.deepEqual(page.rows.map((row) => row.userName), ['Fay'])
  assert.equal(page.rows[0].displayIndex, 1)

  const byAge = listPeople(db, { sort: 'age', dir: 'asc', q: '42', cursor: null, limit: 10 })
  assert.deepEqual(byAge.rows.map((row) => row.userName), ['Fay'])

  const byDate = listPeople(db, { sort: 'userName', dir: 'asc', q: '2021-05-20', cursor: null, limit: 10 })
  assert.deepEqual(byDate.rows.map((row) => row.userName), ['Fay'])
})

test('更新與刪除比對 updated_at，過期要求回 409', () => {
  const db = freshDb()
  const created = createPerson(db, input({ userName: 'Ada' }))
  assert.throws(() => updatePerson(db, created.id, input({ userName: 'Ada New' }), '2000-01-01T00:00:00.000Z'), {
    status: 409,
  })
  const updated = updatePerson(db, created.id, input({ userName: 'Ada New' }), created.updatedAt)
  assert.equal(updated.userName, 'Ada New')
  assert.throws(() => deletePerson(db, created.id, created.updatedAt), { status: 409 })
  deletePerson(db, created.id, updated.updatedAt)
  assert.equal(listPeople(db, { sort: 'userName', dir: 'asc', q: '', cursor: null, limit: 10 }).rows.length, 0)
})

test('相同搜尋會命中快取，寫入後快取清空', () => {
  const db = freshDb()
  const params = { sort: 'userName' as const, dir: 'asc' as const, q: '', cursor: null, limit: 10 }
  listPeopleCached(db, params)
  listPeopleCached(db, params)
  assert.equal(cacheStats(db).hits, 1)
  createPerson(db, input({ userName: 'Zara' }))
  const page = listPeopleCached(db, params).page
  assert.equal(page.rows[0]?.userName, 'Zara')
  assert.equal(cacheStats(db).hits, 1)
})

test('seed 後可用字首搜尋，且筆數正確', () => {
  const db = freshDb()
  seedDatabase(db, 40)
  assert.equal(listPeople(db, { sort: 'userName', dir: 'asc', q: '', cursor: null, limit: 10 }).total, 40)
  const page = listPeople(db, { sort: 'userName', dir: 'asc', q: 'Ada', cursor: null, limit: 50 })
  assert.ok(page.rows.length > 0)
  assert.ok(page.rows.every((row) => row.userName.startsWith('Ada')))
  assert.equal(userNameFor(0), 'Ada Chen 1')
})
