<template>
  <section class="zone-board">
    <div class="board-head">
      <h3 v-if="!compact">片区管廊对照</h3>
      <p v-if="!compact" class="board-tip">
        每行一个片区：管廊条数与明细列表逐条对得上；点片区行可回到该片区的管廊明细。
      </p>
    </div>
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
          <th>随廊停用挂账</th>
          <th v-if="!compact">明细</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in zones"
          :key="row.zone"
          :class="{ clickable: !compact || clickable }"
          @click="emitDrill(row.zone)"
        >
          <td>{{ row.zone }}</td>
          <td class="num strong">{{ row.tunnelCount }}</td>
          <td class="num">{{ row.cabinTotal }}</td>
          <td class="num status-running">{{ row.running }}</td>
          <td class="num status-maintaining">{{ row.maintaining }}</td>
          <td class="num status-pending">{{ row.pending }}</td>
          <td class="num status-stopped">{{ row.stopped }}</td>
          <td class="num">
            <span v-if="row.stoppedPipelines + row.stoppedDevices > 0" class="badge warn">
              管线{{ row.stoppedPipelines }} · 设备{{ row.stoppedDevices }}
            </span>
            <span v-else class="muted">—</span>
          </td>
          <td v-if="!compact">
            <button class="link" type="button" @click.stop="emit('drill', row.zone)">
              查看{{ row.tunnelCount }}条明细
            </button>
          </td>
        </tr>
        <tr class="zone-total">
          <td>合计</td>
          <td class="num strong">{{ kpis.tunnelCount }}</td>
          <td class="num">{{ kpis.cabinTotal }}</td>
          <td class="num status-running">{{ kpis.running }}</td>
          <td class="num status-maintaining">{{ kpis.maintaining }}</td>
          <td class="num status-pending">{{ kpis.pending }}</td>
          <td class="num status-stopped">{{ kpis.stopped }}</td>
          <td class="num">
            <span v-if="kpis.stoppedPipelines + kpis.stoppedDevices > 0" class="badge warn">
              管线{{ kpis.stoppedPipelines }} · 设备{{ kpis.stoppedDevices }}
            </span>
            <span v-else class="muted">—</span>
          </td>
          <td v-if="!compact">共 {{ zones.length }} 个片区</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
import type { TunnelKpis, ZoneRow } from '@/domain/tunnel-domain'

const props = withDefaults(
  defineProps<{ zones: ZoneRow[]; kpis: TunnelKpis; compact?: boolean; clickable?: boolean }>(),
  { compact: false, clickable: false },
)
const emit = defineEmits<{ (e: 'drill', zone: string): void }>()

function emitDrill(zone: string) {
  if (!props.compact || props.clickable) {
    emit('drill', zone)
  }
}
</script>
