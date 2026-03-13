# 师范生试讲训练系统 - 前端

## 文件结构

```
frontend/
├── index.html      # 主对话页
├── report.html     # 报告页
├── styles.css      # 样式
├── config.js       # API URL 配置（薛冰睿提供后在此修改）
├── app.js          # 对话页逻辑
├── report.js       # 报告页逻辑
└── README.md
```

## 本地运行

因涉及 `fetch` 跨域，建议用本地 HTTP 服务打开：

```bash
# 方式一：Python
cd frontend && python -m http.server 8080

# 方式二：Node
npx serve frontend -p 8080
```

浏览器访问 `http://localhost:8080`。

## 配置

编辑 `config.js` 填入实际工作流 URL：

- `chatApiUrl`：对话接口（薛冰睿提供）
- `reportApiUrl`：报告接口（王司鼎提供）

## 角色说明

| 角色   | role_id    | 对应配置           |
|--------|------------|--------------------|
| 王小乐 | naughty    | config_zhangyiming |
| 林小静 | shy        | config_linnuan     |
| 李大志 | struggling | config_lidazhi     |
