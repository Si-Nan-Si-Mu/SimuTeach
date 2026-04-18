# teacher-training-agent (SimuTeach)

面向师范生训练的 **Vue 3 + Vite** 单页应用：专项一对一对话、三人格课堂仿真、教学资料分析，经 **HTTP / SSE** 对接工作流与直连评估接口。图表使用本地 **ECharts**（`vendor` 脚本，非 npm 的 `echarts` 包）。

**延伸阅读（`docs/`）**

| 文档 | 用途 |
|------|------|
| [`docs/前端方案说明书.md`](docs/前端方案说明书.md) | 交付与评审：架构、能力、与后端协作要点 |
| [`docs/前端方案说明书.html`](docs/前端方案说明书.html) | 同上内容的排版友好版，内嵌 SVG 流程图，便于导入 Word / 打印 PDF |
| [`docs/mindmap-rendering-architecture.md`](docs/mindmap-rendering-architecture.md) | 教学文档分析：思维导图数据流、ECharts 树图与 Markdown/PDF/JSON 导出 |

---

## 功能概览

### 专项模拟

- 教师消息优先走工作流，失败时可按配置使用本地策略兜底。
- 快捷语驱动路径分析统计（鼓励 / 安抚 / 互动 / 提问 / 批评）。
- 情绪看板按角色隔离，切换人格时可恢复对应上下文。

### 课堂模拟

- 三人格：定向对话、全班广播；头顶气泡与课堂事件记录。
- 控制台：情绪均值与学生明细、主动轮询间隔与调试按钮。
- **训练报告**：仅在课堂模块内提供「结束 · 生成报告」（讲台区与「课堂事件记录」面板备用入口），**侧栏与其他模式不提供**，避免重复触发；生成中按钮禁用，加载层在课堂模式下主要遮挡本模块主区，仍可通过侧栏切换模式（见 `App.vue` 中 `scopedToClassroom` 逻辑）。

### 教学文档分析

- 拖拽 / 选择上传，多文件累计与去重；类型与大小限制见下文「上传规则」。
- 分析结果弹窗：思维导图、教学诊断、执行画像（部分区块默认折叠）。
- 按文件切换历史报告；调试区可开关，支持原始响应导出。
- 分析报告下载：**Markdown**、**PDF**（`html2pdf.js`）、**JSON**。

---

## 技术栈

- 框架：`Vue 3`（`<script setup>`）
- 构建：`Vite`
- 图表：`vendor/front/js/echarts.min.js`（运行时 `<script>` 注入，`window.echarts`）
- PDF 导出：`html2pdf.js`（npm 依赖，构建时按需分包）
- 样式：`vendor/front/css/style.css` + 各组件 `scoped` 样式
- 协议：`HTTP JSON`、`HTTP SSE`（`text/event-stream`）

---

## 依赖与附属包（团队成员复现）

克隆仓库后，除业务代码外，需要区分两类「包」：**npm 安装的依赖**（随 `package.json` / `package-lock.json`）与 **仓库自带的 vendor 资源**（不经过 npm，但必须保留在目录中）。

### 运行环境

| 项 | 说明 |
|------|------|
| **Node.js** | 建议使用 **Current/LTS 较新版本**（例如 **20.x** 或 **22.x**）；需支持 Vite 8 与原生 `fetch` |
| **包管理器** | 使用 **npm**（仓库已含 `package-lock.json`，便于版本锁定） |
| **浏览器** | 支持 ES 模块的现代浏览器（开发/预览用于本地调试） |

### npm 依赖（`package.json`）

安装命令：`npm install`（CI 或严格复现可用 **`npm ci`**，需先有 `package-lock.json`）。

| 包名 | 类型 | 用途 |
|------|------|------|
| **`vue`** | `dependencies` | 应用框架（`<script setup>`、响应式 UI） |
| **`html2pdf.js`** | `dependencies` | 教学文档分析：分析报告 **PDF** 导出（构建时按需动态 `import()`，单独 chunk） |
| **`vite`** | `devDependencies` | 开发与生产构建工具链 |
| **`@vitejs/plugin-vue`** | `devDependencies` | Vite 的 Vue 单文件组件编译插件 |

`html2pdf.js` 作为 npm 包会附带其**传递依赖**（由 `package-lock.json` 锁定，无需手写维护）。团队复现时以 lockfile 为准即可。

### 仓库内置附属资源（非 npm，勿删）

以下文件**不在** `package.json` 的 `dependencies` 中，由项目直接引用，必须与源码一并检出：

| 路径 | 用途 |
|------|------|
| **`vendor/front/js/echarts.min.js`** | ECharts 图表库（教学文档分析思维导图等；运行时 `import.meta.url` 注入 `<script>`，挂载 `window.echarts`） |
| **`vendor/front/js/workflow.js`** | 腾讯云智能体 **qbot SSE** 客户端、`WorkflowClient` / `WorkflowDataStore` 等（由 `src/main.js` 引入） |
| **`vendor/front/css/style.css`** | 全局样式与部分页面视觉基础 |

另有与 `vendor` 对齐的副本 **`front/js/workflow.js`**（当前主入口未引用；保留仅为历史路径兼容，**复现以 `vendor/front/js/workflow.js` 为准**）。

### 复现检查清单

1. `node -v`、`npm -v` 正常。  
2. 在项目根执行 **`npm ci`** 或 **`npm install`**。  
3. 确认存在 **`vendor/front/js/echarts.min.js`** 与 **`vendor/front/js/workflow.js`**。  
4. 复制 **`.env.example` → `.env.local`** 并按注释填写各 `VITE_*`（否则专项/课堂/报告/文档分析接口无法调用）。  
5. **`npm run dev`** 能启动；**`npm run build`** 能产出 `dist/`。

---

## 快速开始

### 1) 安装依赖

```bash
npm install
```

### 2) 配置环境变量

将 `.env.example` 复制为 `.env.local` 并填写密钥与端点（勿提交 `.env.local`）。分组说明见文件内注释。

### 3) 启动开发环境

```bash
npm run dev
```

### 4) 构建与预览

```bash
npm run build
npm run preview
```

生产部署须使用 **`npm run build` 产物 `dist/`** 作为静态站点根目录，不要直接把含 `src/` 的源码目录当站点发布（详见 `.env.example` 顶部说明）。

---

## 教学文档上传规则

前端已做类型与大小校验（与后端约定保持一致即可）：

- 文档：`.pdf` `.doc` `.docx` `.ppt` `.pptx`（单文件最大 **200MB**）
- 文档：`.xlsx` `.xls` `.md` `.txt` `.csv`（单文件最大 **20MB**）
- 抓包：`.pcap`（单文件最大 **20MB**）
- 图片：`.jpg` `.jpeg` `.png`（单文件最大 **50MB**）
- 单次会话最多 **10** 个文件

---

## 目录结构

```text
teacher-training-agent/
├─ public/
├─ docs/                          # 方案说明与思维导图/导出专题文档
├─ vendor/
│  └─ front/
│     ├─ css/style.css
│     └─ js/
│        ├─ echarts.min.js
│        └─ workflow.js
├─ src/
│  ├─ App.vue                     # 根壳：三模式、报告 endSession、跨页状态
│  ├─ main.js
│  ├─ classroom-workflow-inject.js
│  ├─ reportEvaluation.js         # 报告 HTML 片段与 x-evaluation 解析
│  ├─ extractCompletionDialog.js
│  └─ components/
│     ├─ SideBar.vue              # 模式切换、人格与侧栏能力（不含训练报告按钮）
│     ├─ SpecialTraining.vue
│     ├─ ClassroomSim.vue         # 课堂 UI + 主动轮询 + 报告触发 emit('report')
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

### 根组件（`App.vue`）

- 模式：`special` | `classroom` | `doc-analysis`（`v-show` 切换主区，侧栏常驻）。
- 人格、会话、分人格对话与情绪快照；与 `workflow.js` 约定的全局缓存协同。
- **训练报告**：由 `ClassroomSim` 的 `@report` 调用 `endSession()`；`reportGenerationBusy` 用于禁用课堂内按钮并在离开课堂页后恢复加载条进度（若适用）。

### 关键组件

- `SpecialTraining.vue`：专项训练主区。
- `ClassroomSim.vue`：讲台 / 座位 / 气泡 / 控制台 / 报告入口。
- `TeachingDocAnalysis.vue`：上传、SSE 解析、思维导图与导出。
- `EmotionPanel.vue`：专项情绪看板。

---

## 环境变量建议

以 `.env.example` 为准，常见前缀：`VITE_SPECIAL_*`、`VITE_CLASSROOM_*`、`VITE_REPORT_*`、`VITE_DOC_*`。

报告直连至少需要（按你方部署填写）：

- `VITE_REPORT_HTTP_URL`（或开发环境走 Vite 代理同源路径）
- `VITE_REPORT_HTTP_API_KEY`（生产建议经后端代发，避免密钥进前端包）

---

## 调试与排障

浏览器控制台可按前缀过滤：

| 前缀 | 含义 |
|------|------|
| `[Workflow]` | 专项等通用工作流 |
| `[ClassroomWorkflow]` | 课堂手动工作流 |
| `[ClassroomProactive]` | 课堂主动轮询直连 |
| `[ReportDirect]` | 训练报告直连请求与弹窗数据（若启用） |

SSE 常见问题：跨域优先检查 `vite.config.js` 代理与后端 CORS；非标准 SSE 正文时，前端会尝试 JSON / 文本解析降级。

---

## 安全说明

- `bot_app_key`、API key 等仅放在 `.env.local` 或构建机密注入渠道，**勿提交**到 Git。
- `vendor/front/js/workflow.js` 中默认 **不** 内置任何密钥；专项/课堂/报告相关 `bot_app_key` 由 `src/classroom-workflow-inject.js` 在加载工作流脚本前从 `VITE_*` 环境变量写入 `window.__*_INJECT__` 合并进配置。
- 生产环境建议由网关或后端代理转发智能体与报告接口，减少浏览器暴露凭证。

---

## 维护建议

变更协议字段、上传类型或报告形态时，请同步更新：

- 本文「上传规则」与「环境变量」相关段落；
- `docs/` 内与数据流、导出相关的说明；
- `.env.example` 内注释。
