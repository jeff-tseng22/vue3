<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import type { Person } from '../types'

const props = defineProps<{
  person: Person
  searching: boolean
}>()

const emit = defineEmits<{
  close: []
  pin: [slot: number]
  unpin: []
}>()

const slot = ref(props.person.pinSlot ?? (props.searching ? 1 : props.person.displayIndex))
const error = ref('')

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

function submit() {
  error.value = ''
  if (!Number.isInteger(slot.value) || slot.value < 1) {
    error.value = 'Enter an integer position of 1 or more'
    return
  }
  emit('pin', slot.value)
}
</script>

<template>
  <div class="modal-root" @click.self="emit('close')">
    <form class="dialog" role="dialog" aria-modal="true" aria-label="Pin position" @submit.prevent="submit">
      <h2>Pin {{ person.userName }}</h2>
      <p class="hint">
        After pinning, this record stays at position {{ slot || 'N' }} in the full list, no matter how you sort.
        <template v-if="searching">You are searching. The position is in the full list, not the search results.</template>
      </p>
      <label>
        Position
        <input v-model.number="slot" name="slot" type="number" min="1" step="1" required />
      </label>
      <p v-if="person.pinSlot" class="hint">Currently pinned at position {{ person.pinSlot }}.</p>
      <p v-if="error" class="form-error">{{ error }}</p>
      <div class="dialog-actions">
        <button v-if="person.pinSlot" type="button" class="button" @click="emit('unpin')">Remove pin</button>
        <button type="button" class="button" @click="emit('close')">Close</button>
        <button type="submit" class="button primary">Pin</button>
      </div>
    </form>
  </div>
</template>
