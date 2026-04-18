import { createApp } from 'vue'
import './style.css'
import App from './App.vue'

// 课堂模拟独立 Bot：必须在 workflow.js 之前注入
import './classroom-workflow-inject.js'

// 工作流（腾讯云 SSE）：通过 window 注入 WorkflowClient / WorkflowDataStore（源码在 vendor/front/js）
import '../vendor/front/js/workflow.js'

async function buildCursorDataUrl(src, size = 32) {
  const img = new Image()
  img.decoding = 'async'
  img.src = src
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = reject
  }).catch(() => null)
  if (!img.naturalWidth || !img.naturalHeight) return ''

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight)
  const drawW = Math.max(1, Math.round(img.naturalWidth * scale))
  const drawH = Math.max(1, Math.round(img.naturalHeight * scale))
  const dx = Math.floor((size - drawW) / 2)
  const dy = Math.floor((size - drawH) / 2)
  ctx.clearRect(0, 0, size, size)
  ctx.drawImage(img, dx, dy, drawW, drawH)
  return canvas.toDataURL('image/png')
}

async function applyCustomCursorFromPng() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  // (2) 作为默认状态鼠标；(1) 作为可交互/有内容状态鼠标
  const normalUrl = await buildCursorDataUrl('/remove-photos-background-removed(2).png', 32)
  const activeUrl = await buildCursorDataUrl('/remove-photos-background-removed(1).png', 32)

  if (normalUrl) {
    document.documentElement.style.setProperty('--app-cursor', `url("${normalUrl}") 4 4`)
  }
  if (activeUrl) {
    document.documentElement.style.setProperty('--app-cursor-active', `url("${activeUrl}") 4 4`)
  }
}

applyCustomCursorFromPng()

createApp(App).mount('#app')
