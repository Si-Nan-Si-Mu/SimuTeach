/**
 * 师范生教学技能训练智能体 - 按参考图设计
 * 会话管理、角色选择、消息发送、学生行为动画
 */

const CONFIG = {
  chatApiUrl: (typeof API_CONFIG !== 'undefined' && API_CONFIG.chatApiUrl) || 'https://api.weda.tencent.com/v1/workflows/conv_flow/trigger',
  roles: {
    naughty: { name: '小明', id: 'naughty', type: '调皮型' },
    shy: { name: '小红', id: 'shy', type: '内向型' },
    struggling: { name: '小强', id: 'struggling', type: '学困型' }
  },
  storageKey: 'teacher_training_session',
  randomAnimInterval: [3000, 7000],
  speakingDuration: 4000
};

const ANIM_TYPES = ['raise-hand', 'speaking', 'distracted', 'listening'];

let state = {
  sessionId: null,
  roleId: 'naughty',
  roleName: '小明',
  messages: [],
  isSending: false,
  randomAnimTimer: null,
  systemRunning: false
};

const el = {
  chatHistory: document.getElementById('chatHistory'),
  messageInput: document.getElementById('messageInput'),
  sendBtn: document.getElementById('sendBtn'),
  newSessionBtn: document.getElementById('newSessionBtn'),
  reportLink: document.getElementById('reportLink'),
  speakingName: document.getElementById('speakingName'),
  btnStart: document.getElementById('btnStart'),
  btnPause: document.getElementById('btnPause'),
  btnStop: document.getElementById('btnStop')
};

// ========== 工具函数 ==========

function generateSessionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
}

function initSession() {
  const stored = sessionStorage.getItem(CONFIG.storageKey);
  if (stored) {
    try {
      const data = JSON.parse(stored);
      state.sessionId = data.sessionId;
      state.messages = data.messages || [];
      state.roleId = data.roleId || 'naughty';
      state.roleName = CONFIG.roles[state.roleId].name;
      return;
    } catch (e) {
      console.warn('恢复会话失败', e);
    }
  }
  state.sessionId = generateSessionId();
  state.messages = [];
  persistSession();
}

function persistSession() {
  sessionStorage.setItem(CONFIG.storageKey, JSON.stringify({
    sessionId: state.sessionId,
    messages: state.messages,
    roleId: state.roleId
  }));
}

function newSession() {
  state.sessionId = generateSessionId();
  state.messages = [];
  persistSession();
  renderMessages();
  updateReportLink();
  if (el.messageInput) el.messageInput.value = '';
  clearAllAnimations();
  startRandomAnimations();
}

// ========== 学生动画 ==========

function getStudentDesk(roleId) {
  return document.querySelector(`.desk-unit[data-role="${roleId}"]`);
}

function setStudentAnimation(roleId, animType, bubbleText) {
  const desk = getStudentDesk(roleId);
  if (!desk) return;
  desk.dataset.anim = animType || '';
  const bubble = desk.querySelector('.speech-bubble');
  if (bubble) bubble.textContent = bubbleText ?? '';
}

function clearAllAnimations() {
  document.querySelectorAll('.desk-unit').forEach(desk => {
    desk.dataset.anim = '';
  });
}

function triggerRandomAnimation() {
  const roles = ['naughty', 'shy', 'struggling'];
  const role = roles[Math.floor(Math.random() * roles.length)];
  const anim = ANIM_TYPES[Math.floor(Math.random() * ANIM_TYPES.length)];
  const bubbleText = anim === 'distracted' ? 'Zzz' : '';
  setStudentAnimation(role, anim, bubbleText);
  setTimeout(() => {
    const d = getStudentDesk(role);
    if (d?.dataset.anim === anim) setStudentAnimation(role, '', '');
  }, 2500 + Math.random() * 2000);
}

function startRandomAnimations() {
  if (state.randomAnimTimer) clearTimeout(state.randomAnimTimer);
  if (!state.systemRunning) return;
  const run = () => {
    if (!state.systemRunning) return;
    triggerRandomAnimation();
    const [min, max] = CONFIG.randomAnimInterval;
    state.randomAnimTimer = setTimeout(run, min + Math.random() * (max - min));
  };
  run();
}

function stopRandomAnimations() {
  if (state.randomAnimTimer) {
    clearTimeout(state.randomAnimTimer);
    state.randomAnimTimer = null;
  }
  clearAllAnimations();
}

function showSpeakingAnimation(roleId, replyText) {
  ['naughty', 'shy', 'struggling'].forEach(r => {
    if (r !== roleId) {
      const d = getStudentDesk(r);
      if (d?.dataset.anim === 'speaking') setStudentAnimation(r, '', '');
    }
  });
  const desk = getStudentDesk(roleId);
  if (desk) {
    const txt = replyText ? (replyText.length > 16 ? replyText.slice(0, 16) + '…' : replyText) : '...';
    setStudentAnimation(roleId, 'speaking', txt);
  }
  if (el.speakingName) el.speakingName.textContent = CONFIG.roles[roleId].name;
  setTimeout(() => {
    const d = getStudentDesk(roleId);
    if (d?.dataset.anim === 'speaking') setStudentAnimation(roleId, '', '');
    if (el.speakingName) el.speakingName.textContent = '—';
  }, CONFIG.speakingDuration);
}

// ========== 渲染 ==========

function renderMessages() {
  if (!el.chatHistory) return;
  if (state.messages.length === 0) {
    el.chatHistory.innerHTML = '<div class="chat-empty">暂无对话，输入消息开始试讲吧～</div>';
    return;
  }
  el.chatHistory.innerHTML = state.messages.map(msg => {
    const isUser = msg.speaker === 'user';
    const label = isUser ? '教师' : msg.speakerLabel || state.roleName;
    return `
      <div class="message ${isUser ? 'user' : 'ai'}">
        <div>
          <div class="message-sender">${escapeHtml(label)}</div>
          <div class="message-bubble">${escapeHtml(msg.content)}</div>
        </div>
      </div>
    `;
  }).join('');
  el.chatHistory.scrollTop = el.chatHistory.scrollHeight;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function updateProfileSelection() {
  document.querySelectorAll('.profile-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.role === state.roleId);
  });
}

// ========== API ==========

async function sendMessage(text) {
  if (!text.trim() || state.isSending) return;
  state.isSending = true;
  if (el.sendBtn) {
    el.sendBtn.disabled = true;
    el.sendBtn.innerHTML = '<span class="loading"></span>';
  }

  state.messages.push({ speaker: 'user', content: text.trim() });
  renderMessages();
  persistSession();
  if (el.messageInput) el.messageInput.value = '';

  try {
    const res = await fetch(CONFIG.chatApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: state.sessionId,
        role_id: state.roleId,
        message: text.trim()
      })
    });

    const data = await res.json().catch(() => ({}));

    if (data.code === 0 && data.ai_reply) {
      state.messages.push({
        speaker: 'ai',
        content: data.ai_reply,
        speakerLabel: state.roleName
      });
      showSpeakingAnimation(state.roleId, data.ai_reply);
    } else {
      const mock = '[模拟回复] 收到。';
      state.messages.push({
        speaker: 'ai',
        content: mock,
        speakerLabel: state.roleName
      });
      showSpeakingAnimation(state.roleId, mock);
    }
  } catch (err) {
    console.error('发送失败', err);
    const errMsg = '网络错误，请稍后重试。';
    state.messages.push({
      speaker: 'ai',
      content: errMsg,
      speakerLabel: state.roleName
    });
    showSpeakingAnimation(state.roleId, errMsg);
  }

  renderMessages();
  persistSession();
  state.isSending = false;
  if (el.sendBtn) {
    el.sendBtn.disabled = false;
    el.sendBtn.textContent = '发送';
  }
}

function updateReportLink() {
  if (!el.reportLink) return;
  const url = new URL('report.html', window.location.href);
  url.searchParams.set('session_id', state.sessionId || '');
  el.reportLink.href = url.toString();
}

// ========== 事件 ==========

function bindEvents() {
  if (el.sendBtn) {
    el.sendBtn.addEventListener('click', () => sendMessage(el.messageInput?.value || ''));
  }

  if (el.messageInput) {
    el.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(el.messageInput.value);
      }
    });
  }

  if (el.newSessionBtn) {
    el.newSessionBtn.addEventListener('click', () => {
      if (confirm('确定要新建试讲吗？当前对话将被清空。')) {
        newSession();
      }
    });
  }

  document.querySelectorAll('.profile-card').forEach(card => {
    card.addEventListener('click', () => {
      state.roleId = card.dataset.role;
      state.roleName = CONFIG.roles[state.roleId].name;
      persistSession();
      updateProfileSelection();
    });
  });

  if (el.btnStart) {
    el.btnStart.addEventListener('click', () => {
      state.systemRunning = true;
      startRandomAnimations();
      el.btnStart.disabled = true;
      if (el.btnPause) el.btnPause.disabled = false;
    });
  }
  if (el.btnPause) {
    el.btnPause.addEventListener('click', () => {
      const paused = el.btnPause.textContent === '暂停';
      if (paused) {
        stopRandomAnimations();
        el.btnPause.textContent = '继续';
      } else {
        startRandomAnimations();
        el.btnPause.textContent = '暂停';
      }
    });
  }
  if (el.btnStop) {
    el.btnStop.addEventListener('click', () => {
      state.systemRunning = false;
      stopRandomAnimations();
      el.btnStart.disabled = false;
      if (el.btnPause) {
        el.btnPause.disabled = true;
        el.btnPause.textContent = '暂停';
      }
    });
  }
}

// ========== 初始化 ==========

function init() {
  initSession();
  updateProfileSelection();
  renderMessages();
  updateReportLink();
  bindEvents();
  state.systemRunning = true;
  startRandomAnimations();
  if (el.btnStart) el.btnStart.disabled = true;
  if (el.btnPause) el.btnPause.disabled = false;
}

document.addEventListener('DOMContentLoaded', init);
