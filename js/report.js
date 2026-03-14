/**
 * 教学报告生成模块
 */
const ReportGenerator = {
  radarChart: null,

  generateReport(chatHistory, character, emotionSnapshots) {
    const scores = this.calculateScores(chatHistory, character);
    const suggestions = this.generateSuggestions(chatHistory, character, emotionSnapshots);
    const summary = this.generateSummary(chatHistory, character);

    this.showReportModal(scores, suggestions, summary, character);
  },

  calculateScores(history, character) {
    const teacherMsgs = history.filter(m => m.role === 'teacher');
    let empathy = 50, questioning = 50, patience = 50, adaptability = 50, encouragement = 50;

    teacherMsgs.forEach(msg => {
      switch (msg.trigger) {
        case '鼓励':
          empathy += 8; encouragement += 12; break;
        case '安抚':
          empathy += 10; patience += 10; break;
        case '批评':
          if (character.id === 'dazhi') {
            empathy -= 15; adaptability -= 10;
          } else {
            empathy -= 5;
          }
          break;
        case '提问':
          questioning += 10; break;
        case '互动':
          adaptability += 8; questioning += 5; break;
      }
    });

    const clamp = v => Math.max(10, Math.min(100, Math.round(v)));
    return {
      empathy: clamp(empathy),
      questioning: clamp(questioning),
      patience: clamp(patience),
      adaptability: clamp(adaptability),
      encouragement: clamp(encouragement)
    };
  },

  generateSuggestions(history, character, snapshots) {
    const suggestions = [];
    const teacherMsgs = history.filter(m => m.role === 'teacher');

    const criticisms = teacherMsgs.filter(m => m.trigger === '批评');
    const encouragements = teacherMsgs.filter(m => m.trigger === '鼓励');
    const comforts = teacherMsgs.filter(m => m.trigger === '安抚');

    if (character.id === 'dazhi') {
      if (criticisms.length > 1) {
        suggestions.push({
          type: 'warning',
          icon: '⚠️',
          text: `您对${character.name}使用了${criticisms.length}次批评。该学生属于"${character.personality}"，过多批评会加剧其习得性无助感，建议多用鼓励和引导。`
        });
      }
      if (encouragements.length === 0) {
        suggestions.push({
          type: 'tip',
          icon: '💡',
          text: `建议对${character.name}多使用正向鼓励。研究表明，对习得性无助型学生，"具体化表扬"（如"你这个思路很有创意"）比泛泛鼓励更有效。`
        });
      }
    }

    if (character.id === 'yiming') {
      if (criticisms.length === 0 && teacherMsgs.length > 3) {
        suggestions.push({
          type: 'tip',
          icon: '💡',
          text: `${character.name}是"${character.personality}"学生，适当的规则提醒有助于帮助他集中注意力。完全不设限可能让他更加散漫。`
        });
      }
    }

    if (character.id === 'xiaorou') {
      if (criticisms.length > 0) {
        suggestions.push({
          type: 'warning',
          icon: '⚠️',
          text: `${character.name}是高敏感型学生，批评对她的情绪冲击非常大。建议用"三明治反馈法"：先肯定→再指出问题→最后鼓励。`
        });
      }
    }

    if (teacherMsgs.length < 3) {
      suggestions.push({
        type: 'info',
        icon: '📝',
        text: '本次对话轮次较少，建议进行更充分的互动以获得更准确的教学评估。'
      });
    }

    if (comforts.length > 0 && encouragements.length > 0) {
      suggestions.push({
        type: 'praise',
        icon: '🌟',
        text: '您在本次对话中同时使用了安抚和鼓励策略，这是非常好的教学实践！情绪支持+正向激励的组合对学生的心理健康非常有益。'
      });
    }

    if (suggestions.length === 0) {
      suggestions.push({
        type: 'info',
        icon: '📊',
        text: '本次训练表现中规中矩，建议尝试更多元的互动策略来提升教学效果。'
      });
    }

    return suggestions;
  },

  generateSummary(history, character) {
    const total = history.length;
    const teacherCount = history.filter(m => m.role === 'teacher').length;
    const duration = total > 0
      ? Math.round((history[history.length - 1].timestamp - history[0].timestamp) / 1000)
      : 0;
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return {
      totalRounds: Math.floor(total / 2),
      teacherMessages: teacherCount,
      studentMessages: total - teacherCount,
      duration: `${minutes}分${seconds}秒`,
      character: character.name,
      personality: character.personality
    };
  },

  showReportModal(scores, suggestions, summary, character) {
    const existing = document.getElementById('report-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'report-modal';
    modal.className = 'report-overlay';

    modal.innerHTML = `
      <div class="report-container">
        <div class="report-header" style="background: ${character.bgGradient}">
          <button class="report-close" onclick="document.getElementById('report-modal').remove()">✕</button>
          <div class="report-title-area">
            <span class="report-avatar">${character.avatar}</span>
            <div>
              <h2>📋 教学训练报告</h2>
              <p>训练对象：${character.name}（${character.personality}）</p>
            </div>
          </div>
        </div>

        <div class="report-body">
          <div class="report-section">
            <h3>📊 训练概况</h3>
            <div class="summary-grid">
              <div class="summary-item">
                <div class="summary-num">${summary.totalRounds}</div>
                <div class="summary-label">对话轮次</div>
              </div>
              <div class="summary-item">
                <div class="summary-num">${summary.teacherMessages}</div>
                <div class="summary-label">教师发言</div>
              </div>
              <div class="summary-item">
                <div class="summary-num">${summary.studentMessages}</div>
                <div class="summary-label">学生回应</div>
              </div>
              <div class="summary-item">
                <div class="summary-num">${summary.duration}</div>
                <div class="summary-label">训练时长</div>
              </div>
            </div>
          </div>

          <div class="report-section">
            <h3>🎯 能力评估</h3>
            <div class="scores-row">
              <div class="report-radar-wrap">
                <div id="report-radar" style="width:100%;height:260px;"></div>
              </div>
              <div class="score-bars">
                ${this.renderScoreBars(scores)}
              </div>
            </div>
          </div>

          <div class="report-section">
            <h3>💡 改进建议</h3>
            <div class="suggestions-list">
              ${suggestions.map(s => `
                <div class="suggestion-card ${s.type}">
                  <span class="suggestion-icon">${s.icon}</span>
                  <p>${s.text}</p>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="report-footer">
          <button class="btn-restart" onclick="document.getElementById('report-modal').remove(); App.resetSession();">
            🔄 重新训练
          </button>
          <button class="btn-export" onclick="ReportGenerator.exportReport()">
            📥 导出报告
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('show'));

    setTimeout(() => this.renderReportRadar(scores, character), 200);
  },

  renderScoreBars(scores) {
    const labels = {
      empathy: '共情能力',
      questioning: '提问技巧',
      patience: '耐心程度',
      adaptability: '应变能力',
      encouragement: '激励能力'
    };
    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#e67e22', '#9b59b6'];
    let html = '';
    let i = 0;
    for (const [key, label] of Object.entries(labels)) {
      const val = scores[key];
      const stars = Math.round(val / 20);
      html += `
        <div class="score-bar-item">
          <div class="score-bar-head">
            <span>${label}</span>
            <span class="score-stars">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</span>
          </div>
          <div class="score-bar-track">
            <div class="score-bar-fill" style="width:${val}%;background:${colors[i]}"></div>
          </div>
          <span class="score-val">${val}分</span>
        </div>
      `;
      i++;
    }
    return html;
  },

  renderReportRadar(scores, character) {
    const dom = document.getElementById('report-radar');
    if (!dom) return;
    const chart = echarts.init(dom);
    chart.setOption({
      radar: {
        indicator: [
          { name: '共情能力', max: 100 },
          { name: '提问技巧', max: 100 },
          { name: '耐心程度', max: 100 },
          { name: '应变能力', max: 100 },
          { name: '激励能力', max: 100 }
        ],
        shape: 'polygon',
        splitNumber: 4,
        axisName: { color: '#636e72', fontSize: 11 },
        splitLine: { lineStyle: { color: '#dfe6e9' } },
        splitArea: { areaStyle: { color: ['rgba(255,255,255,0)', 'rgba(200,200,200,0.05)'] } }
      },
      series: [{
        type: 'radar',
        data: [{
          value: [scores.empathy, scores.questioning, scores.patience, scores.adaptability, scores.encouragement],
          lineStyle: { color: character.color, width: 2 },
          areaStyle: { color: character.color + '35' },
          itemStyle: { color: character.color },
          symbol: 'circle',
          symbolSize: 6
        }],
        animationDuration: 1000,
        animationEasing: 'elasticOut'
      }]
    });
  },

  exportReport() {
    alert('📥 报告导出功能开发中，敬请期待！');
  }
};
