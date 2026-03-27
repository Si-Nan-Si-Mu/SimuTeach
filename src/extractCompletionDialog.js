/**
 * 从 Chat Completions 形态的 JSON（完整或流式片段）中提取 assistant 对话正文；
 * 并兼容腾讯云等工作流返回的外层结构（payload / can_feedback / content 嵌套 JSON 字符串等）。
 */

function unescapeJsonStringContent(s) {
  if (s == null || typeof s !== 'string') return ''
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

export function dialogFromCompletionObj(obj) {
  if (!obj || typeof obj !== 'object') return ''
  if (Array.isArray(obj.choices) && obj.choices[0] && obj.choices[0].message) {
    const msg = obj.choices[0].message
    if (typeof msg.content === 'string') return msg.content
  }
  return ''
}

export function extractDialogFromCompletionJsonFragment(jsonText) {
  if (!jsonText || typeof jsonText !== 'string') return ''
  const t = jsonText
    .replace(/^[\uFEFF\u200B-\u200D\u2060]+/, '')
    .replace(/[\uFEFF\u200B-\u200D\u2060]+$/, '')
    .trim()
  if (!t) return ''
  if (t.startsWith('{') && t.endsWith('}')) {
    try {
      const obj = JSON.parse(t)
      const d = dialogFromCompletionObj(obj)
      if (d) return d
    } catch (_) {
      /* 流式未闭合 */
    }
  }
  const reChoice =
    /"choices"\s*:\s*\[\s*\{[\s\S]*?"message"\s*:\s*\{[\s\S]*?"content"\s*:\s*"((?:[^"\\]|\\.)*)/
  const m1 = t.match(reChoice)
  if (m1 && m1[1] != null) return unescapeJsonStringContent(m1[1])
  const reContent = /"content"\s*:\s*"((?:[^"\\]|\\.)*)/
  const m2 = t.match(reContent)
  if (m2 && m2[1] != null) return unescapeJsonStringContent(m2[1])
  return ''
}

/**
 * 尝试解析「像 JSON 但 key 未加引号」的片段（如日志里的 payload : { ... }）
 */
export function tryParseLenientWorkflowJson(s) {
  if (!s || typeof s !== 'string') return null
  const t = s.trim()
  if (!t) return null
  try {
    return JSON.parse(t)
  } catch (_) {}
  let fixed = t.replace(/^\s*([a-zA-Z_][\w]*)\s*:\s*/, '"$1":')
  fixed = fixed.replace(/([,{]\s*)([a-zA-Z_][\w]*)\s*:/g, '$1"$2":')
  try {
    return JSON.parse(fixed)
  } catch (_) {}
  const i0 = t.indexOf('{')
  const i1 = t.lastIndexOf('}')
  if (i0 >= 0 && i1 > i0) {
    const slice = t.slice(i0, i1 + 1)
    try {
      return JSON.parse(slice)
    } catch (_) {
      try {
        const f2 = slice.replace(/([,{]\s*)([a-zA-Z_][\w]*)\s*:/g, '$1"$2":')
        return JSON.parse(f2)
      } catch (_) {}
    }
  }
  return null
}

/**
 * 从工作流对象任意深度取出「给学生看的」文本（跳过 can_feedback 等元数据壳子）
 */
export function deepExtractAssistantDialogFromObject(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 14) return ''
  const fromChoice = dialogFromCompletionObj(obj)
  if (fromChoice) return fromChoice

  const nestKeys = ['payload', 'data', 'result', 'body', 'output', 'response']
  for (const nk of nestKeys) {
    const sub = obj[nk]
    if (sub && typeof sub === 'object') {
      const inner = deepExtractAssistantDialogFromObject(sub, depth + 1)
      if (inner) return inner
    }
    if (typeof sub === 'string' && sub.trim()) {
      const st = sub.trim()
      if (st.startsWith('{') || st.includes('"choices"')) {
        try {
          const parsed = JSON.parse(st)
          const inner = deepExtractAssistantDialogFromObject(parsed, depth + 1)
          if (inner) return inner
        } catch (_) {
          const frag = extractDialogFromCompletionJsonFragment(st)
          if (frag) return frag
        }
      }
    }
  }

  if (obj.message && typeof obj.message === 'object' && !Array.isArray(obj.message)) {
    const inner = deepExtractAssistantDialogFromObject(obj.message, depth + 1)
    if (inner) return inner
  }

  const strKeys = [
    'content',
    'text',
    'reply',
    'message',
    'answer',
    'assistant_message',
    'bot_reply',
    'output_text'
  ]
  for (const k of strKeys) {
    const v = obj[k]
    if (typeof v !== 'string') continue
    const tt = v.trim()
    if (!tt) continue
    if (tt.startsWith('{') || tt.includes('"choices"') || tt.includes('"message"')) {
      try {
        const parsed = JSON.parse(tt)
        const inner = deepExtractAssistantDialogFromObject(parsed, depth + 1)
        if (inner) return inner
      } catch (_) {
        const frag = extractDialogFromCompletionJsonFragment(tt)
        if (frag) return frag
      }
      continue
    }
    return v
  }
  return ''
}

/**
 * 最后一道净化：气泡 / 日志用，绝不把 can_feedback 壳子原样当对话
 */
export function normalizeAssistantDialogText(raw) {
  if (raw == null) return ''
  const s0 = String(raw)
  const trimmed = s0.trim()
  if (!trimmed) return ''

  const parsed = tryParseLenientWorkflowJson(trimmed)
  if (parsed && typeof parsed === 'object') {
    const d = deepExtractAssistantDialogFromObject(parsed)
    if (d) return d
  }

  if (trimmed.includes('"choices"') || trimmed.includes('choices')) {
    const frag = extractDialogFromCompletionJsonFragment(trimmed)
    if (frag) return frag
  }

  if (trimmed.startsWith('{')) {
    try {
      const o = JSON.parse(trimmed)
      const d = deepExtractAssistantDialogFromObject(o)
      if (d) return d
      const c = dialogFromCompletionObj(o)
      if (c) return c
    } catch (_) {
      const frag = extractDialogFromCompletionJsonFragment(trimmed)
      if (frag) return frag
    }
  }

  // 明显是接口元数据串，又抽不出正文 → 不往气泡里塞整段 JSON
  if (/can_feedback|can_rating/i.test(trimmed) && /payload/i.test(trimmed)) {
    const p2 = tryParseLenientWorkflowJson(trimmed)
    if (p2) {
      const d = deepExtractAssistantDialogFromObject(p2)
      if (d) return d
    }
    return ''
  }

  return s0
}
