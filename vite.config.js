import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  /** 相对路径，便于 dist 放在任意子目录下访问；若需绝对子路径可改为如 '/source/TN_web/' */
  const base = './'

  /** 仅当设置 VITE_REPORT_PROXY_TARGET 时启用 /api/report 开发代理（避免写死第三方地址） */
  const reportTarget = (env.VITE_REPORT_PROXY_TARGET || '').trim().replace(/\/$/, '')
  /** 转发到上游的路径；默认 /v1/chat/completions */
  const _rp = env.VITE_REPORT_PROXY_PATH || '/v1/chat/completions'
  const reportPath = _rp.startsWith('/') ? _rp : '/' + _rp

  const reportProxy = reportTarget
    ? {
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
    : {}

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
