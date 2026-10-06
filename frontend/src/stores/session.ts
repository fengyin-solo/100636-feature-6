import { defineStore } from 'pinia'

// 平台里涉及的管廊权属单位：当前操作单位决定能不能动这条账。
export const ORG_UNITS = [
  '江海市政管廊运维公司',
  '空港新城建设投资集团',
  '城市公用事业发展中心',
  '临港港务运维分公司',
]

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    // 当前操作单位（可在页头切换）：归属之外的操作一律拒绝、跨单位代提交直接挡回。
    orgUnit: ORG_UNITS[0],
    scope: '城市地下综合管廊运行维护管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setOrgUnit(unit: string) {
      this.orgUnit = unit
    },
  },
})
