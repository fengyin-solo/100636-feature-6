import type { EntryRow } from '@/data/types'

/**
 * 管廊领域的唯一读数来源：
 * 片区对照视图、运营概览、值班台账、导出报表都从这里取数，保证条数处处一致。
 */

export const TUNNEL_KEY = 'tunnel'
export const PIPELINE_KEY = 'pipeline'
export const DEVICE_KEY = 'device'

export const TUNNEL_STATUSES = ['待投运', '运行中', '检修中', '已停用'] as const
export const TUNNEL_RUNNING = '运行中'
export const TUNNEL_MAINTAINING = '检修中'
export const TUNNEL_PENDING = '待投运'
export const TUNNEL_STOPPED = '已停用'

/** 舱室编码形如 GS-CDB-01-综合舱，前两段即管廊编号 GS-CDB-01。 */
const CABIN_RE = /^(GS-[A-Z]+-\d{2})-/

export function tunnelCodeOfCabin(cabin: string): string {
  const matched = CABIN_RE.exec(String(cabin ?? '').trim())
  return matched ? matched[1] : ''
}

export function asNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }
  const text = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false
  }
  const stamp = Date.parse(text)
  return !Number.isNaN(stamp) && text === new Date(stamp).toISOString().slice(0, 10)
}

export function minDate(a: string, b: string): string {
  return !a || b < a ? b : a
}

export type CommissionSource = '登记值' | '推定值' | ''

/** 单条管廊的投运日期口径。 */
export type CommissionInfo = {
  /** 生效值：登记值优先；无登记值时按主口径推定；都没有就留空，绝不用默认值顶。 */
  date: string
  source: CommissionSource
  /** 主口径：该廊非「待登记」管线的最早入廊日期。 */
  primary: string
  /** 对照口径（只留作对照，不参与生效）：该廊在册（未报废）设备的最早投运日期。 */
  alternative: string
  hasRecord: boolean
}

function tunnelIndex(rows: EntryRow[]): Map<string, EntryRow> {
  const map = new Map<string, EntryRow>()
  for (const row of rows) {
    map.set(String(row['管廊编号'] ?? ''), row)
  }
  return map
}

/** 推定一条管廊的投运日期。tunnel 仅在需要判定是否待投运时使用。 */
export function commissionInfoFor(
  tunnel: EntryRow,
  pipelines: EntryRow[],
  devices: EntryRow[],
): CommissionInfo {
  const code = String(tunnel['管廊编号'] ?? '')
  const recordDate = isValidDate(tunnel['投运日期']) ? tunnel['投运日期'] : ''
  let primary = ''
  let alternative = ''
  for (const pipe of pipelines) {
    if (tunnelCodeOfCabin(String(pipe['所属舱室'] ?? '')) !== code) {
      continue
    }
    // 主口径只认真正入廊的管线；「待登记」的不算。
    if (String(pipe.status) !== '待登记' && isValidDate(pipe['入廊日期'])) {
      primary = minDate(primary, pipe['入廊日期'])
    }
  }
  for (const device of devices) {
    if (tunnelCodeOfCabin(String(device['所属舱室'] ?? '')) !== code) {
      continue
    }
    // 对照口径看在册设备，报废设备不算在册。
    if (String(device.status) !== '已报废' && isValidDate(device['投运日期'])) {
      alternative = minDate(alternative, device['投运日期'])
    }
  }
  // 已落账的来源标记（迁移回填或投运动作写入）优先，避免重算时把「推定值」误判成「登记值」。
  const storedSource = tunnel['投运日期来源']
  if (recordDate) {
    const source: CommissionSource =
      storedSource === '推定值' ? '推定值' : '登记值'
    return { date: recordDate, source, primary, alternative, hasRecord: source === '登记值' }
  }
  if (primary) {
    return { date: primary, source: '推定值', primary, alternative, hasRecord: false }
  }
  return { date: '', source: '', primary, alternative, hasRecord: false }
}

export type EnrichedTunnel = EntryRow & {
  commissionDate: string
  commissionSource: CommissionSource
  commissionPrimary: string
  commissionAlternative: string
  runningPipelines: number
  onboardDevices: number
  stoppedPipelines: number
  stoppedDevices: number
  stoppedAlert: string
}

/**
 * 管线/设备在某条已停用管廊下时，读出来的随廊停用提示。
 * 管线只提示「运行中」的；设备提示在册（未报废）的；已迁出/报废/待登记的不打扰。
 */
export function stoppedNotice(
  cabin: string,
  tunnels: EntryRow[],
  index?: Map<string, EntryRow>,
  status = '',
  requireActiveStatus = '',
): string {
  const code = tunnelCodeOfCabin(cabin)
  if (!code) {
    return ''
  }
  const tunnel = (index ?? tunnelIndex(tunnels)).get(code)
  if (!tunnel || String(tunnel.status) !== TUNNEL_STOPPED) {
    return ''
  }
  if (requireActiveStatus && String(status) !== requireActiveStatus) {
    return ''
  }
  return `随廊停用挂账（所属 ${code} 已停用）`
}

export function enrichTunnels(
  tunnels: EntryRow[],
  pipelines: EntryRow[],
  devices: EntryRow[],
): EnrichedTunnel[] {
  const tIndex = tunnelIndex(tunnels)
  return tunnels.map((tunnel) => {
    const code = String(tunnel['管廊编号'] ?? '')
    const info = commissionInfoFor(tunnel, pipelines, devices)
    let runningPipelines = 0
    let onboardDevices = 0
    let stoppedPipelines = 0
    let stoppedDevices = 0
    const isStopped = String(tunnel.status) === TUNNEL_STOPPED
    for (const pipe of pipelines) {
      if (tunnelCodeOfCabin(String(pipe['所属舱室'] ?? '')) !== code) {
        continue
      }
      if (String(pipe.status) === '运行中') {
        runningPipelines += 1
        if (isStopped) {
          stoppedPipelines += 1
        }
      }
    }
    for (const device of devices) {
      if (tunnelCodeOfCabin(String(device['所属舱室'] ?? '')) !== code) {
        continue
      }
      if (String(device.status) !== '已报废') {
        onboardDevices += 1
        if (isStopped) {
          stoppedDevices += 1
        }
      }
    }
    const stoppedAlert =
      isStopped && (stoppedPipelines > 0 || stoppedDevices > 0)
        ? `廊下仍有${stoppedPipelines}条运行中管线、${stoppedDevices}台在册设备随廊停用挂账`
        : isStopped
          ? '管廊已停用，廊下无挂账对象'
          : ''
    return {
      ...tunnel,
      commissionDate: info.date,
      commissionSource: info.source,
      commissionPrimary: info.primary,
      commissionAlternative: info.alternative,
      runningPipelines,
      onboardDevices,
      stoppedPipelines,
      stoppedDevices,
      stoppedAlert,
    }
  })
}

export type ZoneRow = {
  zone: string
  tunnelCount: number
  cabinTotal: number
  running: number
  maintaining: number
  pending: number
  stopped: number
  stoppedPipelines: number
  stoppedDevices: number
}

/** 片区对照：每个片区一行。明细里有多少条，这里就合计多少条。 */
export function zoneSummary(enriched: EnrichedTunnel[]): ZoneRow[] {
  const map = new Map<string, ZoneRow>()
  for (const row of enriched) {
    const zone = String(row['所属片区'] ?? '未分片区')
    let item = map.get(zone)
    if (!item) {
      item = {
        zone,
        tunnelCount: 0,
        cabinTotal: 0,
        running: 0,
        maintaining: 0,
        pending: 0,
        stopped: 0,
        stoppedPipelines: 0,
        stoppedDevices: 0,
      }
      map.set(zone, item)
    }
    item.tunnelCount += 1
    item.cabinTotal += asNumber(row['舱室数量'])
    if (String(row.status) === TUNNEL_RUNNING) {
      item.running += 1
    } else if (String(row.status) === TUNNEL_MAINTAINING) {
      item.maintaining += 1
    } else if (String(row.status) === TUNNEL_PENDING) {
      item.pending += 1
    } else if (String(row.status) === TUNNEL_STOPPED) {
      item.stopped += 1
      item.stoppedPipelines += row.stoppedPipelines
      item.stoppedDevices += row.stoppedDevices
    }
  }
  return [...map.values()].sort((a, b) => a.zone.localeCompare(b.zone, 'zh-Hans-CN'))
}

export type TunnelKpis = {
  tunnelCount: number
  cabinTotal: number
  running: number
  maintaining: number
  pending: number
  stopped: number
  stoppedPipelines: number
  stoppedDevices: number
  zoneCount: number
}

/** 关键数值的唯一出口：对照视图、概览、值班台账三处共用。 */
export function tunnelKpis(zones: ZoneRow[]): TunnelKpis {
  return zones.reduce(
    (acc, row) => ({
      tunnelCount: acc.tunnelCount + row.tunnelCount,
      cabinTotal: acc.cabinTotal + row.cabinTotal,
      running: acc.running + row.running,
      maintaining: acc.maintaining + row.maintaining,
      pending: acc.pending + row.pending,
      stopped: acc.stopped + row.stopped,
      stoppedPipelines: acc.stoppedPipelines + row.stoppedPipelines,
      stoppedDevices: acc.stoppedDevices + row.stoppedDevices,
      zoneCount: zones.length,
    }),
    {
      tunnelCount: 0,
      cabinTotal: 0,
      running: 0,
      maintaining: 0,
      pending: 0,
      stopped: 0,
      stoppedPipelines: 0,
      stoppedDevices: 0,
      zoneCount: zones.length,
    },
  )
}

export type TunnelOverview = {
  zones: ZoneRow[]
  kpis: TunnelKpis
  enriched: EnrichedTunnel[]
}

/** 给一个读库函数，返回整套对照读数。 */
export function buildTunnelOverview(rowsByKey: (key: string) => EntryRow[]): TunnelOverview {
  const enriched = enrichTunnels(
    rowsByKey(TUNNEL_KEY),
    rowsByKey(PIPELINE_KEY),
    rowsByKey(DEVICE_KEY),
  )
  const zones = zoneSummary(enriched)
  return { zones, kpis: tunnelKpis(zones), enriched }
}

/** 管廊编号 -> 权属单位。 */
export function tunnelOwnerMap(tunnels: EntryRow[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const tunnel of tunnels) {
    map.set(String(tunnel['管廊编号'] ?? ''), String(tunnel['权属单位'] ?? ''))
  }
  return map
}

/** 设备权属随所属管廊。 */
export function ownerOfDevice(device: EntryRow, owners: Map<string, string>): string {
  return owners.get(tunnelCodeOfCabin(String(device['所属舱室'] ?? ''))) ?? ''
}

/** 管线按舱室落到管廊，再判断是否归属当前单位；舱室解析不出管廊时不做跨单位限制。 */
export function cabinWithinUnit(
  cabin: string,
  owners: Map<string, string>,
  unit: string,
): boolean {
  const owner = owners.get(tunnelCodeOfCabin(cabin))
  return owner === undefined || owner === '' || owner === unit
}
