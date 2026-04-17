# teacher-training-agent (SimuTeach)

面向师范生训练的前端仿真系统，统一提供三种训练模式：

- `专项模拟`：一对一数字学生对话（对话 + 情绪看板 + 路径分析 + 报告）
- `课堂模拟`：三人格课堂场景（讲台/座位/气泡反馈/课堂事件/情绪统计）
- `教学文档分析`：教学资料上传分析（多文件、报告切换、结果弹窗、调试面板）

项目基于 `Vue 3 + Vite`，通过 `HTTP/SSE` 对接工作流与后端服务，图表使用本地 `ECharts` 资源。

---

## 功能概览

### 专项模拟

- 教师消息优先走工作流，失败时本地策略兜底
- 快捷语驱动路径分析统计（鼓励/安抚/互动/提问/批评）
- 情绪看板按角色隔离并可恢复上下文

### 课堂模拟

- 三人格角色互动：定向对话 + 广播
- 课堂数据页：情绪均值、学生明细、课堂事件
- 主动轮询调试：`proactive=true` 直连后端验证主动回复链路

### 教学文档分析

- 拖拽/选择上传，支持多文件累计选择与去重
- 分析结果弹窗展示：思维导图、教学诊断、执行画像（默认折叠）
- 外部报告切换面板：可按文件查看历史分析结果
- 调试页面可开关，支持原始响应与分析报告下载

---

## 技术栈

- 框架：`Vue 3`（`<script setup>`）
- 构建：`Vite`
- 图表：`vendor/front/js/echarts.min.js`
- 样式：
  - `vendor/front/css/style.css`（主视觉/公共样式）
  - 组件内 `scoped` 样式（页面级覆盖与响应式）
- 协议：`HTTP JSON`、`HTTP SSE (text/event-stream)`

---

## 快速开始

### 1) 安装依赖

```bash
npm install
```

### 2) 配置环境变量

将 `.env.example` 复制为 `.env.local` 并填写必要配置（至少包含专项/课堂/报告相关 key 与 endpoint）。

### 3) 启动开发环境

```bash
npm run dev
```

### 4) 构建与预览

```bash
npm run build
npm run preview
```

---

## 教学文档上传规则

当前上传校验规则如下（前端已实现类型与大小检查）：

- 文档：`.pdf` `.doc` `.docx` `.ppt` `.pptx`（单文件最大 `200MB`）
- 文档：`.xlsx` `.xls` `.md` `.txt` `.csv`（单文件最大 `20MB`）
- 抓包：`.pcap`（单文件最大 `20MB`）
- 图片：`.jpg` `.jpeg` `.png`（单文件最大 `50MB`）
- 文件数量：单次会话最多 `10` 个

---

## 目录结构

```text
teacher-training-agent/
├─ public/
├─ vendor/
│  └─ front/
│     ├─ css/style.css
│     └─ js/
│        ├─ echarts.min.js
│        └─ workflow.js
├─ src/
│  ├─ App.vue
│  ├─ main.js
│  ├─ classroom-workflow-inject.js
│  ├─ reportEvaluation.js
│  ├─ extractCompletionDialog.js
│  └─ components/
│     ├─ SideBar.vue
│     ├─ SpecialTraining.vue
│     ├─ ClassroomSim.vue
│     ├─ EmotionPanel.vue
│     ├─ ChatBox.vue
│     └─ TeachingDocAnalysis.vue
├─ .env.example
├─ vite.config.js
└─ README.md
```

---

## 核心架构说明

### 启动链路

1. `src/main.js` 注入 `classroom-workflow-inject.js`
2. 加载 `vendor/front/js/workflow.js`
3. 挂载 `App.vue`

### 根组件职责（`App.vue`）

- 管理模式切换：`special` / `classroom` / `doc-analysis`
- 管理角色、情绪、会话与跨组件状态
- 负责训练结束后的报告请求与展示

### 关键组件

- `SpecialTraining.vue`：专项训练页容器
- `ClassroomSim.vue`：课堂训练 + 主动轮询调试
- `TeachingDocAnalysis.vue`：文档上传、分析结果、调试页面
- `EmotionPanel.vue`：情绪看板可视化

---

## 环境变量建议

以 `.env.example` 为准，常见分组：

- 专项：`VITE_SPECIAL_*`
- 课堂：`VITE_CLASSROOM_*`
- 报告：`VITE_REPORT_*`
- 文档分析：`VITE_DOC_*`

建议至少配置：

- `VITE_SPECIAL_BOT_APP_KEY`
- `VITE_CLASSROOM_BOT_APP_KEY`
- `VITE_REPORT_HTTP_URL`
- `VITE_REPORT_HTTP_API_KEY`

---

## 调试与排障

- 浏览器日志前缀：
  - `[Workflow]`：专项/通用工作流
  - `[ClassroomWorkflow]`：课堂工作流
  - `[ClassroomProactive]`：课堂主动轮询
- SSE 常见问题：
  - 跨域失败：优先检查 `vite.config.js` 代理与后端 CORS
  - 非 SSE 返回：前端会降级按 JSON/文本尝试解析

---

## 安全说明

- `bot_app_key`、API key 等敏感信息仅应存放在 `.env.local`
- `.env.local` 不应提交到仓库
- 生产环境建议通过后端代理转发，避免前端暴露真实凭证

---

## 维护建议

- 新增后端协议字段时，请同步更新：
  - 上传规则
  - 环境变量章节
  - 功能与调试说明
