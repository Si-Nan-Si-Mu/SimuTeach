/**
 * 试讲报告页 - 数据获取与展示
 */

const CONFIG = {
  reportApiUrl: (typeof API_CONFIG !== 'undefined' && API_CONFIG.reportApiUrl) || 'https://api.weda.tencent.com/v1/workflows/report_flow/trigger',
  pollInterval: 3000,
  pollMaxAttempts: 20
};

function getSessionId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('session_id') || '';
}

async function fetchReport(sessionId) {
  const res = await fetch(CONFIG.reportApiUrl + '?session_id=' + encodeURIComponent(sessionId), {
    method: 'GET'
  });
  return res.json();
}

function renderEmotionChart(container, sentiment) {
  if (!container || !sentiment || typeof echarts === 'undefined') return;
  const chart = echarts.init(container);
  const emotions = Object.entries(sentiment);
  const option = {
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: emotions.map(([k]) => k) },
    yAxis: { type: 'value', min: 0, max: 1 },
    series: [{ type: 'bar', data: emotions.map(([, v]) => v), itemStyle: { color: '#4a8ba8' } }]
  };
  chart.setOption(option);
  window.addEventListener('resize', () => chart.resize());
}

function renderTags(container, tags) {
  if (!container) return;
  if (!Array.isArray(tags) || tags.length === 0) {
    container.innerHTML = '<span class="metric">暂无数据</span>';
    return;
  }
  container.innerHTML = tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');
}

function renderComplexity(container, data) {
  if (!container) return;
  const avgLen = data?.avg_sentence_length ?? data?.complexity ?? '-';
  const richness = data?.vocabulary_richness ?? data?.richness ?? '-';
  container.innerHTML = `
    <span class="metric">平均句长: <strong>${avgLen}</strong></span>
    <span class="metric">词汇丰富度: <strong>${richness}</strong></span>
  `;
}

function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function showReport(data) {
  document.getElementById('loadingSection').style.display = 'none';
  const content = document.getElementById('reportContent');
  content.style.display = 'block';

  if (data.sentiment) {
    renderEmotionChart(document.getElementById('emotionChart'), data.sentiment);
  }
  if (data.strategy_tags) {
    renderTags(document.getElementById('strategyTags'), data.strategy_tags);
  }
  renderComplexity(document.getElementById('complexityMetrics'), {
    avg_sentence_length: data.avg_sentence_length ?? data.complexity,
    vocabulary_richness: data.vocabulary_richness ?? data.richness
  });
  const summary = document.getElementById('summaryText');
  if (data.summary) {
    summary.textContent = data.summary;
  } else if (data.suggestions) {
    summary.textContent = Array.isArray(data.suggestions) ? data.suggestions.join(' ') : data.suggestions;
  } else {
    summary.textContent = '暂无建议。';
  }
}

function showError(msg) {
  document.getElementById('loadingSection').innerHTML = '<p class="loading-msg">' + escapeHtml(msg) + '</p>';
}

async function loadReport() {
  const sessionId = getSessionId();
  document.getElementById('sessionDisplay').textContent = '会话ID: ' + (sessionId || '(未指定)');

  if (!sessionId) {
    showError('请从对话页进入，或携带 session_id 参数。');
    return;
  }

  let attempts = 0;
  const poll = async () => {
    try {
      const data = await fetchReport(sessionId);
      if (data && (data.sentiment || data.strategy_tags || data.code === 0)) {
        showReport(data);
        return;
      }
      if (data?.msg === 'pending' || data?.status === 'processing') {
        attempts++;
        if (attempts < CONFIG.pollMaxAttempts) {
          setTimeout(poll, CONFIG.pollInterval);
          return;
        }
      }
      showReport(data || {});
    } catch (err) {
      console.error(err);
      attempts++;
      if (attempts < CONFIG.pollMaxAttempts) {
        setTimeout(poll, CONFIG.pollInterval);
      } else {
        // 演示用：无接口时展示模拟数据
        showReport({
          sentiment: { joy: 0.6, sadness: 0.1, anger: 0.05, fear: 0.1, surprise: 0.15, neutral: 0.5 },
          strategy_tags: ['提问', '鼓励', '引导'],
          avg_sentence_length: 5.2,
          vocabulary_richness: 0.78,
          summary: '报告接口尚未就绪，此为模拟数据。请配置 reportApiUrl 并对接王司鼎提供的分析接口。'
        });
      }
    }
  };

  poll();
}

document.addEventListener('DOMContentLoaded', loadReport);
