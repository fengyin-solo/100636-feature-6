<template>
  <section class="page" data-module="tunnel">
    <header class="page-head">
      <div>
        <h2>管廊主体台账管理</h2>
        <p class="page-desc">按所属片区对照十几条管廊的运行分布；点片区行回到该片区的管廊明细，条数两边对得上。</p>
      </div>
      <div class="page-actions">
        <div class="seg">
          <button :class="{ active: mode === 'zone' }" type="button" @click="mode = 'zone'">片区对照</button>
          <button :class="{ active: mode === 'detail' }" type="button" @click="toDetail()">明细列表</button>
        </div>
        <button class="btn" type="button" @click="exportRows">导出管廊台账（含片区合计）</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">管廊条数 / 片区数</span>
        <strong class="stat-value">{{ kpis.tunnelCount }} <em>/ {{ kpis.zoneCount }}片区</em></strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">舱室数量合计</span>
        <strong class="stat-value">{{ kpis.cabinTotal }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">运行中</span>
        <strong class="stat-value status-running">{{ kpis.running }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">检修中</span>
        <strong class="stat-value status-maintaining">{{ kpis.maintaining }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待投运 / 已停用</span>
        <strong class="stat-value">{{ kpis.pending }} <em>/</em> {{ kpis.stopped }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">随廊停用挂账</span>
        <strong class="stat-value status-stopped">管线{{ kpis.stoppedPipelines }} · 设备{{ kpis.stoppedDevices }}</strong>
      </article>
    </div>

    <!-- 片区对照视图 -->
    <ZoneBoard v-if="mode === 'zone'" :zones="overview.zones" :kpis="kpis" @drill="drillZone" />

    <!-- 明细列表视图 -->
    <template v-else>
      <div v-if="activeZone" class="drill-banner">
        当前片区：<strong>{{ activeZone }}</strong>（{{ filteredRows.length }} 条）
        <button class="link" type="button" @click="clearZone">清除片区筛选</button>
      </div>

      <form class="filter-bar" @submit.prevent="reload">
        <label v-for="field in filterFields" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="filters[field]" :placeholder="`按${field}检索`" />
        </label>
        <label class="filter-item">
          <span>管廊状态</span>
          <select v-model="statusFilter">
            <option value="">全部</option>
            <option v-for="s in statuses" :key="s" :value="s">{{ s }}</option>
          </select>
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column === '投运日期' ? '投运日期(生效)' : column }}</th>
            <th>日期来源</th>
            <th>对照口径<br /><span class="muted">最早设备投运</span></th>
            <th>当前状态</th>
            <th>随廊停用挂账</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in filteredRows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">
              <template v-if="column === '投运日期'">
                <span v-if="row.commissionDate">{{ row.commissionDate }}</span>
                <span v-else class="missing">缺值·待补录</span>
              </template>
              <template v-else>{{ row[column] ?? '—' }}</template>
            </td>
            <td>
              <span v-if="row.commissionSource === '推定值'" class="badge inferred" title="主口径：该廊非待登记管线的最早入廊日期">推定值</span>
              <span v-else-if="row.commissionSource === '登记值'" class="badge">登记值</span>
              <span v-else class="muted">—</span>
            </td>
            <td>
              <span v-if="row.commissionAlternative" class="muted alt-date">{{ row.commissionAlternative }}</span>
              <span v-else class="muted">无对照值</span>
            </td>
            <td><span :class="['status-tag', statusClass(row.status)]">{{ row.status }}</span></td>
            <td>
              <span v-if="row.stoppedAlert" class="badge warn">{{ row.stoppedAlert }}</span>
              <span v-else class="muted">—</span>
            </td>
            <td class="row-actions">
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                :disabled="!canOperate(row)"
                :title="canOperate(row) ? '' : notYourUnit(row)"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </td>
          </tr>
          <tr v-if="!filteredRows.length">
            <td :colspan="columns.length + 4" class="empty-state">当前条件下没有管廊记录</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot">
        <span>明细 {{ filteredRows.length }} 条，与片区对照合计 {{ kpis.tunnelCount }} 条同源读数</span>
        <span v-if="infoMessage" class="info-text">{{ infoMessage }}</span>
        <span v-else-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>

      <section class="trail-panel">
        <h3>管廊处置轨迹</h3>
        <p class="page-desc">同一个动作连着触发多回只落一条，后续几回并入同一条（次数累计）。</p>
        <table class="data-table">
          <thead>
            <tr>
              <th>管廊编号</th><th>动作</th><th>结果状态</th><th>操作人/单位</th>
              <th>首次落账</th><th>最近触发</th><th>触发次数</th><th>备注</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="trail in trails" :key="trail.id">
              <td>{{ trail.code }}</td>
              <td>{{ trail.action }}</td>
              <td>{{ trail.resultStatus }}</td>
              <td>{{ trail.operator }} / {{ trail.unit }}</td>
              <td>{{ formatTime(trail.firstAt) }}</td>
              <td>{{ formatTime(trail.lastAt) }}</td>
              <td>{{ trail.count }} 次</td>
              <td>{{ trail.note || '—' }}</td>
            </tr>
            <tr v-if="!trails.length">
              <td colspan="8" class="empty-state">暂无处置轨迹</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  tunnelOverview,
} from '@/api/local-service'
import { listTrails } from '@/domain/action-trail'
import type { EnrichedTunnel } from '@/domain/tunnel-domain'
import type { ActionTrail } from '@/domain/action-trail'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'
import ZoneBoard from '@/components/ZoneBoard.vue'

const meta = moduleMeta('tunnel')
const columns = ["管廊编号", "管廊名称", "所属片区", "权属单位", "舱室数量", "总长度", "结构类型", "投运日期"]
const actions = ["提交投运", "安排检修", "停用管廊"]
const statuses = ["待投运", "运行中", "检修中", "已停用"]

const route = useRoute()
const router = useRouter()
const session = useSessionStore()

const mode = ref<'zone' | 'detail'>('zone')
const activeZone = ref(String(route.query.zone ?? ''))
const statusFilter = ref(String(route.query.status ?? ''))
const rows = ref<EnrichedTunnel[]>([])
const errorMessage = ref('')
const infoMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["管廊编号", "管廊名称", "所属片区", "权属单位"]
const trails = ref<ActionTrail[]>([])

const overview = ref(tunnelOverview())
const kpis = computed(() => overview.value.kpis)

const filteredRows = computed(() => {
  let list = rows.value
  if (activeZone.value) {
    list = list.filter((row) => String(row['所属片区']) === activeZone.value)
  }
  if (statusFilter.value) {
    list = list.filter((row) => String(row.status) === statusFilter.value)
  }
  return list
})

function statusClass(status: string): string {
  if (status === '运行中') {
    return 'status-running'
  }
  if (status === '检修中') {
    return 'status-maintaining'
  }
  if (status === '已停用') {
    return 'status-stopped'
  }
  return 'status-pending'
}

function canOperate(row: EntryRow): boolean {
  const owner = String(row['权属单位'] ?? '')
  return !owner || owner === session.unit
}

function notYourUnit(row: EntryRow): string {
  return `归属「${row['权属单位']}」，当前单位「${session.unit}」无权操作`
}

function drillZone(zone: string) {
  activeZone.value = zone
  statusFilter.value = ''
  mode.value = 'detail'
  router.replace({ query: { ...route.query, zone } })
}

function toDetail() {
  mode.value = 'detail'
}

function clearZone() {
  activeZone.value = ''
  router.replace({ query: {} })
}

watch(
  () => [route.query.zone, route.query.status],
  ([zone, status]) => {
    if (zone || status) {
      activeZone.value = String(zone ?? '')
      statusFilter.value = String(status ?? '')
      mode.value = 'detail'
    }
  },
)

function resetFilters() {
  filters.value = {}
  statusFilter.value = ''
  activeZone.value = ''
  router.replace({ query: {} })
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  infoMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, {
    unit: session.unit,
    operator: session.operator,
  })
  if (!result.ok) {
    errorMessage.value = result.message
  } else {
    infoMessage.value = result.message
  }
  reload()
}

function formatTime(iso: string): string {
  return iso ? iso.replace('T', ' ').slice(0, 16) : ''
}

function reload() {
  errorMessage.value = ''
  overview.value = tunnelOverview()
  const payload = listEntries(meta.key, filters.value)
  rows.value = payload.items as EnrichedTunnel[]
  trails.value = listTrails('tunnel').slice(0, 20)
}

onMounted(() => {
  if (activeZone.value) {
    mode.value = 'detail'
  }
  reload()
})
</script>
