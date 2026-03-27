<script setup>
import { nextTick, ref, watch } from 'vue'
import ChatBox from './ChatBox.vue'
import EmotionPanel from './EmotionPanel.vue'

const props = defineProps({
  headerName: { type: String, default: '😔 李大志' },
  headerType: { type: String, default: '习得性无助型' },
  currentEmotion: { type: Object, default: null },
  student: { type: Object, default: null }
})

const emit = defineEmits(['send'])

const chatBoxRef = ref(null)
const emotionPanelRef = ref(null)

/** 小屏下底部 Tab：对话 | 情绪看板 */
const mobileActivePanel = ref('chat')

watch(mobileActivePanel, () => {
  nextTick(() => {
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
  })
})

defineExpose({
  // ChatBox methods
  clear: () => chatBoxRef.value?.clear?.(),
  clearAllCharacterThreads: () => chatBoxRef.value?.clearAllCharacterThreads?.(),
  showTypingIndicator: () => chatBoxRef.value?.showTypingIndicator?.(),
  removeTypingIndicator: () => chatBoxRef.value?.removeTypingIndicator?.(),
  appendWorkflowReply: (text) => chatBoxRef.value?.appendWorkflowReply?.(text),
  showWorkflowLoading: (show) => chatBoxRef.value?.showWorkflowLoading?.(show),
  appendSystem: (text) => chatBoxRef.value?.appendSystem?.(text),

  // EmotionPanel methods
  resetEmotions: (student) => emotionPanelRef.value?.resetEmotions?.(student),
  pushEmotionPoint: (emotion) => emotionPanelRef.value?.pushEmotionPoint?.(emotion),
  recordTeacherTrigger: (trigger) => emotionPanelRef.value?.recordTeacherTrigger?.(trigger),
  clearAllCharacterDashboardSnapshots: () =>
    emotionPanelRef.value?.clearAllCharacterDashboardSnapshots?.()
})
</script>

<template>
  <div
    class="training-shell"
    :class="
      mobileActivePanel === 'dashboard' ? 'training-shell--dash' : 'training-shell--chat'
    "
  >
    <div class="training-panels">
      <div class="training-panel training-panel--chat">
        <ChatBox
          ref="chatBoxRef"
          :current-emotion="props.currentEmotion"
          :header-name="props.headerName"
          :header-type="props.headerType"
          :student="props.student"
          @send="(payload) => emit('send', payload)"
        />
      </div>
      <div class="training-panel training-panel--dash">
        <EmotionPanel
          ref="emotionPanelRef"
          :emotion="props.currentEmotion"
          :student="props.student"
        />
      </div>
    </div>

    <nav class="mobile-tabbar" aria-label="训练视图切换">
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
        📊 看板
      </button>
    </nav>
  </div>
</template>

