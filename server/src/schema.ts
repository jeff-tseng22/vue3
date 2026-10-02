import type { DB } from './db.ts'

const TRIGGERS = ['people_ai', 'people_ad', 'people_au'] as const

export function dropAll(db: DB): void {
  for (const name of TRIGGERS) {
    db.exec(`DROP TRIGGER IF EXISTS ${name}`)
  }
  db.exec('DROP TABLE IF EXISTS people_fts')
  db.exec('DROP TABLE IF EXISTS people')
}

export function createTable(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY,
      user_name TEXT NOT NULL,
      position TEXT NOT NULL,
      location TEXT NOT NULL,
      age INTEGER NOT NULL,
      date_start TEXT NOT NULL,
      pin_slot INTEGER UNIQUE,
      updated_at TEXT NOT NULL
    )
  `)
}

export function createIndexes(db: DB): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_people_user_name ON people(user_name, id);
    CREATE INDEX IF NOT EXISTS idx_people_position ON people(position, id);
    CREATE INDEX IF NOT EXISTS idx_people_location ON people(location, id);
    CREATE INDEX IF NOT EXISTS idx_people_age ON people(age, id);
    CREATE INDEX IF NOT EXISTS idx_people_date_start ON people(date_start, id);
    CREATE INDEX IF NOT EXISTS idx_people_pin_slot ON people(pin_slot) WHERE pin_slot IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_people_unpinned_user_name ON people(user_name, id) WHERE pin_slot IS NULL;
    CREATE INDEX IF NOT EXISTS idx_people_unpinned_position ON people(position, id) WHERE pin_slot IS NULL;
    CREATE INDEX IF NOT EXISTS idx_people_unpinned_location ON people(location, id) WHERE pin_slot IS NULL;
    CREATE INDEX IF NOT EXISTS idx_people_unpinned_age ON people(age, id) WHERE pin_slot IS NULL;
    CREATE INDEX IF NOT EXISTS idx_people_unpinned_date_start ON people(date_start, id) WHERE pin_slot IS NULL;
  `)
}

export function createFts(db: DB): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS people_fts USING fts5(
      user_name,
      position,
      location,
      age,
      date_start,
      content='people',
      content_rowid='id',
      tokenize='unicode61'
    )
  `)
}

export function rebuildFts(db: DB): void {
  db.exec(`INSERT INTO people_fts(people_fts) VALUES('rebuild')`)
}

export function createTriggers(db: DB): void {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS people_ai AFTER INSERT ON people BEGIN
      INSERT INTO people_fts(rowid, user_name, position, location, age, date_start)
      VALUES (new.id, new.user_name, new.position, new.location, new.age, new.date_start);
    END;

    CREATE TRIGGER IF NOT EXISTS people_ad AFTER DELETE ON people BEGIN
      INSERT INTO people_fts(people_fts, rowid, user_name, position, location, age, date_start)
      VALUES ('delete', old.id, old.user_name, old.position, old.location, old.age, old.date_start);
    END;

    CREATE TRIGGER IF NOT EXISTS people_au AFTER UPDATE ON people BEGIN
      INSERT INTO people_fts(people_fts, rowid, user_name, position, location, age, date_start)
      VALUES ('delete', old.id, old.user_name, old.position, old.location, old.age, old.date_start);
      INSERT INTO people_fts(rowid, user_name, position, location, age, date_start)
      VALUES (new.id, new.user_name, new.position, new.location, new.age, new.date_start);
    END;
  `)
}

export function initSchema(db: DB): void {
  createTable(db)
  createIndexes(db)
  createFts(db)
  createTriggers(db)
}
