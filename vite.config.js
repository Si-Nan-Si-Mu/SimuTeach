import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  /** 相对路径，便于 dist 放在任意子目录下访问；若需绝对子路径可改为如 '/source/TN_web/' */
  const base = './'

  /** 报告接口真实地址（浏览器直连会 CORS，开发时用 /api/report 走下方代理） */
  const reportTarget = (env.VITE_REPORT_PROXY_TARGET || 'https://agent.orangeblog.us.kg:8000').replace(/\/$/, '')
  /** 转发到上游的路径；默认可用根路径 /（与当前后端一致，不再使用 /v1/chat/completions） */
  const _rp = env.VITE_REPORT_PROXY_PATH || '/'
  const reportPath = _rp.startsWith('/') ? _rp : '/' + _rp

  const reportProxy = {
    '/api/report': {
      target: reportTarget,
      changeOrigin: true,
      secure: true,
      rewrite: (path) => {
        const rest = path.replace(/^\/api\/report/, '')
        if (rest === '' || rest === '/') return reportPath
        return rest
      },
    },
  }

  return {
    base,
    plugins: [vue()],
    server: {
      proxy: reportProxy,
    },
    preview: {
      proxy: reportProxy,
    },
  }
})
