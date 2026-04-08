<script setup>
import { computed, ref } from 'vue'

const ACCEPT_TYPES = '.pdf,.ppt,.pptx,.mp3,.wav,.m4a,.jpg,.jpeg,.png,.webp'
const MAX_FILES = 10

const files = ref([])
const sending = ref(false)
const sent = ref(false)
const dragOver = ref(false)

const totalSizeText = computed(() => {
  const total = files.value.reduce((sum, f) => sum + (Number(f.size) || 0), 0)
  if (total < 1024) return `${total} B`
  if (total < 1024 * 1024) return `${(total / 1024).toFixed(1)} KB`
  return `${(total / 1024 / 1024).toFixed(2)} MB`
})

function normalizeFileList(listLike) {
  const arr = Array.from(listLike || [])
  const next = []
  const seen = new Set()
  for (const f of arr) {
    const key = `${f.name}_${f.size}_${f.lastModified}`
    if (seen.has(key)) continue
    seen.add(key)
    next.push(f)
    if (next.length >= MAX_FILES) break
  }
  return next
}

function onChooseFiles(e) {
  files.value = normalizeFileList(e?.target?.files)
  sent.value = false
}

function onDrop(e) {
  dragOver.value = false
  files.value = normalizeFileList(e?.dataTransfer?.files)
  sent.value = false
}

function removeFile(i) {
  files.value = files.value.filter((_, idx) => idx !== i)
  sent.value = false
}

async function onSend() {
  if (!files.value.length || sending.value) return
  sending.value = true
  sent.value = false
  try {
    await new Promise((resolve) => setTimeout(resolve, 900))
    sent.value = true
    if (typeof window !== 'undefined' && window.console) {
      console.log('[TeachingDoc] 文件发送预览', files.value.map((f) => ({ name: f.name, size: f.size, type: f.type })))
    }
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <main class="doc-analysis-page">
    <section class="doc-shell">
      <header class="doc-header">
        <div>
          <h2>教学资料智能分析</h2>
          <p>上传课件、讲义与课堂素材，系统将自动整理并生成可用于教学复盘的分析结果。</p>
        </div>
      </header>

      <section
        class="upload-dropzone"
        :class="{ 'upload-dropzone--over': dragOver }"
        @dragover.prevent="dragOver = true"
        @dragleave.prevent="dragOver = false"
        @drop.prevent="onDrop"
      >
        <div class="upload-emoji">📚</div>
        <h3>拖拽上传或点击选择文件</h3>
        <p>支持 PDF / PPT / 语音 / 图片，最多 {{ MAX_FILES }} 个文件</p>
        <label class="upload-btn" for="teaching-doc-input">选择文件</label>
        <input
          id="teaching-doc-input"
          class="upload-input"
          type="file"
          :accept="ACCEPT_TYPES"
          multiple
          @change="onChooseFiles"
        />
      </section>

      <section class="file-panel">
        <div class="file-panel-head">
          <h4>待分析文件</h4>
          <span>{{ files.length }} 个 · {{ totalSizeText }}</span>
        </div>
        <div v-if="!files.length" class="file-empty">暂未选择文件</div>
        <ul v-else class="file-list">
          <li v-for="(f, i) in files" :key="`${f.name}-${f.size}-${f.lastModified}`" class="file-item">
            <div class="file-main">
              <strong>{{ f.name }}</strong>
              <small>{{ f.type || '未知类型' }} · {{ Math.max(1, Math.round((f.size || 0) / 1024)) }} KB</small>
            </div>
            <button type="button" class="file-remove" @click="removeFile(i)">移除</button>
          </li>
        </ul>
      </section>

      <footer class="doc-footer">
        <button type="button" class="send-btn" :disabled="!files.length || sending" @click="onSend">
          {{ sending ? '发送中...' : '发送分析数据' }}
        </button>
        <span v-if="sent" class="send-ok">数据发送完成（页面设计态）</span>
      </footer>
    </section>
  </main>
</template>

<style scoped>
.doc-analysis-page {
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 20px;
  overflow: auto;
  background: linear-gradient(180deg, #f7f5ef 0%, #f2eee4 100%);
}

.doc-shell {
  max-width: 980px;
  margin: 0 auto;
  padding: 20px;
  border-radius: 20px;
  border: 1px solid rgba(45, 52, 54, 0.12);
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 14px 36px rgba(45, 52, 54, 0.1);
}

.doc-header {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-bottom: 14px;
  text-align: center;
}

.doc-header h2 {
  margin: 0 0 6px;
  font-size: 28px;
  color: #1f2d3d;
}

.doc-header p {
  margin: 0;
  font-size: 14px;
  color: #6c7a89;
}

.upload-dropzone {
  border: 1.5px dashed rgba(52, 152, 219, 0.5);
  border-radius: 16px;
  padding: 24px 16px;
  text-align: center;
  background: rgba(52, 152, 219, 0.06);
  transition: all 0.2s ease;
}

.upload-dropzone--over {
  border-color: rgba(41, 128, 185, 0.85);
  background: rgba(52, 152, 219, 0.14);
}

.upload-emoji {
  font-size: 30px;
  margin-bottom: 4px;
}

.upload-dropzone h3 {
  margin: 6px 0;
  color: #2d3436;
}

.upload-dropzone p {
  margin: 0 0 12px;
  color: #636e72;
  font-size: 13px;
}

.upload-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 9px 14px;
  border-radius: 10px;
  background: linear-gradient(180deg, #6d4c41, #5d4037);
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}

.upload-input {
  display: none;
}

.file-panel {
  margin-top: 14px;
  border: 1px solid rgba(45, 52, 54, 0.1);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.86);
}

.file-panel-head {
  display: flex;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(45, 52, 54, 0.08);
}

.file-panel-head h4 {
  margin: 0;
  color: #2d3436;
}

.file-panel-head span {
  color: #7f8c8d;
  font-size: 12px;
}

.file-empty {
  padding: 20px 14px;
  text-align: center;
  color: #95a5a6;
}

.file-list {
  margin: 0;
  padding: 8px 10px 10px;
  list-style: none;
  display: grid;
  gap: 8px;
}

.file-item {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 10px;
  border-radius: 10px;
  background: #f8f9fb;
  border: 1px solid rgba(45, 52, 54, 0.08);
}

.file-main {
  min-width: 0;
}

.file-main strong {
  display: block;
  color: #2d3436;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-main small {
  color: #7f8c8d;
}

.file-remove {
  border: none;
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
  background: rgba(231, 76, 60, 0.12);
  color: #b23d2f;
  font-weight: 700;
}

.doc-footer {
  margin-top: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 12px;
}

.send-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 12px;
  min-height: 42px;
  min-width: 168px;
  padding: 10px 18px;
  color: #fff;
  font-weight: 700;
  font-size: clamp(13px, 1.8vw, 15px);
  line-height: 1.2;
  letter-spacing: 0.2px;
  white-space: nowrap;
  writing-mode: horizontal-tb;
  text-orientation: mixed;
  cursor: pointer;
  background: linear-gradient(180deg, #1565c0, #0d47a1);
}

.send-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.send-ok {
  color: #1e7f45;
  font-size: 13px;
  font-weight: 600;
}

@media (max-width: 768px) {
  .doc-analysis-page {
    padding: 10px;
  }

  .doc-shell {
    padding: 14px;
    border-radius: 14px;
  }

  .doc-header {
    flex-direction: column;
  }

  .doc-header h2 {
    font-size: 22px;
  }

  .doc-footer {
    justify-content: center;
    align-items: center;
  }

  .send-btn {
    min-width: 156px;
    font-size: 14px;
  }
}
</style>
