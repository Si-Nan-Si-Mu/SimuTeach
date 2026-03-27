# 课堂模拟前端资源（自包含）

本目录从原 `jyznt/.../front` **拷贝**而来，供 Vue 工程直接引用。**删除整个 `jyznt` 文件夹后**，只要保留 `vendor/front`，应用仍可构建与运行。

| 文件 | 用途 |
|------|------|
| `css/style.css` | 聊天/侧栏等样式（与旧版一致） |
| `js/echarts.min.js` | 情绪雷达图 |
| `js/workflow.js` | 腾讯云工作流 SSE（`WorkflowClient` 等，挂到 `window`） |

> 若修改 `workflow.js` 中的 endpoint / key，请自行注意密钥安全，必要时改用环境变量注入。
