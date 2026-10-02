export const PAGE_SIZE = 500
export const WINDOW_RADIUS = 2
export const ROW_HEIGHT = 52
export const CARD_HEIGHT = 176

export type SortKey = 'userName' | 'position' | 'location' | 'age' | 'dateStart'
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

export type PageResult = {
  rows: Person[]
  nextCursor: string | null
  total: number
  pageSize: number
}

export const SORT_LABELS: Record<SortKey, string> = {
  userName: 'Name',
  position: 'Position',
  location: 'Location',
  age: 'Age',
  dateStart: 'Start date',
}
