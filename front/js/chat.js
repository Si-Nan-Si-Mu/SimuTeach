/**
 * 对话引擎 - 打字机效果 + 内心戏展示
 */
const ChatEngine = {
  container: null,
  isTyping: false,
  messageQueue: [],
  history: [],
  onEmotionUpdate: null,

  init(containerId) {
    this.container = document.getElementById(containerId);
    this.history = [];
  },

  addTeacherMessage(text, trigger) {
    const msgEl = document.createElement('div');
    msgEl.className = 'message teacher-msg fade-in';
    msgEl.innerHTML = `
      <div class="msg-bubble teacher-bubble">
        <div class="msg-label">👨‍🏫 老师</div>
        <div class="msg-text">${text}</div>
      </div>
      <div class="msg-avatar teacher-avatar">🧑‍🏫</div>
    `;
    // 标记属于当前学生，便于切换人格时按学生过滤显示
    if (window.App && App.currentCharacter) {
      msgEl.dataset.characterId = App.currentCharacter.id;
    }
    this.container.appendChild(msgEl);
    this.scrollToBottom();

    const currentCharId = window.App && App.currentCharacter ? App.currentCharacter.id : null;
    this.history.push({
      role: 'teacher',
      text,
      trigger,
      timestamp: Date.now(),
      characterId: currentCharId,
    });

    // 每次老师发话后，实时刷新当前角色的个性化路径分析与教学建议
    if (window.PathAnalyzer && window.App && App.currentCharacter) {
      PathAnalyzer.renderCompareBars(App.currentCharacter.id);
      PathAnalyzer.checkWarnings(App.currentCharacter.id);
    }

    // 仅推送到工作流，不再有任何本地默认回复
    if (window.WorkflowClient && window.App && App.sessionId) {
      if (window.WORKFLOW_CONFIG && window.WORKFLOW_CONFIG.debug && window.console) {
        console.log('[Workflow] 前端已把本条消息发给工作流，sessionId:', App.sessionId, 'content:', text.slice(0, 50));
      }
      // 传输时将 model 直接加入 text 中并用 {} 括起来：{李大志}你好
      const defaultModel = '李大志';
      const modelName = (App.currentCharacter && App.currentCharacter.name) || defaultModel;
      const taggedText = `{${modelName}}` + text;
      WorkflowClient.sendTextMessage(App.sessionId, 'teacher', taggedText, {
        trigger,
        characterId: App.currentCharacter ? App.currentCharacter.id : null,
        model: modelName,
      });
    }
  },

  addStudentMessage(text, innerThought, char) {
    const msgEl = document.createElement('div');
    msgEl.className = 'message student-msg fade-in';
    // 学生消息归属当前学生
    msgEl.dataset.characterId = char.id;

    const emotion = window.App ? window.App.currentEmotion : null;
    const glowClass = emotion ? getEmotionGlow(emotion) : '';

    const bubbleHTML = `
      <div class="msg-avatar student-avatar" style="background:${char.color}20;border-color:${char.color}">${char.avatar}</div>
      <div class="msg-content-wrap">
        <div class="msg-bubble student-bubble ${glowClass}" style="border-left: 3px solid ${char.color}">
          <div class="msg-label" style="color:${char.color}">${char.avatar} ${char.name}</div>
          <div class="msg-text"></div>
        </div>
        ${innerThought ? `
        <div class="inner-thought" style="border-left: 3px solid ${char.color}40">
          <span class="thought-icon">💭</span>
          <span class="thought-label">内心OS：</span>
          <span class="thought-text"></span>
        </div>` : ''}
      </div>
    `;

    msgEl.innerHTML = bubbleHTML;
    this.container.appendChild(msgEl);
    this.scrollToBottom();

    const textEl = msgEl.querySelector('.msg-text');
    this.typeWriter(textEl, text, 50, () => {
      if (innerThought) {
        const thoughtEl = msgEl.querySelector('.thought-text');
        setTimeout(() => {
          msgEl.querySelector('.inner-thought').classList.add('show');
          this.typeWriter(thoughtEl, innerThought, 35, () => {
            this.scrollToBottom();
          });
        }, 400);
      }
    });

    // 将学生文本消息推送到工作流（不包含内心 OS）
    if (window.WorkflowClient && window.App && App.sessionId) {
      WorkflowClient.sendTextMessage(App.sessionId, 'student', text, {
        characterId: App.currentCharacter ? App.currentCharacter.id : null,
      });
    }
  },

  typeWriter(element, text, speed, callback) {
    let i = 0;
    this.isTyping = true;
    const timer = setInterval(() => {
      if (i < text.length) {
        element.textContent += text.charAt(i);
        i++;
        this.scrollToBottom();
      } else {
        clearInterval(timer);
        this.isTyping = false;
        if (callback) callback();
      }
    }, speed);
  },

  showTypingIndicator() {
    const char = window.App.currentCharacter;
    const indicator = document.createElement('div');
    indicator.className = 'message student-msg typing-indicator fade-in';
    indicator.id = 'typing-indicator';
    indicator.innerHTML = `
      <div class="msg-avatar student-avatar" style="background:${char.color}20;border-color:${char.color}">${char.avatar}</div>
      <div class="msg-bubble student-bubble typing-bubble" style="border-left: 3px solid ${char.color}">
        <div class="typing-dots">
          <span></span><span></span><span></span>
        </div>
        <span class="typing-label">${char.name} 正在思考...</span>
      </div>
    `;
    this.container.appendChild(indicator);
    this.scrollToBottom();
  },

  removeTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.remove();
  },

  /** 显示/隐藏「工作流思考中」加载态，与工作流请求配合 */
  showWorkflowLoading(show) {
    const id = 'workflow-loading-indicator';
    const el = document.getElementById(id);
    if (show && !el) {
      const msg = document.createElement('div');
      msg.id = id;
      msg.className = 'message workflow-loading-msg fade-in';
      msg.innerHTML = `
        <div class="workflow-loading-bubble">
          <div class="workflow-loading-dots">
            <span></span><span></span><span></span>
          </div>
          <span>工作流思考中…</span>
        </div>
      `;
      this.container.appendChild(msg);
      this.scrollToBottom();
    } else if (!show && el) {
      el.remove();
    }
    this.scrollToBottom();
  },

  /**
   * 工作流返回的回复，直接追加到主对话区（#chat-messages）
   * @param {string} text - 回复正文
   * @param {string} [replyId] - 本条回复唯一 id，同一次流式推送用同一 id 更新同一气泡；不传则每次新建气泡
   */
  addWorkflowReply(text, replyId) {
    let str = this._workflowReplyToString(text);
    if (str === null) return;
    if (str === '') str = '(空回复)';

    let container = this.container;
    if (!container) {
      container = document.getElementById('chat-messages');
      this.container = container;
    }
    if (!container) {
      console.error('[ChatEngine] 主对话区 #chat-messages 不存在，无法显示智能体回复');
      return;
    }

    const id = replyId || 'workflow-reply-' + Date.now();
    let msgEl = document.getElementById(id);
    if (msgEl) {
      const textEl = msgEl.querySelector('.workflow-bubble .msg-text');
      if (textEl) {
        textEl.textContent = str;
        textEl.style.whiteSpace = 'pre-wrap';
        textEl.style.wordBreak = 'break-word';
      }
      this.scrollToBottom();
      return;
    }
    msgEl = document.createElement('div');
    msgEl.id = id;
    msgEl.className = 'message workflow-msg fade-in';
    // 智能体消息也绑定到当前学生，便于在切换人格时按角色过滤显示
    if (window.App && App.currentCharacter) {
      msgEl.dataset.characterId = App.currentCharacter.id;
    }
    msgEl.innerHTML = `
      <div class="msg-avatar workflow-avatar">🤖</div>
      <div class="msg-bubble workflow-bubble">
        <div class="msg-label">智能体</div>
        <div class="msg-text">${escapeHtml(str)}</div>
      </div>
    `;
    container.appendChild(msgEl);
    this.scrollToBottom();
  },

  /** 将工作流返回统一转为可展示字符串，优先使用 JSON 的 text 字段 */
  _workflowReplyToString(text) {
    if (text == null) return null;
    if (typeof text === 'string') return text;
    if (typeof text !== 'object') return String(text);
    const v = text.text || text.content || text.reply || text.message ||
      (typeof text.data === 'string' ? text.data : '') ||
      (typeof text.output === 'string' ? text.output : '');
    if (typeof v === 'string') return v;
    try {
      return JSON.stringify(text);
    } catch (_) {
      return String(text);
    }
  },

  /**
   * 流式结束后移除该条回复的临时 id，后续回复会新建气泡
   * @param {string} [replyId] - 本条回复的 id，不传则移除 id 为 workflow-reply-current 的节点（兼容旧逻辑）
   */
  finalizeWorkflowReply(replyId) {
    const id = replyId || 'workflow-reply-current';
    const el = document.getElementById(id);
    if (el) el.removeAttribute('id');
  },

  scrollToBottom() {
    this.container.scrollTop = this.container.scrollHeight;
  },

  clear() {
    this.container.innerHTML = '';
    this.history = [];
  },

  addSystemMessage(text) {
    if (!this.container) {
      this.container = document.getElementById('chat-messages');
      if (!this.container) return;
    }
    // 切换提示始终放在主对话框最上方：先移除已有系统提示，再插入到第一个位置
    const existed = this.container.querySelectorAll('.message.system-msg');
    existed.forEach(el => el.remove());

    const msgEl = document.createElement('div');
    msgEl.className = 'message system-msg fade-in';
    msgEl.innerHTML = `<div class="system-bubble">${text}</div>`;

    if (this.container.firstChild) {
      this.container.insertBefore(msgEl, this.container.firstChild);
    } else {
      this.container.appendChild(msgEl);
    }
  },

  /**
   * 将 JSON 对话数据渲染到主对话区，形成与用户对话的形式
   * @param {Array} records - 每项为 { request, response, created_at?, trigger? }，request 为用户/老师，response 为智能体
   */
  renderConversationFromJson(records) {
    if (!this.container || !Array.isArray(records) || records.length === 0) return;
    const char = window.App && window.App.currentCharacter;
    const characterId = char ? char.id : null;

    records.forEach((r) => {
      const request = (r.request != null && r.request !== '') ? String(r.request) : '';
      const response = (r.response != null && r.response !== '') ? String(r.response) : '';
      if (!request && !response) return;

      if (request) {
        const teacherEl = document.createElement('div');
        teacherEl.className = 'message teacher-msg fade-in';
        teacherEl.innerHTML = `
          <div class="msg-bubble teacher-bubble">
            <div class="msg-label">👨‍🏫 老师</div>
            <div class="msg-text">${escapeHtml(request)}</div>
          </div>
          <div class="msg-avatar teacher-avatar">🧑‍🏫</div>
        `;
        if (characterId) teacherEl.dataset.characterId = characterId;
        this.container.appendChild(teacherEl);
        this.history.push({
          role: 'teacher',
          text: request,
          trigger: r.trigger || null,
          timestamp: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
          characterId,
        });
      }

      if (response) {
        const workflowEl = document.createElement('div');
        workflowEl.className = 'message workflow-msg fade-in';
        workflowEl.innerHTML = `
          <div class="msg-avatar workflow-avatar">🤖</div>
          <div class="msg-bubble workflow-bubble">
            <div class="msg-label">智能体</div>
            <div class="msg-text">${escapeHtml(response)}</div>
          </div>
        `;
        if (characterId) workflowEl.dataset.characterId = characterId;
        const textEl = workflowEl.querySelector('.msg-text');
        if (textEl) {
          textEl.style.whiteSpace = 'pre-wrap';
          textEl.style.wordBreak = 'break-word';
        }
        this.container.appendChild(workflowEl);
        this.history.push({
          role: 'workflow',
          text: response,
          timestamp: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
          characterId,
        });
      }
    });

    this.scrollToBottom();
  },
};

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
