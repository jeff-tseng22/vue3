<script setup lang="ts">
import { useVirtualizer } from '@tanstack/vue-virtual'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import ConfirmDialog from './ConfirmDialog.vue'
import PersonDialog from './PersonDialog.vue'
import PinDialog from './PinDialog.vue'
import { usePeopleStore } from '../stores/people'
import {
  CARD_HEIGHT,
  PAGE_SIZE,
  ROW_HEIGHT,
  SORT_LABELS,
  type Person,
  type PersonInput,
  type SortKey,
} from '../types'

const store = usePeopleStore()
const { rows, startPage, total, query, sort, dir, loading, error, revision } = storeToRefs(store)

const keyword = ref('')
const compact = ref(window.matchMedia('(max-width: 767px)').matches)
const parentRef = ref<HTMLElement | null>(null)
const formMode = ref<'add' | 'edit' | null>(null)
const editing = ref<Person | null>(null)
const pendingUpdate = ref<{ person: Person; input: PersonInput } | null>(null)
const pendingDelete = ref<Person | null>(null)
const pinning = ref<Person | null>(null)
const notice = ref('')
const saving = ref(false)
let lastAnchor = 0
let debounceTimer = 0

const rowHeight = computed(() => (compact.value ? CARD_HEIGHT : ROW_HEIGHT))
const paddingStart = computed(() => startPage.value * PAGE_SIZE * rowHeight.value)

const virtualizer = useVirtualizer(
  computed(() => ({
    count: rows.value.length,
    getScrollElement: () => parentRef.value,
    estimateSize: () => rowHeight.value,
    overscan: 8,
    paddingStart: paddingStart.value,
  })),
)

const virtualRows = computed(() => virtualizer.value.getVirtualItems())
const totalSize = computed(() => virtualizer.value.getTotalSize())

const sortKeys = Object.keys(SORT_LABELS) as SortKey[]

watch(revision, () => {
  lastAnchor = 0
  if (parentRef.value) parentRef.value.scrollTop = 0
})

watch([sort, dir, query], () => {
  store.reload()
})

onMounted(() => {
  window.addEventListener('resize', syncCompact)
  store.reload()
})

onUnmounted(() => {
  window.removeEventListener('resize', syncCompact)
  window.clearTimeout(debounceTimer)
})

function syncCompact() {
  const next = window.matchMedia('(max-width: 767px)').matches
  if (next === compact.value) return
  compact.value = next
  store.reload()
}

function onKeyword(event: Event) {
  const value = (event.target as HTMLInputElement).value
  keyword.value = value
  window.clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(() => {
    store.setQuery(value)
  }, 300)
}

function onScroll(event: Event) {
  const element = event.target as HTMLElement
  const index = Math.floor(element.scrollTop / rowHeight.value)
  const anchor = Math.max(0, Math.floor(index / PAGE_SIZE))
  if (anchor === lastAnchor) return
  lastAnchor = anchor
  store.schedule(anchor)
}

function openAdd() {
  editing.value = null
  formMode.value = 'add'
}

function openEdit(person: Person) {
  editing.value = person
  formMode.value = 'edit'
}

async function onFormSubmit(input: PersonInput) {
  if (formMode.value === 'add') {
    const ok = await run(() => store.add(input), 'Added')
    if (ok) formMode.value = null
    return
  }
  if (editing.value) pendingUpdate.value = { person: editing.value, input }
}

async function confirmUpdate() {
  const pending = pendingUpdate.value
  if (!pending) return
  const ok = await run(() => store.save(pending.person.id, pending.input, pending.person.updatedAt), 'Updated')
  pendingUpdate.value = null
  if (ok) {
    formMode.value = null
    editing.value = null
  }
}

async function confirmDelete() {
  const person = pendingDelete.value
  if (!person) return
  const ok = await run(() => store.remove(person.id, person.updatedAt), 'Deleted')
  if (ok) pendingDelete.value = null
}

async function confirmPin(slot: number) {
  const person = pinning.value
  if (!person) return
  const ok = await run(() => store.pin(person.id, slot), `Pinned at position ${slot}`)
  if (ok) pinning.value = null
}

async function confirmUnpin() {
  const person = pinning.value
  if (!person) return
  const ok = await run(() => store.pin(person.id, null), 'Pin removed')
  if (ok) pinning.value = null
}

async function run(action: () => Promise<void>, done: string) {
  saving.value = true
  notice.value = ''
  try {
    await action()
    notice.value = done
    return true
  } catch (err) {
    store.error = err instanceof Error ? err.message : 'Action failed'
    return false
  } finally {
    saving.value = false
  }
}

function rowClass(person: Person) {
  return person.pinSlot ? 'pinned' : ''
}
</script>

<template>
  <div class="app">
    <header class="top">
      <div>
        <h1>People</h1>
        <p class="sub">{{ total.toLocaleString('en-US') }} records, 500 loaded at a time</p>
      </div>
      <button type="button" class="button primary" :disabled="saving" @click="openAdd">Add</button>
    </header>

    <div class="toolbar">
      <label class="search-label">
        <span class="sr-only">Search</span>
        <input
          class="search"
          :value="keyword"
          placeholder="Search name, position, location, age, or start date"
          @input="onKeyword"
        />
      </label>
      <div class="mobile-only sort-row">
        <label>
          Sort
          <select :value="sort" @change="store.setSortKey(($event.target as HTMLSelectElement).value as SortKey)">
            <option v-for="key in sortKeys" :key="key" :value="key">{{ SORT_LABELS[key] }}</option>
          </select>
        </label>
        <button type="button" class="button" @click="store.toggleDir">
          {{ dir === 'asc' ? 'Ascending' : 'Descending' }}
        </button>
      </div>
      <p class="status">{{ loading ? 'Loading…' : notice }}</p>
    </div>
    <p class="hint bar">Search matches the start of each field. A full date or an age is matched exactly.</p>
    <p v-if="query" class="hint bar">Pins fix a position in the full list. A search only shows matching records.</p>
    <p v-if="error" class="banner" role="alert">{{ error }}</p>

    <div class="head-wrap desktop-only" aria-hidden="false">
      <div class="cols head" role="row">
        <span>#</span>
        <button
          v-for="key in sortKeys"
          :key="key"
          type="button"
          class="sort-button"
          :aria-sort="sort === key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'"
          @click="store.setSort(key)"
        >
          {{ SORT_LABELS[key] }}
          <span v-if="sort === key">{{ dir === 'asc' ? '▲' : '▼' }}</span>
        </button>
        <span>Actions</span>
      </div>
    </div>

    <div ref="parentRef" class="scroller" @scroll="onScroll">
      <p v-if="!loading && rows.length === 0" class="empty">No matching records</p>
      <div class="spacer" :style="{ height: `${totalSize}px` }">
        <div
          v-for="item in virtualRows"
          :key="rows[item.index]?.id ?? item.index"
          class="virtual-row"
          :class="rows[item.index] ? rowClass(rows[item.index]) : ''"
          :style="{ height: `${item.size}px`, transform: `translateY(${item.start}px)` }"
        >
          <article v-if="rows[item.index]" class="cols record" :class="{ card: compact }">
            <span class="index">{{ rows[item.index].displayIndex }}</span>
            <span class="name">
              {{ rows[item.index].userName }}
              <em v-if="rows[item.index].pinSlot" class="badge">Pinned</em>
            </span>
            <span><span class="mobile-label">Position</span>{{ rows[item.index].position }}</span>
            <span><span class="mobile-label">Location</span>{{ rows[item.index].location }}</span>
            <span><span class="mobile-label">Age</span>{{ rows[item.index].age }}</span>
            <span><span class="mobile-label">Start date</span>{{ rows[item.index].dateStart }}</span>
            <span class="actions">
              <button type="button" class="button" @click="openEdit(rows[item.index])">Edit</button>
              <button type="button" class="button danger" @click="pendingDelete = rows[item.index]">Delete</button>
              <button type="button" class="button" @click="pinning = rows[item.index]">Pin</button>
            </span>
          </article>
        </div>
      </div>
    </div>

    <PersonDialog
      v-if="formMode"
      :mode="formMode"
      :person="editing"
      @close="formMode = null"
      @submit="onFormSubmit"
    />
    <ConfirmDialog
      v-if="pendingUpdate"
      title="Confirm update"
      :message="`Update “${pendingUpdate.person.userName}”?`"
      confirm-label="Update"
      @cancel="pendingUpdate = null"
      @confirm="confirmUpdate"
    />
    <ConfirmDialog
      v-if="pendingDelete"
      title="Confirm delete"
      :message="`Delete “${pendingDelete.userName}”? This cannot be undone.`"
      confirm-label="Delete"
      danger
      @cancel="pendingDelete = null"
      @confirm="confirmDelete"
    />
    <PinDialog
      v-if="pinning"
      :person="pinning"
      :searching="query.length > 0"
      @close="pinning = null"
      @pin="confirmPin"
      @unpin="confirmUnpin"
    />
  </div>
</template>
