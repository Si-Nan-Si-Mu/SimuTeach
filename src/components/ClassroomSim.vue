<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { deepExtractAssistantDialogFromObject, normalizeAssistantDialogText } from '../extractCompletionDialog.js'

/** 与左侧专项模拟 SideBar 中三个人格一致（id 便于工作流区分对象） */
const students = ref([
  {
    id: 'dazhi',
    name: '李大志',
    personality: '习得性无助',
    row: 0,
    col: 0,
    avatar: '😔'
  },
  {
    id: 'yiming',
    name: '张一鸣',
    personality: '调皮捣蛋',
    row: 0,
    col: 1,
    avatar: '😎'
  },
  {
    id: 'xiaorou',
    name: '林暖暖',
    personality: '乖巧敏感',
    row: 0,
    col: 2,
    avatar: '🥺'
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
/** 主动轮询定时器（每 30s） */
let proactiveTimer = null
const proactiveIntervalSec = ref(30)
const proactiveEnabled = ref(false)

/** 本轮回复气泡应挂在哪些学生头上（单人对话 1 个；全班广播用中间位「代表」展示，避免三重复制） */
const lastReplyTargets = ref([])
/** 头顶气泡：与 lastReplyTargets 对应学生显示 */
const replyBubble = ref({
  text: '',
  streaming: false,
  studentIds: []
})

const bubbleVisibleFor = (studentId) => {
  const ids = replyBubble.value.studentIds
  if (!Array.isArray(ids) || !ids.includes(studentId)) return false
  return !!(replyBubble.value.text || replyBubble.value.streaming)
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

function buildDirectClassroomBody(content = '', proactive = true, apiKey = '') {
  return {
    model: selectedStudent.value?.name || '李大志',
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

function extractProactiveReplyOnly(obj) {
  if (!obj || typeof obj !== 'object') return ''
  if (hasIndChoiceMarker(obj)) return ''
  const xPro = obj['x-proactive'] ?? obj.x_proactive ?? obj?.payload?.['x-proactive'] ?? obj?.payload?.x_proactive
  if (xPro == null) return ''
  let text = ''
  if (typeof xPro === 'string') {
    text = xPro
  } else if (xPro && typeof xPro === 'object') {
    text = pickDialogFromAny(xPro) || ''
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

async function parseDirectClassroomResponse(res) {
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
    if (!text) return ''
    try {
      const j = JSON.parse(text)
      const out = extractProactiveReplyOnly(j)
      if (typeof window !== 'undefined' && window.console) {
        console.log('[ClassroomProactive] 非SSE解析结果', {
          extractedLen: out.length,
          extractedPreview: out.slice(0, 120),
          accepted: !!out
        })
      }
      return out
    } catch {
      // 非 JSON 或不含 x-proactive，一律不展示
      const out = ''
      if (typeof window !== 'undefined' && window.console) {
        console.log('[ClassroomProactive] 非SSE文本净化结果', {
          extractedLen: out.length,
          extractedPreview: out.slice(0, 120)
        })
      }
      return out
    }
  }

  if (!res.body) return ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let finalText = ''
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
            // 主动轮询场景：仅接受可解析 JSON 且含 x-proactive 的响应
            continue
          }
          const payload = j && j.payload != null ? j.payload : j
          const s = extractProactiveReplyOnly(payload) || extractProactiveReplyOnly(j)
          if (s) finalText = s
        }
      }
    }
  }
  if (typeof window !== 'undefined' && window.console) {
    console.log('[ClassroomProactive] SSE解析完成', {
      extractedLen: finalText.length,
      extractedPreview: finalText.slice(0, 120)
    })
  }
  return finalText.trim()
}

async function callClassroomBackendDirect({ proactive = true, content = '' } = {}) {
  const reportInj =
    typeof window !== 'undefined' && window.__REPORT_WORKFLOW_INJECT__ && typeof window.__REPORT_WORKFLOW_INJECT__ === 'object'
      ? window.__REPORT_WORKFLOW_INJECT__
      : null
  const url = String(reportInj?.httpUrl || '').trim()
  const apiKey = String(reportInj?.httpApiKey || '').trim()
  if (!url) {
    throw new Error('课堂直连后端地址未配置（请设置 VITE_REPORT_HTTP_URL）')
  }
  const body = buildDirectClassroomBody(content, proactive, apiKey)
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
    Accept: 'application/json, text/event-stream; charset=utf-8'
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
  const parsed = await parseDirectClassroomResponse(res)
  if (typeof window !== 'undefined' && window.console) {
    console.log('[ClassroomProactive] 返回提炼文本', {
      len: parsed.length,
      preview: parsed.slice(0, 120)
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

const onBroadcast = async () => {
  const t = broadcastText.value.trim()
  if (!t) return
  const prefix = selectedStudent.value ? `教师对 ${selectedStudent.value.name}：` : '教师广播：'
  const teacherLine = `${prefix}${t}`
  pushClassroomEvent('dialog', '教师发言', teacherLine)
  if (selectedStudent.value) {
    nudgeEmotionForStudents([selectedStudent.value.id], { joy: 2, activation: 3, anxiety: -2 })
  } else {
    nudgeEmotionForAll({ joy: 1, activation: 2, anxiety: -1 })
  }
  broadcastText.value = ''

  const wf = typeof window !== 'undefined' ? window.WorkflowClient : null
  const cfg = typeof window !== 'undefined' ? window.CLASSROOM_WORKFLOW_CONFIG : null
  const hasKey = !!(cfg && cfg.botAppKey)
  if (!wf || typeof wf.sendClassroomBroadcast !== 'function' || !hasKey) {
    if (typeof window !== 'undefined' && window.console) {
      console.info(
        '[ClassroomWorkflow] 已跳过工作流：',
        !hasKey ? '未配置 VITE_CLASSROOM_BOT_APP_KEY（.env.local）' : 'WorkflowClient 不可用'
      )
    }
    return
  }

  workflowBusy.value = true
  workflowStreamPreview.value = ''
  lastReplyTargets.value = selectedStudent.value
    ? [selectedStudent.value.id]
    : ['yiming']
  replyBubble.value = {
    text: '',
    streaming: true,
    studentIds: [...lastReplyTargets.value]
  }
  try {
    const payloadText = `{课堂}${teacherLine}`
    const text = await wf.sendClassroomBroadcast(classroomSessionId.value, payloadText, {
      broadcastScope: selectedStudent.value ? 'student' : 'class',
      targetStudentId: selectedStudent.value?.id || '',
      targetStudentName: selectedStudent.value?.name || '',
      proactive: false
    })
    if (text) {
      replyBubble.value = { text, streaming: false, studentIds: [...lastReplyTargets.value] }
      const names = lastReplyTargets.value
        .map((id) => students.value.find((s) => s.id === id)?.name)
        .filter(Boolean)
        .join('、')
      pushClassroomEvent('feedback', names ? `学生反馈（${names}）` : '学生反馈（课堂）', text)
      nudgeEmotionForStudents(lastReplyTargets.value, { joy: 4, activation: 3, anxiety: -4 })
    } else {
      replyBubble.value = { text: '', streaming: false, studentIds: [] }
    }
  } catch (e) {
    const msg = e && e.message ? e.message : String(e)
    pushClassroomEvent('system', '课堂请求失败', msg)
    replyBubble.value = { text: '', streaming: false, studentIds: [] }
  } finally {
    workflowBusy.value = false
    workflowStreamPreview.value = ''
    const b = replyBubble.value
    if (b.streaming) {
      if (!b.text) {
        replyBubble.value = { text: '', streaming: false, studentIds: [] }
      } else {
        replyBubble.value = { ...b, streaming: false }
      }
    }
  }
}

/** 主动轮询：每 30s 直连课堂后端发空内容，并携带 proactive=true */
const sendProactiveTick = async ({ fromManual = false } = {}) => {
  if (workflowBusy.value) return
  workflowBusy.value = true
  workflowStreamPreview.value = ''
  // 课堂主动轮询默认按全班代表展示在中间位
  lastReplyTargets.value = ['yiming']
  replyBubble.value = {
    text: '',
    streaming: true,
    studentIds: [...lastReplyTargets.value]
  }
  pushClassroomEvent(
    'system',
    fromManual ? '主动会话调试' : '主动轮询',
    '已直连后端发送 proactive=true 空内容请求。'
  )

  try {
    const text = await callClassroomBackendDirect({ proactive: true, content: '' })
    if (text) {
      replyBubble.value = { text, streaming: false, studentIds: [...lastReplyTargets.value] }
      const names = lastReplyTargets.value
        .map((id) => students.value.find((s) => s.id === id)?.name)
        .filter(Boolean)
        .join('、')
      pushClassroomEvent('feedback', names ? `学生反馈（${names}）` : '学生反馈（课堂）', text)
      nudgeEmotionForStudents(lastReplyTargets.value, { joy: 4, activation: 3, anxiety: -4 })
    } else {
      replyBubble.value = { text: '', streaming: false, studentIds: [] }
    }
  } catch (e) {
    const msg = e && e.message ? e.message : String(e)
    pushClassroomEvent('system', '主动会话失败', msg)
    replyBubble.value = { text: '', streaming: false, studentIds: [] }
  } finally {
    workflowBusy.value = false
    workflowStreamPreview.value = ''
    const b = replyBubble.value
    if (b.streaming) {
      if (!b.text) {
        replyBubble.value = { text: '', streaming: false, studentIds: [] }
      } else {
        replyBubble.value = { ...b, streaming: false }
      }
    }
  }
}

onMounted(() => {
  if (typeof window === 'undefined') return
  window.ClassroomWorkflowHooks = {
    onDelta(accumulatedText) {
      const t = normalizeAssistantDialogText(accumulatedText || '')
      workflowStreamPreview.value = t
      replyBubble.value = {
        text: t,
        streaming: true,
        studentIds: [...(lastReplyTargets.value.length ? lastReplyTargets.value : replyBubble.value.studentIds)]
      }
      if (window.console && accumulatedText) {
        console.debug('[ClassroomWorkflow] 流式累计', (accumulatedText || '').length, '字')
      }
    },
    onFinalize(finalText, meta) {
      workflowStreamPreview.value = ''
      const text = normalizeAssistantDialogText((finalText || '').trim())
      const ids = lastReplyTargets.value.length ? [...lastReplyTargets.value] : [...replyBubble.value.studentIds]
      if (!text) {
        replyBubble.value = { text: '', streaming: false, studentIds: [] }
        return
      }
      replyBubble.value = { text, streaming: false, studentIds: ids }
      const names = ids
        .map((id) => students.value.find((s) => s.id === id)?.name)
        .filter(Boolean)
        .join('、')
      pushClassroomEvent('feedback', names ? `学生反馈（${names}）` : '学生反馈（课堂）', text)
      nudgeEmotionForStudents(ids, { joy: 4, activation: 3, anxiety: -4 })
      console.info('[ClassroomWorkflow] 本轮回复完成，长度', text.length)
    },
    onSystem(msg) {
      const m = String(msg || '')
      pushClassroomEvent('system', '系统提示', m)
      console.warn('[ClassroomWorkflow]', m)
    },
  }

  proactiveEnabled.value = true
  proactiveIntervalSec.value = clampProactiveInterval(proactiveIntervalSec.value)
  restartProactiveTimer()
})

onBeforeUnmount(() => {
  if (proactiveTimer) {
    clearInterval(proactiveTimer)
    proactiveTimer = null
  }
  if (typeof window !== 'undefined' && window.ClassroomWorkflowHooks) {
    window.ClassroomWorkflowHooks = null
  }
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
          <div class="podium-title">🧑‍🏫 老师讲台</div>
          <div class="podium-subtitle">虚拟座位表（专项模拟 · 三人格三角布局）</div>
        </div>
        <div class="podium-right">
          <span class="pill">{{
            selectedStudent ? `当前：${selectedStudent.name}` : '当前：全班视角'
          }}</span>
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
                :class="{ 'speech-bubble--streaming': replyBubble.streaming }"
                role="status"
                :aria-label="replyBubble.streaming ? '智能体正在生成回复' : '智能体回复'"
              >
                <div class="speech-bubble-inner speech-bubble-inner--reply">
                  <span class="speech-bubble-text">{{ replyBubble.text || (replyBubble.streaming ? '…' : '') }}</span>
                  <span v-if="replyBubble.streaming" class="speech-bubble-cursor" aria-hidden="true" />
                </div>
                <div class="speech-tail" />
              </div>

              <div class="student-avatar" aria-hidden="true">{{ s.avatar }}</div>
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
            :disabled="workflowBusy"
            :aria-label="selectedStudent ? `对 ${selectedStudent.name} 说话` : '面向全班广播'"
            :placeholder="selectedStudent ? `对 ${selectedStudent.name} 说...` : '输入要面向全班广播的内容…'"
            @keydown.enter.prevent="onBroadcast"
          />
          <button
            class="broadcast-btn"
            type="button"
            :disabled="workflowBusy"
            @click="onBroadcast"
          >
            {{ workflowBusy ? '工作流处理中…' : '发送（含工作流）' }}
          </button>
        </div>
      </footer>
      </section>

      <aside class="console classroom-panel classroom-panel--dash" aria-label="课堂控制台">
      <div class="panel panel--emotion">
        <div class="panel-title">课堂情绪看板</div>
        <div class="panel-body emotion-panel-body">
          <div class="emotion-avg-block">
            <div class="emotion-avg-heading">📊 三人格情绪均值</div>
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
              <span class="emotion-student-avatar" aria-hidden="true">{{ row.avatar }}</span>
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
  background: linear-gradient(180deg, #fbf6ea 0%, #f6efe1 60%, #f3ead8 100%);
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
  background: #f4f1ea;
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
  border-radius: 14px;
  background: linear-gradient(180deg, #2a4b3c, #1e392a);
  border: 1px solid rgba(0, 0, 0, 0.35);
  color: rgba(245, 245, 245, 0.95);
  box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.5), 0 10px 26px rgba(45, 52, 54, 0.12);
}

.podium-title {
  font-weight: 800;
  letter-spacing: 0.2px;
}

.podium-subtitle {
  margin-top: 4px;
  font-size: 12px;
  color: rgba(245, 245, 245, 0.78);
}

.pill {
  display: inline-flex;
  align-items: center;
  padding: 7px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.22);
  color: rgba(245, 245, 245, 0.92);
  font-size: 12px;
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
  z-index: 1;
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
  bottom: calc(100% + 8px);
  transform: translateX(-50%);
  width: min(180px, calc(100% + 48px));
  pointer-events: none;
  z-index: 5;
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
  width: min(280px, calc(100vw - 40px));
  max-width: min(280px, calc(100% + 100px));
  z-index: 8;
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
  max-height: 150px;
  overflow-x: hidden;
  overflow-y: auto;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(45, 52, 54, 0.92);
  padding: 12px 14px;
  border-radius: 18px;
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
  white-space: pre-wrap;
  word-break: break-word;
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
  position: sticky;
  bottom: 0;
  flex: 0 0 auto;
  padding: 12px 0 18px;
  background: linear-gradient(180deg, rgba(246, 239, 225, 0) 0%, rgba(246, 239, 225, 0.85) 30%, rgba(246, 239, 225, 1) 100%);
  backdrop-filter: blur(6px);
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

  .seating-area {
    align-items: center;
    justify-content: center;
    padding: 44px 2px 22px;
  }

  .seating-grid {
    max-width: 100%;
    padding: 0 2px;
    gap: 18px 10px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: auto auto;
    align-items: start;
    justify-items: center;
    align-content: center;
  }

  .student-seat {
    max-width: none;
    padding: 4px 2px 6px;
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
    padding-top: 6px;
    padding-bottom: 10px;
  }

  .student-avatar {
    width: 52px;
    height: 52px;
    border-radius: 16px;
    font-size: 2rem;
  }

  .student-seat::before {
    top: 46px;
    width: 94%;
    height: 12px;
    filter: blur(6px);
  }

  .student-desk {
    max-width: 116px;
    min-height: 76px;
    margin-top: -20px;
    padding: 8px 6px 10px;
    border-radius: 12px;
  }

  .desk-nameplate--stacked {
    gap: 5px;
    padding: 6px 4px;
  }

  .nameplate-name {
    font-size: 12px;
    line-height: 1.2;
  }

  .nameplate-status {
    font-size: 10px;
    padding: 4px 6px;
  }

  .speech-bubble--reply {
    width: min(220px, 84vw);
    max-width: 84vw;
  }

  .speech-bubble-inner--reply {
    max-height: 120px;
    font-size: 12px;
    padding: 10px 12px;
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
</style>

