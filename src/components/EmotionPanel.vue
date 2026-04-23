<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  // { joy, activation, anxiety }
  emotion: { type: Object, default: null },
  // 当前学生（用于雷达图/路径分析期待目标）
  student: { type: Object, default: null }
})

const emotionState = ref({ joy: 0, activation: 0, anxiety: 0 })
const studentState = ref(null)

// =====================
// ECharts（折线 + 雷达）
// =====================
const lineEl = ref(null)
const lineChart = ref(null)
let lineResizeObserver = null
let lineTickCount = 0
let lineTimeLabels = []
let lineHistory = { joy: [], activation: [], anxiety: [] }

const radarEl = ref(null)
const radarChart = ref(null)
let radarResizeObserver = null
let resizeObserver = null

async function ensureEchartsLoaded() {
  if (window.echarts) return window.echarts
  if (ensureEchartsLoaded._p) return ensureEchartsLoaded._p

  ensureEchartsLoaded._p = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.type = 'text/javascript'
    script.async = true
    script.src = new URL('../../vendor/front/js/echarts.min.js', import.meta.url).href
    script.onload = () => resolve(window.echarts)
    script.onerror = reject
    document.head.appendChild(script)
  })

  return ensureEchartsLoaded._p
}

function clamp100(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, n))
}

/** 折线图图例：整体水平居中、项间距一致、与色块行高统一（ECharts 内置布局） */
const lineChartLegend = {
  type: 'plain',
  orient: 'horizontal',
  left: 'center',
  right: 'auto',
  top: 'auto',
  bottom: 0,
  padding: [0, 0, 0, 0],
  // 与 series.name 一一对应，保证三项样式同源
  data: [
    { name: '愉悦度' },
    { name: '激活度' },
    { name: '焦虑度' }
  ],
  itemGap: 20,
  itemWidth: 20,
  itemHeight: 5,
  icon: 'roundRect',
  itemStyle: {
    borderWidth: 0
  },
  textStyle: {
    color: '#8e99a4',
    fontSize: 11,
    lineHeight: 20,
    fontWeight: 500
  }
}

// 折线图 option（smooth + 网格辅助线）
function getLineOption() {
  const ec = window.echarts
  return {
    tooltip: {
      trigger: 'axis',
      triggerOn: 'mousemove|click',
      show: true,
      // 挂到 body，避免被 .dashboard / 卡片 overflow 裁掉导致「悬停全看不到」
      confine: false,
      appendToBody: true,
      className: 'ep-linechart-tooltip',
      backgroundColor: 'rgba(30,30,50,0.92)',
      borderColor: 'rgba(255,255,255,0.12)',
      borderWidth: 1,
      textStyle: { color: '#fff', fontSize: 12 },
      extraCssText: 'border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,0.2);z-index:20000;',
      axisPointer: {
        type: 'line',
        z: 1,
        lineStyle: { color: 'rgba(99, 102, 241, 0.45)', width: 1, type: 'dashed' }
      },
      formatter(params) {
        if (params == null) return '暂无数据'
        const list = Array.isArray(params) ? params : [params]
        if (!list.length) return '暂无数据'
        const p0 = list[0]
        const title = String(
          p0.axisValueLabel ?? p0.axisValue ?? p0.name ?? ''
        )
        const head = title
          ? `<div style="font-weight:600;margin-bottom:6px;opacity:0.95;">${title}</div>`
          : ''
        const body = list
          .map((p) => {
            const raw = p.value != null && p.value !== '' ? p.value : p.data
            const n = Number(raw)
            const val = raw == null || raw === '' || Number.isNaN(n) ? '—' : Math.round(n)
            const m = p.marker != null && p.marker !== '' ? p.marker : '●'
            const sn = p.seriesName != null && p.seriesName !== '' ? p.seriesName : '—'
            return `${m} ${sn}：<b>${val}</b>`
          })
          .join('<br/>')
        return head + body
      }
    },
    legend: { ...lineChartLegend },
    grid: {
      top: 16,
      right: 10,
      bottom: 38,
      left: 32,
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: [],
      axisLine: { lineStyle: { color: '#E5E7EB' } },
      axisLabel: { color: '#8e99a4', fontSize: 10 },
      boundaryGap: false
    },
    yAxis: {
      type: 'value',
      scale: true,
      min: (v) => {
        const a = v.min
        const b = v.max
        if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
        if (b - a < 0.5) return Math.max(0, a - 14)
        return Math.max(0, a - 12)
      },
      max: (v) => {
        const a = v.min
        const b = v.max
        if (!Number.isFinite(a) || !Number.isFinite(b)) return 100
        if (b - a < 0.5) return Math.min(100, b + 14)
        return Math.min(100, b + 12)
      },
      splitLine: { lineStyle: { color: '#F3F4F6', type: 'dashed' } },
      axisLabel: { color: '#8e99a4', fontSize: 10 }
    },
    series: [
      {
        name: '愉悦度',
        type: 'line',
        smooth: 0.45,
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { 
          width: 3, 
          color: '#34D399',
          shadowBlur: 8,
          shadowColor: 'rgba(52, 211, 153, 0.35)'
        },
        itemStyle: { 
          color: '#34D399',
          borderColor: '#fff',
          borderWidth: 1
        },
        areaStyle: {
          color: new ec.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(52,211,153,0.25)' },
            { offset: 1, color: 'rgba(52,211,153,0.02)' }
          ])
        },
        data: []
      },
      {
        name: '激活度',
        type: 'line',
        smooth: 0.45,
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { 
          width: 3, 
          color: '#60A5FA',
          shadowBlur: 8,
          shadowColor: 'rgba(96, 165, 250, 0.35)'
        },
        itemStyle: { 
          color: '#60A5FA',
          borderColor: '#fff',
          borderWidth: 1
        },
        areaStyle: {
          color: new ec.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(96,165,250,0.25)' },
            { offset: 1, color: 'rgba(96,165,250,0.02)' }
          ])
        },
        data: []
      },
      {
        name: '焦虑度',
        type: 'line',
        smooth: 0.45,
        symbol: 'triangle',
        symbolSize: 6,
        lineStyle: { width: 2.5, color: '#F87171' },
        itemStyle: { color: '#F87171' },
        areaStyle: {
          color: new ec.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(248,113,113,0.25)' },
            { offset: 1, color: 'rgba(248,113,113,0.02)' }
          ])
        },
        data: []
      }
    ]
  }
}

async function initLineChart() {
  const echarts = await ensureEchartsLoaded()
  if (!lineEl.value) return
  lineChart.value = echarts.init(lineEl.value, null, { renderer: 'canvas' })
  lineChart.value.setOption(getLineOption(), true)
}

function updateLineSeries() {
  if (!lineChart.value) return
  lineChart.value.setOption({
    xAxis: { data: [...lineTimeLabels] },
    series: [
      { data: [...lineHistory.joy] },
      { data: [...lineHistory.activation] },
      { data: [...lineHistory.anxiety] }
    ],
    // 合并更新后仍保持：悬浮、图例布局
    tooltip: { show: true, confine: false, appendToBody: true },
    legend: { ...lineChartLegend }
  })
}

function resetLineChartHistory() {
  lineTickCount = 0
  lineTimeLabels = []
  lineHistory = { joy: [], activation: [], anxiety: [] }

  if (lineChart.value) {
    lineChart.value.setOption({
      xAxis: { data: [] },
      series: [{ data: [] }, { data: [] }, { data: [] }]
    })
  }
}

function pushEmotionPoint(nextEmotion) {
  if (!nextEmotion) return
  const joy = clamp100(nextEmotion.joy)
  const activation = clamp100(nextEmotion.activation)
  const anxiety = clamp100(nextEmotion.anxiety)

  lineTickCount += 1
  lineTimeLabels.push(`T${lineTickCount}`)

  lineHistory.joy.push(Math.round(joy))
  lineHistory.activation.push(Math.round(activation))
  lineHistory.anxiety.push(Math.round(anxiety))

  // 限制长度，保持布局稳定
  const limit = 15
  if (lineTimeLabels.length > limit) {
    lineTimeLabels.shift()
    lineHistory.joy.shift()
    lineHistory.activation.shift()
    lineHistory.anxiety.shift()
  }

  updateLineSeries()
}

function getRadarOption(echarts, character) {
  if (!character) return null

  const { traitLabels, traits, name, color } = character
  return {
    radar: {
      center: ['50%', '50%'],
      // 在卡片内占更大比例，压掉四周留白（需与容器 min-height 配合避免裁字）
      radius: '70%',
      nameGap: 4,
      indicator: traitLabels.map((n) => ({ name: n, max: 100 })),
      shape: 'polygon',
      splitNumber: 4,
      axisName: { 
        color: '#1f2a37',
        fontSize: 12,
        lineHeight: 16,
        fontWeight: 600,
        padding: [2, 1, 2, 1]
      },
      splitLine: { 
        lineStyle: { 
          color: '#E5E7EB', 
          width: 1 
        } 
      },
      splitArea: { areaStyle: { color: ['rgba(255,255,255,0)', 'rgba(255,255,255,0)'] } },
      axisLine: { lineStyle: { color: '#E5E7EB' } }
    },
    series: [
      {
        type: 'radar',
        data: [
          {
            value: [traits.confidence, traits.expressiveness, traits.anxiety, traits.motivation, traits.socialSkill],
            name,
            lineStyle: { 
              color: '#4A90E2', 
              width: 2.5 
            },
            areaStyle: { 
              color: 'rgba(74, 144, 226, 0.16)' 
            },
            itemStyle: { 
              color: '#4A90E2',
              borderColor: '#4A90E2',
              borderWidth: 2
            },
            symbol: 'circle',
            symbolSize: 6,
            symbolRotate: 0
          }
        ],
        animationDuration: 800,
        animationEasing: 'elasticOut'
      }
    ]
  }
}

const TRAITS_BY_STUDENT_ID = {
  dazhi: {
    name: '李大志',
    color: '#F87171',
    traitLabels: ['自信心', '表达力', '焦虑度', '学习动力', '社交能力'],
    traits: { confidence: 15, expressiveness: 25, anxiety: 85, motivation: 20, socialSkill: 30 }
  },
  yiming: {
    name: '张一鸣',
    color: '#60A5FA',
    traitLabels: ['自信心', '表达力', '焦虑度', '学习动力', '社交能力'],
    traits: { confidence: 80, expressiveness: 90, anxiety: 20, motivation: 65, socialSkill: 85 }
  },
  xiaorou: {
    name: '林暖暖',
    color: '#A78BFA',
    traitLabels: ['自信心', '表达力', '焦虑度', '学习动力', '社交能力'],
    traits: { confidence: 35, expressiveness: 55, anxiety: 70, motivation: 50, socialSkill: 60 }
  }
}

function buildCharacterForRadar(student) {
  if (!student) return null
  const base = TRAITS_BY_STUDENT_ID[student.id]
  if (!base) return null
  return {
    ...base,
    ...student,
    // 允许外部（例如工作流动态情绪映射）覆盖 traits，更新雷达图
    traits: student.traits || base.traits,
    traitLabels: student.traitLabels || base.traitLabels
  }
}

async function initRadarChart() {
  const echarts = await ensureEchartsLoaded()
  if (!radarEl.value) return
  radarChart.value = echarts.init(radarEl.value, null, { renderer: 'canvas' })
}

function updateRadarChart(student) {
  if (!radarChart.value) return
  const echarts = window.echarts
  const character = buildCharacterForRadar(student)
  const option = character ? getRadarOption(echarts, character) : null
  if (!option) return
  radarChart.value.setOption(option, true)
  nextTick(() => radarChart.value?.resize())
}

// =====================
// 情绪条（右侧当前状态）
// =====================
const EMOTION_LABELS = {
  joy: { name: '愉悦度', color: '#34D399', icon: '😊' },
  activation: { name: '激活度', color: '#60A5FA', icon: '⚡' },
  anxiety: { name: '焦虑度', color: '#F87171', icon: '😰' }
}

const STATUS_THRESHOLDS = [
  { condition: (e) => e.anxiety > 80, label: '极度焦虑', color: '#EF4444', icon: '/icons/extreme-anxiety.png' },
  { condition: (e) => e.anxiety > 60, label: '有点紧张', color: '#F87171', icon: '/icons/anxiety2.png' },
  { condition: (e) => e.joy > 70 && e.anxiety < 30, label: '深受鼓舞', color: '#10B981', icon: '/icons/inspired.png' },
  { condition: (e) => e.joy > 50, label: '心情不错', color: '#34D399', icon: '/icons/joy2.png' },
  { condition: (e) => e.activation > 70, label: '非常活跃', color: '#F59E0B', icon: '/icons/activation.png' },
  { condition: (e) => e.activation < 20, label: '昏昏欲睡', color: '#9CA3AF', icon: '/icons/sleepy.png' },
  { condition: () => true, label: '状态一般', color: '#6B7280', icon: '/icons/natural.png' }
]
const status = computed(() => {
  const e = emotionState.value
  for (const t of STATUS_THRESHOLDS) {
    if (t.condition(e)) return t
  }
  return STATUS_THRESHOLDS[STATUS_THRESHOLDS.length - 1]
})

function getBarGradient(key, val) {
  const baseColor = EMOTION_LABELS[key].color
  if (key === 'anxiety' && val > 70) return 'linear-gradient(90deg, #F87171, #EF4444)'
  if (key === 'joy' && val > 60) return 'linear-gradient(90deg, #34D399, #10B981)'
  return `linear-gradient(90deg, ${baseColor}aa, ${baseColor})`
}

function updateBars(nextEmotion) {
  if (!nextEmotion) return
  emotionState.value = {
    joy: clamp100(nextEmotion.joy),
    activation: clamp100(nextEmotion.activation),
    anxiety: clamp100(nextEmotion.anxiety)
  }
}

// =====================
// 个性化路径分析（图3可视化复刻）
// =====================
const pathTriggers = ['鼓励', '安抚', '互动', '提问', '批评']

// 进度条颜色映射：模板中会用到 triggerColors[a.trigger]
// 颜色可按“期望/推荐路径”语义自行调整
const triggerColors = {
  鼓励: '#34D399',
  安抚: '#60A5FA',
  互动: '#A78BFA',
  提问: '#FBBF24',
  批评: '#F87171'
}

// 期待/状态映射（来自旧版 PATH_PROFILES）
const PATH_PROFILES = {
  dazhi: {
    ideal: { 鼓励: 35, 安抚: 30, 互动: 20, 提问: 10, 批评: 5 },
    recommended: ['鼓励', '安抚'],
    neutral: ['互动', '提问'],
    harmful: ['批评']
  },
  yiming: {
    ideal: { 互动: 30, 提问: 25, 鼓励: 20, 批评: 15, 安抚: 10 },
    recommended: ['互动', '提问'],
    neutral: ['鼓励', '批评'],
    harmful: []
  },
  xiaorou: {
    ideal: { 安抚: 30, 鼓励: 30, 互动: 25, 提问: 10, 批评: 5 },
    recommended: ['安抚', '鼓励'],
    neutral: ['互动'],
    harmful: ['批评', '提问']
  }
}

const studentNameToProfileKey = {
  '李大志': 'dazhi',
  '张一鸣': 'yiming',
  '林暖暖': 'xiaorou'
}

const statusTextToCssClass = (statusText) => {
  if (statusText === '推荐') return 'recommended'
  if (statusText === '慎用') return 'harmful'
  return 'neutral'
}

function getStatusText(profile, trigger) {
  if (!profile) return '适度'
  if (profile.recommended.includes(trigger)) return '推荐'
  if (profile.harmful.includes(trigger)) return '慎用'
  if (profile.neutral.includes(trigger)) return '适度'
  return '适度'
}

const pathAnalysisData = ref({
  actions: pathTriggers.map((trigger) => ({
    trigger,
    actionName: trigger,
    statusText: '适度',
    expectedPct: 0,
    actualPct: 0
  }))
})

const pathActualCounts = ref({
  total: 0,
  byTrigger: pathTriggers.reduce((acc, t) => {
    acc[t] = 0
    return acc
  }, {})
})

/** 切换人格时保留右侧折线 + 路径分析实际统计（按学生 id） */
const dashboardSnapshotsByCharId = ref({})

function takeDashboardSnapshot(charId) {
  if (charId == null || charId === '') return
  const id = String(charId)
  dashboardSnapshotsByCharId.value = {
    ...dashboardSnapshotsByCharId.value,
    [id]: {
      lineTickCount,
      lineTimeLabels: [...lineTimeLabels],
      lineHistory: {
        joy: [...lineHistory.joy],
        activation: [...lineHistory.activation],
        anxiety: [...lineHistory.anxiety]
      },
      pathActualCounts: JSON.parse(JSON.stringify(pathActualCounts.value))
    }
  }
}

function restoreDashboardSnapshot(charId, student) {
  const id = charId != null && charId !== '' ? String(charId) : ''
  const snap = id ? dashboardSnapshotsByCharId.value[id] : null
  if (snap) {
    lineTickCount = snap.lineTickCount
    lineTimeLabels = [...snap.lineTimeLabels]
    lineHistory = {
      joy: [...snap.lineHistory.joy],
      activation: [...snap.lineHistory.activation],
      anxiety: [...snap.lineHistory.anxiety]
    }
    pathActualCounts.value = JSON.parse(JSON.stringify(snap.pathActualCounts))
    recomputeActualPcts()
  } else {
    resetLineChartHistory()
    resetPathAnalysis(student)
  }
  if (student) updatePathTarget(student.name || student.id)
  updateLineSeries()
}

function clearAllCharacterDashboardSnapshots() {
  dashboardSnapshotsByCharId.value = {}
}

function recomputeActualPcts() {
  const total = Math.max(1, pathActualCounts.value.total)
  for (const a of pathAnalysisData.value.actions) {
    const c = pathActualCounts.value.byTrigger[a.trigger] || 0
    a.actualPct = Math.round((c / total) * 100)
  }
}

function updatePathTarget(studentNameOrId) {
  const key = PATH_PROFILES[studentNameOrId]
    ? studentNameOrId
    : studentNameToProfileKey[studentNameOrId] || 'dazhi'

  const profile = PATH_PROFILES[key]
  for (const a of pathAnalysisData.value.actions) {
    a.expectedPct = profile.ideal[a.trigger] ?? 0
    a.statusText = getStatusText(profile, a.trigger)
  }

  // 若当前实际为 0，也同步下 expected 对 UI 的展示
  recomputeActualPcts()
}

function recordTeacherTrigger(trigger) {
  // total 分母：每次老师发言算一次（包括 trigger 为空的自由输入）
  pathActualCounts.value.total += 1
  if (trigger && pathTriggers.includes(trigger)) {
    pathActualCounts.value.byTrigger[trigger] = (pathActualCounts.value.byTrigger[trigger] || 0) + 1
  }
  recomputeActualPcts()
}

function resetPathAnalysis(nextStudent) {
  pathActualCounts.value.total = 0
  for (const t of pathTriggers) pathActualCounts.value.byTrigger[t] = 0
  recomputeActualPcts()

  if (nextStudent) {
    updatePathTarget(nextStudent.name || nextStudent.id)
  }
}

// =====================
// 对外接口：供 App 调用
// =====================
function updateEmotions(payload) {
  if (!payload || typeof payload !== 'object') return

  // 兼容 payload.emotion 或直接传 {joy,activation,anxiety}
  const nextEmotion = payload.emotion || payload
  if (nextEmotion) updateBars(nextEmotion)

  const nextStudent = payload.student || payload.character || payload.currentStudent
  if (nextStudent) {
    studentState.value = nextStudent
    updateRadarChart(studentState.value)
    // 更新路径期待值（让“不同学生的期待目标”自动刷新）
    updatePathTarget(nextStudent.name || nextStudent.id)
  }
}

function resetEmotions(nextStudent) {
  emotionState.value = { joy: 0, activation: 0, anxiety: 0 }
  if (nextStudent) studentState.value = nextStudent

  updateRadarChart(studentState.value)
  resetLineChartHistory()
  resetPathAnalysis(nextStudent)
}

defineExpose({
  updateEmotions,
  resetEmotions,
  pushEmotionPoint,
  updatePathTarget,
  recordTeacherTrigger,
  clearAllCharacterDashboardSnapshots
})

// =====================
// 生命周期/监听
// =====================
watch(
  () => props.student?.id,
  (newId, oldId) => {
    if (oldId !== undefined && oldId !== null && oldId !== '') {
      takeDashboardSnapshot(oldId)
    }
    restoreDashboardSnapshot(
      newId != null && newId !== '' ? newId : null,
      props.student
    )
  },
  { flush: 'pre' }
)

watch(
  () => props.emotion,
  (e) => {
    if (!e) return
    updateBars(e)
  },
  { deep: true, immediate: true }
)

watch(
  () => props.student,
  (s) => {
    if (!s) return
    studentState.value = s
    updateRadarChart(s)
    updatePathTarget(s.name || s.id)
  },
  { deep: true, immediate: true }
)

onMounted(async () => {
  await initRadarChart()
  // 解决时序问题：watch(props.student, { immediate: true }) 可能在雷达图初始化前就触发，
  // 导致第一次 updateRadarChart() 因 radarChart.value 为空而被提前返回；初始化完成后再补一次渲染。
  updateRadarChart(studentState.value)
  await initLineChart()

  await nextTick()

  if (radarEl.value && 'ResizeObserver' in window) {
    radarResizeObserver = new ResizeObserver(() => {
      radarChart.value && radarChart.value.resize()
    })
    radarResizeObserver.observe(radarEl.value)
  }

  if (lineEl.value && 'ResizeObserver' in window) {
    lineResizeObserver = new ResizeObserver(() => {
      lineChart.value && lineChart.value.resize()
    })
    lineResizeObserver.observe(lineEl.value)
  }

  window.addEventListener('resize', () => {
    radarChart.value && radarChart.value.resize()
    lineChart.value && lineChart.value.resize()
  })

  // 初始写入一次折线历史，让图不至于空白
  if (emotionState.value) pushEmotionPoint(emotionState.value)
})

onBeforeUnmount(() => {
  if (resizeObserver && radarEl.value) resizeObserver.unobserve(radarEl.value)
  resizeObserver = null

  if (radarResizeObserver && radarEl.value) radarResizeObserver.unobserve(radarEl.value)
  radarResizeObserver = null

  if (lineResizeObserver && lineEl.value) lineResizeObserver.unobserve(lineEl.value)
  lineResizeObserver = null

  if (radarChart.value) {
    radarChart.value.dispose()
    radarChart.value = null
  }
  if (lineChart.value) {
    lineChart.value.dispose()
    lineChart.value = null
  }
})
</script>

<template>
  <aside class="dashboard">
    <!-- 外层背景与 header -->
    <div class="dashboard-inner">
        <div class="dash-header">
        <h2 class="dash-header-title">
          <img src="/icons/emotion-monitor.png" class="dash-header-icon" alt="" />
          实时情绪监测
        </h2>
      </div>


      <!-- 卡片 1：当前状态 + 情绪指标 -->
      <div class="ep-card">
        <div class="ep-card-title">当前状态</div>
        <div class="status-badge-wrap">
          <span
            id="emotion-status"
            class="status-badge"
            :style="{
              background: status.color + '18',
              color: status.color,
              borderColor: status.color + '40'
            }"
          >
            <img v-if="status.icon" :src="status.icon" class="status-icon" alt="" />
            <span class="status-badge-text">{{ status.label }}</span>
          </span>
        </div>

        <div class="ep-card-title mt-4">情绪指标</div>
        <div class="emotion-bars">
          <div class="emo-bar-item">
            <div class="emo-bar-label">
              <span class="emo-name-wrap">
                <img src="/icons/joy.png" class="emo-bar-icon" alt="" />
                <span>愉悦度</span>
              </span>
              <span id="val-joy" class="emo-bar-val">{{ Math.round(clamp100(emotionState.joy)) }}</span>
            </div>
            <div class="emo-bar-track">
              <div
                id="bar-joy"
                class="emo-bar-fill"
                :style="{
                  width: clamp100(emotionState.joy) + '%',
                  background: getBarGradient('joy', clamp100(emotionState.joy))
                }"
              ></div>
            </div>
          </div>

          <div class="emo-bar-item">
            <div class="emo-bar-label">
              <span class="emo-name-wrap">
                <img src="/icons/activation.png" class="emo-bar-icon" alt="" />
                <span>激活度</span>
              </span>
              <span id="val-activation" class="emo-bar-val">{{
                Math.round(clamp100(emotionState.activation))
              }}</span>
            </div>
            <div class="emo-bar-track">
              <div
                id="bar-activation"
                class="emo-bar-fill"
                :style="{
                  width: clamp100(emotionState.activation) + '%',
                  background: getBarGradient('activation', clamp100(emotionState.activation))
                }"
              ></div>
            </div>
          </div>

          <div class="emo-bar-item">
            <div class="emo-bar-label">
              <span class="emo-name-wrap">
                <img src="/icons/anxiety.png" class="emo-bar-icon" alt="" />
                <span>焦虑度</span>
              </span>
              <span id="val-anxiety" class="emo-bar-val">{{ Math.round(clamp100(emotionState.anxiety)) }}</span>
            </div>
            <div class="emo-bar-track">
              <div
                id="bar-anxiety"
                class="emo-bar-fill"
                :style="{
                  width: clamp100(emotionState.anxiety) + '%',
                  background: getBarGradient('anxiety', clamp100(emotionState.anxiety))
                }"
              ></div>
            </div>
          </div>
        </div>
      </div>

      <!-- 卡片 2：个性化路径分析 -->
      <div class="ep-card">
        <div class="ep-card-title ep-card-title--with-icon ep-card-title--center">
          <img src="/icons/path-analysis.png" class="ep-title-icon" alt="" />
          个性化路径分析
        </div>
        <div id="path-compare" class="path-compare">
          <div v-for="a in pathAnalysisData.actions" :key="a.trigger" class="path-bar-item">
            <div class="path-action-row">
              <div class="path-action-name">{{ a.actionName }}</div>
              <span
                class="path-label-tag"
                :class="statusTextToCssClass(a.statusText)"
              >
                {{ a.statusText }}
              </span>

              <div class="path-dual-track path-dual-track-flex">
                <div
                  class="path-bar-ideal"
                  :style="{
                    width: a.expectedPct + '%',
                    background: triggerColors[a.trigger]
                  }"
                ></div>
                <div
                  class="path-bar-actual"
                  :style="{
                    width: a.actualPct + '%',
                    background: triggerColors[a.trigger]
                  }"
                ></div>
              </div>
            </div>

            <div class="path-bar-labels">
              <span>期待 {{ a.expectedPct }}%</span>
              <span>实际 {{ a.actualPct }}%</span>
            </div>
          </div>
        </div>
        <div id="path-warning-area" class="path-warning-area"></div>
      </div>

      <!-- 卡片 3：五维人格画像（栏收窄后仍放大雷达主体，折线图高度单独保持） -->
      <div class="ep-card ep-card--chart ep-card--radar">
        <div class="ep-card-title ep-card-title--radar-heading">五维人格画像</div>
        <div id="personality-radar" ref="radarEl" class="ep-chart ep-chart--radar" style="width: 100%"></div>
      </div>

      <!-- 卡片 4：情绪波动曲线（容器勿裁切 ECharts 悬浮层；appendToBody 为首选） -->
      <div class="ep-card ep-card--chart ep-card--linechart">
        <div class="ep-card-title">情绪波动曲线</div>
        <div id="emotion-chart" ref="lineEl" class="ep-chart" style="width: 100%; height: 228px"></div>
      </div>
    </div>
  </aside>
</template>

<style>
@import '../../vendor/front/css/style.css';

/* ==================== 外层背景容器（强制修复！） ==================== */
.dashboard {
  background: #F4F6F9 !important;
  border-left: none !important;
}

.dashboard-inner {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ==================== 独立卡片组件 ==================== */
.ep-card {
  background: #FFFFFF;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
  padding: 24px;
}

.ep-card-title {
  font-size: 12px;
  font-weight: 600;
  color: #6B7280;
  margin-bottom: 16px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.ep-card-title.mt-4 {
  margin-top: 24px;
}

/* 图表卡：略减左右内边距，为 ECharts 多留出绘制宽度，避免轴标签被裁切 */
.ep-card--chart {
  padding-left: 16px;
  padding-right: 16px;
}

.ep-card--chart .ep-chart {
  min-width: 0;
  width: 100% !important;
  box-sizing: border-box;
}

/* 五维雷达：压缩标题上留白、加高图形容器，与 ECharts radius 一起减少「字小、空多」观感 */
.ep-card--radar {
  padding-top: 12px;
  padding-bottom: 12px;
}

.ep-card-title--radar-heading {
  font-size: 14px !important;
  font-weight: 700 !important;
  letter-spacing: 0.06em !important;
  color: #1f2a37 !important;
  margin-bottom: 6px !important;
  text-transform: none !important;
}

.ep-card--radar .ep-card-title {
  margin-bottom: 6px;
}

#personality-radar.ep-chart--radar {
  height: 320px;
  min-height: 320px;
}

/* 折线图：不裁切 ECharts 悬浮层，避免 tip 在卡片内为不可见；appendToBody 时此处为双保险 */
.ep-card--linechart {
  overflow: visible;
  position: relative;
  z-index: 2;
}

#emotion-chart {
  position: relative;
  overflow: visible;
}

/* ==================== 保留原有布局样式但调整 ==================== */
.dash-header {
  padding: 0 0 16px 0 !important;
  border-bottom: none !important;
}

.dash-section {
  padding: 0 !important;
  border-bottom: none !important;
}

/* 个性化路径分析：高级圆角卡片 + Flex 单行布局复刻图3 */
.path-analysis-card {
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 14px;
  padding: 12px 12px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.06);
}

.path-action-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.path-action-name {
  display: flex;
  align-items: center;
  width: 56px;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
  color: var(--text);
}

.path-dual-track-flex {
  flex: 1;
  min-width: 0;
  margin-left: 0;
}

.emo-bar-track {
  height: 6px !important;
}

.path-dual-track {
  height: 12px !important;
}

/* 更贴近“圆角进度条”观感：让实际/期待更明显 */
.path-bar-ideal {
  opacity: 0.35;
}

/* 由于旧版 CSS 只对 `.path-bar-head .path-label-tag` 做了基础样式，这里补全（强制修复不折行、不被挤压！ */
.path-label-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  padding: 3px 9px;
  border-radius: 10px;
  font-weight: 600;
  line-height: 1.2;
  min-height: 24px;
  box-sizing: border-box;
  white-space: nowrap;
  flex-shrink: 0;
}

/* 白底看板标题：覆盖全局 h2 的 var(--text-h)，避免系统深色主题下标题变成近白字 */
.dashboard .dash-header h2,
.dashboard .dash-header-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 16px;
  line-height: 1.3;
  color: #1a1d23;
  font-weight: 700;
  letter-spacing: 0.03em;
}

.dash-header-icon {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  display: block;
  object-fit: contain;
}

/* ===== B2B 数据看板化补丁：追加到 EmotionPanel.vue 底部 ===== */

/* 1) 外层与卡片：扁平化、收敛圆角、去厚重阴影 */
.dashboard {
  background: var(--app-bg-subtle) !important;
  border-left: none !important;
}

.dashboard-inner {
  gap: 12px !important;
}

.ep-card,
.path-analysis-card,
.dash-section {
  background: var(--app-bg-panel) !important;
  border: 1px solid var(--app-border-default) !important;
  border-radius: 12px !important;
  box-shadow: none !important;
}

/* 2) 标题与正文：克制、专业 */
.ep-card-title {
  color: var(--app-text-secondary) !important;
  letter-spacing: 0.04em !important;
}

.ep-card-title--with-icon {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 仅「个性化路径分析」等需要标题整行居中时加此类 */
.ep-card-title--center {
  justify-content: center;
  width: 100%;
  box-sizing: border-box;
  text-align: center;
}

.ep-title-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  display: block;
  object-fit: contain;
}

.dashboard .dash-header h2,
.dashboard .dash-header-title {
  color: var(--app-text-primary) !important;
  font-weight: 700 !important;
}

/* 3) 进度条：压薄 + 低干扰轨道 */
.emo-bar-track {
  height: 8px !important;
  background: var(--app-bg-muted) !important;
  border-radius: 999px !important;
  box-shadow: none !important;
}

.emo-bar-fill {
  height: 100% !important;
  border-radius: 999px !important;
  box-shadow: none !important;
}

/* 覆盖内联渐变色：改为主题色 */
#bar-joy {
  background: var(--app-color-pleasure) !important;
}
#bar-activation {
  background: var(--app-color-primary) !important;
}
#bar-anxiety {
  background: var(--app-color-anxiety) !important;
}

/* 路径对比条：更细、更克制 */
.path-dual-track {
  height: 8px !important;
  background: var(--app-bg-muted) !important;
  border-radius: 999px !important;
  box-shadow: none !important;
}

.path-bar-ideal,
.path-bar-actual {
  border-radius: 999px !important;
  box-shadow: none !important;
  filter: saturate(0.78) brightness(0.95) !important;
}

.path-bar-ideal {
  opacity: 0.35 !important;
}
.path-bar-actual {
  opacity: 0.72 !important;
}

/* 4) 标签/徽章：降噪（淡底 + 细边 + 主题色文字） */
.status-badge,
.path-label-tag {
  background: var(--app-bg-subtle) !important;
  border: 1px solid var(--app-border-default) !important;
  color: var(--app-text-secondary) !important;
  box-shadow: none !important;
}

/* 状态徽章内：图标 + 文字垂直居中对齐 */
.dashboard .status-badge,
#emotion-status.status-badge {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 8px;
  line-height: 1.25;
  padding: 8px 18px !important;
  vertical-align: middle;
}

#emotion-status .status-icon {
  width: 22px !important;
  height: 22px !important;
  margin: 0 !important;
  flex-shrink: 0;
  display: block;
  object-fit: contain;
}

.status-badge-text {
  line-height: 1.3;
  display: inline-block;
}

/* 推荐 / 适度 / 慎用 语义色（不再高饱和） */
.path-label-tag.recommended {
  background: color-mix(in srgb, var(--app-color-pleasure) 10%, var(--app-bg-panel)) !important;
  border-color: color-mix(in srgb, var(--app-color-pleasure) 35%, var(--app-border-default)) !important;
  color: var(--app-color-pleasure) !important;
}

.path-label-tag.neutral {
  background: color-mix(in srgb, var(--app-color-primary) 8%, var(--app-bg-panel)) !important;
  border-color: color-mix(in srgb, var(--app-color-primary) 30%, var(--app-border-default)) !important;
  color: var(--app-color-primary) !important;
}

.path-label-tag.harmful {
  background: color-mix(in srgb, var(--app-color-anxiety) 10%, var(--app-bg-panel)) !important;
  border-color: color-mix(in srgb, var(--app-color-anxiety) 35%, var(--app-border-default)) !important;
  color: var(--app-color-anxiety) !important;
}

/* 状态徽章统一弱化（覆盖原先内联 style） */
#emotion-status.status-badge {
  background: var(--app-bg-subtle) !important;
  border-color: var(--app-border-default) !important;
  color: var(--app-text-secondary) !important;
}

/* 细节：数字与辅助信息更“看板化” */
.emo-bar-val,
.path-bar-labels,
.path-compare .path-action-name {
  color: var(--app-text-secondary) !important;
}

/* 强制修复进度条宽度和间距 */
.emo-bar-item {
  margin-bottom: 16px !important;
}
.emo-bar-item:last-child {
  margin-bottom: 0 !important;
}
.emo-bar-label {
  display: flex !important;
  justify-content: space-between !important;
  align-items: center !important;
  margin-bottom: 8px !important;
}
.emo-bar-track {
  display: block !important;
  width: 100% !important;
  height: 8px !important;
  background: var(--app-bg-muted) !important;
  border-radius: 999px !important;
  overflow: hidden !important;
}
.emo-bar-fill {
  max-width: 100% !important;
}

.emo-name-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.emo-name-wrap > span {
  line-height: 1.3;
}

.emo-bar-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  display: block;
  object-fit: contain;
}

/* ===== 修复个性化路径分析进度条溢出 ===== */
.path-dual-track-flex {
  flex: 1 1 0% !important;
  min-width: 0 !important; /* 核心修复：干掉原代码里硬编码的 150px */
}

.path-action-row {
  width: 100% !important;
  box-sizing: border-box !important;
  display: flex !important;
  align-items: center !important;
  gap: 10px !important;
}

.path-compare {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.path-bar-item {
  min-width: 0;
}

.path-bar-labels {
  display: flex !important;
  justify-content: space-between !important;
  align-items: baseline;
  width: 100%;
  margin-top: 6px !important;
  font-size: 11px !important;
  line-height: 1.35 !important;
  gap: 8px;
}

.status-badge-wrap {
  display: flex;
  justify-content: center;
}

</style>

