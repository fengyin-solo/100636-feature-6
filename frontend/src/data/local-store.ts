import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// v2：管廊台账改版（片区对照、停用联动、投运日期回填），旧结构直接作废重播示例数据。
const STORAGE_KEY = 'urban-utility-tunnel:entries:v2'
const LOG_KEY = 'urban-utility-tunnel:action-logs:v2'

export type ActionLog = {
  key: string
  rowId: number
  action: string
  firstAt: string
  lastAt: string
  count: number
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function earliestDate(rows: EntryRow[], dateField: string, cabinPrefix: string): string {
  let earliest = ''
  for (const row of rows) {
    const cabin = String(row['所属舱室'] ?? '')
    if (!cabin.startsWith(`${cabinPrefix}-`)) {
      continue
    }
    const date = String(row[dateField] ?? '')
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && (earliest === '' || date < earliest)) {
      earliest = date
    }
  }
  return earliest
}

// 存量管廊投运日期回填：
// 统一口径（主口径）：没有投运日期的在运/检修老管廊，按其下最早一条入廊管线的入廊日期推定。
// 对照口径（只作对照）：按其下在册设备最早投运日推定。优先取管线口径，设备口径只存作对照，缺值一律保持空。
function backfillTunnelDates(store: Record<string, EntryRow[]>): void {
  const tunnels = store['tunnel'] ?? []
  const pipelines = store['pipeline'] ?? []
  const devices = store['device'] ?? []
  for (const tunnel of tunnels) {
    if (tunnel['投运日期口径']) {
      continue
    }
    if (String(tunnel.status) === '待投运') {
      // 还没投运的不推定，留空。
      tunnel['投运日期口径'] = '未投运'
      continue
    }
    const code = String(tunnel['管廊编号'] ?? '')
    const prefix = code.replace(/^TUNN-/, '')
    const fromPipeline = earliestDate(pipelines, '入廊日期', prefix)
    const fromDevice = earliestDate(devices, '投运日期', prefix)
    if (fromPipeline) {
      tunnel['投运日期'] = fromPipeline
      tunnel['投运日期口径'] = '推定（最早入廊管线）'
    } else if (fromDevice) {
      // 主口径没有管线可推时才退回设备日期，仍按“推定”入账，另一种取值没有可对照的管线日期。
      tunnel['投运日期'] = fromDevice
      tunnel['投运日期口径'] = '推定（最早在册设备）'
    } else {
      tunnel['投运日期口径'] = '无据可推'
    }
    if (fromPipeline && fromDevice && fromDevice !== fromPipeline) {
      tunnel['投运日期对照'] = `设备最早投运 ${fromDevice}`
    }
  }
}

// 管廊停用联动不在子项上持久化任何字段：管线/设备是否「随廊停用」全部由所属管廊
// 当前状态在读出时投影（见 local-service.projectRow），管廊重新投运标记即自动收回，不留脏标记。

function buildInitialStore(): Record<string, EntryRow[]> {
  const store = clone(SEED_ROWS)
  backfillTunnelDates(store)
  return store
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = buildInitialStore()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const merged = { ...fallback, ...parsed }
    // 投运日期回填对存量数据也每次读时纠一遍（管廊/管线补录后口径自动收敛）。
    backfillTunnelDates(merged)
    return merged
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function persistRows(store: Record<string, EntryRow[]>): void {
  cache = store
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  }
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  persistRows(next)
}

export function resetRows(key: string): EntryRow[] {
  const store = buildInitialStore()
  persistRows(store)
  resetActionLogs()
  return store[key] ?? []
}

export function storageKey(): string {
  return STORAGE_KEY
}

// 动作轨迹：同一个对象同一个动作连着触发多回，账上只落一条，后续几回并入同一条（count+1）。
let logCache: ActionLog[] | null = null

function readLogs(): ActionLog[] {
  if (logCache !== null) {
    return logCache
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    logCache = []
    return logCache
  }
  const raw = window.localStorage.getItem(LOG_KEY)
  logCache = raw ? (JSON.parse(raw) as ActionLog[]) : []
  return logCache
}

function persistLogs(logs: ActionLog[]): void {
  logCache = logs
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(LOG_KEY, JSON.stringify(logs))
  }
}

export function recordAction(key: string, rowId: number, action: string, at: string): ActionLog {
  const logs = readLogs()
  const index = logs.findIndex((item) => item.key === key && item.rowId === rowId && item.action === action)
  if (index >= 0) {
    logs[index] = { ...logs[index], lastAt: at, count: logs[index].count + 1 }
    persistLogs(logs)
    return logs[index]
  }
  const created: ActionLog = { key, rowId, action, firstAt: at, lastAt: at, count: 1 }
  persistLogs([created, ...logs])
  return created
}

export function listActionLogs(filterKey?: string, rowId?: number): ActionLog[] {
  return readLogs().filter(
    (item) => (filterKey === undefined || item.key === filterKey) && (rowId === undefined || item.rowId === rowId),
  )
}

export function resetActionLogs(): void {
  persistLogs([])
}
