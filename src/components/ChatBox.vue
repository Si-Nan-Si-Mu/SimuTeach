<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { STUDENT_COLORS, getStudentColors } from '../constants/studentColors.js'

const props = defineProps({
  headerName: { type: String, default: '😔 李大志' },
  headerType: { type: String, default: '习得性无助型' },
  placeholder: { type: String, default: '输入你想对学生说的话…' },
  isLive: { type: Boolean, default: true },
  liveText: { type: String, default: '仿真对话中' },
  // 当前被扮演学生信息：用于把 workflow 回复当作“学生口吻”展示
  student: { type: Object, default: null }, // { id, name, avatar, color }
  currentEmotion: { type: Object, default: null }, // { joy, activation, anxiety }
  initialMessages: { type: Array, default: () => [] },
  quickPhrases: {
    type: Array,
    default: () => [
      { trigger: '提问', label: '✋ 提问', text: '来，这道题你来回答一下？' },
      { trigger: '鼓励', label: '👏 鼓励', text: '你做得很好，老师为你感到骄傲！' },
      { trigger: '安抚', label: '🤗 安抚', text: '没关系，老师不会怪你的，慢慢来。' },
      { trigger: '批评', label: '😤 批评', text: '你这样做是不对的，需要改正。' },
      { trigger: '互动', label: '💬 互动', text: '我们一起来讨论一下这个问题好不好？' }
    ]
  }
})

const emit = defineEmits(['send'])

const messagesEl = ref(null)
const inputRef = ref(null)
const inputText = ref('')

const workflowLoading = ref(false)
const typingIndicator = ref(false)
const typingJobs = ref(0)
const typingIntervals = new Set()

const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`

const normalizeMessage = (m) => {
  if (!m) return null
  if (m.id) return m
  return { ...m, id: uid() }
}

/** 按人格 id 保存对话快照，切换人格时互不混入 */
const threadsByCharacterId = ref({})
const activeCharacterId = ref(null)

const messages = ref(
  props.initialMessages.map((m) => normalizeMessage(m)).filter(Boolean)
)

function cloneMessageList(arr) {
  return (arr || []).map((m) => ({ ...m }))
}

function stopAllTyping() {
  typingIntervals.forEach((id) => window.clearInterval(id))
  typingIntervals.clear()
  typingJobs.value = 0
  typingIndicator.value = false
}

function scrollToBottom() {
  const el = messagesEl.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

watch(
  () => props.student?.id,
  (newId, oldId) => {
    const nid = newId != null && newId !== '' ? newId : null
    stopAllTyping()
    workflowLoading.value = false
    const prevId =
      oldId !== undefined && oldId !== null && oldId !== '' ? oldId : activeCharacterId.value
    if (prevId) {
      threadsByCharacterId.value = {
        ...threadsByCharacterId.value,
        [prevId]: cloneMessageList(messages.value)
      }
    }
    const saved = nid ? threadsByCharacterId.value[nid] : null
    messages.value = (saved && saved.length ? saved : []).map((m) => normalizeMessage({ ...m }))
    activeCharacterId.value = nid
    nextTick(scrollToBottom)
  },
  { flush: 'pre', immediate: true }
)

watch(
  () => props.initialMessages,
  (list) => {
    if (!list || !list.length) return
    messages.value = list.map((m) => normalizeMessage(m)).filter(Boolean)
    nextTick(scrollToBottom)
  }
)

const getEmotionGlow = (emotion) => {
  if (!emotion) return ''
  const { joy = 0, activation = 0, anxiety = 0 } = emotion

  if (anxiety > 70) return 'glow-anxious'
  if (joy < 25) return 'glow-sad'
  if (activation > 75 && joy > 50) return 'glow-excited'
  if (joy > 55 && anxiety < 40) return 'glow-happy'
  return ''
}

const areaGlowClass = computed(() => {
  const emotion = props.currentEmotion
  if (!emotion) return ''
  if (emotion.anxiety > 70) return 'area-glow-red'
  if (emotion.joy > 55 && emotion.anxiety < 40) return 'area-glow-green'
  if (emotion.joy < 25) return 'area-glow-blue'
  return ''
})

// 判断是否是李大志
const isDazhi = computed(() => {
  return props.student?.id === 'dazhi'
})

// 强制容器背景，直接用内联样式
const getContainerBackground = computed(() => {
  const studentId = props.student?.id || 'dazhi'
  if (studentId === 'dazhi') {
    return { background: 'linear-gradient(135deg, #E6EAEF 0%, #D0D7E1 100%)' }
  } else if (studentId === 'yiming') {
    return { background: 'linear-gradient(135deg, #E8F4FF 0%, #D0E8FF 100%)' }
  } else {
    return { background: 'linear-gradient(135deg, #F3F0FF 0%, #E8E4FF 100%)' }
  }
})

// 性格标签：更高对比（底色 + 主题色描边与文字）
const headerBadgeStyle = computed(() => {
  const c = props.student?.color
  if (!c) {
    return {
      background: 'rgba(45, 52, 54, 0.08)',
      color: '#2d3436',
      border: '1.5px solid rgba(45, 52, 54, 0.2)'
    }
  }
  return {
    background: `${c}24`,
    color: c,
    border: `1.5px solid ${c}66`,
    boxShadow: `0 1px 0 ${c}22`
  }
})

watch(
  [() => messages.value.length, workflowLoading, typingIndicator],
  () => nextTick(scrollToBottom)
)

const canSend = computed(() => !workflowLoading.value && !typingIndicator.value && typingJobs.value === 0)

const startTypeWriter = (messageId, field, fullText, speed, onDone) => {
  const msg = messages.value.find((m) => m.id === messageId)
  if (!msg) return

  // 初始化显示字段
  msg[field] = ''
  typingJobs.value += 1

  let i = 0
  const text = fullText == null ? '' : String(fullText)

  const intervalId = window.setInterval(() => {
    // 如果消息已被移除，直接停止
    if (!messages.value.some((m) => m.id === messageId)) {
      window.clearInterval(intervalId)
      typingIntervals.delete(intervalId)
      typingJobs.value = Math.max(0, typingJobs.value - 1)
      return
    }

    if (i < text.length) {
      msg[field] += text.charAt(i)
      i += 1
      scrollToBottom()
    } else {
      window.clearInterval(intervalId)
      typingIntervals.delete(intervalId)
      typingJobs.value = Math.max(0, typingJobs.value - 1)
      onDone?.()
    }
  }, speed)

  typingIntervals.add(intervalId)
}

// typing 指示器默认展示用（如需更精确，可把它改成 prop 传入当前学生头像/姓名/颜色）
const sampleStudentAvatar = ref('🧑‍🏫')
const sampleStudentName = ref('学生')
const sampleStudentColor = ref('#3498db')

const messageClass = (m) => {
  if (!m) return ''
  if (m.role === 'teacher') return 'teacher-msg'
  if (m.role === 'student') return 'student-msg'
  if (m.role === 'workflow') return 'student-msg'
  if (m.role === 'system') return 'system-msg'
  return ''
}

/** 公开路径、URL 等应渲染为 <img>，避免把 /avatars/xxx.png 当纯文本 */
const isImageAvatar = (a) => {
  if (a == null) return false
  const s = String(a).trim()
  if (!s) return false
  if (/^https?:\/\//i.test(s)) return true
  if (s.startsWith('/')) {
    if (/\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?|#|$)/i.test(s)) return true
    if (/\/(avatars?|static|img|images|media|assets)\//i.test(s)) return true
  }
  if (/\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?|#|$)/i.test(s)) return true
  return false
}

const parseStudentInnerThought = (raw) => {
  const s = (raw == null ? '' : String(raw)).trim()
  if (!s) return { text: '', innerThought: '' }

  // 若 workflow 返回的是一个 JSON 字符串，优先从常见字段提取
  if (
    (s.startsWith('{') && s.endsWith('}')) ||
    (s.startsWith('[') && s.endsWith(']'))
  ) {
    try {
      const obj = JSON.parse(s)
      const text = obj.reply || obj.dialog || obj.text || obj.content || ''
      const innerThought = obj.innerThought || obj.thought || obj.inner_os || obj.innerOS || ''
      if (typeof text === 'string' && typeof innerThought === 'string') {
        return { text: text.trim(), innerThought: innerThought.trim() }
      }
    } catch (_) {
      // ignore
    }
  }

  // 常见格式：回复 + “内心OS：xxx”（可能换行）
  const labelRe = /内心OS|内心思考/
  const idx = s.search(labelRe)
  if (idx >= 0) {
    const before = s.slice(0, idx).trim()
    const after = s.slice(idx).replace(labelRe, '').replace(/^[:：]\s*/, '').trim()
    return { text: before || s.trim(), innerThought: after }
  }

  return { text: s, innerThought: '' }
}

const appendTeacher = (text, trigger = null) => {
  const cid = props.student?.id || null
  const m = normalizeMessage({
    role: 'teacher',
    text: '',
    trigger,
    timestamp: Date.now(),
    characterId: cid
  })

  messages.value.push(m)
  nextTick(() => startTypeWriter(m.id, 'text', text, 18))
}

const appendWorkflowReply = (text) => {
  const parsed = parseStudentInnerThought(text)

  // 把 workflow 回复当作“当前学生”的学生消息来展示
  const stu = props.student || {}
  appendStudent({
    text: parsed.text,
    innerThought: parsed.innerThought,
    characterId: stu.id || null,
    avatar: stu.avatar || sampleStudentAvatar.value,
    name: stu.name || sampleStudentName.value,
    color: stu.color || sampleStudentColor.value
  })
}

const appendSystem = (text) => {
  messages.value.push(
    normalizeMessage({
      role: 'system',
      text,
      timestamp: Date.now(),
      characterId: null
    })
  )
}

const appendStudent = ({ text, innerThought, characterId, avatar, name, color }) => {
  const m = normalizeMessage({
    role: 'student',
    text: '',
    innerThought: innerThought || '',
    // 用这个字段做“内心OS”逐字打字展示
    innerThoughtText: '',
    characterId,
    avatar,
    name,
    color
  })

  messages.value.push(m)

  nextTick(() => {
    startTypeWriter(m.id, 'text', text, 24, () => {
      if (m.innerThought) {
        // 模拟 old_code：正文打完后，隔一小段再开始内心OS
        setTimeout(() => {
          startTypeWriter(m.id, 'innerThoughtText', m.innerThought, 18)
        }, 400)
      }
    })
  })
}

const clear = () => {
  stopAllTyping()
  workflowLoading.value = false
  messages.value = []
  const id = props.student?.id
  if (id) {
    threadsByCharacterId.value = { ...threadsByCharacterId.value, [id]: [] }
  }
}

/** 重新开始：清空所有人格的本地对话缓存 */
const clearAllCharacterThreads = () => {
  stopAllTyping()
  workflowLoading.value = false
  messages.value = []
  threadsByCharacterId.value = {}
  activeCharacterId.value = props.student?.id || null
}

// 给外部（比如你后续接回 old_code 的 workflow 回调）调用
defineExpose({
  appendTeacher,
  appendWorkflowReply,
  appendStudent,
  appendSystem,
  clear,
  clearAllCharacterThreads,
  showWorkflowLoading: (show) => (workflowLoading.value = !!show),
  showTypingIndicator: () => (typingIndicator.value = true),
  removeTypingIndicator: () => (typingIndicator.value = false)
})

const sendMessage = (text, trigger = null) => {
  const t = (text || '').trim()
  if (!t) return
  if (!canSend.value) return

  emit('send', { text: t, trigger })
  appendTeacher(t, trigger)

  inputText.value = ''
  nextTick(() => inputRef.value?.focus())
}

const onSend = () => sendMessage(inputText.value, null)
const onEnter = () => onSend()

const onTextareaKeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    onSend()
  }
}

const onQuickPhrase = (phrase) => {
  // 先把文字填到输入框，再触发发送（用户能看到输入内容变化）
  inputText.value = phrase.text
  sendMessage(phrase.text, phrase.trigger)
}

// 初次聚焦输入框
nextTick(() => inputRef.value?.focus())

onBeforeUnmount(() => {
  typingIntervals.forEach((id) => window.clearInterval(id))
  typingIntervals.clear()
  typingJobs.value = 0
})
</script>

<template>
  <!-- 外层环境容器：填满工作区 + 学生主题类 + 24px 内边距 + 内联强制背景 -->
  <main class="chat-main">
    <div
      class="chat-environment-container"
      :class="['chat-environment-container', 'theme-' + (props.student?.id || 'dazhi')]"
      :style="getContainerBackground"
    >
      <!-- 内层玻璃态卡片：对话流 + 输入框 -->
      <div class="chat-inner-card">
        <!-- 顶部 Header：纯白 + 浅灰下边框 -->
        <div class="chat-card-header">
          <div class="chat-header-left chat-header-student">
            <img
              class="chat-header-avatar"
              :src="props.student?.avatar"
              :alt="props.student?.name || '学生头像'"
            />
            <h2 id="chat-header-name">{{ props.student?.name || '未命名学生' }}</h2>
            <span class="chat-header-badge" id="chat-header-type" :style="headerBadgeStyle">{{
              props.student?.trainingFocus || props.student?.personality || props.headerType
            }}</span>
          </div>
          <div class="chat-header-right">
            <span v-if="isLive" class="live-dot"></span>
            <span>{{ liveText }}</span>
          </div>
        </div>

        <!-- 对话流区域：撑满剩余空间，独立滚动 -->
        <div class="chat-messages" id="chat-messages" ref="messagesEl">
          <div v-for="m in messages" :key="m.id" class="message fade-in" :class="messageClass(m)">
            <!-- 老师 -->
            <div v-if="m.role === 'teacher'" class="msg-avatar teacher-avatar">🧑‍🏫</div>
            <div v-if="m.role === 'teacher'" class="msg-bubble teacher-bubble">
              <div class="msg-label">👨‍🏫 老师</div>
              <div class="msg-text">{{ m.text }}</div>
            </div>

            <!-- 学生（可选 innerThought） -->
            <template v-if="m.role === 'student' || m.role === 'workflow'">
              <div
                class="msg-avatar student-avatar"
                :class="{ 'msg-avatar--image': isImageAvatar(m.avatar) }"
                :style="
                  isImageAvatar(m.avatar)
                    ? {
                        background: (m.color || sampleStudentColor) + '12',
                        borderColor: m.color || sampleStudentColor
                      }
                    : {
                        background: (m.color || sampleStudentColor) + '20',
                        borderColor: m.color || sampleStudentColor
                      }
                "
              >
                <img
                  v-if="isImageAvatar(m.avatar)"
                  class="msg-avatar-img"
                  :src="m.avatar"
                  :alt="m.name || '学生头像'"
                />
                <span v-else class="msg-avatar-emoji">{{ m.avatar || sampleStudentAvatar }}</span>
              </div>
              <div class="msg-content-wrap">
                <div
                  class="msg-bubble student-bubble"
                  :class="m.glowClass || getEmotionGlow(currentEmotion)"
                  :style="{ borderLeft: '3px solid ' + (m.color || sampleStudentColor) }"
                >
                  <div class="msg-label" :style="{ color: m.color || sampleStudentColor }">
                    {{ m.name || sampleStudentName }}
                  </div>
                  <div class="msg-text">{{ m.text }}</div>
                </div>

                <div
                  v-if="m.innerThoughtText"
                  class="inner-thought show"
                  :style="{ borderLeft: '3px solid ' + (m.color || sampleStudentColor) + '40' }"
                >
                  <span class="thought-icon">💭</span>
                  <span class="thought-label">内心OS：</span>
                  <span class="thought-text">{{ m.innerThoughtText }}</span>
                </div>
              </div>
            </template>

            <!-- 智能体回复 -->
            <div v-if="m.role === 'workflow' && !(m.avatar && m.name)" class="msg-avatar workflow-avatar">🤖</div>
            <div v-if="m.role === 'workflow' && !(m.avatar && m.name)" class="msg-bubble workflow-bubble">
              <div class="msg-label">智能体</div>
              <div class="msg-text">{{ m.text }}</div>
            </div>

            <!-- 系统提示 -->
            <div v-if="m.role === 'system'" class="system-bubble">
              {{ m.text }}
            </div>
          </div>

          <!-- 打字提示（可选） -->
          <div
            v-if="typingIndicator"
            class="message student-msg typing-indicator fade-in"
            id="typing-indicator"
          >
            <div
              class="msg-avatar student-avatar"
              :class="{ 'msg-avatar--image': isImageAvatar(props.student?.avatar) }"
              :style="
                isImageAvatar(props.student?.avatar)
                  ? {
                      background: (sampleStudentColor || '#3498db') + '12',
                      borderColor: sampleStudentColor || '#3498db'
                    }
                  : {
                      background: (sampleStudentColor || '#3498db') + '20',
                      borderColor: sampleStudentColor || '#3498db'
                    }
              "
            >
              <img
                v-if="isImageAvatar(props.student?.avatar)"
                class="msg-avatar-img"
                :src="props.student.avatar"
                :alt="props.student?.name || '学生头像'"
              />
              <span v-else class="msg-avatar-emoji">{{ sampleStudentAvatar }}</span>
            </div>
            <div
              class="msg-bubble student-bubble typing-bubble"
              :style="{ borderLeft: '3px solid ' + (sampleStudentColor || '#3498db') }"
            >
              <div class="typing-dots">
                <span></span><span></span><span></span>
              </div>
              <span class="typing-label">{{ sampleStudentName }} 正在思考...</span>
            </div>
          </div>
        </div>

        <!-- 底部输入框区域：多行 Textarea 所有学生都生效 -->
        <div class="chat-input-area">
          <div class="quick-phrases">
            <button
              v-for="p in quickPhrases"
              :key="p.trigger"
              class="quick-btn"
              type="button"
              @click="onQuickPhrase(p)"
            >
              {{ p.label }}
            </button>
          </div>

          <!-- 所有学生统一使用多行 Textarea -->
          <div class="input-row">
            <textarea
              ref="inputRef"
              id="chat-input"
              v-model="inputText"
              :placeholder="placeholder"
              autocomplete="off"
              @keydown="onTextareaKeydown"
              class="chat-textarea"
            ></textarea>
            <button class="send-btn" id="send-btn" type="button" @click="onSend">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </main>
</template>

<style>
@import '../../vendor/front/css/style.css';

/* ==================== 外层环境容器 ==================== */
.chat-environment-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 24px; /* 关键：暴露底层边距，给内部卡片留出呼吸空间 */
  color-scheme: light;
}

/* ==================== 学生专属主题（清冷灰蓝渐变） ==================== */
/* 李大志：习得性无助 - 清冷灰蓝 */
.theme-dazhi {
  background: linear-gradient(135deg, #E6EAEF 0%, #D0D7E1 100%) !important;
}

/* 张一鸣：活泼好动 - 清新天蓝（占位） */
.theme-yiming {
  background: linear-gradient(135deg, #E8F4FF 0%, #D0E8FF 100%) !important;
}

/* 林暖暖：乖巧敏感 - 温柔粉紫（占位） */
.theme-xiaorou {
  background: linear-gradient(135deg, #F3F0FF 0%, #E8E4FF 100%) !important;
}

/* ==================== 内层玻璃态卡片（强制生效！！！） ==================== */
.chat-inner-card {
  flex: 1 !important;
  display: flex !important;
  flex-direction: column !important;
  background-color: rgba(255, 255, 255, 0.60) !important;
  backdrop-filter: blur(16px) !important;
  -webkit-backdrop-filter: blur(16px) !important;
  border-radius: 12px !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05) !important;
  min-width: 0 !important;
  min-height: 0 !important;
  overflow: hidden !important; /* 让内部滚动独立工作 */
}

/* ==================== 卡片内的 Header ==================== */
.chat-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  background: #FFFFFF;
  border-bottom: 1px solid #E5E7EB;
  flex-shrink: 0;
}

/* 复用原有的 chat-header 相关样式 */
.chat-card-header .chat-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex-wrap: wrap;
}

.chat-card-header h2 {
  font-size: 22px;
  font-weight: 800;
  line-height: 1.25;
  letter-spacing: -0.02em;
  color: #12151c;
  margin: 0;
}

.chat-card-header .chat-header-badge {
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 999px;
  font-weight: 700;
  line-height: 1.3;
  flex-shrink: 0;
  white-space: nowrap;
}

.chat-card-header .chat-header-student {
  align-items: center;
  gap: 10px;
}

.chat-card-header .chat-header-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--app-border-default);
  flex: 0 0 32px;
}

.chat-card-header .chat-header-student #chat-header-name {
  font-weight: 700;
  color: var(--app-text-primary);
}

.chat-card-header .chat-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #636e72;
}

.chat-card-header .live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #2ecc71;
  animation: livePulse 2s infinite;
}

@keyframes livePulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(46,204,113,0.4); }
  50% { opacity: 0.7; box-shadow: 0 0 0 6px rgba(46,204,113,0); }
}

/* ==================== 对话流区域（撑满剩余空间） ==================== */
.chat-inner-card .chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  min-height: 0;
}

/* ==================== 输入框区域 ==================== */
.chat-inner-card .chat-input-area {
  padding: 16px 24px 24px;
  border-top: 1px solid #E5E7EB;
  flex-shrink: 0;
}

/* 确保 chat-main 还是原来的 flex 容器 */
.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  color-scheme: light;
}

/* ==================== 多行 Textarea 强制样式（所有学生生效！） ==================== */
.input-row {
  display: flex !important;
  gap: 12px !important;
  align-items: flex-end !important;
  margin-top: 12px !important;
}

.chat-textarea {
  flex: 1 !important;
  min-height: 100px !important;
  max-height: 200px !important;
  resize: vertical !important;
  padding: 12px 16px !important;
  border-radius: 12px !important;
  border: 1px solid #dfe6e9 !important;
  font-size: 14px !important;
  line-height: 1.5 !important;
  background: rgba(255, 255, 255, 0.95) !important;
  color: #2d3436 !important;
  outline: none !important;
  font-family: inherit !important;
}

.chat-textarea:focus {
  border-color: #74b9ff !important;
  box-shadow: 0 0 0 3px rgba(116, 185, 255, 0.15) !important;
}

.chat-textarea::placeholder {
  color: rgba(45, 52, 54, 0.4) !important;
}

/* 学生头像：支持 URL/路径为图片，避免路径字符串溢出气泡 */
.msg-avatar--image {
  padding: 0;
  overflow: hidden;
  box-sizing: border-box;
}
.msg-avatar-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

/* 李大志：原图偏纵向构图，cover 默认中心裁切易切掉头顶；略上移对齐焦点在面部 */
.theme-dazhi .chat-header-avatar,
.theme-dazhi .msg-avatar-img {
  object-position: 50% 25%;
}
.msg-avatar-emoji {
  line-height: 1;
}
</style>
