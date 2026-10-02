import {
  createPerson as createLocalPerson,
  deletePerson as deleteLocalPerson,
  listPeople as listLocalPeople,
  pinPerson as pinLocalPerson,
  updatePerson as updateLocalPerson,
} from './localPeople'
import type { Direction, PageResult, Person, PersonInput, SortKey } from './types'

const useLocal = import.meta.env.VITE_STATIC === '1'

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function listPeople(params: {
  sort: SortKey
  dir: Direction
  q: string
  cursor: string | null
}): Promise<PageResult> {
  if (useLocal) return listLocalPeople(params)
  const search = new URLSearchParams({ sort: params.sort, dir: params.dir })
  if (params.q) search.set('q', params.q)
  if (params.cursor) search.set('cursor', params.cursor)
  return request<PageResult>(`/api/people?${search.toString()}`)
}

export function createPerson(input: PersonInput): Promise<Person> {
  if (useLocal) return createLocalPerson(input)
  return request<Person>('/api/people', { method: 'POST', body: JSON.stringify(input) })
}

export function updatePerson(id: number, input: PersonInput, updatedAt: string): Promise<Person> {
  if (useLocal) return updateLocalPerson(id, input, updatedAt)
  return request<Person>(`/api/people/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...input, updatedAt }),
  })
}

export function deletePerson(id: number, updatedAt: string): Promise<void> {
  if (useLocal) return deleteLocalPerson(id, updatedAt)
  const search = new URLSearchParams({ updatedAt })
  return request<void>(`/api/people/${id}?${search.toString()}`, { method: 'DELETE' })
}

export function pinPerson(id: number, slot: number | null): Promise<void> {
  if (useLocal) return pinLocalPerson(id, slot)
  return request<void>(`/api/people/${id}/pin`, {
    method: 'PUT',
    body: JSON.stringify({ slot }),
  })
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (response.status === 204) return undefined as T
  const body = (await response.json().catch(() => null)) as { error?: string } | T | null
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && body.error ? body.error : 'Request failed'
    throw new ApiError(response.status, message)
  }
  return body as T
}
