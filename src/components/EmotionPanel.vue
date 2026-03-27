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

// 折线图 option（smooth + 网格辅助线）
function getLineOption() {
  const ec = window.echarts
  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(30,30,50,0.85)',
      borderColor: 'transparent',
      textStyle: { color: '#fff', fontSize: 12 }
    },
    legend: {
      data: ['愉悦度', '激活度', '焦虑度'],
      bottom: 0,
      textStyle: { color: '#8e99a4', fontSize: 11 },
      itemWidth: 12,
      itemHeight: 8
    },
    grid: {
      top: 10,
      right: 15,
      bottom: 35,
      left: 40,
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: [],
      axisLine: { lineStyle: { color: '#dfe6e9' } },
      axisLabel: { color: '#8e99a4', fontSize: 10 },
      boundaryGap: false
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      splitLine: { lineStyle: { color: '#f0f0f0', type: 'dashed' } },
      axisLabel: { color: '#8e99a4', fontSize: 10 }
    },
    series: [
      {
        name: '愉悦度',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { width: 2.5, color: '#2ecc71' },
        itemStyle: { color: '#2ecc71' },
        areaStyle: {
          color: new ec.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(46,204,113,0.25)' },
            { offset: 1, color: 'rgba(46,204,113,0.02)' }
          ])
        },
        data: []
      },
      {
        name: '激活度',
        type: 'line',
        smooth: true,
        symbol: 'diamond',
        symbolSize: 6,
        lineStyle: { width: 2.5, color: '#3498db' },
        itemStyle: { color: '#3498db' },
        areaStyle: {
          color: new ec.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(52,152,219,0.25)' },
            { offset: 1, color: 'rgba(52,152,219,0.02)' }
          ])
        },
        data: []
      },
      {
        name: '焦虑度',
        type: 'line',
        smooth: true,
        symbol: 'triangle',
        symbolSize: 6,
        lineStyle: { width: 2.5, color: '#e74c3c' },
        itemStyle: { color: '#e74c3c' },
        areaStyle: {
          color: new ec.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(231,76,60,0.25)' },
            { offset: 1, color: 'rgba(231,76,60,0.02)' }
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
    ]
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
      indicator: traitLabels.map((n) => ({ name: n, max: 100 })),
      shape: 'polygon',
      splitNumber: 4,
      axisName: { color: '#636e72', fontSize: 11 },
      splitLine: { lineStyle: { color: '#dfe6e9' } },
      splitArea: { areaStyle: { color: ['rgba(255,255,255,0)', 'rgba(200,200,200,0.05)'] } },
      axisLine: { lineStyle: { color: '#dfe6e9' } }
    },
    series: [
      {
        type: 'radar',
        data: [
          {
            value: [traits.confidence, traits.expressiveness, traits.anxiety, traits.motivation, traits.socialSkill],
            name,
            lineStyle: { color, width: 2 },
            areaStyle: { color: color + '30' },
            itemStyle: { color },
            symbol: 'circle',
            symbolSize: 5
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
    color: '#e74c3c',
    traitLabels: ['自信心', '表达力', '焦虑度', '学习动力', '社交能力'],
    traits: { confidence: 15, expressiveness: 25, anxiety: 85, motivation: 20, socialSkill: 30 }
  },
  yiming: {
    name: '张一鸣',
    color: '#3498db',
    traitLabels: ['自信心', '表达力', '焦虑度', '学习动力', '社交能力'],
    traits: { confidence: 80, expressiveness: 90, anxiety: 20, motivation: 65, socialSkill: 85 }
  },
  xiaorou: {
    name: '林暖暖',
    color: '#9b59b6',
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
}

// =====================
// 情绪条（右侧当前状态）
// =====================
const EMOTION_LABELS = {
  joy: { name: '愉悦度', color: '#2ecc71', icon: '😊' },
  activation: { name: '激活度', color: '#3498db', icon: '⚡' },
  anxiety: { name: '焦虑度', color: '#e74c3c', icon: '😰' }
}

const STATUS_THRESHOLDS = [
  { condition: (e) => e.anxiety > 80, label: '😱 极度焦虑', color: '#c0392b' },
  { condition: (e) => e.anxiety > 60, label: '😰 有点紧张', color: '#e74c3c' },
  { condition: (e) => e.joy > 70 && e.anxiety < 30, label: '🌟 深受鼓舞', color: '#27ae60' },
  { condition: (e) => e.joy > 50, label: '😊 心情不错', color: '#2ecc71' },
  { condition: (e) => e.activation > 70, label: '🔥 非常活跃', color: '#e67e22' },
  { condition: (e) => e.activation < 20, label: '😴 昏昏欲睡', color: '#95a5a6' },
  { condition: () => true, label: '😐 状态一般', color: '#7f8c8d' }
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
  if (key === 'anxiety' && val > 70) return 'linear-gradient(90deg, #e74c3c, #c0392b)'
  if (key === 'joy' && val > 60) return 'linear-gradient(90deg, #2ecc71, #27ae60)'
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
  鼓励: '#2ecc71',
  安抚: '#3498db',
  互动: '#9b59b6',
  提问: '#f39c12',
  批评: '#e74c3c'
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
    <div class="dash-header">
      <h2>📊 实时情绪监测</h2>
    </div>

    <div class="dash-section">
      <div class="dash-section-title">当前状态</div>
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
          {{ status.label }}
        </span>
      </div>
    </div>

    <div class="dash-section">
      <div class="dash-section-title">情绪指标</div>
      <div class="emotion-bars">
        <div class="emo-bar-item">
          <div class="emo-bar-label">
            <span>{{ EMOTION_LABELS.joy.icon }} 愉悦度</span>
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
            <span>{{ EMOTION_LABELS.activation.icon }} 激活度</span>
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
            <span>{{ EMOTION_LABELS.anxiety.icon }} 焦虑度</span>
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

    <!-- 与原版 index.html 顺序一致：路径分析 → 雷达 → 折线 -->
    <div class="dash-section">
      <div class="dash-section-title">🧭 个性化路径分析</div>

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

    <div class="dash-section">
      <div class="dash-section-title">五维人格画像</div>
      <div id="personality-radar" ref="radarEl" style="width: 100%; height: 200px;"></div>
    </div>

    <div class="dash-section">
      <div class="dash-section-title">情绪波动曲线</div>
      <div id="emotion-chart" ref="lineEl" style="width: 100%; height: 200px;"></div>
    </div>
  </aside>
</template>

<style>
@import '../../vendor/front/css/style.css';

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
  width: 56px;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}

.path-dual-track-flex {
  flex: 1;
  min-width: 150px;
}

/* 更贴近“圆角进度条”观感：让实际/期待更明显 */
.path-bar-ideal {
  opacity: 0.35;
}

/* 由于旧版 CSS 只对 `.path-bar-head .path-label-tag` 做了基础样式，这里补全 */
.path-label-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 10px;
  font-weight: 600;
}

/* 白底看板标题：覆盖全局 h2 的 var(--text-h)，避免系统深色主题下标题变成近白字 */
.dashboard .dash-header h2 {
  color: #1a1d23;
  font-weight: 700;
  letter-spacing: 0.03em;
}
</style>

