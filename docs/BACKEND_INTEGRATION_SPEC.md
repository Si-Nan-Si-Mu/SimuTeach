# SimuTeach 后端对接规范

本文档描述 **SimuTeach 前端（Vue + Vite）** 在配置 `VITE_BACKEND_BASE_URL` 时，对统一后端的 **URL 约定、鉴权、请求体与响应格式**。默认 **单次 JSON**（`Accept: application/json`，请求体 `stream: disable`）；仅在 `VITE_BACKEND_USE_JSON_RESPONSE=false` 时按 **SSE** 解析。后端可自行调整路由前缀，与 `BASE` 及 `VITE_BACKEND_PATH_*` 对齐即可。

### 后端同学可先看这三步

1. 在 `.env.local` 配置 **`VITE_BACKEND_BASE_URL`**（及可选 **`VITE_BACKEND_API_KEY`**），复制模板见仓库 **`.env.example`**。  
2. 按 **§9** 默认路径实现 `POST` 接口；文档分析默认 **一步** `multipart`（§5.1），不需要浏览器再走对象存储凭证。  
3. 对话与文档第二步的请求 JSON 见 **§6**；响应形状与情绪字段见 **§7**。

**实现参考（源码）**

- 注入与 URL 拼接：`src/classroom-workflow-inject.js`
- 专项 / 课堂 / 报告 HTTP 客户端：`vendor/front/js/workflow.js`
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
| `VITE_BACKEND_PATH_DOC` | 文档分析 **两步模式**之第二步（JSON，见 §6 / §5.3） | 默认 `/simu/doc/chat` |
| `VITE_BACKEND_PATH_DOC_UPLOAD` | **两步模式**之第一步（`multipart` 仅上传） | 默认 `/simu/doc/upload` |
| `VITE_BACKEND_PATH_DOC_ANALYZE` | **一步模式**：`multipart` 上传并返回分析 | 默认 `/simu/doc/analyze` |
| `VITE_BACKEND_PATH_DOC_STORAGE` | （可选）存储凭证，仅预签名上传等特殊部署 | 默认 `/simu/doc/storage-credential` |
| `VITE_BACKEND_PATH_DOC_COS_PROXY` | （可选）经后端转发 PUT，避免浏览器直传 CORS | 默认 `/simu/doc/cos-upload` |
| `VITE_BACKEND_DOC_SINGLE_STEP` | 为 `false` 时改为**两步**（先 `upload` 再 `chat`） | 配置 `BASE` 时默认 **一步**（未写 `false` 即一步） |
| `VITE_BACKEND_USE_JSON_RESPONSE` | 为 `false` 时专项/课堂/文档分析恢复 **SSE**（`Accept: text/event-stream`，`stream: enable`） | 未配置 `BASE` 时默认 SSE；**已配置 `BASE` 时默认 JSON**（等价于 true） |
| `VITE_REPORT_PROXY_TARGET` | （可选）仅 **本地 `npm run dev`**：为 `/api/report` 配置反向代理的上游根 URL（无尾 `/`） | 未设置时不注册该代理；见 **§10** |

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
- **请求体**：见 **第 6 节「对话 JSON 请求体」**。
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
- **请求体**：同第 6 节；前端另外保证：
  - 顶层 **`model`**：若 `custom_variables` 未提供可用 model，则默认 **`"李大志"`**。
  - 顶层 **`proactive`**：`boolean`，仅课堂使用；`true` 表示主动轮询类场景。
  - `custom_variables` 至少含 `role: "teacher"`、`channel: "classroom"`，以及业务侧 `extra` 合并字段。

### 4.1 响应

- 与 **3.1** 相同：默认 JSON；可选 SSE（环境变量见上）。

---

## 5. 教学文档分析（统一后端 · **无需凭证**）

配置 `VITE_BACKEND_BASE_URL` 且 **`VITE_BACKEND_DOC_SINGLE_STEP` 未设为 `false`** 时，前端默认 **一步完成**：**单次 `multipart` 请求**上传文件并取回分析结果，**不要求**先拿 `file_url` 再调第二个接口。

若你希望后端仍按「先存对象再传 URL」拆分，可设 **`VITE_BACKEND_DOC_SINGLE_STEP=false`**，则走 **§5.2 / §5.3** 的两步约定。

---

### 5.1 一步模式（默认）：上传并分析

| 项 | 约定 |
|----|------|
| **方法 / 路径** | `POST` `{BASE}{VITE_BACKEND_PATH_DOC_ANALYZE 或默认 /simu/doc/analyze}` |
| **Content-Type** | `multipart/form-data`（由浏览器自动带 boundary） |
| **表单字段** | **`file`**（必填）：文件二进制；**`message`**（可选）：分析提示语，前端会传如「请诊断这份教学材料：xxx.docx」；**`file_name`**（可选）：原始文件名 |
| **附加字段** | 若 `.env` 中配置了 `VITE_DOC_SSE_ROLE`、`VITE_DOC_SSE_TRIGGER`、`VITE_DOC_SSE_CHARACTER_ID`、`VITE_DOC_SSE_MODEL_NAME`、`VITE_DOC_WORKFLOW_ENTRY`，前端会以同名表单项一并提交（均为文本） |
| **鉴权** | 若配置了 `VITE_BACKEND_API_KEY`：`Authorization: Bearer <密钥>` |
| **Accept** | 默认 `application/json`（与 `VITE_BACKEND_USE_JSON_RESPONSE` 一致）；为 `false` 时可返回 SSE，`data:` 行解析规则同下 |

**响应**  
与 **§5.5** 相同：JSON 优先（`extractWorkflowText` 可识别的结构）；或 SSE 分片（在关闭 JSON 模式时）。

---

### 5.2 两步模式：仅上传（`VITE_BACKEND_DOC_SINGLE_STEP=false` 时使用第一步）

### 5.2.1 文件上传

| 项 | 约定 |
|----|------|
| **方法 / 路径** | `POST` `{BASE}{VITE_BACKEND_PATH_DOC_UPLOAD 或默认 /simu/doc/upload}` |
| **Content-Type** | `multipart/form-data` |
| **表单字段** | **`file`**：二进制文件本体（前端字段名固定为 `file`） |
| **鉴权** | 若配置了 `VITE_BACKEND_API_KEY`：`Authorization: Bearer <密钥>` |

**响应（HTTP 200，JSON）**  
前端用 `pickUploadedUrl` 解析，**至少**在 JSON **根级或** `data` / `Response` 嵌套对象中提供以下 **任一字段名** 的 **字符串**（可公网或内网可访问的完整 URL）：

| 字段名（任一即可） |
|---------------------|
| `file_url`、`fileUrl`、`FileUrl`、`url`、`URL`、`download_url`、`downloadUrl` |

示例：

```json
{ "file_url": "https://api.example.com/static/uploads/abc.png" }
```

```json
{ "data": { "url": "https://cdn.example.com/doc/xyz.docx" } }
```

上传失败时返回非 2xx，body 建议含可读 `message` / `error.message`。

---

### 5.3 两步模式：提交分析（JSON）

| 项 | 约定 |
|----|------|
| **方法 / 路径** | `POST` `{BASE}{VITE_BACKEND_PATH_DOC 或默认 /simu/doc/chat}` |
| **Content-Type** | `application/json; charset=utf-8` |
| **Accept** | 默认 `application/json`（与 `VITE_BACKEND_USE_JSON_RESPONSE` 一致） |
| **鉴权** | 同 §5.2.1 |

请求体见 **第 6 节**。文档分析场景约定：

- **`content`**：上传接口返回的 **文件 URL**（可访问）。
- **`message`**：可与 `content` 相同，或为用户提示语（如「请诊断这份教学材料：xxx.docx」）。
- **`custom_variables`**（值均为 **string**）：至少常含 `file_url`、`file_name`、`role`、`trigger`；可选 `characterId`、`model`、`workflow_entry` 等（由 `TeachingDocAnalysis.vue` 与 `.env` 注入）。

后端据 URL 拉取文件并返回分析即可；**统一后端直传 / 一步模式不要求**浏览器再走存储凭证链路。

---

### 5.4 两步模式第二步（小结）

与 **§5.3**、**§6** 相同：前端只发一套 **最小对话 JSON**，无历史「工作流 / qbot」专有字段。

---

### 5.5 分析接口的响应（含一步模式）

- **默认 JSON**：`Content-Type` 建议 `application/json`；正文可被 `extractWorkflowText` 等解析（与专项对话类似，支持 Chat Completions 形、`x-debug` 等，见第 7 节）。
- **SSE**：仅当 `VITE_BACKEND_USE_JSON_RESPONSE=false` 时，可返回 `text/event-stream`，前端按 `data:` 行解析。

---

### 5.6 可选：存储凭证与 COS 转发（仅特殊部署）

仅当你将 `VITE_DOC_FILE_UPLOAD_URL` **留空**且仍走「预签名 PUT」上传时，才需要实现 `VITE_BACKEND_PATH_DOC_STORAGE`（存储凭证）与 `VITE_BACKEND_PATH_DOC_COS_PROXY`（浏览器经后端转发 PUT，避免 CORS）。**仓库内 Vite 开发服务器不再内置腾讯云签名中间件**；凭证与上传须由你的后端或显式配置的 URL 提供。

---

## 6. 对话 JSON 请求体（专项 / 课堂 / 文档第二步）

由 `vendor/front/js/workflow.js` 的 `buildRequestBodyWithConfig` 与 `TeachingDocAnalysis.vue` 的 `buildDocAnalyzeRequestBody` 生成，**统一最小字段集**如下（后端可直接消费，无需再适配第三方专有字段名）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `request_id` | string | ≤255；前端生成 |
| `session_id` | string | 2–64，仅 `[a-zA-Z0-9_-]` |
| `content` | string | 用户侧正文；文档分析场景为 **文件 URL** |
| `message` | string | 与正文一致或为用户提示；文档分析可与 `content` 不同 |
| `evaluation` | boolean | 报告类意图为 `true`；普通对话 / 文档分析一般为 `false`（勿把该键留在 `custom_variables`，前端会抽出到顶层） |
| `custom_variables` | object | **值均为 string**（对象/数组会先 `JSON.stringify`） |
| `stream` | string | JSON 模式：`disable`；`VITE_BACKEND_USE_JSON_RESPONSE=false` 时：`enable`（SSE） |
| `visitor_id` | string | **可选**；由 `VITE_*_VISITOR_BIZ_ID` / `VITE_DOC_VISITOR_BIZ_ID` 等非空时写入，字符清洗同 `session_id` 规则 |
| `model` | string | **可选**；课堂在缺省时前端会补 `"李大志"`；若来自 `custom_variables.model`，前端会提升到顶层且不再重复写入 `custom_variables` |
| `proactive` | boolean | **仅课堂**：`true` 表示主动轮询类场景 |

**已移除的前端字段**（若旧网关仍依赖，请在后端自行映射）：`bot_app_key`、`visitor_biz_id`、`workflow_status`、`incremental`、`tcadp_user_id`、`search_network` 等。

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

以下仅为 **约定示例**（`BASE=/api` 时）；路径均可通过 `VITE_BACKEND_PATH_*` 覆盖。

| 能力 | 浏览器最终 URL 示例 |
|------|---------------------|
| 专项对话 | `POST /api/simu/special/chat` |
| 课堂对话 | `POST /api/simu/classroom/chat` |
| 训练报告 | `POST /api/simu/report` |
| 文档分析（**默认一步**） | `POST /api/simu/doc/analyze`（`multipart/form-data`，字段 `file`） |
| 文档分析（**两步**：上传） | `POST /api/simu/doc/upload` |
| 文档分析（**两步**：分析） | `POST /api/simu/doc/chat`（JSON，见 §6） |

网关可将 `/api` 反代到内网（如 `http://simu-backend:8787/`），由服务端访问内网，无需浏览器直连。

---

## 10. 版本与兼容

- 本文档与 `vendor/front/js/workflow.js`、`src/classroom-workflow-inject.js`、`TeachingDocAnalysis.vue` 保持一致；字段有变时请同步改版本号并更新 **§1 / §6**。

**文档版本：1.5.1**（润色接入指引与路由表；正文约定同 1.5）

**本地开发 · 训练报告**：未配置 `VITE_BACKEND_BASE_URL` 时，若 `VITE_REPORT_HTTP_URL` 也为空，开发模式下报告请求会指向同源 **`/api/report`**。只有在 `.env` 中设置 **`VITE_REPORT_PROXY_TARGET`**（上游根 URL，无尾 `/`）时，Vite 才会为 `/api/report` 注册反向代理；否则请直接配置完整的 **`VITE_REPORT_HTTP_URL`**。
