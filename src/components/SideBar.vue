<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { GraduationCap, School, FileSearch, FolderOpen } from 'lucide-vue-next'
import { TRAINING_FOCUS_BY_STUDENT_ID } from '../constants/specialTrainingFocus.js'

const props = defineProps({
  mode: { type: String, default: 'special' },
  mobileOpen: { type: Boolean, default: false }
})

const collapsed = ref(false)

/** 与 App 内 .report-overlay 的 left 对齐：侧栏宽度 + 收缩钮 right:-18px 的外凸量，避免全屏报告遮住按钮 */
const SIDEBAR_WIDTH = { expanded: 260, collapsed: 72 }
const SIDEBAR_TOGGLE_OUTSET = 18

function syncReportOverlayLeftInset() {
  if (typeof document === 'undefined') return
  const w = collapsed.value ? SIDEBAR_WIDTH.collapsed : SIDEBAR_WIDTH.expanded
  document.documentElement.style.setProperty('--app-sidebar-outer', `${w + SIDEBAR_TOGGLE_OUTSET}px`)
}

watch(collapsed, syncReportOverlayLeftInset)
onMounted(() => {
  syncReportOverlayLeftInset()
})
onBeforeUnmount(() => {
  if (typeof document === 'undefined') return
  document.documentElement.style.removeProperty('--app-sidebar-outer')
})

const emit = defineEmits(['select', 'student-selected', 'workflow-data', 'switch-mode', 'close-mobile'])

const characters = ref([
  {
    id: 'dazhi',
    name: '李大志',
    trainingFocus: TRAINING_FOCUS_BY_STUDENT_ID.dazhi,
    avatar: '/avatars/dazhi.png',
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
    trainingFocus: TRAINING_FOCUS_BY_STUDENT_ID.yiming,
    avatar: '/avatars/yiming.png',
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
    trainingFocus: TRAINING_FOCUS_BY_STUDENT_ID.xiaorou,
    avatar: '/avatars/xiaorou.png',
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
  emit('select', c)
  emit('student-selected', c.name)
  emit('close-mobile')
}

let mobileMq = null
function syncCollapsedForViewport() {
  try {
    if (mobileMq?.matches) collapsed.value = false
  } catch (_) {
  }
}

onMounted(() => {
  try {
    mobileMq = window.matchMedia('(max-width: 768px)')
    mobileMq.addEventListener?.('change', syncCollapsedForViewport)
    syncCollapsedForViewport()
  } catch (_) {
  }
})

onBeforeUnmount(() => {
  try {
    mobileMq?.removeEventListener?.('change', syncCollapsedForViewport)
  } catch (_) {
  }
})
</script>

<template>
  <aside
    class="sidebar"
    id="sidebar"
    :class="{ collapsed, 'sidebar--drawer-open': props.mobileOpen }"
  >
    <div class="sidebar-body-scroll">
    <div class="sidebar-header">
      <h1 class="logo">
        <GraduationCap class="logo-icon" />
        SimuTeach
      </h1>
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
        <GraduationCap />
      </div>
      <p v-if="!collapsed" class="logo-sub">数字学生仿真训练</p>
    </div>

    <div v-if="!collapsed" class="sidebar-section-title">模式</div>
    <div class="sidebar-mode-actions">
      <button
        class="sidebar-btn"
        id="btn-special-sim"
        type="button"
        :class="{ 'sidebar-btn--active': props.mode === 'special' }"
        @click="
          () => {
            emit('switch-mode', 'special')
            emit('close-mobile')
          }
        "
      >
        <GraduationCap class="sidebar-btn-icon" />
        <span v-if="!collapsed">专项模拟</span>
      </button>
      <button
        class="sidebar-btn"
        id="btn-classroom-sim"
        type="button"
        :class="{ 'sidebar-btn--active': props.mode === 'classroom' }"
        @click="
          () => {
            emit('switch-mode', 'classroom')
            emit('close-mobile')
          }
        "
      >
        <School class="sidebar-btn-icon" />
        <span v-if="!collapsed">课堂模拟</span>
      </button>
      <button
        class="sidebar-btn"
        id="btn-doc-analysis"
        type="button"
        :class="{ 'sidebar-btn--active': props.mode === 'doc-analysis' }"
        @click="
          () => {
            emit('switch-mode', 'doc-analysis')
            emit('close-mobile')
          }
        "
      >
        <FileSearch class="sidebar-btn-icon" />
        <span v-if="!collapsed">教学文档分析</span>
      </button>
    </div>

    <div v-if="props.mode === 'special' && !collapsed" class="sidebar-section-title">选择训练对象</div>
    <div v-if="props.mode === 'special' && !collapsed" class="character-list" id="character-list">
      <div
        v-for="c in characters"
        :key="c.id"
        class="char-card"
        :class="{ 
          active: c.isActive,
          'char-card--dazhi-active': c.isActive && c.id === 'dazhi'
        }"
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
          <img
            class="char-avatar-img"
            :class="{ 'char-avatar-img--dazhi': c.id === 'dazhi' }"
            :src="c.avatar"
            :alt="c.name"
            :style="{
              background: c.color + '15',
              borderColor: c.color
            }"
          />
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
            {{ c.trainingFocus || c.personality }}
          </div>
        </div>
      </div>
    </div>
    </div>

    <div class="sidebar-bottom">
      <div class="sidebar-actions">
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
          <FolderOpen class="sidebar-btn-icon" />
          <span v-if="!collapsed">工作流数据</span>
        </button>
      </div>
      <div class="sidebar-footer">
        <p v-if="!collapsed">仿真 · 诊断 · 提升</p>
        <p v-if="!collapsed" class="version">v1.0.0</p>
      </div>
    </div>
  </aside>
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
  justify-content: flex-start;
  padding: 12px 16px;
  font-size: 15px;
  border-radius: 12px;
  gap: 12px;
  color: rgba(255, 255, 255, 0.6);
  background: transparent;
  border: none;
  transition: color 0.25s ease, background-color 0.25s ease;
}

.sidebar-mode-actions .sidebar-btn:hover {
  color: rgba(255, 255, 255, 1);
  background: rgba(255, 255, 255, 0.08);
}

.sidebar-mode-actions .sidebar-btn.sidebar-btn--active {
  color: rgba(255, 255, 255, 1);
  background: rgba(255, 255, 255, 0.08);
}

.sidebar-btn-icon {
  width: 20px;
  height: 20px;
  stroke-width: 2;
  flex-shrink: 0;
}

.sidebar.collapsed {
  width: 72px !important;
  min-width: 72px !important;
}

.sidebar {
  position: relative;
  min-height: 0;
}

.sidebar-body-scroll {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-body-scroll .character-list {
  min-height: 0;
}

.sidebar-bottom {
  margin-top: auto;
  flex-shrink: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.sidebar.collapsed .sidebar-header {
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

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 18px;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.95);
  margin: 0;
}

.logo-icon {
  width: 24px;
  height: 24px;
  stroke-width: 2;
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

.logo-collapsed svg {
  width: 28px;
  height: 28px;
  stroke-width: 2;
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
  padding: 14px !important;
}

.sidebar.collapsed .sidebar-mode-actions,
.sidebar.collapsed .sidebar-actions {
  padding-left: 8px;
  padding-right: 8px;
}

.sidebar.collapsed .sidebar-actions .sidebar-btn {
  padding-left: 8px;
  padding-right: 8px;
}

.sidebar.collapsed .sidebar-mode-actions {
  gap: 20px;
}

.sidebar.collapsed .sidebar-actions {
  gap: 16px;
}

.sidebar.collapsed .sidebar-btn {
  padding-left: 8px !important;
  padding-right: 8px !important;
  justify-content: center !important;
  text-align: center;
}

.sidebar-bottom .sidebar-actions {
  border-top: none;
}

.sidebar-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 18px 4px;
}

.sidebar-actions .sidebar-btn {
  width: 100%;
  justify-content: flex-start;
  padding: 12px 16px;
  font-size: 15px;
  border-radius: 12px;
  gap: 12px;
  color: rgba(255, 255, 255, 0.6);
  background: transparent;
  border: none;
  transition: color 0.25s ease, background-color 0.25s ease;
}

.sidebar-actions .sidebar-btn:hover {
  color: rgba(255, 255, 255, 1);
  background: rgba(255, 255, 255, 0.08);
}

.char-avatar-img {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  object-fit: cover;
  object-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid;
  background: rgba(255,255,255,0.05);
}

.char-avatar-img--dazhi {
  object-position: 50% 18%;
}

/* ==================== 李大志专属选中样式 ==================== */
/* 苍暮灰蓝半透明，与其他学生卡片 UI 风格一致 */
.char-card--dazhi-active {
  background-color: rgba(99, 122, 140, 0.65) !important;
  border-radius: 8px;
  transition: all 0.3s ease;
}
</style>
