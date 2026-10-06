<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标；管廊片区对照与管廊台账、值班台账同源读数。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>

    <h3 class="block-title">管廊片区对照</h3>
    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">管廊条数（片区数）</span>
        <strong class="stat-value">{{ tunnelData.kpis.tunnelCount }} <em>/ {{ tunnelData.kpis.zoneCount }}片区</em></strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">舱室数量合计</span>
        <strong class="stat-value">{{ tunnelData.kpis.cabinTotal }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">运行中</span>
        <strong class="stat-value status-running">{{ tunnelData.kpis.running }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">检修中</span>
        <strong class="stat-value status-maintaining">{{ tunnelData.kpis.maintaining }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待投运 / 已停用</span>
        <strong class="stat-value">{{ tunnelData.kpis.pending }} <em>/</em> {{ tunnelData.kpis.stopped }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">随廊停用挂账</span>
        <strong class="stat-value status-stopped">管线{{ tunnelData.kpis.stoppedPipelines }} · 设备{{ tunnelData.kpis.stoppedDevices }}</strong>
      </article>
    </div>
    <ZoneBoard compact clickable :zones="tunnelData.zones" :kpis="tunnelData.kpis" @drill="drill" />

    <h3 class="block-title">全模块汇总</h3>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>登记数</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据；汇总与报表读数一致</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { loadOverview, tunnelOverview } from '@/api/local-service'
import type { OverviewResult } from '@/data/types'
import type { TunnelOverview } from '@/domain/tunnel-domain'
import ZoneBoard from '@/components/ZoneBoard.vue'

const router = useRouter()
const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const tunnelData = ref<TunnelOverview>(tunnelOverview())

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  tunnelData.value = tunnelOverview()
}

onMounted(() => {
  refresh()
})

function drill(zone: string) {
  router.push({ path: '/tunnel', query: { zone } })
}
</script>
