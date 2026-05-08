<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch, TransitionGroup } from 'vue'
const uploadIcon = '/custom-upload-icon.png'

const emit = defineEmits(['request-classroom-sim'])

const MAX_FILES = 10
const FILE_RULES = [
  { exts: ['docx', 'pptx'], maxMb: 200 },
  { exts: ['jpg', 'jpeg', 'png'], maxMb: 50 },
]
const ACCEPT_TYPES = FILE_RULES.flatMap((rule) => rule.exts.map((ext) => `.${ext}`)).join(',')
/** 统一后端：与 classroom-workflow-inject 一致，文档分析走此后端路径（SSE 或 JSON 由后端决定） */
const BACKEND_BASE = String(import.meta.env.VITE_BACKEND_BASE_URL || '')
  .trim()
  .replace(/\/+$/, '')
const BACKEND_API_KEY = String(import.meta.env.VITE_BACKEND_API_KEY || '').trim()
const BACKEND_PATH_DOC = String(import.meta.env.VITE_BACKEND_PATH_DOC || '/simu/doc/chat').trim()
/** 走后端时是否仍发送与 qbot 同构的 JSON 请求体（默认 true，便于后端转发腾讯云） */
const BACKEND_DOC_QBOT_SHAPED_BODY = import.meta.env.VITE_BACKEND_DOC_QBOT_BODY !== 'false'

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

/** 已关闭浏览器直连腾讯云；未配置 BACKEND_BASE 时返回空，需显式配置 VITE_DOC_WORKFLOW_ENDPOINT 或后端 */
function getQbotSseFallbackUrl() {
  return ''
}

function getDocBotAppKey() {
  if (DOC_WORKFLOW_APP_KEY) return DOC_WORKFLOW_APP_KEY
  if (typeof window !== 'undefined' && window.WORKFLOW_CONFIG?.botAppKey) {
    const k = String(window.WORKFLOW_CONFIG.botAppKey).trim()
    if (k) return k
  }
  return ''
}

function joinBackendPath(base, path) {
  const p = String(path || '').trim()
  if (!p) return base
  const seg = p.startsWith('/') ? p : '/' + p
  return base + seg
}

function resolveDocWorkflowEndpoint(_extra) {
  if (BACKEND_BASE) return joinBackendPath(BACKEND_BASE, BACKEND_PATH_DOC)
  const explicit = String(import.meta.env.VITE_DOC_WORKFLOW_ENDPOINT || '').trim()
  if (explicit) return explicit
  return getQbotSseFallbackUrl()
}

const files = ref([])
const sending = ref(false)
/** 当前批次总文件数（用于进度展示；切换模块后回到本页仍可读） */
const analysisBatchTotal = ref(0)
/** 当前批次已完成数量 */
const analysisBatchDone = ref(0)
const exportPdfBusy = ref(false)
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

/** 最后一条若明显指向「去某模块练习 / 继续优化」等，单独拆成下一步行动区 */
function normalizeSuggestionList(suggestions) {
  return Array.isArray(suggestions)
    ? suggestions.map((x) => String(x ?? '').trim()).filter(Boolean)
    : []
}

/** 指向课堂 / 模块演练类「行动尾句」 */
function isClassroomPracticeNextStep(text) {
  const s = String(text || '').trim()
  if (s.length < 4) return false
  return /(课堂模拟|课题模拟|专项模拟|教学文档分析|仿真训练|训练模块|实训|去.*(?:练习|实训|模块|模拟)|前往.*(?:模块|训练|模拟)|继续(?:练习|优化|实训|训练|巩固)|动手(?:练习|实操)?|实操|练一练|练习\s*路径|建议.*(?:去|到|前往)|巩固|演练|实践|见习)/i.test(
    s
  )
}

/** 指向教学材料 / 课件修订类「行动尾句」（与课堂跳转区分） */
function isMaterialImprovementNextStep(text) {
  const s = String(text || '').trim()
  if (s.length < 4) return false
  return /(继续完善|完善教学(?:材料|资料|文稿)|完善(?:材料|资料|课件)|优化(?:教学)?(?:材料|课件|资料)|补充(?:教学)?(?:材料|内容|案例)|丰富(?:教学)?(?:案例|材料|内容)|修订(?:课件|文稿|材料)|教学(?:材料|资料|课件).{0,8}(?:完善|优化|补充|修订)|(?:材料|课件|资料).{0,6}(?:需|待|可)(?:完善|优化|补充))/i.test(
    s
  )
}

function classifyTrailingSuggestion(text) {
  /** 含「材料/课件」的完善类尾句优先，避免命中「继续优化…」里的课堂类规则 */
  if (isMaterialImprovementNextStep(text)) return 'material'
  if (isClassroomPracticeNextStep(text)) return 'classroom'
  return null
}

function splitDiagnosisSuggestions(suggestions) {
  const list = normalizeSuggestionList(suggestions)
  if (!list.length) return { regular: [], nextStep: null, nextKind: null }
  const last = list[list.length - 1]
  const kind = classifyTrailingSuggestion(last)
  if (kind) return { regular: list.slice(0, -1), nextStep: last, nextKind: kind }
  return { regular: list, nextStep: null, nextKind: null }
}

const diagnosisSuggestionsDisplay = computed(() =>
  splitDiagnosisSuggestions(workflowViz.value?.diagnosis?.suggestions)
)

function formatDiagnosisScoreToken(n) {
  if (Number.isInteger(n)) return String(n)
  const t = Number(n).toFixed(1)
  return t.endsWith('.0') ? String(Math.round(Number(n))) : t
}

/** 将 diagnosis.score 转为进度条百分比与展示文案（≤10 视为十分制） */
function parseDiagnosisScore(diagnosis) {
  if (!diagnosis || typeof diagnosis !== 'object') return null
  const raw = diagnosis.score ?? diagnosis.Score
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return null
  if (n <= 10) {
    const percent = Math.min(100, (n / 10) * 100)
    return {
      percent,
      label: `${formatDiagnosisScoreToken(n)} / 10`,
      band: percent >= 75 ? 'high' : percent >= 50 ? 'mid' : 'low',
    }
  }
  const capped = Math.min(100, n)
  return {
    percent: capped,
    label: `${Math.round(n)} / 100`,
    band: capped >= 75 ? 'high' : capped >= 50 ? 'mid' : 'low',
  }
}

const diagnosisScoreViz = computed(() => parseDiagnosisScore(workflowViz.value?.diagnosis))

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
  // ECharts 树图在 canvas 上不能可靠解析 var()，会表现为浅色/白字；此处用与 :root 设计 token 一致的实色
  const labelOnLight = {
    main: '#1f2a37',
    leaf: '#4b5563',
    line: '#c4cbd4',
    node: '#2f5d7c',
    nodeBorder: '#2f5d7c',
  }
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
      color: labelOnLight.line,
      width: 1.2,
    },
    label: {
      ...labelCommon,
      color: labelOnLight.main,
    },
    leaves: {
      label: {
        ...labelCommon,
        color: labelOnLight.leaf,
        fontSize: 12,
        lineHeight: 17,
      },
    },
    itemStyle: {
      color: labelOnLight.node,
      borderColor: labelOnLight.nodeBorder,
    },
    emphasis: {
      focus: 'descendant',
    },
    expandAndCollapse: true,
    animationDuration: 500,
    animationDurationUpdate: 700,
  }
}
/**
 * 导出 PDF 用：离屏渲染与弹窗一致的 ECharts 树图，截图为 PNG（html2pdf 无法复刻 canvas 导图）。
 */
async function captureMindmapAsDataUrl(mindmap) {
  if (!mindmap || typeof mindmap !== 'object') return null
  const echartsLib = await ensureEchartsLoaded().catch(() => null)
  if (!echartsLib) return null
  const treeData = buildMindmapTreeData(mindmap)
  if (!treeData) return null

  const W = 800
  const H = 640
  const host = document.createElement('div')
  host.setAttribute('data-pdf-mindmap-capture', '1')
  host.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    `width:${W}px`,
    `height:${H}px`,
    'margin:0',
    'padding:0',
    'opacity:0.02',
    'pointer-events:none',
    'z-index:2147483646',
    'background:#fff',
    'overflow:hidden',
  ].join(';')

  document.body.appendChild(host)
  let chart = null
  try {
    chart = echartsLib.init(host, null, { renderer: 'canvas', width: W, height: H })
    chart.setOption(
      {
        animation: false,
        animationDuration: 0,
        animationDurationUpdate: 0,
        tooltip: { show: false },
        series: [
          {
            data: [treeData],
            ...buildMindmapSeriesOption(host),
            roam: false,
          },
        ],
      },
      { notMerge: true }
    )
    chart.resize()
    await new Promise((r) => requestAnimationFrame(r))
    await new Promise((r) => requestAnimationFrame(r))
    await new Promise((r) => setTimeout(r, 100))
    const url = chart.getDataURL({
      type: 'png',
      pixelRatio: 2,
      backgroundColor: '#ffffff',
    })
    return typeof url === 'string' && url.startsWith('data:image/') ? url : null
  } catch (_) {
    return null
  } finally {
    try {
      chart?.dispose()
    } catch (_) {
      /* ignore */
    }
    if (host.parentNode) host.parentNode.removeChild(host)
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

/** 文档分析「建议下一步」：跳转侧栏「课堂模拟」（多生课堂演练） */
function goToClassroomSimFromSuggestion() {
  showAnalysisModal.value = false
  emit('request-classroom-sim')
}

function getActiveAnalysisExportContext() {
  const report = activeFileReport.value
  const viz = report?.viz || workflowViz.value
  if (!viz || !viz.ready) {
    sendError.value = '暂无可下载的分析报告'
    return null
  }
  return { report, viz }
}

function buildAnalysisExportObject(report, viz) {
  const diagnosis = viz.diagnosis || {}
  return {
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
      score: diagnosis.score ?? diagnosis.Score ?? null,
      coverage: diagnosis.coverage || '',
      highlight: diagnosis.highlight || '',
      structure: diagnosis.structure || '',
      suggestions: Array.isArray(diagnosis.suggestions) ? diagnosis.suggestions : [],
    },
  }
}

function exportFilenameBase(report) {
  const raw = (report?.fileName || 'report').replace(/[\\/:*?"<>|]/g, '_').trim() || 'report'
  return raw.length > 96 ? raw.slice(0, 96) : raw
}

function exportTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function triggerTextDownload(filename, text, mimeType) {
  const blob = new Blob([text], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function mindmapToMarkdownLines(node, indent) {
  const lines = []
  if (!node || typeof node !== 'object') return lines
  const name = String(node.name ?? '未命名')
    .replace(/\r?\n/g, ' ')
    .trim()
  lines.push(`${indent}- ${name}`)
  for (const c of Array.isArray(node.children) ? node.children : []) {
    lines.push(...mindmapToMarkdownLines(c, `${indent}  `))
  }
  return lines
}

function buildAnalysisMarkdown(report, viz) {
  const fileName = report?.fileName || '未知文件'
  const d = viz.diagnosis || {}
  const lines = []
  lines.push('# 教学资料分析报告')
  lines.push('')
  lines.push(`- **文件**：${fileName}`)
  lines.push(`- **导出时间**：${new Date().toLocaleString('zh-CN')}`)
  lines.push(`- **工作流**：${viz.workflowName || '-'} · \`${viz.workflowRunId || '-'}\``)
  if (viz.metrics) {
    lines.push(
      `- **耗时 / Token**：${viz.metrics.elapsed ?? '-'} ms · ${viz.metrics.tokenCount ?? '-'}`
    )
  }
  lines.push('')
  lines.push('## 知识点思维导图（大纲）')
  lines.push('')
  if (viz.mindmap && typeof viz.mindmap === 'object') {
    lines.push(...mindmapToMarkdownLines(viz.mindmap, ''))
  } else {
    lines.push('_（无思维导图数据）_')
  }
  lines.push('')
  lines.push('## 教学诊断')
  lines.push('')
  const scoreV = parseDiagnosisScore(d)
  lines.push('### 综合得分')
  lines.push(scoreV ? `- **${scoreV.label}**` : '- （未返回）')
  lines.push('')
  lines.push('### 已覆盖知识点')
  lines.push(String(d.coverage || '-').trim() || '-')
  lines.push('')
  lines.push('### 待补充知识点')
  lines.push(String(d.highlight || '-').trim() || '-')
  lines.push('')
  lines.push('### 综合建议')
  const { regular: sugRegular, nextStep: sugNext, nextKind: sugNextKind } = splitDiagnosisSuggestions(
    d.suggestions
  )
  if (sugRegular.length) {
    sugRegular.forEach((item, i) => lines.push(`${i + 1}. ${item}`))
  } else if (!sugNext) {
    lines.push('- （无）')
  }
  if (sugNext) {
    lines.push('')
    lines.push(
      sugNextKind === 'material' ? '### 建议落实 · 教学材料' : '### 建议下一步 · 课堂实践'
    )
    lines.push('')
    lines.push(`> ${sugNext}`)
  }
  lines.push('')
  lines.push('### 结构说明')
  lines.push(String(d.structure || '-').trim() || '-')
  lines.push('')
  lines.push('---')
  lines.push('*由 SimuTeach 教学资料分析生成*')
  return lines.join('\n')
}

function buildDiagnosisScorePdfBlock(d) {
  const v = parseDiagnosisScore(d)
  if (!v) return ''
  const w = Math.max(0, Math.min(100, Number(v.percent) || 0))
  return `<div style="margin:10px 0 14px;padding:12px 14px;border-radius:10px;border:1px solid #93c5fd;background:linear-gradient(135deg,#eff6ff,#dbeafe);">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:10px;">
<strong style="font-size:12pt;color:#1e3a8a;">综合得分</strong>
<span style="font-size:14pt;font-weight:800;color:#1d4ed8;white-space:nowrap;">${escapeHtml(v.label)}</span>
</div>
<div style="height:10px;border-radius:999px;background:#bfdbfe;overflow:hidden;">
<div style="height:100%;width:${w}%;border-radius:999px;background:linear-gradient(90deg,#3b82f6,#1d4ed8);"></div>
</div>
</div>`
}

function buildAnalysisPdfHtml(report, viz, mindmapImageDataUrl = null) {
  const fileName = escapeHtml(report?.fileName || '未知文件')
  const d = viz.diagnosis || {}
  const scoreBlock = buildDiagnosisScorePdfBlock(d)
  const { regular: sugRegular, nextStep: sugNext, nextKind: sugNextKind } = splitDiagnosisSuggestions(
    d.suggestions
  )
  let sugHtml = ''
  if (sugRegular.length) {
    sugHtml = `<ol>${sugRegular.map((x) => `<li>${escapeHtml(String(x))}</li>`).join('')}</ol>`
  } else if (!sugNext) {
    sugHtml = '<p>（无）</p>'
  }
  const sugNextHtml = sugNext
    ? sugNextKind === 'material'
      ? `<div style="margin-top:10px;padding:12px 14px;border-radius:12px;border:1px solid #fb923c;border-left:4px solid #ea580c;background:linear-gradient(180deg,#fffbeb,#ffedd5);"><div style="font-size:11px;font-weight:800;color:#9a3412;letter-spacing:0.02em;margin-bottom:8px;">建议落实 · 教学材料</div><p style="margin:0;font-size:12px;line-height:1.65;color:#431407;font-weight:600;">${escapeHtml(
          sugNext
        )}</p></div>`
      : `<div class="pdf-next-step" style="margin-top:10px;padding:12px 14px;border-radius:12px;border:1px solid #3b82f6;background:linear-gradient(180deg,#eff6ff,#dbeafe);"><div style="font-size:11px;font-weight:800;color:#1d4ed8;letter-spacing:0.02em;margin-bottom:8px;">建议下一步 · 课堂实践</div><p style="margin:0;font-size:12px;line-height:1.65;color:#0f172a;font-weight:600;">${escapeHtml(
          sugNext
        )}</p></div>`
    : ''
  let mindmapHtml = '<p>（无思维导图数据）</p>'
  if (
    mindmapImageDataUrl &&
    typeof mindmapImageDataUrl === 'string' &&
    mindmapImageDataUrl.startsWith('data:image/')
  ) {
    mindmapHtml = `<div class="pdf-mindmap" style="margin:10px 0 16px;">
<p style="margin:0 0 8px;font-size:12px;color:#64748b;">以下为与分析窗口一致的树状思维导图（静态导出）。</p>
<img src="${mindmapImageDataUrl}" alt="知识点思维导图" width="800" height="640" style="display:block;width:100%;max-width:800px;height:auto;margin:0 auto;border:1px solid #e2e8f0;border-radius:10px;background:#fff;box-sizing:border-box;" />
</div>`
  } else if (viz.mindmap && typeof viz.mindmap === 'object') {
    const walk = (n) => {
      if (!n || typeof n !== 'object') return ''
      const nm = escapeHtml(String(n.name ?? '未命名').replace(/\r?\n/g, ' '))
      const kids = Array.isArray(n.children) ? n.children.map(walk).join('') : ''
      return `<li>${nm}${kids ? `<ul>${kids}</ul>` : ''}</li>`
    }
    mindmapHtml = `<p style="margin:0 0 6px;font-size:12px;color:#64748b;">导图截图不可用，以下为文本大纲：</p><ul>${walk(
      viz.mindmap
    )}</ul>`
  }
  return `
<h1 style="font-size:18pt;margin:0 0 10px;">教学资料分析报告</h1>
<p style="margin:4px 0;"><strong>文件</strong>：${fileName}</p>
<p style="margin:4px 0;"><strong>导出时间</strong>：${escapeHtml(new Date().toLocaleString('zh-CN'))}</p>
<p style="margin:4px 0;"><strong>工作流</strong>：${escapeHtml(viz.workflowName || '-')} / ${escapeHtml(
    viz.workflowRunId || '-'
  )}</p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:12px 0;" />
<h2 style="font-size:14pt;margin:12px 0 6px;">知识点思维导图</h2>
${mindmapHtml}
<h2 style="font-size:14pt;margin:16px 0 6px;">教学诊断</h2>
${scoreBlock}
<h3 style="font-size:12pt;margin:8px 0 4px;">已覆盖知识点</h3>
<p style="margin:4px 0;">${escapeHtml(String(d.coverage || '-'))}</p>
<h3 style="font-size:12pt;margin:8px 0 4px;">待补充知识点</h3>
<p style="margin:4px 0;">${escapeHtml(String(d.highlight || '-'))}</p>
<h3 style="font-size:12pt;margin:8px 0 4px;">综合建议</h3>
${sugHtml}${sugNextHtml}
<h3 style="font-size:12pt;margin:8px 0 4px;">结构说明</h3>
<p style="margin:4px 0;white-space:pre-wrap;">${escapeHtml(String(d.structure || '-'))}</p>
`.trim()
}

function downloadActiveAnalysisReport() {
  const ctx = getActiveAnalysisExportContext()
  if (!ctx) return
  const content = buildAnalysisExportObject(ctx.report, ctx.viz)
  const blob = new Blob([JSON.stringify(content, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = exportTimestamp()
  a.href = url
  a.download = `analysis-${exportFilenameBase(ctx.report)}-${stamp}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function downloadActiveAnalysisMarkdown() {
  const ctx = getActiveAnalysisExportContext()
  if (!ctx) return
  const stamp = exportTimestamp()
  const base = exportFilenameBase(ctx.report)
  const md = buildAnalysisMarkdown(ctx.report, ctx.viz)
  triggerTextDownload(`analysis-${base}-${stamp}.md`, md, 'text/markdown;charset=utf-8')
}

async function downloadActiveAnalysisPdf() {
  const ctx = getActiveAnalysisExportContext()
  if (!ctx) return
  if (exportPdfBusy.value) return
  exportPdfBusy.value = true
  sendError.value = ''
  let iframe = null
  try {
    const mod = await import('html2pdf.js')
    const html2pdf =
      typeof mod.default === 'function'
        ? mod.default
        : typeof mod.default?.default === 'function'
          ? mod.default.default
          : mod

    let mindmapImageDataUrl = null
    if (ctx.viz.mindmap && typeof ctx.viz.mindmap === 'object') {
      mindmapImageDataUrl = await captureMindmapAsDataUrl(ctx.viz.mindmap)
    }
    const htmlBody = buildAnalysisPdfHtml(ctx.report, ctx.viz, mindmapImageDataUrl)
    iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.setAttribute('title', 'pdf-export')
    iframe.style.cssText = [
      'position:fixed',
      'left:0',
      'top:0',
      'width:816px',
      'height:1188px',
      'margin:0',
      'border:0',
      'opacity:0.02',
      'pointer-events:none',
      'z-index:2147483000',
      'background:#fff',
    ].join(';')

    document.body.appendChild(iframe)
    const doc = iframe.contentDocument
    if (!doc) throw new Error('无法创建导出文档')

    const baseCss = `body{margin:0;padding:22px 26px;font-family:system-ui,-apple-system,"Microsoft YaHei","PingFang SC",sans-serif;font-size:14px;line-height:1.58;color:#0f172a;background:#fff;}
h1{font-size:20px;margin:0 0 12px;font-weight:800;}
h2{font-size:16px;margin:18px 0 8px;font-weight:700;}
h3{font-size:14px;margin:12px 0 6px;font-weight:700;}
p{margin:6px 0;}
ul,ol{margin:6px 0;padding-left:1.25em;}
hr{border:none;border-top:1px solid #e2e8f0;margin:12px 0;}`

    doc.open()
    doc.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>${baseCss}</style></head><body>${htmlBody}</body></html>`
    )
    doc.close()

    await new Promise((r) => requestAnimationFrame(r))
    await new Promise((r) => requestAnimationFrame(r))
    await new Promise((r) => setTimeout(r, 120))

    const target = doc.body
    if (!target || (target.textContent || '').trim().length < 8) {
      throw new Error('导出内容为空')
    }

    const stamp = exportTimestamp()
    const base = exportFilenameBase(ctx.report)
    const w = Math.max(816, doc.documentElement.scrollWidth || 816)
    const h = Math.ceil(Math.max(target.scrollHeight, doc.documentElement.scrollHeight || 0, 400) * 1.05)

    await html2pdf()
      .set({
        margin: [10, 10, 10, 10],
        filename: `analysis-${base}-${stamp}.pdf`,
        image: { type: 'jpeg', quality: 0.92 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
          scrollX: 0,
          scrollY: 0,
          windowWidth: w,
          windowHeight: h,
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      })
      .from(target)
      .save()
  } catch (e) {
    sendError.value = e?.message ? `导出 PDF 失败：${e.message}` : '导出 PDF 失败'
  } finally {
    if (iframe?.parentNode) iframe.parentNode.removeChild(iframe)
    exportPdfBusy.value = false
  }
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
    // 后端代理模式下不在浏览器携带 bot_app_key（由服务端注入）
    bot_app_key: BACKEND_BASE ? '' : getDocBotAppKey(),
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
  const isQbotSseEndpoint =
    /\/v1\/qbot\/chat\/sse(?:\?|$)/.test(endpoint) ||
    (!!BACKEND_BASE && BACKEND_DOC_QBOT_SHAPED_BODY)
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

  const authorization = BACKEND_API_KEY
    ? `Bearer ${BACKEND_API_KEY}`
    : DOC_WORKFLOW_AUTHORIZATION
      ? DOC_WORKFLOW_AUTHORIZATION
      : DOC_WORKFLOW_API_KEY
        ? `Bearer ${DOC_WORKFLOW_API_KEY}`
        : DOC_WORKFLOW_APP_KEY
          ? `Bearer ${DOC_WORKFLOW_APP_KEY}`
          : ''
  const attachWorkflowAuth =
    (!!authorization && !isQbotSseEndpoint) || (!!BACKEND_BASE && !!BACKEND_API_KEY && isQbotSseEndpoint)
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
            <img class="upload-icon-img" :src="uploadIcon" alt="上传图标" />
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
          <div class="report-download-actions" role="group" aria-label="下载分析报告">
            <button type="button" class="debug-export" @click="downloadActiveAnalysisMarkdown">Markdown</button>
            <button
              type="button"
              class="debug-export debug-export--muted"
              :disabled="exportPdfBusy"
              @click="downloadActiveAnalysisPdf"
            >
              {{ exportPdfBusy ? 'PDF…' : 'PDF' }}
            </button>
            <button type="button" class="debug-export debug-export--muted" @click="downloadActiveAnalysisReport">
              JSON
            </button>
          </div>
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
                  <div v-if="diagnosisScoreViz" class="diag-score-card" aria-label="诊断综合得分">
                    <div class="diag-score-card__row">
                      <span class="diag-score-card__title">综合得分</span>
                      <span class="diag-score-card__value">{{ diagnosisScoreViz.label }}</span>
                    </div>
                    <div
                      class="diag-score-card__track"
                      role="progressbar"
                      :aria-valuenow="Math.round(diagnosisScoreViz.percent)"
                      aria-valuemin="0"
                      aria-valuemax="100"
                      aria-label="得分占比"
                    >
                      <div
                        class="diag-score-card__fill"
                        :class="`diag-score-card__fill--${diagnosisScoreViz.band}`"
                        :style="{ width: `${diagnosisScoreViz.percent}%` }"
                      />
                    </div>
                  </div>
                  <p><strong>已覆盖知识点</strong></p>
                  <p>{{ workflowViz.diagnosis.coverage || '-' }}</p>
                  <p><strong>待补充知识点</strong></p>
                  <p>{{ workflowViz.diagnosis.highlight || '-' }}</p>
                  <p><strong>综合建议</strong></p>
                  <ul v-if="diagnosisSuggestionsDisplay.regular.length" class="diag-list">
                    <li
                      v-for="(item, idx) in diagnosisSuggestionsDisplay.regular"
                      :key="`diag-r-${idx}`"
                    >
                      {{ item }}
                    </li>
                  </ul>
                  <p
                    v-else-if="!diagnosisSuggestionsDisplay.nextStep"
                    class="diag-suggestions-empty"
                  >
                    （无）
                  </p>
                  <aside
                    v-if="
                      diagnosisSuggestionsDisplay.nextStep &&
                      diagnosisSuggestionsDisplay.nextKind === 'classroom'
                    "
                    class="diag-next-step diag-next-step--classroom"
                    aria-label="前往课堂模拟实践引导"
                  >
                    <div class="diag-next-step__top">
                      <span class="diag-next-step__badge">建议下一步</span>
                    </div>
                    <p class="diag-next-step__kicker">把分析里的建议落到课堂演练</p>
                    <p class="diag-next-step__body">{{ diagnosisSuggestionsDisplay.nextStep }}</p>
                    <button
                      type="button"
                      class="diag-next-step__jump"
                      @click="goToClassroomSimFromSuggestion"
                    >
                      <span class="diag-next-step__jump-icon" aria-hidden="true">🏫</span>
                      <span class="diag-next-step__jump-text">
                        <span class="diag-next-step__jump-line">立即前往课堂模拟</span>
                        <span class="diag-next-step__jump-sub">一键切换模块，边讲边练</span>
                      </span>
                      <span class="diag-next-step__jump-chev" aria-hidden="true">→</span>
                    </button>
                  </aside>
                  <aside
                    v-else-if="
                      diagnosisSuggestionsDisplay.nextStep &&
                      diagnosisSuggestionsDisplay.nextKind === 'material'
                    "
                    class="diag-next-step diag-next-step--material"
                    aria-label="教学材料完善建议"
                  >
                    <div class="diag-next-step__top">
                      <span class="diag-next-step__badge diag-next-step__badge--material">建议落实</span>
                    </div>
                    <p class="diag-next-step__kicker diag-next-step__kicker--material">
                      优先落实这条改进，可直接上传修订版
                    </p>
                    <p class="diag-next-step__body diag-next-step__body--material">
                      {{ diagnosisSuggestionsDisplay.nextStep }}
                    </p>
                    <button type="button" class="diag-next-step__jump diag-next-step__jump--material" @click="backToUploadView">
                      <span class="diag-next-step__jump-icon" aria-hidden="true">📋</span>
                      <span class="diag-next-step__jump-text">
                        <span class="diag-next-step__jump-line">返回上传改进文档</span>
                        <span class="diag-next-step__jump-sub">关闭本窗口后在上方重新选择文件</span>
                      </span>
                      <span class="diag-next-step__jump-chev" aria-hidden="true">→</span>
                    </button>
                  </aside>
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
  background: var(--app-bg-page);
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
  color: var(--app-text-primary);
  background: var(--app-bg-panel);
  border: 1px solid var(--app-border-default);
  box-shadow: none;
}

.doc-toast--ok {
  border-color: var(--app-color-primary-border);
  background: var(--app-color-primary-soft);
}

.doc-toast--warn {
  border-color: var(--app-color-anxiety-border);
  background: var(--app-color-anxiety-soft);
  color: var(--app-color-anxiety-text);
}

.doc-toast--done {
  border-color: var(--app-color-pleasure-border);
  background: var(--app-color-pleasure-soft);
  color: var(--app-color-pleasure-text);
}

.doc-toast-enter-active,
.doc-toast-leave-active {
  transition: opacity 0.28s ease, transform 0.28s ease;
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
  border: 1px solid var(--app-border-default);
  background: var(--app-bg-panel);
  box-shadow: none;
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
  border: 1px solid var(--app-color-primary-border);
  background: var(--app-color-primary-soft);
  font-size: 13px;
  line-height: 1.55;
  color: var(--app-text-secondary);
}

.analysis-batch-banner strong {
  color: var(--app-color-primary);
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
  border: 1px solid var(--app-border-default);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: none;
}

.analysis-loading-spinner {
  width: 44px;
  height: 44px;
  margin: 0 auto 16px;
  border-radius: 50%;
  border: 3px solid var(--app-border-default);
  border-top-color: var(--app-color-primary);
  animation: analysis-spin 0.75s linear infinite;
}

.analysis-loading-title {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 700;
  color: var(--app-text-primary);
}

.analysis-loading-progress {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--app-color-primary);
}

.analysis-loading-detail {
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
  color: var(--app-text-tertiary);
  white-space: pre-wrap;
  word-break: break-word;
}

@keyframes analysis-spin {
  to { transform: rotate(360deg); }
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
  font-size: 24px !important;
  font-weight: 600 !important;
  color: var(--app-text-primary) !important;
  margin-bottom: 24px !important;
}

.doc-header p {
  margin: 0;
  font-size: 14px;
  color: var(--app-text-tertiary);
}

.doc-analysis-page * {
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", STHeiti, "Microsoft Yahei", Tahoma, Simsun, sans-serif !important;
}

.upload-dropzone {
  border: 1.5px dashed var(--app-color-primary-border) !important;
  border-radius: 18px !important;
  padding: 52px 22px !important;
  text-align: center !important;
  background: var(--app-color-primary-soft) !important;
  transition: all 0.2s ease !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 16px !important;
}

.upload-dropzone--over {
  border-color: var(--app-color-primary) !important;
  background: var(--app-bg-subtle) !important;
}

.upload-icon-img {
  width: 256px !important;
  height: 256px !important;
  display: block !important;
  object-fit: contain !important;
  opacity: 1 !important;
}

.upload-rule-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 0;
}

.upload-rule-panel p {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--app-text-tertiary);
}

.upload-rule-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text-secondary);
}

.upload-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 22px;
  border-radius: 12px;
  background: var(--app-color-primary);
  color: var(--app-bg-panel);
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
  border: 1px solid var(--app-border-default);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.86);
}

.file-panel-head {
  display: flex;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--app-border-default);
}

.file-panel-head h4 {
  margin: 0;
  color: var(--app-text-primary);
}

.file-panel-head span {
  color: var(--app-text-tertiary);
  font-size: 12px;
}

.file-empty {
  padding: 20px 14px;
  text-align: center;
  color: var(--app-text-tertiary);
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
  background: var(--app-bg-subtle);
  border: 1px solid var(--app-border-default);
}

.file-main {
  min-width: 0;
}

.file-main strong {
  display: block;
  color: var(--app-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-main small {
  color: var(--app-text-tertiary);
}

.file-remove {
  border: none;
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
  background: var(--app-color-anxiety-soft);
  color: var(--app-color-anxiety-text);
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
  color: var(--app-bg-panel);
  font-weight: 700;
  font-size: clamp(13px, 1.8vw, 15px);
  line-height: 1.2;
  letter-spacing: 0.2px;
  white-space: nowrap;
  writing-mode: horizontal-tb;
  text-orientation: mixed;
  cursor: pointer;
  background: var(--app-color-primary);
}

.send-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.debug-panel-btn {
  border: 1px solid var(--app-border-default);
  border-radius: 12px;
  min-height: 42px;
  padding: 10px 16px;
  color: var(--app-text-primary);
  font-weight: 700;
  cursor: pointer;
  background: var(--app-bg-subtle);
}

.debug-panel-btn--inline {
  min-height: 34px;
  padding: 6px 12px;
  border-radius: 10px;
}

.send-ok {
  color: var(--app-color-pleasure-text);
  font-size: 13px;
  font-weight: 600;
}

.send-info {
  margin: 10px 0 0;
  text-align: center;
  color: var(--app-color-primary);
  font-size: 13px;
}

.send-error {
  margin: 10px 0 0;
  text-align: center;
  color: var(--app-color-anxiety-text);
  font-size: 13px;
  font-weight: 600;
}

.visual-panel {
  margin-top: 14px;
  border: 1px solid var(--app-border-default);
  border-radius: 12px;
  background: var(--app-bg-panel);
  overflow: hidden;
}

.visual-head {
  padding: 10px 12px;
  border-bottom: 1px solid var(--app-border-default);
  color: var(--app-text-primary);
}

.visual-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  padding: 10px;
}

.visual-card {
  border: 1px solid var(--app-border-default);
  border-radius: 10px;
  background: var(--app-bg-subtle);
  padding: 10px;
  min-width: 0;
}

.visual-card h5 {
  margin: 0 0 8px;
  color: var(--app-text-primary);
}

.visual-card p {
  margin: 4px 0;
  color: var(--app-text-secondary);
  font-size: 12px;
  word-break: break-word;
}

.debug-console {
  margin-top: 14px;
  border: 1px solid var(--app-border-strong);
  border-radius: 12px;
  background: var(--app-text-primary);
  color: var(--app-bg-page);
  overflow: hidden;
}

.debug-page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--app-border-strong);
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
  border-bottom: 1px solid var(--app-border-strong);
}

.debug-clear {
  border: none;
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
  color: var(--app-text-primary);
  background: var(--app-bg-muted);
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
  color: var(--app-text-primary);
  background: var(--app-bg-muted);
  font-weight: 700;
}

.report-download-actions {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.debug-export {
  border: none;
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
  color: var(--app-bg-panel);
  background: var(--app-color-primary);
  font-weight: 700;
}

.debug-export:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.debug-export--muted {
  color: var(--app-color-primary);
  background: var(--app-color-primary-soft);
  border: 1px solid var(--app-color-primary-border);
}

.debug-empty {
  padding: 14px 12px;
  color: var(--app-text-tertiary);
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
  border-top: 1px solid var(--app-border-strong);
}

.debug-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--app-bg-muted);
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
  background: var(--app-color-pleasure-soft);
  color: var(--app-color-pleasure-text);
}

.debug-tag-recv {
  background: var(--app-color-primary-soft);
  color: var(--app-color-primary);
}

.debug-text {
  margin: 0;
  padding: 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--app-bg-page);
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.workflow-viz-panel {
  margin-top: 14px;
  border: 1px solid var(--app-border-default);
  border-radius: 16px;
  background: var(--app-bg-panel);
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
  background: rgba(31, 42, 55, 0.42);
  display: flex;
  align-items: center;
  justify-content: center;
}

.workflow-viz-modal-content {
  width: min(1380px, 97vw);
  max-height: 92vh;
  overflow: auto;
  border: 1px solid var(--app-border-default);
  border-radius: 16px;
  background: var(--app-bg-panel);
  box-shadow: none;
}

.workflow-viz-head {
  padding: 12px 14px;
  border-bottom: 1px solid var(--app-border-default);
  display: flex;
  justify-content: flex-start;
  gap: 10px;
  align-items: center;
}

.workflow-viz-head strong {
  font-size: 18px;
  color: var(--app-text-primary);
}

.back-upload-btn {
  border: 1px solid var(--app-color-anxiety-border);
  background: var(--app-color-anxiety-soft);
  color: var(--app-color-anxiety-text);
  font-weight: 700;
  border-radius: 999px;
  padding: 6px 12px;
  cursor: pointer;
  box-shadow: none;
}

.workflow-viz-sub {
  margin-left: auto;
  font-size: 12px;
  color: var(--app-text-tertiary);
}

.workflow-viz-sub--busy {
  color: var(--app-color-anxiety-text);
}

.workflow-viz-empty {
  padding: 12px;
  color: var(--app-text-tertiary);
}

.analysis-main {
  min-width: 0;
}

.report-switcher-panel {
  margin-top: 14px;
  border: 1px solid var(--app-border-default);
  border-radius: 14px;
  background: var(--app-bg-subtle);
  padding: 12px;
}

.analysis-sidebar-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.analysis-sidebar-head small {
  color: var(--app-text-tertiary);
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
  border: 1px solid var(--app-border-default);
  border-radius: 10px;
  background: var(--app-bg-panel);
  padding: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.analysis-file-item strong {
  display: block;
  color: var(--app-text-primary);
  font-size: 12px;
  word-break: break-word;
}

.analysis-file-item small {
  display: block;
  color: var(--app-text-tertiary);
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
  border-color: var(--app-color-primary-border);
  background: var(--app-color-primary-soft);
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
  color: var(--app-color-pleasure-text);
  background: var(--app-color-pleasure-soft);
  border-color: var(--app-color-pleasure-border);
}

.analysis-method-tag.is-off {
  color: var(--app-text-tertiary);
  background: var(--app-bg-subtle);
  border-color: var(--app-border-default);
}

.execution-toggle-btn {
  border: 1px solid var(--app-border-default);
  border-radius: 999px;
  padding: 4px 12px;
  background: var(--app-bg-panel);
  color: var(--app-text-secondary);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.execution-toggle-btn:hover {
  border-color: var(--app-color-primary-border);
  color: var(--app-color-primary);
}

.workflow-kpi {
  border: 1px solid var(--app-border-default);
  border-radius: 10px;
  padding: 8px;
  background: var(--app-bg-subtle);
}

.workflow-kpi small {
  display: block;
  color: var(--app-text-tertiary);
  font-size: 11px;
  margin-bottom: 4px;
}

.workflow-kpi strong {
  color: var(--app-text-primary);
  font-size: 13px;
  word-break: break-word;
}

.workflow-card {
  margin: 0 10px 10px;
  border: 1px solid var(--app-border-default);
  border-radius: 14px;
  background: var(--app-bg-subtle);
  padding: 12px;
}

.workflow-card h5 {
  margin: 0 0 8px;
  color: var(--app-text-primary);
}

.analysis-dual-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding: 0 10px 10px;
}

.workflow-empty-mini {
  color: var(--app-text-tertiary);
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
  color: var(--app-text-secondary);
}

.perf-item-head strong {
  color: var(--app-text-primary);
}

.perf-track {
  margin-top: 4px;
  height: 8px;
  border-radius: 999px;
  background: var(--app-bg-muted);
  overflow: hidden;
}

.perf-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--app-color-primary);
}

.perf-fill--token {
  background: var(--app-color-pleasure);
}

.mindmap-root {
  font-weight: 700;
  color: var(--app-text-primary);
  margin-bottom: 8px;
}

.mindmap-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.mindmap-group {
  border: 1px dashed var(--app-border-strong);
  border-radius: 8px;
  padding: 8px;
  background: var(--app-bg-panel);
}

.mindmap-group strong {
  color: var(--app-text-primary);
}

.mindmap-group ul {
  margin: 6px 0 0;
  padding-left: 18px;
  color: var(--app-text-secondary);
  font-size: 12px;
}

.diag-list {
  margin: 6px 0 0;
  padding-left: 18px;
  color: var(--app-text-secondary);
  font-size: 12px;
}

.diag-suggestions-empty {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--app-text-tertiary);
}

.diag-score-card {
  margin: 0 0 14px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--app-color-primary-border);
  background: var(--app-color-primary-soft);
  box-shadow: none;
}

.diag-score-card__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.diag-score-card__title {
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: var(--app-text-primary);
  text-transform: none;
}

.diag-score-card__value {
  font-size: 20px;
  font-weight: 800;
  color: var(--app-color-primary);
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.diag-score-card__track {
  height: 10px;
  border-radius: 999px;
  background: var(--app-bg-muted);
  overflow: hidden;
}

.diag-score-card__fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.35s ease;
}

.diag-score-card__fill--high {
  background: var(--app-color-primary);
}

.diag-score-card__fill--mid {
  background: var(--app-color-neutral);
}

.diag-score-card__fill--low {
  background: var(--app-color-anxiety);
}

.diag-next-step {
  margin: 14px 0 0;
  padding: 14px 14px 16px;
  border-radius: 14px;
}

.diag-next-step--classroom {
  border: 1px solid var(--app-color-primary-border);
  border-left: 4px solid var(--app-color-primary);
  background: var(--app-color-primary-soft);
  box-shadow: none;
}

.diag-next-step--material {
  border: 1px solid var(--app-color-anxiety-border);
  border-left: 4px solid var(--app-color-anxiety);
  background: var(--app-color-anxiety-soft);
  box-shadow: none;
}

.diag-next-step__top {
  margin-bottom: 6px;
}

.diag-next-step__badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 11px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.05em;
  color: var(--app-bg-panel);
  background: var(--app-color-primary);
  box-shadow: none;
}

.diag-next-step__badge--material {
  background: var(--app-color-anxiety);
  box-shadow: none;
}

.diag-next-step__kicker {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--app-color-primary);
  letter-spacing: 0.02em;
}

.diag-next-step__kicker--material {
  color: var(--app-color-anxiety-text);
}

.diag-next-step__body {
  margin: 0 0 12px;
  padding: 10px 11px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.65;
  color: var(--app-text-primary);
  background: rgba(255, 255, 255, 0.72);
  border-radius: 10px;
  border: 1px solid var(--app-color-primary-border);
}

.diag-next-step__body--material {
  border-color: var(--app-color-anxiety-border);
  background: rgba(255, 255, 255, 0.88);
  color: var(--app-text-primary);
}

.diag-next-step__jump {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  border: none;
  border-radius: 12px;
  padding: 12px 14px;
  text-align: left;
  color: var(--app-bg-panel);
  background: var(--app-color-primary);
  box-shadow: none;
}

.diag-next-step__jump:hover {
  filter: brightness(1.05);
  transform: translateY(-1px);
}

.diag-next-step__jump:active {
  transform: translateY(0);
}

.diag-next-step__jump:focus-visible {
  outline: 3px solid var(--app-color-primary-border);
  outline-offset: 2px;
}

.diag-next-step__jump--material {
  background: var(--app-color-anxiety);
  box-shadow: none;
}

.diag-next-step__jump--material:focus-visible {
  outline-color: var(--app-color-anxiety-border);
}

.diag-next-step__jump-icon {
  flex-shrink: 0;
  font-size: 22px;
  line-height: 1;
}

.diag-next-step__jump-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.diag-next-step__jump-line {
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.diag-next-step__jump-sub {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.92;
}

.diag-next-step__jump-chev {
  flex-shrink: 0;
  font-size: 18px;
  font-weight: 800;
  opacity: 0.9;
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
  color: var(--app-text-tertiary);
  background: var(--app-bg-subtle);
  border: 1px solid var(--app-border-default);
}

.mindmap-roam-hint__label {
  display: inline-block;
  margin-right: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  color: var(--app-color-primary);
  background: var(--app-color-primary-soft);
}

.mindmap-roam-hint strong {
  color: var(--app-text-primary);
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
  color: var(--app-text-secondary);
  font-size: 13px;
  line-height: 1.55;
}

.diag-quote {
  margin: 12px 0 0;
  border-left: 3px solid var(--app-color-anxiety);
  padding: 10px;
  background: var(--app-color-anxiety-soft);
  color: var(--app-color-anxiety-text);
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
