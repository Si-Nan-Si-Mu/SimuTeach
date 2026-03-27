<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  mode: { type: String, default: 'special' }, // 'special' | 'classroom'
  /** 移动端：抽屉是否打开（由 App 控制） */
  mobileOpen: { type: Boolean, default: false }
})

const collapsed = ref(false)

const emit = defineEmits([
  'select',
  'student-selected',
  'profile',
  'workflow-data',
  'report',
  'switch-mode',
  'close-mobile'
])

const characters = ref([
  {
    id: 'dazhi',
    name: '李大志',
    avatar: '😔',
    color: '#e74c3c',
    bgGradient: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
    tagline: '"我觉得我不行……"',
    personality: '习得性无助',
    desc: '内向沉默，长期被忽视，有明显的习得性无助倾向。回答问题时总低着头，声音很小。',
    traits: { confidence: 15, expressiveness: 25, anxiety: 85, motivation: 20, socialSkill: 30 },
    traitLabels: ['自信心', '表达力', '焦虑度', '学习动力', '社交能力'],
    isActive: true
  },
  {
    id: 'yiming',
    name: '张一鸣',
    avatar: '😎',
    color: '#3498db',
    bgGradient: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
    tagline: '"老师！我有个问题！"',
    personality: '调皮捣蛋',
    desc: '活泼好动，思维跳跃，课堂上总爱插嘴。聪明但注意力不集中，需要老师引导其专注。',
    traits: { confidence: 80, expressiveness: 90, anxiety: 20, motivation: 65, socialSkill: 85 },
    traitLabels: ['自信心', '表达力', '焦虑度', '学习动力', '社交能力'],
    isActive: false
  },
  {
    id: 'xiaorou',
    name: '林暖暖',
    avatar: '🥺',
    color: '#9b59b6',
    bgGradient: 'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)',
    tagline: '"老师，你是不是生气了……"',
    personality: '乖巧敏感',
    desc: '敏感细腻，善于察言观色，情绪容易受外界影响。很在意老师的评价，容易过度解读。',
    traits: { confidence: 35, expressiveness: 55, anxiety: 70, motivation: 50, socialSkill: 60 },
    traitLabels: ['自信心', '表达力', '焦虑度', '学习动力', '社交能力'],
    isActive: false
  }
])

const activeId = ref(characters.value[0]?.id ?? '')

const selectChar = (c) => {
  activeId.value = c.id
  characters.value.forEach((x) => {
    x.isActive = x.id === c.id
  })

  // 给父组件传选中的学生对象
  emit('select', c)
  // 兼容你现有 App.vue：也把学生名字单独传出来
  emit('student-selected', c.name)
  emit('close-mobile')
}

// ===== 自定义人格 Modal（五维可调 + ECharts 雷达图）=====
const profileOpen = ref(false)
const profileStudent = ref(null)
const profileOverlayEl = ref(null)

/** 与 traits 对象键顺序一致，对应 traitLabels 下标 0..4 */
const TRAIT_KEYS = ['confidence', 'expressiveness', 'anxiety', 'motivation', 'socialSkill']

const radarEl = ref(null)
let radarChart = null
let radarResizeObserver = null

// 弹窗内滑块行：标签 + 当前值（与雷达维度一致）
const profileTraitSliders = computed(() => {
  const s = profileStudent.value
  if (!s?.traits || !s.traitLabels) return []
  return s.traitLabels.map((label, idx) => {
    const key = TRAIT_KEYS[idx]
    return {
      key,
      label,
      value: Math.round(Number(s.traits[key]) || 0)
    }
  })
})

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
            value: [
              traits.confidence,
              traits.expressiveness,
              traits.anxiety,
              traits.motivation,
              traits.socialSkill
            ],
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

async function renderProfileRadar() {
  if (!radarEl.value) return
  const echarts = await ensureEchartsLoaded()
  if (!echarts) return

  if (radarChart) {
    radarChart.dispose()
    radarChart = null
  }

  radarChart = echarts.init(radarEl.value, null, { renderer: 'canvas' })
  const option = getRadarOption(echarts, profileStudent.value)
  if (option) radarChart.setOption(option, true)

  await nextTick()
  if (radarEl.value && 'ResizeObserver' in window) {
    radarResizeObserver = new ResizeObserver(() => radarChart && radarChart.resize())
    radarResizeObserver.observe(radarEl.value)
  }
}

/** 仅更新雷达数据（滑块拖动时） */
async function updateProfileRadarOnly() {
  if (!profileOpen.value || !profileStudent.value || !radarChart) return
  const echarts = await ensureEchartsLoaded()
  if (!echarts) return
  const option = getRadarOption(echarts, profileStudent.value)
  if (option) radarChart.setOption(option, true)
}

watch(
  () => {
    if (!profileOpen.value || !profileStudent.value?.traits) return null
    const t = profileStudent.value.traits
    return [t.confidence, t.expressiveness, t.anxiety, t.motivation, t.socialSkill]
  },
  () => {
    if (profileOpen.value) updateProfileRadarOnly()
  },
  { deep: true }
)

async function openProfile(c) {
  profileStudent.value = c
  profileOpen.value = true
  await nextTick()
  await renderProfileRadar()
}

function closeProfile() {
  profileOpen.value = false
  profileStudent.value = null

  if (radarResizeObserver && radarEl.value) radarResizeObserver.unobserve(radarEl.value)
  radarResizeObserver = null
  if (radarChart) {
    radarChart.dispose()
    radarChart = null
  }
  // 五维已就地写在 characters 项上，与当前选中学生对象为同一引用，父组件侧无需再 emit
}

function clampTrait(v) {
  const n = Math.round(Number(v))
  if (Number.isNaN(n)) return 0
  return Math.max(0, Math.min(100, n))
}

function onOverlayClick(e) {
  // 点击遮罩层背景（而不是容器）才关闭
  if (e.target === profileOverlayEl.value) closeProfile()
}

/** 进入窄屏时避免仍处于「折叠图标栏」导致抽屉里内容过少 */
let mobileMq = null
function syncCollapsedForViewport() {
  try {
    if (mobileMq?.matches) collapsed.value = false
  } catch (_) {
    /* ignore */
  }
}

onMounted(() => {
  try {
    mobileMq = window.matchMedia('(max-width: 768px)')
    mobileMq.addEventListener?.('change', syncCollapsedForViewport)
    syncCollapsedForViewport()
  } catch (_) {
    /* ignore */
  }
})

onBeforeUnmount(() => {
  try {
    mobileMq?.removeEventListener?.('change', syncCollapsedForViewport)
  } catch (_) {
    /* ignore */
  }
  closeProfile()
})
</script>

<template>
  <aside
    class="sidebar"
    id="sidebar"
    :class="{ collapsed, 'sidebar--drawer-open': props.mobileOpen }"
  >
    <div class="sidebar-header">
      <h1 class="logo">🎓 SimuTeach</h1>
      <button
        type="button"
        class="sidebar-toggle"
        aria-label="收起/展开侧边栏"
        @click="collapsed = !collapsed"
      >
        <span v-if="collapsed">»</span>
        <span v-else>«</span>
      </button>
      <div v-if="collapsed" class="logo-collapsed" aria-hidden="true">
        🎓
      </div>
      <p v-if="!collapsed" class="logo-sub">数字学生仿真训练</p>
    </div>

    <div v-if="!collapsed" class="sidebar-section-title">模式</div>
    <div class="sidebar-mode-actions">
      <button
        class="sidebar-btn"
        id="btn-special-sim"
        type="button"
        @click="
          () => {
            emit('switch-mode', 'special')
            emit('close-mobile')
          }
        "
      >
        <span>🎯</span><span v-if="!collapsed">专项模拟</span>
      </button>
      <button
        class="sidebar-btn btn-danger"
        id="btn-classroom-sim"
        type="button"
        @click="
          () => {
            emit('switch-mode', 'classroom')
            emit('close-mobile')
          }
        "
      >
        <span>🏫</span><span v-if="!collapsed">课堂模拟</span>
      </button>
    </div>

    <div v-if="props.mode === 'special' && !collapsed" class="sidebar-section-title">选择训练对象</div>
    <div v-if="props.mode === 'special' && !collapsed" class="character-list" id="character-list">
      <div
        v-for="c in characters"
        :key="c.id"
        class="char-card"
        :class="{ active: c.isActive }"
        :style="{
          '--accent-color': c.color,
          color: c.color
        }"
        role="button"
        tabindex="0"
        @click="selectChar(c)"
        @keydown.enter.prevent="selectChar(c)"
      >
        <div class="char-avatar-wrap">
          <div
            class="char-avatar"
            :style="{
              background: c.color + '15',
              borderColor: c.color
            }"
          >
            {{ c.avatar }}
          </div>
          <span class="char-online-dot" :style="{ color: c.color }"></span>
        </div>

        <div class="char-info">
          <div class="char-name">{{ c.name }}</div>
          <div class="char-tagline">{{ c.tagline }}</div>
          <div
            class="char-type-badge"
            :style="{
              background: c.color + '20',
              color: c.color,
              border: '1px solid ' + c.color + '40'
            }"
          >
            {{ c.personality }}
          </div>
        </div>
      </div>
    </div>

    <div class="sidebar-actions">
      <button
        class="sidebar-btn"
        id="btn-profile"
        type="button"
        @click="
          () => {
            openProfile(characters.find((c) => c.id === activeId) || characters[0])
            emit('close-mobile')
          }
        "
      >
        <span>🎛️</span><span v-if="!collapsed"> 自定义人格</span>
      </button>
      <button
        class="sidebar-btn"
        id="btn-workflow-data"
        type="button"
        @click="
          () => {
            emit('workflow-data')
            emit('close-mobile')
          }
        "
      >
        <span>📁</span><span v-if="!collapsed"> 工作流数据</span>
      </button>
      <button
        class="sidebar-btn btn-danger"
        id="btn-report"
        type="button"
        @click="
          () => {
            emit('report')
            emit('close-mobile')
          }
        "
      >
        <span>📊</span><span v-if="!collapsed"> 结束 · 生成报告</span>
      </button>
    </div>

    <div class="sidebar-footer">
      <p v-if="!collapsed">仿真 · 诊断 · 提升</p>
      <p v-if="!collapsed" class="version">v1.0.0</p>
    </div>
  </aside>

  <!-- 自定义人格弹窗 -->
  <div
    v-if="profileOpen && profileStudent"
    ref="profileOverlayEl"
    class="profile-overlay show"
    @click="onOverlayClick"
  >
    <div class="profile-container profile-container--custom">
      <button class="profile-close" type="button" aria-label="关闭" @click="closeProfile">
        ✕
      </button>

      <div class="profile-header" :style="{ background: profileStudent.bgGradient || '' }">
        <div class="profile-avatar-lg">{{ profileStudent.avatar }}</div>
        <p class="profile-modal-eyebrow">自定义人格</p>
        <h2>{{ profileStudent.name }}</h2>
        <span class="profile-badge" :style="{ background: profileStudent.color || '' }">
          {{ profileStudent.personality }}
        </span>
      </div>

      <div
        class="profile-body"
        :style="{ '--trait-accent': profileStudent.color || '#3498db' }"
      >
        <p class="profile-desc">{{ profileStudent.desc }}</p>
        <p class="profile-custom-hint">
          拖动滑块或输入数字调整五维（0–100），雷达图会实时更新。数据保存在本页、作用于当前角色，关闭弹窗后仍保留；暂不提交后端。
        </p>

        <h3>📡 五维画像预览</h3>
        <div id="profile-radar-chart" ref="radarEl" style="width: 100%; height: 260px;"></div>

        <h3 class="profile-sliders-title">🎚️ 调整五维</h3>
        <div class="trait-details trait-details--editable" aria-label="五维滑块">
          <div v-for="row in profileTraitSliders" :key="row.key" class="trait-slider-row">
            <div class="trait-slider-head">
              <label class="trait-name" :for="'trait-range-' + row.key">{{ row.label }}</label>
              <input
                :id="'trait-num-' + row.key"
                v-model.number="profileStudent.traits[row.key]"
                class="trait-num-input"
                type="number"
                min="0"
                max="100"
                step="1"
                @blur="profileStudent.traits[row.key] = clampTrait(profileStudent.traits[row.key])"
              />
            </div>
            <input
              :id="'trait-range-' + row.key"
              v-model.number="profileStudent.traits[row.key]"
              class="trait-range"
              type="range"
              min="0"
              max="100"
              step="1"
              :aria-valuenow="clampTrait(profileStudent.traits[row.key])"
              aria-valuemin="0"
              aria-valuemax="100"
            />
            <div
              class="trait-bar-track trait-bar-track--mirror"
              role="presentation"
              aria-hidden="true"
            >
              <div
                class="trait-bar-fill"
                :style="{
                  width: clampTrait(profileStudent.traits[row.key]) + '%',
                  background: profileStudent.color || '#3498db'
                }"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
@import '../../vendor/front/css/style.css';

.sidebar-mode-actions {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  padding: 14px 18px 4px;
  gap: 12px;
}

.sidebar-mode-actions .sidebar-btn {
  width: 100%;
  justify-content: center;
  padding: 14px 16px;
  font-size: 15px;
  border-radius: 16px;
  gap: 10px;
}

/* 可收缩侧边栏：覆写原版 .sidebar 固定 260px 宽度 */
.sidebar.collapsed {
  width: 72px !important;
  min-width: 72px !important;
}

.sidebar {
  position: relative;
}

.sidebar.collapsed .sidebar-header {
  /* 原版 sidebar-header padding 在 72px 宽度下会挤爆 */
  padding: 14px 8px 12px !important;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sidebar.collapsed .logo {
  display: none;
}

.sidebar.collapsed .logo-sub {
  display: none;
}

.logo-collapsed {
  display: none;
  width: 100%;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.95);
}

.sidebar.collapsed .logo-collapsed {
  display: flex;
}

.sidebar-toggle {
  appearance: none;
  border: 1px solid rgba(52, 152, 219, 0.95);
  background: linear-gradient(180deg, rgba(52, 152, 219, 0.42), rgba(52, 152, 219, 0.22));
  color: rgba(209, 234, 255, 0.98);
  cursor: pointer;
  font-size: 16px;
  font-weight: 800;
  padding: 0;
  line-height: 1;
  margin-left: auto;

  width: 36px;
  height: 36px;
  border-radius: 12px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  transition:
    transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1),
    background-color 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    filter 0.18s ease;

  box-shadow:
    0 14px 34px rgba(0, 0, 0, 0.24),
    0 0 0 1px rgba(52, 152, 219, 0.35),
    0 0 20px rgba(52, 152, 219, 0.25);

  z-index: 50;

  /* 固定在侧边栏右侧中间：展开/收起都保持同一位置 */
  position: absolute;
  top: 50%;
  right: -18px;
  transform: translateY(-50%);
  margin-left: 0;
}

.sidebar-toggle:hover {
  background: rgba(52, 152, 219, 0.28);
  border-color: rgba(52, 152, 219, 0.95);
  transform: translateY(-50%) scale(1.08);
  box-shadow:
    0 14px 34px rgba(0, 0, 0, 0.22),
    0 0 0 4px rgba(52, 152, 219, 0.16);
}

.sidebar-toggle:active {
  transform: translateY(-50%) scale(0.98);
}

.sidebar-toggle:focus-visible {
  outline: 2px solid rgba(52, 152, 219, 0.85);
  outline-offset: 2px;
}

.sidebar.collapsed .sidebar-btn {
  justify-content: center;
}

/* 收起时按钮内只显示图标，文字由 v-if 控制，这里减少左右留白 */
.sidebar.collapsed .sidebar-mode-actions,
.sidebar.collapsed .sidebar-actions {
  padding-left: 8px;
  padding-right: 8px;
}

.sidebar.collapsed .sidebar-actions .sidebar-btn {
  padding-left: 8px;
  padding-right: 8px;
}

/* 收起时：增大图标按钮间距（更像“图标侧栏”） */
.sidebar.collapsed .sidebar-mode-actions {
  gap: 20px;
}

.sidebar.collapsed .sidebar-actions {
  gap: 16px;
}

/* 收起时按钮改为“图标按钮”宽松排布 */
.sidebar.collapsed .sidebar-btn {
  padding-left: 8px !important;
  padding-right: 8px !important;
  justify-content: center !important;
  text-align: center;
}

/* —— 自定义人格弹窗 —— */
.profile-container--custom .profile-modal-eyebrow {
  margin: 0 0 4px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(45, 52, 54, 0.55);
}

.profile-custom-hint {
  margin: 0 0 16px;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.55;
  color: rgba(45, 52, 54, 0.72);
  background: rgba(52, 152, 219, 0.08);
  border: 1px solid rgba(52, 152, 219, 0.2);
  border-radius: 12px;
}

.profile-sliders-title {
  margin-top: 20px;
}

.trait-details--editable {
  gap: 16px;
}

.trait-slider-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.trait-slider-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.trait-num-input {
  width: 52px;
  padding: 4px 6px;
  font-size: 13px;
  font-weight: 700;
  text-align: center;
  border: 1px solid rgba(45, 52, 54, 0.16);
  border-radius: 8px;
  color: #2d3436;
  background: #fff;
}

.trait-num-input:focus {
  outline: none;
  border-color: var(--trait-accent, #3498db);
  box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.2);
}

.trait-range {
  width: 100%;
  height: 8px;
  accent-color: var(--trait-accent, #3498db);
  cursor: pointer;
}

.trait-bar-track--mirror {
  height: 6px;
  margin-top: 2px;
  opacity: 0.85;
}
</style>

