import {
  DEVICE_KEY,
  PIPELINE_KEY,
  TUNNEL_PENDING,
  TUNNEL_KEY,
  commissionInfoFor,
  isValidDate,
} from './tunnel-domain'
import type { EntryRow } from '@/data/types'

/**
 * 存量数据回填（只在版本迁移时跑一次，幂等）：
 * 1. 管廊补「权属单位」缺失列，值不明的留空，不拿默认值顶；
 * 2. 投运日期：登记值原样保留；待投运的不回填；早年没有投运日期的，
 *    按主口径（该廊非待登记管线的最早入廊日期）推定回填，并在「投运日期来源」里标明「推定值」；
 *    主口径推不出来就留空。对照口径（最早在册设备投运日期）只在视图里对照展示，不写账。
 */
export function migrateLegacyRows(
  rows: Record<string, EntryRow[]>,
): Record<string, EntryRow[]> {
  const tunnels = rows[TUNNEL_KEY] ?? []
  const pipelines = rows[PIPELINE_KEY] ?? []
  const devices = rows[DEVICE_KEY] ?? []

  const nextTunnels = tunnels.map((tunnel) => {
    const next: EntryRow = { ...tunnel }
    if (next['权属单位'] === undefined) {
      next['权属单位'] = ''
    }
    if (next['投运日期来源'] === undefined) {
      next['投运日期来源'] = ''
    }
    // 已经有登记值：来源补成「登记值」，日期绝不改。
    if (isValidDate(next['投运日期'])) {
      next['投运日期来源'] = '登记值'
      return next
    }
    // 待投运的不推定、不回填。
    if (String(next.status) === TUNNEL_PENDING) {
      next['投运日期'] = ''
      return next
    }
    const info = commissionInfoFor(next, pipelines, devices)
    if (info.source === '推定值') {
      next['投运日期'] = info.date
      next['投运日期来源'] = '推定值'
    } else {
      next['投运日期'] = ''
    }
    return next
  })

  // 老数据里舱室若不带管廊编号前缀，归属解析不出来就不拦、不补，保持原值。
  return { ...rows, [TUNNEL_KEY]: nextTunnels }
}
