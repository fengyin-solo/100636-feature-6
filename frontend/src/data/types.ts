/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  /** 归属字段：有值时，跨单位的操作会被服务层直接挡回。 */
  ownerField?: string
  /** 列表默认排序字段（如处置记录按发现日期倒排）。 */
  sortField?: string
  sortOrder?: 'desc' | 'asc'
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
  /** 生效但需要跟着提示的关联事项，例如停用管廊时仍在运行的管线/设备。 */
  warnings?: string[]
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 片区对照视图一行：所有展示面（管廊台账、运营概览、值班台账、报表）都从这份数据读数。 */
export type ZoneSummaryRow = {
  zone: string
  count: number
  cabins: number
  running: number
  repairing: number
  pending: number
  stopped: number
}
