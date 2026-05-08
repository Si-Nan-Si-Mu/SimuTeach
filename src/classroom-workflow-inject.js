/**
 * 须在 `import '../vendor/front/js/workflow.js'` 之前执行。
 *
 * 模式 A（推荐）：配置 VITE_BACKEND_BASE_URL + VITE_BACKEND_API_KEY
 * - 专项 / 课堂 / 训练报告 均只请求你的后端；浏览器不再直连腾讯云 qbot SSE。
 * - BASE 可为完整 URL（http://127.0.0.1:8787）或同源前缀（/api）：与下方 PATH_* 拼接，由网关反代到容器。
 *
 * 模式 B（兼容）：不配置 BACKEND_BASE 时，仍可通过 VITE_SPECIAL_* / VITE_CLASSROOM_* / VITE_REPORT_* 自行指定 endpoint 与密钥（旧行为）。
 */
function trimSlash(s) {
  return String(s || '').replace(/\/+$/, '')
}

function joinBackendUrl(base, path) {
  const b = trimSlash(base)
  const p = String(path || '').trim()
  if (!p) return b
  const seg = p.startsWith('/') ? p : '/' + p
  return b + seg
}

const BACKEND_BASE = trimSlash((import.meta.env.VITE_BACKEND_BASE_URL || '').trim())
const BACKEND_API_KEY = (import.meta.env.VITE_BACKEND_API_KEY || '').trim()
/** 配置统一后端时默认走 JSON 单次响应（非 SSE）；设为 false 可恢复 Accept: text/event-stream */
const BACKEND_PREFER_JSON =
  BACKEND_BASE && import.meta.env.VITE_BACKEND_USE_JSON_RESPONSE !== 'false'
/** 未配置 BASE 时仅当显式 true 才启用 JSON 模式（旧版直连腾讯云多为 SSE） */
const LEGACY_PREFER_JSON = !BACKEND_BASE && import.meta.env.VITE_BACKEND_USE_JSON_RESPONSE === 'true'

/** 默认不带 /api 前缀，便于 BASE=/api 时得到 /api/simu/...；若服务挂在 8787 根路径下的 /api，可把 BASE 设为 http://127.0.0.1:8787/api */
const PATH_SPECIAL = (import.meta.env.VITE_BACKEND_PATH_SPECIAL || '/simu/special/chat').trim()
const PATH_CLASSROOM = (import.meta.env.VITE_BACKEND_PATH_CLASSROOM || '/simu/classroom/chat').trim()
const PATH_REPORT = (import.meta.env.VITE_BACKEND_PATH_REPORT || '/simu/report').trim()

if (BACKEND_BASE) {
  window.__WORKFLOW_INJECT__ = {
    apiKey: BACKEND_API_KEY,
    botAppKey: '',
    preferJsonResponse: BACKEND_PREFER_JSON,
    debug: import.meta.env.VITE_SPECIAL_WORKFLOW_DEBUG !== 'false',
    autoAppendReply: import.meta.env.VITE_SPECIAL_AUTO_APPEND_REPLY !== 'false',
    visitorBizId: import.meta.env.VITE_SPECIAL_VISITOR_BIZ_ID || '',
    proxyUrl: joinBackendUrl(BACKEND_BASE, PATH_SPECIAL),
    endpoint: '',
  }

  window.__CLASSROOM_WORKFLOW_INJECT__ = {
    apiKey: BACKEND_API_KEY,
    botAppKey: '',
    preferJsonResponse: BACKEND_PREFER_JSON,
    debug: import.meta.env.VITE_CLASSROOM_WORKFLOW_DEBUG !== 'false',
    visitorBizId: import.meta.env.VITE_CLASSROOM_VISITOR_BIZ_ID || '',
    proxyUrl: joinBackendUrl(BACKEND_BASE, PATH_CLASSROOM),
    endpoint: '',
  }

  window.__REPORT_WORKFLOW_INJECT__ = {
    apiKey: BACKEND_API_KEY,
    botAppKey: '',
    debug: import.meta.env.VITE_REPORT_WORKFLOW_DEBUG !== 'false',
    visitorBizId: import.meta.env.VITE_REPORT_VISITOR_BIZ_ID || '',
    proxyUrl: '',
    endpoint: '',
    httpUrl: joinBackendUrl(BACKEND_BASE, PATH_REPORT),
    httpApiKey: BACKEND_API_KEY,
    chatModel: import.meta.env.VITE_REPORT_CHAT_MODEL || '',
    chatTemperature: import.meta.env.VITE_REPORT_CHAT_TEMPERATURE,
    chatTopP: import.meta.env.VITE_REPORT_CHAT_TOP_P,
    chatMaxTokens: import.meta.env.VITE_REPORT_CHAT_MAX_TOKENS,
    chatStream: import.meta.env.VITE_REPORT_CHAT_STREAM,
    chatUser: import.meta.env.VITE_REPORT_CHAT_USER || '',
    reportUserMessage: import.meta.env.VITE_REPORT_USER_MESSAGE || '',
  }
} else {
  window.__WORKFLOW_INJECT__ = {
    botAppKey: import.meta.env.VITE_SPECIAL_BOT_APP_KEY || '',
    preferJsonResponse: LEGACY_PREFER_JSON,
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
    httpUrl: (function resolveReportHttpUrl() {
      const raw = (import.meta.env.VITE_REPORT_HTTP_URL || '').trim().replace(/\/$/, '')
      const prodFallback = 'https://agent.orangeblog.us.kg/v1/chat/completions'
      if (import.meta.env.DEV) {
        if (!raw || /^https?:\/\//i.test(raw)) {
          return '/api/report'
        }
        return raw
      }
      return (raw || prodFallback).replace(/\/$/, '')
    })(),
    httpApiKey: import.meta.env.VITE_REPORT_HTTP_API_KEY || '',
    chatModel: import.meta.env.VITE_REPORT_CHAT_MODEL || '',
    chatTemperature: import.meta.env.VITE_REPORT_CHAT_TEMPERATURE,
    chatTopP: import.meta.env.VITE_REPORT_CHAT_TOP_P,
    chatMaxTokens: import.meta.env.VITE_REPORT_CHAT_MAX_TOKENS,
    chatStream: import.meta.env.VITE_REPORT_CHAT_STREAM,
    chatUser: import.meta.env.VITE_REPORT_CHAT_USER || '',
    reportUserMessage: import.meta.env.VITE_REPORT_USER_MESSAGE || '',
  }

  window.__CLASSROOM_WORKFLOW_INJECT__ = {
    botAppKey: import.meta.env.VITE_CLASSROOM_BOT_APP_KEY || '',
    preferJsonResponse: LEGACY_PREFER_JSON,
    debug: import.meta.env.VITE_CLASSROOM_WORKFLOW_DEBUG !== 'false',
    visitorBizId: import.meta.env.VITE_CLASSROOM_VISITOR_BIZ_ID || '',
    proxyUrl: import.meta.env.VITE_CLASSROOM_PROXY_URL || '',
    endpoint: import.meta.env.VITE_CLASSROOM_ENDPOINT || '',
  }
}
