import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { recordTrail } from '@/domain/action-trail'
import {
  DEVICE_KEY,
  PIPELINE_KEY,
  TUNNEL_KEY,
  buildTunnelOverview,
  cabinWithinUnit,
  enrichTunnels,
  ownerOfDevice,
  stoppedNotice,
  tunnelCodeOfCabin,
  tunnelOwnerMap,
} from '@/domain/tunnel-domain'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
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

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(displayRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/** 领域视图读数：管线/设备带上所属管廊与随廊停用提示；管廊带上推定口径。 */
export function displayRows(key: string): EntryRow[] {
  if (key === TUNNEL_KEY) {
    return buildTunnelOverview(listRows).enriched
  }
  if (key === PIPELINE_KEY || key === DEVICE_KEY) {
    const tunnels = listRows(TUNNEL_KEY)
    const owners = tunnelOwnerMap(tunnels)
    // 管线只提示「运行中」；设备只提示在册（未报废）。
    const activeStatus = key === PIPELINE_KEY ? '运行中' : ''
    return listRows(key).map((row) => {
      const cabin = String(row['所属舱室'] ?? '')
      const rowStatus = String(row.status ?? '')
      const notice =
        key === DEVICE_KEY && rowStatus === '已报废'
          ? ''
          : stoppedNotice(cabin, tunnels, undefined, rowStatus, activeStatus)
      const owner =
        key === DEVICE_KEY
          ? ownerOfDevice(row, owners)
          : String(row['权属单位'] ?? '')
      const display: EntryRow = {
        ...row,
        所属管廊: tunnelCodeOfCabin(cabin),
        权属单位: owner || String(row['权属单位'] ?? ''),
        随廊停用提示: notice,
      }
      return display
    })
  }
  return listRows(key)
}

type Actor = { unit: string; operator: string }

export function runAction(
  key: string,
  id: number,
  action: string,
  actor?: Actor,
): ActionResult {
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
  const row = rows[index]
  const current = String(row.status)

  // 归属校验：归属之外的操作（含跨单位代提交）一律拒绝，且不进轨迹账。
  const unit = actor?.unit ?? ''
  const operator = actor?.operator ?? '值班管理员'
  if (unit) {
    const denied = ownershipDenied(key, row, unit)
    if (denied) {
      return { ok: false, message: denied }
    }
  }

  // 同一条记录重复提交同一个动作：状态不会再变，只并轨迹、不重复生效。
  if (current === target) {
    recordTrail({
      module: key,
      entity: meta.entity,
      rowId: id,
      code: codeOf(key, row),
      action,
      resultStatus: current,
      operator,
      unit,
      note: '重复触发，已并入同一条轨迹',
    })
    return {
      ok: true,
      merged: true,
      message: `${meta.entity}当前已是「${target}」，本次「${action}」未重复落账，已并入同一条轨迹`,
    }
  }

  // 管廊状态机：只有待投运能投运；已停用为终态，停用后不再受理任何流转。
  if (key === TUNNEL_KEY) {
    if (current === '已停用') {
      return { ok: false, message: '管廊已停用为终态，不能再办理投运或检修' }
    }
    if (action === '提交投运' && current !== '待投运') {
      return {
        ok: false,
        message: `只有「待投运」管廊能提交投运，当前为「${current}」；同一条管廊重复投运只生效一次`,
      }
    }
  }

  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...row,
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  // 提交投运落账时补投运日期与来源（存量回填之外的新增动作同样遵守口径）。
  if (key === TUNNEL_KEY && action === '提交投运') {
    updated['投运日期'] = todayText()
    updated['投运日期来源'] = '登记值'
    updated.pending = false
  }

  const next = [...rows]
  next[index] = updated
  saveRows(key, next)

  let note = ''
  if (key === TUNNEL_KEY && action === '停用管廊') {
    const { stoppedPipelines, stoppedDevices } = buildTunnelOverview(listRows).enriched.find(
      (item) => Number(item.id) === id,
    ) ?? { stoppedPipelines: 0, stoppedDevices: 0 }
    note =
      stoppedPipelines + stoppedDevices > 0
        ? `廊下${stoppedPipelines}条运行中管线、${stoppedDevices}台在册设备已随廊停用挂账`
        : ''
  }
  recordTrail({
    module: key,
    entity: meta.entity,
    rowId: id,
    code: codeOf(key, updated),
    action,
    resultStatus: target,
    operator,
    unit,
    note,
  })

  const suffix = note ? `；${note}` : ''
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」${suffix}` }
}

/** 归属判定：管廊看权属单位；管线看产权单位；设备随所属管廊；审批看申请单位。 */
function ownershipDenied(key: string, row: EntryRow, unit: string): string | '' {
  if (key === TUNNEL_KEY) {
    const owner = String(row['权属单位'] ?? '')
    if (owner && owner !== unit) {
      return `跨单位代提交已挡回：该管廊归属「${owner}」，当前单位「${unit}」无权操作`
    }
  } else if (key === PIPELINE_KEY) {
    const owner = String(row['权属单位'] ?? '')
    if (owner && owner !== unit) {
      return `跨单位代提交已挡回：该管线权属「${owner}」，当前单位「${unit}」无权操作`
    }
  } else if (key === DEVICE_KEY) {
    const owners = tunnelOwnerMap(listRows(TUNNEL_KEY))
    const owner = ownerOfDevice(row, owners)
    if (owner && owner !== unit) {
      return `跨单位代提交已挡回：该设备随所属管廊归属「${owner}」，当前单位「${unit}」无权操作`
    }
  } else if (key === 'entryapprove') {
    const applicant = String(row['申请单位'] ?? '')
    // 样例占位单位不在权属字典里，不参与跨单位拦截。
    if (applicant && !applicant.includes('样例') && applicant !== unit) {
      return `跨单位代提交已挡回：该申请由「${applicant}」发起，当前单位「${unit}」无权操作`
    }
  }
  // 舱室落在别的单位管廊里，也一并挡住（管廊主体归属优先）。
  if (key === PIPELINE_KEY || key === DEVICE_KEY) {
    const owners = tunnelOwnerMap(listRows(TUNNEL_KEY))
    if (!cabinWithinUnit(String(row['所属舱室'] ?? ''), owners, unit)) {
      return '跨单位代提交已挡回：所属舱室不在本单位管廊归属范围内'
    }
  }
  return ''
}

function codeOf(key: string, row: EntryRow): string {
  const field =
    key === TUNNEL_KEY
      ? '管廊编号'
      : key === PIPELINE_KEY
        ? '管线编号'
        : key === DEVICE_KEY
          ? '设备编号'
          : '编号'
  return String(row[field] ?? row.id ?? '')
}

function todayText(): string {
  return new Date().toISOString().slice(0, 10)
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const rows = displayRows(key)
  const header = reportHeader(key, meta.fields)
  const lines = [header.join(',')]
  for (const row of rows) {
    lines.push(reportLine(key, meta, row))
  }
  // 管廊报表尾部附片区对照合计：汇总与报表读数一致。
  if (key === TUNNEL_KEY) {
    const overview = buildTunnelOverview(listRows)
    lines.push('')
    lines.push(
      ['片区', '管廊条数', '舱室合计', '运行中', '检修中', '待投运', '已停用', '随廊停用管线', '随廊停用设备'].join(','),
    )
    for (const zone of overview.zones) {
      lines.push(
        [
          zone.zone,
          zone.tunnelCount,
          zone.cabinTotal,
          zone.running,
          zone.maintaining,
          zone.pending,
          zone.stopped,
          zone.stoppedPipelines,
          zone.stoppedDevices,
        ].join(','),
      )
    }
    const k = overview.kpis
    lines.push(
      ['合计', k.tunnelCount, k.cabinTotal, k.running, k.maintaining, k.pending, k.stopped, k.stoppedPipelines, k.stoppedDevices].join(','),
    )
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

function reportHeader(key: string, fields: string[]): string[] {
  if (key === TUNNEL_KEY) {
    return ['编号', ...fields, '投运日期(生效)', '日期来源', '对照口径:最早在册设备投运', '当前状态', '随廊停用挂账']
  }
  if (key === PIPELINE_KEY || key === DEVICE_KEY) {
    return ['编号', ...fields, '所属管廊', '当前状态', '随廊停用提示']
  }
  return ['编号', ...fields, '当前状态']
}

function reportLine(key: string, meta: ModuleMeta, row: EntryRow): string {
  const cells = (values: unknown[]) =>
    values.map((value) => String(value ?? '').trim()).join(',')
  if (key === TUNNEL_KEY) {
    return cells([
      row.id,
      ...meta.fields.map((field) => row[field] ?? ''),
      row.commissionDate ?? '',
      row.commissionSource ?? '',
      row.commissionAlternative ?? '',
      row.status,
      row.stoppedAlert ?? '',
    ])
  }
  if (key === PIPELINE_KEY || key === DEVICE_KEY) {
    return cells([
      row.id,
      ...meta.fields.map((field) => row[field] ?? ''),
      row['所属管廊'] ?? '',
      row.status,
      row['随廊停用提示'] ?? '',
    ])
  }
  return cells([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status])
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
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

/** 管廊对照读数（片区行 + KPI），概览页与值班台账共用这一份。 */
export function tunnelOverview() {
  return buildTunnelOverview(listRows)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  // 管廊/管线/设备三个模块按领域口径重算 pending/abnormal，保证各入口读数一致。
  const enriched = enrichTunnels(
    rows[TUNNEL_KEY] ?? [],
    rows[PIPELINE_KEY] ?? [],
    rows[DEVICE_KEY] ?? [],
  )

  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    let entries: EntryRow[] = rows[meta.key] ?? []
    if (meta.key === TUNNEL_KEY) {
      entries = enriched
    } else if (meta.key === PIPELINE_KEY || meta.key === DEVICE_KEY) {
      const tunnels = rows[TUNNEL_KEY] ?? []
      const owners = tunnelOwnerMap(tunnels)
      const activeStatus = meta.key === PIPELINE_KEY ? '运行中' : ''
      entries = entries.map((row) => {
        const cabin = String(row['所属舱室'] ?? '')
        const rowStatus = String(row.status ?? '')
        const notice =
          meta.key === DEVICE_KEY && rowStatus === '已报废'
            ? ''
            : stoppedNotice(cabin, tunnels, undefined, rowStatus, activeStatus)
        if (meta.key === DEVICE_KEY) {
          const owner = ownerOfDevice(row, owners)
          return { ...row, abnormal: row.abnormal || Boolean(notice), '权属单位': owner }
        }
        return { ...row, abnormal: row.abnormal || Boolean(notice) }
      })
    }
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
