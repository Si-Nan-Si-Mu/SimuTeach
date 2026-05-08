# SimuTeach 后端对接规范

本文档描述 **SimuTeach 前端（Vue + Vite）** 在配置 `VITE_BACKEND_BASE_URL` 时，对统一后端的 **URL 约定、鉴权、请求体与响应格式** 要求。默认 **单次 JSON 响应**（`Accept: application/json`，请求体 `stream: disable`），不再建立 SSE 长连接；仅在 `VITE_BACKEND_USE_JSON_RESPONSE=false` 时前端仍可按 SSE 解析（兼容旧腾讯云 qbot）。后端可按自身架构调整路由前缀，只需与 `BASE` 与 `VITE_BACKEND_PATH_*` 对齐。

**实现参考（源码）**

- 注入与 URL 拼接：`src/classroom-workflow-inject.js`
- 对话 / 课堂 / 报告客户端：`vendor/front/js/workflow.js`
- 教学文档分析：`src/components/TeachingDocAnalysis.vue`

---

## 1. 前端可配置项（环境变量）

| 变量 | 含义 | 示例 |
|------|------|------|
| `VITE_BACKEND_BASE_URL` | 后端根：完整 URL 或同源路径前缀（无尾 `/`） | `http://127.0.0.1:8787`、`/api` |
| `VITE_BACKEND_API_KEY` | 可选。非空时所有对话类请求带 `Authorization: Bearer <值>`；报告请求同时见下文 | 服务端颁发的令牌 |
| `VITE_BACKEND_PATH_SPECIAL` | 专项模拟对话（相对 BASE） | 默认 `/simu/special/chat` |
| `VITE_BACKEND_PATH_CLASSROOM` | 课堂模拟对话 | 默认 `/simu/classroom/chat` |
| `VITE_BACKEND_PATH_REPORT` | 训练报告 HTTP | 默认 `/simu/report`；若需 `/api/report` 可设 `BASE=/api` 且 `PATH_REPORT=/report` |
| `VITE_BACKEND_PATH_DOC` | 文档分析（仅 `TeachingDocAnalysis`） | 默认 `/simu/doc/chat` |
| `VITE_BACKEND_USE_JSON_RESPONSE` | 为 `false` 时专项/课堂/文档分析恢复 **SSE**（`Accept: text/event-stream`，`stream: enable`） | 未配置 `BASE` 时默认 SSE；**已配置 `BASE` 时默认 JSON**（等价于 true） |
| `VITE_BACKEND_DOC_QBOT_BODY` | 文档分析是否使用与下文章节 4 相同的「qbot 形」JSON | 默认 `true`；`false` 时为简化 JSON（见 5） |

未设置 `VITE_BACKEND_BASE_URL` 时，前端走旧版多环境变量路径，**不在本文档范围**。

**拼接规则**：最终 URL = `trimSlash(BASE) + (PATH 以 `/` 开头 ? PATH : '/' + PATH)`。

---

## 2. 通用约定

### 2.1 方法与安全

- 下列接口均为 **`POST`**。
- 生产环境建议 **HTTPS**；与站点 **同源** 时使用相对路径 `BASE=/api` 可避免浏览器 CORS 预检复杂度。

### 2.2 请求头（对话 / 课堂 / 文档分析）

| 头 | 必填 | 说明 |
|----|------|------|
| `Content-Type` | 是 | `application/json; charset=utf-8` |
| `Accept` | 建议 | **默认 JSON 模式**：`application/json`。仅当 `VITE_BACKEND_USE_JSON_RESPONSE=false` 时为 `text/event-stream; charset=utf-8` |
| `Authorization` | 条件 | 当 `VITE_BACKEND_API_KEY` 非空：`Bearer <VITE_BACKEND_API_KEY>` |

### 2.3 字符编码

- 请求体为 **UTF-8** JSON；字符串建议 NFC 规范化（前端会对部分字段做 NFC）。

### 2.4 HTTP 错误

- 非 2xx 时，前端会尝试将响应体解析为 JSON，读取 `error.message` 或 `message` 展示；否则截取纯文本前 200 字符。
- 建议错误响应：`Content-Type: application/json`，形如  
  `{"error":{"message":"可读说明"},"message":"可读说明"}`。

---

## 3. 专项模拟对话

- **默认路径**：`{BASE}/simu/special/chat`（可配置）。
- **请求体**：见 **第 6 节「qbot 形对话请求体」**。
- **典型 `custom_variables`（由前端传入，均为字符串）**：含 `role`（如 `teacher`）、业务扩展字段等；**不要**把 `evaluation: true` 留在 `custom_variables`（前端会抽出并写入顶层 `evaluation`）。

### 3.1 响应（默认 JSON）

**A. 单次 JSON（当前默认，配置 `VITE_BACKEND_BASE_URL` 且未将 `VITE_BACKEND_USE_JSON_RESPONSE` 设为 `false`）**

- `Content-Type` 建议 `application/json`（前端亦按文本尝试 `JSON.parse`）。
- 正文提取与 **情绪**：与历史 SSE 最后一帧规则一致——支持 **Chat Completions 形**（含 `choices[0].message.content`）、`x-debug` / `x_debug` 等（见第 7 节）。

**B. SSE（兼容，仅当 `VITE_BACKEND_USE_JSON_RESPONSE=false`）**

- `Content-Type` 含 `text/event-stream` 或 `application/stream+json`。
- 帧格式见 **第 7 节「SSE 解析与展示」**。

### 3.2 人格切换

- 前端会额外向 **同一专项 URL** 发送 `POST`，`content` / `message` 为固定短串「人格切换」，`custom_variables` 含 `role: "persona_switch"` 与 `model: "<人格名>"`。
- 后端可返回短 JSON 或空 body；JSON 模式下同样使用 `Accept: application/json`。前端对人格切换响应**不做**主对话区强依赖展示。

---

## 4. 课堂模拟对话

- **默认路径**：`{BASE}/simu/classroom/chat`（可配置）。
- **请求体**：同第 6 节，且前端保证：
  - 顶层 **`model`**：若 `custom_variables` 未提供可用 model，则默认 **`"李大志"`**。
  - 顶层 **`proactive`**：`boolean`，仅课堂使用；`true` 表示主动轮询类场景。
  - `custom_variables` 至少含 `role: "teacher"`、`channel: "classroom"`，以及业务侧 `extra` 合并字段。

### 4.1 响应

- 与 **3.1** 相同：默认 JSON；可选 SSE（环境变量见上）。

---

## 5. 教学文档分析

- **默认路径**：`{BASE}/simu/doc/chat`（可配置）。
- 当 `VITE_BACKEND_DOC_QBOT_BODY !== 'false'`（默认）：请求体同 **第 6 节**，且：
  - `content` / `message` **仅为文件 URL 字符串**（无其它文案）。
  - `custom_variables` 含 `file_url`、`file_name`、`role`、`trigger` 等（与 `.env` 中 `VITE_DOC_*` 一致时可变）。
  - 后端代理模式下前端可能将 **`bot_app_key` 置空**，由服务端补全上游密钥。
- 当 **`VITE_BACKEND_DOC_QBOT_BODY=false`**：前端走「通用」分支，请求体为简化 JSON（至少含 `session_id`、`message`、`file_url` 及字符串化后的自定义字段），**不再保证**与第 6 节字段完全一致；后端需按该分支自行约定。

### 5.1 响应

- **默认**与专项一致：`Accept: application/json`，单次 JSON 体（`extractWorkflowText` 等解析）。
- `VITE_BACKEND_USE_JSON_RESPONSE=false` 时仍可返回 SSE；前端会按行解析 `data:`（见 `TeachingDocAnalysis.vue` 内 `sendDocWorkflowWithFileUrl`）。

### 5.2 上传与凭证（非 BASE 路径）

- 文档上传仍可能请求 `VITE_DOC_STORAGE_CREDENTIAL_URL`、`VITE_DOC_COS_UPLOAD_PROXY_URL`、`VITE_DOC_FILE_UPLOAD_URL` 等（见 `.env.example`），**不属于** `VITE_BACKEND_BASE_URL` 的默认四条路由；若全部由自建后端提供，请在部署文档中单独列出这些 URL。

---

## 6. qbot 形对话请求体（JSON）

以下为 `vendor/front/js/workflow.js` 中 `buildRequestBodyWithConfig` 生成的对象，后端可原样转发腾讯云或自行消费。

| 字段 | 类型 | 说明 |
|------|------|------|
| `request_id` | string | ≤255；前端生成 |
| `content` | string | 用户侧正文（专项/课堂为教师发言；文档分析为文件 URL） |
| `message` | string | 与 `content` 相同 |
| `session_id` | string | 2–64，仅 `[a-zA-Z0-9_-]` |
| `bot_app_key` | string | 浏览器侧后端模式常为 **空字符串**；由网关或服务注入真实密钥 |
| `visitor_biz_id` | string | 访客 ID，同上字符集与长度限制 |
| `incremental` | boolean | 固定 `true` |
| `streaming_throttle` | number | 如 `10` |
| `visitor_labels` | array | 常为 `[]` |
| `evaluation` | boolean | 报告类意图为 `true`，普通对话 `false` |
| `custom_variables` | object | **值均为 string**（对象/数组会被 `JSON.stringify`） |
| `search_network` | string | 如 `disable` |
| `stream` | string | JSON 模式下前端发 **`disable`**；SSE 兼容模式下为 **`enable`** |
| `workflow_status` | string | 如 `enable` / `disable`（前端可经注入配置） |
| `tcadp_user_id` | string | 常为空串 |
| `model` | string | 可选顶层字段；课堂缺省为 `李大志` |
| `proactive` | boolean | **仅课堂**请求体可能出现 |

---

## 7. 响应解析与展示（前端行为摘要）

### 7.1 单次 JSON

- 与 SSE 路径共用 `_parseJsonReplyBodyText`：优先从完整 JSON 中解析助手正文并更新 **x-debug 情绪**（若存在）。

### 7.2 SSE（可选）

在 **`VITE_BACKEND_USE_JSON_RESPONSE=false`** 时，后端实现 SSE 建议兼容下列行为：

1. **事件行**：`event: reply` 或与 JSON 内 `type` 字段同时使用；`type === "error"` 或 `event: error` 会走错误提示。
2. **`is_from_self`**：payload 上为真时，前端 **忽略**（视为 echo）。
3. **正文提取优先级**（节选）：
   - 若 `content`（或嵌套 payload）为 **JSON 字符串**，且可解析为 Chat Completions 形，则取 `choices[0].message.content`，并识别 **`x-debug` / `x_debug`** 中的情绪字段（见下）。
   - 否则回退到 `text`、`reply`、`message`、`payload.content`、`result.output` 等。
4. **情绪与雷达**：若解析后的 JSON 含  
   `x-debug.emotion`、`x-debug.emotion_state`（或 `x_debug`），前端会更新柱状图与人格雷达；字段示例：
   - `emotion.intensity`（0–1）
   - `emotion_state.arousal`（0–1）
   - `emotion_state.valence`（-1–1）

**错误帧示例（概念）**：`data: {"type":"error","error":{"message":"..."}}`  
或 `event: error` 与同结构 `data`。

---

## 8. 训练报告

- **默认路径**：`{BASE}/simu/report`（可配置）。
- **方法**：`POST`
- **请求头**：
  - `Content-Type: application/json; charset=utf-8`
  - `Authorization: Bearer <VITE_BACKEND_API_KEY>`（与 `httpApiKey` 同源；**无密钥时前端不发请求**）

### 8.1 请求体（JSON）

前端构造 **类 Chat Completions** 对象（`sendTrainingReport`）：

| 字段 | 说明 |
|------|------|
| `model` | 优先来自 `VITE_REPORT_CHAT_MODEL`，否则 meta 中学生名，再默认 `李大志` |
| `messages` | 仅一条 `{"role":"user","content": "<VITE_REPORT_USER_MESSAGE 或默认「请生成教学训练报告。」>"}` |
| `evaluation` | 固定 `true` |
| `api_key` | 与 Bearer 相同值的副本（历史兼容）；**后端可只校验其一** |
| `temperature` / `top_p` / `max_tokens` / `stream` / `user` | 若对应 `VITE_REPORT_*` 配置存在则写入 |

> **说明**：当前实现中，`messages[0].content` **不包含**完整训练对话原文；若业务需要从会话生成报告，应由后端根据 `session_id`、用户身份或另行传递的 ID 拉取存储。

### 8.2 响应

- HTTP 2xx，body 为 **JSON**（或可解析的文本）；前端将 `JSON.parse` 后的对象交给上层 UI；非 2xx 时前端丢弃并打日志。

---

## 9. 后端路由映射示例

以下仅为 **约定示例**，可通过环境变量改路径：

| 能力 | 浏览器最终 URL 示例（`BASE=/api`） |
|------|-----------------------------------|
| 专项对话 | `POST /api/simu/special/chat` |
| 课堂对话 | `POST /api/simu/classroom/chat` |
| 训练报告 | `POST /api/simu/report` |
| 文档分析 | `POST /api/simu/doc/chat` |

网关可将 `/api` 反代到内网 `http://simu-backend:8787/`，由容器间网络访问，无需浏览器直连内网地址。

---

## 10. 版本与兼容

- 本文档与仓库中 `vendor/front/js/workflow.js`、`src/classroom-workflow-inject.js` 行为一致；若前端升级导致字段增减，请同步更新本文档版本号。

**文档版本**：1.1（默认 JSON 响应；SSE 为可选兼容）
