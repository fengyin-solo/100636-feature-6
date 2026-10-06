import { defineStore } from 'pinia'

import { OWNER_UNITS } from '@/domain/units'

type SessionState = {
  operator: string
  // 当前登录单位。归属之外的操作（含跨单位代提交）一律拒绝。
  unit: string
  units: readonly string[]
  shiftLabel: string
  scope: string
}

export const useSessionStore = defineStore('session', {
  state: (): SessionState => ({
    operator: '值班管理员',
    unit: OWNER_UNITS[0] as string,
    units: OWNER_UNITS as readonly string[],
    shiftLabel: '白班 08:00-20:00',
    scope: '城市地下综合管廊运行维护管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setUnit(unit: string) {
      this.unit = unit
    },
  },
})
