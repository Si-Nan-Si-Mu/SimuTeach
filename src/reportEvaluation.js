/**
 * 解析生成报告 API 返回体中的 x-evaluation（与 evaluation_format 示例一致）
 */

/**
 * OU / 情绪状态机参数中文名（与 config 中 emotion_state._comment 说明一致）
 */
export const OU_PARAM_LABELS = {
  baseline_valence: '情绪效价基线（正偏积极，0 为中性）',
  baseline_arousal: '情绪唤醒基线（高活跃，低低沉）',
  alpha: '状态惯性（情绪不易突变）',
  beta: 'AI 输出对情绪的反馈权重',
  gamma: '教师输入对学生情绪的影响权重',
  delta: '均值回归强度（回到基线）',
  kappa: '效价-唤醒耦合（高唤醒放大情绪偏移）',
  negativity_bias: '负面情绪衰减减速因子（>1 时负面情绪消退更慢）',
  noise_sigma: '过程噪声',
  injection_threshold: '注入阈值',
  save_interval_turns: '保存间隔（轮）',
  persist_to_l4: '持久化到 L4'
}

export function getOuParamLabel(key) {
  if (key == null) return ''
  const k = String(key)
  return OU_PARAM_LABELS[k] || k
}

function tryParseJsonString(s) {
  if (typeof s !== 'string') return null
  const t = s.trim()
  if (!t) return null
  try {
    return JSON.parse(t)
  } catch {
    return null
  }
}

/**
 * 将代理/网关包装过的报告响应还原为与控制台一致的「根对象」
 * （例如 { data: "{...}" }、{ result: {...} }、双重 JSON 字符串等）
 */
export function unwrapReportApiResponse(raw) {
  if (raw == null) return null
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t) return null
    try {
      return unwrapReportApiResponse(JSON.parse(t))
    } catch {
      return null
    }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return raw

  const looksLikeCompletionRoot = (o) =>
    o &&
    typeof o === 'object' &&
    (o['x-evaluation'] ||
      o['x-debug'] ||
      o.model != null ||
      (Array.isArray(o.choices) && o.choices.length > 0) ||
      (o.usage && typeof o.usage === 'object'))

  if (looksLikeCompletionRoot(raw)) return raw

  for (const k of ['data', 'result', 'response', 'body', 'payload', 'output']) {
    if (!(k in raw)) continue
    const inner = raw[k]
    if (typeof inner === 'string') {
      const u = unwrapReportApiResponse(inner)
      if (u && looksLikeCompletionRoot(u)) return u
    } else if (inner && typeof inner === 'object') {
      const u = unwrapReportApiResponse(inner)
      if (u && looksLikeCompletionRoot(u)) return u
    }
  }

  return raw
}

function formatReportUnixSeconds(ts) {
  const n = Number(ts)
  if (!Number.isFinite(n)) return '—'
  const sec = n < 1e12 ? n : Math.floor(n / 1000)
  try {
    return new Date(sec * 1000).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return String(sec)
  }
}

/**
 * 从 Chat Completions 或裸对象中提取 x-evaluation 块
 */
export function extractXEvaluation(data) {
  if (data == null || typeof data !== 'object') return null
  if (data['x-evaluation'] && typeof data['x-evaluation'] === 'object') return data['x-evaluation']
  if (data.x_evaluation && typeof data.x_evaluation === 'object') return data.x_evaluation
  // 部分网关把评估块放在 evaluation 下且结构与 x-evaluation 相同
  if (data.evaluation && typeof data.evaluation === 'object' && data.evaluation.categories) {
    return data.evaluation
  }

  const ch0 = data.choices && Array.isArray(data.choices) ? data.choices[0] : null
  const msg = ch0 && ch0.message
  const content = msg && msg.content

  if (typeof content === 'string') {
    const inner = tryParseJsonString(content)
    if (inner) {
      const nested = extractXEvaluation(inner)
      if (nested) return nested
    }
  } else if (content && typeof content === 'object') {
    const nested = extractXEvaluation(content)
    if (nested) return nested
  }

  return null
}

function esc(fn, s) {
  if (s == null) return ''
  return fn(String(s))
}

function formatScore(v) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  if (n >= 0 && n <= 1) return (n * 100).toFixed(1) + '%'
  return n.toFixed(2)
}

function renderHits(fn, hits, limit = 8) {
  const arr = Array.isArray(hits) ? hits : []
  if (!arr.length) return '<p class="report-x-hits-empty">暂无命中记录</p>'
  const shown = arr.slice(0, limit)
  const more =
    arr.length > limit ? `<p class="report-x-hits-more">… 共 ${arr.length} 条，展示前 ${limit} 条</p>` : ''
  return (
    '<ul class="report-x-hits">' +
    shown
      .map((h) => {
        if (!h || typeof h !== 'object') return ''
        const meta = [h.method, h.matched, h.score != null ? `匹配得分 ${h.score}` : ''].filter(Boolean).join(' · ')
        return `<li>
          <span class="report-x-hit-turn">轮次 ${esc(fn, h.turn_index)}</span>
          ${meta ? `<span class="report-x-hit-meta">${esc(fn, meta)}</span>` : ''}
          <div class="report-x-hit-sentence">${esc(fn, h.sentence)}</div>
        </li>`
      })
      .join('') +
    '</ul>' +
    more
  )
}

function renderWindows(fn, windows) {
  const arr = Array.isArray(windows) ? windows : []
  if (!arr.length) return ''
  return (
    '<div class="report-x-windows"><strong>时间窗</strong><ul>' +
    arr
      .map(
        (w) =>
          `<li>回合 ${esc(fn, w.start_turn)}–${esc(fn, w.end_turn)}，BCEI ${esc(fn, w.bcei)}，Δv ${esc(fn, w.raw_delta_v)}</li>`
      )
      .join('') +
    '</ul></div>'
  )
}

function renderIndicator(fn, key, ind) {
  if (!ind || typeof ind !== 'object') return ''
  const name = ind.name || key
  const parts = []
  if (ind.count != null || ind.normalized_score != null) {
    parts.push(
      `<div class="report-x-ind-stats">次数 <strong>${esc(fn, ind.count ?? '—')}</strong> · 归一化得分 <strong>${formatScore(ind.normalized_score)}</strong></div>`
    )
  }
  const hasWindows = Array.isArray(ind.windows) && ind.windows.length
  if (ind.mean_bcei != null || ind.score != null || ind.window_count != null || hasWindows) {
    const bits = []
    if (ind.mean_bcei != null) bits.push(`均值 BCEI：${esc(fn, ind.mean_bcei)}`)
    if (ind.window_count != null) bits.push(`时间窗数量：${esc(fn, ind.window_count)}`)
    if (ind.score != null) bits.push(`得分 ${formatScore(ind.score)}`)
    if (bits.length) parts.push(`<p class="report-x-ind-medium">${bits.join(' · ')}</p>`)
  }
  if (Array.isArray(ind.windows) && ind.windows.length) {
    parts.push(renderWindows(fn, ind.windows))
  }
  parts.push(renderHits(fn, ind.hits))
  return `<details class="report-x-ind"><summary>${esc(fn, name)}</summary>${parts.join('')}</details>`
}

function renderCategory(fn, catKey, cat) {
  if (!cat || typeof cat !== 'object') return ''
  const title = cat.name || catKey
  const indicators = cat.indicators && typeof cat.indicators === 'object' ? cat.indicators : {}
  const inner = Object.keys(indicators)
    .map((ik) => renderIndicator(fn, ik, indicators[ik]))
    .join('')

  return `<div class="report-x-cat">
    <div class="report-x-cat-head">
      <h4>${esc(fn, title)}</h4>
      <span class="report-x-cat-score">综合：${formatScore(cat.score)}</span>
    </div>
    <div class="report-x-ind-list">${inner}</div>
  </div>`
}

/**
 * 训练概况四格：有 x-evaluation 时用评估字段 + 根对象上的 model / usage（与 unwrap 后的 JSON 一致）
 * @param {object | null} reportRoot — unwrapReportApiResponse 后的完整响应根对象
 */
export function buildTrainingOverviewHtml(xe, localSummary, escapeHtmlFn, reportRoot = null) {
  const fn = escapeHtmlFn || ((s) => String(s))
  if (xe && typeof xe === 'object') {
    const root = reportRoot && typeof reportRoot === 'object' ? reportRoot : {}
    const modelVal =
      root.model != null && root.model !== ''
        ? root.model
        : '—'
    const usage = root.usage && typeof root.usage === 'object' ? root.usage : null
    const totalTok = usage && usage.total_tokens != null ? usage.total_tokens : null
    const fourthLabel = totalTok != null && String(totalTok) !== '' ? 'Token 总计' : '响应时间'
    const fourthVal =
      totalTok != null && String(totalTok) !== ''
        ? String(totalTok)
        : formatReportUnixSeconds(root.created)

    return `<div class="summary-grid summary-grid--xe">
      <div class="summary-item">
        <div class="summary-num">${esc(fn, xe.total_turns != null ? xe.total_turns : '—')}</div>
        <div class="summary-label">对话轮次</div>
      </div>
      <div class="summary-item">
        <div class="summary-num summary-num--text">${esc(fn, xe.evaluated_at != null ? xe.evaluated_at : '—')}</div>
        <div class="summary-label">评估时间</div>
      </div>
      <div class="summary-item">
        <div class="summary-num summary-num--text">${esc(fn, modelVal)}</div>
        <div class="summary-label">模型（接口返回）</div>
      </div>
      <div class="summary-item">
        <div class="summary-num summary-num--text">${esc(fn, fourthVal)}</div>
        <div class="summary-label">${esc(fn, fourthLabel)}</div>
      </div>
    </div>`
  }
  if (!localSummary || typeof localSummary !== 'object') {
    return '<div class="summary-grid"></div>'
  }
  return `<div class="summary-grid">
    <div class="summary-item">
      <div class="summary-num">${esc(fn, localSummary.totalRounds)}</div>
      <div class="summary-label">对话轮次</div>
    </div>
    <div class="summary-item">
      <div class="summary-num">${esc(fn, localSummary.teacherMessages)}</div>
      <div class="summary-label">教师发言</div>
    </div>
    <div class="summary-item">
      <div class="summary-num">${esc(fn, localSummary.studentMessages)}</div>
      <div class="summary-label">学生回应</div>
    </div>
    <div class="summary-item">
      <div class="summary-num">${esc(fn, localSummary.duration)}</div>
      <div class="summary-label">训练时长</div>
    </div>
  </div>`
}

/**
 * 根据评估大类得分生成改进建议（完全依据 x-evaluation）
 */
export function buildSuggestionsFromXe(xe) {
  if (!xe || !xe.categories || typeof xe.categories !== 'object') {
    return [
      {
        type: 'info',
        icon: '📊',
        text: '未收到智能评估分类数据，无法生成基于报告的改进建议。'
      }
    ]
  }
  const entries = Object.entries(xe.categories).map(([k, c]) => ({
    key: k,
    name: (c && c.name) || k,
    score: Number(c && c.score)
  }))
  const valid = entries.filter((e) => Number.isFinite(e.score))
  if (!valid.length) {
    return [{ type: 'info', icon: '📊', text: '评估分类缺少有效得分，请检查接口返回。' }]
  }
  valid.sort((a, b) => a.score - b.score)
  const out = []
  const worst = valid[0]
  if (worst.score < 0.15) {
    out.push({
      type: 'warning',
      icon: '⚠️',
      text: `「${worst.name}」综合得分偏低（${formatScore(worst.score)}），建议对照下方「智能评估」指标明细，有针对性地加强相关教学行为。`
    })
  }
  const second = valid[1]
  if (second && second.key !== worst.key && second.score < 0.2) {
    out.push({
      type: 'tip',
      icon: '💡',
      text: `「${second.name}」仍有提升空间（${formatScore(second.score)}），可适当增加与之相关的课堂语言与策略。`
    })
  }
  const best = valid[valid.length - 1]
  if (best && best.score >= 0.2) {
    out.push({
      type: 'praise',
      icon: '🌟',
      text: `「${best.name}」在本次评估中相对突出（${formatScore(best.score)}），请继续保持优势做法。`
    })
  }
  if (!out.length) {
    out.push({
      type: 'info',
      icon: '📊',
      text: '各维度得分接近，请结合明细指标微调教学策略，争取均衡发展。'
    })
  }
  return out
}

/**
 * 接口根对象上的 x-debug（情绪快照等）
 */
export function buildXDebugSection(reportRoot, escapeHtmlFn) {
  if (!reportRoot || typeof reportRoot !== 'object') return ''
  const dbg = reportRoot['x-debug']
  if (!dbg || typeof dbg !== 'object') return ''
  const fn = escapeHtmlFn || ((s) => String(s))
  const em = dbg.emotion
  const es = dbg.emotion_state
  const lines = []
  if (em && typeof em === 'object') {
    lines.push(
      `<li><strong>情绪</strong>：标签 ${esc(fn, em.label)}，强度 ${esc(fn, em.intensity)}</li>`
    )
  }
  if (es && typeof es === 'object') {
    lines.push(
      `<li><strong>情绪状态机</strong>：效价 ${esc(fn, es.valence)}，唤醒 ${esc(fn, es.arousal)}，标签 ${esc(fn, es.label)}</li>`
    )
  }
  if (!lines.length) return ''
  return `<div class="report-section report-x-debug-block">
    <h3>🔍 本轮对话快照（x-debug）</h3>
    <ul class="report-x-debug-list">${lines.join('')}</ul>
  </div>`
}

/**
 * 生成可插入报告弹窗的 HTML（需配合全局样式 .report-x-*）
 * @param {{ omitMeta?: boolean }} [options] — 为 true 时不重复输出会话/时间等（已放在训练概况）
 */
export function buildEvaluationHtml(xe, escapeHtmlFn, options = {}) {
  if (!xe || typeof xe !== 'object') return ''
  const fn = escapeHtmlFn || ((s) => String(s))
  const omitMeta = options && options.omitMeta

  const meta = omitMeta
    ? ''
    : `
    <div class="report-x-eval-meta">
      <div><span class="report-x-k">评估时间</span><span class="report-x-v">${esc(fn, xe.evaluated_at)}</span></div>
      <div><span class="report-x-k">总轮次</span><span class="report-x-v">${esc(fn, xe.total_turns)}</span></div>
    </div>`

  let ou = ''
  const oup = xe.ou_params
  if (oup && typeof oup === 'object') {
    ou = `<div class="report-x-ou"><h5>情绪 OU 过程参数</h5><p class="report-x-ou-hint">与数字学生配置中情绪状态机（Ornstein-Uhlenbeck）含义一致</p><dl class="report-x-dl">${Object.keys(oup)
      .map((k) => `<dt>${esc(fn, getOuParamLabel(k))}</dt><dd>${esc(fn, oup[k])}</dd>`)
      .join('')}</dl></div>`
  }

  const cats = xe.categories && typeof xe.categories === 'object' ? xe.categories : {}
  const catsHtml = Object.keys(cats)
    .map((ck) => renderCategory(fn, ck, cats[ck]))
    .join('')

  return `
    <div class="report-section report-x-eval">
      <h3>📈 智能评估（x-evaluation）</h3>
      ${meta}
      ${ou}
      <div id="report-eval-categories-chart" class="report-x-chart" style="width:100%;height:240px;"></div>
      <div class="report-x-cats">${catsHtml}</div>
    </div>`
}

/** 供 ECharts 柱状图：大类得分 */
export function getCategoryScoresForChart(xe) {
  if (!xe || !xe.categories || typeof xe.categories !== 'object') return { names: [], values: [] }
  const names = []
  const values = []
  for (const ck of Object.keys(xe.categories)) {
    const c = xe.categories[ck]
    if (!c || typeof c !== 'object') continue
    names.push(c.name || ck)
    const s = Number(c.score)
    values.push(Number.isFinite(s) ? (s >= 0 && s <= 1 ? s * 100 : s) : 0)
  }
  return { names, values }
}

/**
 * 用 x-evaluation.categories 驱动「能力评估」雷达 + 条形图（0–1 转为 0–100 分）
 */
export function buildAbilityViewFromXe(xe) {
  if (!xe || !xe.categories || typeof xe.categories !== 'object') return null
  const keys = Object.keys(xe.categories)
  if (!keys.length) return null
  const items = keys.map((k) => {
    const c = xe.categories[k]
    const s = Number(c && c.score)
    const v = Number.isFinite(s)
      ? s >= 0 && s <= 1
        ? Math.round(s * 100)
        : Math.round(Math.min(100, Math.max(0, s)))
      : 0
    return {
      key: k,
      name: (c && c.name) || k,
      value: v
    }
  })
  return {
    items,
    indicators: items.map((x) => ({ name: x.name, max: 100 })),
    values: items.map((x) => x.value)
  }
}
