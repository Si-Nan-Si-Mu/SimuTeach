/**
 * 全局请求封装 - 对接后端API
 */
const API_BASE = 'http://localhost:8080/api';

const request = {
  async get(url, params = {}) {
    const query = new URLSearchParams(params).toString();
    const fullUrl = query ? `${API_BASE}${url}?${query}` : `${API_BASE}${url}`;
    try {
      const res = await fetch(fullUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      return await res.json();
    } catch (e) {
      console.warn('[Request] GET failed, using local fallback:', e.message);
      return null;
    }
  },

  async post(url, data = {}) {
    try {
      const res = await fetch(`${API_BASE}${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return await res.json();
    } catch (e) {
      console.warn('[Request] POST failed, using local fallback:', e.message);
      return null;
    }
  },

  async sendMessage(characterId, message, trigger) {
    return this.post('/chat/send', { characterId, message, trigger });
  },

  async getEmotionData(characterId) {
    return this.get(`/emotion/${characterId}`);
  },

  async generateReport(sessionData) {
    return this.post('/report/generate', sessionData);
  }
};
