import { ref } from 'vue'

import { useSessionStore } from '@/stores/session'
import { MODULE_BY_KEY } from '@/data/modules'
import {
  listActionLogs,
  listRows,
  recordAction,
  resetRows,
  saveRows,
} from '@/data/local-store'

export { listRows }
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  ZoneSummaryRow,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 数据版本号：凡是会改账的动作都把它 +1，概览/对照/值班三处据此重新读数，保证两处条数一致。
// 用响应式 ref：任何页面改了账，所有引用它的对照/汇总都自动重读。
const revisionTick = ref(0)
export function dataRevision(): number {
  return revisionTick.value
}
export function bumpRevision(): void {
  revisionTick.value += 1
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

function nowStamp(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

/** 管廊分段代号：TUNN-JA -> JA，舱室编号 JA-01 给水舱 的前缀就是它。 */
export function tunnelCode(row: EntryRow): string {
  return String(row['管廊编号'] ?? '').replace(/^TUNN-/, '')
}

export function cabinPrefix(cabin: string): string {
  const match = /^([A-Z]+)-\d+/.exec(String(cabin ?? ''))
  return match ? match[1] : ''
}

export function findTunnelByCabin(cabin: string): EntryRow | undefined {
  const prefix = cabinPrefix(cabin)
  if (!prefix) {
    return undefined
  }
  return listRows('tunnel').find((row) => tunnelCode(row) === prefix)
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

function sortRows(rows: EntryRow[], meta: ModuleMeta): EntryRow[] {
  if (!meta.sortField) {
    return rows
  }
  const factor = meta.sortOrder === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const va = String(a[meta.sortField!] ?? '')
    const vb = String(b[meta.sortField!] ?? '')
    // 缺值（老记录补录常见）统一沉底，不许拿默认值顶上参与排序。
    if (!va && vb) {
      return 1
    }
    if (va && !vb) {
      return -1
    }
    return va < vb ? -factor : va > vb ? factor : 0
  })
}

// 读出投影：管线/设备是否随廊停用、是否因此挂异常，统一由所属管廊当前状态读出，
// 三个入口（管线台账、设备台账、运营概览）看到的标记完全一致，重新投运即自动收回。
function projectRow(meta: ModuleMeta, row: EntryRow): EntryRow {
  if (meta.key !== 'pipeline' && meta.key !== 'device') {
    return row
  }
  const tunnel = findTunnelByCabin(String(row['所属舱室'] ?? ''))
  const stopped = tunnel && String(tunnel.status) === '已停用'
  if (stopped) {
    const stillLive =
      meta.key === 'pipeline'
        ? ['运行中', '已入廊'].includes(String(row.status))
        : ['运行中', '待保养', '已保养'].includes(String(row.status))
    return { ...row, 随廊停用: '已随管廊停用', abnormal: row.abnormal || stillLive }
  }
  if (row['随廊停用']) {
    const { 随廊停用: _drop, ...rest } = row
    return rest as EntryRow
  }
  return row
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const meta = moduleMeta(key)
  const matched = sortRows(filterRows(listRows(key), filters), meta).map((row) => projectRow(meta, row))
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

function owningUnit(meta: ModuleMeta, row: EntryRow): string {
  return meta.ownerField ? String(row[meta.ownerField] ?? '') : ''
}

// 停用管廊时，把下面还在运行的入廊管线和在册设备汇总成提示，设备台账那边读到的就是同一批资产。
function collectStopWarnings(tunnel: EntryRow): string[] {
  const prefix = tunnelCode(tunnel)
  const warnings: string[] = []
  const livePipelines = listRows('pipeline').filter((row) => {
    const cabin = String(row['所属舱室'] ?? '')
    return cabin.startsWith(`${prefix}-`) && ['运行中', '已入廊'].includes(String(row.status))
  })
  const liveDevices = listRows('device').filter((row) => {
    const cabin = String(row['所属舱室'] ?? '')
    return cabin.startsWith(`${prefix}-`) && ['运行中', '待保养', '已保养'].includes(String(row.status))
  })
  if (livePipelines.length) {
    warnings.push(
      `仍有 ${livePipelines.length} 条在廊管线（${livePipelines
        .map((row) => String(row['管线编号']))
        .join('、')}）已随管廊停用并同步提示到入廊管线登记`,
    )
  }
  if (liveDevices.length) {
    warnings.push(
      `仍有 ${liveDevices.length} 台在册设备（${liveDevices
        .map((row) => String(row['设备编号']))
        .join('、')}）已随管廊停用并同步提示到设备台账`,
    )
  }
  return warnings
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = rows[index]

  // 跨单位代提交直接挡回：归属字段与当前操作单位不一致，归属之外的操作一律拒绝。
  if (meta.ownerField) {
    const owner = owningUnit(meta, current)
    const session = useSessionStore()
    if (owner && owner !== session.orgUnit) {
      return {
        ok: false,
        message: `跨单位操作被拒绝：该${meta.entity}归属「${owner}」，当前操作单位为「${session.orgUnit}」，请归属单位本人提交`,
      }
    }
  }

  const statusNow = String(current.status)

  // 同一动作连着触发：账上只落一条，往同一条轨迹里并（首次记录、末次时间、触发次数）。
  const log = recordAction(key, id, action, nowStamp())

  // 同一条管廊重复提交投运只生效一次：已经是运行中，再点提交投运直接挡回，不重复落账。
  if (statusNow === target) {
    return {
      ok: false,
      message:
        log.count > 1
          ? `${meta.entity}已经是「${target}」，本次为第 ${log.count} 次重复提交，已并入同一条轨迹，账上只落一条`
          : `${meta.entity}已经是「${target}」，不用重复操作`,
    }
  }

  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...current,
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  // 提交投运落账：存量没投运日期的，以本次投运日期为准，口径记为“本次补录”。
  if (key === 'tunnel' && action === '提交投运' && !String(updated['投运日期'] ?? '').trim()) {
    updated['投运日期'] = new Date().toISOString().slice(0, 10)
    updated['投运日期口径'] = '本次补录'
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  bumpRevision()

  if (key === 'tunnel' && action === '停用管廊') {
    const warnings = collectStopWarnings(updated)
    return {
      ok: true,
      message: `${meta.entity}已${action}，当前状态「${target}」（动作已并入轨迹，累计触发 ${log.count} 次）`,
      warnings,
    }
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」（累计触发 ${log.count} 次）` }
}

/**
 * 片区对照视图：管廊台账 / 运营概览 / 值班台账 / 汇总报表共用这一份读数。
 * 行内条数全部由管廊明细实时聚合，对照视图的合计与明细条数必然对得上。
 */
export function zoneSummary(filters: Record<string, string> = {}): ZoneSummaryRow[] {
  const tunnels = filterRows(listRows('tunnel'), filters)
  const byZone = new Map<string, ZoneSummaryRow>()
  for (const row of tunnels) {
    const zone = String(row['所属片区'] ?? '未划分片区')
    if (!byZone.has(zone)) {
      byZone.set(zone, { zone, count: 0, cabins: 0, running: 0, repairing: 0, pending: 0, stopped: 0 })
    }
    const line = byZone.get(zone)!
    line.count += 1
    line.cabins += Number(row['舱室数量']) || 0
    switch (String(row.status)) {
      case '运行中':
        line.running += 1
        break
      case '检修中':
        line.repairing += 1
        break
      case '待投运':
        line.pending += 1
        break
      case '已停用':
        line.stopped += 1
        break
    }
  }
  return [...byZone.values()]
}

export function zoneTotals(filters: Record<string, string> = {}): ZoneSummaryRow {
  const rows = zoneSummary(filters)
  return rows.reduce<ZoneSummaryRow>(
    (total, row) => ({
      zone: total.zone,
      count: total.count + row.count,
      cabins: total.cabins + row.cabins,
      running: total.running + row.running,
      repairing: total.repairing + row.repairing,
      pending: total.pending + row.pending,
      stopped: total.stopped + row.stopped,
    }),
    { zone: '合计', count: 0, cabins: 0, running: 0, repairing: 0, pending: 0, stopped: 0 },
  )
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  bumpRevision()
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listEntries(key).items) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

// 管廊片区对照报表：读数直接取自 zoneSummary，和概览、值班台账、明细完全同源。
export function exportZoneReport(): { filename: string; content: string } {
  const rows = zoneSummary()
  const header = ['所属片区', '管廊条数', '舱室合计', '运行中', '检修中', '待投运', '已停用']
  const lines = [header.join(',')]
  for (const row of rows) {
    lines.push([row.zone, row.count, row.cabins, row.running, row.repairing, row.pending, row.stopped].join(','))
  }
  const total = zoneTotals()
  lines.push([total.zone, total.count, total.cabins, total.running, total.repairing, total.pending, total.stopped].join(','))
  // 尾注做口径校验：明细条数必须等于对照合计。
  lines.push(`口径校验,明细管廊 ${listRows('tunnel').length} 条 = 对照合计 ${total.count} 条`)
  return { filename: '管廊片区对照报表.csv', content: `﻿${lines.join('\n')}` }
}

export function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  downloadText(filename, content)
}

// 管廊动作轨迹：同一动作多回触发只保留一条，次数并进去，供明细页查看。
export function actionTrail(key: string, rowId: number): { action: string; count: number; firstAt: string; lastAt: string }[] {
  return listActionLogs(key, rowId).map((item) => ({
    action: item.action,
    count: item.count,
    firstAt: item.firstAt,
    lastAt: item.lastAt,
  }))
}

export function loadOverview(): OverviewResult {
  // 模块读数走和列表完全相同的读出投影：随廊停用引起的异常量与各台账、报表一致。
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = listEntries(meta.key).items
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
