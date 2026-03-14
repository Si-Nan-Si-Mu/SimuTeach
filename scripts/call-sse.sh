#!/usr/bin/env bash
# 腾讯云智能体 HTTP SSE 对话接口 - curl 调用示例
# 文档：https://cloud.tencent.com/document/product/1759/105561
#
# 使用前请先设置应用密钥（二选一）：
#   export BOT_APP_KEY="你的bot_app_key"
#   或：./call-sse.sh "你的bot_app_key"
#
# 可选环境变量：
#   CONTENT          - 发送内容，默认 "你好"
#   SESSION_ID       - 会话 ID（2-64 位字母数字_-），默认自动生成 UUID 风格
#   VISITOR_BIZ_ID   - 访客 ID，默认与 SESSION_ID 相同

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
URL="https://wss.lke.cloud.tencent.com/v1/qbot/chat/sse"

# 应用密钥：环境变量 > 参数 > 本地文件 scripts/.bot_app_key（与 js/workflow.js 中 botAppKey 保持一致）
if [ -n "$BOT_APP_KEY" ]; then
  : # 已由环境变量提供
elif [ -n "$1" ]; then
  BOT_APP_KEY="$1"
elif [ -f "$SCRIPT_DIR/.bot_app_key" ]; then
  BOT_APP_KEY=$(grep -v '^#' "$SCRIPT_DIR/.bot_app_key" | grep -v '^[[:space:]]*$' | head -1 | tr -d '\r\n' | head -c 256)
fi
if [ -z "$BOT_APP_KEY" ]; then
  echo "用法: BOT_APP_KEY=xxx $0  或  $0 <bot_app_key>"
  echo "或复制 scripts/.bot_app_key.example 为 scripts/.bot_app_key 并填入 bot_app_key"
  echo "（与 js/workflow.js 中 WORKFLOW_CONFIG.botAppKey 保持一致）"
  exit 1
fi

# 会话 ID：2-64 位，仅允许 [a-zA-Z0-9_-]
SESSION_ID="${SESSION_ID:-$(cat /dev/urandom 2>/dev/null | tr -dc 'a-zA-Z0-9_-' | fold -w 32 | head -n 1)}"
[ -z "$SESSION_ID" ] && SESSION_ID="sess-$(date +%s)-local"

# 访客 ID
VISITOR_BIZ_ID="${VISITOR_BIZ_ID:-$SESSION_ID}"

# 请求 ID（建议必填，便于排查）
REQUEST_ID="req-${SESSION_ID}-$(date +%s)"

# 发送内容（含特殊字符时建议用环境变量并配合 jq，或保持简短）
CONTENT="${CONTENT:-你好}"

# 按文档 1.1 参数说明构造 body；有 jq 时用 jq 转义 content，否则简单拼接（内容勿含双引号/换行）
if command -v jq >/dev/null 2>&1; then
  BODY=$(jq -n \
    --arg request_id "$REQUEST_ID" \
    --arg content "$CONTENT" \
    --arg session_id "$SESSION_ID" \
    --arg bot_app_key "$BOT_APP_KEY" \
    --arg visitor_biz_id "$VISITOR_BIZ_ID" \
    '{ request_id: $request_id, content: $content, session_id: $session_id, bot_app_key: $bot_app_key, visitor_biz_id: $visitor_biz_id, incremental: true, streaming_throttle: 10, visitor_labels: [], custom_variables: {}, search_network: "disable", stream: "enable", workflow_status: "enable" }')
else
  BODY=$(cat <<EOF
{
  "request_id": "$REQUEST_ID",
  "content": "$CONTENT",
  "session_id": "$SESSION_ID",
  "bot_app_key": "$BOT_APP_KEY",
  "visitor_biz_id": "$VISITOR_BIZ_ID",
  "incremental": true,
  "streaming_throttle": 10,
  "visitor_labels": [],
  "custom_variables": {},
  "search_network": "disable",
  "stream": "enable",
  "workflow_status": "enable"
}
EOF
)
fi

echo "请求地址: $URL"
echo "session_id: $SESSION_ID"
echo "content: $CONTENT"
echo "---"
curl -N -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  --data-raw "$BODY"
