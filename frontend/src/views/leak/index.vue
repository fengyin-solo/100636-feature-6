<template>
  <section class="page" data-module="leak">
    <header class="page-head">
      <div>
        <h2>渗漏水处置</h2>
        <p class="page-desc">老的处置记录按发现日期倒排补录，发现日期缺值一律沉底并标注「缺值·待补录」，不拿默认值顶上。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出渗漏水处置清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <div class="sort-bar">
      <span>排序口径：</span>
      <label><input v-model="sortMode" type="radio" value="found" /> 发现日期倒排（主口径）</label>
      <label><input v-model="sortMode" type="radio" value="finished" /> 完工日期倒排（仅作对照）</label>
      <span class="muted">两种口径下缺值都沉底，顺序差异即对照结果</span>
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
          <th v-for="column in columns" :key="column">
            {{ column }}
            <span v-if="column === '发现日期'" class="sort-mark">↓{{ sortMode === 'found' ? '主口径' : '' }}</span>
            <span v-else-if="column === '完工日期'" class="sort-mark">{{ sortMode === 'finished' ? '↓对照口径' : '' }}</span>
          </th>
          <th>当前状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in sortedRows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <template v-if="isDateField(column)">
              <span v-if="row[column]">{{ row[column] }}</span>
              <span v-else class="missing">缺值·待补录</span>
            </template>
            <template v-else-if="column === '处置班组'">
              <span v-if="row[column]">{{ row[column] }}</span>
              <span v-else class="missing">缺值·待补录</span>
            </template>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>{{ row.status }}</td>
        </tr>
        <tr v-if="!sortedRows.length">
          <td :colspan="columns.length + 1" class="empty-state">当前条件下没有渗漏处置记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ sortedRows.length }} 条；导出同样保留缺值（空白），不填默认日期</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import { isValidDate } from '@/domain/tunnel-domain'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('leak')
const columns = ["处置编号", "渗漏点位", "渗漏程度", "处置方式", "处置班组", "发现日期", "完工日期", "处置状态"]
const dateFields = new Set(["发现日期", "完工日期"])

const rows = ref<EntryRow[]>([])
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["处置编号", "渗漏点位"]
const sortMode = ref<'found' | 'finished'>('found')

const sortedRows = computed(() => {
  const field = sortMode.value === 'found' ? '发现日期' : '完工日期'
  return [...rows.value].sort((a, b) => {
    const va = String(a[field] ?? '')
    const vb = String(b[field] ?? '')
    const da = isValidDate(va) ? va : ''
    const db = isValidDate(vb) ? vb : ''
    // 缺值沉底；同日（或都缺）按处置编号倒序，保证顺序确定。
    if (!da && !db) {
      return String(b['处置编号']).localeCompare(String(a['处置编号']))
    }
    if (!da) {
      return 1
    }
    if (!db) {
      return -1
    }
    if (db !== da) {
      return db.localeCompare(da)
    }
    return String(b['处置编号']).localeCompare(String(a['处置编号']))
  })
})

const stats = computed(() => [
  { label: "待处置渗漏点", value: rows.value.filter((r) => r.status === '待处置').length },
  { label: "处置中渗漏点", value: rows.value.filter((r) => r.status === '处置中').length },
  { label: "缺发现日期待补", value: rows.value.filter((r) => !isValidDate(r['发现日期'])).length },
  { label: "已完工", value: rows.value.filter((r) => r.status === '已完工').length },
])

function isDateField(field: string): boolean {
  return dateFields.has(field)
}

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
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '渗漏处置列表读取失败'
  }
}

onMounted(reload)
</script>
