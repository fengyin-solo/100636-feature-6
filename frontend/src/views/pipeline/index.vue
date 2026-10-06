<template>
  <section class="page" data-module="pipeline">
    <header class="page-head">
      <div>
        <h2>入廊管线登记管理</h2>
        <p class="page-desc">维护入廊管线；所属管廊停用后，仍在运行的管线挂「随廊停用」提示，提示随台账实时读。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记入廊管线</button>
        <button class="btn" type="button" @click="exportRows">导出入廊管线清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" :class="item.cls" class="stat-card">
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
      <label class="filter-item checkbox">
        <input v-model="onlyStopped" type="checkbox" />
        <span>只看随廊停用挂账</span>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>所属管廊</th>
          <th>当前状态</th>
          <th>随廊停用提示</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in visibleRows" :key="String(row.id)" :class="{ 'row-flagged': row['随廊停用提示'] }">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row['所属管廊'] || '—' }}</td>
          <td>{{ row.status }}</td>
          <td>
            <span v-if="row['随廊停用提示']" class="badge warn">{{ row['随廊停用提示'] }}</span>
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
        <tr v-if="!visibleRows.length">
          <td :colspan="columns.length + 4" class="empty-state">当前条件下没有入廊管线数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ visibleRows.length }} 条（全部 {{ total }} 条）；导出报表读数与本页一致</span>
      <span v-if="infoMessage" class="info-text">{{ infoMessage }}</span>
      <span v-else-if="errorMessage" class="error-text">{{ errorMessage }}</span>
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
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('pipeline')
const columns = ["管线编号", "所属舱室", "管线类型", "权属单位", "入廊日期", "设计容量", "对接联系人", "管线状态"]
const actions = ["登记入廊", "确认运行", "办理迁出"]
const statuses = ["待登记", "已入廊", "运行中", "已迁出"]

const session = useSessionStore()
const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const infoMessage = ref('')
const filters = ref<Record<string, string>>({})
const onlyStopped = ref(false)
const filterFields = ["管线编号", "所属舱室", "管线类型", "权属单位"]

const visibleRows = computed(() =>
  onlyStopped.value ? rows.value.filter((row) => row['随廊停用提示']) : rows.value,
)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: "已入廊管线", value: rows.value.filter((r) => ['已入廊', '运行中'].includes(String(r.status))).length, cls: '' },
  { label: "运行中管线", value: rows.value.filter((r) => r.status === '运行中').length, cls: '' },
  { label: "随廊停用挂账", value: rows.value.filter((r) => r['随廊停用提示']).length, cls: 'stat-warn' },
  { label: "待登记管线", value: rows.value.filter((r) => r.status === '待登记').length, cls: '' },
])

function canOperate(row: EntryRow): boolean {
  const owner = String(row['权属单位'] ?? '')
  return !owner || owner === session.unit
}

function notYourUnit(row: EntryRow): string {
  return `权属「${row['权属单位']}」，当前单位「${session.unit}」无权操作`
}

function resetFilters() {
  filters.value = {}
  onlyStopped.value = false
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '入廊管线登记入口尚未接入审批流'
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

function reload() {
  errorMessage.value = ''
  const payload = listEntries(meta.key, filters.value)
  rows.value = payload.items
  total.value = payload.total
}

onMounted(reload)
</script>
