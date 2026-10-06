<template>
  <section class="zone-panel">
    <header class="zone-panel-head">
      <h3>{{ title }}</h3>
      <span class="zone-panel-tip">每个片区一行，读数与管廊明细同源 · 合计 {{ total.count }} 条 = 明细 {{ tunnelCount }} 条</span>
    </header>
    <table class="data-table zone-table">
      <thead>
        <tr>
          <th>所属片区</th>
          <th>管廊条数</th>
          <th>舱室数量合计</th>
          <th>运行中</th>
          <th>检修中</th>
          <th>待投运</th>
          <th>已停用</th>
          <th v-if="drillable">管廊明细</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.zone" :class="{ clickable: drillable }">
          <td>{{ row.zone }}</td>
          <td><strong>{{ row.count }}</strong></td>
          <td>{{ row.cabins }}</td>
          <td><span class="pill run">{{ row.running }}</span></td>
          <td><span class="pill repair">{{ row.repairing }}</span></td>
          <td><span class="pill pending">{{ row.pending }}</span></td>
          <td><span class="pill stop">{{ row.stopped }}</span></td>
          <td v-if="drillable">
            <button class="link" type="button" @click="go(row.zone)">查看 {{ row.count }} 条管廊 →</button>
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr class="zone-total">
          <td>{{ total.zone }}</td>
          <td>{{ total.count }}</td>
          <td>{{ total.cabins }}</td>
          <td>{{ total.running }}</td>
          <td>{{ total.repairing }}</td>
          <td>{{ total.pending }}</td>
          <td>{{ total.stopped }}</td>
          <td v-if="drillable">全部 {{ total.count }} 条</td>
        </tr>
      </tfoot>
    </table>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { zoneSummary, zoneTotals, listRows, dataRevision } from '@/api/local-service'
import type { ZoneSummaryRow } from '@/data/types'

withDefaults(
  defineProps<{
    title?: string
    drillable?: boolean
    refreshKey?: number
  }>(),
  { title: '片区管廊对照', drillable: false, refreshKey: 0 },
)

const emit = defineEmits<{ (e: 'drill', zone: string): void }>()

// dataRevision 是响应式的：任何动作落账后，三个入口的对照视图都会重读同一份聚合。
const rows = computed<ZoneSummaryRow[]>(() => {
  void dataRevision()
  return zoneSummary()
})

const total = computed<ZoneSummaryRow>(() => {
  void dataRevision()
  return zoneTotals()
})

const tunnelCount = computed(() => {
  void dataRevision()
  return listRows('tunnel').length
})

function go(zone: string) {
  emit('drill', zone)
}
</script>
