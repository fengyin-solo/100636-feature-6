/** 权属单位字典：管廊归属、管线产权、跨单位代提交拦截都以这里为准。 */

export const OWNER_UNITS = [
  '市城投管廊运营公司',
  '高新区市政公司',
  '临空发展集团',
  '市水务集团',
  '市燃气集团',
  '市供电公司',
  '市城建通信管道公司',
  '城东热力公司',
] as const

/** 管廊权属单位（只有这几家拥有管廊主体）。 */
export const TUNNEL_OWNER_UNITS = [
  '市城投管廊运营公司',
  '高新区市政公司',
  '临空发展集团',
] as const

export function isKnownUnit(unit: string): boolean {
  return (OWNER_UNITS as readonly string[]).includes(unit)
}
