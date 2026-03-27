<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

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

// 与旧版 front/js/app.js 一致：按当前学生设置 #chat-area 背景渐变（纯 CSS 里没有写死背景）
const chatAreaStyle = computed(() => {
  const g = props.student?.bgGradient
  if (g) return { background: g }
  return { background: 'linear-gradient(180deg, #f5f7fa 0%, #eef1f5 100%)' }
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
  <main class="chat-main">
    <div class="chat-area" id="chat-area" :class="areaGlowClass" :style="chatAreaStyle">
      <div class="chat-header">
        <div class="chat-header-left">
          <h2 id="chat-header-name">{{ headerName }}</h2>
          <span class="chat-header-badge" id="chat-header-type" :style="headerBadgeStyle">{{ headerType }}</span>
        </div>
        <div class="chat-header-right">
          <span v-if="isLive" class="live-dot"></span>
          <span>{{ liveText }}</span>
        </div>
      </div>

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
              :style="{
                background: ((m.color || sampleStudentColor) + '20'),
                borderColor: m.color || sampleStudentColor
              }"
            >
              {{ m.avatar || sampleStudentAvatar }}
            </div>
            <div class="msg-content-wrap">
              <div
                class="msg-bubble student-bubble"
                :class="m.glowClass || getEmotionGlow(currentEmotion)"
                :style="{ borderLeft: '3px solid ' + (m.color || sampleStudentColor) }"
              >
                <div class="msg-label" :style="{ color: m.color || sampleStudentColor }">
                  {{ m.avatar || sampleStudentAvatar }} {{ m.name || sampleStudentName }}
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

          <!-- 智能体工作流回复 -->
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
            :style="{
              background: (sampleStudentColor || '#3498db') + '20',
              borderColor: sampleStudentColor || '#3498db'
            }"
          >
            {{ sampleStudentAvatar }}
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

        <div class="input-row">
          <input
            ref="inputRef"
            id="chat-input"
            type="text"
            v-model="inputText"
            :placeholder="placeholder"
            autocomplete="off"
            @keydown.enter.prevent="onEnter"
          />
          <button class="send-btn" id="send-btn" type="button" @click="onSend">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path>
            </svg>
          </button>
        </div>
      </div>
    </div>
  </main>
</template>

<style>
@import '../../vendor/front/css/style.css';
</style>

