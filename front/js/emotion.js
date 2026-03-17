/**
 * 情绪分析仪表盘 - ECharts 可视化
 */
const EmotionDashboard = {
  chart: null,
  radarChart: null,
  emotionHistory: { joy: [], activation: [], anxiety: [] },
  timeLabels: [],
  tickCount: 0,

  init() {
    this.initLineChart();
    this.initRadarChart();
  },

  initLineChart() {
    const dom = document.getElementById('emotion-chart');
    if (!dom) return;
    this.chart = echarts.init(dom, null, { renderer: 'canvas' });

    const option = {
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(30,30,50,0.85)',
        borderColor: 'transparent',
        textStyle: { color: '#fff', fontSize: 12 }
      },
      legend: {
        data: ['愉悦度', '激活度', '焦虑度'],
        bottom: 0,
        textStyle: { color: '#8e99a4', fontSize: 11 },
        itemWidth: 12,
        itemHeight: 8
      },
      grid: {
        top: 10, right: 15, bottom: 35, left: 40
      },
      xAxis: {
        type: 'category',
        data: [],
        axisLine: { lineStyle: { color: '#dfe6e9' } },
        axisLabel: { color: '#8e99a4', fontSize: 10 },
        boundaryGap: false
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        splitLine: { lineStyle: { color: '#f0f0f0', type: 'dashed' } },
        axisLabel: { color: '#8e99a4', fontSize: 10 }
      },
      series: [
        {
          name: '愉悦度',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { width: 2.5, color: '#2ecc71' },
          itemStyle: { color: '#2ecc71' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(46,204,113,0.25)' },
              { offset: 1, color: 'rgba(46,204,113,0.02)' }
            ])
          },
          data: []
        },
        {
          name: '激活度',
          type: 'line',
          smooth: true,
          symbol: 'diamond',
          symbolSize: 6,
          lineStyle: { width: 2.5, color: '#3498db' },
          itemStyle: { color: '#3498db' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(52,152,219,0.25)' },
              { offset: 1, color: 'rgba(52,152,219,0.02)' }
            ])
          },
          data: []
        },
        {
          name: '焦虑度',
          type: 'line',
          smooth: true,
          symbol: 'triangle',
          symbolSize: 6,
          lineStyle: { width: 2.5, color: '#e74c3c' },
          itemStyle: { color: '#e74c3c' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(231,76,60,0.25)' },
              { offset: 1, color: 'rgba(231,76,60,0.02)' }
            ])
          },
          data: []
        }
      ],
      animationDuration: 500,
      animationEasing: 'cubicOut'
    };

    this.chart.setOption(option);
    window.addEventListener('resize', () => this.chart && this.chart.resize());
  },

  initRadarChart() {
    const dom = document.getElementById('personality-radar');
    if (!dom) return;
    this.radarChart = echarts.init(dom, null, { renderer: 'canvas' });
    window.addEventListener('resize', () => this.radarChart && this.radarChart.resize());
  },

  updateRadarChart(character) {
    if (!this.radarChart) return;
    const traits = character.traits;
    const option = {
      radar: {
        indicator: character.traitLabels.map(name => ({ name, max: 100 })),
        shape: 'polygon',
        splitNumber: 4,
        axisName: { color: '#636e72', fontSize: 11 },
        splitLine: { lineStyle: { color: '#dfe6e9' } },
        splitArea: { areaStyle: { color: ['rgba(255,255,255,0)', 'rgba(200,200,200,0.05)'] } },
        axisLine: { lineStyle: { color: '#dfe6e9' } }
      },
      series: [{
        type: 'radar',
        data: [{
          value: [traits.confidence, traits.expressiveness, traits.anxiety, traits.motivation, traits.socialSkill],
          name: character.name,
          lineStyle: { color: character.color, width: 2 },
          areaStyle: { color: character.color + '30' },
          itemStyle: { color: character.color },
          symbol: 'circle',
          symbolSize: 5
        }],
        animationDuration: 800,
        animationEasing: 'elasticOut'
      }]
    };
    this.radarChart.setOption(option, true);
  },

  updateBars(emotion) {
    Object.keys(EMOTION_LABELS).forEach(key => {
      const val = Math.max(0, Math.min(100, emotion[key]));
      const bar = document.getElementById(`bar-${key}`);
      const valEl = document.getElementById(`val-${key}`);
      if (bar) {
        bar.style.width = val + '%';
        bar.style.background = this.getBarGradient(key, val);
      }
      if (valEl) valEl.textContent = Math.round(val);
    });

    const status = getStatusLabel(emotion);
    const statusEl = document.getElementById('emotion-status');
    if (statusEl) {
      statusEl.textContent = status.label;
      statusEl.style.background = status.color + '18';
      statusEl.style.color = status.color;
      statusEl.style.borderColor = status.color + '40';
    }
  },

  getBarGradient(key, val) {
    const baseColor = EMOTION_LABELS[key].color;
    if (key === 'anxiety' && val > 70) return 'linear-gradient(90deg, #e74c3c, #c0392b)';
    if (key === 'joy' && val > 60) return 'linear-gradient(90deg, #2ecc71, #27ae60)';
    return `linear-gradient(90deg, ${baseColor}aa, ${baseColor})`;
  },

  pushHistory(emotion) {
    this.tickCount++;
    const label = `T${this.tickCount}`;
    this.timeLabels.push(label);

    Object.keys(this.emotionHistory).forEach(key => {
      this.emotionHistory[key].push(Math.round(Math.max(0, Math.min(100, emotion[key]))));
    });

    if (this.timeLabels.length > 15) {
      this.timeLabels.shift();
      Object.keys(this.emotionHistory).forEach(key => this.emotionHistory[key].shift());
    }

    if (this.chart) {
      this.chart.setOption({
        xAxis: { data: [...this.timeLabels] },
        series: [
          { data: [...this.emotionHistory.joy] },
          { data: [...this.emotionHistory.activation] },
          { data: [...this.emotionHistory.anxiety] }
        ]
      });
    }
  },

  resetHistory() {
    this.emotionHistory = { joy: [], activation: [], anxiety: [] };
    this.timeLabels = [];
    this.tickCount = 0;
    if (this.chart) {
      this.chart.setOption({
        xAxis: { data: [] },
        series: [{ data: [] }, { data: [] }, { data: [] }]
      });
    }
  }
};

// 暴露到全局，便于 workflow.js 通过 window.EmotionDashboard 进行情绪可视化更新
window.EmotionDashboard = EmotionDashboard;
