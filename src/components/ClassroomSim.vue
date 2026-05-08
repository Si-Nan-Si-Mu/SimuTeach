<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { deepExtractAssistantDialogFromObject, normalizeAssistantDialogText } from '../extractCompletionDialog.js'

const props = defineProps({
  /** 由 App 控制：仅课堂模式激活轮询 */
  active: { type: Boolean, default: true },
  /** 生成报告进行中：禁用本模块内「结束·生成报告」 */
  reportBusy: { type: Boolean, default: false }
})

const emit = defineEmits(['report'])

function requestTrainingReport() {
  if (props.reportBusy) return
  emit('report')
}

/** 与左侧专项模拟 SideBar 中三个人格一致（id 便于工作流区分对象） */
const students = ref([
  {
    id: 'dazhi',
    name: '李大志',
    personality: '习得性无助',
    row: 0,
    col: 0,
    avatar: '/avatars/dazhi.png'
  },
  {
    id: 'yiming',
    name: '张一鸣',
    personality: '调皮捣蛋',
    row: 0,
    col: 1,
    avatar: '/avatars/yiming.png'
  },
  {
    id: 'xiaorou',
    name: '林暖暖',
    personality: '乖巧敏感',
    row: 0,
    col: 2,
    avatar: '/avatars/xiaorou.png'
  }
])

const selectedStudentId = ref(null)
const selectedStudent = computed(() => {
  if (!selectedStudentId.value) return null
  return students.value.find((s) => s.id === selectedStudentId.value) ?? null
})

const broadcastText = ref('')
/** 与课堂工作流会话一致，便于多轮上下文 */
const classroomSessionId = ref(`classroom_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`)
const workflowBusy = ref(false)
/** SSE 流式预览（控制台亦有 [ClassroomWorkflow] 日志） */
const workflowStreamPreview = ref('')
/** 课堂发送队列：手动发言与主动轮询统一串行，避免互相抢占 */
const queuedSendCount = ref(0)
const sendQueue = []
let queueRunning = false
/** 主动轮询定时器（每 30s） */
let proactiveTimer = null
const proactiveIntervalSec = ref(30)
const proactiveEnabled = ref(false)

/** 本轮回复气泡应挂在哪些学生头上（单人对话 1 个；全班广播用中间位「代表」展示，避免三重复制） */
const lastReplyTargets = ref([])
/** 头顶气泡：按角色独立维护，互不覆盖；回复保留至少 7s */
const BUBBLE_HOLD_MS = 7000
const bubbleByStudentId = ref({})
const bubbleHideTimers = new Map()

function getBubbleFor(studentId) {
  return bubbleByStudentId.value[studentId] || { text: '', streaming: false, visible: false }
}

function setBubbleFor(ids, patch) {
  const next = { ...bubbleByStudentId.value }
  for (const id of ids || []) {
    if (!id) continue
    const prev = next[id] || { text: '', streaming: false, visible: false }
    next[id] = { ...prev, ...patch }
  }
  bubbleByStudentId.value = next
}

function clearBubbleFor(ids) {
  const next = { ...bubbleByStudentId.value }
  for (const id of ids || []) {
    if (!id) continue
    next[id] = { text: '', streaming: false, visible: false }
    const t = bubbleHideTimers.get(id)
    if (t) {
      clearTimeout(t)
      bubbleHideTimers.delete(id)
    }
  }
  bubbleByStudentId.value = next
}

function keepBubbleVisibleFor(ids, ms = BUBBLE_HOLD_MS) {
  for (const id of ids || []) {
    if (!id) continue
    const old = bubbleHideTimers.get(id)
    if (old) clearTimeout(old)
    const timer = setTimeout(() => {
      const cur = getBubbleFor(id)
      // 若期间进入新一轮流式，则不在此刻清理
      if (cur.streaming) return
      clearBubbleFor([id])
    }, ms)
    bubbleHideTimers.set(id, timer)
  }
}

const bubbleVisibleFor = (studentId) => {
  const b = getBubbleFor(studentId)
  return !!(b.visible && (b.text || b.streaming))
}

const bubbleTextFor = (studentId) => getBubbleFor(studentId).text || ''
const bubbleStreamingFor = (studentId) => !!getBubbleFor(studentId).streaming

function finalizeReplyBubbleState() {
  workflowStreamPreview.value = ''
  const ids = [...lastReplyTargets.value]
  if (!ids.length) return
  const hasTextIds = ids.filter((id) => {
    const b = getBubbleFor(id)
    return !!b.text
  })
  if (hasTextIds.length) {
    setBubbleFor(hasTextIds, { streaming: false, visible: true })
    keepBubbleVisibleFor(hasTextIds, BUBBLE_HOLD_MS)
  }
  const emptyIds = ids.filter((id) => !getBubbleFor(id).text)
  if (emptyIds.length) clearBubbleFor(emptyIds)
}

async function runSendQueue() {
  if (queueRunning) return
  queueRunning = true
  while (sendQueue.length) {
    const task = sendQueue.shift()
    queuedSendCount.value = sendQueue.length
    workflowBusy.value = true
    try {
      await task()
    } catch (e) {
      const msg = e && e.message ? e.message : String(e)
      pushClassroomEvent('system', '发送任务异常', msg)
      clearBubbleFor(lastReplyTargets.value)
    } finally {
      workflowBusy.value = false
      finalizeReplyBubbleState()
    }
  }
  queueRunning = false
}

function enqueueSendTask(task) {
  sendQueue.push(task)
  queuedSendCount.value = sendQueue.length
  void runSendQueue()
}

/** 三人格初始情绪（与专项模拟一致，随课堂互动略作波动） */
const emotionByStudentId = ref({
  dazhi: { joy: 20, activation: 15, anxiety: 75 },
  yiming: { joy: 70, activation: 85, anxiety: 15 },
  xiaorou: { joy: 45, activation: 40, anxiety: 55 }
})

const EMOTION_DIMS = [
  { key: 'joy', label: '愉悦度', color: '#2ecc71' },
  { key: 'activation', label: '激活度', color: '#3498db' },
  { key: 'anxiety', label: '焦虑度', color: '#e74c3c' }
]

const classAverageEmotion = computed(() => {
  const list = students.value.map((s) => emotionByStudentId.value[s.id]).filter(Boolean)
  if (!list.length) return { joy: 0, activation: 0, anxiety: 0 }
  const n = list.length
  const sum = list.reduce(
    (acc, e) => ({
      joy: acc.joy + e.joy,
      activation: acc.activation + e.activation,
      anxiety: acc.anxiety + e.anxiety
    }),
    { joy: 0, activation: 0, anxiety: 0 }
  )
  return {
    joy: sum.joy / n,
    activation: sum.activation / n,
    anxiety: sum.anxiety / n
  }
})

const emotionStudentRows = computed(() =>
  students.value.map((s) => ({
    id: s.id,
    name: s.name,
    avatar: s.avatar,
    joy: emotionByStudentId.value[s.id]?.joy ?? 0,
    activation: emotionByStudentId.value[s.id]?.activation ?? 0,
    anxiety: emotionByStudentId.value[s.id]?.anxiety ?? 0
  }))
)

/** 课堂对话框：显示最近对话/反馈（含主动轮询），按时间正序 */
const dialogFeedItems = computed(() => {
  const items = (classroomEvents.value || [])
    .filter((ev) => ev && (ev.kind === 'dialog' || ev.kind === 'feedback' || ev.kind === 'system'))
    .slice(0, 60)
    .slice()
    .reverse()
  return items
})

function clampEmo(v) {
  return Math.max(0, Math.min(100, Math.round(v)))
}

function nudgeEmotionForAll(delta) {
  for (const s of students.value) {
    const e = emotionByStudentId.value[s.id]
    if (!e) continue
    e.joy = clampEmo(e.joy + (delta.joy || 0))
    e.activation = clampEmo(e.activation + (delta.activation || 0))
    e.anxiety = clampEmo(e.anxiety + (delta.anxiety || 0))
  }
}

function nudgeEmotionForStudents(ids, delta) {
  const set = new Set(ids || [])
  for (const id of set) {
    const e = emotionByStudentId.value[id]
    if (!e) continue
    e.joy = clampEmo(e.joy + (delta.joy || 0))
    e.activation = clampEmo(e.activation + (delta.activation || 0))
    e.anxiety = clampEmo(e.anxiety + (delta.anxiety || 0))
  }
}

/** 课堂事件：对话、智能体反馈、系统提示等 */
const classroomEvents = ref([
  {
    id: 'evt-init',
    ts: Date.now(),
    kind: 'system',
    title: '课堂就绪',
    detail: '三人格已就位：李大志、张一鸣、林暖暖。可选中单人对话或全班广播。'
  }
])

function pushClassroomEvent(kind, title, detail = '') {
  classroomEvents.value.unshift({
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ts: Date.now(),
    kind,
    title,
    detail: String(detail || '').slice(0, 2000)
  })
  if (classroomEvents.value.length > 100) classroomEvents.value.pop()
}

function formatEvtTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  } catch {
    return ''
  }
}

function eventKindLabel(kind) {
  const m = { dialog: '对话', feedback: '学生反馈', system: '系统' }
  return m[kind] || kind
}

function clampProactiveInterval(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 30
  return Math.max(5, Math.min(300, Math.round(n)))
}

function buildDirectClassroomBody(content = '', proactive = true, apiKey = '', modelOverride = '') {
  const overrideModel = String(modelOverride || '').trim()
  return {
    model: overrideModel || selectedStudent.value?.name || '李大志',
    messages: [
      {
        role: 'user',
        content: String(content || '')
      }
    ],
    proactive: !!proactive,
    evaluation: false,
    stream: false,
    user: String(classroomSessionId.value || ''),
    api_key: String(apiKey || '')
  }
}

function pickDialogFromAny(input) {
  if (input == null) return ''
  if (typeof input === 'string') return normalizeAssistantDialogText(input).trim()
  if (typeof input === 'object') {
    const deep = deepExtractAssistantDialogFromObject(input)
    if (deep) return normalizeAssistantDialogText(deep).trim()
    const c =
      input.text ||
      input.content ||
      input.reply ||
      input.message ||
      (input.payload && (input.payload.text || input.payload.content || input.payload.reply))
    if (typeof c === 'string') return normalizeAssistantDialogText(c).trim()
  }
  return ''
}

function isChoicesInd(val) {
  if (typeof val === 'string') return val.trim().toLowerCase() === 'ind'
  if (Array.isArray(val)) {
    if (!val.length) return false
    return val.every((it) => {
      if (typeof it === 'string') return it.trim().toLowerCase() === 'ind'
      if (!it || typeof it !== 'object') return false
      const c1 = typeof it.content === 'string' ? it.content : ''
      const c2 = typeof it?.message?.content === 'string' ? it.message.content : ''
      return [c1, c2].some((x) => x.trim().toLowerCase() === 'ind')
    })
  }
  return false
}

function hasIndChoiceMarker(obj) {
  if (!obj || typeof obj !== 'object') return false
  if (isChoicesInd(obj.choices)) return true
  if (obj.preview && typeof obj.preview === 'object' && isChoicesInd(obj.preview.choices)) return true
  const p = obj.payload
  if (p && typeof p === 'object') {
    if (isChoicesInd(p.choices)) return true
    if (p.preview && typeof p.preview === 'object' && isChoicesInd(p.preview.choices)) return true
  }
  return false
}

function extractDirectClassroomReply(obj, { proactive = false } = {}) {
  if (!obj || typeof obj !== 'object') return ''
  if (hasIndChoiceMarker(obj)) return ''

  let text = ''
  // 主动轮询优先吃 x-proactive；若没有也回退到标准 completion 内容
  if (proactive) {
    const xPro = obj['x-proactive'] ?? obj.x_proactive ?? obj?.payload?.['x-proactive'] ?? obj?.payload?.x_proactive
    if (typeof xPro === 'string') text = xPro
    else if (xPro && typeof xPro === 'object') text = pickDialogFromAny(xPro) || ''
  }
  if (!text) {
    text = pickDialogFromAny(obj)
  }
  text = normalizeAssistantDialogText(String(text || '')).trim()
  if (!text) return ''
  // 兼容后端约定「x-proactive: +回复」
  if (text.startsWith('+')) text = text.slice(1).trim()
  return text
}

function pickModelFromAny(obj) {
  if (!obj || typeof obj !== 'object') return ''
  const model =
    obj.model ||
    obj?.payload?.model ||
    obj?.preview?.model ||
    obj?.payload?.preview?.model ||
    obj?.data?.model
  return typeof model === 'string' ? model.trim() : ''
}

function resolveTargetIdsByModel(model, fallbackIds = []) {
  const m = String(model || '').trim()
  if (!m) return [...fallbackIds]
  const hit = students.value.find((s) => s.name === m || m.includes(s.name))
  return hit ? [hit.id] : [...fallbackIds]
}

function pickRandomProactiveStudent() {
  const list = Array.isArray(students.value) ? students.value : []
  if (!list.length) return { id: 'dazhi', name: '李大志' }
  const idx = Math.floor(Math.random() * list.length)
  const chosen = list[idx] || list[0]
  return {
    id: chosen?.id || 'dazhi',
    name: chosen?.name || '李大志'
  }
}

async function parseDirectClassroomResponse(res, { proactive = false } = {}) {
  const contentType = String(res.headers.get('Content-Type') || '').toLowerCase()
  if (typeof window !== 'undefined' && window.console) {
    console.log('[ClassroomProactive] 响应状态', {
      status: res.status,
      ok: res.ok,
      contentType
    })
  }
  if (!contentType.includes('text/event-stream') && !contentType.includes('application/stream+json')) {
    const text = await res.text()
    if (typeof window !== 'undefined' && window.console) {
      console.log('[ClassroomProactive] 非SSE原始响应(前180字):', String(text || '').slice(0, 180))
    }
    if (!text) return { text: '', model: '' }
    try {
      const j = JSON.parse(text)
      const out = extractDirectClassroomReply(j, { proactive })
      const model = pickModelFromAny(j)
      if (typeof window !== 'undefined' && window.console) {
        console.log('[ClassroomProactive] 非SSE解析结果', {
          extractedLen: out.length,
          extractedPreview: out.slice(0, 120),
          model,
          accepted: !!out
        })
      }
      return { text: out, model }
    } catch {
      // 非 JSON 响应：尝试尽量净化文本
      const out = normalizeAssistantDialogText(String(text || '')).trim()
      if (typeof window !== 'undefined' && window.console) {
        console.log('[ClassroomProactive] 非SSE文本净化结果', {
          extractedLen: out.length,
          extractedPreview: out.slice(0, 120)
        })
      }
      return { text: out, model: '' }
    }
  }

  if (!res.body) return { text: '', model: '' }
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let finalText = ''
  let finalModel = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split('\n\n')
    buffer = chunks.pop() || ''
    for (const chunk of chunks) {
      const lines = chunk.split('\n').filter(Boolean)
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith('data:')) continue
        const raw = t.slice(5).trim()
        if (!raw) continue
        const candidates = raw.includes('}{')
          ? raw.split('}{').map((x, idx, arr) => `${idx > 0 ? '{' : ''}${x}${idx < arr.length - 1 ? '}' : ''}`)
          : [raw]
        for (const c of candidates) {
          let j = null
          try {
            j = JSON.parse(c)
          } catch {
            // 直连场景：仅处理可解析 JSON 分片
            continue
          }
          const payload = j && j.payload != null ? j.payload : j
          const s =
            extractDirectClassroomReply(payload, { proactive }) || extractDirectClassroomReply(j, { proactive })
          if (s) finalText = s
          const m = pickModelFromAny(payload) || pickModelFromAny(j)
          if (m) finalModel = m
        }
      }
    }
  }
  if (typeof window !== 'undefined' && window.console) {
    console.log('[ClassroomProactive] SSE解析完成', {
      extractedLen: finalText.length,
      extractedPreview: finalText.slice(0, 120),
      model: finalModel
    })
  }
  return { text: finalText.trim(), model: finalModel }
}

async function callClassroomBackendDirect({ proactive = true, content = '', modelOverride = '' } = {}) {
  const reportInj =
    typeof window !== 'undefined' && window.__REPORT_WORKFLOW_INJECT__ && typeof window.__REPORT_WORKFLOW_INJECT__ === 'object'
      ? window.__REPORT_WORKFLOW_INJECT__
      : null
  const url = String(reportInj?.httpUrl || '').trim()
  const apiKey = String(reportInj?.httpApiKey || '').trim()
  if (!url) {
    throw new Error('课堂直连后端地址未配置（请设置 VITE_REPORT_HTTP_URL）')
  }
  const body = buildDirectClassroomBody(content, proactive, apiKey, modelOverride)
  if (typeof window !== 'undefined' && window.console) {
    const safeBody = { ...body }
    if (safeBody.api_key) safeBody.api_key = '***'
    console.log('[ClassroomProactive] 发送请求JSON', {
      url,
      proactive: !!proactive,
      model: safeBody.model,
      content_len: String(content || '').length,
      body: safeBody
    })
  }
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    Accept: 'application/json',
  }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: new TextEncoder().encode(JSON.stringify(body))
  })
  if (!res.ok) {
    const text = await res.text()
    if (typeof window !== 'undefined' && window.console) {
      console.warn('[ClassroomProactive] 请求失败', {
        status: res.status,
        bodyPreview: String(text || '').slice(0, 200)
      })
    }
    throw new Error(text || `HTTP ${res.status}`)
  }
  const parsed = await parseDirectClassroomResponse(res, { proactive: !!proactive })
  if (typeof window !== 'undefined' && window.console) {
    console.log('[ClassroomProactive] 返回提炼文本', {
      len: (parsed.text || '').length,
      preview: (parsed.text || '').slice(0, 120),
      model: parsed.model || ''
    })
  }
  return parsed
}

function restartProactiveTimer() {
  if (proactiveTimer) {
    clearInterval(proactiveTimer)
    proactiveTimer = null
  }
  if (!proactiveEnabled.value) return
  proactiveTimer = window.setInterval(() => {
    void sendProactiveTick({ fromManual: false })
  }, clampProactiveInterval(proactiveIntervalSec.value) * 1000)
}

function applyProactiveSettings() {
  proactiveIntervalSec.value = clampProactiveInterval(proactiveIntervalSec.value)
  restartProactiveTimer()
  pushClassroomEvent(
    'system',
    '轮询设置已更新',
    `间隔 ${proactiveIntervalSec.value}s · ${proactiveEnabled.value ? '已开启' : '已关闭'}`
  )
}

function toggleProactivePolling() {
  proactiveEnabled.value = !proactiveEnabled.value
  restartProactiveTimer()
  pushClassroomEvent(
    'system',
    proactiveEnabled.value ? '主动轮询已开启' : '主动轮询已关闭',
    proactiveEnabled.value ? `间隔 ${clampProactiveInterval(proactiveIntervalSec.value)}s` : ''
  )
}

/** 小屏下底部 Tab：对话 | 数据（与专项模拟一致） */
const mobileActivePanel = ref('chat')

watch(mobileActivePanel, () => {
  nextTick(() => {
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
  })
})

const seatStyle = (s) => ({
  gridRow: s.row + 1,
  gridColumn: s.col + 1
})

/** 人格标签 → 铭牌配色（与专项模拟角色气质对应） */
const personalityTone = (personality) => {
  const p = String(personality || '')
  if (p.includes('无助')) return 'confused'
  if (p.includes('调皮')) return 'distracted'
  if (p.includes('敏感')) return 'focus'
  return 'neutral'
}

const onSelectStudent = (s) => {
  selectedStudentId.value = s.id
}

const onBroadcast = async ({ forceClass = false } = {}) => {
  const t = broadcastText.value.trim()
  if (!t) return
  const selectedSnapshot = forceClass
    ? null
    : selectedStudent.value
    ? { id: selectedStudent.value.id, name: selectedStudent.value.name }
    : null
  const prefix = selectedSnapshot ? `教师对 ${selectedSnapshot.name}：` : '教师广播：'
  const teacherLine = `${prefix}${t}`
  pushClassroomEvent('dialog', '教师发言', teacherLine)
  if (selectedSnapshot) {
    nudgeEmotionForStudents([selectedSnapshot.id], { joy: 2, activation: 3, anxiety: -2 })
  } else {
    nudgeEmotionForAll({ joy: 1, activation: 2, anxiety: -1 })
  }
  broadcastText.value = ''

  enqueueSendTask(async () => {
    workflowStreamPreview.value = ''
    lastReplyTargets.value = selectedSnapshot ? [selectedSnapshot.id] : ['yiming']
    setBubbleFor(lastReplyTargets.value, { text: '', streaming: true, visible: true })
    try {
      // 课堂手动发言改为直连后端 API，不再经过工作流
      const direct = await callClassroomBackendDirect({ proactive: false, content: teacherLine })
      const text = direct && typeof direct === 'object' ? direct.text || '' : String(direct || '')
      const initialIds = [...lastReplyTargets.value]
      const targetIds = resolveTargetIdsByModel(direct?.model, initialIds)
      const staleIds = initialIds.filter((id) => !targetIds.includes(id))
      if (staleIds.length) clearBubbleFor(staleIds)
      lastReplyTargets.value = [...targetIds]
      if (text) {
        setBubbleFor(targetIds, { text, streaming: false, visible: true })
        keepBubbleVisibleFor(targetIds, BUBBLE_HOLD_MS)
        const names = lastReplyTargets.value
          .map((id) => students.value.find((s) => s.id === id)?.name)
          .filter(Boolean)
          .join('、')
        pushClassroomEvent('feedback', names ? `学生反馈（${names}）` : '学生反馈（课堂）', text)
        nudgeEmotionForStudents(targetIds, { joy: 4, activation: 3, anxiety: -4 })
      } else {
        clearBubbleFor(targetIds)
      }
    } catch (e) {
      const msg = e && e.message ? e.message : String(e)
      pushClassroomEvent('system', '课堂请求失败', msg)
      clearBubbleFor(lastReplyTargets.value)
    }
  })
}

/** 主动轮询：每 30s 直连课堂后端发空内容，并携带 proactive=true */
const sendProactiveTick = ({ fromManual = false } = {}) => {
  enqueueSendTask(async () => {
    workflowStreamPreview.value = ''
    const randomStudent = pickRandomProactiveStudent()
    // 主动轮询：每次随机切换人格，并把 model 指向该人格
    lastReplyTargets.value = [randomStudent.id]
    setBubbleFor(lastReplyTargets.value, { text: '', streaming: true, visible: true })
    pushClassroomEvent(
      'system',
      fromManual ? '主动会话调试' : '主动轮询',
      `已直连后端发送 proactive=true 空内容请求（model=${randomStudent.name}）。`
    )

    try {
      const direct = await callClassroomBackendDirect({
        proactive: true,
        content: '',
        modelOverride: randomStudent.name
      })
      const text = direct && typeof direct === 'object' ? direct.text || '' : String(direct || '')
      const initialIds = [...lastReplyTargets.value]
      const targetIds = resolveTargetIdsByModel(direct?.model, initialIds)
      const staleIds = initialIds.filter((id) => !targetIds.includes(id))
      if (staleIds.length) clearBubbleFor(staleIds)
      lastReplyTargets.value = [...targetIds]
      if (text) {
        setBubbleFor(targetIds, { text, streaming: false, visible: true })
        keepBubbleVisibleFor(targetIds, BUBBLE_HOLD_MS)
        const names = lastReplyTargets.value
          .map((id) => students.value.find((s) => s.id === id)?.name)
          .filter(Boolean)
          .join('、')
        pushClassroomEvent('feedback', names ? `学生反馈（${names}）` : '学生反馈（课堂）', text)
        nudgeEmotionForStudents(targetIds, { joy: 4, activation: 3, anxiety: -4 })
      } else {
        clearBubbleFor(targetIds)
      }
    } catch (e) {
      const msg = e && e.message ? e.message : String(e)
      pushClassroomEvent('system', '主动会话失败', msg)
      clearBubbleFor(lastReplyTargets.value)
    }
  })
}

const onBroadcastClass = () => onBroadcast({ forceClass: true })

onMounted(() => {
  proactiveEnabled.value = !!props.active
  proactiveIntervalSec.value = clampProactiveInterval(proactiveIntervalSec.value)
  restartProactiveTimer()
})

watch(
  () => props.active,
  (isActive) => {
    if (isActive) {
      proactiveEnabled.value = true
      proactiveIntervalSec.value = clampProactiveInterval(proactiveIntervalSec.value)
      restartProactiveTimer()
      return
    }
    if (proactiveTimer) {
      clearInterval(proactiveTimer)
      proactiveTimer = null
    }
    workflowStreamPreview.value = ''
  }
)

onBeforeUnmount(() => {
  if (proactiveTimer) {
    clearInterval(proactiveTimer)
    proactiveTimer = null
  }
  for (const t of bubbleHideTimers.values()) clearTimeout(t)
  bubbleHideTimers.clear()
})
</script>

<template>
  <div
    class="classroom-sim classroom-shell"
    :class="mobileActivePanel === 'dashboard' ? 'classroom-shell--dash' : 'classroom-shell--chat'"
  >
    <div class="classroom-panels">
      <section class="stage classroom-panel classroom-panel--chat">
      <header class="podium" aria-label="讲台">
        <div class="podium-left">
          <div class="podium-title"><img src="/icons/podium.png" style="width: 40px; height: 40px; vertical-align: -6px; margin-right: 2px; object-fit: contain;" aria-hidden="true" /> 老师讲台</div>
          <div class="podium-subtitle">虚拟座位表（专项模拟 · 三人格三角布局）</div>
        </div>
        <div class="podium-right">
          <span class="pill">{{
            selectedStudent ? `当前：${selectedStudent.name}` : '当前：全班视角'
          }}</span>
          <button
            id="btn-classroom-report"
            type="button"
            class="classroom-report-btn"
            :disabled="reportBusy"
            :title="reportBusy ? '报告生成中，请稍候…' : '结束本节课并生成训练报告'"
            @click="requestTrainingReport"
          >
            <img src="/icons/report.png" style="width: 36px; height: 36px; vertical-align: -4px; margin-right: 2px; object-fit: contain;" aria-hidden="true" /> 结束 · 生成报告
          </button>
        </div>
      </header>

      <div class="seating-area" aria-label="虚拟座位表">
        <div class="seating-grid">
          <div
            v-for="s in students"
            :key="s.id"
            class="student-seat"
            :style="seatStyle(s)"
            role="button"
            tabindex="0"
            @click="onSelectStudent(s)"
            @keydown.enter.prevent="onSelectStudent(s)"
          >
            <div class="student-body">
              <div
                v-if="bubbleVisibleFor(s.id)"
                class="speech-bubble speech-bubble--reply"
                :class="{ 'speech-bubble--streaming': bubbleStreamingFor(s.id) }"
                role="status"
                :aria-label="bubbleStreamingFor(s.id) ? '智能体正在生成回复' : '智能体回复'"
              >
                <div class="speech-bubble-inner speech-bubble-inner--reply">
                  <span class="speech-bubble-text">{{ bubbleTextFor(s.id) || (bubbleStreamingFor(s.id) ? '…' : '') }}</span>
                  <span v-if="bubbleStreamingFor(s.id)" class="speech-bubble-cursor" aria-hidden="true" />
                </div>
                <div class="speech-tail" />
              </div>

              <img
                class="student-avatar-img"
                :class="{ 'student-avatar-img--dazhi': s.id === 'dazhi' }"
                :src="s.avatar"
                :alt="s.name"
                aria-hidden="true"
              />
            </div>

            <div class="student-desk" :class="{ selected: selectedStudentId === s.id }" aria-hidden="true">
              <div class="desk-nameplate desk-nameplate--stacked">
                <div class="nameplate-name">{{ s.name }}</div>
                <div class="nameplate-status" :data-tone="personalityTone(s.personality)">
                  {{ s.personality }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 对话流与输入框卡片 -->
      <div class="conversation-card">
        <!-- 对话框：同步展示手动与主动轮询的学生发言 -->
        <div class="classroom-dialog-feed" role="log" aria-label="课堂对话框">
          <div v-if="!dialogFeedItems.length" class="dialog-feed-empty">暂无对话记录</div>
          <div v-else class="dialog-feed-list">
            <div
              v-for="ev in dialogFeedItems"
              :key="ev.id"
              class="dialog-feed-item"
              :data-kind="ev.kind"
            >
              <span class="dialog-feed-time">{{ formatEvtTime(ev.ts) }}</span>
              <span class="dialog-feed-title">{{ ev.title }}</span>
              <span v-if="ev.detail" class="dialog-feed-detail">{{ ev.detail }}</span>
            </div>
          </div>
        </div>

        <footer class="teacher-bar" aria-label="教师控制栏">
          <div v-if="workflowStreamPreview" class="workflow-stream-preview" aria-live="polite">
            <span class="workflow-stream-label">智能体生成中…</span>
            <span class="workflow-stream-text">{{ workflowStreamPreview }}</span>
          </div>
          <div class="teacher-input-wrap">
            <input
              id="classroom-broadcast-input"
              v-model="broadcastText"
              class="teacher-input"
              type="text"
              name="classroom-broadcast"
              autocomplete="off"
              :aria-label="selectedStudent ? `对 ${selectedStudent.name} 说话` : '面向全班广播'"
              :placeholder="selectedStudent ? `对 ${selectedStudent.name} 说...` : '输入要面向全班广播的内容…'"
              @keydown.enter.prevent="onBroadcast()"
            />
            <button
              class="broadcast-btn"
              type="button"
              @click="onBroadcast()"
            >
              {{
                workflowBusy
                  ? `发送排队中（${queuedSendCount}）`
                  : queuedSendCount > 0
                    ? `发送（队列 ${queuedSendCount}）`
                    : '发送'
              }}
            </button>
            <button
              class="broadcast-btn broadcast-btn--class"
              type="button"
              @click="onBroadcastClass"
            >
              广播
            </button>
          </div>
        </footer>
      </div>
      </section>

      <aside class="console classroom-panel classroom-panel--dash" aria-label="课堂控制台">
  <div class="panel panel--emotion">
    <div class="panel-title">课堂情绪看板</div>
    <div class="panel-body emotion-panel-body">
      <div class="emotion-avg-block">
        <div class="emotion-avg-heading">
          <img src="/icons/emotion-avg.png" style="width: 36px; height: 36px; vertical-align: -2px; margin-right: 6px; object-fit: contain;" aria-hidden="true" /> 三人格情绪均值
        </div>
        <p class="emotion-avg-hint">以下为李大志、张一鸣、林暖暖三人当前愉悦度 / 激活度 / 焦虑度的算术平均（0–100）。</p>
        
        <div
          v-for="dim in EMOTION_DIMS"
          :key="dim.key"
          class="emotion-bar-row"
        >
          <span class="emotion-bar-label">{{ dim.label }}</span>
          <div class="emotion-bar-track">
            <div
              class="emotion-bar-fill"
              :style="{
                width: Math.min(100, classAverageEmotion[dim.key] || 0) + '%',
                background: dim.color
              }"
            />
          </div>
          <span class="emotion-bar-val">{{ Math.round(classAverageEmotion[dim.key] || 0) }}</span>
        </div>
        </div>
          <div class="emotion-per-student">
            <div
              v-for="row in emotionStudentRows"
              :key="row.id"
              class="emotion-student-row"
            >
              <img
                class="emotion-student-avatar-img"
                :class="{ 'emotion-student-avatar-img--dazhi': row.id === 'dazhi' }"
                :src="row.avatar"
                :alt="row.name"
                aria-hidden="true"
              />
              <div class="emotion-student-info">
                <div class="emotion-student-name">{{ row.name }}</div>
                <div class="emotion-student-mini">
                  愉悦 {{ Math.round(row.joy) }} · 激活 {{ Math.round(row.activation) }} · 焦虑
                  {{ Math.round(row.anxiety) }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="panel panel--events">
        <div class="panel-title">课堂事件记录</div>
        <div class="proactive-debug-tools">
          <div class="proactive-debug-row">
            <label for="proactive-interval-input" class="proactive-debug-label">轮询(s)</label>
            <input
              id="proactive-interval-input"
              v-model.number="proactiveIntervalSec"
              class="proactive-debug-input"
              type="number"
              min="5"
              max="300"
              step="1"
            />
            <button class="proactive-debug-btn" type="button" @click="applyProactiveSettings">
              应用
            </button>
          </div>
          <div class="proactive-debug-row">
            <button
              class="proactive-debug-btn"
              type="button"
              :class="{ 'is-active': proactiveEnabled }"
              @click="toggleProactivePolling"
            >
              {{ proactiveEnabled ? '停止轮询' : '开启轮询' }}
            </button>
            <button class="proactive-debug-btn test" type="button" @click="sendProactiveTick({ fromManual: true })">
              测试主动会话
            </button>
          </div>
        </div>
        <div class="classroom-report-strip">
          <button
            type="button"
            class="classroom-report-btn classroom-report-btn--panel"
            :disabled="reportBusy"
            :title="reportBusy ? '报告生成中，请稍候…' : '结束本节课并生成训练报告'"
            @click="requestTrainingReport"
          >
            <img src="/icons/report.png" style="width: 36px; height: 36px; vertical-align: -4px; margin-right: 2px; object-fit: contain;" aria-hidden="true" /> 结束 · 生成报告
          </button>
          <p class="classroom-report-strip__hint">仅在课堂模拟内可用；专项模拟与文档分析侧栏不再提供此入口。</p>
        </div>
        <div class="panel-body event-list">
          <div
            v-for="ev in classroomEvents"
            :key="ev.id"
            class="event-item"
            :data-kind="ev.kind"
          >
            <div class="event-meta">
              <span class="event-time">{{ formatEvtTime(ev.ts) }}</span>
              <span class="event-badge">{{ eventKindLabel(ev.kind) }}</span>
            </div>
            <div class="event-title">{{ ev.title }}</div>
            <div v-if="ev.detail" class="event-detail">{{ ev.detail }}</div>
          </div>
        </div>
      </div>
      </aside>
    </div>

    <nav class="mobile-tabbar" aria-label="课堂视图切换">
      <button
        type="button"
        class="mobile-tabbar__btn"
        :class="{ 'is-active': mobileActivePanel === 'chat' }"
        @click="mobileActivePanel = 'chat'"
      >
        💬 对话
      </button>
      <button
        type="button"
        class="mobile-tabbar__btn"
        :class="{ 'is-active': mobileActivePanel === 'dashboard' }"
        @click="mobileActivePanel = 'dashboard'"
      >
        📊 数据
      </button>
    </nav>
  </div>
</template>

<style>
.classroom-sim {
  height: 100vh;
  width: 100vw;
  display: flex;
  overflow: hidden;
  background: #F4F6F9;
  color: #2d3436;
  /* 避免全局 :root 的 color-scheme: light dark 在系统深色模式下把原生 input 变成“暗色控件”，导致文字与背景对比度极差 */
  color-scheme: light;
}

/* 桌面端：classroom-shell 使用标准左右并排（不走移动双页） */
.classroom-panels {
  flex: 1;
  min-height: 0;
  width: 100%;
  display: flex;
}

.classroom-panel {
  min-height: 0;
}

.stage {
  width: 70%;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 18px 18px 0;
  box-sizing: border-box;
  background: #F4F6F9;
}

.console {
  width: 30%;
  min-width: 300px;
  height: 100%;
  min-height: 0;
  padding: 18px;
  box-sizing: border-box;
  background: #f4f5f7;
  border-left: 1px solid rgba(45, 52, 54, 0.12);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.podium {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-radius: 8px;
  background: #FFFFFF;
  border: 1px solid #E5E7EB;
  color: #374151;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}

.podium-title {
  font-weight: 800;
  letter-spacing: 0.2px;
}

.podium-subtitle {
  margin-top: 4px;
  font-size: 12px;
  color: rgba(55, 65, 81, 0.7);
}

.pill {
  display: inline-flex;
  align-items: center;
  padding: 7px 10px;
  border-radius: 999px;
  background: rgba(55, 65, 81, 0.08);
  border: 1px solid rgba(55, 65, 81, 0.12);
  color: rgba(55, 65, 81, 0.9);
  font-size: 12px;
}

.podium-right {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.classroom-report-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid rgba(0, 0, 0, 0.35);
  background: linear-gradient(180deg, #5c2a32, #3d1b22);
  color: #ff6b45;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.classroom-report-btn:hover:not(:disabled) {
  filter: brightness(1.06);
}

.classroom-report-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.classroom-report-strip {
  padding: 10px 14px 12px;
  border-bottom: 1px solid rgba(45, 52, 54, 0.08);
  background: #fafafa;
}

.classroom-report-btn--panel {
  width: 100%;
  box-sizing: border-box;
}

.classroom-report-strip__hint {
  margin: 8px 0 0;
  font-size: 11px;
  line-height: 1.4;
  color: rgba(45, 52, 54, 0.52);
}

.seating-area {
  flex: 1 1 auto;
  min-height: 0;
  padding: 16px 6px 96px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
}

.conversation-card {
  background: #FFFFFF;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  padding: 24px;
  margin: 0 6px 18px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.classroom-dialog-feed {
  flex: 0 0 auto;
  margin: 0;
  padding: 0;
  border-radius: 0;
  background: transparent;
  border: none;
  box-shadow: none;
  max-height: clamp(96px, 18vh, 190px);
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}

.dialog-feed-empty {
  font-size: 12px;
  color: rgba(45, 52, 54, 0.55);
}

.dialog-feed-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dialog-feed-item {
  display: grid;
  grid-template-columns: 64px 1fr;
  gap: 4px 10px;
  align-items: start;
  font-size: 12px;
  line-height: 1.35;
}

.dialog-feed-time {
  color: rgba(45, 52, 54, 0.55);
  font-variant-numeric: tabular-nums;
}

.dialog-feed-title {
  font-weight: 800;
  color: rgba(26, 29, 35, 0.92);
}

.dialog-feed-detail {
  grid-column: 2 / -1;
  color: rgba(26, 29, 35, 0.82);
  white-space: pre-wrap;
  word-break: break-word;
}

.dialog-feed-item[data-kind='feedback'] .dialog-feed-title {
  color: rgba(52, 152, 219, 0.96);
}

.dialog-feed-item[data-kind='system'] .dialog-feed-title {
  color: rgba(142, 153, 164, 0.96);
}

.seating-grid {
  width: 100%;
  max-width: min(960px, 98vw);
  display: grid;
  grid-template-columns: repeat(3, minmax(128px, 1fr));
  grid-template-rows: auto;
  gap: clamp(16px, 4vw, 36px);
  align-items: end;
  justify-items: center;
  margin: 0 auto;
  padding: 0 clamp(8px, 2vw, 20px);
  box-sizing: border-box;
}

.student-seat {
  position: relative;
  width: 100%;
  max-width: 280px;
  background: transparent;
  border: none;
  box-shadow: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding: 6px 4px 12px;
  box-sizing: border-box;
  cursor: pointer;
  outline: none;
  transition: transform 0.15s ease;
}

.student-seat:hover {
  transform: translateY(-3px);
}

.student-seat:focus-visible .student-desk {
  box-shadow: 0 0 0 4px rgba(219, 200, 172, 0.55), 0 14px 24px rgba(45, 52, 54, 0.16);
}

.student-body {
  position: relative;
  width: 100%;
  display: flex;
  justify-content: center;
  padding-top: 6px;
  padding-bottom: 16px;
  /* 高于 .student-desk(2)，否则头顶气泡会被课桌/名牌裁在底下 */
  z-index: 5;
}

.student-avatar {
  flex: 0 0 auto;
  width: 68px;
  height: 68px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2.5rem;
  background: radial-gradient(circle at 30% 25%, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0.08));
  filter: drop-shadow(0 10px 10px rgba(0, 0, 0, 0.12));
  z-index: 1;
}

.student-desk {
  position: relative;
  width: 100%;
  max-width: 240px;
  min-height: 88px;
  height: auto;
  margin-top: -28px;
  padding: 12px 10px 14px;
  border-radius: 14px;
  background: linear-gradient(180deg, #c19a6b, #a67b5b);
  border: 1px solid rgba(94, 61, 40, 0.35);
  box-shadow: 0 12px 22px rgba(45, 52, 54, 0.18);
  overflow: visible;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.student-seat::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 64px;
  transform: translateX(-50%);
  width: min(210px, 100%);
  height: 18px;
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.08);
  filter: blur(8px);
  z-index: 0;
  pointer-events: none;
}

.student-desk::before {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  top: 10px;
  height: 2px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.35);
}

.student-desk::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 14px;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.18));
  pointer-events: none;
}

.student-desk.selected {
  box-shadow: 0 0 0 3px rgba(212, 175, 55, 0.75), 0 14px 26px rgba(45, 52, 54, 0.22);
}

.desk-nameplate {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(45, 52, 54, 0.14);
  box-shadow: 0 10px 14px rgba(45, 52, 54, 0.12);
  box-sizing: border-box;
}

.desk-nameplate--stacked {
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 8px;
  padding: 10px 8px;
}

.nameplate-name {
  font-weight: 900;
  letter-spacing: 0.2px;
  font-size: 13px;
  color: rgba(45, 52, 54, 0.9);
  line-height: 1.25;
  word-break: keep-all;
  white-space: normal;
  max-width: 100%;
}

.nameplate-status {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.2px;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid rgba(45, 52, 54, 0.12);
  background: rgba(255, 255, 255, 0.9);
  color: rgba(45, 52, 54, 0.82);
  line-height: 1.2;
  white-space: normal;
  text-align: center;
  max-width: 100%;
}

.nameplate-status[data-tone='focus'] {
  border-color: rgba(46, 125, 50, 0.35);
  background: rgba(76, 175, 80, 0.15);
  color: rgba(46, 125, 50, 0.95);
}

.nameplate-status[data-tone='distracted'] {
  border-color: rgba(239, 108, 0, 0.4);
  background: rgba(255, 152, 0, 0.16);
  color: rgba(239, 108, 0, 0.95);
}

.nameplate-status[data-tone='confused'] {
  border-color: rgba(63, 81, 181, 0.35);
  background: rgba(63, 81, 181, 0.14);
  color: rgba(63, 81, 181, 0.95);
}

.nameplate-status[data-tone='neutral'] {
  border-color: rgba(45, 52, 54, 0.18);
  background: rgba(45, 52, 54, 0.06);
  color: rgba(45, 52, 54, 0.8);
}

.speech-bubble {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 6px);
  transform: translateX(-50%);
  width: min(240px, calc(100% + 88px));
  pointer-events: none;
  z-index: 10;
}

.speech-bubble-inner {
  border-radius: 14px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(45, 52, 54, 0.12);
  box-shadow: 0 14px 30px rgba(45, 52, 54, 0.12);
  font-size: 12px;
  color: rgba(45, 52, 54, 0.78);
  text-align: center;
}

.speech-tail {
  width: 0;
  height: 0;
  margin: -1px auto 0;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-top: 8px solid rgba(255, 255, 255, 0.95);
  filter: drop-shadow(0 2px 0 rgba(45, 52, 54, 0.12));
}

/* 智能体回复：角色头顶气泡 */
.speech-bubble--reply {
  width: min(340px, calc(100vw - 32px));
  max-width: min(340px, calc(100% + 140px));
  z-index: 20;
  animation: speech-bubble-pop 0.32s cubic-bezier(0.34, 1.45, 0.64, 1);
}

@keyframes speech-bubble-pop {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(10px) scale(0.94);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0) scale(1);
  }
}

.speech-bubble-inner--reply {
  text-align: left;
  max-height: 112px;
  overflow-x: hidden;
  overflow-y: auto;
  font-size: 12px;
  line-height: 1.35;
  color: rgba(45, 52, 54, 0.92);
  padding: 8px 12px;
  border-radius: 14px;
  background: linear-gradient(165deg, #ffffff 0%, #f4f7fb 100%);
  border: 1px solid rgba(45, 52, 54, 0.1);
  box-shadow:
    0 2px 8px rgba(45, 52, 54, 0.06),
    0 14px 32px rgba(45, 52, 54, 0.14);
  -webkit-overflow-scrolling: touch;
}

.speech-bubble--streaming .speech-bubble-inner--reply {
  border-color: rgba(46, 125, 50, 0.32);
  box-shadow:
    0 2px 10px rgba(46, 125, 50, 0.1),
    0 12px 28px rgba(45, 52, 54, 0.12);
}

.speech-bubble-text {
  display: block;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.speech-bubble-cursor {
  display: inline-block;
  width: 2px;
  height: 1.05em;
  margin-left: 3px;
  vertical-align: -0.15em;
  background: rgba(39, 174, 96, 0.9);
  border-radius: 1px;
  animation: speech-cursor-blink 0.9s step-end infinite;
}

@keyframes speech-cursor-blink {
  50% {
    opacity: 0;
  }
}

.speech-bubble--reply .speech-tail {
  border-top-color: #f4f7fb;
  filter: drop-shadow(0 2px 0 rgba(45, 52, 54, 0.1));
}

.teacher-bar {
  flex: 0 0 auto;
  padding: 0;
  background: transparent;
  backdrop-filter: none;
}

.workflow-stream-preview {
  margin-bottom: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(46, 125, 50, 0.25);
  font-size: 12px;
  max-height: 100px;
  overflow-y: auto;
}

.workflow-stream-label {
  display: block;
  font-weight: 800;
  color: rgba(46, 125, 50, 0.95);
  margin-bottom: 4px;
}

.workflow-stream-text {
  color: rgba(45, 52, 54, 0.85);
  white-space: pre-wrap;
  word-break: break-word;
}

.teacher-input-wrap {
  display: flex;
  gap: 10px;
  padding: 12px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(45, 52, 54, 0.1);
  box-shadow: 0 12px 30px rgba(45, 52, 54, 0.08);
}

.broadcast-btn:disabled {
  opacity: 0.72;
  cursor: not-allowed;
}

.teacher-input {
  flex: 1;
  min-width: 0;
  border-radius: 12px;
  border: 1px solid rgba(45, 52, 54, 0.16);
  background: #ffffff;
  padding: 11px 12px;
  outline: none;
  font-size: 16px;
  line-height: 1.4;
  /* 原生 input 不一定继承父级 color，与全局深色方案叠加时易出现“看不见的字” */
  color: #1a1d23;
  caret-color: #2a4b3c;
  -webkit-text-fill-color: #1a1d23;
}

.teacher-input::placeholder {
  color: rgba(45, 52, 54, 0.45);
  opacity: 1;
}

.teacher-input:focus {
  border-color: rgba(125, 104, 78, 0.55);
  box-shadow: 0 0 0 4px rgba(219, 200, 172, 0.35);
}

.broadcast-btn {
  flex: 0 0 auto;
  border: none;
  border-radius: 12px;
  padding: 10px 14px;
  background: linear-gradient(180deg, #6d4c41, #5d4037);
  color: #fff;
  font-weight: 700;
  letter-spacing: 0.2px;
  cursor: pointer;
}

.broadcast-btn:hover {
  filter: brightness(1.04);
}

.broadcast-btn--class {
  background: linear-gradient(180deg, #1565c0, #0d47a1);
}

.panel {
  border-radius: 14px;
  background: #ffffff;
  border: 1px solid rgba(45, 52, 54, 0.1);
  box-shadow: 0 10px 24px rgba(45, 52, 54, 0.06);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.panel-title {
  padding: 12px 14px;
  font-weight: 800;
  background: linear-gradient(180deg, #ffffff, #fafafa);
  border-bottom: 1px solid rgba(45, 52, 54, 0.08);
}

.proactive-debug-tools {
  padding: 10px 14px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.proactive-debug-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.proactive-debug-label {
  font-size: 11px;
  color: rgba(45, 52, 54, 0.62);
  white-space: nowrap;
}

.proactive-debug-input {
  width: 72px;
  height: 30px;
  border: 1px solid rgba(45, 52, 54, 0.18);
  border-radius: 8px;
  padding: 0 8px;
  font-size: 12px;
}

.proactive-debug-btn {
  height: 30px;
  padding: 0 10px;
  border: 1px solid rgba(45, 52, 54, 0.18);
  border-radius: 8px;
  background: #fff;
  color: #2d3436;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.proactive-debug-btn.is-active {
  border-color: rgba(231, 76, 60, 0.35);
  background: rgba(231, 76, 60, 0.1);
  color: #c0392b;
}

.proactive-debug-btn.test {
  border-color: rgba(52, 152, 219, 0.35);
  background: rgba(52, 152, 219, 0.1);
  color: #1f78c8;
}

.panel-body {
  padding: 12px 14px;
  min-height: 0;
}

.panel--emotion {
  flex: 0 0 auto;
}

.panel--events {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.panel--events .panel-body.event-list {
  flex: 1 1 auto;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.emotion-panel-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.emotion-avg-block {
  padding: 10px 10px 12px;
  border-radius: 12px;
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
  border: 1px solid rgba(45, 52, 54, 0.08);
}

.emotion-avg-heading {
  font-weight: 800;
  font-size: 14px;
  color: #2d3436;
  margin-bottom: 6px;
}

.emotion-avg-hint {
  margin: 0 0 12px;
  font-size: 11px;
  line-height: 1.45;
  color: rgba(45, 52, 54, 0.55);
}

.emotion-bar-row {
  display: grid;
  grid-template-columns: 52px 1fr 28px;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.emotion-bar-row:last-child {
  margin-bottom: 0;
}

.emotion-bar-label {
  font-size: 11px;
  font-weight: 700;
  color: rgba(45, 52, 54, 0.72);
}

.emotion-bar-track {
  height: 8px;
  border-radius: 999px;
  background: rgba(45, 52, 54, 0.08);
  overflow: hidden;
}

.emotion-bar-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.35s ease;
}

.emotion-bar-val {
  font-size: 11px;
  font-weight: 800;
  color: #2d3436;
  text-align: right;
}

.emotion-per-student {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.emotion-student-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 12px;
  background: #f7f8fa;
  border: 1px solid rgba(45, 52, 54, 0.08);
}

.emotion-student-avatar {
  font-size: 1.75rem;
  line-height: 1;
  flex-shrink: 0;
}

.emotion-student-name {
  font-weight: 800;
  font-size: 13px;
  color: #2d3436;
}

.emotion-student-mini {
  margin-top: 2px;
  font-size: 11px;
  color: rgba(45, 52, 54, 0.62);
  line-height: 1.35;
}

.event-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-bottom: 4px;
}

.event-item {
  padding: 10px 11px;
  border-radius: 12px;
  background: #f7f8fa;
  border: 1px solid rgba(45, 52, 54, 0.08);
}

.event-item[data-kind='dialog'] {
  background: rgba(236, 239, 241, 0.9);
  border-color: rgba(69, 90, 100, 0.15);
}

.event-item[data-kind='feedback'] {
  background: rgba(227, 242, 253, 0.72);
  border-color: rgba(25, 118, 210, 0.22);
}

.event-item[data-kind='system'] {
  background: rgba(255, 243, 224, 0.8);
  border-color: rgba(245, 124, 0, 0.22);
}

.event-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.event-time {
  font-size: 11px;
  color: rgba(45, 52, 54, 0.45);
  font-variant-numeric: tabular-nums;
}

.event-badge {
  font-size: 10px;
  font-weight: 800;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(45, 52, 54, 0.08);
  color: rgba(45, 52, 54, 0.75);
}

.event-item[data-kind='feedback'] .event-badge {
  background: rgba(25, 118, 210, 0.15);
  color: rgba(21, 101, 192, 0.95);
}

.event-title {
  font-size: 13px;
  font-weight: 800;
  color: #2d3436;
  line-height: 1.35;
}

.event-detail {
  margin-top: 6px;
  font-size: 12px;
  color: rgba(45, 52, 54, 0.72);
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 120px;
  overflow-y: auto;
}

/* 移动端：与专项模拟一致，底部 Tab 切两页（对话 / 数据） */
@media (max-width: 768px) {
  .classroom-shell {
    position: relative;
    flex-direction: column;
    height: 100%;
    width: 100%;
    max-width: 100vw;
    overflow: hidden;
  }

  .classroom-panels {
    flex: 1;
    min-height: 0;
    display: flex;
    width: 200%;
    transform: translateX(0);
    transition: transform 0.32s cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .classroom-shell--dash .classroom-panels {
    transform: translateX(-50%);
  }

  .classroom-panel {
    width: 50%;
    min-width: 50%;
    min-height: 0;
    box-sizing: border-box;
  }

  .stage {
    width: 100%;
    min-height: 0;
    padding: calc(10px + env(safe-area-inset-top, 0px)) 8px 0;
  }

  .podium {
    padding: 10px 10px;
    padding-left: 46px;
    border-radius: 12px;
    min-height: 74px;
    flex-wrap: wrap;
    gap: 8px;
  }

  .podium-right {
    width: 100%;
    justify-content: flex-start;
  }

  .classroom-report-btn {
    font-size: 12px;
    padding: 7px 12px;
  }

  .podium-title {
    font-size: 18px;
    line-height: 1.15;
  }

  .podium-subtitle {
    margin-top: 2px;
    font-size: 11px;
    line-height: 1.3;
  }

  .pill {
    padding: 6px 9px;
    font-size: 11px;
  }

  .console {
    width: 100%;
    min-width: 0;
    min-height: 0;
    padding: 12px;
    border-left: none;
    border-top: none;
    -webkit-overflow-scrolling: touch;
  }

  .proactive-debug-tools {
    padding: 8px 12px 0;
    gap: 6px;
  }

  .proactive-debug-row {
    gap: 6px;
    flex-wrap: wrap;
  }

  .proactive-debug-input {
    width: 64px;
    height: 28px;
  }

  .proactive-debug-btn {
    height: 28px;
    padding: 0 8px;
    font-size: 11px;
  }

  /* 小屏隐藏「课堂对话框」时间线，腾出空间给头像与头顶回复气泡 */
  .classroom-dialog-feed {
    display: none !important;
  }

  .seating-area {
    align-items: center;
    justify-content: center;
    padding: 44px 2px 12px;
  }

  .seating-grid {
    max-width: 100%;
    padding: 0 2px;
    gap: 22px 12px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: auto auto;
    align-items: start;
    justify-items: center;
    align-content: center;
  }

  .student-seat {
    max-width: none;
    padding: 6px 2px 8px;
  }

  /* 小屏三角布局：上两位、下一位居中 */
  .seating-grid .student-seat:nth-child(1) {
    grid-column: 1 !important;
    grid-row: 1 !important;
  }

  .seating-grid .student-seat:nth-child(2) {
    grid-column: 2 !important;
    grid-row: 1 !important;
  }

  .seating-grid .student-seat:nth-child(3) {
    grid-column: 1 / span 2 !important;
    grid-row: 2 !important;
    justify-self: center;
    margin-top: 4px;
  }

  .student-body {
    padding-top: 8px;
    padding-bottom: 12px;
  }

  .student-avatar {
    width: 78px;
    height: 78px;
    border-radius: 20px;
    font-size: 2.75rem;
  }

  .student-seat::before {
    top: 58px;
    width: 94%;
    height: 14px;
    filter: blur(6px);
  }

  .student-desk {
    max-width: 138px;
    min-height: 82px;
    margin-top: -22px;
    padding: 10px 7px 11px;
    border-radius: 12px;
  }

  .desk-nameplate--stacked {
    gap: 6px;
    padding: 7px 5px;
  }

  .nameplate-name {
    font-size: 13px;
    line-height: 1.25;
  }

  .nameplate-status {
    font-size: 11px;
    padding: 4px 7px;
  }

  /* 上排两人：气泡宽度不超过半屏，避免相互遮挡与超出屏幕 */
  .speech-bubble--reply {
    left: 50%;
    transform: translateX(-50%);
    width: min(300px, calc(50vw - 18px));
    max-width: calc(50vw - 18px);
    box-sizing: border-box;
  }

  .seating-grid .student-seat:nth-child(3) .speech-bubble--reply {
    width: min(360px, calc(100vw - 24px));
    max-width: calc(100vw - 24px);
  }

  .speech-bubble-inner--reply {
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    max-height: min(220px, 36vh);
    font-size: 13px;
    line-height: 1.45;
    padding: 10px 12px;
    overflow-x: hidden;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  .teacher-bar {
    padding: 8px 0 calc(70px + env(safe-area-inset-bottom, 0px));
    background: linear-gradient(180deg, rgba(246, 239, 225, 0.1) 0%, rgba(246, 239, 225, 0.95) 28%, rgba(246, 239, 225, 1) 100%);
  }

  .workflow-stream-preview {
    margin-bottom: 6px;
    padding: 8px 10px;
    font-size: 11px;
    max-height: 72px;
  }

  .teacher-input-wrap {
    gap: 6px;
    padding: 8px;
    border-radius: 12px;
  }

  .teacher-input {
    padding: 9px 10px;
    font-size: 14px;
    border-radius: 10px;
  }

  .broadcast-btn {
    height: 38px;
    padding: 0 12px;
    font-size: 13px;
    border-radius: 10px;
    white-space: nowrap;
  }

  .mobile-tabbar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 40;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px));
    background: rgba(255, 255, 255, 0.94);
    border-top: 1px solid rgba(45, 52, 54, 0.12);
    backdrop-filter: blur(8px);
  }

  .mobile-tabbar__btn {
    height: 42px;
    border-radius: 12px;
    border: 1px solid rgba(45, 52, 54, 0.14);
    background: #fff;
    color: #2d3436;
    font-weight: 700;
  }

  .mobile-tabbar__btn.is-active {
    border-color: rgba(52, 152, 219, 0.38);
    background: rgba(52, 152, 219, 0.12);
    color: #1f78c8;
  }
}

@media (min-width: 769px) {
  .mobile-tabbar {
    display: none;
  }
}

.student-avatar-img {
  width: 68px;
  height: 68px;
  border-radius: 20px;
  object-fit: cover;
  object-position: center;
  filter: drop-shadow(0 10px 10px rgba(0, 0, 0, 0.12));
  z-index: 1;
}

.student-avatar-img--dazhi,
.emotion-student-avatar-img--dazhi {
  object-position: 50% 25%;
}

.emotion-student-avatar-img {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  object-fit: cover;
  object-position: center;
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .student-avatar-img {
    width: 78px;
    height: 78px;
  }
}

/* ... 上面是你原本的几百行 CSS，完全不要动它们 ... */

@media (max-width: 768px) {
  .student-avatar-img {
    width: 78px;
    height: 78px;
  }
}

/* ===== V2 Override: 沉浸式现代课堂 (Modern Classroom) ===== */

/* 1. 黑板隐喻：将顶部讲台变身“高级哑光黑板” */
.podium {
  background: #2C3A35 !important; /* 沉稳的高级墨绿色 */
  border: none !important;
  color: #E8F0ED !important;
  box-shadow: 0 8px 24px rgba(44, 58, 53, 0.15) !important;
}
.podium-title { color: #FFFFFF !important; }
.podium-subtitle { color: #A0B2AB !important; }
.podium .pill {
  background: rgba(255, 255, 255, 0.12) !important;
  color: #FFFFFF !important;
  border: 1px solid rgba(255, 255, 255, 0.2) !important;
}
/* 黑板上的按钮做成粉笔白半透明质感 */
.classroom-report-btn {
  background: rgba(255, 255, 255, 0.15) !important;
  border: 1px solid rgba(255, 255, 255, 0.4) !important;
  color: #FFFFFF !important;
  box-shadow: none !important;
}

/* 2. 课桌隐喻：摒弃土气渐变，使用“北欧原木色”扁平设计 */
.student-desk {
  background: #FDFBF7 !important; /* 极浅的暖纸色/木底色 */
  border: 1px solid #EAE3D9 !important;
  border-bottom: 4px solid #C19A6B !important; /* 扁平的高级原木色底边 */
  border-radius: 12px !important;
  box-shadow: 0 8px 16px rgba(193, 154, 107, 0.08) !important;
  transition: all 0.2s ease !important;
}
.student-desk::before, .student-desk::after { 
  content: none !important; 
}
/* 选中学生时，课桌的原木色加深，并有轻微浮起感 */
.student-seat:focus-visible .student-desk,
.student-desk.selected {
  border-color: #A67B5B !important;
  border-bottom-color: #8B5A2B !important; 
  box-shadow: 0 0 0 3px rgba(193, 154, 107, 0.25), 0 12px 24px rgba(193, 154, 107, 0.15) !important;
  transform: translateY(-2px);
}

/* 3. 保留情绪进度条的莫兰迪语义色 (保持专业数据的克制感) */
.emotion-bar-track { background: var(--app-bg-muted) !important; }
.emotion-bar-fill { background: var(--app-color-primary) !important; }
.emotion-avg-block .emotion-bar-row:nth-of-type(2) .emotion-bar-fill { background: var(--app-color-pleasure) !important; }
.emotion-avg-block .emotion-bar-row:nth-of-type(3) .emotion-bar-fill { background: var(--app-color-primary) !important; }
.emotion-avg-block .emotion-bar-row:nth-of-type(4) .emotion-bar-fill { background: var(--app-color-anxiety) !important; }

/* 4. 右侧/下方常规操作按钮统一归回 B2B 主色 */
.classroom-report-btn--panel, .broadcast-btn, .broadcast-btn--class {
  background: var(--app-color-primary) !important;
  border: 1px solid var(--app-color-primary) !important;
  color: var(--app-bg-panel) !important;
  box-shadow: none !important;
}
.classroom-report-btn--panel:hover:not(:disabled),
.broadcast-btn:hover:not(:disabled),
.broadcast-btn--class:hover:not(:disabled) {
  filter: brightness(0.96) !important;
}

</style>

