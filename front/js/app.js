/**
 * 个性化路径分析引擎
 */
const PathAnalyzer = {
  activeWarnings: new Set(),

  renderCompareBars(characterId) {
    const container = document.getElementById('path-compare');
    if (!container) return;
    const profile = PATH_PROFILES[characterId];
    if (!profile) return;

    const triggers = ['鼓励', '安抚', '互动', '提问', '批评'];
    const triggerColors = {
      '鼓励': '#2ecc71', '安抚': '#3498db', '互动': '#9b59b6', '提问': '#e67e22', '批评': '#e74c3c'
    };

    const teacherMsgs = ChatEngine.history.filter(m => m.role === 'teacher' && m.characterId === characterId);
    const total = Math.max(teacherMsgs.length, 1);

    container.innerHTML = triggers.map(trigger => {
      const idealPct = profile.ideal[trigger] || 0;
      const actualCount = teacherMsgs.filter(m => m.trigger === trigger).length;
      const actualPct = Math.round((actualCount / total) * 100);
      const color = triggerColors[trigger];
      let tagClass = 'neutral';
      if (profile.recommended.includes(trigger)) tagClass = 'recommended';
      else if (profile.harmful.includes(trigger)) tagClass = 'harmful';

      return `
        <div class="path-bar-item">
          <div class="path-bar-head">
            <span>${trigger} <span class="path-label-tag ${tagClass}">${
              tagClass === 'recommended' ? '推荐' : tagClass === 'harmful' ? '慎用' : '适度'
            }</span></span>
          </div>
          <div class="path-dual-track">
            <div class="path-bar-ideal" style="width:${idealPct}%;background:${color}"></div>
            <div class="path-bar-actual" style="width:${actualPct}%;background:${color}"></div>
          </div>
          <div class="path-bar-labels">
            <span>期待 ${idealPct}%</span>
            <span>实际 ${actualPct}%</span>
          </div>
        </div>
      `;
    }).join('');
  },

  checkWarnings(characterId) {
    const profile = PATH_PROFILES[characterId];
    if (!profile) return;

    const container = document.getElementById('path-warning-area');
    if (!container) return;

    const history = ChatEngine.history.filter(m => m.characterId === characterId);
    let hasNewDanger = false;

    profile.warnings.forEach(w => {
      const triggered = w.check(history);
      const exists = this.activeWarnings.has(w.id);

      if (triggered && !exists) {
        this.activeWarnings.add(w.id);
        hasNewDanger = w.level === 'danger';

        const card = document.createElement('div');
        card.className = `path-warning-card ${w.level}`;
        card.id = `warn-${w.id}`;
        card.innerHTML = `
          <div class="path-warning-title">${w.title}</div>
          <div class="path-warning-text">${w.message}</div>
        `;
        container.appendChild(card);
      }
    });

    if (hasNewDanger) {
      this.triggerDashboardAlert();
      this.triggerAreaGlow('red');
    }
  },

  triggerDashboardAlert() {
    const dash = document.querySelector('.dashboard');
    if (!dash) return;
    dash.classList.remove('dash-alert-red');
    void dash.offsetWidth;
    dash.classList.add('dash-alert-red');
    setTimeout(() => dash.classList.remove('dash-alert-red'), 4000);
  },

  triggerAreaGlow(color) {
    const area = document.getElementById('chat-area');
    if (!area) return;
    area.classList.remove('area-glow-red', 'area-glow-green', 'area-glow-blue');
    area.classList.add(`area-glow-${color}`);
    if (color === 'red') {
      setTimeout(() => area.classList.remove('area-glow-red'), 5000);
    }
  },

  updateAreaGlow(emotion) {
    const area = document.getElementById('chat-area');
    if (!area) return;
    area.classList.remove('area-glow-red', 'area-glow-green', 'area-glow-blue');
    if (emotion.anxiety > 70) area.classList.add('area-glow-red');
    else if (emotion.joy > 55 && emotion.anxiety < 40) area.classList.add('area-glow-green');
    else if (emotion.joy < 25) area.classList.add('area-glow-blue');
  },

  reset() {
    this.activeWarnings.clear();
    const container = document.getElementById('path-warning-area');
    if (container) container.innerHTML = '';
    const area = document.getElementById('chat-area');
    if (area) area.classList.remove('area-glow-red', 'area-glow-green', 'area-glow-blue');
  }
};

/**
 * 主控制器 - 串联所有模块
 */
const App = {
  currentCharacter: null,
  currentEmotion: null,
  sessionActive: false,
  sessionId: null,
  emotionSnapshots: [],
  // 为每个角色单独存储情绪历史，确保情绪可视化互不干扰
  emotionHistoriesByChar: {},
  // 为每个角色维护一份「动态五维画像」，在对话过程中根据情绪微调
  dynamicTraitsByChar: {},

  init() {
    this.renderCharacterCards();
    ChatEngine.init('chat-messages');
    EmotionDashboard.init();

    ChatEngine.onEmotionUpdate = (delta) => this.applyEmotionDelta(delta);

    this.bindEvents();
    this.selectCharacter('dazhi');
  },

  renderCharacterCards() {
    const container = document.getElementById('character-list');
    container.innerHTML = '';

    Object.values(CHARACTERS).forEach(char => {
      const card = document.createElement('div');
      card.className = 'char-card';
      card.id = `card-${char.id}`;
      card.onclick = () => this.selectCharacter(char.id);

      card.innerHTML = `
        <div class="char-avatar-wrap">
          <div class="char-avatar" style="border-color:${char.color}">${char.avatar}</div>
          <div class="char-online-dot" style="background:${char.color}"></div>
        </div>
        <div class="char-info">
          <div class="char-name">${char.name}</div>
          <div class="char-tagline">${char.tagline}</div>
        </div>
        <div class="char-type-badge" style="background:${char.color}15;color:${char.color}">${char.personality}</div>
      `;

      container.appendChild(card);
    });
  },

  selectCharacter(id) {
    // 切换前先把当前角色的情绪历史缓存下来
    if (this.currentCharacter && window.EmotionDashboard) {
      const prevId = this.currentCharacter.id;
      const eh = EmotionDashboard.emotionHistory || { joy: [], activation: [], anxiety: [] };
      const labels = EmotionDashboard.timeLabels || [];
      this.emotionHistoriesByChar[prevId] = {
        joy: [...eh.joy],
        activation: [...eh.activation],
        anxiety: [...eh.anxiety],
        labels: [...labels],
        tick: EmotionDashboard.tickCount || labels.length || 0,
      };
    }

    const char = CHARACTERS[id];
    if (!char) return;

    this.currentCharacter = char;
    this.currentEmotion = { ...char.emotion };
    this.sessionActive = true;
    // 每次切换学生，开启一个新的会话 ID，便于在工作流侧按会话聚合
    this.sessionId = `sess_${Date.now()}_${id}`;
    this.emotionSnapshots = [{ ...this.currentEmotion, time: Date.now() }];

    document.querySelectorAll('.char-card').forEach(c => c.classList.remove('active'));
    const activeCard = document.getElementById(`card-${id}`);
    if (activeCard) activeCard.classList.add('active');

    const chatArea = document.getElementById('chat-area');
    chatArea.style.background = char.bgGradient;

    const chatHeader = document.getElementById('chat-header-name');
    chatHeader.textContent = `${char.avatar} ${char.name}`;
    chatHeader.style.color = char.color;

    const chatSubtitle = document.getElementById('chat-header-type');
    chatSubtitle.textContent = char.personality;
    chatSubtitle.style.background = char.color + '15';
    chatSubtitle.style.color = char.color;

    // 仅展示当前学生的人机对话记录：其他学生的消息在界面上隐藏
    const allMessages = document.querySelectorAll('.message');
    allMessages.forEach(msg => {
      const cid = msg.dataset.characterId;
      if (!cid || cid === id) {
        msg.style.display = 'flex';
      } else {
        msg.style.display = 'none';
      }
    });

    // 为当前学生加载各自独立的情绪历史
    const stored = this.emotionHistoriesByChar[id];
    EmotionDashboard.resetHistory();
    if (stored && stored.labels && stored.labels.length) {
      EmotionDashboard.emotionHistory = {
        joy: [...stored.joy],
        activation: [...stored.activation],
        anxiety: [...stored.anxiety],
      };
      EmotionDashboard.timeLabels = [...stored.labels];
      EmotionDashboard.tickCount = stored.tick || stored.labels.length || 0;
      if (EmotionDashboard.chart) {
        EmotionDashboard.chart.setOption({
          xAxis: { data: [...EmotionDashboard.timeLabels] },
          series: [
            { data: [...EmotionDashboard.emotionHistory.joy] },
            { data: [...EmotionDashboard.emotionHistory.activation] },
            { data: [...EmotionDashboard.emotionHistory.anxiety] },
          ],
        });
      }
      // 使用该角色最近一次情绪作为当前情绪状态
      const lastIdx = stored.joy.length - 1;
      if (lastIdx >= 0) {
        this.currentEmotion = {
          joy: stored.joy[lastIdx],
          activation: stored.activation[lastIdx],
          anxiety: stored.anxiety[lastIdx],
        };
      }
      EmotionDashboard.updateBars(this.currentEmotion);
    } else {
      // 没有历史时，以角色初始情绪为起点
      EmotionDashboard.updateBars(this.currentEmotion);
      EmotionDashboard.pushHistory(this.currentEmotion);
    }
    // 使用当前角色的动态五维画像更新雷达图
    const traitStoreMap = this.dynamicTraitsByChar;
    const dynTraits = (traitStoreMap && traitStoreMap[id])
      ? traitStoreMap[id]
      : { ...char.traits };
    if (!traitStoreMap[id]) {
      this.dynamicTraitsByChar[id] = dynTraits;
    }
    EmotionDashboard.updateRadarChart({
      ...char,
      traits: dynTraits,
    });

    PathAnalyzer.reset();
    PathAnalyzer.renderCompareBars(id);

    // 切换人格时，提示窗只保留当前角色的一条，不在主对话框中累积
    const sysMsgs = document.querySelectorAll('.message.system-msg');
    sysMsgs.forEach(msg => msg.remove());

    ChatEngine.addSystemMessage(
      `🎭 已切换到学生 <b>${char.name}</b>（${char.personality}）<br>
       <span style="opacity:0.7">${char.desc}</span><br><br>
       <span style="font-size:12px;opacity:0.5">💡 提示：使用下方快捷短语或自由输入与学生对话</span>`
    );

    // 开启对话：聚焦输入框并滚到底部，便于用户直接输入
    this.focusChatInput();
  },

  applyEmotionDelta(delta) {
    Object.keys(delta).forEach(key => {
      this.currentEmotion[key] = Math.max(0, Math.min(100, this.currentEmotion[key] + delta[key]));
    });
    EmotionDashboard.updateBars(this.currentEmotion);
    EmotionDashboard.pushHistory(this.currentEmotion);
    this.emotionSnapshots.push({ ...this.currentEmotion, time: Date.now() });

    this.animateBarPulse(delta);

    if (this.currentCharacter) {
      PathAnalyzer.renderCompareBars(this.currentCharacter.id);
      PathAnalyzer.checkWarnings(this.currentCharacter.id);
      PathAnalyzer.updateAreaGlow(this.currentEmotion);
    }
  },

  animateBarPulse(delta) {
    Object.keys(delta).forEach(key => {
      if (Math.abs(delta[key]) > 5) {
        const bar = document.getElementById(`bar-${key}`);
        if (bar) {
          bar.classList.add('pulse');
          setTimeout(() => bar.classList.remove('pulse'), 600);
        }
      }
    });
  },

  sendMessage(text, trigger) {
    if (!text || !this.currentCharacter || ChatEngine.isTyping) return;
    if (window.WorkflowClient && window.WorkflowClient._workflowLoading) return;
    ChatEngine.addTeacherMessage(text, trigger);
    const input = document.getElementById('chat-input');
    if (input) {
      input.value = '';
      input.focus();
    }
  },

  showProfileModal() {
    if (!this.currentCharacter) return;
    const char = this.currentCharacter;

    const existing = document.getElementById('profile-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'profile-modal';
    modal.className = 'profile-overlay';

    modal.innerHTML = `
      <div class="profile-container">
        <button class="profile-close" onclick="document.getElementById('profile-modal').remove()">✕</button>
        <div class="profile-header" style="background: ${char.bgGradient}">
          <div class="profile-avatar-lg">${char.avatar}</div>
          <h2>${char.name}</h2>
          <span class="profile-badge" style="background:${char.color}">${char.personality}</span>
        </div>
        <div class="profile-body">
          <p class="profile-desc">${char.desc}</p>
          <h3>🧠 五维人格画像</h3>
          <div id="profile-radar-chart" style="width:100%;height:280px;"></div>
          <div class="trait-details">
            ${Object.entries(char.traits).map(([key, val], i) => `
              <div class="trait-row">
                <span class="trait-name">${char.traitLabels[i]}</span>
                <div class="trait-bar-track">
                  <div class="trait-bar-fill" style="width:${val}%;background:${char.color}"></div>
                </div>
                <span class="trait-val">${val}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('show'));

    setTimeout(() => {
      const dom = document.getElementById('profile-radar-chart');
      if (!dom) return;
      const chart = echarts.init(dom);
      chart.setOption({
        radar: {
          indicator: char.traitLabels.map(name => ({ name, max: 100 })),
          shape: 'polygon',
          splitNumber: 4,
          axisName: { color: '#636e72', fontSize: 12 },
          splitLine: { lineStyle: { color: '#dfe6e9' } },
          splitArea: { areaStyle: { color: ['rgba(255,255,255,0)', 'rgba(200,200,200,0.05)'] } }
        },
        series: [{
          type: 'radar',
          data: [{
            value: Object.values(char.traits),
            lineStyle: { color: char.color, width: 2.5 },
            areaStyle: { color: char.color + '30' },
            itemStyle: { color: char.color },
            symbol: 'circle',
            symbolSize: 6
          }],
          animationDuration: 1000,
          animationEasing: 'elasticOut'
        }]
      });
    }, 250);
  },

  showWorkflowDataModal() {
    const existing = document.getElementById('workflow-data-modal');
    if (existing) existing.remove();

    const store = window.WorkflowDataStore;
    if (!store) return;
    const list = store.getAll();

    const modal = document.createElement('div');
    modal.id = 'workflow-data-modal';
    modal.className = 'workflow-data-overlay';

    const listHtml = list.length === 0
      ? '<div class="workflow-data-empty">暂无工作流返回数据，对话中触发的智能体回复会自动记录于此。</div>'
      : list.map((r, i) => {
          const reqShort = (r.request || '').slice(0, 80) + ((r.request || '').length > 80 ? '…' : '');
          const resShort = (r.response || '').slice(0, 120) + ((r.response || '').length > 120 ? '…' : '');
          const time = r.created_at ? new Date(r.created_at).toLocaleString('zh-CN') : '';
          return `
            <div class="workflow-data-card" data-idx="${i}">
              <div class="workflow-data-meta">${time}${r.trigger ? ' · ' + r.trigger : ''}</div>
              <div class="workflow-data-req"><strong>请求：</strong>${escapeHtml(reqShort)}</div>
              <div class="workflow-data-res"><strong>回复：</strong>${escapeHtml(resShort)}</div>
              <details class="workflow-data-details">
                <summary>展开全文</summary>
                <div class="workflow-data-full-req">${escapeHtml(r.request || '')}</div>
                <div class="workflow-data-full-res">${escapeHtml(r.response || '')}</div>
              </details>
            </div>
          `;
        }).join('');

    modal.innerHTML = `
      <div class="workflow-data-container">
        <button class="workflow-data-close" aria-label="关闭">✕</button>
        <h2 class="workflow-data-title">📁 工作流返回数据</h2>
        <p class="workflow-data-desc">共 ${list.length} 条，可导出为 JSON 文件保存。</p>
        <div class="workflow-data-list">${listHtml}</div>
        <div class="workflow-data-actions">
          <button type="button" class="workflow-data-btn primary" id="workflow-data-export">导出 JSON 文件</button>
          <button type="button" class="workflow-data-btn" id="workflow-data-clear">清空数据</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('show'));

    modal.querySelector('.workflow-data-close').onclick = () => modal.remove();
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    document.getElementById('workflow-data-export').onclick = () => {
      store.exportToJsonFile();
    };
    document.getElementById('workflow-data-clear').onclick = () => {
      if (list.length && !confirm('确定清空所有工作流数据？')) return;
      store.clear();
      this.showWorkflowDataModal();
    };
  },

  endSession() {
    if (ChatEngine.history.length < 2) {
      ChatEngine.addSystemMessage('⚠️ 请至少进行一轮对话后再生成报告。');
      return;
    }
    this.sessionActive = false;

    // 汇总三个人格的训练数据并发送到「训练报告工作流」
    try {
      const now = Date.now();
      const characters = Object.values(window.CHARACTERS || {}).map(c => ({
        id: c.id,
        name: c.name,
        personality: c.personality,
      }));
      const history = (window.ChatEngine && Array.isArray(ChatEngine.history)) ? ChatEngine.history : [];

      const triggerStatsByChar = {};
      history.filter(m => m.role === 'teacher').forEach(m => {
        const cid = m.characterId || 'unknown';
        const trig = m.trigger || '自由输入';
        if (!triggerStatsByChar[cid]) triggerStatsByChar[cid] = {};
        triggerStatsByChar[cid][trig] = (triggerStatsByChar[cid][trig] || 0) + 1;
      });

      const payload = {
        type: 'training_report',
        created_at: new Date(now).toISOString(),
        app_session: this.sessionId,
        characters,
        chat_history: history,
        emotion_histories_by_character: this.emotionHistoriesByChar || {},
        dynamic_traits_by_character: this.dynamicTraitsByChar || {},
        trigger_stats_by_character: triggerStatsByChar,
      };

      if (window.WorkflowClient && typeof WorkflowClient.sendTrainingReport === 'function') {
        WorkflowClient.sendTrainingReport(payload);
      }
    } catch (e) {
      console.warn('[ReportWorkflow] 汇总训练报告数据失败:', e);
    }

    ReportGenerator.generateReport(
      ChatEngine.history,
      this.currentCharacter,
      this.emotionSnapshots
    );
  },

  resetSession() {
    if (this.currentCharacter) {
      this.selectCharacter(this.currentCharacter.id);
    }
  },

  /** 聚焦对话输入框并滚到底部，便于用户直接开始输入 */
  focusChatInput() {
    requestAnimationFrame(() => {
      const input = document.getElementById('chat-input');
      const messages = document.getElementById('chat-messages');
      if (input) {
        input.focus();
      }
      if (messages) {
        messages.scrollTop = messages.scrollHeight;
      }
    });
  },

  bindEvents() {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');

    sendBtn.onclick = () => {
      const text = input.value.trim();
      if (text) this.sendMessage(text, null);
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = input.value.trim();
        if (text) this.sendMessage(text, null);
      }
    });

    document.querySelectorAll('.quick-btn').forEach(btn => {
      btn.onclick = () => {
        const trigger = btn.dataset.trigger;
        const text = btn.dataset.text;
        this.sendMessage(text, trigger);
      };
    });

    document.getElementById('btn-profile').onclick = () => this.showProfileModal();
    document.getElementById('btn-workflow-data').onclick = () => this.showWorkflowDataModal();
    document.getElementById('btn-report').onclick = () => this.endSession();
  }
};

function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// 挂到 window，供 ChatEngine 等模块通过 window.App 访问
window.App = App;

window.addEventListener('DOMContentLoaded', () => App.init());
