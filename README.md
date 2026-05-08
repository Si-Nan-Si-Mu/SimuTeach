# SimuTeach（teacher-training-agent）

面向师范生训练的 **Vue 3 + Vite** 单页应用：专项一对一对话、三人格课堂仿真、教学资料分析；智能体能力经 **自建后端 HTTP JSON** 接入（默认 **非 SSE**），训练报告走独立 JSON 接口。图表使用本地 **ECharts**（`vendor` 脚本，经运行时注入挂载 `window.echarts`，非 `echarts` npm 主包）。

**主仓库**：<https://github.com/Si-Nan-Si-Mu/SimuTeach>（`git@github.com:Si-Nan-Si-Mu/SimuTeach.git`）

---

## 近期变更摘要（后端接入）

- **统一后端**：在 `.env.local` 配置 `VITE_BACKEND_BASE_URL`（及可选 `VITE_BACKEND_API_KEY`）后，专项对话、课堂对话、训练报告、文档分析请求均发往该前缀下的路径（默认 `/simu/special/chat`、`/simu/classroom/chat`、`/simu/report`、`/simu/doc/chat`，均可覆盖）。详见 **`src/classroom-workflow-inject.js`**。
- **默认 JSON、取消 SSE**：配置统一后端且 **未** 将 `VITE_BACKEND_USE_JSON_RESPONSE` 设为 `false` 时，对话类请求使用 `Accept: application/json`，请求体中 `stream: disable`，响应按 **单次 JSON** 解析（含 Chat Completions 形与 `x-debug` 情绪字段）。需要兼容腾讯云式流式时再设 `VITE_BACKEND_USE_JSON_RESPONSE=false`。实现见 **`vendor/front/js/workflow.js`**。
- **对接规范**：后端可自行实现路由与鉴权，与前端约定见 **`docs/BACKEND_INTEGRATION_SPEC.md`**（请求体字段、`Authorization`、响应形状等）。

---

**延伸阅读（`docs/`）**

| 文档 | 用途 |
|------|------|
| [**`docs/BACKEND_INTEGRATION_SPEC.md`**](docs/BACKEND_INTEGRATION_SPEC.md) | **后端配置与数据交互规范**（路径、JSON/SSE 开关、qbot 形请求体、报告接口） |
| [`docs/前端方案说明书.md`](docs/前端方案说明书.md) | 交付与评审：架构、能力、与后端协作要点 |
| [`docs/mindmap-rendering-architecture.md`](docs/mindmap-rendering-architecture.md) | 教学文档分析：思维导图数据流、ECharts 树图与 Markdown/PDF/JSON 导出 |
| [`docs/SimuTeach-实际系统架构.md`](docs/SimuTeach-实际系统架构.md) | 系统架构与模块关系（纲要） |
| [`docs/第7章-技术实现材料说明.md`](docs/第7章-技术实现材料说明.md) | 技术实现与材料说明 |

---

## 功能概览

### 专项模拟

- 教师消息优先走工作流，失败时可按配置使用本地策略兜底。
- 快捷语驱动路径分析统计（鼓励 / 安抚 / 互动 / 提问 / 批评）。
- 情绪看板按角色隔离，切换人格时可恢复对应上下文。
- **能力维度与角色对应**（与课堂报告、侧栏副标题一致，定义见 `src/constants/specialTrainingFocus.js`）：
  - 李大志 → 讲解清晰度  
  - 张一鸣 → 课堂管理  
  - 林暖暖 → 心理沟通  

### 课堂模拟

- 三人格：定向对话、全班广播；头顶气泡与课堂事件记录。
- 控制台：情绪均值与学生明细、主动轮询间隔与调试按钮。
- **训练报告**：仅在课堂模块内提供「结束 · 生成报告」（讲台区与「课堂事件记录」面板备用入口），**其他模式侧栏不重复放入口**；生成中可切换侧栏。桌面端全屏报告遮罩自侧栏外缘起算，避免挡住侧栏收缩钮；顶栏为「教学训练报告」，能力评估区为双列等宽（雷达 + 条形图）布局。

### 教学文档分析

- 拖拽 / 选择上传，多文件累计与去重；类型与大小限制见下文「上传规则」。
- 分析结果弹窗：思维导图、教学诊断、执行画像（部分区块默认折叠）。思维导图（ECharts 树图）在 canvas 上使用**与设计 token 一致的实色字线**，避免 `var()` 在 canvas 中退成白字难辨。
- 按文件切换历史报告；调试区可开关，支持原始响应导出。
- 分析报告下载：**Markdown**、**PDF**（`html2pdf.js`）、**JSON**。

### 侧栏

- 模式：专项模拟 / 课堂模拟 / 教学文档分析；专项下可选三人格学生。
- **工作流数据** 入口固定在侧栏**底部**（与页脚同区），**不再提供「自定义人格」**侧栏入口（原弹窗与五维滑块已移除）。

---

## 技术栈

- 框架：`Vue 3`（`<script setup>`）
- 构建：`Vite` 8
- 图标：`lucide-vue-next`（侧栏等）
- 图表：`vendor/front/js/echarts.min.js`（运行时 `<script>` 注入，`window.echarts`）
- PDF 导出：`html2pdf.js`（npm 依赖，构建时按需分包）
- 样式：`vendor/front/css/style.css` + 各组件样式（部分页面含全局与 `--app-*` 变量）
- 与智能体通信：**HTTP JSON**（默认）；可选 **HTTP SSE**（`VITE_BACKEND_USE_JSON_RESPONSE=false` 或未配置统一后端且直连腾讯云时）

---

## 依赖与附属包（团队成员复现）

克隆仓库后，需区分 **npm 依赖**与**仓库 vendor 资源**（不经过 npm，须保留）。

### 运行环境

| 项 | 说明 |
|------|------|
| **Node.js** | 建议 **20.x** 或 **22.x**（LTS/Current，需支持 Vite 8） |
| **包管理器** | **npm**（已含 `package-lock.json`） |
| **浏览器** | 支持 ES 模块的现代浏览器 |

### npm 依赖（`package.json`）

```bash
npm install
# 或严格复现：npm ci
```

| 包名 | 说明 |
|------|------|
| `vue` | 应用框架 |
| `lucide-vue-next` | 侧栏等矢量图标 |
| `html2pdf.js` | 教学文档分析 PDF 导出（按需动态 import，单独 chunk） |
| `vite`、`@vitejs/plugin-vue` | 构建与 SFC 编译 |
| `@rolldown/binding-win32-x64-msvc` 等 | 随 Vite 工具链/平台（以 lockfile 为准） |

### 仓库内置资源（勿删）

| 路径 | 用途 |
|------|------|
| `vendor/front/js/echarts.min.js` | ECharts，教学报告 / 教学文档分析导图等 |
| `vendor/front/js/workflow.js` | 对话 / 课堂 / 报告 HTTP 客户端（由 `src/main.js` 引入） |
| `vendor/front/css/style.css` | 全局与报告等基础样式 |
| `public/avatars/*.png` | 三人格带头像等静态资源 |
| `public/icons/*.png` | 课堂与情绪等图标（若引用） |

另有历史副本 **`front/js/workflow.js`**；**以 `vendor/front/js/workflow.js` 为准**。

### 复现检查清单

1. `node -v`、`npm -v` 正常。  
2. 根目录执行 `npm ci` 或 `npm install`。  
3. 存在 `vendor/front/js/echarts.min.js` 与 `vendor/front/js/workflow.js`。  
4. 复制 **`.env.example` → `.env.local`** 并填写各 `VITE_*`（**勿提交** `.env.local`）。  
5. `npm run dev` 能启动；`npm run build` 能产出 `dist/`。  

---

## 快速开始

### 1) 安装依赖

```bash
npm install
```

### 2) 配置环境变量

将 `.env.example` 复制为 `.env.local` 并填写。统一后端至少配置：

- `VITE_BACKEND_BASE_URL` — 如 `http://127.0.0.1:8787` 或同源 `/api`
- `VITE_BACKEND_API_KEY` — 可选 Bearer

完整说明与路径覆盖见 **`.env.example`** 与 **`docs/BACKEND_INTEGRATION_SPEC.md`**。

### 3) 启动开发环境

```bash
npm run dev
```

### 4) 构建与预览

```bash
npm run build
npm run preview
```

生产部署以 **`dist/`** 为静态站点根，勿直接发布未构建的 `src/`。

---

## 教学文档上传规则

与 `TeachingDocAnalysis.vue` 中 `FILE_RULES` 等保持一致（若有变更请同步本段）：

- 常见文档：`.docx` `.pptx` 等（单文件上限以代码为准，如 200MB）
- 图片：`.jpg` `.jpeg` `.png`（如单文件 50MB）
- 单次会话文件数上限（如 **10** 个）见组件内常量

---

## 目录结构（摘要）

```text
teacher-training-agent/
├─ public/                    # 静态资源：avatars、icons、favicon
├─ docs/                      # 方案、架构、**后端对接规范**等
├─ front/                     # 历史/备用静态页与脚本（主入口为根目录 Vite 应用）
├─ vendor/front/
│  ├─ css/style.css
│  └─ js/
│     ├─ echarts.min.js
│     └─ workflow.js
├─ src/
│  ├─ App.vue
│  ├─ main.js
│  ├─ classroom-workflow-inject.js
│  ├─ reportEvaluation.js
│  ├─ constants/              # 如 specialTrainingFocus.js、studentColors.js
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

### 根组件（`App.vue`）

- 模式：`special` | `classroom` | `doc-analysis`（`v-show` 切主区，侧栏常驻）。
- 人格、会话、分桶对话、情绪、报告 `endSession` 等与工作流/报告逻辑协同。
- 侧栏宽度与报告遮罩通过 `--app-sidebar-outer` 等协调（见 `SideBar.vue` / `App.vue` 样式）。

### 关键组件

| 文件 | 职责 |
|------|------|
| `SpecialTraining.vue` | 专项：对话 + 情绪看板 |
| `ClassroomSim.vue` | 课堂：讲台/座位/气泡/控制台/报告入口 |
| `TeachingDocAnalysis.vue` | 文档上传、分析请求、导图、导出 |
| `EmotionPanel.vue` | 专项情绪与图表 |
| `ChatBox.vue` | 专项对话与顶栏学生信息 |
| `SideBar.vue` | 模式、学生、工作流数据（底部） |

---

## 环境变量

以 **`.env.example`** 为准。统一后端相关：`VITE_BACKEND_BASE_URL`、`VITE_BACKEND_API_KEY`、`VITE_BACKEND_PATH_*`、`VITE_BACKEND_USE_JSON_RESPONSE` 等。

生产环境建议经网关将 `/api` 反代到后端，减少浏览器直暴露密钥；约定见 **`docs/BACKEND_INTEGRATION_SPEC.md`**。

---

## 调试与排障

浏览器控制台可按前缀过滤，例如：

| 前缀 | 含义 |
|------|------|
| `[Workflow]` | 专项对话客户端 |
| `[ClassroomWorkflow]` / `[ClassroomProactive]` | 课堂 |
| `[ReportDirect]` | 报告与弹窗数据 |

JSON 模式下若解析失败，检查响应是否为合法 JSON 及是否与规范中的字段一致。仍使用 SSE 时优先查网关与 CORS。

---

## 安全说明

- 密钥、API key 仅放 `.env.local` 或 CI 机密，**勿提交**。
- `window.__*__INJECT__` 等由 `classroom-workflow-inject.js` 在加载工作流前自 `VITE_*` 注入，勿在公开仓库内写死密钥。

---

## 维护建议

协议、上传类型、报告或环境变量有变更时，请同步更新：

- 本 README 与 **`docs/BACKEND_INTEGRATION_SPEC.md`**；  
- `docs/` 中相关数据流/导出说明；  
- `.env.example` 注释。  

---

## 其他

- 根目录下可选 **`front/index.html`** 等用于独立演示/旧版入口；**主应用**以根目录 Vite 项目（`index.html` + `src/main.js`）为准。
