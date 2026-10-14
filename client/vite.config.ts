import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 本地 HTTPS（开发用）
 * ------------------------------------------------------------
 * 浏览器只在「HTTPS 或 localhost」下才给 getUserMedia 权限，
 * 牌桌的「按住说话」在手机上走局域网 IP（http://192.168.x.x:5180）
 * 属于不安全来源，拿不到麦克风。
 *
 * 证书用 `bash scripts/gen-dev-cert.sh` 生成后放在 client/.cert/。
 * 证书不存在就静默回落到 HTTP —— 没做语音调试的人不用被迫先生成证书。
 */
// 用 import.meta.url 而不是 __dirname：vite 8 的原生配置加载器不提供 __dirname
const thisDir = path.dirname(fileURLToPath(import.meta.url))
const certDir = path.resolve(thisDir, '.cert')
const certFile = path.join(certDir, 'dev-cert.pem')
const keyFile = path.join(certDir, 'dev-key.pem')
const hasCert = fs.existsSync(certFile) && fs.existsSync(keyFile)
// 只有 `npm run dev:https`（会设 DEV_HTTPS=1）时才启用，
// 平时 `npm run dev` 仍是普通 HTTP，不会被自签证书的「不安全」拦一道。
const useHttps = process.env.DEV_HTTPS === '1' && hasCert

if (process.env.DEV_HTTPS === '1' && !hasCert) {
  console.warn('\n[vite] 未找到开发证书，已回落到 HTTP。先执行: bash scripts/gen-dev-cert.sh\n')
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    ...(useHttps ? { https: { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) } } : {}),
    /**
     * 把后端流量代理到 vite 自己的端口。
     *
     * 为什么必须代理，而不是让前端直连 2567：
     * 页面是 https 时，浏览器禁止连非加密的 ws://（混合内容），
     * 而直连 wss://手机IP:2567 又需要手机再单独信任一次 2567 的证书
     * （而且后端此时是纯 HTTP，根本没有证书）。
     * 走代理后前后端同源同端口，手机只要放行 5180 这一个证书，
     * wss 由 vite 终结 TLS 再以明文转给本机 2567，后端不用任何改动。
     *
     * Colyseus SDK 把 endpoint 里的路径当成前缀，匹配请求走
     * /colyseus-ws/matchmake/*，房间 WebSocket 走
     * /colyseus-ws/<processId>/<roomId>。所以一条前缀规则就能同时
     * 覆盖 HTTP 与 WS 两种流量，转发前把前缀 rewrite 掉，
     * 后端收到的仍是它原本的路径，服务端零改动。
     */
    proxy: {
      '/colyseus-ws': {
        target: 'http://127.0.0.1:2567',
        ws: true,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/colyseus-ws/, ''),
      },
      // 监控面板与健康检查：方便直接用 https://<本机IP>:5180/health 自查
      '/colyseus': { target: 'http://127.0.0.1:2567', changeOrigin: true },
      '/health': { target: 'http://127.0.0.1:2567', changeOrigin: true },
    },
  },
  build: {
    // 默认 target 下 esbuild 会把 `@media (max-height: 480px)` 压成 CSS Media
    // Queries Level 4 的 range 语法 `@media (height <= 480px)`，那套写法只有
    // Chrome 104+ / Safari 16.4+ 认。
    //
    // 牌桌手机适配里那条 `(pointer: coarse), (max-height: 480px)` 的存在意义
    // 恰恰是兜住「不上报 pointer: coarse 的老安卓 WebView / 投屏浏览器」——
    // 这些老内核同样不认 range 语法，压缩后整条 media 会被丢弃，手机排版直接
    // 回落成桌面版（出牌按钮压住手牌、盖住取消选择）。
    // 锁一个不启用 range 语法的 cssTarget，产物里保留传统 max-height 写法。
    cssTarget: 'chrome87',
  },
})
