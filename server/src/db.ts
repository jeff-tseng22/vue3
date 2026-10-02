import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

export type DB = Database.Database

const defaultPath = path.join(process.cwd(), 'data', 'people.db')

export function openDatabase(filename = process.env.PEOPLE_DB ?? defaultPath): DB {
  if (filename !== ':memory:') {
    fs.mkdirSync(path.dirname(filename), { recursive: true })
  }
  const db = new Database(filename)
  db.pragma('busy_timeout = 5000')
  if (filename !== ':memory:') {
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
  }
  return db
}
