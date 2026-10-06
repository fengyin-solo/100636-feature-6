import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'urban-utility-tunnel:entries'
const VERSION_KEY = 'urban-utility-tunnel:version'
// v2：管廊权属单位、业务化种子数据；存量投运日期由迁移器一次性回填。
const CURRENT_VERSION = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function ls(): Storage | null {
  const holder = globalThis as unknown as { localStorage?: Storage }
  return holder.localStorage ?? null
}

type StoredShape = Record<string, EntryRow[]>

function seedAll(): StoredShape {
  return clone(SEED_ROWS)
}

function readStorage(): StoredShape {
  const storage = ls()
  if (!storage) {
    return seedAll()
  }
  const raw = storage.getItem(STORAGE_KEY)
  if (!raw) {
    const fallback = seedAll()
    storage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    storage.setItem(VERSION_KEY, String(CURRENT_VERSION))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as StoredShape
    return { ...seedAll(), ...parsed }
  } catch {
    const fallback = seedAll()
    storage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: StoredShape | null = null

export function allRows(): StoredShape {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  ls()?.setItem(STORAGE_KEY, JSON.stringify(next))
}

export function saveAll(rows: StoredShape): void {
  cache = rows
  ls()?.setItem(STORAGE_KEY, JSON.stringify(rows))
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

/** 启动时跑一次：版本落后就交给迁移器处理，处理完写新版本号。 */
export function runStartupMigration(migrate: (rows: StoredShape) => StoredShape): void {
  const storage = ls()
  if (!storage) {
    return
  }
  const version = Number(storage.getItem(VERSION_KEY) ?? '1')
  const rows = allRows()
  const next = version >= CURRENT_VERSION ? rows : migrate(rows)
  saveAll(next)
  storage.setItem(VERSION_KEY, String(CURRENT_VERSION))
}

export function storageKey(): string {
  return STORAGE_KEY
}
