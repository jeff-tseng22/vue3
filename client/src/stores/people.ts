import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { createPerson, deletePerson, listPeople, pinPerson, updatePerson } from '../api'
import { PAGE_SIZE, WINDOW_RADIUS, type Direction, type Person, type PersonInput, type SortKey } from '../types'

export const usePeopleStore = defineStore('people', () => {
  const rows = shallowRef<Person[]>([])
  const startPage = ref(0)
  const total = ref(0)
  const query = ref('')
  const sort = ref<SortKey>('userName')
  const dir = ref<Direction>('asc')
  const loading = ref(false)
  const error = ref('')
  const revision = ref(0)

  const pageData = new Map<number, Person[]>()
  const cursors = new Map<number, string | null>()
  let endPage: number | null = null
  let generation = 0
  let filling = false
  let pendingAnchor: number | null = null

  function reload() {
    generation += 1
    pageData.clear()
    cursors.clear()
    cursors.set(0, null)
    endPage = null
    rows.value = []
    startPage.value = 0
    error.value = ''
    revision.value += 1
    void schedule(0)
  }

  function schedule(anchor: number) {
    pendingAnchor = anchor
    if (filling) return
    filling = true
    void pump()
  }

  async function pump() {
    try {
      while (pendingAnchor !== null) {
        const anchor = pendingAnchor
        const gen = generation
        pendingAnchor = null
        await fill(anchor, gen)
      }
    } finally {
      filling = false
      if (pendingAnchor !== null) {
        filling = true
        void pump()
      }
    }
  }

  async function fill(anchor: number, gen: number) {
    const from = Math.max(0, anchor - WINDOW_RADIUS)
    const to = anchor + WINDOW_RADIUS
    loading.value = true
    try {
      for (let page = from; page <= to; page += 1) {
        if (gen !== generation) return
        if (endPage !== null && page > endPage) break
        if (pageData.has(page)) continue
        if (!cursors.has(page)) break
        const result = await listPeople({
          sort: sort.value,
          dir: dir.value,
          q: query.value,
          cursor: cursors.get(page) ?? null,
        })
        if (gen !== generation) return
        total.value = result.total
        if (result.rows.length === 0) {
          endPage = page === 0 ? 0 : page - 1
          if (page === 0) pageData.set(0, [])
          break
        }
        pageData.set(page, result.rows)
        if (result.nextCursor) cursors.set(page + 1, result.nextCursor)
        else endPage = page
      }
    } catch (err) {
      if (gen === generation) error.value = err instanceof Error ? err.message : 'Failed to load'
      return
    } finally {
      if (gen === generation) loading.value = false
    }
    publish(anchor, gen)
  }

  function publish(anchor: number, gen: number) {
    if (gen !== generation) return
    const from = Math.max(0, anchor - WINDOW_RADIUS)
    let to = anchor + WINDOW_RADIUS
    if (endPage !== null) to = Math.min(to, endPage)
    for (const key of [...pageData.keys()]) {
      if (key < from || key > to) pageData.delete(key)
    }
    let first = from
    while (first <= to && !pageData.has(first)) first += 1
    const list: Person[] = []
    for (let page = first; page <= to; page += 1) {
      const chunk = pageData.get(page)
      if (!chunk) break
      list.push(...chunk)
    }
    startPage.value = Number.isFinite(first) && pageData.has(first) ? first : 0
    rows.value = list
  }

  async function add(input: PersonInput) {
    await createPerson(input)
    reload()
  }

  async function save(id: number, input: PersonInput, updatedAt: string) {
    await updatePerson(id, input, updatedAt)
    reload()
  }

  async function remove(id: number, updatedAt: string) {
    await deletePerson(id, updatedAt)
    reload()
  }

  async function pin(id: number, slot: number | null) {
    await pinPerson(id, slot)
    reload()
  }

  function setQuery(value: string) {
    query.value = value.trim()
  }

  function setSort(next: SortKey) {
    if (sort.value === next) dir.value = dir.value === 'asc' ? 'desc' : 'asc'
    else {
      sort.value = next
      dir.value = 'asc'
    }
  }

  function setSortKey(next: SortKey) {
    sort.value = next
  }

  function toggleDir() {
    dir.value = dir.value === 'asc' ? 'desc' : 'asc'
  }

  if (import.meta.env.DEV) {
    ;(window as unknown as { __peopleDebug?: () => unknown }).__peopleDebug = () => ({
      loaded: rows.value.length,
      startPage: startPage.value,
      pageSize: PAGE_SIZE,
    })
  }

  return {
    rows,
    startPage,
    total,
    query,
    sort,
    dir,
    loading,
    error,
    revision,
    reload,
    schedule,
    add,
    save,
    remove,
    pin,
    setQuery,
    setSort,
    setSortKey,
    toggleDir,
  }
})
