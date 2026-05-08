<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ClassroomSim from './components/ClassroomSim.vue'
import SideBar from './components/SideBar.vue'
import SpecialTraining from './components/SpecialTraining.vue'
import TeachingDocAnalysis from './components/TeachingDocAnalysis.vue'
import {
  buildAbilityViewFromXe,
  buildEvaluationHtml,
  buildReportSpecialTrainingHtml,
  buildSuggestionsFromXe,
  buildTrainingOverviewHtml,
  buildXDebugSection,
  extractXEvaluation,
  getCategoryScoresForChart,
  unwrapReportApiResponse
} from './reportEvaluation.js'
import { trainingFocusForStudentId, TRAINING_FOCUS_BY_STUDENT_ID } from './constants/specialTrainingFocus.js'

const currentMode = ref('special')

/** 移动端左侧菜单抽屉 */
const mobileSidebarOpen = ref(false)

const specialRef = ref(null)
/** 课堂模拟内「生成报告」加载层挂载点（仅遮挡本模块，不挡侧栏） */
const classroomReportHostRef = ref(null)
/** 生成报告请求进行中：用于禁用侧栏按钮、课堂内恢复进度条 */
const reportGenerationBusy = ref(false)
/** 与加载条同步的进度（0–100），离开课堂页后仍递增，返回时可恢复显示 */
const reportGenerationPercent = ref(8)

const chatHeaderName = ref('😔 李大志')
const chatHeaderType = ref(TRAINING_FOCUS_BY_STUDENT_ID.dazhi)

const selectedStudent = ref({
  id: 'dazhi',
  name: '李大志',
  trainingFocus: TRAINING_FOCUS_BY_STUDENT_ID.dazhi,
  personality: '习得性无助型',
  avatar: '/avatars/dazhi.png',
  color: '#e74c3c',
  bgGradient: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
  tagline: '"我觉得我不行……"',
  desc: '内向沉默，长期被忽视，有明显的习得性无助倾向。回答问题时总低着头，声音很小。',
  traits: { confidence: 15, expressiveness: 25, anxiety: 85, motivation: 20, socialSkill: 30 },
  traitLabels: ['自信心', '表达力', '焦虑度', '学习动力', '社交能力']
})

const emotion = ref({
  joy: 20,
  activation: 15,
  anxiety: 75
})

const initialEmotionByStudentId = {
  dazhi: { joy: 20, activation: 15, anxiety: 75 },
  yiming: { joy: 70, activation: 85, anxiety: 15 },
  xiaorou: { joy: 45, activation: 40, anxiety: 55 }
}

// 对话会话 id（每次切换学生时重建）
const sessionId = ref(`sess_${Date.now()}_${selectedStudent.value.id}`)

// 按人格分桶的对话历史（切换人格互不混入；发报告时再合并）
const chatHistoryByChar = ref({})

function pushChatHistoryEntry(entry) {
  const id = selectedStudent.value?.id || '_'
  if (!chatHistoryByChar.value[id]) chatHistoryByChar.value[id] = []
  chatHistoryByChar.value[id].push(entry)
}

/** 报告/统计：所有人格对话按时间排序合并 */
function mergedChatHistorySorted() {
  const all = Object.values(chatHistoryByChar.value || {}).flat()
  return all.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
}
const emotionSnapshots = ref([])

/** 切换人格时保留左侧同步的 emotion（与右侧看板条一致） */
const emotionByChar = ref({})

function persistEmotionForCurrentCharacter() {
  const id = selectedStudent.value?.id
  if (!id) return
  emotionByChar.value = { ...emotionByChar.value, [id]: { ...emotion.value } }
}

// 供 vendor/front/js/workflow.js 写入的缓存（在 endSession payload 里复用）
const emotionHistoriesByChar = ref({})
const dynamicTraitsByChar = ref({})

function clamp100(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, n))
}

function syncWindowApp() {
  if (typeof window === 'undefined') return
  window.App = window.App || {}
  window.App.currentCharacter = selectedStudent.value
  window.App.currentEmotion = emotion.value
  window.App.sessionId = sessionId.value
  window.App.emotionHistoriesByChar = emotionHistoriesByChar.value
  window.App.dynamicTraitsByChar = dynamicTraitsByChar.value
}

function setupWorkflowAdapters() {
  if (typeof window === 'undefined') return
  if (!specialRef.value) return

  // vendor/front/js/workflow.js 会用 window.ChatEngine 做写入/加载态回调
  window.ChatEngine = window.ChatEngine || {}
  window.ChatEngine.showWorkflowLoading = (show) => specialRef.value?.showWorkflowLoading?.(show)
  window.ChatEngine.addWorkflowReply = () => {
    // 我们在 onSend 里用 finalText 统一追加气泡，避免流式分段导致重复气泡
  }
  window.ChatEngine.finalizeWorkflowReply = () => {}
  window.ChatEngine.addSystemMessage = (text) => specialRef.value?.appendSystem?.(text)

  // workflow.js 会用 window.EmotionDashboard 把 emotion/x-debug 写入图表
  window.EmotionDashboard = window.EmotionDashboard || {}
  window.EmotionDashboard.updateBars = (mapped) => {
    emotion.value = { ...mapped }
    persistEmotionForCurrentCharacter()
  }
  window.EmotionDashboard.pushHistory = (mapped) => {
    specialRef.value?.pushEmotionPoint?.(mapped)
    emotionSnapshots.value.push({ ...mapped, time: Date.now() })
  }
  window.EmotionDashboard.updateRadarChart = (character) => {
    if (!character || !character.traits) return
    selectedStudent.value = {
      ...selectedStudent.value,
      traits: character.traits,
      traitLabels: character.traitLabels || selectedStudent.value.traitLabels
    }
  }
}

function applyEmotionDeltaFromTrigger(trigger) {
  const base = { joy: emotion.value.joy, activation: emotion.value.activation, anxiety: emotion.value.anxiety }
  const delta =
    trigger === '鼓励'
      ? { joy: 12, activation: 6, anxiety: -18 }
      : trigger === '批评'
        ? { joy: -10, activation: -6, anxiety: 22 }
        : trigger === '安抚'
          ? { joy: 6, activation: 0, anxiety: -20 }
          : trigger === '互动'
            ? { joy: 8, activation: 14, anxiety: -6 }
            : trigger === '提问'
              ? { joy: -2, activation: 8, anxiety: 10 }
              : { joy: 0, activation: 0, anxiety: 0 }

  emotion.value = {
    joy: clamp100(base.joy + delta.joy),
    activation: clamp100(base.activation + delta.activation),
    anxiety: clamp100(base.anxiety + delta.anxiety)
  }
  persistEmotionForCurrentCharacter()
}

const onSend = async ({ text, trigger }) => {
  const t = (text || '').trim()
  if (!t) return

  // 更新路径分析实际达成率（包含自由输入的 total+1）
  specialRef.value?.recordTeacherTrigger?.(trigger)

  // 写入 endSession 统计用对话历史（当前人格）
  pushChatHistoryEntry({
    role: 'teacher',
    text: t,
    trigger,
    timestamp: Date.now(),
    characterId: selectedStudent.value?.id || null
  })

  specialRef.value?.showTypingIndicator?.()

  const client = typeof window !== 'undefined' ? window.WorkflowClient : null
  const wfConfig = typeof window !== 'undefined' ? window.WORKFLOW_CONFIG : null
  const modelName = selectedStudent.value?.name || '李大志'
  const taggedText = `{${modelName}}` + t

  let finalText = null
  try {
    if (client && typeof client.sendTextMessage === 'function') {
      finalText = await client.sendTextMessage(sessionId.value, 'teacher', taggedText, {
        trigger,
        characterId: selectedStudent.value?.id || null,
        model: modelName
      })
    }
  } catch (_) {
    finalText = null
  }

  specialRef.value?.removeTypingIndicator?.()

  if (finalText) {
    specialRef.value?.appendWorkflowReply?.(finalText)
    pushChatHistoryEntry({
      role: 'student',
      text: finalText,
      trigger: null,
      timestamp: Date.now(),
      characterId: selectedStudent.value?.id || null
    })
    return
  }

  // 后端无返回：可选关闭「本地模拟学生回复」（autoAppendReply=false）
  if (wfConfig?.autoAppendReply === false) {
    return
  }

  const show = specialRef.value?.showWorkflowLoading
  const appendWorkflowReply = specialRef.value?.appendWorkflowReply

  show?.(true)
  await new Promise((r) => setTimeout(r, 650))
  show?.(false)

  applyEmotionDeltaFromTrigger(trigger)
  specialRef.value?.pushEmotionPoint?.(emotion.value)
  emotionSnapshots.value.push({ ...emotion.value, time: Date.now() })

  const reply =
    trigger === '提问'
      ? '知道了，我会好好想想的。'
      : trigger === '安抚'
        ? '好的老师，我明白了。'
        : trigger === '批评'
          ? '我会改正的，老师。'
          : trigger === '鼓励'
            ? '谢谢老师！我会继续努力的。'
            : trigger === '互动'
              ? '好的，我们一起讨论一下！'
              : '好的。'

  const inner =
    trigger === '提问'
      ? '其实我没听懂……'
      : trigger === '安抚'
        ? '老师这么说我安心了，但我还是有点紧张。'
        : trigger === '批评'
          ? '我是不是做得太差了……'
          : trigger === '鼓励'
            ? '老师的肯定让我有点开心，但我怕自己做得还不够好。'
            : trigger === '互动'
              ? '我觉得这个问题好有意思，我想再确认一下。'
              : '我有点紧张。'

  appendWorkflowReply?.(`${reply}\n内心OS：${inner}`)
  pushChatHistoryEntry({
    role: 'student',
    text: reply,
    trigger: null,
    timestamp: Date.now(),
    characterId: selectedStudent.value?.id || null
  })
}

const onStudentSelectedFull = (student) => {
  // 从课堂模拟切回“专项模拟”（单人特训）时，也会保留当前选择
  currentMode.value = 'special'
  const next = student || selectedStudent.value
  const prevId = selectedStudent.value?.id
  if (prevId) {
    emotionByChar.value = { ...emotionByChar.value, [prevId]: { ...emotion.value } }
  }

  // 顺带更新标题气质 badge（如果你不想变，可以删掉这里）
  selectedStudent.value = next
  chatHeaderType.value = next?.trainingFocus || trainingFocusForStudentId(next?.id) || next?.personality || chatHeaderType.value
  // 与原版顶栏一致：「头像emoji + 姓名」
  if (next?.name) chatHeaderName.value = next.name

  sessionId.value = `sess_${Date.now()}_${next.id}`

  // 不再额外发送「人格切换」JSON；后端已在对话请求体内自行处理

  // 切换学生：对话 / 右侧折线与路径分析按人格恢复（不 resetEmotions、不强制初始情绪）
  const nid = next?.id
  emotion.value = emotionByChar.value[nid]
    ? { ...emotionByChar.value[nid] }
    : { ...(initialEmotionByStudentId[nid] || { joy: 50, activation: 50, anxiety: 50 }) }

  syncWindowApp()
}

function goToClassroomSimFromDocAnalysis() {
  currentMode.value = 'classroom'
  mobileSidebarOpen.value = false
}

/** 与侧栏一致的三人格，用于报告加载中的「专项训练」快捷跳转 */
const SPECIAL_TRAINING_REPORT_SHORTCUTS = [
  {
    id: 'dazhi',
    name: '李大志',
    trainingFocus: TRAINING_FOCUS_BY_STUDENT_ID.dazhi,
    personality: '习得性无助型',
    avatar: '/avatars/dazhi.png',
    color: '#e74c3c',
    bgGradient: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
    tagline: '"我觉得我不行……"',
    desc: '内向沉默，长期被忽视，有明显的习得性无助倾向。回答问题时总低着头，声音很小。',
    traits: { confidence: 15, expressiveness: 25, anxiety: 85, motivation: 20, socialSkill: 30 },
    traitLabels: ['自信心', '表达力', '焦虑度', '学习动力', '社交能力'],
  },
  {
    id: 'yiming',
    name: '张一鸣',
    trainingFocus: TRAINING_FOCUS_BY_STUDENT_ID.yiming,
    personality: '调皮捣蛋',
    avatar: '/avatars/yiming.png',
    color: '#3498db',
    bgGradient: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
    tagline: '"老师！我有个问题！"',
    desc: '活泼好动，思维跳跃，课堂上总爱插嘴。聪明但注意力不集中，需要老师引导其专注。',
    traits: { confidence: 80, expressiveness: 90, anxiety: 20, motivation: 65, socialSkill: 85 },
    traitLabels: ['自信心', '表达力', '焦虑度', '学习动力', '社交能力'],
  },
  {
    id: 'xiaorou',
    name: '林暖暖',
    trainingFocus: TRAINING_FOCUS_BY_STUDENT_ID.xiaorou,
    personality: '乖巧敏感',
    avatar: '/avatars/xiaorou.png',
    color: '#9b59b6',
    bgGradient: 'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)',
    tagline: '"老师，你是不是生气了……"',
    desc: '敏感细腻，善于察言观色，情绪容易受外界影响。很在意老师的评价，容易过度解读。',
    traits: { confidence: 35, expressiveness: 55, anxiety: 70, motivation: 50, socialSkill: 60 },
    traitLabels: ['自信心', '表达力', '焦虑度', '学习动力', '社交能力'],
  },
]

function jumpToSpecialTrainingFromReportLoading(studentId) {
  const row = SPECIAL_TRAINING_REPORT_SHORTCUTS.find((s) => s.id === studentId)
  if (!row) return
  hideReportLoading({ completing: false })
  onStudentSelectedFull({ ...row })
  mobileSidebarOpen.value = false
}

function resetSession() {
  const nextStudent = selectedStudent.value
  specialRef.value?.clearAllCharacterThreads?.()
  specialRef.value?.clearAllCharacterDashboardSnapshots?.()
  specialRef.value?.resetEmotions?.(nextStudent)

  emotionByChar.value = {}
  const nextEmotion = initialEmotionByStudentId[nextStudent?.id] || emotion.value
  emotion.value = { ...nextEmotion }
  chatHistoryByChar.value = {}
  emotionSnapshots.value = []
  sessionId.value = `sess_${Date.now()}_${nextStudent.id}`

  // 清空 workflow caches（用于 endSession payload 一致性）
  for (const k of Object.keys(emotionHistoriesByChar.value)) delete emotionHistoriesByChar.value[k]
  for (const k of Object.keys(dynamicTraitsByChar.value)) delete dynamicTraitsByChar.value[k]

  specialRef.value?.pushEmotionPoint?.(emotion.value)
  syncWindowApp()
}

function escapeHtml(str) {
  if (str == null) return ''
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

async function ensureEchartsLoaded() {
  if (window.echarts) return window.echarts
  if (ensureEchartsLoaded._p) return ensureEchartsLoaded._p

  ensureEchartsLoaded._p = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.type = 'text/javascript'
    script.async = true
    script.src = new URL('../vendor/front/js/echarts.min.js', import.meta.url).href
    script.onload = () => resolve(window.echarts)
    script.onerror = reject
    document.head.appendChild(script)
  })

  return ensureEchartsLoaded._p
}

function calculateScores(history, character) {
  const teacherMsgs = history.filter((m) => m.role === 'teacher')
  let empathy = 50,
    questioning = 50,
    patience = 50,
    adaptability = 50,
    encouragement = 50

  teacherMsgs.forEach((msg) => {
    switch (msg.trigger) {
      case '鼓励':
        empathy += 8
        encouragement += 12
        break
      case '安抚':
        empathy += 10
        patience += 10
        break
      case '批评':
        if (character.id === 'dazhi') {
          empathy -= 15
          adaptability -= 10
        } else {
          empathy -= 5
        }
        break
      case '提问':
        questioning += 10
        break
      case '互动':
        adaptability += 8
        questioning += 5
        break
    }
  })

  const clamp = (v) => Math.max(10, Math.min(100, Math.round(v)))
  return {
    empathy: clamp(empathy),
    questioning: clamp(questioning),
    patience: clamp(patience),
    adaptability: clamp(adaptability),
    encouragement: clamp(encouragement)
  }
}

function generateSuggestions(history, character) {
  const suggestions = []
  const teacherMsgs = history.filter((m) => m.role === 'teacher')

  const criticisms = teacherMsgs.filter((m) => m.trigger === '批评')
  const encouragements = teacherMsgs.filter((m) => m.trigger === '鼓励')
  const comforts = teacherMsgs.filter((m) => m.trigger === '安抚')

  if (character.id === 'dazhi') {
    if (criticisms.length > 1) {
      suggestions.push({
        type: 'warning',
        icon: '⚠️',
        text: `您对${character.name}使用了${criticisms.length}次批评。该学生属于"${character.personality}"，过多批评会加剧其习得性无助感，建议多用鼓励和引导。`
      })
    }
    if (encouragements.length === 0) {
      suggestions.push({
        type: 'tip',
        icon: '💡',
        text: `建议对${character.name}多使用正向鼓励。研究表明，对习得性无助型学生，"具体化表扬"（如"你这个思路很有创意"）比泛泛鼓励更有效。`
      })
    }
  }

  if (character.id === 'yiming') {
    if (criticisms.length === 0 && teacherMsgs.length > 3) {
      suggestions.push({
        type: 'tip',
        icon: '💡',
        text: `${character.name}是"${character.personality}"学生，适当的规则提醒有助于帮助他集中注意力。完全不设限可能让他更加散漫。`
      })
    }
  }

  if (character.id === 'xiaorou') {
    if (criticisms.length > 0) {
      suggestions.push({
        type: 'warning',
        icon: '⚠️',
        text: `${character.name}是高敏感型学生，批评对她的情绪冲击非常大。建议用"三明治反馈法"：先肯定→再指出问题→最后鼓励。`
      })
    }
  }

  if (teacherMsgs.length < 3) {
    suggestions.push({
      type: 'info',
      icon: '📝',
      text: '本次对话轮次较少，建议进行更充分的互动以获得更准确的教学评估。'
    })
  }

  if (comforts.length > 0 && encouragements.length > 0) {
    suggestions.push({
      type: 'praise',
      icon: '🌟',
      text: '您在本次对话中同时使用了安抚和鼓励策略，这是非常好的教学实践！情绪支持+正向激励的组合对学生的心理健康非常有益。'
    })
  }

  if (suggestions.length === 0) {
    suggestions.push({
      type: 'info',
      icon: '📊',
      text: '本次训练表现中规中矩，建议尝试更多元的互动策略来提升教学效果。'
    })
  }

  return suggestions
}

function generateSummary(history, character) {
  const total = history.length
  const teacherCount = history.filter((m) => m.role === 'teacher').length
  const duration =
    total > 0 ? Math.round((history[history.length - 1].timestamp - history[0].timestamp) / 1000) : 0
  const minutes = Math.floor(duration / 60)
  const seconds = duration % 60
  return {
    totalRounds: Math.floor(total / 2),
    teacherMessages: teacherCount,
    studentMessages: total - teacherCount,
    duration: `${minutes}分${seconds}秒`,
    character: character.name,
    personality: character.personality
  }
}

function renderScoreBars(scores) {
  const labels = {
    empathy: '共情能力',
    questioning: '提问技巧',
    patience: '耐心程度',
    adaptability: '应变能力',
    encouragement: '激励能力'
  }
  const colors = ['#e74c3c', '#3498db', '#2ecc71', '#e67e22', '#9b59b6']
  let html = ''
  let i = 0

  for (const [key, label] of Object.entries(labels)) {
    const val = scores[key]
    const stars = Math.round(val / 20)
    html += `
      <div class="score-bar-item">
        <div class="score-bar-head">
          <span>${label}</span>
          <span class="score-stars">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</span>
        </div>
        <div class="score-bar-track">
          <div class="score-bar-fill" style="width:${val}%;background:${colors[i]}"></div>
        </div>
        <span class="score-val">${val}分</span>
      </div>
    `
    i++
  }

  return html
}

/** 后端 x-evaluation.categories 驱动的能力条形图（与 renderScoreBars 样式一致） */
function renderXeCategoryBars(items) {
  const colors = ['#e74c3c', '#3498db', '#2ecc71', '#e67e22', '#9b59b6', '#16a085']
  let html = ''
  items.forEach((it, i) => {
    const val = it.value
    const stars = Math.round(val / 20)
    const c = colors[i % colors.length]
    html += `
      <div class="score-bar-item">
        <div class="score-bar-head">
          <span>${escapeHtml(it.name)}</span>
          <span class="score-stars">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</span>
        </div>
        <div class="score-bar-track">
          <div class="score-bar-fill" style="width:${val}%;background:${c}"></div>
        </div>
        <span class="score-val">${val}分</span>
      </div>
    `
  })
  return html
}

async function showReportModal(reportApiResponse = null) {
  const character = selectedStudent.value
  const reportRoot =
    reportApiResponse != null
      ? unwrapReportApiResponse(reportApiResponse) || reportApiResponse
      : null
  const xe = extractXEvaluation(reportRoot)
  if (typeof window !== 'undefined' && window.console) {
    console.log('[ReportDirect] 报告渲染输入', {
      rawResponse: reportApiResponse,
      unwrappedRoot: reportRoot,
      hasXEvaluation: !!xe
    })
  }
  // 完全以后端返回为准：只要有角色即可打开，缺失字段直接显示“未返回”
  if (!character) return

  await ensureEchartsLoaded()

  const suggestions = xe
    ? buildSuggestionsFromXe(xe)
    : [
        {
          type: 'info',
          icon: 'ℹ️',
          text: '后端响应未返回 x-evaluation，报告仅展示可用根字段与调试信息。'
        }
      ]

  const overviewHtml = xe
    ? buildTrainingOverviewHtml(xe, null, escapeHtml, reportRoot)
    : `<div class="summary-grid summary-grid--xe">
      <div class="summary-item">
        <div class="summary-num summary-num--text">${escapeHtml(
          reportRoot && typeof reportRoot.model === 'string' ? reportRoot.model : '—'
        )}</div>
        <div class="summary-label">模型（接口返回）</div>
      </div>
      <div class="summary-item">
        <div class="summary-num summary-num--text">${escapeHtml(
          reportRoot && reportRoot.created != null ? String(reportRoot.created) : '—'
        )}</div>
        <div class="summary-label">创建时间戳（created）</div>
      </div>
      <div class="summary-item">
        <div class="summary-num summary-num--text">${escapeHtml(
          reportRoot && reportRoot.usage && reportRoot.usage.total_tokens != null
            ? String(reportRoot.usage.total_tokens)
            : '—'
        )}</div>
        <div class="summary-label">Token 总计</div>
      </div>
      <div class="summary-item">
        <div class="summary-num summary-num--text">${escapeHtml(xe ? '已返回' : '未返回')}</div>
        <div class="summary-label">x-evaluation</div>
      </div>
    </div>`
  const evalSectionHtml = xe ? buildEvaluationHtml(xe, escapeHtml, { omitMeta: true }) : ''
  const debugSectionHtml = buildXDebugSection(reportRoot, escapeHtml)
  const abilityView = buildAbilityViewFromXe(xe)
  const abilityBarsHtml = abilityView
    ? renderXeCategoryBars(abilityView.items)
    : '<p class="report-ability-source">后端未返回可用的能力分类得分（x-evaluation.categories）。</p>'
  const specialTrainingHtml = xe ? buildReportSpecialTrainingHtml(xe, escapeHtml) : ''

  const existing = document.getElementById('report-modal')
  if (existing) existing.remove()

  const modal = document.createElement('div')
  modal.id = 'report-modal'
  modal.className = 'report-overlay'

  modal.innerHTML = `
    <div class="report-container report-container--app">
      <header class="report-topbar">
        <div class="report-topbar-inner">
          <div class="report-topbar-spacer" aria-hidden="true"></div>
          <h2 class="report-topbar-title">教学训练报告</h2>
          <button class="report-close report-close--bar" type="button" aria-label="关闭">✕</button>
        </div>
      </header>

      <div class="report-body">
        <div class="report-section">
          <h3>📊 训练概况</h3>
          ${
            xe
              ? '<p class="report-overview-note">训练概况中的轮次、评估时间与根字段（模型、Token/响应时间）均来自接口返回 JSON；已自动解包常见网关包装（如 data/result 等），与控制台打印一致。</p>'
              : ''
          }
          ${overviewHtml}
        </div>

        ${debugSectionHtml}

        <div class="report-section">
          <h3>🎯 能力评估</h3>
          ${
            abilityView
              ? '<p class="report-ability-source">以下维度与得分来自后端智能评估（x-evaluation 大类得分）</p>'
              : '<p class="report-ability-source">当前仅按后端返回展示：缺少 x-evaluation.categories，故不渲染雷达图。</p>'
          }
          <div class="scores-row">
            <div class="report-radar-wrap">
              <div class="report-chart-subtitle">雷达图（综合维度）</div>
              <div class="report-radar-plot">
                ${
                  abilityView
                    ? '<div id="report-radar" class="report-radar-canvas"></div>'
                    : '<div class="report-ability-source" style="padding:12px;">后端缺少雷达数据</div>'
                }
              </div>
            </div>
            <div class="report-chart-divider" aria-hidden="true"></div>
            <div class="score-bars">
              <div class="report-chart-subtitle">能力条形图（分类得分）</div>
              <div class="score-bars-plot">
                ${abilityBarsHtml}
              </div>
            </div>
          </div>
        </div>

        ${specialTrainingHtml}

        ${evalSectionHtml}

        <div class="report-section">
          <h3>💡 改进建议</h3>
          ${
            xe
              ? '<p class="report-suggestions-note">基于 x-evaluation 各大类得分自动生成，与本地对话统计无关。</p>'
              : ''
          }
          <div class="suggestions-list">
            ${suggestions
              .map(
                (s) => `
              <div class="suggestion-card ${s.type}">
                <span class="suggestion-icon">${s.icon}</span>
                <p>${s.text}</p>
              </div>
            `
              )
              .join('')}
          </div>
        </div>
      </div>

      <div class="report-footer">
        <button class="btn-restart" type="button">🔄 重新训练</button>
        <button class="btn-export" type="button">📥 导出报告</button>
      </div>
    </div>
  `

  document.body.appendChild(modal)
  requestAnimationFrame(() => modal.classList.add('show'))

  modal.querySelector('.report-close')?.addEventListener('click', () => modal.remove())
  modal.querySelector('.btn-restart')?.addEventListener('click', () => {
    modal.remove()
    resetSession()
  })
  modal.querySelector('.btn-export')?.addEventListener('click', () => {
    alert('📥 报告导出功能开发中，敬请期待！')
  })
  modal.querySelectorAll('[data-report-modal-jump]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-report-modal-jump')
      if (!id) return
      modal.remove()
      jumpToSpecialTrainingFromReportLoading(id)
    })
  })

  setTimeout(() => {
    if (!window.echarts || !abilityView) return
    const dom = document.getElementById('report-radar')
    if (dom) {
    const chart = window.echarts.init(dom)
    const radarIndicator = abilityView.indicators.map((x) => ({ name: x.name, max: x.max }))
    const radarValues = abilityView.values
    const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches
    chart.setOption({
      radar: {
        indicator: radarIndicator,
        shape: 'polygon',
        radius: isMobile ? '76%' : '66%',
        center: ['50%', isMobile ? '54%' : '52%'],
        splitNumber: 4,
        axisName: { color: '#636e72', fontSize: isMobile ? 13 : 11 },
        splitLine: { lineStyle: { color: '#dfe6e9' } },
        splitArea: { areaStyle: { color: ['rgba(255,255,255,0)', 'rgba(200,200,200,0.05)'] } }
      },
      series: [
        {
          type: 'radar',
          data: [
            {
              value: radarValues,
              lineStyle: { color: character.color, width: 2 },
              areaStyle: { color: character.color + '35' },
              itemStyle: { color: character.color },
              symbol: 'circle',
              symbolSize: 6
            }
          ],
          animationDuration: 1000,
          animationEasing: 'elasticOut'
        }
      ]
    })
    requestAnimationFrame(() => chart.resize())
    }

    if (xe) {
      const barEl = document.getElementById('report-eval-categories-chart')
      const { names, values } = getCategoryScoresForChart(xe)
      if (barEl && names.length && window.echarts) {
        const isMobileBar = window.matchMedia && window.matchMedia('(max-width: 768px)').matches
        const bar = window.echarts.init(barEl)
        bar.setOption({
          tooltip: { trigger: 'axis' },
          grid: {
            left: isMobileBar ? 8 : 12,
            right: isMobileBar ? 8 : 12,
            top: 24,
            bottom: isMobileBar ? 38 : 16,
            containLabel: true
          },
          xAxis: {
            type: 'category',
            data: names,
            axisLabel: {
              color: '#636e72',
              fontSize: isMobileBar ? 11 : 10,
              interval: 0,
              rotate: names.length > 3 ? (isMobileBar ? 26 : 20) : 0
            }
          },
          yAxis: { type: 'value', max: 100, axisLabel: { color: '#636e72', fontSize: 10 } },
          series: [
            {
              type: 'bar',
              data: values,
              itemStyle: {
                color: new window.echarts.graphic.LinearGradient(0, 0, 0, 1, [
                  { offset: 0, color: character.color || '#3498db' },
                  { offset: 1, color: (character.color || '#3498db') + '88' }
                ])
              },
              barMaxWidth: 48
            }
          ]
        })
        requestAnimationFrame(() => bar.resize())
      }
    }
  }, 200)
}

function showReportLoading(options = {}) {
  const scopedToClassroom = !!options.scopedToClassroom
  const resume = !!options.resume
  if (resume && document.getElementById('report-loading-overlay')) return

  if (!resume) hideReportLoading({ completing: false })

  const startPctRaw =
    options.initialPercent != null && Number.isFinite(Number(options.initialPercent))
      ? Number(options.initialPercent)
      : 8
  const startPct = Math.min(92, Math.max(8, Math.round(startPctRaw)))
  reportLoadingPercent = startPct
  reportGenerationPercent.value = startPct

  const el = document.createElement('div')
  el.id = 'report-loading-overlay'
  el.className = scopedToClassroom
    ? 'report-loading-overlay report-loading-overlay--classroom-scoped'
    : 'report-loading-overlay'
  el.setAttribute('role', 'status')
  el.setAttribute('aria-busy', 'true')
  el.setAttribute('aria-live', 'polite')
  el.setAttribute('aria-label', '正在生成报告')
  const scopedHint = scopedToClassroom
    ? '<p class="report-loading-scoped-hint">生成期间可使用<strong>左侧栏</strong>切换其他模块；课堂模拟主界面暂时不可操作。</p>'
    : ''
  el.innerHTML = `
    <div class="report-loading-card${scopedToClassroom ? ' report-loading-card--scoped' : ''}">
      <div class="report-loading-spinner" aria-hidden="true"></div>
      <p class="report-loading-text">正在生成报告，请稍候…</p>
      ${scopedHint}
      <div class="report-loading-progress" aria-hidden="true">
        <div class="report-loading-progress-fill" id="report-loading-progress-fill" style="width:${reportLoadingPercent}%;"></div>
      </div>
      <p class="report-loading-percent" id="report-loading-percent">${reportLoadingPercent}%</p>
    </div>
  `
  const host =
    scopedToClassroom && classroomReportHostRef.value ? classroomReportHostRef.value : document.body
  host.appendChild(el)
  requestAnimationFrame(() => el.classList.add('report-loading-overlay--show'))
  if (reportLoadingTimer) {
    clearInterval(reportLoadingTimer)
    reportLoadingTimer = null
  }
  reportLoadingTimer = window.setInterval(() => {
    reportLoadingPercent = Math.min(92, reportLoadingPercent + (reportLoadingPercent < 60 ? 5 : 2))
    reportGenerationPercent.value = reportLoadingPercent
    const fill = document.getElementById('report-loading-progress-fill')
    const label = document.getElementById('report-loading-percent')
    if (fill) fill.style.width = `${reportLoadingPercent}%`
    if (label) label.textContent = `${reportLoadingPercent}%`
  }, 220)
}

function hideReportLoading(opts = {}) {
  const completing = !!opts.completing
  const el = document.getElementById('report-loading-overlay')
  if (!el) return
  if (reportLoadingTimer) {
    clearInterval(reportLoadingTimer)
    reportLoadingTimer = null
  }
  if (completing) {
    reportLoadingPercent = 100
    reportGenerationPercent.value = 100
    const fill = document.getElementById('report-loading-progress-fill')
    const label = document.getElementById('report-loading-percent')
    if (fill) fill.style.width = '100%'
    if (label) label.textContent = '100%'
    el.classList.remove('report-loading-overlay--show')
    const remove = () => el.remove()
    el.addEventListener('transitionend', remove, { once: true })
    setTimeout(remove, 280)
  } else {
    try {
      el.remove()
    } catch (_) {
      /* ignore */
    }
  }
}

let reportLoadingTimer = null
let reportLoadingPercent = 0

function parseOptionalNumber(v) {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function parseOptionalBoolean(v) {
  if (v == null || v === '') return undefined
  if (typeof v === 'boolean') return v
  const s = String(v).trim().toLowerCase()
  if (s === 'true') return true
  if (s === 'false') return false
  return undefined
}

async function requestTrainingReportDirect() {
  const cfg =
    typeof window !== 'undefined' && window.__REPORT_WORKFLOW_INJECT__ && typeof window.__REPORT_WORKFLOW_INJECT__ === 'object'
      ? window.__REPORT_WORKFLOW_INJECT__
      : null
  const apiUrl = String(cfg?.httpUrl || '').trim()
  const apiKey = String(cfg?.httpApiKey || '').trim()
  if (!apiUrl || !apiKey) {
    if (typeof window !== 'undefined' && window.console) {
      console.warn('[ReportDirect] 配置缺失，跳过请求', {
        hasHttpUrl: !!apiUrl,
        hasApiKey: !!apiKey
      })
    }
    return null
  }

  const payload = {
    messages: [{ role: 'user', content: '' }],
    evaluation: true,
    api_key: apiKey
  }

  const t = parseOptionalNumber(cfg?.chatTemperature)
  const p = parseOptionalNumber(cfg?.chatTopP)
  const max = parseOptionalNumber(cfg?.chatMaxTokens)
  const stream = parseOptionalBoolean(cfg?.chatStream)
  const user = String(cfg?.chatUser || '').trim()
  if (t != null) payload.temperature = t
  if (p != null) payload.top_p = p
  if (max != null) payload.max_tokens = Math.round(max)
  if (stream != null) payload.stream = stream
  if (user) payload.user = user

  if (typeof window !== 'undefined' && window.console) {
    const safePayload = { ...payload }
    if (safePayload.api_key) safePayload.api_key = '***'
    console.log('[ReportDirect] 前端发送请求', {
      url: apiUrl,
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: 'Bearer ***' },
      body: safePayload
    })
  }

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  })
  const text = await res.text()
  if (typeof window !== 'undefined' && window.console) {
    console.log('[ReportDirect] 后端响应', {
      status: res.status,
      ok: res.ok,
      contentType: res.headers.get('Content-Type') || '',
      rawTextPreview: String(text || '').slice(0, 600)
    })
  }
  if (!res.ok) return null
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    if (typeof window !== 'undefined' && window.console) {
      console.log('[ReportDirect] 后端JSON解析结果', parsed)
    }
    return parsed
  } catch {
    if (typeof window !== 'undefined' && window.console) {
      console.warn('[ReportDirect] 响应不是合法JSON，按原始文本处理')
    }
    return text
  }
}

async function endSession() {
  reportGenerationBusy.value = true
  reportGenerationPercent.value = 8
  showReportLoading({ scopedToClassroom: currentMode.value === 'classroom' })
  let reportApiResponse = null
  try {
    // 报告改为前端直连后端 HTTP，不再经过 WorkflowClient
    reportApiResponse = await requestTrainingReportDirect()
    if (typeof window !== 'undefined' && window.console) {
      console.log('[ReportDirect] 传递给 showReportModal 的数据', reportApiResponse)
    }
    await showReportModal(reportApiResponse)
  } catch (_) {
    /* ignore */
  } finally {
    hideReportLoading({ completing: true })
    reportGenerationBusy.value = false
    reportGenerationPercent.value = 8
  }
}

function showWorkflowDataModal() {
  const store = window.WorkflowDataStore
  if (!store || typeof store.getAll !== 'function') return

  const existing = document.getElementById('workflow-data-modal')
  if (existing) existing.remove()

  const list = store.getAll()

  const modal = document.createElement('div')
  modal.id = 'workflow-data-modal'
  modal.className = 'workflow-data-overlay'

  const listHtml =
    list.length === 0
      ? '<div class="workflow-data-empty">暂无接口返回记录，对话中的智能体回复会自动记录于此。</div>'
      : list
          .map((r, i) => {
            const reqShort = (r.request || '').slice(0, 80) + ((r.request || '').length > 80 ? '…' : '')
            const resShort = (r.response || '').slice(0, 120) + ((r.response || '').length > 120 ? '…' : '')
            const time = r.created_at ? new Date(r.created_at).toLocaleString('zh-CN') : ''
            return `
              <div class="workflow-data-card" data-idx="${i}">
                <div class="workflow-data-meta">${time}${r.trigger ? ' · ' + r.trigger : ''}</div>
                <div class="workflow-data-req"><strong>请求：</strong>${escapeHtml(reqShort)}</div>
                <div class="workflow-data-res"><strong>回复：</strong>${escapeHtml(resShort)}</div>
                <details class="workflow-data-details">
                  <summary>展开全文</summary>
                  <div class="workflow-data-full-req">${escapeHtml(r.request || '')}</div>
                  <div class="workflow-data-full-res">${escapeHtml(r.response || '')}</div>
                </details>
              </div>
            `
          })
          .join('')

  modal.innerHTML = `
    <div class="workflow-data-container">
      <button class="workflow-data-close" aria-label="关闭" type="button">✕</button>
      <h2 class="workflow-data-title">📁 对话接口记录</h2>
      <p class="workflow-data-desc">共 ${list.length} 条，可导出为 JSON 文件保存。</p>
      <div class="workflow-data-list">${listHtml}</div>
      <div class="workflow-data-actions">
        <button type="button" class="workflow-data-btn primary" id="workflow-data-export">导出 JSON 文件</button>
        <button type="button" class="workflow-data-btn" id="workflow-data-clear">清空数据</button>
      </div>
    </div>
  `

  document.body.appendChild(modal)
  requestAnimationFrame(() => modal.classList.add('show'))

  modal.querySelector('.workflow-data-close')?.addEventListener('click', () => modal.remove())
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove()
  })

  modal.querySelector('#workflow-data-export')?.addEventListener('click', () => {
    store.exportToJsonFile?.()
  })

  modal.querySelector('#workflow-data-clear')?.addEventListener('click', () => {
    if (list.length && !confirm('确定清空所有接口记录？')) return
    store.clear?.()
    showWorkflowDataModal()
  })
}

let desktopMq = null
function closeMobileSidebarIfDesktop() {
  try {
    if (desktopMq?.matches) mobileSidebarOpen.value = false
  } catch (_) {
    /* ignore */
  }
}

onMounted(() => {
  setupWorkflowAdapters()
  syncWindowApp()
  try {
    desktopMq = window.matchMedia('(min-width: 769px)')
    desktopMq.addEventListener?.('change', closeMobileSidebarIfDesktop)
    closeMobileSidebarIfDesktop()
  } catch (_) {
    /* ignore */
  }
})

onBeforeUnmount(() => {
  try {
    desktopMq?.removeEventListener?.('change', closeMobileSidebarIfDesktop)
  } catch (_) {
    /* ignore */
  }
})

watch([selectedStudent, emotion, sessionId], () => {
  syncWindowApp()
}, { deep: true })

watch(
  () => currentMode.value,
  (mode) => {
    if (mode !== 'classroom' || !reportGenerationBusy.value) return
    if (document.getElementById('report-loading-overlay')) return
    showReportLoading({
      scopedToClassroom: true,
      resume: true,
      initialPercent: reportGenerationPercent.value,
    })
  }
)
</script>

<template>
  <div class="app-container">
    <div
      v-if="mobileSidebarOpen"
      class="mobile-sidebar-backdrop"
      aria-hidden="true"
      @click="mobileSidebarOpen = false"
    />
      <button
      type="button"
      class="app-mobile-menu-btn"
      aria-label="打开菜单"
      @click="mobileSidebarOpen = true"
    >
      ☰
      </button>
    <SideBar
      :mode="currentMode"
      :mobile-open="mobileSidebarOpen"
      @select="onStudentSelectedFull"
      @workflow-data="showWorkflowDataModal"
      @switch-mode="(m) => (currentMode = m)"
      @close-mobile="mobileSidebarOpen = false"
    />

    <SpecialTraining
      v-show="currentMode === 'special'"
      ref="specialRef"
            :current-emotion="emotion"
            :header-name="chatHeaderName"
            :header-type="chatHeaderType"
            :student="selectedStudent"
            @send="onSend"
          />

    <main ref="classroomReportHostRef" v-show="currentMode === 'classroom'" class="chat-main">
      <ClassroomSim
        :active="currentMode === 'classroom'"
        :report-busy="reportGenerationBusy"
        @report="endSession"
      />
    </main>

    <TeachingDocAnalysis
      v-show="currentMode === 'doc-analysis'"
      @request-classroom-sim="goToClassroomSimFromDocAnalysis"
    />
  </div>
</template>

<style>
@import '../vendor/front/css/style.css';

:root {
  /* Brand / Primary */
  --app-color-primary: #2f5d7c;
  --app-color-primary-hover: #284f6a;
  --app-color-primary-active: #213f55;
  --app-color-primary-soft: #edf3f7;
  --app-color-primary-border: #c6d4de;

  /* Emotion semantics */
  --app-color-pleasure: #728b7a;
  --app-color-pleasure-soft: #eef3ef;
  --app-color-pleasure-border: #c8d4cb;
  --app-color-pleasure-text: #4f6656;

  --app-color-anxiety: #a06f67;
  --app-color-anxiety-soft: #f6efed;
  --app-color-anxiety-border: #dcc5c0;
  --app-color-anxiety-text: #7d5751;

  --app-color-neutral: #8a96a3;
  --app-color-neutral-soft: #f1f3f5;
  --app-color-neutral-border: #d4dbe1;
  --app-color-neutral-text: #66717d;

  /* Gray system */
  --app-bg-page: #f4f6f8;
  --app-bg-panel: #ffffff;
  --app-bg-subtle: #eef1f4;
  --app-bg-muted: #e7ebef;

  --app-border-default: #d7dde3;
  --app-border-strong: #c4ccd4;

  --app-text-primary: #1f2a37;
  --app-text-secondary: #4b5563;
  --app-text-tertiary: #7b8794;
  --app-text-disabled: #9aa4af;

  /* Optional shared aliases for gradual replacement */
  --app-shadow-color: rgba(31, 42, 55, 0.12);
  --app-overlay-color: rgba(31, 42, 55, 0.18);

  --text: var(--app-text-secondary);
  --text-h: var(--app-text-primary);
  --bg: var(--app-bg-panel);
  --border: var(--app-border-default);
  --accent: var(--app-color-primary);
  --accent-bg: var(--app-color-primary-soft);
}

html,
body {
  height: 100%;
  width: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
}

#app {
  height: 100%;
  width: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
  max-width: none !important;
  border: 0 !important;
}

/* 让课堂模拟在右侧中心区域中铺满，而不是占用整个视口 */
.app-container .classroom-sim {
  width: 100% !important;
  height: 100% !important;
}

.app-container > .chat-main {
  position: relative;
}

/* 侧栏在报告/遮罩之上，并允许收缩按钮外凸（负 right）显示；避免主区盖住按钮延伸部分 */
.app-container .sidebar {
  position: relative;
  z-index: 30;
  overflow: visible;
}
.app-container > .chat-main,
.app-container .training-shell {
  z-index: 1;
  position: relative;
}

/* 桌面：遮罩从「侧栏右缘 + 收缩钮外凸 18px」起算，避免盖住侧栏外凸的收缩钮（--app-sidebar-outer 由 SideBar 同步） */
@media (min-width: 769px) {
  .report-overlay {
    left: var(--app-sidebar-outer, 278px);
    right: 0;
    top: 0;
    bottom: 0;
    width: auto;
    max-width: none;
    box-sizing: border-box;
  }
}

/* 报告弹窗：与当前应用主色/背景统一；顶部条 sticky，关闭常显 */
.report-container.report-container--app {
  border-radius: 16px;
  border: 1px solid var(--app-border-default, #d7dde3);
  box-shadow: 0 16px 48px var(--app-shadow-color, rgba(31, 42, 55, 0.12));
  overflow-x: hidden;
}
.report-topbar {
  position: sticky;
  top: 0;
  z-index: 40;
  background: var(--app-bg-panel, #ffffff);
  border-bottom: 1px solid var(--app-border-default, #d7dde3);
  box-shadow: 0 1px 0 rgba(31, 42, 55, 0.05);
}
.report-topbar-inner {
  display: grid;
  grid-template-columns: 40px 1fr 40px;
  align-items: center;
  padding: 8px 12px;
  min-height: 48px;
  box-sizing: border-box;
}
.report-topbar-spacer {
  width: 40px;
  min-width: 40px;
  height: 1px;
  pointer-events: none;
}
.report-topbar-title {
  font-size: 18px;
  font-weight: 800;
  color: var(--app-text-primary, #1f2a37) !important;
  margin: 0;
  line-height: 1.2;
  letter-spacing: -0.02em;
  min-width: 0;
  text-align: center;
}
.report-close--bar,
.report-topbar .report-close.report-close--bar {
  position: static !important;
  top: auto;
  right: auto;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: var(--app-bg-subtle, #eef1f4) !important;
  color: var(--app-text-secondary, #4b5563) !important;
  border: 1px solid var(--app-border-default, #d7dde3) !important;
  font-size: 18px;
  line-height: 1;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
  transform: none !important;
}
.report-close--bar:hover,
.report-topbar .report-close.report-close--bar:hover {
  background: var(--app-color-primary-soft, #edf3f7) !important;
  color: var(--app-color-primary, #2f5d7c) !important;
  border-color: var(--app-color-primary-border, #c6d4de) !important;
  transform: none !important;
}
.report-container.report-container--app .report-body {
  padding-top: 4px;
}

/* 报告弹窗：x-evaluation 可视化 */
.report-x-eval {
  border-top: 1px solid #eef2f5;
  padding-top: 8px;
}
.report-x-eval-meta {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
  margin: 12px 0;
  font-size: 13px;
}
.report-x-k {
  display: block;
  color: #8e99a4;
  font-size: 11px;
}
.report-x-v {
  font-weight: 600;
  color: #2d3436;
}
.report-x-ou {
  margin: 12px 0;
  padding: 10px 12px;
  background: #f8f9fb;
  border-radius: 8px;
}
.report-x-ou h5 {
  margin: 0 0 8px;
  font-size: 13px;
  color: #636e72;
}
.report-x-ou-hint {
  margin: 0 0 10px;
  font-size: 11px;
  color: #8e99a4;
  line-height: 1.45;
}
.report-ability-source {
  margin: 0 0 10px;
  font-size: 12px;
  color: #636e72;
  line-height: 1.45;
}
.report-radar-plot,
.score-bars-plot {
  min-width: 0;
}
.report-radar-canvas {
  width: 100%;
  height: 320px;
}
.report-chart-subtitle {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 700;
  color: #7f8c8d;
}
.report-chart-divider {
  display: none;
}
.report-overview-note,
.report-suggestions-note {
  margin: 0 0 12px;
  font-size: 12px;
  color: #8e99a4;
  line-height: 1.45;
}
.report-container .summary-num--text {
  font-size: clamp(11px, 2.6vw, 14px);
  font-weight: 600;
  line-height: 1.25;
  word-break: break-all;
  max-width: 100%;
}
.report-x-debug-block {
  border-top: 1px solid #eef2f5;
  padding-top: 4px;
}
.report-x-debug-list {
  margin: 0;
  padding-left: 1.2em;
  font-size: 13px;
  color: #2d3436;
  line-height: 1.6;
}
.report-x-debug-list li {
  margin-bottom: 6px;
}
.report-x-dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  margin: 0;
  font-size: 12px;
}
.report-x-dl dt {
  color: #8e99a4;
  max-width: 220px;
  line-height: 1.35;
}
.report-x-chart {
  width: min(980px, 100%);
  height: 320px;
  margin: 14px auto;
}
.report-x-cat {
  border: 1px solid #eef2f5;
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 12px;
  background: #fff;
}
.report-x-cat-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 10px;
}
.report-x-cat-head h4 {
  margin: 0;
  font-size: 15px;
  color: #2d3436;
}
.report-x-cat-score {
  font-size: 13px;
  font-weight: 600;
  color: #0984e3;
  white-space: nowrap;
}
.report-x-ind {
  border: 1px solid #f0f2f4;
  border-radius: 8px;
  padding: 6px 10px;
  margin-bottom: 8px;
  background: #fafbfc;
}
.report-x-ind summary {
  cursor: pointer;
  font-weight: 600;
  font-size: 13px;
  color: #444;
}
.report-x-ind-stats {
  font-size: 12px;
  color: #636e72;
  margin: 8px 0 4px;
}
.report-x-ind-medium {
  font-size: 12px;
  color: #2d3436;
  margin: 8px 0 4px;
}
.report-x-hits {
  margin: 6px 0 0;
  padding-left: 18px;
  font-size: 12px;
}
.report-x-hits li {
  margin-bottom: 10px;
}
.report-x-hit-turn {
  display: inline-block;
  margin-right: 8px;
  color: #b2bec3;
  font-size: 11px;
}
.report-x-hit-meta {
  display: block;
  color: #8e99a4;
  font-size: 11px;
  margin-bottom: 4px;
}
.report-x-hit-sentence {
  color: #2d3436;
  line-height: 1.45;
}
.report-x-hits-empty,
.report-x-hits-more {
  font-size: 12px;
  color: #8e99a4;
  margin: 6px 0 0;
}
.report-x-windows ul {
  margin: 6px 0 0;
  padding-left: 18px;
  font-size: 12px;
  color: #444;
}

/* 生成报告请求期间的加载层（高于 .report-overlay 的 z-index:1000） */
.report-loading-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
  background: rgba(15, 20, 30, 0.5);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  opacity: 0;
  transition: opacity 0.22s ease;
  pointer-events: auto;
}

/* 仅在课堂模拟主区域内遮罩：侧栏 / 顶栏菜单仍可点（z-index 低于移动端抽屉与菜单按钮） */
.report-loading-overlay--classroom-scoped {
  position: absolute;
  inset: 0;
  z-index: 60;
  padding: 16px;
}
.report-loading-overlay--show {
  opacity: 1;
}
.report-loading-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 32px 40px;
  border-radius: 16px;
  background: var(--app-bg-panel, #fff);
  border: 1px solid var(--app-border-default, #d7dde3);
  box-shadow: 0 16px 48px var(--app-shadow-color, rgba(31, 42, 55, 0.12));
  max-width: min(360px, 100%);
}

.report-loading-card--scoped {
  max-width: min(420px, 100%);
}

.report-loading-scoped-hint {
  margin: -8px 0 0;
  padding: 0 4px;
  font-size: 12px;
  line-height: 1.5;
  color: #636e72;
  text-align: center;
}

.report-loading-scoped-hint strong {
  color: #2d3436;
}

.report-special-jump {
  border-top: 1px solid rgba(45, 52, 54, 0.08);
  padding-top: 8px;
}

.report-special-rec {
  margin: 0 0 8px;
  font-size: 13px;
  line-height: 1.55;
  color: #2d3436;
}

.report-special-sub {
  margin: 0 0 14px;
  font-size: 12px;
  color: #636e72;
  line-height: 1.45;
}

.report-special-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
}

.report-special-btn {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 118px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(45, 52, 54, 0.14);
  background: #f8f9fb;
  color: #2d3436;
  text-align: left;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.report-special-btn:hover {
  background: #eef2f7;
  border-color: rgba(108, 92, 231, 0.35);
}

.report-special-btn.is-priority {
  border-color: rgba(108, 92, 231, 0.55);
  box-shadow: 0 0 0 2px rgba(108, 92, 231, 0.2);
  background: linear-gradient(180deg, #f5f3ff, #eef6ff);
}

.report-special-btn__score {
  font-size: 11px;
  font-weight: 800;
  color: #636e72;
  letter-spacing: 0.02em;
}

.report-special-btn__dim {
  font-size: 12px;
  font-weight: 800;
  color: #2d3436;
  line-height: 1.3;
}

.report-special-btn__who {
  font-size: 13px;
  font-weight: 900;
  color: #6c5ce7;
}

.report-special-btn:focus-visible {
  outline: 2px solid #6c5ce7;
  outline-offset: 2px;
}
@media (prefers-color-scheme: dark) {
  .report-loading-card {
    background: #1e2128;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
  }
  .report-loading-text {
    color: #dfe6e9;
  }
}
.report-loading-spinner {
  width: 48px;
  height: 48px;
  border: 3px solid rgba(108, 92, 231, 0.2);
  border-top-color: #6c5ce7;
  border-radius: 50%;
  animation: report-loading-spin 0.75s linear infinite;
}
@keyframes report-loading-spin {
  to {
    transform: rotate(360deg);
  }
}
.report-loading-text {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--app-text-primary, #1f2a37);
  text-align: center;
  line-height: 1.45;
}
.report-loading-progress {
  width: min(320px, 78vw);
  height: 8px;
  background: #edf0f4;
  border-radius: 999px;
  overflow: hidden;
}
.report-loading-progress-fill {
  height: 100%;
  width: 0;
  border-radius: 999px;
  background: linear-gradient(90deg, #6c5ce7, #00b894);
  transition: width 0.18s linear;
}
.report-loading-percent {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: #636e72;
}

@media (min-width: 769px) {
  /* 等宽两列 + 同高图区，雷达与条形图上下缘对齐、视觉更均衡 */
  .scores-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 20px 24px;
    align-items: stretch;
  }
  .report-radar-wrap,
  .score-bars {
    min-width: 0;
  }
  .report-radar-plot,
  .score-bars-plot {
    min-height: 400px;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .report-radar-plot {
    align-items: center;
  }
  .score-bars-plot {
    gap: 12px;
  }
  .report-radar-canvas {
    height: 400px;
  }
  .report-x-chart {
    height: 360px;
    margin-left: auto;
    margin-right: auto;
  }
}

@media (max-width: 768px) {
  .scores-row {
    align-items: stretch;
    gap: 10px;
  }
  .report-radar-wrap {
    min-height: 0;
  }
  .report-radar-plot,
  .score-bars-plot {
    min-height: 0;
  }
  .report-radar-canvas {
    height: 390px;
  }
  .score-bars {
    padding-top: 0;
  }
  .score-bars-plot {
    gap: 12px;
  }
  .report-chart-divider {
    display: block;
    height: 1px;
    margin: 2px 0 6px;
    background: linear-gradient(90deg, transparent 0%, #dfe6e9 14%, #dfe6e9 86%, transparent 100%);
  }
  .report-x-chart {
    height: 300px;
    margin: 10px auto 14px;
  }
}
</style>

