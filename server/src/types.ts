export const PAGE_SIZE = 500

export const SORT_KEYS = ['userName', 'position', 'location', 'age', 'dateStart'] as const

export type SortKey = (typeof SORT_KEYS)[number]

export type Direction = 'asc' | 'desc'

export type PersonInput = {
  userName: string
  position: string
  location: string
  age: number
  dateStart: string
}

export type Person = PersonInput & {
  id: number
  pinSlot: number | null
  updatedAt: string
  displayIndex: number
}

export type DbPerson = {
  id: number
  user_name: string
  position: string
  location: string
  age: number
  date_start: string
  pin_slot: number | null
  updated_at: string
}

export type Cursor = {
  pageStart: number
  after: { value: string | number; id: number } | null
}

export type PageResult = {
  rows: Person[]
  nextCursor: string | null
  total: number
  pageSize: number
}

export type ListParams = {
  sort: SortKey
  dir: Direction
  q: string
  cursor: string | null
  limit: number
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
