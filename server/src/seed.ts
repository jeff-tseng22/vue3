import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { clearCache } from './cache.ts'
import { openDatabase, type DB } from './db.ts'
import { createFts, createIndexes, createTable, createTriggers, dropAll, rebuildFts } from './schema.ts'

const FIRST = ['Ada', 'Bo', 'Cid', 'Dee', 'Eli', 'Fay', 'Gus', 'Hua', 'Ian', 'Joy']
const LAST = ['Chen', 'Lin', 'Wang', 'Park', 'Ng', 'Ito', 'Berg', 'Cole', 'Diaz', 'Shah']
const POSITIONS = ['Engineer', 'Manager', 'Analyst', 'Designer', 'Support', 'Researcher', 'Coordinator', 'Specialist']
const LOCATIONS = ['Taipei', 'Tokyo', 'Singapore', 'Berlin', 'Austin', 'London', 'Seoul', 'Sydney']

const DATES = Array.from({ length: 3650 }, (_, index) => {
  const date = new Date(Date.UTC(2014, 0, 1))
  date.setUTCDate(date.getUTCDate() + index)
  return date.toISOString().slice(0, 10)
})

export function userNameFor(index: number): string {
  return `${FIRST[index % FIRST.length]} ${LAST[(index * 3) % LAST.length]} ${index + 1}`
}

export function seedDatabase(db: DB, count: number): void {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('筆數必須是正整數')
  }
  const started = Date.now()
  console.log(`開始寫入 ${count.toLocaleString('zh-Hant')} 筆，既有資料會被取代`)
  dropAll(db)
  createTable(db)
  const now = new Date().toISOString()
  const insert = db.prepare(
    `INSERT INTO people (id, user_name, position, location, age, date_start, pin_slot, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
  )
  const batchSize = 5000
  const writeBatch = db.transaction((start: number, end: number) => {
    for (let index = start; index < end; index += 1) {
      insert.run(
        index + 1,
        userNameFor(index),
        POSITIONS[index % POSITIONS.length],
        LOCATIONS[index % LOCATIONS.length],
        18 + (index % 48),
        DATES[index % DATES.length],
        now,
      )
    }
  })
  db.pragma('synchronous = OFF')
  for (let start = 0; start < count; start += batchSize) {
    const end = Math.min(count, start + batchSize)
    writeBatch(start, end)
    if (end === count || end % 100_000 === 0) {
      console.log(`已寫入 ${end.toLocaleString('zh-Hant')} / ${count.toLocaleString('zh-Hant')}`)
    }
  }
  console.log('建立索引與搜尋全文索引')
  createIndexes(db)
  createFts(db)
  rebuildFts(db)
  createTriggers(db)
  db.pragma('synchronous = NORMAL')
  clearCache(db)
  console.log(`完成，耗時 ${((Date.now() - started) / 1000).toFixed(1)} 秒`)
}

function isDirectRun(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  return path.resolve(entry) === fileURLToPath(import.meta.url)
}

if (isDirectRun()) {
  const count = process.argv[2] ? Number(process.argv[2]) : 10_000
  if (!Number.isInteger(count) || count < 1) {
    console.error('用法：npm run seed -- 10000')
    process.exit(1)
  }
  const db = openDatabase()
  seedDatabase(db, count)
  db.close()
}
