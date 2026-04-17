import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import crypto from 'node:crypto'

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function sha256Hex(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex')
}

function hmacSha256(key, str, encoding) {
  return crypto.createHmac('sha256', key).update(str, 'utf8').digest(encoding)
}

function createDescribeStorageCredentialMiddleware(env) {
  const secretId = (env.VITE_ADP_SECRET_ID || '').trim()
  const secretKey = (env.VITE_ADP_SECRET_KEY || '').trim()
  const region = (env.VITE_ADP_REGION || 'ap-guangzhou').trim()
  const endpoint = (env.VITE_ADP_OPENAPI_ENDPOINT || 'https://lke.tencentcloudapi.com').replace(/\/$/, '')

  return async (req, res, next) => {
    if (req.url !== '/api/describe-storage-credential' || req.method !== 'POST') return next()
    if (!secretId || !secretKey) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(
        JSON.stringify({
          error: 'missing_credentials',
          message: '缺少 VITE_ADP_SECRET_ID / VITE_ADP_SECRET_KEY',
        })
      )
      return
    }

    try {
      const bodyRaw = (await readRequestBody(req)).toString('utf-8')
      let payload = {}
      try {
        payload = bodyRaw ? JSON.parse(bodyRaw) : {}
      } catch (_) {
        payload = {}
      }
      const body = JSON.stringify({
        BotBizId: payload.BotBizId,
        FileType: payload.FileType || 'bin',
        IsPublic: payload.IsPublic === true,
        TypeKey: payload.TypeKey || 'offline',
      })

      const service = 'lke'
      const action = 'DescribeStorageCredential'
      const version = '2023-11-30'
      const algorithm = 'TC3-HMAC-SHA256'
      const host = endpoint.replace(/^https?:\/\//, '')
      const timestamp = Math.floor(Date.now() / 1000)
      const date = new Date(timestamp * 1000).toISOString().slice(0, 10)

      const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`
      const signedHeaders = 'content-type;host'
      const hashedRequestPayload = sha256Hex(body)
      const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${hashedRequestPayload}`
      const credentialScope = `${date}/${service}/tc3_request`
      const hashedCanonicalRequest = sha256Hex(canonicalRequest)
      const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${hashedCanonicalRequest}`
      const secretDate = hmacSha256(`TC3${secretKey}`, date)
      const secretService = hmacSha256(secretDate, service)
      const secretSigning = hmacSha256(secretService, 'tc3_request')
      const signature = hmacSha256(secretSigning, stringToSign, 'hex')
      const authorization = `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

      const upstreamRes = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Host: host,
          Authorization: authorization,
          'X-TC-Action': action,
          'X-TC-Timestamp': String(timestamp),
          'X-TC-Version': version,
          'X-TC-Region': region,
        },
        body,
      })

      const upstreamText = await upstreamRes.text()
      res.statusCode = upstreamRes.status
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(upstreamText)
    } catch (e) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(
        JSON.stringify({
          error: 'proxy_exception',
          message: e && e.message ? e.message : String(e),
        })
      )
    }
  }
}

function createCosUploadProxyMiddleware() {
  return async (req, res, next) => {
    if (req.url !== '/api/cos-upload' || req.method !== 'POST') return next()
    try {
      const uploadUrl = String(req.headers['x-upload-url'] || '').trim()
      if (!uploadUrl) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'missing_upload_url', message: '缺少 x-upload-url 请求头' }))
        return
      }

      const contentType = String(req.headers['content-type'] || 'application/octet-stream')
      const bodyBuffer = await readRequestBody(req)

      const upstreamRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
        },
        body: bodyBuffer,
      })
      const upstreamText = await upstreamRes.text()
      res.statusCode = upstreamRes.status
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(
        JSON.stringify({
          ok: upstreamRes.ok,
          status: upstreamRes.status,
          contentType: String(upstreamRes.headers.get('Content-Type') || ''),
          body: upstreamText || '',
        })
      )
    } catch (e) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(
        JSON.stringify({
          error: 'cos_proxy_exception',
          message: e && e.message ? e.message : String(e),
        })
      )
    }
  }
}

function describeStorageCredentialPlugin(env) {
  const middleware = createDescribeStorageCredentialMiddleware(env)
  const cosUploadMiddleware = createCosUploadProxyMiddleware()
  return {
    name: 'describe-storage-credential-proxy',
    configureServer(server) {
      server.middlewares.use(middleware)
      server.middlewares.use(cosUploadMiddleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
      server.middlewares.use(cosUploadMiddleware)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  /** 相对路径，便于 dist 放在任意子目录下访问；若需绝对子路径可改为如 '/source/TN_web/' */
  const base = './'

  /** 报告接口真实地址（浏览器直连会 CORS，开发时用 /api/report 走下方代理） */
  const reportTarget = (env.VITE_REPORT_PROXY_TARGET || 'https://agent.orangeblog.us.kg').replace(/\/$/, '')
  /** 转发到上游的路径；默认 /v1/chat/completions */
  const _rp = env.VITE_REPORT_PROXY_PATH || '/v1/chat/completions'
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
    plugins: [vue(), describeStorageCredentialPlugin(env)],
    server: {
      proxy: reportProxy,
    },
    preview: {
      proxy: reportProxy,
    },
  }
})
