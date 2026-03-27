/**
 * 须在 `import '../vendor/front/js/workflow.js'` 之前执行：
 * - window.__WORKFLOW_INJECT__        -> WORKFLOW_CONFIG（专项模拟）
 * - window.__REPORT_WORKFLOW_INJECT__ -> REPORT_WORKFLOW_CONFIG（训练报告）
 * - window.__CLASSROOM_WORKFLOW_INJECT__ -> CLASSROOM_WORKFLOW_CONFIG（课堂模拟）
 */
window.__WORKFLOW_INJECT__ = {
  botAppKey: import.meta.env.VITE_SPECIAL_BOT_APP_KEY || '',
  debug: import.meta.env.VITE_SPECIAL_WORKFLOW_DEBUG !== 'false',
  autoAppendReply: import.meta.env.VITE_SPECIAL_AUTO_APPEND_REPLY !== 'false',
  visitorBizId: import.meta.env.VITE_SPECIAL_VISITOR_BIZ_ID || '',
  proxyUrl: import.meta.env.VITE_SPECIAL_PROXY_URL || '',
  endpoint: import.meta.env.VITE_SPECIAL_ENDPOINT || '',
}

window.__REPORT_WORKFLOW_INJECT__ = {
  botAppKey: import.meta.env.VITE_REPORT_BOT_APP_KEY || '',
  debug: import.meta.env.VITE_REPORT_WORKFLOW_DEBUG !== 'false',
  visitorBizId: import.meta.env.VITE_REPORT_VISITOR_BIZ_ID || '',
  proxyUrl: import.meta.env.VITE_REPORT_PROXY_URL || '',
  endpoint: import.meta.env.VITE_REPORT_ENDPOINT || '',
  /**
   * 生成报告：HTTP JSON API
   * - 开发环境：若未配置或配置了 http(s) 外域 URL，一律改为同源 /api/report，由 Vite 代理（避免 CORS）
   * - 生产：用 VITE_REPORT_HTTP_URL，或默认外域（仍可能 CORS，需 Nginx 反代）
   */
  httpUrl: (function resolveReportHttpUrl() {
    const raw = (import.meta.env.VITE_REPORT_HTTP_URL || '').trim().replace(/\/$/, '')
    const prodFallback = 'https://agent.orangeblog.us.kg:8000'
    if (import.meta.env.DEV) {
      if (!raw || /^https?:\/\//i.test(raw)) {
        return '/api/report'
      }
      return raw
    }
    return (raw || prodFallback).replace(/\/$/, '')
  })(),
  /** 勿提交到 Git；Vite 会打进前端包，浏览器可见，生产环境建议走后端代理 */
  httpApiKey: import.meta.env.VITE_REPORT_HTTP_API_KEY || '',
  /** 报告 Chat Completions：model 字段；不填则用当前学生姓名，再默认「李大志」 */
  chatModel: import.meta.env.VITE_REPORT_CHAT_MODEL || '',
  chatTemperature: import.meta.env.VITE_REPORT_CHAT_TEMPERATURE,
  chatTopP: import.meta.env.VITE_REPORT_CHAT_TOP_P,
  chatMaxTokens: import.meta.env.VITE_REPORT_CHAT_MAX_TOKENS,
  chatStream: import.meta.env.VITE_REPORT_CHAT_STREAM,
  chatUser: import.meta.env.VITE_REPORT_CHAT_USER || '',
  /** 报告请求 messages[0].content，默认「请生成教学训练报告。」 */
  reportUserMessage: import.meta.env.VITE_REPORT_USER_MESSAGE || '',
}

window.__CLASSROOM_WORKFLOW_INJECT__ = {
  botAppKey: import.meta.env.VITE_CLASSROOM_BOT_APP_KEY || '',
  debug: import.meta.env.VITE_CLASSROOM_WORKFLOW_DEBUG !== 'false',
  visitorBizId: import.meta.env.VITE_CLASSROOM_VISITOR_BIZ_ID || '',
  proxyUrl: import.meta.env.VITE_CLASSROOM_PROXY_URL || '',
  endpoint: import.meta.env.VITE_CLASSROOM_ENDPOINT || '',
}
