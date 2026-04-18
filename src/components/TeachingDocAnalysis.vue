<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch, TransitionGroup } from 'vue'

const MAX_FILES = 10
const FILE_RULES = [
  { exts: ['docx', 'pptx'], maxMb: 200 },
  { exts: ['jpg', 'jpeg', 'png'], maxMb: 50 },
]
const ACCEPT_TYPES = FILE_RULES.flatMap((rule) => rule.exts.map((ext) => `.${ext}`)).join(',')
// 固定使用官方 qbot SSE 地址
const DOC_WORKFLOW_API_KEY = import.meta.env.VITE_DOC_WORKFLOW_API_KEY?.trim() || ''
const DOC_WORKFLOW_AUTHORIZATION = import.meta.env.VITE_DOC_WORKFLOW_AUTHORIZATION?.trim() || ''
const DOC_WORKFLOW_APP_KEY = import.meta.env.VITE_DOC_BOT_APP_KEY?.trim() || ''
const DOC_WORKFLOW_ENTRY = import.meta.env.VITE_DOC_WORKFLOW_ENTRY?.trim() || ''
const DOC_FILE_UPLOAD_URL = import.meta.env.VITE_DOC_FILE_UPLOAD_URL?.trim() || ''
const DOC_STORAGE_CREDENTIAL_URL =
  import.meta.env.VITE_DOC_STORAGE_CREDENTIAL_URL?.trim() || '/api/describe-storage-credential'
const DOC_STORAGE_BOT_BIZ_ID = import.meta.env.VITE_DOC_STORAGE_BOT_BIZ_ID?.trim() || ''
const DOC_COS_UPLOAD_PROXY_URL = import.meta.env.VITE_DOC_COS_UPLOAD_PROXY_URL?.trim() || '/api/cos-upload'
// qbot SSE 请求体与 vendor/front/js/workflow.js buildRequestBodyWithConfig 对齐（专项模拟同类字段）
const DOC_SSE_VISITOR_BIZ_ID =
  import.meta.env.VITE_DOC_VISITOR_BIZ_ID?.trim() || 'teacher-001'
const DOC_SSE_ROLE = import.meta.env.VITE_DOC_SSE_ROLE?.trim() || 'teacher'
const DOC_SSE_TRIGGER = import.meta.env.VITE_DOC_SSE_TRIGGER?.trim() || '互动'
const DOC_SSE_CHARACTER_ID = import.meta.env.VITE_DOC_SSE_CHARACTER_ID?.trim() || ''
const DOC_SSE_MODEL_NAME = import.meta.env.VITE_DOC_SSE_MODEL_NAME?.trim() || ''
const DOC_QBOT_SSE_WORKFLOW_STATUS =
  import.meta.env.VITE_DOC_WORKFLOW_STATUS?.trim() || 'enable'

function getQbotSseFallbackUrl() {
  return 'https://wss.lke.cloud.tencent.com/v1/qbot/chat/sse'
}

function getDocBotAppKey() {
  if (DOC_WORKFLOW_APP_KEY) return DOC_WORKFLOW_APP_KEY
  if (typeof window !== 'undefined' && window.WORKFLOW_CONFIG?.botAppKey) {
    const k = String(window.WORKFLOW_CONFIG.botAppKey).trim()
    if (k) return k
  }
  return ''
}

/** 固定使用官方 qbot SSE，不再按优先级解析其它地址 */
function resolveDocWorkflowEndpoint(_extra) {
  return getQbotSseFallbackUrl()
}

const files = ref([])
const sending = ref(false)
/** 当前批次总文件数（用于进度展示；切换模块后回到本页仍可读） */
const analysisBatchTotal = ref(0)
/** 当前批次已完成数量 */
const analysisBatchDone = ref(0)
const sent = ref(false)
const dragOver = ref(false)
const sendError = ref('')
const sendInfo = ref('')
const debugLogs = ref([])
const showPreviousDebugLogs = ref(false)
const showDebugPanel = ref(false)
const showExecutionPanel = ref(false)
const showAnalysisModal = ref(false)
const mindmapContainer = ref(null)
let mindmapChart = null
/** resize 时 setOption 合并需带上 data，避免部分 ECharts 版本清空 series */
let mindmapSeriesData = null
const fileReports = ref([])
const activeReportId = ref('')

const activeFileReport = computed(() => {
  if (!fileReports.value.length) return null
  const hit = fileReports.value.find((x) => x.id === activeReportId.value)
  return hit || fileReports.value[0]
})

watch(
  () => fileReports.value.length,
  (len) => {
    if (!len) {
      showAnalysisModal.value = false
      activeReportId.value = ''
    }
  }
)

function formatReportTime(ts) {
  const n = Number(ts || 0)
  if (!Number.isFinite(n) || n <= 0) return '--:--:--'
  try {
    return new Date(n).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch (_) {
    return '--:--:--'
  }
}

function reportStatusIcon(report) {
  if (!report || !report.viz) return '⏳'
  return report.viz.ready ? '✅' : '⚠️'
}

function reportStatusText(report) {
  if (!report || !report.viz) return '待分析'
  return report.viz.ready ? '已完成分析' : '分析未完成'
}

const totalSizeText = computed(() => {
  const total = files.value.reduce((sum, f) => sum + (Number(f.size) || 0), 0)
  if (total < 1024) return `${total} B`
  if (total < 1024 * 1024) return `${(total / 1024).toFixed(1)} KB`
  return `${(total / 1024 / 1024).toFixed(2)} MB`
})

const analysisProgressLine = computed(() => {
  if (!sending.value || !analysisBatchTotal.value) return ''
  return `批次进度 ${analysisBatchDone.value}/${analysisBatchTotal.value}`
})

/** 弱提示：底部轻量 Toast，最多叠 2 条，自动消失 */
const docToasts = ref([])
let docToastSeq = 0
const docToastTimerById = new Map()

function clearAllDocToasts() {
  for (const tid of docToastTimerById.values()) {
    window.clearTimeout(tid)
  }
  docToastTimerById.clear()
  docToasts.value = []
}

function pushDocToast(text, kind = 'ok') {
  if (typeof window === 'undefined' || !text) return
  const id = ++docToastSeq
  docToasts.value = [...docToasts.value, { id, text: String(text), kind }].slice(-2)
  const tid = window.setTimeout(() => {
    docToasts.value = docToasts.value.filter((t) => t.id !== id)
    docToastTimerById.delete(id)
  }, 3400)
  docToastTimerById.set(id, tid)
}

function parseJsonTextSafe(text) {
  if (!text || typeof text !== 'string') return null
  try {
    return JSON.parse(text)
  } catch (_) {
    return null
  }
}

function getLatestLogByLabel(label) {
  return debugLogs.value.find((item) => item.label === label) || null
}

/** 导出/摘要时优先用当前报告内保存的 SSE，其次调试面板中的最新一条 */
function resolveWorkflowRawForExport() {
  const r = activeFileReport.value
  if (r?.workflowRawText && String(r.workflowRawText).trim()) return r.workflowRawText
  const hit = getLatestLogByLabel('工作流原始响应')
  return hit?.text || ''
}

/**
 * 大体积 SSE 中 reply 占绝大部分；仅保留 token_stat 相关行即可重新解析成功帧，显著降内存。
 */
function shrinkWorkflowSseTextForStorage(fullText) {
  if (!fullText || typeof fullText !== 'string' || fullText.length < 8000) return fullText
  const ev = parseWorkflowSseEvents(fullText)
  const stat = ev.filter(
    (e) =>
      e.event === 'token_stat' ||
      (e.parsed && typeof e.parsed === 'object' && e.parsed.type === 'token_stat')
  )
  if (!stat.length) return fullText
  return stat.map((e) => `data: ${e.raw}`).join('\n\n')
}

const MAX_DEBUG_LOG_ENTRIES = 36
const MAX_DEBUG_TEXT_SOFT = 72 * 1024
const MAX_DEBUG_TEXT_OTHER = 24 * 1024
const DEBUG_COMPACT_JSON_LABELS = new Set([
  '工作流请求JSON(file_url模式)',
  '工作流请求(纯文本 URL)',
  'DescribeStorageCredential 解析JSON',
  '文件上传解析JSON',
])

function clipDebugText(label, text) {
  if (typeof text !== 'string') return text
  if (label === '工作流原始响应') {
    if (text.length <= MAX_DEBUG_TEXT_SOFT) return text
    return `...[已省略前 ${text.length - MAX_DEBUG_TEXT_SOFT} 字符，仅保留末尾 SSE 便于调试]\n${text.slice(
      -MAX_DEBUG_TEXT_SOFT
    )}`
  }
  if (text.length <= MAX_DEBUG_TEXT_OTHER) return text
  return `${text.slice(0, MAX_DEBUG_TEXT_OTHER)}\n...[已截断 ${text.length - MAX_DEBUG_TEXT_OTHER} 字符]`
}

function getLatestLogJsonByLabel(label) {
  const item = getLatestLogByLabel(label)
  if (!item) return null
  return parseJsonTextSafe(item.text)
}

function extractAssistantReplyFromSse(sseText) {
  if (!sseText || typeof sseText !== 'string') return ''
  const lines = sseText.split('\n')
  let merged = ''
  for (const line of lines) {
    const t = line.trim()
    if (!t.startsWith('data:')) continue
    const raw = t.slice(5).trim()
    if (!raw) continue
    let obj = null
    try {
      obj = JSON.parse(raw)
    } catch (_) {
      continue
    }
    const payload = obj && obj.payload && typeof obj.payload === 'object' ? obj.payload : obj
    const fromSelf = !!(payload && payload.is_from_self)
    if (fromSelf) continue
    const content = payload && typeof payload.content === 'string' ? payload.content : ''
    if (content) merged += content
  }
  return merged.trim()
}

/**
 * 解析 SSE 文本为离散事件。兼容：\r\n、UTF-8 BOM、同一条消息内多行 data:（RFC 合并为 \n）、空行分隔消息。
 */
function parseWorkflowSseEvents(sseText) {
  if (!sseText || typeof sseText !== 'string') return []
  const normalized = sseText.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '')
  const lines = normalized.split('\n')
  const events = []
  let currentEvent = ''
  let dataParts = []

  const flushMessage = () => {
    if (!dataParts.length) return
    const raw = dataParts.join('\n').trim()
    dataParts = []
    if (!raw || raw === '[DONE]') return
    const pushOne = (rawStr, parsed) => {
      const evName =
        (parsed && typeof parsed === 'object' && typeof parsed.type === 'string' && parsed.type) ||
        currentEvent ||
        'message'
      events.push({
        event: evName,
        raw: rawStr,
        parsed,
      })
    }
    try {
      pushOne(raw, JSON.parse(raw))
      currentEvent = ''
      return
    } catch (_) {
      /* 多条 data: 未用空行分隔时，合并解析会失败，再按行尝试 */
    }
    let any = false
    for (const piece of raw.split('\n')) {
      const t = piece.trim()
      if (!t) continue
      try {
        pushOne(t, JSON.parse(t))
        any = true
      } catch (_) {
        /* ignore */
      }
    }
    if (!any) events.push({ event: currentEvent || 'message', raw, parsed: null })
    currentEvent = ''
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    const trimmed = line.trim()
    if (!trimmed) {
      flushMessage()
      continue
    }
    if (trimmed.startsWith('event:')) {
      flushMessage()
      currentEvent = trimmed.slice(6).trim()
      continue
    }
    if (trimmed.startsWith('data:')) {
      dataParts.push(trimmed.slice(5).replace(/^\s/, ''))
      continue
    }
    if (dataParts.length && (line.startsWith(' ') || line.startsWith('\t'))) {
      dataParts[dataParts.length - 1] += '\n' + line.replace(/^\s/, '')
    }
  }
  flushMessage()
  return events
}

function downloadLatestWorkflowRawJson() {
  const rawText = resolveWorkflowRawForExport()
  if (!rawText) {
    sendError.value = '暂无可下载的工作流原始响应'
    return
  }
  const events = parseWorkflowSseEvents(rawText)
  const payload = {
    exported_at: new Date().toISOString(),
    source_label: '工作流原始响应',
    event_count: events.length,
    events,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  a.href = url
  a.download = `teaching-doc-workflow-raw-${stamp}.json`
  a.click()
  URL.revokeObjectURL(url)
}

const visualSummary = computed(() => {
  const credentialRaw = getLatestLogJsonByLabel('DescribeStorageCredential 解析JSON')
  const credential = credentialRaw && credentialRaw.Response ? credentialRaw.Response : credentialRaw
  const uploadReq = getLatestLogJsonByLabel('文件上传请求(原始文件)')
  const uploadRes = getLatestLogJsonByLabel('文件上传响应状态')
  const wfRes = getLatestLogJsonByLabel('工作流响应状态')
  const wfLog = getLatestLogByLabel('工作流原始响应')
  const wfRawText = wfLog?.text || resolveWorkflowRawForExport() || ''
  const assistantReply = extractAssistantReplyFromSse(wfRawText)
  return {
    credential: credential || null,
    uploadReq: uploadReq || null,
    uploadRes: uploadRes || null,
    wfRes: wfRes || null,
    assistantReply,
  }
})

function parseJsonSafe(value) {
  if (typeof value !== 'string') return null
  try {
    return JSON.parse(value)
  } catch (_) {
    return null
  }
}

/**
 * 大模型常把 JSON 包在 ```json ... ``` 里；外层 JSON.parse 后 Content 仍是非法 JSON 字符串，需先剥围栏再解析。
 */
function stripMarkdownCodeFence(str) {
  if (typeof str !== 'string') return str
  let s = str.trim()
  if (!s.startsWith('```')) return s
  const open = s.match(/^```([a-zA-Z0-9_-]*)\r?\n?/)
  if (open) s = s.slice(open[0].length)
  s = s.replace(/\r?\n```\s*$/, '').replace(/```\s*$/, '').trim()
  return s
}

const WORKFLOW_NESTED_TEXT_KEYS = [
  'Content',
  'content',
  'Answer',
  'answer',
  'Reply',
  'reply',
  'Output',
  'output',
  'Text',
  'text',
]

function decodeWorkflowContent(rawValue) {
  if (rawValue == null) return null
  if (typeof rawValue === 'object') {
    for (const k of WORKFLOW_NESTED_TEXT_KEYS) {
      if (typeof rawValue[k] === 'string') {
        const nested = decodeWorkflowContent(rawValue[k])
        if (nested && typeof nested === 'object' && (nested.mindmap || nested.diagnosis)) return nested
      }
    }
    if (rawValue.mindmap || rawValue.diagnosis) return rawValue
    return rawValue
  }
  if (typeof rawValue !== 'string') return null
  let current = stripMarkdownCodeFence(rawValue.trim())
  for (let i = 0; i < 10; i += 1) {
    let parsed = parseJsonSafe(current)
    if (!parsed && typeof current === 'string' && current.includes('```')) {
      current = stripMarkdownCodeFence(current)
      parsed = parseJsonSafe(current)
    }
    if (!parsed) break
    if (typeof parsed === 'string') {
      current = stripMarkdownCodeFence(parsed.trim())
      continue
    }
    if (parsed && typeof parsed === 'object') {
      for (const k of WORKFLOW_NESTED_TEXT_KEYS) {
        if (typeof parsed[k] === 'string') {
          const nested = decodeWorkflowContent(parsed[k])
          if (nested && typeof nested === 'object') return nested || parsed
        }
      }
      if (parsed.mindmap || parsed.diagnosis) return parsed
      return parsed
    }
    break
  }
  return parseJsonSafe(stripMarkdownCodeFence(String(rawValue).trim()))
}

function payloadLooksWorkflowSuccess(payload) {
  if (!payload || typeof payload !== 'object') return false
  const sum = String(payload.status_summary ?? payload.StatusSummary ?? '')
    .trim()
    .toLowerCase()
  if (sum === 'success') {
    return Array.isArray(payload.procedures) && payload.procedures.length > 0
  }
  const proc0 = Array.isArray(payload.procedures) ? payload.procedures[0] : null
  if (!proc0) return false
  const st = String(proc0.status ?? '').toLowerCase()
  if (st === 'success') return true
  const wf = proc0.debugging && proc0.debugging.work_flow
  if (wf && Array.isArray(wf.outputs) && wf.outputs.length) {
    const tail = decodeWorkflowContent(wf.outputs[wf.outputs.length - 1])
    if (tail && typeof tail === 'object' && (tail.mindmap || tail.diagnosis)) return true
  }
  return false
}

function getLatestSuccessfulWorkflowPayload(rawSseText) {
  const events = parseWorkflowSseEvents(rawSseText)
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const evt = events[i]
    let payload = evt?.parsed?.payload
    if (!payload && evt?.raw) {
      try {
        const again = JSON.parse(evt.raw)
        payload = again && typeof again === 'object' ? again.payload : null
      } catch (_) {
        payload = null
      }
    }
    if (!payload || typeof payload !== 'object') continue
    if (!payloadLooksWorkflowSuccess(payload)) continue
    if (!Array.isArray(payload.procedures) || !payload.procedures.length) continue
    return payload
  }
  return null
}

function toNodeList(workflow) {
  if (!workflow || typeof workflow !== 'object') return []
  return Array.isArray(workflow.run_nodes) ? workflow.run_nodes : []
}

function toWorkflowContentObject(workflow) {
  if (!workflow || typeof workflow !== 'object') return null
  const outputs = Array.isArray(workflow.outputs) ? workflow.outputs : []
  for (let i = outputs.length - 1; i >= 0; i -= 1) {
    const parsed = decodeWorkflowContent(outputs[i])
    if (parsed && typeof parsed === 'object' && (parsed.mindmap || parsed.diagnosis)) return parsed
  }
  const contents = Array.isArray(workflow.contents) ? workflow.contents : []
  for (let i = contents.length - 1; i >= 0; i -= 1) {
    const text = contents[i] && contents[i].text
    const parsed = decodeWorkflowContent(text)
    if (parsed && typeof parsed === 'object' && (parsed.mindmap || parsed.diagnosis)) return parsed
  }
  const nodes = Array.isArray(workflow.run_nodes) ? workflow.run_nodes : []
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const name = String(nodes[i]?.node_name || '')
    if (!name) continue
    const maybeReply = /回复|大模型/i.test(name)
    if (!maybeReply) continue
    const parsed = decodeWorkflowContent(nodes[i]?.output)
    if (parsed && typeof parsed === 'object' && (parsed.mindmap || parsed.diagnosis)) return parsed
  }
  for (let i = outputs.length - 1; i >= 0; i -= 1) {
    const parsed = decodeWorkflowContent(outputs[i])
    if (parsed && typeof parsed === 'object') return parsed
  }
  for (let i = contents.length - 1; i >= 0; i -= 1) {
    const text = contents[i] && contents[i].text
    const parsed = decodeWorkflowContent(text)
    if (parsed && typeof parsed === 'object') return parsed
  }
  return null
}

function toFlowStatus(nodes) {
  const findNode = (name) => nodes.find((n) => n && n.node_name === name)
  const fileTypeNode = findNode('参数提取2')
  const condNode = findNode('条件判断1')
  const retrievalNode = findNode('知识检索1')
  let fileType = '-'
  const parsedFileType = parseJsonSafe(fileTypeNode?.output || '')
  if (parsedFileType && typeof parsedFileType.filetype === 'string') {
    fileType = parsedFileType.filetype
  }
  let conditionIndex = '-'
  const parsedCond = parseJsonSafe(condNode?.output || '')
  if (parsedCond && parsedCond.ConditionIndex != null) {
    conditionIndex = String(parsedCond.ConditionIndex)
  }
  let retrievalHit = '未知'
  const parsedRetrieval = parseJsonSafe(retrievalNode?.output || '')
  if (parsedRetrieval && Object.prototype.hasOwnProperty.call(parsedRetrieval, 'KnowledgeList')) {
    retrievalHit = parsedRetrieval.KnowledgeList ? '命中' : '未命中'
  }
  return { fileType, conditionIndex, retrievalHit }
}

function buildWorkflowVizFromRawText(rawText) {
  if (!rawText) {
    return {
      ready: false,
      reason: '暂无工作流原始响应',
    }
  }
  const payload = getLatestSuccessfulWorkflowPayload(rawText)
  if (!payload) {
    return {
      ready: false,
      reason: '尚未捕获成功的工作流结果',
    }
  }
  const workflow = payload?.procedures?.[0]?.debugging?.work_flow || null
  const nodes = toNodeList(workflow)
  const contentObj = toWorkflowContentObject(workflow) || {}
  const rawMind =
    contentObj.mindmap ||
    contentObj.MindMap ||
    contentObj.mind_map ||
    contentObj.Mindmap
  let mindmap = rawMind && typeof rawMind === 'object' ? rawMind : null
  if (!mindmap && typeof rawMind === 'string') {
    const decoded = decodeWorkflowContent(rawMind)
    if (decoded && typeof decoded === 'object' && decoded.mindmap) mindmap = decoded.mindmap
  }
  const diagnosis =
    (contentObj.diagnosis && typeof contentObj.diagnosis === 'object' ? contentObj.diagnosis : null) ||
    (contentObj.Diagnosis && typeof contentObj.Diagnosis === 'object' ? contentObj.Diagnosis : null)
  const status = toFlowStatus(nodes)
  const nodeOrder = nodes.map((n) => n.node_name).filter(Boolean)
  const nodePerf = nodes
    .map((n) => ({
      name: n.node_name || '-',
      cost: Number(n.cost_milli_seconds || 0),
    }))
    .filter((n) => n.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 6)
  const perfMax = nodePerf.length ? Math.max(...nodePerf.map((x) => x.cost), 1) : 1
  const tokenUsage = Array.isArray(payload.procedures?.[0]?.token_usage_details)
    ? payload.procedures[0].token_usage_details
        .map((item) => ({
          model: item.model_name || 'unknown',
          totalTokens: Number(item.total_tokens || 0),
        }))
        .filter((item) => item.totalTokens > 0)
    : []
  const tokenTotal = tokenUsage.reduce((sum, item) => sum + item.totalTokens, 0)
  const methodTags = [
    { label: '图片理解', enabled: nodeOrder.includes('ImageUnderstand1') },
    { label: '知识检索', enabled: nodeOrder.includes('知识检索1') },
    {
      label: '结构化生成',
      enabled: nodeOrder.includes('大模型2') || nodeOrder.includes('大模型1'),
    },
  ]
  return {
    ready: true,
    workflowName: workflow?.workflow_name || '文件分析',
    workflowRunId: workflow?.workflow_run_id || '-',
    nodeOrder,
    mindmap,
    diagnosis,
    status,
    methodTags,
    nodePerf,
    perfMax,
    tokenUsage,
    tokenTotal,
    metrics: {
      elapsed: payload.elapsed ?? '-',
      tokenCount: payload.token_count ?? '-',
      inputCount: payload.procedures?.[0]?.input_count ?? '-',
      outputCount: payload.procedures?.[0]?.output_count ?? '-',
      statusSummary: payload.status_summary || '-',
    },
  }
}

const workflowViz = computed(() => {
  const r = activeFileReport.value
  const raw = r?.workflowRawText
  if (raw && String(raw).trim()) return buildWorkflowVizFromRawText(raw)
  if (r?.viz) return r.viz
  const wfRawItem = getLatestLogByLabel('工作流原始响应')
  const rawText = wfRawItem ? wfRawItem.text : ''
  return buildWorkflowVizFromRawText(rawText)
})

const visibleDebugLogs = computed(() => {
  if (showPreviousDebugLogs.value) return debugLogs.value
  return debugLogs.value.slice(0, 10)
})

async function ensureEchartsLoaded() {
  if (typeof window !== 'undefined' && window.echarts) return window.echarts
  if (!ensureEchartsLoaded._p) {
    ensureEchartsLoaded._p = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.type = 'text/javascript'
      script.async = true
      script.src = new URL('../../vendor/front/js/echarts.min.js', import.meta.url).href
      script.onload = () => resolve(window.echarts)
      script.onerror = reject
      document.head.appendChild(script)
    })
  }
  return ensureEchartsLoaded._p
}

function buildMindmapTreeData(mindmap) {
  if (!mindmap || typeof mindmap !== 'object') return null
  const mapNode = (node) => ({
    name: String(node?.name || '未命名'),
    status: 'covered',
    children: Array.isArray(node?.children) ? node.children.map(mapNode) : [],
  })
  return mapNode(mindmap)
}

/** 根据容器宽度计算树图标签宽度与留白，避免右侧文字被画布裁成「…」或单字截断 */
function getMindmapLayoutMetrics(containerEl) {
  const w = Math.max(280, Number(containerEl?.offsetWidth) || 640)
  const labelWidth = Math.max(120, Math.min(320, Math.floor(w * 0.42)))
  const rightPadPct = w < 520 ? 22 : w < 720 ? 18 : 14
  return { labelWidth, rightPadPct }
}

function buildMindmapSeriesOption(containerEl) {
  const { labelWidth, rightPadPct } = getMindmapLayoutMetrics(containerEl)
  const labelCommon = {
    position: 'right',
    verticalAlign: 'middle',
    align: 'left',
    fontSize: 13,
    overflow: 'break',
    width: labelWidth,
    lineHeight: 18,
  }
  return {
    type: 'tree',
    orient: 'LR',
    roam: true,
    initialTreeDepth: -1,
    top: '6%',
    left: '10%',
    bottom: '10%',
    right: `${rightPadPct}%`,
    symbolSize: 8,
    layerPadding: 32,
    lineStyle: {
      color: '#cbd5e1',
      width: 1.2,
    },
    label: {
      ...labelCommon,
      color: '#334155',
    },
    leaves: {
      label: {
        ...labelCommon,
        color: '#475569',
        fontSize: 12,
        lineHeight: 17,
      },
    },
    itemStyle: {
      color: '#64748b',
      borderColor: '#64748b',
    },
    emphasis: {
      focus: 'descendant',
    },
    expandAndCollapse: true,
    animationDuration: 500,
    animationDurationUpdate: 700,
  }
}

async function renderMindmapChart() {
  if (!showAnalysisModal.value || !mindmapContainer.value) return
  if (!workflowViz.value.ready || !workflowViz.value.mindmap) {
    if (mindmapChart) {
      mindmapChart.dispose()
      mindmapChart = null
    }
    mindmapSeriesData = null
    return
  }
  const echarts = await ensureEchartsLoaded().catch(() => null)
  if (!echarts) return

  const treeData = buildMindmapTreeData(workflowViz.value.mindmap)
  if (!treeData) {
    if (mindmapChart) {
      mindmapChart.dispose()
      mindmapChart = null
    }
    mindmapSeriesData = null
    return
  }

  await nextTick()
  await new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })

  if (mindmapChart) {
    mindmapChart.dispose()
    mindmapChart = null
  }
  mindmapChart = echarts.init(mindmapContainer.value)
  mindmapSeriesData = [treeData]
  mindmapChart.setOption({
    tooltip: {
      trigger: 'item',
      triggerOn: 'mousemove',
    },
    series: [
      {
        data: mindmapSeriesData,
        ...buildMindmapSeriesOption(mindmapContainer.value),
      },
    ],
  })
  requestAnimationFrame(() => {
    try {
      mindmapChart?.resize()
    } catch (_) {
      /* ignore */
    }
  })
}

let mindmapResizeRaf = null
function resizeMindmapChart() {
  if (!mindmapContainer.value) return
  if (mindmapResizeRaf != null) cancelAnimationFrame(mindmapResizeRaf)
  mindmapResizeRaf = requestAnimationFrame(() => {
    mindmapResizeRaf = null
    if (!mindmapChart) return
    const seriesOpt = buildMindmapSeriesOption(mindmapContainer.value)
    mindmapChart.setOption(
      { series: [{ ...(mindmapSeriesData ? { data: mindmapSeriesData } : {}), ...seriesOpt }] },
      false
    )
    mindmapChart.resize()
  })
}

watch(
  () =>
    [
      showAnalysisModal.value ? '1' : '0',
      workflowViz.value.ready ? '1' : '0',
      activeReportId.value,
      String(workflowViz.value.workflowRunId || ''),
      String(activeFileReport.value?.updatedAt ?? ''),
      workflowViz.value.mindmap && typeof workflowViz.value.mindmap === 'object'
        ? String(workflowViz.value.mindmap.name || '')
        : '',
    ].join('\u001f'),
  async () => {
    if (!showAnalysisModal.value) return
    if (workflowViz.value.ready) showExecutionPanel.value = false
    await nextTick()
    await renderMindmapChart()
  }
)

watch(
  () => showAnalysisModal.value,
  (show) => {
    if (!show && mindmapChart) {
      try {
        mindmapChart.dispose()
      } catch (_) {
        /* ignore */
      }
      mindmapChart = null
      mindmapSeriesData = null
    }
  }
)

function backToUploadView() {
  showAnalysisModal.value = false
}

function downloadActiveAnalysisReport() {
  const report = activeFileReport.value
  const viz = report?.viz || workflowViz.value
  if (!viz || !viz.ready) {
    sendError.value = '暂无可下载的分析报告'
    return
  }
  const diagnosis = viz.diagnosis || {}
  const content = {
    file_name: report?.fileName || '未知文件',
    exported_at: new Date().toISOString(),
    workflow: {
      name: viz.workflowName,
      run_id: viz.workflowRunId,
      metrics: viz.metrics,
      status: viz.status,
      methods: viz.methodTags,
    },
    mindmap: viz.mindmap || null,
    diagnosis: {
      coverage: diagnosis.coverage || '',
      highlight: diagnosis.highlight || '',
      structure: diagnosis.structure || '',
      suggestions: Array.isArray(diagnosis.suggestions) ? diagnosis.suggestions : [],
    },
  }
  const blob = new Blob([JSON.stringify(content, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  a.href = url
  a.download = `analysis-report-${stamp}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function normalizeFileList(listLike, baseFiles = []) {
  const arr = [...Array.from(baseFiles || []), ...Array.from(listLike || [])]
  const next = []
  const seen = new Set()
  const skipped = []
  let maxFileHit = false
  for (const f of arr) {
    if (next.length >= MAX_FILES) {
      maxFileHit = true
      continue
    }
    const ext = String(f?.name || '')
      .split('.')
      .pop()
      ?.toLowerCase()
    const rule = FILE_RULES.find((item) => item.exts.includes(ext))
    if (!rule) {
      skipped.push(`${f.name}：文件类型不支持`)
      continue
    }
    const maxBytes = rule.maxMb * 1024 * 1024
    if (Number(f.size || 0) > maxBytes) {
      skipped.push(`${f.name}：超过 ${rule.maxMb}MB`)
      continue
    }
    const key = `${f.name}_${f.size}_${f.lastModified}`
    if (seen.has(key)) continue
    seen.add(key)
    next.push(f)
  }
  if (maxFileHit) {
    skipped.push(`最多选择 ${MAX_FILES} 个文件`)
  }
  if (skipped.length) {
    sendError.value = skipped.slice(0, 4).join('；')
    if (skipped.length > 4) {
      sendError.value += `；另有 ${skipped.length - 4} 个文件未通过校验`
    }
  }
  return next
}

function onChooseFiles(e) {
  if (sending.value) return
  sent.value = false
  sendInfo.value = ''
  sendError.value = ''
  files.value = normalizeFileList(e?.target?.files, files.value)
  if (e?.target) {
    e.target.value = ''
  }
}

function onUploadDragOver() {
  if (sending.value) return
  dragOver.value = true
}

function onUploadDragLeave() {
  dragOver.value = false
}

function onDrop(e) {
  if (sending.value) return
  dragOver.value = false
  sent.value = false
  sendInfo.value = ''
  sendError.value = ''
  files.value = normalizeFileList(e?.dataTransfer?.files, files.value)
}

function removeFile(i) {
  if (sending.value) return
  files.value = files.value.filter((_, idx) => idx !== i)
  sent.value = false
}

function pushDebugLog(direction, label, data) {
  const stamp = new Date().toLocaleTimeString()
  let text = ''
  if (typeof data === 'string') text = data
  else {
    try {
      text = DEBUG_COMPACT_JSON_LABELS.has(label)
        ? JSON.stringify(data)
        : JSON.stringify(data, null, 2)
    } catch (_) {
      text = String(data)
    }
  }
  text = clipDebugText(label, text)
  debugLogs.value.unshift({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    direction,
    label,
    stamp,
    text,
  })
  if (debugLogs.value.length > MAX_DEBUG_LOG_ENTRIES) {
    debugLogs.value = debugLogs.value.slice(0, MAX_DEBUG_LOG_ENTRIES)
  }
}

function extractWorkflowText(obj) {
  if (!obj || typeof obj !== 'object') return ''
  const tryParseJson = (str) => {
    if (!str || typeof str !== 'string') return null
    try {
      return JSON.parse(str)
    } catch (_) {
      return null
    }
  }
  const clean = (str) => {
    if (typeof str !== 'string') return ''
    const s = str.trim()
    if (!s || s === '""') return ''
    if (s.includes('|SYSTEM_NOT_FINISHED_OUTPUT|')) return ''
    return s
  }
  const unwrap = (value, depth = 0) => {
    if (depth > 4 || value == null) return ''
    if (typeof value === 'string') {
      const raw = clean(value)
      if (!raw) return ''
      const parsed = tryParseJson(raw)
      if (!parsed) return raw
      return unwrap(parsed, depth + 1)
    }
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i -= 1) {
        const got = unwrap(value[i], depth + 1)
        if (got) return got
      }
      return ''
    }
    if (typeof value === 'object') {
      const orderedKeys = [
        'Answer',
        'Reply',
        'Content',
        'content',
        'reply',
        'text',
        'message',
        'output',
        'Output',
        'payload',
      ]
      for (const k of orderedKeys) {
        if (!Object.prototype.hasOwnProperty.call(value, k)) continue
        const got = unwrap(value[k], depth + 1)
        if (got) return got
      }
    }
    return ''
  }

  const direct =
    obj.text ||
    obj.content ||
    obj.reply ||
    obj.message ||
    (obj.choices && obj.choices[0] && obj.choices[0].message && obj.choices[0].message.content) ||
    (obj.payload && (obj.payload.text || obj.payload.content || obj.payload.reply))
  const directText = unwrap(direct)
  if (directText) return directText

  const wf = (obj.payload && obj.payload.work_flow) || obj.work_flow
  if (wf && typeof wf === 'object') {
    const wfText = unwrap([
      wf.current_node && wf.current_node.Reply,
      wf.current_node && wf.current_node.Output,
      wf.current_node && wf.current_node.Input,
      wf.outputs,
      wf.contents && wf.contents.map((x) => x && x.text),
    ])
    if (wfText) return wfText
  }

  const customText = unwrap(obj.custom_params || (obj.payload && obj.payload.custom_params))
  if (customText) return customText

  return ''
}

function stringifyCustomVariables(input) {
  const out = {}
  for (const [k, v] of Object.entries(input || {})) {
    if (v === undefined || v === null) continue
    out[k] = typeof v === 'string' ? v : JSON.stringify(v)
  }
  return out
}

function ensureUtf8String(str) {
  if (str == null) return ''
  const s = String(str)
  return s.normalize ? s.normalize('NFC') : s
}

function normalizeSseSessionId(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    return 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10)
  }
  const s = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
  return s.length >= 2 ? s : 'sess_' + Date.now()
}

function normalizeVisitorBizId(id) {
  const s = ensureUtf8String(id || 'teacher-001')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64)
  return s || 'teacher-001'
}

/** qbot SSE：与专项模拟请求体结构一致；会话正文 content/message 仅为文件 URL（无其它文案） */
function buildDocQbotSseBody(fileUrl, _messageIgnored, fileName, baseExtra = {}) {
  const session_id = normalizeSseSessionId(
    `sess_doc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  )
  let request_id = 'req_' + session_id + '_' + Date.now()
  if (request_id.length > 255) request_id = request_id.slice(-255)

  const contentStr = ensureUtf8String(fileUrl || '')

  const vars = {}
  for (const [k, v] of Object.entries(baseExtra)) {
    if (k === 'file_name' || v === undefined || v === null) continue
    vars[k] = v
  }
  vars.role = DOC_SSE_ROLE
  vars.trigger = DOC_SSE_TRIGGER
  if (DOC_SSE_CHARACTER_ID) vars.characterId = DOC_SSE_CHARACTER_ID
  if (DOC_SSE_MODEL_NAME) vars.model = DOC_SSE_MODEL_NAME
  vars.file_url = fileUrl
  vars.file_name = ensureUtf8String(fileName || '')
  if (DOC_WORKFLOW_ENTRY) vars.workflow_entry = DOC_WORKFLOW_ENTRY

  let evaluation = false
  if (Object.prototype.hasOwnProperty.call(vars, 'evaluation')) {
    const v = vars.evaluation
    evaluation = v === true || v === 'true'
    delete vars.evaluation
  }

  const model = vars.model ? ensureUtf8String(vars.model) : ''
  const body = {
    request_id,
    content: contentStr,
    message: contentStr,
    session_id,
    bot_app_key: getDocBotAppKey(),
    visitor_biz_id: normalizeVisitorBizId(DOC_SSE_VISITOR_BIZ_ID),
    incremental: true,
    streaming_throttle: 10,
    visitor_labels: [],
    evaluation,
    custom_variables: stringifyCustomVariables(vars),
    search_network: 'disable',
    stream: 'enable',
    workflow_status: DOC_QBOT_SSE_WORKFLOW_STATUS,
    tcadp_user_id: '',
  }
  if (model) body.model = model
  return body
}

function pickUploadedUrl(obj) {
  if (!obj || typeof obj !== 'object') return ''
  const direct =
    obj.file_url ||
    obj.fileUrl ||
    obj.FileUrl ||
    obj.url ||
    obj.URL ||
    obj.download_url ||
    obj.downloadUrl
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  if (obj.Response && typeof obj.Response === 'object') {
    const r = pickUploadedUrl(obj.Response)
    if (r) return r
  }
  if (obj.data && typeof obj.data === 'object') {
    return pickUploadedUrl(obj.data)
  }
  return ''
}

function guessFileType(file) {
  const name = String(file?.name || '')
  const idx = name.lastIndexOf('.')
  if (idx >= 0 && idx < name.length - 1) return name.slice(idx + 1).toLowerCase()
  return 'bin'
}

function parseCredentialPayload(obj) {
  if (!obj || typeof obj !== 'object') {
    return { uploadUrl: '', workflowUrl: '', headers: {}, formFields: {}, fileUrl: '', objectKey: '' }
  }
  const roots = [obj, obj.data, obj.result, obj.Response, obj.Response?.Data].filter(Boolean)
  const merged = Object.assign({}, ...roots.filter((x) => typeof x === 'object'))

  let uploadUrl =
    merged.upload_url ||
    merged.uploadUrl ||
    merged.UploadUrl ||
    merged.post_url ||
    merged.postUrl ||
    merged.cos_upload_url ||
    merged.cosUploadUrl ||
    merged.put_url ||
    merged.putUrl ||
    merged.UploadURL ||
    merged.url ||
    merged.URL ||
    ''
  const hostLike = merged.host || merged.cos_host || merged.domain || merged.cos_domain || ''
  const bucket = merged.bucket || merged.Bucket || ''
  const region = merged.region || merged.Region || ''
  if (!uploadUrl && typeof hostLike === 'string' && hostLike.trim()) {
    uploadUrl = hostLike.startsWith('http') ? hostLike : `https://${hostLike}`
  }
  if (!uploadUrl && bucket && region) {
    uploadUrl = `https://${bucket}.cos.${region}.myqcloud.com`
  }
  const workflowUrl =
    merged.workflow_url ||
    merged.workflowUrl ||
    merged.chat_url ||
    merged.chatUrl ||
    merged.invoke_url ||
    merged.invokeUrl ||
    merged.api_url ||
    merged.apiUrl ||
    merged.endpoint ||
    merged.Endpoint ||
    ''

  const fileUrl = pickUploadedUrl(obj)
  const headers = merged.headers && typeof merged.headers === 'object' ? merged.headers : {}
  const formFields = {
    ...(merged.form_fields && typeof merged.form_fields === 'object' ? merged.form_fields : {}),
    ...(merged.formFields && typeof merged.formFields === 'object' ? merged.formFields : {}),
    ...(merged.fields && typeof merged.fields === 'object' ? merged.fields : {}),
  }
  const objectKey =
    merged.key ||
    merged.object_key ||
    merged.objectKey ||
    merged.UploadPath ||
    merged.upload_path ||
    merged.cos_key ||
    merged.path ||
    ''
  return {
    uploadUrl: typeof uploadUrl === 'string' ? uploadUrl : '',
    workflowUrl: typeof workflowUrl === 'string' ? workflowUrl : '',
    headers: headers && typeof headers === 'object' ? headers : {},
    formFields: formFields && typeof formFields === 'object' ? formFields : {},
    fileUrl: typeof fileUrl === 'string' ? fileUrl : '',
    objectKey: typeof objectKey === 'string' ? objectKey : '',
  }
}

async function describeStorageCredential(file) {
  if (!DOC_STORAGE_CREDENTIAL_URL) {
    pushDebugLog('SEND', 'DescribeStorageCredential 未执行', {
      reason: '缺少 VITE_DOC_STORAGE_CREDENTIAL_URL',
      file: file ? { name: file.name, type: file.type, size: file.size } : null,
    })
    throw new Error('缺少 VITE_DOC_STORAGE_CREDENTIAL_URL，未调用 DescribeStorageCredential')
  }
  const body = {
    FileType: guessFileType(file),
    IsPublic: false,
    TypeKey: 'offline',
  }
  if (DOC_STORAGE_BOT_BIZ_ID) body.BotBizId = DOC_STORAGE_BOT_BIZ_ID
  pushDebugLog('SEND', 'DescribeStorageCredential 请求JSON', {
    endpoint: DOC_STORAGE_CREDENTIAL_URL,
    body,
  })
  const res = await fetch(DOC_STORAGE_CREDENTIAL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  pushDebugLog('RECV', 'DescribeStorageCredential 响应状态', {
    status: res.status,
    contentType: String(res.headers.get('Content-Type') || ''),
  })
  pushDebugLog('RECV', 'DescribeStorageCredential 原始响应', text)
  if (!res.ok) {
    throw new Error(`DescribeStorageCredential 失败(${res.status})：${text.slice(0, 180)}`)
  }
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch (_) {
    throw new Error('DescribeStorageCredential 未返回 JSON')
  }
  pushDebugLog('RECV', 'DescribeStorageCredential 解析JSON', parsed)
  return parseCredentialPayload(parsed)
}

async function getDocUploadCredential(file) {
  if (DOC_FILE_UPLOAD_URL) {
    pushDebugLog('SEND', '使用直连上传(跳过 DescribeStorageCredential)', {
      uploadUrl: DOC_FILE_UPLOAD_URL,
    })
    return {
      uploadUrl: DOC_FILE_UPLOAD_URL,
      workflowUrl: '',
      headers: {},
      formFields: {},
      fileUrl: '',
      objectKey: '',
    }
  }
  return describeStorageCredential(file)
}

async function uploadFileToStorage(file, credential) {
  const uploadUrl = credential && credential.uploadUrl
  if (!uploadUrl) {
    pushDebugLog('RECV', 'DescribeStorageCredential 缺少上传地址', credential || {})
    throw new Error('DescribeStorageCredential 响应缺少可用上传地址（upload_url/post_url/host/bucket+region）')
  }
  const uploadUrlLower = String(uploadUrl).toLowerCase()
  const isCosSignedPut =
    uploadUrlLower.includes('q-signature=') ||
    uploadUrlLower.includes('q-sign-algorithm=')

  pushDebugLog('SEND', '文件上传请求(原始文件)', {
    endpoint: uploadUrl,
    method: isCosSignedPut ? 'PUT' : 'POST',
    file: {
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
    },
    formFields: credential ? credential.formFields : {},
    objectKey: credential ? credential.objectKey : '',
  })
  if (isCosSignedPut) {
    const putHeaders = {
      ...(credential && credential.headers ? credential.headers : {}),
      'Content-Type': file.type || 'application/octet-stream',
    }
    let res
    try {
      res = await fetch(DOC_COS_UPLOAD_PROXY_URL, {
        method: 'POST',
        // 通过本地代理转发，避免浏览器直接 PUT 到 COS 被 CORS 拦截
        headers: {
          ...putHeaders,
          'x-upload-url': uploadUrl,
        },
        body: file,
      })
    } catch (e) {
      pushDebugLog('RECV', '文件上传请求异常(可能CORS/网络)', {
        message: e && e.message ? e.message : String(e),
        endpoint: DOC_COS_UPLOAD_PROXY_URL,
        targetUploadUrl: uploadUrl,
        method: 'POST(proxy->PUT)',
      })
      throw e
    }
    const text = await res.text()
    pushDebugLog('RECV', '文件上传响应状态', {
      status: res.status,
      contentType: String(res.headers.get('Content-Type') || ''),
    })
    pushDebugLog('RECV', '文件上传原始响应', text || '(empty)')
    if (!res.ok) {
      throw new Error(`文件上传失败(${res.status})：${text.slice(0, 160)}`)
    }
    if (credential && credential.fileUrl) return credential.fileUrl
    return String(uploadUrl).split('?')[0]
  }

  const form = new FormData()
  if (credential && credential.formFields) {
    for (const [k, v] of Object.entries(credential.formFields)) {
      form.append(k, v == null ? '' : String(v))
    }
  }
  if (credential && credential.objectKey && !form.has('key')) {
    form.append('key', credential.objectKey)
  }
  form.append('file', file, file.name)
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: credential && credential.headers ? credential.headers : undefined,
    body: form,
  }).catch((e) => {
    pushDebugLog('RECV', '文件上传请求异常(可能CORS/网络)', {
      message: e && e.message ? e.message : String(e),
      endpoint: uploadUrl,
      method: 'POST',
    })
    throw e
  })
  const text = await res.text()
  pushDebugLog('RECV', '文件上传响应状态', {
    status: res.status,
    contentType: String(res.headers.get('Content-Type') || ''),
  })
  pushDebugLog('RECV', '文件上传原始响应', text)
  if (!res.ok) {
    throw new Error(`文件上传失败(${res.status})：${text.slice(0, 160)}`)
  }
  let parsed = null
  try {
    parsed = JSON.parse(text)
    pushDebugLog('RECV', '文件上传解析JSON', parsed)
  } catch (_) {
    if (credential && credential.fileUrl) return credential.fileUrl
    if (credential && credential.uploadUrl && credential.objectKey) {
      const base = credential.uploadUrl.replace(/\/+$/, '')
      const key = credential.objectKey.replace(/^\/+/, '')
      return `${base}/${key}`
    }
    throw new Error('文件上传接口未返回 JSON，且无法推断 file_url')
  }
  const fileUrl = pickUploadedUrl(parsed)
  if (fileUrl) return fileUrl
  if (credential && credential.fileUrl) return credential.fileUrl
  throw new Error('文件上传成功但响应中没有 file_url/url 字段')
}

async function sendDocWorkflowWithFileUrl(fileUrl, message, extra = {}) {
  const endpoint = resolveDocWorkflowEndpoint(extra)
  if (!String(endpoint || '').trim()) {
    throw new Error('未配置工作流地址')
  }
  const isWorkflowTrigger = /\/v1\/workflows\/.+\/trigger(?:\?|$)/.test(endpoint)
  const isQbotSseEndpoint = /\/v1\/qbot\/chat\/sse(?:\?|$)/.test(endpoint)
  const baseExtra = { ...extra }
  delete baseExtra._workflowEndpoint

  const sessionIdForGeneric = normalizeSseSessionId(
    `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  )
  const body = isWorkflowTrigger
    ? fileUrl
    : isQbotSseEndpoint
    ? buildDocQbotSseBody(fileUrl, message, baseExtra.file_name || '', baseExtra)
    : {
        session_id: sessionIdForGeneric,
        message,
        file_url: fileUrl,
        ...stringifyCustomVariables(baseExtra),
      }

  const authorization = DOC_WORKFLOW_AUTHORIZATION
    ? DOC_WORKFLOW_AUTHORIZATION
    : DOC_WORKFLOW_API_KEY
      ? `Bearer ${DOC_WORKFLOW_API_KEY}`
      : DOC_WORKFLOW_APP_KEY
        ? `Bearer ${DOC_WORKFLOW_APP_KEY}`
        : ''
  const attachWorkflowAuth = !!authorization && !isQbotSseEndpoint
  const contentType = isWorkflowTrigger
    ? 'text/plain; charset=utf-8'
    : 'application/json; charset=utf-8'
  pushDebugLog('SEND', isWorkflowTrigger ? '工作流请求(纯文本 URL)' : '工作流请求JSON(file_url模式)', {
    endpoint,
    body: isWorkflowTrigger ? fileUrl : body,
    contentType,
    authorization: attachWorkflowAuth ? '(已设置)' : '(未设置/或由 qbot 体字段鉴权)',
  })
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      ...(attachWorkflowAuth ? { Authorization: authorization } : {}),
      ...(isQbotSseEndpoint ? { Accept: 'text/event-stream; charset=utf-8' } : {}),
    },
    body: isWorkflowTrigger ? fileUrl : JSON.stringify(body),
  })
  const text = await res.text()
  pushDebugLog('RECV', '工作流响应状态', {
    status: res.status,
    contentType: String(res.headers.get('Content-Type') || ''),
  })
  pushDebugLog('RECV', '工作流原始响应', text)
  if (!res.ok) {
    throw new Error(`工作流请求失败(${res.status})：${text.slice(0, 180)}`)
  }
  const workflowRawText = text
  try {
    const parsed = JSON.parse(text)
    pushDebugLog('RECV', '工作流解析JSON', parsed)
    return { reply: extractWorkflowText(parsed) || text, workflowRawText }
  } catch (_) {
    if (isQbotSseEndpoint && text) {
      const lines = text.split('\n')
      let latestExtracted = ''
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith('data:')) continue
        const raw = t.slice(5).trim()
        if (!raw) continue
        try {
          const sseJson = JSON.parse(raw)
          const extracted = extractWorkflowText(sseJson)
          if (extracted) latestExtracted = extracted
        } catch (_) {
          // ignore
        }
      }
      if (latestExtracted) return { reply: latestExtracted, workflowRawText }
    }
    return { reply: text, workflowRawText }
  }
}

async function onSend() {
  if (sending.value) return
  sending.value = true
  analysisBatchTotal.value = 0
  analysisBatchDone.value = 0
  sent.value = false
  sendError.value = ''
  sendInfo.value = ''
  try {
    clearAllDocToasts()
    debugLogs.value = []
    showPreviousDebugLogs.value = false
    showDebugPanel.value = false
    showExecutionPanel.value = false
    showAnalysisModal.value = false

    if (!files.value.length) {
      if (DOC_FILE_UPLOAD_URL) {
        sendInfo.value = '未选择文件。已启用直连上传，跳过存储凭证空文件调试。'
        sent.value = true
        return
      }
      sendInfo.value = '未选择文件，执行空文件调试：仅测试 DescribeStorageCredential...'
      const mockFile = {
        name: 'empty-debug.txt',
        type: 'text/plain',
        size: 0,
      }
      const credential = await describeStorageCredential(mockFile)
      pushDebugLog('RECV', '空文件调试凭证结果', credential || {})
      sendInfo.value = '空文件调试成功：DescribeStorageCredential 已返回数据'
      sent.value = true
      return
    }

    const batchFiles = [...files.value]
    const batchTotal = batchFiles.length
    analysisBatchTotal.value = batchTotal
    analysisBatchDone.value = 0
    let openedModalThisBatch = false

    sendInfo.value = DOC_FILE_UPLOAD_URL
      ? `正在分析第 1/${batchTotal} 个文件（上传 → 工作流）…\n切换至其他模块不会中断，返回本页可继续查看。`
      : `正在分析第 1/${batchTotal} 个文件（凭证 → 上传 → 工作流）…\n切换至其他模块不会中断，返回本页可继续查看。`
    const resultLines = []
    for (let i = 0; i < batchFiles.length; i += 1) {
      const file = batchFiles[i]
      sendInfo.value = `正在分析「${file.name}」（${i + 1}/${batchTotal}）…\n已完成 ${analysisBatchDone.value} 个；下方「文件报告」中已完成的条目可随时打开阅读。`
      const credential = await getDocUploadCredential(file)
      const workflowEndpointFromCredential =
        credential && credential.workflowUrl ? String(credential.workflowUrl).trim() : ''
      if (!workflowEndpointFromCredential) {
        pushDebugLog('RECV', '凭证未带 workflow_url，将使用专项同源 endpoint', {
          credential: credential || {},
          resolvedEndpoint: resolveDocWorkflowEndpoint({}),
        })
      }
      const fileUrl = await uploadFileToStorage(file, credential)
      const { reply, workflowRawText } = await sendDocWorkflowWithFileUrl(
        fileUrl,
        `请诊断这份教学材料：${file.name}`,
        {
          _workflowEndpoint: workflowEndpointFromCredential || undefined,
          file_name: file.name,
        }
      )
      const brief = reply ? String(reply).slice(0, 60) : '无可提取文本返回'
      resultLines.push(`${file.name} -> ${brief}`)
      const rawText = workflowRawText || ''
      const reportId = `${file.name}_${file.size}_${file.lastModified}`
      const viz = buildWorkflowVizFromRawText(rawText)
      const storedRaw = viz.ready ? shrinkWorkflowSseTextForStorage(rawText) : rawText
      const nextReport = {
        id: reportId,
        fileName: file.name,
        brief,
        workflowRawText: storedRaw,
        viz,
        updatedAt: Date.now(),
      }
      const idx = fileReports.value.findIndex((x) => x.id === reportId)
      if (idx >= 0) {
        fileReports.value.splice(idx, 1, nextReport)
      } else {
        fileReports.value.push(nextReport)
      }
      activeReportId.value = reportId

      files.value = files.value.filter(
        (f) =>
          !(
            f.name === file.name &&
            f.size === file.size &&
            f.lastModified === file.lastModified
          )
      )
      analysisBatchDone.value = i + 1

      if (viz.ready && !openedModalThisBatch) {
        openedModalThisBatch = true
        showAnalysisModal.value = true
      }

      sendInfo.value = `「${file.name}」已完成（${i + 1}/${batchTotal}）。\n可在下方「文件报告」或弹窗中阅读；其余文件仍在队列中处理。`
      if (viz.ready) {
        pushDocToast(`「${file.name}」已分析完成（${i + 1}/${batchTotal}），可打开报告阅读`, 'ok')
      } else {
        pushDocToast(`「${file.name}」已返回（${i + 1}/${batchTotal}），未解析出完整图谱`, 'warn')
      }
      await nextTick()
    }

    await nextTick()
    const docInput =
      typeof document !== 'undefined' ? document.getElementById('teaching-doc-input') : null
    if (docInput) docInput.value = ''

    sendInfo.value = `本批 ${batchTotal} 个文件已全部处理：\n${resultLines.join(
      '\n'
    )}\n待分析列表已随进度清空；历史报告保留在「文件报告」中。`
    sent.value = true
    pushDocToast(`本批共 ${batchTotal} 个文件已全部处理完毕`, 'done')
    if (typeof window !== 'undefined' && window.console) {
      console.log('[TeachingDoc] 文件发送完成', {
        fileCount: batchTotal,
        endpoint: resolveDocWorkflowEndpoint({}),
      })
    }
  } catch (err) {
    const msg = err?.message || String(err)
    sendError.value = msg
    sent.value = false
    pushDocToast(`分析中断：${msg.slice(0, 72)}${msg.length > 72 ? '…' : ''}`, 'warn')
  } finally {
    sending.value = false
    analysisBatchTotal.value = 0
    analysisBatchDone.value = 0
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', resizeMindmapChart)
}

onBeforeUnmount(() => {
  clearAllDocToasts()
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', resizeMindmapChart)
  }
  if (mindmapChart) {
    mindmapChart.dispose()
    mindmapChart = null
  }
  mindmapSeriesData = null
})
</script>

<template>
  <main class="doc-analysis-page">
    <div class="doc-toast-host" aria-live="polite">
      <TransitionGroup name="doc-toast" tag="div" class="doc-toast-stack">
        <div
          v-for="t in docToasts"
          :key="t.id"
          :class="['doc-toast', t.kind ? `doc-toast--${t.kind}` : '']"
        >
          {{ t.text }}
        </div>
      </TransitionGroup>
    </div>
    <section class="doc-shell">
      <header class="doc-header">
        <div>
          <h2>教学资料智能分析</h2>
          <p>上传课件、讲义与课堂素材，系统将自动整理并生成可用于教学复盘的分析结果。</p>
        </div>
      </header>

      <p
        v-if="sending && analysisBatchTotal > 0"
        class="analysis-batch-banner"
        role="status"
        aria-live="polite"
      >
        <strong>后台分析进行中</strong>（{{ analysisProgressLine }}）。可切换到专项模拟、课堂模拟等模块，任务不中断；回到本页后继续显示进度。已完成条目可随时在下方「文件报告」或弹窗中打开阅读。
      </p>

      <div class="upload-stage" v-show="!showAnalysisModal">
        <div class="upload-stage-body">
          <div
            v-if="sending"
            class="analysis-loading-overlay"
            aria-busy="true"
            aria-live="polite"
            role="status"
          >
            <div class="analysis-loading-card">
              <div class="analysis-loading-spinner" aria-hidden="true" />
              <p class="analysis-loading-title">正在分析</p>
              <p class="analysis-loading-progress">{{ analysisProgressLine }}</p>
              <p class="analysis-loading-detail">{{ sendInfo || '正在上传并与工作流通信，请稍候…' }}</p>
            </div>
          </div>
          <section
            class="upload-dropzone"
            :class="{ 'upload-dropzone--over': dragOver && !sending }"
            @dragover.prevent="onUploadDragOver"
            @dragleave.prevent="onUploadDragLeave"
            @drop.prevent="onDrop"
          >
          <div class="upload-emoji">🗂️</div>
          <h3>教学材料深度诊断系统</h3>
          <p class="upload-intro">基于教学大纲一致性分析，适上传教案、课件和板书笔记，系统将为您提炼知识图谱并诊断教学盲点。</p>
          <div class="upload-rule-panel">
            <p class="upload-rule-title">支持以下文件类型</p>
            <p><strong>文档（仅支持）：</strong>.docx、.pptx（单个文件最大 200MB）</p>
            <p><strong>图片：</strong>.jpg、.png、.jpeg（单个文件最大 50MB）</p>
          </div>
          <label class="upload-btn" :class="{ 'is-disabled': sending }" for="teaching-doc-input"
            >选择文件</label
          >
          <input
            id="teaching-doc-input"
            class="upload-input"
            type="file"
            :accept="ACCEPT_TYPES"
            multiple
            :disabled="sending"
            @change="onChooseFiles"
          />
        </section>

          <section class="file-panel">
            <div class="file-panel-head">
              <h4>待分析文件</h4>
              <span>{{ files.length }} 个 · {{ totalSizeText }}</span>
            </div>
            <div v-if="!files.length" class="file-empty">暂未选择文件</div>
            <ul v-else class="file-list">
              <li v-for="(f, i) in files" :key="`${f.name}-${f.size}-${f.lastModified}`" class="file-item">
                <div class="file-main">
                  <strong>{{ f.name }}</strong>
                  <small>{{ f.type || '未知类型' }} · {{ Math.max(1, Math.round((f.size || 0) / 1024)) }} KB</small>
                </div>
                <button type="button" class="file-remove" :disabled="sending" @click="removeFile(i)">
                  移除
                </button>
              </li>
            </ul>
          </section>
        </div>

        <footer class="doc-footer">
          <button type="button" class="send-btn" :disabled="sending" @click="onSend">
            {{ sending ? '发送中...' : '发送分析数据' }}
          </button>
          <button
            v-if="fileReports.length"
            type="button"
            class="send-btn"
            @click="showAnalysisModal = true"
          >
            查看分析结果
          </button>
          <button type="button" class="debug-panel-btn" @click="showDebugPanel = !showDebugPanel">
            {{ showDebugPanel ? '隐藏调试页面' : '显示调试页面' }}
          </button>
          <span v-if="sent" class="send-ok">数据发送完成（页面设计态）</span>
        </footer>
        <p v-if="sendInfo" class="send-info">{{ sendInfo }}</p>
        <p v-if="sendError" class="send-error">{{ sendError }}</p>
      </div>

      <section v-if="fileReports.length" class="report-switcher-panel">
        <div class="analysis-sidebar-head">
          <strong>文件报告</strong>
          <small>{{ fileReports.length }} 个</small>
        </div>
        <ul class="analysis-file-list">
          <li
            v-for="report in fileReports"
            :key="report.id"
            :class="['analysis-file-item', report.id === activeReportId ? 'is-active' : '']"
            @click="activeReportId = report.id; showAnalysisModal = true"
          >
            <div class="analysis-file-top">
              <strong>{{ report.fileName }}</strong>
              <span class="analysis-file-status-icon">{{ reportStatusIcon(report) }}</span>
            </div>
            <small>{{ reportStatusText(report) }}</small>
            <small class="analysis-file-time">分析时间：{{ formatReportTime(report.updatedAt) }}</small>
          </li>
        </ul>
      </section>

      <section
        v-if="showAnalysisModal && fileReports.length"
        class="workflow-viz-panel workflow-viz-modal"
        @click.self="showAnalysisModal = false"
      >
        <div class="workflow-viz-modal-content">
        <div class="workflow-viz-head">
          <button type="button" class="back-upload-btn" @click="backToUploadView">✕ 关闭弹窗</button>
          <strong>知识点覆盖分析图谱</strong>
          <button type="button" class="debug-export" @click="downloadActiveAnalysisReport">下载分析报告</button>
          <button type="button" class="debug-panel-btn debug-panel-btn--inline" @click="showDebugPanel = !showDebugPanel">
            {{ showDebugPanel ? '隐藏调试页面' : '显示调试页面' }}
          </button>
          <span v-if="workflowViz.ready" class="workflow-viz-sub">
            {{ workflowViz.workflowName }} · {{ workflowViz.workflowRunId
            }}<template v-if="sending && analysisBatchTotal > 0">
              · {{ analysisProgressLine }}（其余文件后台排队）
            </template>
          </span>
          <span v-else-if="sending && analysisBatchTotal > 0" class="workflow-viz-sub workflow-viz-sub--busy">
            {{ analysisProgressLine }} · 其余文件后台分析中，可关闭弹窗先做其他操作
          </span>
        </div>
          <div class="analysis-main">
            <div v-if="!workflowViz.ready" class="workflow-viz-empty">
              {{ workflowViz.reason }}
            </div>
            <template v-else>
              <div class="analysis-main-grid">
                <article v-if="workflowViz.mindmap" class="workflow-card analysis-graph-card">
                  <p class="mindmap-roam-hint" role="note">
                    <span class="mindmap-roam-hint__label">操作提示</span>
                    将鼠标移到图谱上：<strong>滚轮向上放大、向下缩小</strong>；<strong>按住左键拖拽</strong>可平移整张图。
                  </p>
                  <div class="mindmap-chart-wrap">
                    <div ref="mindmapContainer" class="mindmap-chart"></div>
                  </div>
                </article>

                <article v-if="workflowViz.diagnosis" class="workflow-card analysis-report-card">
                  <h5>教学诊断报告</h5>
                  <p><strong>已覆盖知识点</strong></p>
                  <p>{{ workflowViz.diagnosis.coverage || '-' }}</p>
                  <p><strong>特补充知识点</strong></p>
                  <p>{{ workflowViz.diagnosis.highlight || '-' }}</p>
                  <p><strong>综合建议</strong></p>
                  <ul class="diag-list">
                    <li v-for="(item, idx) in workflowViz.diagnosis.suggestions || []" :key="`diag-${idx}`">
                      {{ item }}
                    </li>
                  </ul>
                  <blockquote class="diag-quote">{{ workflowViz.diagnosis.structure || '-' }}</blockquote>
                </article>
              </div>

              <div class="analysis-methods">
                <span
                  v-for="tag in workflowViz.methodTags"
                  :key="tag.label"
                  :class="['analysis-method-tag', tag.enabled ? 'is-on' : 'is-off']"
                >
                  {{ tag.label }} · {{ tag.enabled ? '已启用' : '未启用' }}
                </span>
                <button type="button" class="execution-toggle-btn" @click="showExecutionPanel = !showExecutionPanel">
                  {{ showExecutionPanel ? '收起执行画像' : '展开执行画像' }}
                </button>
              </div>

              <div v-if="showExecutionPanel" class="workflow-kpis">
                <div class="workflow-kpi">
                  <small>状态</small>
                  <strong>{{ workflowViz.metrics.statusSummary }}</strong>
                </div>
                <div class="workflow-kpi">
                  <small>耗时</small>
                  <strong>{{ workflowViz.metrics.elapsed }} ms</strong>
                </div>
                <div class="workflow-kpi">
                  <small>总 Token</small>
                  <strong>{{ workflowViz.metrics.tokenCount }}</strong>
                </div>
                <div class="workflow-kpi">
                  <small>文件类型 / 分支</small>
                  <strong>{{ workflowViz.status.fileType }} / {{ workflowViz.status.conditionIndex }}</strong>
                </div>
                <div class="workflow-kpi">
                  <small>知识检索</small>
                  <strong>{{ workflowViz.status.retrievalHit }}</strong>
                </div>
              </div>

              <div v-if="showExecutionPanel" class="analysis-dual-grid">
                <article class="workflow-card">
                  <h5>执行画像（节点耗时）</h5>
                  <div v-if="!workflowViz.nodePerf.length" class="workflow-empty-mini">暂无节点耗时数据</div>
                  <div v-else class="perf-list">
                    <div v-for="node in workflowViz.nodePerf" :key="node.name" class="perf-item">
                      <div class="perf-item-head">
                        <span>{{ node.name }}</span>
                        <strong>{{ node.cost }} ms</strong>
                      </div>
                      <div class="perf-track">
                        <div
                          class="perf-fill"
                          :style="{ width: Math.max(8, Math.round((node.cost / workflowViz.perfMax) * 100)) + '%' }"
                        />
                      </div>
                    </div>
                  </div>
                </article>

                <article class="workflow-card">
                  <h5>执行画像（模型 Token）</h5>
                  <div v-if="!workflowViz.tokenUsage.length" class="workflow-empty-mini">暂无模型 Token 分布</div>
                  <div v-else class="perf-list">
                    <div v-for="item in workflowViz.tokenUsage" :key="item.model" class="perf-item">
                      <div class="perf-item-head">
                        <span>{{ item.model }}</span>
                        <strong>{{ item.totalTokens }}</strong>
                      </div>
                      <div class="perf-track">
                        <div
                          class="perf-fill perf-fill--token"
                          :style="{
                            width:
                              Math.max(8, Math.round((item.totalTokens / Math.max(1, workflowViz.tokenTotal)) * 100)) +
                              '%',
                          }"
                        />
                      </div>
                    </div>
                  </div>
                </article>
              </div>
            </template>
          </div>
        </div>
      </section>

      <section v-if="showDebugPanel" class="debug-console">
        <div class="debug-page-head">
          <strong>调试页面</strong>
          <div class="debug-actions">
            <button type="button" class="debug-export" @click="downloadLatestWorkflowRawJson">
              下载原始响应JSON
            </button>
            <button type="button" class="debug-clear" @click="debugLogs = []">清空日志</button>
          </div>
        </div>

        <section class="visual-panel debug-page-panel">
          <div class="visual-head">
            <strong>发送结果可视化</strong>
          </div>
          <div class="visual-grid">
            <article class="visual-card">
              <h5>凭证信息</h5>
              <p>Bucket：{{ visualSummary.credential?.Bucket || '-' }}</p>
              <p>Region：{{ visualSummary.credential?.Region || '-' }}</p>
              <p>UploadPath：{{ visualSummary.credential?.UploadPath || '-' }}</p>
              <p>FileUrl：{{ visualSummary.credential?.FileUrl || '-' }}</p>
            </article>
            <article class="visual-card">
              <h5>上传结果</h5>
              <p>请求方法：{{ visualSummary.uploadReq?.method || '-' }}</p>
              <p>上传状态：{{ visualSummary.uploadRes?.status ?? '-' }}</p>
              <p>响应类型：{{ visualSummary.uploadRes?.contentType || '-' }}</p>
            </article>
            <article class="visual-card">
              <h5>工作流状态</h5>
              <p>响应状态：{{ visualSummary.wfRes?.status ?? '-' }}</p>
              <p>响应类型：{{ visualSummary.wfRes?.contentType || '-' }}</p>
              <p>回复摘要：{{ visualSummary.assistantReply || '暂无可提取回复' }}</p>
            </article>
          </div>
        </section>

        <section class="debug-page-panel">
          <div class="debug-head">
            <strong>网页调试终端（发送/接收 JSON）</strong>
            <div class="debug-actions">
              <button
                v-if="debugLogs.length > 10"
                type="button"
                class="debug-toggle"
                @click="showPreviousDebugLogs = !showPreviousDebugLogs"
              >
                {{ showPreviousDebugLogs ? '隐藏之前消息' : '显示之前消息' }}
              </button>
            </div>
          </div>
          <div v-if="!debugLogs.length" class="debug-empty">暂无调试数据</div>
          <ul v-else class="debug-list">
            <li v-for="item in visibleDebugLogs" :key="item.id" class="debug-item">
              <div class="debug-meta">
                <span :class="['debug-tag', item.direction === 'SEND' ? 'debug-tag-send' : 'debug-tag-recv']">
                  {{ item.direction }}
                </span>
                <span>{{ item.stamp }} · {{ item.label }}</span>
              </div>
              <pre class="debug-text">{{ item.text }}</pre>
            </li>
          </ul>
        </section>
      </section>
    </section>
  </main>
</template>

<style scoped>
.doc-analysis-page {
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 20px;
  overflow: auto;
  background: linear-gradient(180deg, #f7f5ef 0%, #f2eee4 100%);
}

.doc-toast-host {
  position: fixed;
  left: 50%;
  bottom: max(20px, env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  z-index: 10050;
  max-width: min(420px, calc(100vw - 32px));
  pointer-events: none;
}

.doc-toast-stack {
  display: flex;
  flex-direction: column-reverse;
  align-items: center;
  gap: 8px;
}

.doc-toast {
  padding: 9px 16px;
  border-radius: 999px;
  font-size: 13px;
  line-height: 1.45;
  text-align: center;
  color: #0f172a;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid rgba(148, 163, 184, 0.45);
  box-shadow: 0 6px 24px rgba(15, 23, 42, 0.1);
}

.doc-toast--ok {
  border-color: rgba(59, 130, 246, 0.35);
  background: rgba(239, 246, 255, 0.96);
}

.doc-toast--warn {
  border-color: rgba(245, 158, 11, 0.45);
  background: rgba(255, 251, 235, 0.96);
  color: #78350f;
}

.doc-toast--done {
  border-color: rgba(34, 197, 94, 0.4);
  background: rgba(240, 253, 244, 0.96);
  color: #14532d;
}

.doc-toast-enter-active,
.doc-toast-leave-active {
  transition:
    opacity 0.28s ease,
    transform 0.28s ease;
}

.doc-toast-enter-from,
.doc-toast-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

.doc-toast-move {
  transition: transform 0.24s ease;
}

.doc-shell {
  max-width: 1120px;
  margin: 0 auto;
  padding: 24px;
  border-radius: 20px;
  border: 1px solid rgba(45, 52, 54, 0.12);
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 18px 40px rgba(45, 52, 54, 0.08);
}

.upload-stage {
  position: relative;
}

.upload-stage-body {
  position: relative;
  min-height: 120px;
}

.analysis-batch-banner {
  margin: 0 0 12px;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid rgba(59, 130, 246, 0.35);
  background: linear-gradient(90deg, rgba(239, 246, 255, 0.95), rgba(224, 242, 254, 0.75));
  font-size: 13px;
  line-height: 1.55;
  color: #1e3a5f;
}

.analysis-batch-banner strong {
  color: #1d4ed8;
}

.analysis-loading-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  border-radius: inherit;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.analysis-loading-card {
  max-width: 420px;
  padding: 28px 32px;
  text-align: center;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.45);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 16px 40px rgba(30, 41, 59, 0.12);
}

.analysis-loading-spinner {
  width: 44px;
  height: 44px;
  margin: 0 auto 16px;
  border-radius: 50%;
  border: 3px solid rgba(52, 152, 219, 0.22);
  border-top-color: #2d7fd8;
  animation: analysis-spin 0.75s linear infinite;
}

.analysis-loading-title {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
}

.analysis-loading-progress {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: #2563eb;
}

.analysis-loading-detail {
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
  color: #475569;
  white-space: pre-wrap;
  word-break: break-word;
}

@keyframes analysis-spin {
  to {
    transform: rotate(360deg);
  }
}

.doc-header {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-bottom: 14px;
  text-align: center;
}

.doc-header h2 {
  margin: 0 0 6px;
  font-size: 28px;
  color: #1f2d3d;
}

.doc-header p {
  margin: 0;
  font-size: 14px;
  color: #6c7a89;
}

.upload-dropzone {
  border: 1.5px dashed rgba(52, 152, 219, 0.32);
  border-radius: 18px;
  padding: 52px 22px;
  text-align: center;
  background: rgba(52, 152, 219, 0.03);
  transition: all 0.2s ease;
}

.upload-dropzone--over {
  border-color: rgba(41, 128, 185, 0.85);
  background: rgba(52, 152, 219, 0.14);
}

.upload-emoji {
  font-size: 44px;
  margin-bottom: 10px;
}

.upload-dropzone h3 {
  margin: 8px 0;
  color: #1f2937;
  font-size: 36px;
  line-height: 1.24;
  letter-spacing: 0.4px;
}

.upload-intro {
  margin: 0 auto 20px;
  color: #64748b;
  max-width: 680px;
  font-size: 14px;
  line-height: 1.7;
  letter-spacing: 0.1px;
}

.upload-rule-panel {
  margin: 0 auto 16px;
  max-width: 760px;
  padding: 12px 14px;
  text-align: left;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.38);
  background: rgba(248, 250, 252, 0.96);
}

.upload-rule-title {
  margin: 0 0 6px;
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
}

.upload-rule-panel p {
  margin: 3px 0;
  color: #1f2937;
  font-size: 16px;
  line-height: 1.45;
}

.upload-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 22px;
  border-radius: 12px;
  background: linear-gradient(180deg, #4a9bf3, #2d7fd8);
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}

.upload-btn.is-disabled {
  pointer-events: none;
  opacity: 0.55;
  cursor: not-allowed;
}

.upload-input {
  display: none;
}

.file-panel {
  margin-top: 14px;
  border: 1px solid rgba(45, 52, 54, 0.1);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.86);
}

.file-panel-head {
  display: flex;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(45, 52, 54, 0.08);
}

.file-panel-head h4 {
  margin: 0;
  color: #2d3436;
}

.file-panel-head span {
  color: #7f8c8d;
  font-size: 12px;
}

.file-empty {
  padding: 20px 14px;
  text-align: center;
  color: #95a5a6;
}

.file-list {
  margin: 0;
  padding: 8px 10px 10px;
  list-style: none;
  display: grid;
  gap: 8px;
}

.file-item {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 10px;
  border-radius: 10px;
  background: #f8f9fb;
  border: 1px solid rgba(45, 52, 54, 0.08);
}

.file-main {
  min-width: 0;
}

.file-main strong {
  display: block;
  color: #2d3436;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-main small {
  color: #7f8c8d;
}

.file-remove {
  border: none;
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
  background: rgba(231, 76, 60, 0.12);
  color: #b23d2f;
  font-weight: 700;
}

.doc-footer {
  margin-top: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 12px;
}

.send-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 12px;
  min-height: 42px;
  min-width: 168px;
  padding: 10px 18px;
  color: #fff;
  font-weight: 700;
  font-size: clamp(13px, 1.8vw, 15px);
  line-height: 1.2;
  letter-spacing: 0.2px;
  white-space: nowrap;
  writing-mode: horizontal-tb;
  text-orientation: mixed;
  cursor: pointer;
  background: linear-gradient(180deg, #1565c0, #0d47a1);
}

.send-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.debug-panel-btn {
  border: none;
  border-radius: 12px;
  min-height: 42px;
  padding: 10px 16px;
  color: #1f2937;
  font-weight: 700;
  cursor: pointer;
  background: linear-gradient(180deg, #fde68a, #facc15);
}

.debug-panel-btn--inline {
  min-height: 34px;
  padding: 6px 12px;
  border-radius: 10px;
}

.send-ok {
  color: #1e7f45;
  font-size: 13px;
  font-weight: 600;
}

.send-info {
  margin: 10px 0 0;
  text-align: center;
  color: #0d47a1;
  font-size: 13px;
}

.send-error {
  margin: 10px 0 0;
  text-align: center;
  color: #b23d2f;
  font-size: 13px;
  font-weight: 600;
}

.visual-panel {
  margin-top: 14px;
  border: 1px solid rgba(45, 52, 54, 0.1);
  border-radius: 12px;
  background: #fff;
  overflow: hidden;
}

.visual-head {
  padding: 10px 12px;
  border-bottom: 1px solid rgba(45, 52, 54, 0.08);
  color: #1f2d3d;
}

.visual-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  padding: 10px;
}

.visual-card {
  border: 1px solid rgba(45, 52, 54, 0.1);
  border-radius: 10px;
  background: #f8fafc;
  padding: 10px;
  min-width: 0;
}

.visual-card h5 {
  margin: 0 0 8px;
  color: #0f172a;
}

.visual-card p {
  margin: 4px 0;
  color: #334155;
  font-size: 12px;
  word-break: break-word;
}

.debug-console {
  margin-top: 14px;
  border: 1px solid rgba(45, 52, 54, 0.14);
  border-radius: 12px;
  background: #111827;
  color: #e5e7eb;
  overflow: hidden;
}

.debug-page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.3);
}

.debug-page-panel {
  margin: 10px;
}

.debug-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.3);
}

.debug-clear {
  border: none;
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
  color: #111827;
  background: #e5e7eb;
  font-weight: 700;
}

.debug-actions {
  display: inline-flex;
  gap: 8px;
}

.debug-toggle {
  border: none;
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
  color: #111827;
  background: #fde68a;
  font-weight: 700;
}

.debug-export {
  border: none;
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
  color: #e2e8f0;
  background: #2563eb;
  font-weight: 700;
}

.debug-empty {
  padding: 14px 12px;
  color: #94a3b8;
}

.debug-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 360px;
  overflow: auto;
}

.debug-item {
  padding: 10px 12px;
  border-top: 1px solid rgba(148, 163, 184, 0.18);
}

.debug-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #cbd5e1;
  font-size: 12px;
  margin-bottom: 6px;
}

.debug-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  height: 20px;
  border-radius: 999px;
  font-weight: 700;
  font-size: 11px;
}

.debug-tag-send {
  background: rgba(34, 197, 94, 0.24);
  color: #86efac;
}

.debug-tag-recv {
  background: rgba(59, 130, 246, 0.24);
  color: #93c5fd;
}

.debug-text {
  margin: 0;
  padding: 8px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.9);
  color: #e2e8f0;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.workflow-viz-panel {
  margin-top: 14px;
  border: 1px solid rgba(45, 52, 54, 0.1);
  border-radius: 16px;
  background: #fff;
  overflow: hidden;
}

.workflow-viz-modal {
  position: fixed;
  inset: 0;
  z-index: 1200;
  margin: 0;
  padding: 24px;
  border: none;
  border-radius: 0;
  background: rgba(15, 23, 42, 0.42);
  display: flex;
  align-items: center;
  justify-content: center;
}

.workflow-viz-modal-content {
  width: min(1380px, 97vw);
  max-height: 92vh;
  overflow: auto;
  border: 1px solid rgba(45, 52, 54, 0.1);
  border-radius: 16px;
  background: #ffffff;
  box-shadow: 0 24px 48px rgba(15, 23, 42, 0.25);
}

.workflow-viz-head {
  padding: 12px 14px;
  border-bottom: 1px solid rgba(45, 52, 54, 0.08);
  display: flex;
  justify-content: flex-start;
  gap: 10px;
  align-items: center;
}

.workflow-viz-head strong {
  font-size: 18px;
  color: #0f172a;
}

.back-upload-btn {
  border: 1px solid #ef4444;
  background: #fff1f2;
  color: #b91c1c;
  font-weight: 700;
  border-radius: 999px;
  padding: 6px 12px;
  cursor: pointer;
  box-shadow: 0 1px 0 rgba(185, 28, 28, 0.08);
}

.workflow-viz-sub {
  margin-left: auto;
  font-size: 12px;
  color: #64748b;
}

.workflow-viz-sub--busy {
  color: #b45309;
}

.workflow-viz-empty {
  padding: 12px;
  color: #64748b;
}

.analysis-main {
  min-width: 0;
}

.report-switcher-panel {
  margin-top: 14px;
  border: 1px solid rgba(45, 52, 54, 0.1);
  border-radius: 14px;
  background: rgba(248, 250, 252, 0.95);
  padding: 12px;
}

.analysis-sidebar-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.analysis-sidebar-head small {
  color: #64748b;
  font-size: 12px;
}

.analysis-file-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.analysis-file-item {
  flex: 1 1 240px;
  max-width: 320px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  background: #fff;
  padding: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.analysis-file-item strong {
  display: block;
  color: #0f172a;
  font-size: 12px;
  word-break: break-word;
}

.analysis-file-item small {
  display: block;
  color: #64748b;
  font-size: 11px;
}

.analysis-file-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.analysis-file-status-icon {
  flex: 0 0 auto;
  font-size: 13px;
  line-height: 1;
}

.analysis-file-time {
  margin-top: 2px;
}

.analysis-file-item.is-active {
  border-color: #60a5fa;
  background: #eff6ff;
}

.workflow-kpis {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
  padding: 10px;
}

.analysis-methods {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 10px 0;
}

.analysis-method-tag {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 700;
  border: 1px solid transparent;
}

.analysis-method-tag.is-on {
  color: #166534;
  background: #dcfce7;
  border-color: #86efac;
}

.analysis-method-tag.is-off {
  color: #64748b;
  background: #f1f5f9;
  border-color: #cbd5e1;
}

.execution-toggle-btn {
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  padding: 4px 12px;
  background: #ffffff;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.execution-toggle-btn:hover {
  border-color: #93c5fd;
  color: #1d4ed8;
}

.workflow-kpi {
  border: 1px solid rgba(45, 52, 54, 0.1);
  border-radius: 10px;
  padding: 8px;
  background: #f8fafc;
}

.workflow-kpi small {
  display: block;
  color: #64748b;
  font-size: 11px;
  margin-bottom: 4px;
}

.workflow-kpi strong {
  color: #0f172a;
  font-size: 13px;
  word-break: break-word;
}

.workflow-card {
  margin: 0 10px 10px;
  border: 1px solid rgba(45, 52, 54, 0.1);
  border-radius: 14px;
  background: #f8fafc;
  padding: 12px;
}

.workflow-card h5 {
  margin: 0 0 8px;
  color: #0f172a;
}

.analysis-dual-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding: 0 10px 10px;
}

.workflow-empty-mini {
  color: #64748b;
  font-size: 12px;
}

.perf-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.perf-item-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: #334155;
}

.perf-item-head strong {
  color: #0f172a;
}

.perf-track {
  margin-top: 4px;
  height: 8px;
  border-radius: 999px;
  background: #e2e8f0;
  overflow: hidden;
}

.perf-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #60a5fa, #2563eb);
}

.perf-fill--token {
  background: linear-gradient(90deg, #34d399, #059669);
}

.mindmap-root {
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 8px;
}

.mindmap-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.mindmap-group {
  border: 1px dashed rgba(45, 52, 54, 0.2);
  border-radius: 8px;
  padding: 8px;
  background: #fff;
}

.mindmap-group strong {
  color: #1e293b;
}

.mindmap-group ul {
  margin: 6px 0 0;
  padding-left: 18px;
  color: #334155;
  font-size: 12px;
}

.diag-list {
  margin: 6px 0 0;
  padding-left: 18px;
  color: #334155;
  font-size: 12px;
}

.analysis-main-grid {
  display: grid;
  grid-template-columns: minmax(0, 3.1fr) minmax(260px, 1fr);
  gap: 12px;
  padding: 0 10px 10px;
}

.analysis-graph-card {
  min-height: 620px;
}

.mindmap-roam-hint {
  margin: 0 0 10px;
  padding: 8px 10px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.5;
  color: #475569;
  background: linear-gradient(180deg, #f1f5f9, #e8eef5);
  border: 1px solid #cbd5e1;
}

.mindmap-roam-hint__label {
  display: inline-block;
  margin-right: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  color: #1e40af;
  background: #dbeafe;
}

.mindmap-roam-hint strong {
  color: #0f172a;
  font-weight: 700;
}

.mindmap-chart-wrap {
  height: 100%;
  min-height: 580px;
  overflow: visible;
}

.mindmap-chart {
  width: 100%;
  height: 100%;
  min-height: 580px;
  overflow: visible;
}

.analysis-report-card {
  min-height: 480px;
}

.analysis-report-card h5 {
  margin-bottom: 12px;
}

.analysis-report-card p {
  margin: 6px 0;
  color: #334155;
  font-size: 13px;
  line-height: 1.55;
}

.diag-quote {
  margin: 12px 0 0;
  border-left: 3px solid #f59e0b;
  padding: 10px;
  background: #fff7ed;
  color: #7c2d12;
  font-size: 12px;
}

@media (max-width: 768px) {
  .doc-analysis-page {
    padding: 10px;
  }

  .doc-shell {
    padding: 14px;
    border-radius: 14px;
  }

  .doc-header {
    flex-direction: column;
  }

  .doc-header h2 {
    font-size: 22px;
  }

  .upload-dropzone h3 {
    font-size: 24px;
  }

  .doc-footer {
    justify-content: center;
    align-items: center;
  }

  .send-btn {
    min-width: 156px;
    font-size: 14px;
  }

  .visual-grid {
    grid-template-columns: 1fr;
  }

  .workflow-kpis {
    grid-template-columns: 1fr 1fr;
  }

  .analysis-dual-grid {
    grid-template-columns: 1fr;
    padding: 0 10px 10px;
  }

  .analysis-main-grid {
    grid-template-columns: 1fr;
  }

  .analysis-file-item {
    max-width: 100%;
  }

  .analysis-graph-card,
  .analysis-report-card {
    min-height: auto;
  }

  .mindmap-groups {
    grid-template-columns: 1fr;
  }
}
</style>
