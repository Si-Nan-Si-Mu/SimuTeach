/**
 * 工作流对接模块
 * - 把前端对话数据推送到腾讯云智能体 HTTP SSE 接口
 * - 文档：https://cloud.tencent.com/document/product/1759/105561
 */
import {
  deepExtractAssistantDialogFromObject,
  dialogFromCompletionObj,
  extractDialogFromCompletionJsonFragment,
} from '../../../src/extractCompletionDialog.js';

const WORKFLOW_CONFIG = {
  // 对话端 HTTP SSE 接口地址（腾讯云智能体官方）
  endpoint: 'https://wss.lke.cloud.tencent.com/v1/qbot/chat/sse',

  // 应用密钥（bot_app_key），从「应用管理」->「调用」复制
  botAppKey: 'flJmkqArOkTVokPjjyhSLUAnWaeYKhDOMCDWvkTJzapGFuoeiPEKYIbzdakxvdZETvBzvZsgajtsVNVMqPibFvcgYddmxOufpywpKmyMkjPfzfCyEIblHNmfGMhOXlQS',

  // 访客 ID，2-64 位，仅 [a-zA-Z0-9_-]
  visitorBizId: 'teacher-001',

  // 是否启用工作流：enable | disable（若应用未配置工作流可改为 disable）
  workflowStatus: 'enable',

  // 可选：本地代理地址，解决浏览器跨域时填写（后端转发到腾讯云 SSE 接口）
  proxyUrl: '',

  // 为 true 时关闭本地预设学生回复，仅展示工作流返回（工作流无返回时界面会只有老师气泡）；为 false 时先显示本地学生回复，工作流返回后也会追加智能体气泡
  disableLocalReply: true,

  // 为 true 时在控制台输出详细调试日志（F12 -> Console，筛选 [Workflow]）
  debug: true,

  // 专项模拟是否自动回填“学生回复”气泡（false=仅更新右侧看板）
  autoAppendReply: true,
};

// 训练报告：默认走直连 HTTP API（见 sendTrainingReport）；以下为历史工作流字段，保留兼容注入
const REPORT_WORKFLOW_CONFIG = {
  endpoint: WORKFLOW_CONFIG.endpoint,
  botAppKey: 'EpSnUFqHnRYIkpMxrNrdunZqwumDbEjWjoMPkKCUquXMgquZwWWiYiHpRLlxqRbIVhXumaTxRgUpyUzHrtkvQcNCjYBePvZoqJngEzhtvgIWVldHmAkKbiNhnadAmIIS',
  visitorBizId: WORKFLOW_CONFIG.visitorBizId,
  workflowStatus: WORKFLOW_CONFIG.workflowStatus,
  proxyUrl: WORKFLOW_CONFIG.proxyUrl,
  /** 报告 HTTP 接口完整 URL（无尾斜杠） */
  httpUrl: '',
  httpApiKey: '',
  /** 报告走 Chat Completions 形请求时的 model（空则用报告里第一个学生名，再默认「李大志」） */
  chatModel: '',
  chatTemperature: '',
  chatTopP: '',
  chatMaxTokens: '',
  /** 空/false 为 false；'true' 为 true */
  chatStream: '',
  chatUser: '',
  /** 报告请求里 messages[0].content，不含任何训练/对话数据 */
  reportUserMessage: '',
};

/**
 * 课堂模拟专用 Bot（与专项模拟的 WORKFLOW_CONFIG.botAppKey 分离）
 * - 密钥通过 Vite：在 import workflow 之前注入 window.__CLASSROOM_WORKFLOW_INJECT__（见 src/classroom-workflow-inject.js）
 * - 控制台调试：F12 过滤 [ClassroomWorkflow]
 */
const CLASSROOM_WORKFLOW_CONFIG = {
  endpoint: WORKFLOW_CONFIG.endpoint,
  botAppKey: '',
  visitorBizId: 'classroom_teacher_001',
  workflowStatus: WORKFLOW_CONFIG.workflowStatus,
  proxyUrl: WORKFLOW_CONFIG.proxyUrl,
  debug: true,
};

function _mergeWorkflowInjectInto(config, inj, logPrefix) {
  try {
    if (!inj || typeof inj !== 'object') return;
    if (inj.botAppKey) config.botAppKey = String(inj.botAppKey).trim();
    if (typeof inj.debug === 'boolean') config.debug = inj.debug;
    if (inj.visitorBizId) {
      config.visitorBizId = String(inj.visitorBizId)
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 64);
    }
    if (inj.proxyUrl) config.proxyUrl = inj.proxyUrl;
    if (inj.endpoint) config.endpoint = inj.endpoint;
    if (inj.workflowStatus) config.workflowStatus = inj.workflowStatus;
    if (typeof inj.autoAppendReply === 'boolean' && Object.prototype.hasOwnProperty.call(config, 'autoAppendReply')) {
      config.autoAppendReply = inj.autoAppendReply;
    }
  } catch (e) {
    console.warn('[' + logPrefix + '] 合并前端注入配置失败:', e);
  }
}

(function mergeWorkflowInjects() {
  if (typeof window === 'undefined') return;
  _mergeWorkflowInjectInto(WORKFLOW_CONFIG, window.__WORKFLOW_INJECT__, 'Workflow');
  _mergeWorkflowInjectInto(REPORT_WORKFLOW_CONFIG, window.__REPORT_WORKFLOW_INJECT__, 'ReportWorkflow');
  _mergeWorkflowInjectInto(CLASSROOM_WORKFLOW_CONFIG, window.__CLASSROOM_WORKFLOW_INJECT__, 'ClassroomWorkflow');
  try {
    const inj = window.__REPORT_WORKFLOW_INJECT__;
    if (inj && typeof inj === 'object') {
      if (inj.httpUrl != null && String(inj.httpUrl).trim()) {
        REPORT_WORKFLOW_CONFIG.httpUrl = String(inj.httpUrl).replace(/\/$/, '').trim();
      }
      if (inj.httpApiKey != null && String(inj.httpApiKey).trim()) {
        REPORT_WORKFLOW_CONFIG.httpApiKey = String(inj.httpApiKey).trim();
      }
      if (inj.chatModel != null) REPORT_WORKFLOW_CONFIG.chatModel = String(inj.chatModel).trim();
      if (inj.chatTemperature != null) REPORT_WORKFLOW_CONFIG.chatTemperature = inj.chatTemperature;
      if (inj.chatTopP != null) REPORT_WORKFLOW_CONFIG.chatTopP = inj.chatTopP;
      if (inj.chatMaxTokens != null) REPORT_WORKFLOW_CONFIG.chatMaxTokens = inj.chatMaxTokens;
      if (inj.chatStream != null) REPORT_WORKFLOW_CONFIG.chatStream = inj.chatStream;
      if (inj.chatUser != null) REPORT_WORKFLOW_CONFIG.chatUser = String(inj.chatUser).trim();
      if (inj.reportUserMessage != null) {
        REPORT_WORKFLOW_CONFIG.reportUserMessage = String(inj.reportUserMessage).trim();
      }
    }
  } catch (e) {
    console.warn('[ReportWorkflow] 合并 HTTP 报告配置失败:', e);
  }
})();

/** 报告接口可选字段：temperature / top_p / max_tokens / stream / user */
function _appendReportChatCompletionOptions(body, cfg, meta) {
  const te = cfg.chatTemperature;
  if (te !== undefined && te !== null && String(te).trim() !== '') {
    const n = Number(te);
    if (!Number.isNaN(n)) body.temperature = n;
  }
  const tp = cfg.chatTopP;
  if (tp !== undefined && tp !== null && String(tp).trim() !== '') {
    const n = Number(tp);
    if (!Number.isNaN(n)) body.top_p = n;
  }
  const mt = cfg.chatMaxTokens;
  if (mt !== undefined && mt !== null && String(mt).trim() !== '') {
    const n = parseInt(String(mt), 10);
    if (!Number.isNaN(n)) body.max_tokens = n;
  }
  if (cfg.chatStream === true || cfg.chatStream === 'true') body.stream = true;
  else body.stream = false;

  const u = (cfg.chatUser || '').trim();
  if (u) body.user = u;
  else if (meta && meta.app_session) body.user = String(meta.app_session);
}

function _wfClassroomLog() {
  if (CLASSROOM_WORKFLOW_CONFIG.debug && window.console && console.log) {
    console.log.apply(console, ['[ClassroomWorkflow]'].concat(Array.from(arguments)));
  }
}

/**
 * 本轮对话结束后在控制台打印「最终」工作流 JSON（仅一条，需开启对应 debug）
 * - 若 finalText 本身是完整 JSON 字符串，优先 parse 后输出；
 * - 否则输出 SSE 流中最后一帧有效 data JSON（通常为含 choices / x-debug 的帧）。
 */
function _logFinalConversationWorkflowJson(isClassroom, lastSsePayload, finalTextStr) {
  try {
    const dbgOn = isClassroom ? CLASSROOM_WORKFLOW_CONFIG.debug : WORKFLOW_CONFIG.debug;
    if (!dbgOn || !window.console || !console.log) return;

    let obj = null;
    if (finalTextStr && typeof finalTextStr === 'string') {
      const t = finalTextStr.replace(/^[\uFEFF\u200B-\u200D\u2060]+/, '').trim();
      if (t.startsWith('{') && t.endsWith('}')) {
        try {
          obj = JSON.parse(t);
        } catch (_) {
          /* ignore */
        }
      }
    }
    if ((!obj || typeof obj !== 'object') && lastSsePayload && typeof lastSsePayload === 'object') {
      obj = lastSsePayload;
    }
    if (!obj || typeof obj !== 'object') return;

    const label = isClassroom ? '[ClassroomWorkflow]' : '[Workflow]';
    console.log(label + ' 最终对话工作流 JSON', obj);
  } catch (_) {}
}

function _wfLog() {
  if (WORKFLOW_CONFIG.debug && window.console && console.log) {
    console.log.apply(console, ['[Workflow]'].concat(Array.from(arguments)));
  }
}

function _escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function appendWorkflowReplyToDialog(str, replyId) {
  if (!str || typeof str !== 'string') return;
  const container = document.getElementById('chat-messages');
  if (!container) {
    console.warn('[Workflow] 兜底写入失败：#chat-messages 不存在');
    return;
  }
  const id = replyId || 'workflow-reply-' + Date.now();
  const existing = document.getElementById(id);
  if (existing) {
    const textEl = existing.querySelector('.workflow-bubble .msg-text');
    if (textEl) textEl.textContent = str;
    if (container.scrollHeight !== undefined) container.scrollTop = container.scrollHeight;
    return;
  }
  const msgEl = document.createElement('div');
  msgEl.id = id;
  msgEl.className = 'message workflow-msg fade-in';
  // 兜底逻辑下的智能体消息同样绑定到当前学生，方便切换人格时过滤
  if (window.App && App.currentCharacter) {
    msgEl.dataset.characterId = App.currentCharacter.id;
  }
  msgEl.innerHTML = '<div class="msg-avatar workflow-avatar">🤖</div><div class="msg-bubble workflow-bubble"><div class="msg-label">智能体</div><div class="msg-text">' + _escapeHtml(str) + '</div></div>';
  const textEl = msgEl.querySelector('.msg-text');
  if (textEl) {
    textEl.style.whiteSpace = 'pre-wrap';
    textEl.style.wordBreak = 'break-word';
  }
  container.appendChild(msgEl);
  container.scrollTop = container.scrollHeight;
}

function _clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function _clamp01(n) {
  return _clamp(n, 0, 1);
}

function _maybeUpdateEmotionFromJsonText(jsonText) {
  if (!jsonText || typeof jsonText !== 'string') return;
  const t = jsonText.trim();
  if (!(t.startsWith('{') && t.endsWith('}'))) return;
  // 快速过滤，避免每段都 JSON.parse
  if (t.indexOf('"x-debug"') < 0 && t.indexOf('"x_debug"') < 0) return;

  let obj;
  try {
    obj = JSON.parse(t);
  } catch (_) {
    return;
  }

  const xd = obj['x-debug'] || obj['x_debug'];
  if (!xd || typeof xd !== 'object') return;

  const em = xd.emotion || {};
  const es = xd.emotion_state || {};

  const intensity = _clamp01(Number(em.intensity));
  const arousal = _clamp01(Number(es.arousal));
  const valence = _clamp(Number(es.valence), -1, 1);

  // 映射到右侧面板的三项（0-100）
  const joy = _clamp(((valence + 1) / 2) * 100, 0, 100);
  const activation = _clamp(arousal * 100, 0, 100);
  const anxietyBase = _clamp(((-valence + arousal) / 2) * 100, 0, 100);
  const anxiety = _clamp(anxietyBase * (0.6 + 0.4 * intensity), 0, 100);

  const mapped = { joy, activation, anxiety };

  // 在前端终端中输出一次本次情绪解析与可视化结果
  try {
    console.log(
      '[Workflow] 情绪可视化更新:',
      'joy =', Math.round(mapped.joy),
      'activation =', Math.round(mapped.activation),
      'anxiety =', Math.round(mapped.anxiety),
      '| intensity =', intensity.toFixed(3),
      'arousal =', arousal.toFixed(3),
      'valence =', valence.toFixed(3)
    );
  } catch (_) {}

  // 同步到全局状态与右侧可视化
  if (window.App) {
    window.App.currentEmotion = { ...(window.App.currentEmotion || {}), ...mapped };
  }
  if (typeof window.EmotionDashboard !== 'undefined' && window.EmotionDashboard) {
    try {
      window.EmotionDashboard.updateBars(mapped);
      window.EmotionDashboard.pushHistory(mapped);
    } catch (e) {
      console.warn('[Workflow] EmotionDashboard update failed:', e);
    }
  }
}

// 从工作流返回的 JSON 文本中同时提取「对话回复」与情绪信息
// JSON 形如：
// {
//   "choices":[{"message":{"content":"……","role":"assistant"}}],
//   "model":"李大志",
//   "x-debug":{"emotion":{...},"emotion_state":{...}}
// }
function _extractDialogAndEmotionFromContent(jsonText) {
  if (!jsonText || typeof jsonText !== 'string') return '';
  // 去掉前后可能存在的零宽字符 / BOM，再进行 JSON 判定
  let t = jsonText.replace(/^[\uFEFF\u200B-\u200D\u2060]+/, '').replace(/[\uFEFF\u200B-\u200D\u2060]+$/, '').trim();
  if (!(t.startsWith('{') && t.endsWith('}'))) return '';
  let obj;
  try {
    obj = JSON.parse(t);
  } catch (_) {
    return '';
  }

  // 1）先取出对话文字
  let dialog = '';
  if (Array.isArray(obj.choices) && obj.choices[0] && obj.choices[0].message) {
    const msg = obj.choices[0].message;
    if (typeof msg.content === 'string') dialog = msg.content;
  }

  // 2）提取情绪并更新右侧可视化
  const xd = obj['x-debug'] || obj['x_debug'];
  const hasDialog = typeof dialog === 'string' && dialog.trim().length > 0;
  if (xd && typeof xd === 'object') {
    const em = xd.emotion || {};
    const es = xd.emotion_state || {};
    const intensity = _clamp01(Number(em.intensity));
    const arousal = _clamp01(Number(es.arousal));
    const valence = _clamp(Number(es.valence), -1, 1);

    const joy = _clamp(((valence + 1) / 2) * 100, 0, 100);
    const activation = _clamp(arousal * 100, 0, 100);
    const anxietyBase = _clamp(((-valence + arousal) / 2) * 100, 0, 100);
    const anxiety = _clamp(anxietyBase * (0.6 + 0.4 * intensity), 0, 100);
    const mapped = { joy, activation, anxiety };

    try {
      console.log(
        '[Workflow] 情绪可视化更新:',
        'joy =', Math.round(mapped.joy),
        'activation =', Math.round(mapped.activation),
        'anxiety =', Math.round(mapped.anxiety),
        '| intensity =', intensity.toFixed(3),
        'arousal =', arousal.toFixed(3),
        'valence =', valence.toFixed(3)
      );
    } catch (_) {}

    if (window.App) {
      window.App.currentEmotion = { ...(window.App.currentEmotion || {}), ...mapped };
      const cur = window.App.currentCharacter;
      if (cur && cur.id) {
        // 1）将本次情绪点追加到当前角色的情绪历史缓存中，供切换角色时各自独立展示
        const storeMap = window.App.emotionHistoriesByChar || (window.App.emotionHistoriesByChar = {});
        const store = storeMap[cur.id] || (storeMap[cur.id] = { joy: [], activation: [], anxiety: [], labels: [], tick: 0 });
        store.tick += 1;
        const label = `T${store.tick}`;
        store.labels.push(label);
        store.joy.push(Math.round(joy));
        store.activation.push(Math.round(activation));
        store.anxiety.push(Math.round(anxiety));
        const maxLen = 15;
        if (store.labels.length > maxLen) {
          store.labels.shift();
          store.joy.shift();
          store.activation.shift();
          store.anxiety.shift();
        }

        // 2）根据情绪微调当前角色的五维人格画像（轻量级渐变）
        const traitsMap = window.App.dynamicTraitsByChar || (window.App.dynamicTraitsByChar = {});
        const baseTraits = traitsMap[cur.id] || { ...(cur.traits || {}) };
        traitsMap[cur.id] = baseTraits;

        const center = 50;
        const kStrong = 6;   // 影响强度（数值越小单次变化越大）
        const kWeak = 8;

        // 愉悦度越高，自信心 / 学习动力略微提升，焦虑度略微下降
        baseTraits.confidence = _clamp(
          (baseTraits.confidence ?? center) + (joy - center) / kStrong,
          0,
          100
        );
        baseTraits.motivation = _clamp(
          (baseTraits.motivation ?? center) + (joy - center) / kWeak,
          0,
          100
        );

        // 激活度影响表达力：高激活 → 表达力上升，低激活 → 稍微下降
        baseTraits.expressiveness = _clamp(
          (baseTraits.expressiveness ?? center) + (activation - center) / kStrong,
          0,
          100
        );

        // 焦虑度直接映射到五维里的「焦虑度」
        baseTraits.anxiety = _clamp(
          (baseTraits.anxiety ?? center) + (anxiety - center) / kStrong,
          0,
          100
        );

        // 焦虑越高，社交能力略微下降；焦虑低时略微回升
        baseTraits.socialSkill = _clamp(
          (baseTraits.socialSkill ?? center) - (anxiety - center) / kWeak,
          0,
          100
        );

        // 有有效对话正文时再用动态 traits 更新雷达（避免仅 x-debug 时强行扭曲画像）
        if (
          hasDialog &&
          typeof window.EmotionDashboard !== 'undefined' &&
          window.EmotionDashboard
        ) {
          try {
            window.EmotionDashboard.updateRadarChart({
              ...cur,
              traits: baseTraits,
            });
          } catch (e) {
            console.warn('[Workflow] updateRadarChart with dynamic traits failed:', e);
          }
        }
      }
    }
    if (typeof window.EmotionDashboard !== 'undefined' && window.EmotionDashboard) {
      try {
        window.EmotionDashboard.updateBars(mapped);
        window.EmotionDashboard.pushHistory(mapped);
      } catch (e) {
        console.warn('[Workflow] EmotionDashboard update failed:', e);
      }
    }
  }

  return typeof dialog === 'string' ? dialog : '';
}

/**
 * 按指定 Bot 配置构造 SSE 请求体（与 WORKFLOW_CONFIG 版字段一致）
 */
function buildRequestBodyWithConfig(config, client, content, sessionId, customVariables = {}) {
  const sid = client.normalizeSessionId(sessionId);
  let requestId = 'req_' + sid + '_' + Date.now();
  if (requestId.length > 255) requestId = requestId.slice(-255);
  const contentStr = client.ensureUtf8String(content || '');
  const vars = { ...(customVariables || {}) };
  /** 是否与后端约定：true=生成报告请求，false=普通互动 */
  let evaluation = false;
  if (Object.prototype.hasOwnProperty.call(vars, 'evaluation')) {
    const v = vars.evaluation;
    evaluation = v === true || v === 'true';
    delete vars.evaluation;
  }
  // 兼容旧拼写 evalution → 仍映射到顶层 evaluation
  if (Object.prototype.hasOwnProperty.call(vars, 'evalution')) {
    const v = vars.evalution;
    if (v === true || v === 'true') evaluation = true;
    delete vars.evalution;
  }
  const model = vars.model ? client.ensureUtf8String(vars.model) : '';
  const body = {
    request_id: requestId,
    content: contentStr,
    message: contentStr,
    session_id: sid,
    bot_app_key: config.botAppKey,
    visitor_biz_id: client.ensureUtf8String(config.visitorBizId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'classroom_001',
    incremental: true,
    streaming_throttle: 10,
    visitor_labels: [],
    evaluation,
    custom_variables: client.stringifyCustomVariables(vars),
    search_network: 'disable',
    stream: 'enable',
    workflow_status: config.workflowStatus,
    tcadp_user_id: '',
  };
  if (model) {
    body.model = model;
  }
  return body;
}

const WorkflowClient = {
  /**
   * 规范 session_id：文档要求 2-64 位，仅 [a-zA-Z0-9_-]
   */
  normalizeSessionId(sessionId) {
    if (!sessionId || typeof sessionId !== 'string') {
      return 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    }
    const s = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    return s.length >= 2 ? s : 'sess_' + Date.now();
  },

  /**
   * custom_variables 的值必须为 string，文档：map[string]string
   */
  stringifyCustomVariables(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
      out[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }
    return out;
  },

  /**
   * 保证发往工作流的字符串为 UTF-8 可正确编码的 Unicode 字符串（NFC 规范化，避免乱码）
   */
  ensureUtf8String(str) {
    if (str == null) return '';
    const s = String(str);
    return s.normalize ? s.normalize('NFC') : s;
  },

  /**
   * 构造 HTTP SSE 请求体（与文档 1.1 一致），统一 UTF-8 编码
   * - model 保留在 custom_variables.model，便于工作流在「开始」节点里从自定义变量读取
   *   （若需要，也会额外复制一份到顶层 body.model，兼容后端其它使用方式）
   */
  buildRequestBody(content, sessionId, customVariables = {}) {
    return buildRequestBodyWithConfig(WORKFLOW_CONFIG, this, content, sessionId, customVariables);
  },

  /**
   * 解析 SSE 流，提取 reply 事件里的 content
   * @param {Response} response - fetch 响应
   * @param {string} replyId - 本条回复唯一 id，用于只更新本气泡、不占用下一条
   * @param {object} streamOptions - 可选：{ variant: 'classroom' } 时走课堂 UI 钩子，不写专项对话区
   */
  async readSSEStream(response, replyId, streamOptions = {}) {
    const isClassroom = streamOptions && streamOptions.variant === 'classroom';
    const dbg = isClassroom ? _wfClassroomLog : _wfLog;
    dbg('SSE 流开始读取', 'replyId:', replyId, isClassroom ? '(课堂通道)' : '');
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let finalText = '';
    let hadError = false;
    let eventCount = 0;
    /** SSE 中最后一帧非 error、非 is_from_self 的解析后对象，用于控制台输出「最终 JSON」 */
    let lastWorkflowSsePayload = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        dbg('SSE 流结束，共收到事件数:', eventCount, '最终文案长度:', finalText.length);
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      // 从 JSON 中取出「回复正文」用于主对话区展示，优先正文字段，避免整段 JSON 当气泡
      function extractContent(obj) {
        if (!obj || typeof obj !== 'object') return '';
        const v = obj.text || obj.content || obj.reply || obj.message ||
          (typeof obj.data === 'string' ? obj.data : '') ||
          (typeof obj.output === 'string' ? obj.output : '') ||
          (obj.choices && obj.choices[0] && obj.choices[0].message && typeof obj.choices[0].message.content === 'string' ? obj.choices[0].message.content : '') ||
          (obj.payload && typeof obj.payload === 'object' && (function () { const p = obj.payload; const c = p.content || p.text || (p.choices && p.choices[0] && p.choices[0].message && p.choices[0].message.content); return typeof c === 'string' ? c : ''; }())) ||
          (obj.result && (typeof obj.result.output === 'string' ? obj.result.output : obj.result.text || obj.result.reply || obj.result.content) || '');
        let str = typeof v === 'string' ? v : '';
        if (!str && obj.payload && typeof obj.payload === 'object') {
          const p = obj.payload;
          const c = p.content || p.text || p.reply || p.message || (p.choices && p.choices[0] && p.choices[0].message && p.choices[0].message.content);
          str = typeof c === 'string' ? c : '';
        }
        if (str && (str.trim().startsWith('{') || str.trim().startsWith('['))) {
          try {
            const inner = JSON.parse(str);
            if (inner && typeof inner === 'object') {
              const innerStr = inner.text || inner.reply || inner.message || inner.content || (inner.choices && inner.choices[0] && inner.choices[0].message && inner.choices[0].message.content) || (typeof inner.data === 'string' ? inner.data : '');
              if (typeof innerStr === 'string') str = innerStr;
            }
          } catch (_) {}
        }
        return typeof str === 'string' ? str : '';
      }

      for (const part of parts) {
        const lines = part.split('\n').filter(Boolean);
        let eventType = null;
        const dataLines = [];
        for (const line of lines) {
          const t = line.trim();
          if (t.startsWith('event:')) {
            eventType = t.slice(6).trim();
          } else if (t.startsWith('data:')) {
            dataLines.push(t.slice(5).trim());
          }
        }

        // 每条 data 可能含多行 JSON（先智能体回复后用户 echo），必须逐行/逐段解析，不能只取最后一行
        for (const dataStr of dataLines) {
          if (!dataStr) continue;
          const jsonLines = dataStr.split('\n').filter(Boolean);
          if (jsonLines.length === 0) continue;
          // 同一行可能拼了多段 JSON（如 {"a":1}{"b":2}），按 }{ 拆开再解析
          const toParse = [];
          for (const line of jsonLines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (trimmed.indexOf('}{') >= 0) {
              const parts = trimmed.split('}{');
              for (let i = 0; i < parts.length; i++) {
                let s = parts[i].trim();
                if (!s) continue;
                if (i > 0) s = '{' + s;
                if (i < parts.length - 1) s = s + '}';
                toParse.push(s);
              }
            } else {
              toParse.push(trimmed);
            }
          }
          for (const line of toParse) {
            try {
              let payload = null;
              try {
                payload = JSON.parse(line);
              } catch (_) {
                continue;
              }
              if (!payload) continue;

              const type = (payload && payload.type) || eventType;
              const p = payload && payload.payload != null ? payload.payload : payload;

              if (type === 'error' || eventType === 'error') {
                const err = payload.error || (p && (p.error || p));
                const errObj = err && typeof err === 'object' ? err : { message: String(err || '工作流调用出错') };
                hadError = true;
                eventCount++;
                const msg = errObj.message || errObj.msg || '工作流调用出错';
                dbg('SSE 收到 error:', msg);
                if (isClassroom) {
                  console.warn('[ClassroomWorkflow] SSE error:', msg);
                  try {
                    if (window.ClassroomWorkflowHooks && typeof window.ClassroomWorkflowHooks.onSystem === 'function') {
                      window.ClassroomWorkflowHooks.onSystem('⚠️ 工作流错误：' + msg);
                    }
                  } catch (_) {}
                } else if (window.ChatEngine && typeof ChatEngine.addSystemMessage === 'function') {
                  ChatEngine.addSystemMessage('⚠️ 工作流错误：' + msg);
                }
                continue;
              }

              const isFromSelf = !!(p && p.is_from_self) || !!(payload && payload.is_from_self);
              if (isFromSelf) {
                dbg('SSE 跳过 is_from_self 的 echo');
                continue;
              }

              lastWorkflowSsePayload = payload;

              // 优先从工作流返回的 JSON 文本中提取对话与情绪（choices[..].message.content + x-debug）
              const rawCandidate =
                (p && typeof p.content === 'string' ? p.content : '') ||
                (payload && typeof payload.content === 'string' ? payload.content : '') ||
                '';
              let text = _extractDialogAndEmotionFromContent(rawCandidate);

              // 流式片段：尚未形成完整 JSON 时，仍尽量抽出 choices[0].message.content
              if (!text) {
                text = extractDialogFromCompletionJsonFragment(rawCandidate);
              }

              // 如果不是 JSON 或解析失败，退回到通用内容提取逻辑
              if (!text) {
                text = extractContent(p) || extractContent(payload);
              }
              let textFromDeep = false;
              if (!text) {
                const deep = deepExtractAssistantDialogFromObject(p) || deepExtractAssistantDialogFromObject(payload);
                if (deep) {
                  text = deep;
                  textFromDeep = true;
                }
              }
              if (typeof text !== 'string') text = '';
              const isReply = (type === 'reply' || eventType === 'reply');
              let toShow = '';
              const looksLikeChatCompletionJson =
                typeof rawCandidate === 'string' && rawCandidate.indexOf('"choices"') !== -1;
              if (text) {
                // Chat Completion 形 JSON（尤其流式累加同一串）或从 payload 深摘的正文：用整段替换，避免重复拼接
                if (looksLikeChatCompletionJson || textFromDeep) {
                  finalText = text;
                } else {
                  finalText += text;
                }
                toShow = finalText;
              } else if (isReply) {
                const fromObj = dialogFromCompletionObj(p) || dialogFromCompletionObj(payload);
                const fromFrag = fromObj || extractDialogFromCompletionJsonFragment(rawCandidate);
                const fromDeep2 =
                  fromFrag ||
                  deepExtractAssistantDialogFromObject(p) ||
                  deepExtractAssistantDialogFromObject(payload);
                if (fromDeep2) {
                  finalText = fromDeep2;
                  toShow = finalText;
                } else if (isClassroom) {
                  // 课堂气泡：不要把 can_feedback / 空 content 壳子 JSON 整段塞进 UI
                  toShow = '';
                } else {
                  toShow = typeof JSON !== 'undefined' ? JSON.stringify(payload, null, 2) : String(payload);
                  finalText = toShow;
                }
              }
              if (toShow) {
                eventCount++;
                dbg('SSE 增量回复，当前累计长度:', toShow.length, 'event:', eventType || type);
                if (isClassroom) {
                  try {
                    if (window.ClassroomWorkflowHooks && typeof window.ClassroomWorkflowHooks.onDelta === 'function') {
                      window.ClassroomWorkflowHooks.onDelta(toShow, { replyId, rawEvent: eventType || type });
                    }
                  } catch (e) {
                    console.warn('[ClassroomWorkflow] onDelta 失败:', e);
                  }
                } else if (window.ChatEngine && typeof window.ChatEngine.addWorkflowReply === 'function') {
                  window.ChatEngine.addWorkflowReply(toShow, replyId);
                } else {
                  appendWorkflowReplyToDialog(toShow, replyId);
                }
              }
            } catch (e) {
              dbg('解析 SSE 单行失败', line.slice(0, 80), e);
            }
          }
        }
      }
    }

    const chat = window.ChatEngine;
    if (!isClassroom && chat && typeof chat.finalizeWorkflowReply === 'function') {
      chat.finalizeWorkflowReply(replyId);
    }
    if (isClassroom) {
      try {
        if (window.ClassroomWorkflowHooks && typeof window.ClassroomWorkflowHooks.onFinalize === 'function') {
          window.ClassroomWorkflowHooks.onFinalize(finalText || '', { replyId, hadError, eventCount });
        }
      } catch (e) {
        console.warn('[ClassroomWorkflow] onFinalize 失败:', e);
      }
    }
    if (finalText) {
      dbg('工作流回复完成，总长度:', finalText.length);
      if (!isClassroom && eventCount === 0) {
        _wfLog('兜底：有内容但未写入过，直接追加到主对话区');
        appendWorkflowReplyToDialog(finalText, replyId);
      }
      if (isClassroom && eventCount === 0) {
        _wfClassroomLog('兜底：eventCount=0 但有 finalText，触发 onDelta');
        try {
          if (window.ClassroomWorkflowHooks && typeof window.ClassroomWorkflowHooks.onDelta === 'function') {
            window.ClassroomWorkflowHooks.onDelta(finalText, { replyId, fallback: true });
          }
        } catch (_) {}
      }
    } else if (!hadError) {
      dbg('未收到任何 reply 内容');
      if (isClassroom) {
        console.warn('[ClassroomWorkflow] 未收到回复，请检查应用发布与跨域/代理');
        try {
          if (window.ClassroomWorkflowHooks && typeof window.ClassroomWorkflowHooks.onSystem === 'function') {
            window.ClassroomWorkflowHooks.onSystem('⚠️ 工作流未返回内容，请检查应用是否已发布及网络/跨域（可配置 proxyUrl）。');
          }
        } catch (_) {}
      } else if (chat && typeof chat.addSystemMessage === 'function') {
        _wfLog('未收到任何 reply 内容，提示用户');
        chat.addSystemMessage('⚠️ 工作流未返回内容，请检查：1）应用是否已发布 2）控制台/网络是否有跨域或错误');
      }
    }

    _logFinalConversationWorkflowJson(isClassroom, lastWorkflowSsePayload, finalText);

    return finalText;
  },

  /**
   * 老师文本消息：触发 HTTP SSE 对话并展示返回内容
   */
  async sendTeacherMessageToWorkflow(sessionId, message, extra = {}) {
    const url = WORKFLOW_CONFIG.proxyUrl || WORKFLOW_CONFIG.endpoint;
    _wfLog('前端准备连接工作流', '请求地址:', url, 'sessionId:', sessionId, '内容前20字:', String(message).slice(0, 20));
    if (!url) {
      _wfLog('未配置 endpoint/proxyUrl，已跳过');
      return null;
    }

    const chat = window.ChatEngine;
    const replyId = 'wf-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
    if (chat && typeof chat.showWorkflowLoading === 'function') {
      chat.showWorkflowLoading(true);
    }
    WorkflowClient._workflowLoading = true;

    try {
      const body = this.buildRequestBody(message, sessionId, {
        role: 'teacher',
        ...extra,
      });
      if (WORKFLOW_CONFIG.debug && window.console && console.log) {
        console.log('[前端发送] 专项工作流请求 JSON', body);
      }
      _wfLog('fetch 开始 POST', url, 'body.session_id:', body.session_id, 'body.content 长度:', body.content.length);

      const jsonString = JSON.stringify(body);
      const utf8Bytes = new TextEncoder().encode(jsonString);
      _wfLog('请求体编码: UTF-8, 字节长度:', utf8Bytes.length, 'content 前30字:', body.content.slice(0, 30));

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Accept': 'text/event-stream; charset=utf-8',
        },
        body: utf8Bytes,
      });

      _wfLog('fetch 响应 status:', res.status, 'Content-Type:', res.headers.get('Content-Type'));
      if (!res.ok) {
        const text = await res.text();
        let errMsg = '工作流后端暂不可用（' + res.status + '）';
        try {
          const j = JSON.parse(text);
          if (WORKFLOW_CONFIG.debug && window.console && console.log) {
            console.log('[Workflow] HTTP 错误响应 JSON', { status: res.status }, j);
          }
          if (j.error && j.error.message) errMsg = j.error.message;
          else if (j.message) errMsg = j.message;
        } catch (_) {
          if (text) errMsg = text.slice(0, 200);
        }
        _wfLog('HTTP 非 2xx，body 前 300 字:', text.slice(0, 300));
        if (chat && typeof chat.addSystemMessage === 'function') {
          chat.addSystemMessage('⚠️ ' + errMsg);
        }
        console.warn('[Workflow] HTTP', res.status, errMsg);
        return null;
      }

      const contentType = (res.headers.get('Content-Type') || '').toLowerCase();
      if (!res.body) {
        _wfLog('响应无 body');
        if (chat && typeof chat.addSystemMessage === 'function') {
          chat.addSystemMessage('⚠️ 工作流返回为空，请检查应用是否已发布。');
        }
        return null;
      }

      if (!contentType.includes('text/event-stream') && !contentType.includes('application/stream+json')) {
        const text = await res.text();
        _wfLog('Content-Type 非 SSE:', contentType, 'body 前 200 字:', text.slice(0, 200));
        let toShow = text;
        if (contentType.includes('json') && text) {
          try {
            const j = JSON.parse(text);
            if (WORKFLOW_CONFIG.debug && window.console && console.log) {
              console.log('[Workflow] 非 SSE 响应 JSON', { status: res.status, contentType }, j);
            }
            const v = j.text || j.content || (j.payload && (j.payload.text || j.payload.content)) || j.reply || j.message;
            toShow = typeof v === 'string' ? v : JSON.stringify(j, null, 2);
          } catch (_) {}
        }
        if (toShow && chat && typeof chat.addWorkflowReply === 'function') {
          _wfLog('非 SSE 响应，写入主对话区，长度:', toShow.length);
          chat.addWorkflowReply(toShow);
        } else if (chat && typeof chat.addSystemMessage === 'function') {
          chat.addSystemMessage('⚠️ 工作流返回格式异常，请确认接口地址与 AppKey。');
        }
        return toShow || null;
      }

      const finalText = await this.readSSEStream(res, replyId, {});
      if (finalText && window.WorkflowDataStore && typeof window.WorkflowDataStore.add === 'function') {
        window.WorkflowDataStore.add(sessionId, message, finalText, extra);
      }
      return finalText;
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      _wfLog('fetch 异常:', msg, e);
      if (chat && typeof chat.addSystemMessage === 'function') {
        const hint = (msg.indexOf('Failed to fetch') >= 0 || msg.indexOf('NetworkError') >= 0)
          ? '请检查网络或跨域（CORS）。即使 Network 里能看到接口返回，CORS 也会导致前端拿不到响应体，必须用后端代理（配置 proxyUrl）。'
          : msg;
        chat.addSystemMessage('⚠️ 工作流连接失败：' + hint);
      }
      console.warn('[Workflow] sendTeacherMessageToWorkflow failed:', e);
      return null;
    } finally {
      WorkflowClient._workflowLoading = false;
      if (chat && typeof chat.showWorkflowLoading === 'function') {
        chat.showWorkflowLoading(false);
      }
    }
  },

  /**
   * 文本对话消息（老师 / 学生）
   */
  async sendTextMessage(sessionId, role, message, extra = {}) {
    // 目前只对「老师」消息触发智能体工作流；学生消息仅作为仿真展示
    if (role === 'teacher') {
      return this.sendTeacherMessageToWorkflow(sessionId, message, extra);
    }
    return null;
  },

  /**
   * 课堂模拟：广播/对生发言 → 独立 Bot（CLASSROOM_WORKFLOW_CONFIG.botAppKey）
   * - 调试：浏览器 F12 控制台过滤 [ClassroomWorkflow]
   * - UI：可挂载 window.ClassroomWorkflowHooks（onDelta / onFinalize / onSystem）
   */
  async sendClassroomBroadcast(sessionId, message, extra = {}) {
    const config = CLASSROOM_WORKFLOW_CONFIG;
    if (!config.botAppKey) {
      console.warn(
        '[ClassroomWorkflow] 未配置 botAppKey。请在 .env.local 中设置 VITE_CLASSROOM_BOT_APP_KEY（勿将密钥提交到 Git）。'
      );
      return null;
    }
    const url = config.proxyUrl || config.endpoint;
    if (!url) {
      _wfClassroomLog('未配置 endpoint，已跳过');
      return null;
    }

    const replyId = 'classroom-wf-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
    _wfClassroomLog('准备请求', 'url:', url, 'sessionId:', sessionId, 'replyId:', replyId);

    try {
      const body = buildRequestBodyWithConfig(config, this, message, sessionId, {
        role: 'teacher',
        channel: 'classroom',
        ...extra,
      });
      // 课堂模拟请求：补充 model 字段（默认李大志）
      if (!body.model || String(body.model).trim() === '') {
        body.model = '李大志';
      }
      // 仅课堂模拟：支持主动轮询标记（专项模拟不使用此字段）
      body.proactive = extra && extra.proactive === true;
      if (config.debug && window.console && console.log) {
        console.log('[前端发送] 课堂工作流请求 JSON', body);
      }
      _wfClassroomLog('POST body 摘要:', {
        session_id: body.session_id,
        content_len: body.content.length,
        content_preview: String(message).slice(0, 100),
      });

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Accept: 'text/event-stream; charset=utf-8',
        },
        body: new TextEncoder().encode(JSON.stringify(body)),
      });

      _wfClassroomLog('响应 status:', res.status, 'Content-Type:', res.headers.get('Content-Type'));

      if (!res.ok) {
        const text = await res.text();
        let errMsg = '工作流暂不可用（' + res.status + '）';
        try {
          const j = JSON.parse(text);
          if (CLASSROOM_WORKFLOW_CONFIG.debug && window.console && console.log) {
            console.log('[ClassroomWorkflow] HTTP 错误响应 JSON', { status: res.status }, j);
          }
          if (j.error && j.error.message) errMsg = j.error.message;
          else if (j.message) errMsg = j.message;
        } catch (_) {
          if (text) errMsg = text.slice(0, 200);
        }
        console.warn('[ClassroomWorkflow] HTTP 错误:', errMsg);
        try {
          if (window.ClassroomWorkflowHooks && typeof window.ClassroomWorkflowHooks.onSystem === 'function') {
            window.ClassroomWorkflowHooks.onSystem('⚠️ ' + errMsg);
          }
        } catch (_) {}
        return null;
      }

      if (!res.body) {
        try {
          if (window.ClassroomWorkflowHooks && typeof window.ClassroomWorkflowHooks.onSystem === 'function') {
            window.ClassroomWorkflowHooks.onSystem('⚠️ 工作流返回为空');
          }
        } catch (_) {}
        return null;
      }

      const contentType = (res.headers.get('Content-Type') || '').toLowerCase();
      if (!contentType.includes('text/event-stream') && !contentType.includes('application/stream+json')) {
        const text = await res.text();
        _wfClassroomLog('非 SSE 响应', contentType, 'body 前 180 字:', text.slice(0, 180));
        let toShow = text;
        if (contentType.includes('json') && text) {
          try {
            const j = JSON.parse(text);
            if (CLASSROOM_WORKFLOW_CONFIG.debug && window.console && console.log) {
              console.log('[ClassroomWorkflow] 非 SSE 响应 JSON', { status: res.status, contentType }, j);
            }
            const fromChat =
              dialogFromCompletionObj(j) ||
              extractDialogFromCompletionJsonFragment(text) ||
              deepExtractAssistantDialogFromObject(j);
            const v =
              (typeof fromChat === 'string' && fromChat
                ? fromChat
                : null) ||
              j.text ||
              j.content ||
              (j.payload && (j.payload.text || j.payload.content)) ||
              j.reply ||
              j.message;
            toShow = typeof v === 'string' ? v : JSON.stringify(j, null, 2);
          } catch (_) {}
        }
        try {
          if (window.ClassroomWorkflowHooks && typeof window.ClassroomWorkflowHooks.onFinalize === 'function') {
            window.ClassroomWorkflowHooks.onFinalize(toShow || '', { replyId, nonSse: true });
          }
        } catch (_) {}
        if (toShow && window.WorkflowDataStore && typeof window.WorkflowDataStore.add === 'function') {
          try {
            window.WorkflowDataStore.add(sessionId, message, toShow, { ...extra, channel: 'classroom', nonSse: true });
          } catch (_) {}
        }
        return toShow || null;
      }

      const finalText = await this.readSSEStream(res, replyId, { variant: 'classroom' });
      if (finalText && window.WorkflowDataStore && typeof window.WorkflowDataStore.add === 'function') {
        try {
          window.WorkflowDataStore.add(sessionId, message, finalText, { ...extra, channel: 'classroom' });
        } catch (_) {}
      }
      _wfClassroomLog('SSE 完成，finalText 长度:', (finalText || '').length);
      return finalText;
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      console.warn('[ClassroomWorkflow] sendClassroomBroadcast 异常:', e);
      try {
        if (window.ClassroomWorkflowHooks && typeof window.ClassroomWorkflowHooks.onSystem === 'function') {
          const hint =
            msg.indexOf('Failed to fetch') >= 0 || msg.indexOf('NetworkError') >= 0
              ? '网络或 CORS：可配置 CLASSROOM_WORKFLOW_CONFIG.proxyUrl / Vite 注入的 proxyUrl 走后端代理。'
              : msg;
          window.ClassroomWorkflowHooks.onSystem('⚠️ 课堂工作流：' + hint);
        }
      } catch (_) {}
      return null;
    }
  },

  /**
   * 人格切换：仅向工作流发送 model，不在主对话框里展示
   * - modelName 使用中文，如「习得性无助型」「注意力分散型」
   */
  async sendModelSwitch(sessionId, modelName) {
    const url = WORKFLOW_CONFIG.proxyUrl || WORKFLOW_CONFIG.endpoint;
    _wfLog('准备发送人格切换请求', 'model:', modelName, 'sessionId:', sessionId, 'url:', url);
    if (!url || !modelName) return;

    try {
      // 将「人格切换」作为 content 字段传入，以满足后端对 content 的必填校验
      const body = this.buildRequestBody('人格切换', sessionId, {
        role: 'persona_switch',
        model: modelName,
      });
      if (WORKFLOW_CONFIG.debug && window.console && console.log) {
        console.log('[前端发送] 人格切换请求 JSON', body);
      }
      const jsonString = JSON.stringify(body);
      const utf8Bytes = new TextEncoder().encode(jsonString);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Accept': 'text/event-stream; charset=utf-8',
        },
        body: utf8Bytes,
      });
      const text = await res.text();
      if (WORKFLOW_CONFIG.debug && window.console && console.log) {
        // 仅在 debug 模式下输出简要状态，避免在控制台刷出完整 SSE 内容
        console.log('[Workflow] 人格切换完成，status =', res.status, 'model =', modelName);
      }
      return text;
    } catch (e) {
      console.warn('[Workflow] sendModelSwitch failed:', e);
      return null;
    }
  },

  /**
   * 语音对话消息
   * - audioPayload 可以是录音后的 URL、Base64、或你约定的标识
   */
  async sendAudioMessage(sessionId, role, transcript, audioPayload, extra = {}) {
    // 语音消息可通过 custom_variables 传递给工作流（此处仅做占位，方便后续扩展）
    if (role === 'teacher') {
      const content = transcript || '[语音消息]';
      return this.sendTeacherMessageToWorkflow(sessionId, content, {
        audio: audioPayload,
        ...extra,
      });
    }
    return null;
  },

  /**
   * 生成训练报告：仅发送 Chat Completions 形请求体（model / messages / evaluation / api_key 及可选参数）
   * - Content-Type: application/json（与 body 的 JSON.stringify 一致）
   * - 直连外域时可能触发 CORS 预检，开发环境建议走同源 /api/report 代理
   */
  async sendTrainingReport(meta) {
    const cfg = REPORT_WORKFLOW_CONFIG;
    const apiUrl = (cfg.httpUrl || '').trim();
    const apiKey = (cfg.httpApiKey || '').trim();
    if (!apiUrl) {
      console.warn('[ReportAPI] 未配置 VITE_REPORT_HTTP_URL，已跳过生成报告请求');
      return null;
    }
    if (!apiKey) {
      console.warn('[ReportAPI] 未配置 VITE_REPORT_HTTP_API_KEY，已跳过生成报告请求（请在 .env.local 填写，勿提交 Git）');
      return null;
    }

    try {
      const m =
        meta && typeof meta === 'object' && !Array.isArray(meta)
          ? meta
          : {};

      const modelName =
        (cfg.chatModel && String(cfg.chatModel).trim()) ||
        (m.student_name && String(m.student_name).trim()) ||
        (m.characters && m.characters[0] && m.characters[0].name) ||
        '李大志';

      const userContent =
        (cfg.reportUserMessage && String(cfg.reportUserMessage).trim()) || '请生成教学训练报告。';

      const bodyPayload = {
        model: modelName,
        messages: [
          {
            role: 'user',
            content: userContent,
          },
        ],
        /** 与专项对话 evaluation 语义一致：生成报告为 true */
        evaluation: true,
        api_key: apiKey,
      };

      _appendReportChatCompletionOptions(bodyPayload, cfg, {
        app_session: m.app_session != null ? m.app_session : undefined,
      });

      const bodyStr = JSON.stringify(bodyPayload);
      if (window.console && console.log) {
        const logSafe = JSON.parse(bodyStr);
        if (logSafe.api_key) logSafe.api_key = '***';
        console.log('[前端发送] 生成报告 JSON（Chat Completions + evaluation，api_key 已打码）', logSafe);
      }
      if (cfg.debug && window.console && console.log) {
        console.log('[ReportAPI] POST', apiUrl);
        console.log('[ReportAPI] 请求头含 Authorization: Bearer ***（密钥已打码）');
      }
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: 'Bearer ' + apiKey,
        },
        body: bodyStr,
      });
      const text = await res.text();
      if (!res.ok) {
        console.warn('[ReportAPI] HTTP', res.status, text.slice(0, 500));
        return null;
      }
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (_) {
          data = text;
        }
      }
      if (window.console && console.log) {
        console.log('[ReportAPI] 生成报告 返回 JSON', data);
      }
      if (cfg.debug && window.console && console.log) {
        console.log('[ReportAPI] 响应 OK，长度:', (text || '').length);
      }
      return data;
    } catch (e) {
      console.warn('[ReportAPI] 请求失败（网络/CORS 等）:', e);
      return null;
    }
  },
};

/**
 * 工作流返回数据存储：存到内存 + localStorage，支持导出为 JSON 文件
 */
const WORKFLOW_DATA_KEY = 'workflow_history_data';
const WORKFLOW_DATA_MAX = 500;

const WorkflowDataStore = {
  _list: [],

  load() {
    try {
      const raw = localStorage.getItem(WORKFLOW_DATA_KEY);
      if (raw) this._list = JSON.parse(raw);
      else this._list = [];
    } catch (e) {
      this._list = [];
    }
    return this._list;
  },

  save() {
    try {
      localStorage.setItem(WORKFLOW_DATA_KEY, JSON.stringify(this._list));
    } catch (e) {
      console.warn('[Workflow] localStorage save failed', e);
    }
  },

  add(sessionId, requestContent, responseContent, extra = {}) {
    if (!this._list.length) this.load();
    this._list.unshift({
      id: 'wf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9),
      session_id: sessionId,
      request: requestContent,
      response: responseContent,
      character_id: extra.characterId || null,
      trigger: extra.trigger || null,
      created_at: new Date().toISOString(),
    });
    if (this._list.length > WORKFLOW_DATA_MAX) this._list = this._list.slice(0, WORKFLOW_DATA_MAX);
    this.save();
  },

  getAll() {
    if (!this._list.length) this.load();
    return this._list;
  },

  clear() {
    this._list = [];
    try {
      localStorage.removeItem(WORKFLOW_DATA_KEY);
    } catch (_) {}
  },

  exportToJsonFile() {
    const data = {
      export_time: new Date().toISOString(),
      total: this.getAll().length,
      records: this.getAll(),
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'workflow_data_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  },
};

// 暴露到全局，方便其他模块调用
window.WorkflowClient = WorkflowClient;
window.WORKFLOW_CONFIG = WORKFLOW_CONFIG;
window.CLASSROOM_WORKFLOW_CONFIG = CLASSROOM_WORKFLOW_CONFIG;
window.WorkflowDataStore = WorkflowDataStore;

_wfLog('工作流模块已加载，请求地址:', WORKFLOW_CONFIG.proxyUrl || WORKFLOW_CONFIG.endpoint, 'debug:', WORKFLOW_CONFIG.debug);
_wfLog(
  '专项模拟工作流:',
  WORKFLOW_CONFIG.botAppKey
    ? '已注入/存在 botAppKey（长度 ' + WORKFLOW_CONFIG.botAppKey.length + '），调试标签 [Workflow]'
    : '未注入 botAppKey——请在 .env.local 设置 VITE_SPECIAL_BOT_APP_KEY'
);
_wfClassroomLog(
  '课堂模拟工作流:',
  CLASSROOM_WORKFLOW_CONFIG.botAppKey
    ? '已注入 botAppKey（长度 ' + CLASSROOM_WORKFLOW_CONFIG.botAppKey.length + '），调试标签 [ClassroomWorkflow]'
    : '未注入 botAppKey——请在 .env.local 设置 VITE_CLASSROOM_BOT_APP_KEY'
);

