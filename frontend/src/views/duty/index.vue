<template>
  <section class="page" data-module="duty">
    <header class="page-head">
      <div>
        <h2>运维值班交接管理</h2>
        <p class="page-desc">值班台账同步呈现管廊主体台账的关键数值，两处条数一致、同源读数。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出运维值班交接清单</button>
      </div>
    </header>

    <div class="kpi-strip">
      <RouterLink class="kpi-item" to="/tunnel">
        <span class="stat-label">管廊条数（片区）</span>
        <strong>{{ tunnelData.kpis.tunnelCount }} <em>/ {{ tunnelData.kpis.zoneCount }}</em></strong>
      </RouterLink>
      <RouterLink class="kpi-item" to="/tunnel">
        <span class="stat-label">舱室合计</span>
        <strong>{{ tunnelData.kpis.cabinTotal }}</strong>
      </RouterLink>
      <RouterLink class="kpi-item status-running" to="/tunnel?status=运行中">
        <span class="stat-label">运行中</span>
        <strong>{{ tunnelData.kpis.running }}</strong>
      </RouterLink>
      <RouterLink class="kpi-item status-maintaining" to="/tunnel?status=检修中">
        <span class="stat-label">检修中</span>
        <strong>{{ tunnelData.kpis.maintaining }}</strong>
      </RouterLink>
      <RouterLink class="kpi-item" to="/tunnel?status=待投运">
        <span class="stat-label">待投运</span>
        <strong>{{ tunnelData.kpis.pending }}</strong>
      </RouterLink>
      <RouterLink class="kpi-item status-stopped" to="/tunnel?status=已停用">
        <span class="stat-label">已停用</span>
        <strong>{{ tunnelData.kpis.stopped }}</strong>
      </RouterLink>
      <RouterLink class="kpi-item" to="/device">
        <span class="stat-label">随廊停用挂账</span>
        <strong>管线{{ tunnelData.kpis.stoppedPipelines }} · 设备{{ tunnelData.kpis.stoppedDevices }}</strong>
      </RouterLink>
    </div>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 1" class="empty-state">暂无运维值班交接数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条值班交接记录；上方管廊读数来自管廊主体台账同一汇总口径</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, listEntries, moduleMeta, tunnelOverview } from '@/api/local-service'
import type { TunnelOverview } from '@/domain/tunnel-domain'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('duty')
const columns = ["交接编号", "值班班组", "值班日期", "班次", "值班人员", "交接事项", "交接人员", "交接状态"]
const statuses = ["待交接", "交接中", "已交接", "有遗留"]
const stats = computed(() => [
  { label: "待交接班次", value: rows.value.filter((r) => r.status === '待交接').length },
  { label: "已交接班次", value: rows.value.filter((r) => r.status === '已交接').length },
  { label: "有遗留事项", value: rows.value.filter((r) => r.status === '有遗留').length },
])

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const tunnelData = ref<TunnelOverview>(tunnelOverview())
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    tunnelData.value = tunnelOverview()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '运维值班交接列表读取失败'
  }
}

onMounted(reload)
</script>
