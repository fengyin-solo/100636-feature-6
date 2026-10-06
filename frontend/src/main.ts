import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { runStartupMigration } from './data/local-store'
import { migrateLegacyRows } from './domain/migration'
import './styles/global.css'

// 存量数据一次性回填（投运日期推定等），幂等：登记值不改，缺值不拿默认值顶。
runStartupMigration(migrateLegacyRows)

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
