// 动作轨迹：同一个动作连着触发多回，账上只落一条，后续几回并入同一条的轨迹。
// 与业务台账分开存：重置示例数据不会抹掉处置轨迹。

const TRAIL_KEY = 'urban-utility-tunnel:action-trails'

function storage(): Storage | null {
  const holder = globalThis as unknown as { localStorage?: Storage; window?: { localStorage?: Storage } }
  return holder.localStorage ?? holder.window?.localStorage ?? null
}

function read(): ActionTrail[] {
  const ls = storage()
  if (!ls) {
    return []
  }
  try {
    const raw = ls.getItem(TRAIL_KEY)
    const parsed = raw ? (JSON.parse(raw) as ActionTrail[]) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function write(trails: ActionTrail[]): void {
  storage()?.setItem(TRAIL_KEY, JSON.stringify(trails))
}

export type ActionTrail = {
  id: number
  module: string
  entity: string
  rowId: number
  code: string
  action: string
  resultStatus: string
  operator: string
  unit: string
  firstAt: string
  lastAt: string
  count: number
  note: string
}

export type TrailInput = {
  module: string
  entity: string
  rowId: number
  code: string
  action: string
  resultStatus: string
  operator: string
  unit: string
  note?: string
}

/**
 * 记一笔动作。与同一条记录上一次落账的动作、结果状态都相同，就算「连着又来一回」，
 * 只把次数 +1 并刷新最近时间；否则新开一条。
 * 被挡回（幂等拦截、跨单位、状态不允许）的调用不进账，调用方不要调本函数。
 */
export function recordTrail(input: TrailInput): ActionTrail {
  const trails = read()
  const now = new Date().toISOString()
  const last = trails[0]
  if (
    last &&
    last.module === input.module &&
    last.rowId === input.rowId &&
    last.action === input.action &&
    last.resultStatus === input.resultStatus
  ) {
    const merged: ActionTrail = {
      ...last,
      count: last.count + 1,
      lastAt: now,
      note: input.note ?? last.note,
    }
    trails[0] = merged
    write(trails)
    return merged
  }
  const trail: ActionTrail = {
    id: trails.reduce((max, item) => Math.max(max, item.id), 0) + 1,
    module: input.module,
    entity: input.entity,
    rowId: input.rowId,
    code: input.code,
    action: input.action,
    resultStatus: input.resultStatus,
    operator: input.operator,
    unit: input.unit,
    firstAt: now,
    lastAt: now,
    count: 1,
    note: input.note ?? '',
  }
  trails.unshift(trail)
  write(trails)
  return trail
}

export function listTrails(moduleFilter?: string): ActionTrail[] {
  const trails = read()
  return moduleFilter ? trails.filter((item) => item.module === moduleFilter) : trails
}

export function resetTrails(): void {
  write([])
}
