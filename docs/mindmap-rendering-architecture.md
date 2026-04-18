# 教学资料分析 · 思维导图渲染 — 技术结构说明

## 一、技术栈与依赖

| 层级 | 技术 |
|------|------|
| 框架 | Vue 3（`<script setup>` + Composition API） |
| 构建 | Vite 8 |
| 图表 | **ECharts**（通过运行时动态加载本地脚本，**非** npm 包 `echarts`） |
| 脚本路径 | `vendor/front/js/echarts.min.js`（由 `import.meta.url` 解析为资源 URL） |

说明：`package.json` 中未声明 `echarts` 依赖；组件内 `ensureEchartsLoaded()` 向页面插入 `<script>`，挂载到 `window.echarts` 后使用。

---

## 二、页面入口与组件挂载

```
src/main.js
  └─ 挂载 Vue 应用

src/App.vue
  └─ currentMode === 'doc-analysis' 时 v-show 显示
      └─ src/components/TeachingDocAnalysis.vue   ← 教学文档分析（含思维导图）
```

---

## 三、数据流（从工作流到 mindmap 对象）

```
qbot SSE 文本响应（多行 data: / token_stat）
    ↓
parseWorkflowSseEvents(rawText)          // SSE 拆成事件列表
    ↓
getLatestSuccessfulWorkflowPayload()   // 自后向前找 status_summary=success 的 payload
    ↓
payload.procedures[0].debugging.work_flow
    ↓
toWorkflowContentObject(workflow)      // 从 outputs / contents / run_nodes 抽取业务 JSON
    ↓
decodeWorkflowContent()                // 剥洋葱：Content/Answer/reply 等嵌套 JSON 字符串
                                       // + stripMarkdownCodeFence（```json 围栏）
    ↓
contentObj.mindmap                     // 约定结构：{ name, children[] }
    ↓
buildWorkflowVizFromRawText()          // 组装 workflowViz：ready、mindmap、diagnosis、…
    ↓
computed: workflowViz                  // 优先 report.workflowRawText，否则 report.viz / 调试日志
```

**工作流侧约定（前端消费）：**

- 最终可展示对象里应有 **`mindmap`**：`{ name: string, children?: MindmapNode[] }`（树形递归同结构）。
- 可有 **`diagnosis`**：与图谱并列展示，不参与 ECharts 树图。

---

## 四、思维导图「怎么画出来」（ECharts）

### 4.1 DOM 锚点

- 弹窗内：`<div ref="mindmapContainer" class="mindmap-chart">`
- 仅当 `showAnalysisModal && workflowViz.ready && workflowViz.mindmap` 时该区域有意义；`renderMindmapChart()` 依赖该 ref。

### 4.2 数据适配（业务 JSON → ECharts tree）

| 函数 | 作用 |
|------|------|
| `buildMindmapTreeData(mindmap)` | 把工作流 `mindmap` 转成 ECharts tree 节点：`{ name, status: 'covered', children }`（字段名 `name` / `children` 与 `series.data` 约定一致） |

### 4.3 实例与配置

| 步骤 | 说明 |
|------|------|
| `ensureEchartsLoaded()` | 懒加载 `echarts.min.js`，得到 `echarts` 构造函数 |
| `echarts.init(mindmapContainer)` | 在 DOM 上创建实例 |
| `mindmapChart.setOption({ series: [{ type: 'tree', data: [treeData], ... }] })` | **核心：`type: 'tree'`** 树图 |
| `buildMindmapSeriesOption(containerEl)` | `orient: 'LR'`、`roam: true`、标签 `overflow: 'break'`、动态 `right`/`label.width` 等布局与交互 |
| `mindmapSeriesData` | 模块级缓存 `data`，resize 时 `setOption` 合并避免丢数据 |

### 4.4 触发重绘的时机

- `watch`：依赖「弹窗开关、ready、activeReportId、workflowRunId、updatedAt、mindmap.name」等拼接键，变化后 `nextTick` → `renderMindmapChart()`。
- `window.resize` → `resizeMindmapChart()`（`requestAnimationFrame` 内 `resize` + 更新 series 布局参数）。
- 关闭弹窗的 `watch(showAnalysisModal)`：`dispose()` 释放实例，降内存。

### 4.5 交互（与 UI 文案一致）

- `series.roam: true`：**滚轮缩放**、**拖拽平移**画布（提示在 `.mindmap-roam-hint`）。

---

## 五、相关文件与符号索引（便于搜代码）

| 路径 | 与思维导图相关的内容 |
|------|----------------------|
| `src/components/TeachingDocAnalysis.vue` | `decodeWorkflowContent`、`toWorkflowContentObject`、`buildWorkflowVizFromRawText`、`workflowViz`、`buildMindmapTreeData`、`buildMindmapSeriesOption`、`renderMindmapChart`、`resizeMindmapChart`、`mindmapContainer`、模板中 `.mindmap-chart` / `.analysis-graph-card` |
| `vendor/front/js/echarts.min.js` | ECharts 运行时 |
| `src/App.vue` | 挂载 `TeachingDocAnalysis`（`currentMode === 'doc-analysis'`） |

---

## 六、mindmap 数据结构（前端树适配器输入）

```json
{
  "name": "根节点标题",
  "children": [
    {
      "name": "子节点",
      "children": []
    }
  ]
}
```

`buildMindmapTreeData` 递归读取 `name` 与 `children`；缺省则用「未命名」、空数组。

---

## 七、一句话总结

**工作流 SSE → 解析出 `work_flow` 中的 JSON → 取出 `mindmap` 树 → `buildMindmapTreeData` 转成 ECharts 的 `tree` 系列 `data` → `echarts.init` + `setOption` 渲染；窗口缩放与切换报告时复用缓存的 `mindmapSeriesData` 并 `resize`。**

---

## 八、工作流侧可选优化

若希望减少前端特殊处理，可在 **大模型 / 回复节点** 的提示里要求：**只输出 JSON，不要 markdown 代码块**（避免 `` ```json `` 包裹的 `Content`）。
