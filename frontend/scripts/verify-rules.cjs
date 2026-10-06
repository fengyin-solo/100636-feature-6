/* 规则验证脚本：用 typescript 自带转译在 Node CJS 里直接跑 src，mock localStorage。
   运行：node scripts/verify-rules.cjs
*/
'use strict'
const fs = require('fs')
const path = require('path')
const Module = require('module')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')

const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith('@/')) {
    request = path.join(SRC, request.slice(2))
  }
  return originalResolve.call(this, request, parent, ...rest)
}

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'pinia') {
    // session store 在服务层测试里用不到，给个最小桩。
    return { defineStore: (id, opts) => opts }
  }
  return originalLoad.call(this, request, parent, isMain)
}

require.extensions['.ts'] = function (module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const out = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  })
  module._compile(out.outputText, filename)
}

// .vue 文件桩（测试不经过组件，仅防误引用）
require.extensions['.vue'] = function (module) {
  module._compile('module.exports = {}', 'stub.vue')
}

// mock localStorage
const storage = new Map()
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear(),
}
const SEED = require('../src/data/seed').SEED_ROWS
const migration = require('../src/domain/migration')
const domain = require('../src/domain/tunnel-domain')
const trailMod = require('../src/domain/action-trail')

let failures = 0
function check(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  if (!pass) {
    failures += 1
    console.error(`✘ ${name}\n  期望: ${JSON.stringify(expected)}\n  实际: ${JSON.stringify(actual)}`)
  } else {
    console.log(`✓ ${name}`)
  }
}
function checkTrue(name, cond, detail = '') {
  if (!cond) {
    failures += 1
    console.error(`✘ ${name} ${detail}`)
  } else {
    console.log(`✓ ${name}`)
  }
}

// ---------- 1. 迁移：投运日期回填 ----------
const migrated = migration.migrateLegacyRows(JSON.parse(JSON.stringify(SEED)))
const mTunnel = Object.fromEntries(migrated.tunnel.map((r) => [r['管廊编号'], r]))
check('CDB-02 推定投运日期=最早入廊', mTunnel['GS-CDB-02']['投运日期'], '2018-03-15')
check('CDB-02 来源=推定值', mTunnel['GS-CDB-02']['投运日期来源'], '推定值')
check('CDB-01 登记值不动', mTunnel['GS-CDB-01']['投运日期'], '2016-06-30')
check('CDB-01 来源=登记值', mTunnel['GS-CDB-01']['投运日期来源'], '登记值')
check('GX-02 待投运不回填', mTunnel['GS-GX-02']['投运日期'], '')
check('BJ-02 推定=最早入廊 2010-07-01', mTunnel['GS-BJ-02']['投运日期'], '2010-07-01')
check('权属单位列补齐', mTunnel['GS-CDB-01']['权属单位'], '市城投管廊运营公司')

// ---------- 2. 片区汇总 ----------
const overview = domain.buildTunnelOverview((key) => migrated[key] || [])
const zoneByName = Object.fromEntries(overview.zones.map((z) => [z.zone, z]))
const expectedZones = {
  '城东片区': { count: 2, cabins: 5, running: 2, maintaining: 0, pending: 0, stopped: 0 },
  '滨江片区': { count: 2, cabins: 5, running: 0, maintaining: 1, pending: 0, stopped: 1 },
  '高新片区': { count: 3, cabins: 8, running: 2, maintaining: 0, pending: 1, stopped: 0 },
  '老城片区': { count: 2, cabins: 3, running: 0, maintaining: 1, pending: 0, stopped: 1 },
  '临空片区': { count: 3, cabins: 10, running: 2, maintaining: 0, pending: 1, stopped: 0 },
}
for (const [zone, exp] of Object.entries(expectedZones)) {
  const z = zoneByName[zone]
  checkTrue(
    `${zone} 条数/舱室/状态分布`,
    z.tunnelCount === exp.count && z.cabinTotal === exp.cabins &&
      z.running === exp.running && z.maintaining === exp.maintaining &&
      z.pending === exp.pending && z.stopped === exp.stopped,
    JSON.stringify(z),
  )
}
check('合计管廊12条', overview.kpis.tunnelCount, 12)
check('合计舱室31', overview.kpis.cabinTotal, 31)
check('运行6/检修2/待运2/停用2',
  [overview.kpis.running, overview.kpis.maintaining, overview.kpis.pending, overview.kpis.stopped],
  [6, 2, 2, 2])
const sumZones = overview.zones.reduce((s, z) => s + z.tunnelCount, 0)
check('片区条数合计=明细条数', sumZones, migrated.tunnel.length)

// ---------- 3. 随廊停用挂账 ----------
check('滨江 挂账管线1', zoneByName['滨江片区'].stoppedPipelines, 1)
check('滨江 挂账设备2', zoneByName['滨江片区'].stoppedDevices, 2)
check('老城 挂账管线1', zoneByName['老城片区'].stoppedPipelines, 1)
check('老城 挂账设备1', zoneByName['老城片区'].stoppedDevices, 1)
check('总挂账 管线2/设备3', [overview.kpis.stoppedPipelines, overview.kpis.stoppedDevices], [2, 3])
checkTrue('设备能读到随廊停用提示',
  domain.stoppedNotice('GS-BJ-02-综合舱', migrated.tunnel).includes('随廊停用挂账'))
checkTrue('运行廊舱室无提示', domain.stoppedNotice('GS-CDB-01-综合舱', migrated.tunnel) === '')

// ---------- 4. 推定口径对照值 ----------
const bj02Enriched = overview.enriched.find((r) => r['管廊编号'] === 'GS-BJ-02')
check('BJ-02 主口径生效 2010-07-01', bj02Enriched.commissionDate, '2010-07-01')
check('BJ-02 对照口径(最早在册设备) 2010-06-25', bj02Enriched.commissionAlternative, '2010-06-25')
const gx01e = overview.enriched.find((r) => r['管廊编号'] === 'GS-GX-01')
check('GX-01 生效登记值', gx01e.commissionDate, '2019-09-12')
// GX-03 无登记值，管线最早 2020-05-18，设备最早 2020-05-25
const gx03 = overview.enriched.find((r) => r['管廊编号'] === 'GS-GX-03')
check('GX-03 推定 2020-05-18', gx03.commissionDate, '2020-05-18')
check('GX-03 对照 2020-05-25', gx03.commissionAlternative, '2020-05-25')

// ---------- 5. 动作服务：幂等/拦截/轨迹 ----------
// 用迁移后数据重写存储，并清掉模块缓存让 local-store 重新初始化。
globalThis.localStorage.setItem('urban-utility-tunnel:entries', JSON.stringify(migrated))
globalThis.localStorage.setItem('urban-utility-tunnel:version', '2')
for (const key of Object.keys(require.cache)) {
  if ((key.includes(path.join('src', 'data')) || key.includes(path.join('src', 'api')))
    && !key.includes('action-trail')) {
    delete require.cache[key]
  }
}
const service = require('../src/api/local-service')

trailMod.resetTrails()
const gx01Id = migrated.tunnel.find((r) => r['管廊编号'] === 'GS-GX-01').id
const deny = service.runAction('tunnel', gx01Id, '安排检修', { unit: '市城投管廊运营公司', operator: '甲' })
checkTrue('跨单位安排检修被挡回', deny.ok === false && deny.message.includes('跨单位'))
checkTrue('挡回不进轨迹', trailMod.listTrails('tunnel').length === 0)

const gx02Id = migrated.tunnel.find((r) => r['管廊编号'] === 'GS-GX-02').id
const r1 = service.runAction('tunnel', gx02Id, '提交投运', { unit: '高新区市政公司', operator: '乙' })
checkTrue('首次投运成功', r1.ok === true && r1.merged !== true, r1.message)
const r2 = service.runAction('tunnel', gx02Id, '提交投运', { unit: '高新区市政公司', operator: '乙' })
checkTrue('二次投运 merged', r2.ok === true && r2.merged === true, r2.message)
const r3 = service.runAction('tunnel', gx02Id, '提交投运', { unit: '高新区市政公司', operator: '乙' })
checkTrue('三次投运 merged', r3.ok === true && r3.merged === true, r3.message)
const trails = trailMod.listTrails('tunnel').filter((t) => t.rowId === gx02Id && t.action === '提交投运')
check('投运轨迹只有一条', trails.length, 1)
check('轨迹累计3回', trails[0].count, 3)
check('投运结果状态运行中', trails[0].resultStatus, '运行中')

const bj02Id = migrated.tunnel.find((r) => r['管廊编号'] === 'GS-BJ-02').id
const dead = service.runAction('tunnel', bj02Id, '提交投运', { unit: '市城投管廊运营公司', operator: '乙' })
checkTrue('已停用不能再投运', dead.ok === false)

const bj01Id = migrated.tunnel.find((r) => r['管廊编号'] === 'GS-BJ-01').id
const fromMaint = service.runAction('tunnel', bj01Id, '提交投运', { unit: '市城投管廊运营公司', operator: '乙' })
checkTrue('检修中提交投运被拒', fromMaint.ok === false && fromMaint.message.includes('待投运'))

service.runAction('tunnel', bj01Id, '安排检修', { unit: '市城投管廊运营公司', operator: '乙' })
const bj01Trails = trailMod.listTrails('tunnel').filter((t) => t.rowId === bj01Id && t.action === '安排检修')
check('重复安排检修合并为1条', bj01Trails.length, 1)
check('检修轨迹次数1', bj01Trails[0].count, 1)

const cdb02Id = migrated.tunnel.find((r) => r['管廊编号'] === 'GS-CDB-02').id
const stop = service.runAction('tunnel', cdb02Id, '停用管廊', { unit: '市城投管廊运营公司', operator: '乙' })
checkTrue('停用成功并提示挂账数量', stop.ok === true && stop.message.includes('随廊停用挂账'), stop.message)
checkTrue('提示含 1条、1台', stop.message.includes('1条') && stop.message.includes('1台'), stop.message)
const ov2 = service.tunnelOverview()
check('停用后总条数仍12', ov2.kpis.tunnelCount, 12)
check('停用后 已停用3 运行6', [ov2.kpis.stopped, ov2.kpis.running], [3, 6])
check('停用后 总挂账 管线3 设备4', [ov2.kpis.stoppedPipelines, ov2.kpis.stoppedDevices], [3, 4])

// ---------- 6. 管线/设备归属 ----------
const pipeGx = service.listEntries('pipeline').items.find((r) => r['管线编号'] === 'PIPE-0012')
const pd = service.runAction('pipeline', Number(pipeGx.id), '确认运行', { unit: '市水务集团', operator: '丙' })
checkTrue('管线跨单位被挡', pd.ok === false && pd.message.includes('跨单位'))
const devGx = service.listEntries('device').items.find((r) => r['设备编号'] === 'DEVI-0008')
const dd = service.runAction('device', Number(devGx.id), '完成保养', { unit: '市城投管廊运营公司', operator: '丙' })
checkTrue('设备随廊归属跨单位被挡', dd.ok === false && dd.message.includes('跨单位'))
const devOk = service.runAction('device', Number(devGx.id), '完成保养', { unit: '高新区市政公司', operator: '丙' })
checkTrue('归属单位可操作设备', devOk.ok === true, devOk.message)

// ---------- 7. 概览/报表/挂账读数一致 ----------
const ovAll = service.loadOverview()
const tMod = ovAll.modules.find((m) => m.name === '管廊主体台账')
check('概览管廊登记数=12', tMod.created, 12)
const report = service.exportEntries('tunnel').content
checkTrue('报表含片区合计行', report.includes('合计,12,31'))
const detailCount = report.split('\n').filter((l) => l.includes('GS-') && !l.startsWith('合计') && !l.startsWith('片区')).length
check('报表明细行数=12', detailCount, 12)

const devRows = service.listEntries('device').items
const flagged = devRows.filter((r) => r['随廊停用提示']).map((r) => r['设备编号']).sort()
checkTrue('设备挂账 0003/0006/0007/0012',
  JSON.stringify(flagged) === JSON.stringify(['DEVI-0003', 'DEVI-0006', 'DEVI-0007', 'DEVI-0012']),
  JSON.stringify(flagged))
checkTrue('报废设备0014不挂账', !flagged.includes('DEVI-0014'))

const pFlagged = service.listEntries('pipeline').items
  .filter((r) => r['随廊停用提示']).map((r) => r['管线编号']).sort()
checkTrue('管线挂账 0005/0009/0020',
  JSON.stringify(pFlagged) === JSON.stringify(['PIPE-0005', 'PIPE-0009', 'PIPE-0020']),
  JSON.stringify(pFlagged))

// 已迁出管线不算运行中、不挂账
checkTrue('已迁出 PIPE-0010 不挂账', !pFlagged.includes('PIPE-0010'))

// 缺日期在展示层
const lc02 = ov2.enriched.find((r) => r['管廊编号'] === 'GS-LC-02')
check('LC-02 推定 2009-09-09', lc02.commissionDate, '2009-09-09')

console.log(failures === 0 ? '\n全部断言通过 ✅' : `\n${failures} 条断言失败 ❌`)
process.exit(failures === 0 ? 0 : 1)
