<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import type { Person, PersonInput } from '../types'

const props = defineProps<{
  mode: 'add' | 'edit'
  person?: Person | null
}>()

const emit = defineEmits<{
  close: []
  submit: [input: PersonInput]
}>()

const error = ref('')
const form = reactive<PersonInput>({
  userName: '',
  position: '',
  location: '',
  age: 30,
  dateStart: today(),
})

watch(
  () => props.person,
  (person) => {
    if (!person) return
    form.userName = person.userName
    form.position = person.position
    form.location = person.location
    form.age = person.age
    form.dateStart = person.dateStart
  },
  { immediate: true },
)

const title = computed(() => (props.mode === 'add' ? 'Add record' : 'Edit record'))
const submitLabel = computed(() => (props.mode === 'add' ? 'Add' : 'Update'))

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

function submit() {
  error.value = ''
  const userName = form.userName.trim()
  const position = form.position.trim()
  const location = form.location.trim()
  if (!userName || !position || !location) {
    error.value = 'Name, position, and location are required'
    return
  }
  if (!Number.isInteger(form.age) || form.age < 0 || form.age > 150) {
    error.value = 'Age must be an integer from 0 to 150'
    return
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.dateStart)) {
    error.value = 'Start date must be YYYY-MM-DD'
    return
  }
  emit('submit', {
    userName,
    position,
    location,
    age: form.age,
    dateStart: form.dateStart,
  })
}

function today(): string {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}
</script>

<template>
  <div class="modal-root" @click.self="emit('close')">
    <form class="dialog" role="dialog" aria-modal="true" :aria-label="title" @submit.prevent="submit">
      <h2>{{ title }}</h2>
      <label>
        Name
        <input v-model="form.userName" name="userName" maxlength="80" required autocomplete="off" />
      </label>
      <label>
        Position
        <input v-model="form.position" name="position" maxlength="80" required autocomplete="off" />
      </label>
      <label>
        Location
        <input v-model="form.location" name="location" maxlength="80" required autocomplete="off" />
      </label>
      <label>
        Age
        <input v-model.number="form.age" name="age" type="number" min="0" max="150" step="1" required />
      </label>
      <label>
        Start date
        <input v-model="form.dateStart" name="dateStart" type="date" required />
      </label>
      <p v-if="error" class="form-error">{{ error }}</p>
      <div class="dialog-actions">
        <button type="button" class="button" @click="emit('close')">Cancel</button>
        <button type="submit" class="button primary">{{ submitLabel }}</button>
      </div>
    </form>
  </div>
</template>
