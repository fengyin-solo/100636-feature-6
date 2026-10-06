<template>
  <section class="page" data-module="tunnel">
    <header class="page-head">
      <div>
        <h2>管廊主体台账管理</h2>
        <p class="page-desc">按所属片区铺开的管廊对照视图：每片区一行看条数、舱室合计与运行/检修分布；点行内管廊回到该片区明细。</p>
      </div>
      <div class="page-actions">
        <button v-if="mode === 'detail'" class="btn ghost" type="button" @click="backToZone">← 返回片区对照</button>
        <button class="btn primary" type="button" @click="openCreate">登记综合管廊</button>
        <button v-if="mode === 'zone'" class="btn" type="button" @click="exportZone">导出片区对照报表</button>
        <button class="btn" type="button" @click="exportRows">导出管廊台账清单</button>
      </div>
    </header>

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

    <!-- 视图一：片区对照（概览与值班台账也呈现同一版） -->
    <template v-if="mode === 'zone'">
      <ZoneSummary title="片区管廊对照视图" :refresh-key="refreshKey" drillable @drill="openZone" />
      <p class="reading-note">报表与运营概览、值班台账共用同一份读数：对照合计 {{ totals.count }} 条，与下方明细条数一致。</p>
    </template>

    <!-- 视图二：某片区的管廊明细列表（点对照行回到这里） -->
    <template v-else>
      <h3 class="detail-title">{{ activeZone || '全部片区' }} · 管廊明细（{{ rows.length }} 条）</h3>

      <div v-if="stopWarnings.length" class="warn-banner">
        <p v-for="(warn, idx) in stopWarnings" :key="idx">⚠️ {{ warn }}</p>
      </div>

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
            <th>口径对照</th>
            <th>当前状态</th>
            <th>动作轨迹</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">
              <template v-if="column === '投运日期' && isInferred(row)">
                <span class="inferred-date" title="推定日期：按最早一条入廊管线的入廊日期">{{ row[column] || '—' }} *</span>
              </template>
              <template v-else>{{ display(row, column) }}</template>
            </td>
            <td class="muted-cell">{{ row['投运日期对照'] ?? '—' }}</td>
            <td>{{ row.status }}</td>
            <td class="trail-cell">
              <template v-if="trails[Number(row.id)]?.length">
                <span v-for="trail in trails[Number(row.id)]" :key="trail.action" class="trail-chip" :title="`首次 ${trail.firstAt} · 最近 ${trail.lastAt}`">
                  {{ trail.action }}×{{ trail.count }}
                </span>
              </template>
              <span v-else class="muted-cell">—</span>
            </td>
            <td class="row-actions">
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 4" class="empty-state">该片区暂无符合条件的管廊</td>
          </tr>
        </tbody>
      </table>

      <footer class="page-foot">
        <span>明细 {{ rows.length }} 条 · 全公司 {{ totals.count }} 条，条数与片区对照一致</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  actionTrail,
  downloadEntries,
  downloadText,
  exportZoneReport,
  listEntries,
  listRows,
  moduleMeta,
  runAction as applyAction,
  zoneTotals,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import ZoneSummary from '@/components/ZoneSummary.vue'

const route = useRoute()
const router = useRouter()

const meta = moduleMeta('tunnel')
const columns = ["管廊编号", "管廊名称", "所属片区", "归属单位", "舱室数量", "总长度", "结构类型", "投运日期", "投运日期口径", "管廊状态"]
const actions = ["提交投运", "安排检修", "停用管廊"]
const statuses = ["待投运", "运行中", "检修中", "已停用"]

const mode = ref<'zone' | 'detail'>('zone')
const activeZone = ref('')
const rows = ref<EntryRow[]>([])
const errorMessage = ref('')
const stopWarnings = ref<string[]>([])
const refreshKey = ref(0)
const filters = reactive<Record<string, string>>({})
const filterFields = ["管廊编号", "管廊名称", "所属片区"]
const trails = reactive<Record<number, ReturnType<typeof actionTrail>>>({})

function display(row: EntryRow, column: string): string {
  const value = row[column]
  return value === undefined || value === '' ? '—' : String(value)
}

function isInferred(row: EntryRow): boolean {
  return String(row['投运日期口径'] ?? '').startsWith('推定')
}

const stats = computed(() => {
  void refreshKey.value
  const all = listRows('tunnel')
  const countBy = (status: string) => all.filter((row) => String(row.status) === status).length
  return [
    { label: '运行中管廊', value: countBy('运行中') },
    { label: '检修中管廊', value: countBy('检修中') },
    { label: '待投运管廊', value: countBy('待投运') },
    { label: '已停用管廊', value: countBy('已停用') },
    { label: '舱室数量合计', value: all.reduce((sum, row) => sum + (Number(row['舱室数量']) || 0), 0) },
  ]
})

const totals = computed(() => {
  void refreshKey.value
  return zoneTotals()
})

const statusSummary = computed(() => {
  void refreshKey.value
  const all = listRows('tunnel')
  return statuses.map((status: string) => ({
    status,
    count: all.filter((row) => String(row.status) === status).length,
  }))
})

function openZone(zone: string) {
  activeZone.value = zone
  mode.value = 'detail'
  filters['所属片区'] = zone
  router.replace({ query: { zone } })
  reload()
}

function backToZone() {
  mode.value = 'zone'
  activeZone.value = ''
  router.replace({ query: {} })
}

function resetFilters() {
  for (const key of Object.keys(filters)) {
    delete filters[key]
  }
  // 明细页重置后仍停留在当前片区对照钻取的上下文里。
  if (mode.value === 'detail' && activeZone.value) {
    filters['所属片区'] = activeZone.value
  }
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function exportZone() {
  const report = exportZoneReport()
  downloadText(report.filename, report.content)
}

function openCreate() {
  errorMessage.value = '综合管廊登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  stopWarnings.value = []
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    refreshKey.value += 1
    return
  }
  if (result.warnings?.length) {
    stopWarnings.value = result.warnings
  }
  refreshKey.value += 1
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, { ...filters })
    rows.value = payload.items
    for (const row of rows.value) {
      trails[Number(row.id)] = actionTrail(meta.key, Number(row.id))
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '管廊主体台账列表读取失败'
  }
}

onMounted(() => {
  const zone = typeof route.query.zone === 'string' ? route.query.zone : ''
  if (zone) {
    openZone(zone)
  }
})
</script>
