import type { DB } from './db.ts'
import type { PageResult } from './types.ts'

const TTL_MS = 30_000
const MAX_ENTRIES = 200

type Bucket = {
  entries: Map<string, { expires: number; value: PageResult }>
  total: number | null
  hits: number
  misses: number
}

const buckets = new WeakMap<DB, Bucket>()

function bucket(db: DB): Bucket {
  let found = buckets.get(db)
  if (!found) {
    found = { entries: new Map(), total: null, hits: 0, misses: 0 }
    buckets.set(db, found)
  }
  return found
}

export function readCache(db: DB, key: string): PageResult | null {
  const store = bucket(db)
  const hit = store.entries.get(key)
  if (!hit) {
    store.misses += 1
    return null
  }
  if (hit.expires < Date.now()) {
    store.entries.delete(key)
    store.misses += 1
    return null
  }
  store.entries.delete(key)
  store.entries.set(key, hit)
  store.hits += 1
  return hit.value
}

export function writeCache(db: DB, key: string, value: PageResult): void {
  const store = bucket(db)
  if (store.entries.has(key)) store.entries.delete(key)
  if (store.entries.size >= MAX_ENTRIES) {
    const oldest = store.entries.keys().next().value
    if (oldest !== undefined) store.entries.delete(oldest)
  }
  store.entries.set(key, { expires: Date.now() + TTL_MS, value })
}

export function readTotal(db: DB): number | null {
  return bucket(db).total
}

export function writeTotal(db: DB, total: number): void {
  bucket(db).total = total
}

export function clearCache(db: DB): void {
  const store = bucket(db)
  store.entries.clear()
  store.total = null
}

export function cacheStats(db: DB): { hits: number; misses: number } {
  const store = bucket(db)
  return { hits: store.hits, misses: store.misses }
}
