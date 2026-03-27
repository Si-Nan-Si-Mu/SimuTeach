import { createApp } from 'vue'
import './style.css'
import App from './App.vue'

// 课堂模拟独立 Bot：必须在 workflow.js 之前注入
import './classroom-workflow-inject.js'

// 工作流（腾讯云 SSE）：通过 window 注入 WorkflowClient / WorkflowDataStore（源码在 vendor/front/js）
import '../vendor/front/js/workflow.js'

createApp(App).mount('#app')
