<template>
  <section class="page" data-module="device">
    <header class="page-head">
      <div>
        <h2>设备台账管理管理</h2>
        <p class="page-desc">维护管廊设备，围绕设备编号、设备名称、设备型号、所属舱室做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记管廊设备</button>
        <button class="btn" type="button" @click="exportRows">导出设备台账管理清单</button>
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

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div v-if="stoppedCount" class="warn-banner">
      <p>⚠️ 下列有 {{ stoppedCount }} 台在册设备随所属管廊停用，设备台账已读取「随廊停用」标记，请按停用管廊设备处置。</p>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-stopped': row['随廊停用'] }">
          <td v-for="column in columns" :key="column">
            <span v-if="column === '随廊停用' && row[column]"><span class="stopped-tag">{{ row[column] }}</span></span>
            <span v-else-if="column === '随廊停用'" class="muted-cell">—</span>
            <template v-else>{{ row[column] === '' ? '—' : (row[column] ?? '—') }}</template>
          </td>
          <td>{{ row.status }}</td>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无设备台账管理数据，可先登记管廊设备</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条设备台账管理记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('device')
const columns = ["设备编号", "设备名称", "设备型号", "所属舱室", "投运日期", "保养周期", "上次保养日", "随廊停用", "设备状态"]
const actions = ["登记运行", "完成保养", "报废设备"]
const statuses = ["待保养", "运行中", "已保养", "已报废"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const stoppedCount = computed(() => rows.value.filter((row) => row['随廊停用']).length)
const stats = computed(() => [
  { label: "运行中设备", value: rows.value.filter((row) => String(row.status) === '运行中').length },
  { label: "待保养设备", value: rows.value.filter((row) => String(row.status) === '待保养').length },
  { label: "随廊停用设备", value: stoppedCount.value },
  { label: "已报废设备", value: rows.value.filter((row) => String(row.status) === '已报废').length },
])
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

function openCreate() {
  errorMessage.value = '管廊设备登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '设备台账管理列表读取失败'
  }
}

onMounted(reload)
</script>
