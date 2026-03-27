# teacher-training-agent（SimuTeach）

面向师范生训练的前端仿真系统，提供两种训练模式：

- **专项模拟**：一对一数字学生对话训练（对话 + 情绪看板 + 路径分析 + 报告）。
- **课堂模拟**：三人格课堂场景（讲台/座位/气泡反馈/课堂事件/情绪统计），支持主动轮询调试。

项目基于 **Vue 3 + Vite**，工作流与课堂后端通过 HTTP/SSE 对接，图表使用本地 ECharts 资源。

---

## 1. 项目亮点

- 双模式统一在一个应用内切换：专项训练 + 课堂训练。
- 支持工作流流式回复（SSE）与文本 JSON 回复提炼。
- 报告弹窗支持 `x-evaluation`、`x-debug` 可视化。
- 课堂端支持主动会话轮询（`proactive=true`）与前端调试工具。
- 移动端优化：专项和课堂都支持双页切换（对话页 / 数据页）。

---

## 2. 技术栈

- **框架**：Vue `^3.5.30`（SFC + `<script setup>`）
- **构建工具**：Vite `^8.0.0`
- **图表**：ECharts（本地文件 `vendor/front/js/echarts.min.js`）
- **样式体系**：
  - `vendor/front/css/style.css`（主视觉与公共组件）
  - 组件内 scoped/局部覆盖样式（移动端与特定模块）
- **通信协议**：
  - HTTP JSON
  - HTTP SSE（`text/event-stream`）

---

## 3. 快速开始

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
npm run preview
```

---

## 4. 目录结构（最新）

```text
teacher-training-agent/
├─ index.html
├─ package.json
├─ vite.config.js
├─ .env.example
├─ .env.local
├─ README.md
├─ public/
│  └─ favicon.svg
├─ vendor/
│  └─ front/
│     ├─ css/
│     │  └─ style.css
│     └─ js/
│        ├─ echarts.min.js
│        └─ workflow.js
└─ src/
   ├─ main.js
   ├─ style.css
   ├─ App.vue
   ├─ classroom-workflow-inject.js
   ├─ reportEvaluation.js
   ├─ extractCompletionDialog.js
   └─ components/
      ├─ SideBar.vue
      ├─ SpecialTraining.vue
      ├─ ChatBox.vue
      ├─ EmotionPanel.vue
      └─ ClassroomSim.vue
```

---

## 5. 前端架构与数据流

### 5.1 启动入口

1. `src/main.js` 先注入 `classroom-workflow-inject.js`
2. 再加载 `vendor/front/js/workflow.js`
3. 挂载 `App.vue`

### 5.2 根组件 `App.vue`

- 管理全局模式：`special` / `classroom`
- 管理当前角色、情绪、会话 id、跨角色对话历史
- 挂接 `window.ChatEngine`、`window.EmotionDashboard`、`window.App`
- 负责“结束训练 -> 报告请求 -> 报告弹窗”

### 5.3 核心组件分工

- `SideBar.vue`
  - 模式切换
  - 角色选择
  - 自定义人格（五维可编辑）
  - 工作流数据弹窗入口、报告入口
- `SpecialTraining.vue`
  - 移动端双页：对话 / 看板
  - 封装 `ChatBox + EmotionPanel`
- `ClassroomSim.vue`
  - 课堂讲台、三角色座位、对话输入、头顶气泡
  - 情绪均值看板、课堂事件记录
  - 主动轮询调试工具
- `EmotionPanel.vue`
  - 实时情绪状态
  - 情绪条 / 路径分析 / 雷达 / 折线
- `reportEvaluation.js`
  - 报告 JSON 解析与可视化 HTML 拼装
  - OU 参数中文映射、能力评估构建、建议生成
- `extractCompletionDialog.js`
  - 从文本 JSON / 片段中提炼 `choices[0].message.content`

---

## 6. 前端功能文档（完整）

## 6.1 专项模拟

- 教师发送后优先走工作流。
- 工作流失败或空返回时走本地回退策略（情绪增量 + 学生回复模板）。
- 快捷语会触发路径分析统计（鼓励/安抚/互动/提问/批评）。
- 右侧看板按当前角色独立缓存和恢复。

## 6.2 课堂模拟

- 三人格角色：李大志、张一鸣、林暖暖。
- 点击角色可定向对话，否则广播全班。
- **手动对话发送走工作流**：调用 `WorkflowClient.sendClassroomBroadcast`（课堂 Bot）。
- 学生回复显示在角色头顶气泡。
- 数据页包含：
  - 三人格情绪均值
  - 各学生情绪明细
  - 课堂事件记录（对话 / 学生反馈 / 系统）
- 移动端双页切换：`💬 对话` / `📊 数据`。

## 6.3 课堂主动会话（新增）

课堂模拟提供“主动对话调试”区：

- 轮询秒数输入（5~300）
- 应用轮询设置
- 开启/停止轮询
- 手动测试主动会话

主动请求特点：

- **直连课堂后端**（不经过 `WorkflowClient.sendClassroomBroadcast` 发送链路）
- 默认直连 `.env` 中 `VITE_REPORT_HTTP_URL`（并使用 `VITE_REPORT_HTTP_API_KEY`）
- `content` 为空字符串
- 请求 JSON 顶层字段 `proactive: true`
- 返回展示规则（严格）：
  - 若返回 `choices=ind`（含 `preview.choices=ind`）视为无有效回复，不显示
  - 仅当返回中存在 `x-proactive` 且可提炼出文本时，才序列化到课堂角色气泡
  - 其它返回一律不显示

## 6.4 报告系统（训练结束）

报告支持三层数据：

1. 本地统计：轮次/建议/能力评分（无后端时）
2. `x-evaluation`：大类评分、指标详情、命中样本、OU 参数
3. `x-debug`：情绪快照展示

并支持：

- 有 `x-evaluation.categories` 时，用后端大类驱动能力雷达与条形图
- `ou_params` 中文标签映射展示
- 指标文案中文化（次数/得分/归一化得分）

---

## 7. 工作流与后端对接说明

## 7.1 配置来源

通过 `src/classroom-workflow-inject.js` 把 `.env` 注入到 `window`：

- `window.__WORKFLOW_INJECT__`（专项）
- `window.__REPORT_WORKFLOW_INJECT__`（报告）
- `window.__CLASSROOM_WORKFLOW_INJECT__`（课堂）

`vendor/front/js/workflow.js` 启动时合并这些配置。

## 7.2 主要客户端能力（`workflow.js`）

- `sendTeacherMessageToWorkflow`：专项对话发送
- `sendTextMessage`：专项文本入口
- `sendClassroomBroadcast`：课堂工作流发送（常规课堂消息）
- `sendTrainingReport`：报告接口请求
- `sendModelSwitch`：模型/人格切换
- `readSSEStream`：SSE 分帧解析与正文提炼

## 7.3 文本 JSON 提炼

`extractCompletionDialog.js` + `workflow.js` 会尽量从下列结构提炼对话正文：

- `choices[0].message.content`
- `payload/content/text/reply/message`
- 不完整 JSON 片段（流式场景）
- 宽松 JSON（含未加引号 key）

目标是避免把 `can_feedback` 等元数据壳直接显示到气泡中。

补充（课堂主动对话）：

- 主动轮询的解析位于 `ClassroomSim.vue`，对 `x-proactive` 做了白名单展示。
- `choices=ind` 会被判定为后端“无回复”标记并过滤。

---

## 8. 环境变量（建议）

以 `.env.example` 为准，典型分组：

- 专项模拟：`VITE_SPECIAL_*`
- 课堂模拟：`VITE_CLASSROOM_*`
- 训练报告：`VITE_REPORT_*`

建议至少配置：

- `VITE_SPECIAL_BOT_APP_KEY`
- `VITE_CLASSROOM_BOT_APP_KEY`
- 报告接口相关 `VITE_REPORT_HTTP_URL` / `VITE_REPORT_HTTP_API_KEY`

说明：

- 课堂手动对话仍使用 `VITE_CLASSROOM_*`（工作流）
- 课堂主动轮询调试当前复用 `VITE_REPORT_HTTP_URL` 作为直连后端地址
- 未配置 `VITE_REPORT_HTTP_URL` 时，生产构建默认直连 **`https://agent.orangeblog.us.kg:8000`**（仅报告与课堂主动 HTTP；专项/课堂工作流 SSE 仍由 `VITE_SPECIAL_*` / `VITE_CLASSROOM_*` 决定）

---

## 9. 调试与排障

- 浏览器控制台关键前缀：
  - `[Workflow]`：专项与通用工作流
  - `[ClassroomWorkflow]`：课堂工作流
  - `[ClassroomProactive]`：课堂主动轮询直连请求日志
- SSE 常见问题：
  - CORS 被拦截：优先配置 `proxyUrl`
  - 返回非 SSE：客户端会尝试按 JSON 或纯文本降级解析

---

## 10. 安全说明

- `bot_app_key`、报告 API key 属于敏感信息。
- 请勿将真实密钥提交到公开仓库。
- 推荐生产环境通过后端代理签发或转发，前端仅使用受控接口。

---

## 11. 版本说明

当前 README 对应的是本仓库“课堂主动轮询调试 + 移动端双页 + 自定义人格 + 报告可视化增强”版本。  
若后续新增后端协议字段，请同步更新本 README 的“功能文档”和“对接说明”章节。
