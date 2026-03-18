/**
 * 工作流对接模块
 * - 把前端对话数据推送到腾讯云智能体 HTTP SSE 接口
 * - 文档：https://cloud.tencent.com/document/product/1759/105561
 */
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
};

// 训练报告工作流（单独的 bot_app_key）
const REPORT_WORKFLOW_CONFIG = {
  endpoint: WORKFLOW_CONFIG.endpoint,
  botAppKey: 'EpSnUFqHnRYIkpMxrNrdunZqwumDbEjWjoMPkKCUquXMgquZwWWiYiHpRLlxqRbIVhXumaTxRgUpyUzHrtkvQcNCjYBePvZoqJngEzhtvgIWVldHmAkKbiNhnadAmIIS',
  visitorBizId: WORKFLOW_CONFIG.visitorBizId,
  workflowStatus: WORKFLOW_CONFIG.workflowStatus,
  proxyUrl: WORKFLOW_CONFIG.proxyUrl,
};

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

        // 实时更新当前角色的雷达图（使用动态 traits）
        if (typeof window.EmotionDashboard !== 'undefined' && window.EmotionDashboard) {
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
    const sid = this.normalizeSessionId(sessionId);
    let requestId = 'req_' + sid + '_' + Date.now();
    if (requestId.length > 255) requestId = requestId.slice(-255);
    const contentStr = this.ensureUtf8String(content || '');
    const model = customVariables && customVariables.model ? this.ensureUtf8String(customVariables.model) : '';
    const body = {
      request_id: requestId,
      // content 是对话端标准字段；同时增加 message 字段，方便工作流「开始」节点按 message 读取
      content: contentStr,
      message: contentStr,
      session_id: sid,
      bot_app_key: WORKFLOW_CONFIG.botAppKey,
      visitor_biz_id: this.ensureUtf8String(WORKFLOW_CONFIG.visitorBizId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'teacher-001',
      incremental: true,
      streaming_throttle: 10,
      visitor_labels: [],
      // 注意：这里不会把 model 从 custom_variables 中移除，方便工作流在开始节点中通过自定义变量拿到 model
      custom_variables: this.stringifyCustomVariables(customVariables),
      search_network: 'disable',
      stream: 'enable',
      workflow_status: WORKFLOW_CONFIG.workflowStatus,
      tcadp_user_id: '',
    };
    if (model) {
      body.model = model;
    }
    return body;
  },

  /**
   * 解析 SSE 流，提取 reply 事件里的 content
   * @param {Response} response - fetch 响应
   * @param {string} replyId - 本条回复唯一 id，用于只更新本气泡、不占用下一条
   */
  async readSSEStream(response, replyId) {
    _wfLog('SSE 流开始读取', 'replyId:', replyId);
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let finalText = '';
    let hadError = false;
    let eventCount = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        _wfLog('SSE 流结束，共收到事件数:', eventCount, '最终文案长度:', finalText.length);
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

              // 已关闭原始返回 JSON 的完整打印（避免控制台刷屏/影响性能）

              if (type === 'error' || eventType === 'error') {
                const err = payload.error || (p && (p.error || p));
                const errObj = err && typeof err === 'object' ? err : { message: String(err || '工作流调用出错') };
                hadError = true;
                eventCount++;
                const msg = errObj.message || errObj.msg || '工作流调用出错';
                _wfLog('SSE 收到 error:', msg);
                if (window.ChatEngine && typeof ChatEngine.addSystemMessage === 'function') {
                  ChatEngine.addSystemMessage('⚠️ 工作流错误：' + msg);
                }
                continue;
              }

              const isFromSelf = !!(p && p.is_from_self) || !!(payload && payload.is_from_self);
              if (isFromSelf) {
                _wfLog('SSE 跳过 is_from_self 的 echo');
                continue;
              }

              // 优先从工作流返回的 JSON 文本中提取对话与情绪（choices[..].message.content + x-debug）
              const rawCandidate =
                (p && typeof p.content === 'string' ? p.content : '') ||
                (payload && typeof payload.content === 'string' ? payload.content : '') ||
                '';
              let text = _extractDialogAndEmotionFromContent(rawCandidate);

              // 如果不是 JSON 或解析失败，退回到通用内容提取逻辑
              if (!text) {
                text = extractContent(p) || extractContent(payload);
              }
              if (typeof text !== 'string') text = '';
              const isReply = (type === 'reply' || eventType === 'reply');
              let toShow = '';
              if (text) {
                finalText += text;
                toShow = finalText;
              } else if (isReply) {
                toShow = typeof JSON !== 'undefined' ? JSON.stringify(payload, null, 2) : String(payload);
                finalText = toShow;
              }
              if (toShow) {
                eventCount++;
                _wfLog('SSE 写入主对话区，长度:', toShow.length, 'event:', eventType || type);
                if (window.ChatEngine && typeof window.ChatEngine.addWorkflowReply === 'function') {
                  window.ChatEngine.addWorkflowReply(toShow, replyId);
                } else {
                  appendWorkflowReplyToDialog(toShow, replyId);
                }
              }
            } catch (e) {
              _wfLog('解析 SSE 单行失败', line.slice(0, 80), e);
            }
          }
        }
      }
    }

    const chat = window.ChatEngine;
    if (chat && typeof chat.finalizeWorkflowReply === 'function') {
      chat.finalizeWorkflowReply(replyId);
    }
    if (finalText) {
      _wfLog('工作流回复已全部可视化到对话框，长度:', finalText.length);
      if (eventCount === 0) {
        _wfLog('兜底：有内容但未写入过，直接追加到主对话区');
        appendWorkflowReplyToDialog(finalText, replyId);
      }
    } else if (!hadError && chat && typeof chat.addSystemMessage === 'function') {
      _wfLog('未收到任何 reply 内容，提示用户');
      chat.addSystemMessage('⚠️ 工作流未返回内容，请检查：1）应用是否已发布 2）控制台/网络是否有跨域或错误');
    }

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
      // 已关闭请求体 JSON 的完整打印（避免泄露/刷屏）
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

      const finalText = await this.readSSEStream(res, replyId);
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
      // 已关闭人格切换请求体的完整打印
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

  async sendTrainingReport(reportPayload) {
    const url = REPORT_WORKFLOW_CONFIG.proxyUrl || REPORT_WORKFLOW_CONFIG.endpoint;
    const sessionId = 'report_' + Date.now();
    const contentStr = JSON.stringify(reportPayload);

    const body = {
      request_id: 'req_' + sessionId + '_' + Date.now(),
      content: this.ensureUtf8String(contentStr),
      session_id: this.normalizeSessionId(sessionId),
      bot_app_key: REPORT_WORKFLOW_CONFIG.botAppKey,
      visitor_biz_id: this.ensureUtf8String(REPORT_WORKFLOW_CONFIG.visitorBizId)
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 64) || 'teacher-001',
      incremental: false,
      streaming_throttle: 50,
      visitor_labels: [],
      custom_variables: this.stringifyCustomVariables({
        role: 'training_report',
        report_time: new Date().toISOString(),
      }),
      search_network: 'disable',
      stream: 'enable',
      workflow_status: REPORT_WORKFLOW_CONFIG.workflowStatus,
      tcadp_user_id: '',
    };

    // 已关闭训练报告工作流请求体的完整打印

    try {
      const jsonString = JSON.stringify(body);
      const utf8Bytes = new TextEncoder().encode(jsonString);
      console.log('[ReportWorkflow] 请求体编码: UTF-8, 字节长度:', utf8Bytes.length, 'content 前80字:', body.content.slice(0, 80));

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Accept': 'text/event-stream; charset=utf-8',
        },
        body: utf8Bytes,
      });

      console.log('[ReportWorkflow] fetch 响应 status:', res.status, 'Content-Type:', res.headers.get('Content-Type'));
      if (!res.ok) {
        const text = await res.text();
        console.warn('[ReportWorkflow] HTTP 非 2xx:', res.status, text.slice(0, 300));
        return null;
      }

      // 静默读取 SSE，提取首个 reply content 作为结果（不写入主对话框）
      const reader = res.body && res.body.getReader ? res.body.getReader() : null;
      if (!reader) return null;
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let finalText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const lines = part.split('\n').filter(Boolean);
          let eventType = null;
          const dataLines = [];
          for (const line of lines) {
            const t = line.trim();
            if (t.startsWith('event:')) eventType = t.slice(6).trim();
            else if (t.startsWith('data:')) dataLines.push(t.slice(5).trim());
          }
          for (const dataStr of dataLines) {
            if (!dataStr) continue;
            let payload;
            try {
              payload = JSON.parse(dataStr);
            } catch (_) {
              continue;
            }
            const type = (payload && payload.type) || eventType;
            const p = payload && payload.payload != null ? payload.payload : payload;
            if (type === 'error' || eventType === 'error') {
              console.warn('[ReportWorkflow] SSE error:', payload.error || p);
              continue;
            }
            const content = (p && typeof p.content === 'string') ? p.content : (payload && typeof payload.content === 'string' ? payload.content : '');
            if (content) {
              finalText = content;
            }
          }
        }
      }

      console.log('[ReportWorkflow] 返回摘要:', (finalText || '').slice(0, 200));
      return finalText || null;
    } catch (e) {
      console.warn('[ReportWorkflow] sendTrainingReport failed:', e);
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
window.WorkflowDataStore = WorkflowDataStore;

_wfLog('工作流模块已加载，请求地址:', WORKFLOW_CONFIG.proxyUrl || WORKFLOW_CONFIG.endpoint, 'debug:', WORKFLOW_CONFIG.debug);

