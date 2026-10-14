#!/bin/bash
# 五华天王 — 生产部署
#
# 与 start-all.sh 的区别：
#   start-all.sh  = 开发模式，前端跑 vite dev server（5180，带 HMR），后端 2567
#   deploy.sh     = 生产模式，前端构建成静态产物由后端直接托管，**单端口 2567**
#
# 单端口的好处：手机/平板只要记一个地址，不存在前后端地址不一致、
# 也不会出现 WebSocket 连错端口的问题。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-2567}"
SKIP_TESTS="${SKIP_TESTS:-0}"

echo "═══════════════════════════════════════════════"
echo "  五华天王 生产部署"
echo "═══════════════════════════════════════════════"

# ---- 1. 发版前质量闸门 ----
if [ "$SKIP_TESTS" = "1" ]; then
  echo "⚠  已跳过测试（SKIP_TESTS=1）"
else
  echo "→ [1/4] 发版前检查..."
  echo "   · 服务端单测与类型检查"
  (cd server && npm test >/dev/null 2>&1 && npx tsc --noEmit) \
    || { echo "❌ 服务端检查未通过，已中止部署"; exit 1; }
  echo "   · 客户端 lint / 类型 / 单测"
  (cd client && npm run verify >/dev/null 2>&1) \
    || { echo "❌ 客户端检查未通过，已中止部署"; exit 1; }
  echo "   ✓ 检查通过"
fi

# ---- 2. 构建前端 ----
# client/.env.production 里配的是线上域名（wss://tianwang.geju8.cn/colyseus）。
# 本机自托管部署要把它清掉，让前端按「当前页面来源」自动推断后端地址，
# 否则本机打开的页面会去连线上服务器。
#   TARGET=local（默认）本机单端口自托管
#   TARGET=online        按 .env.production 构建，产物用于发布到线上
TARGET="${TARGET:-local}"
echo "→ [2/4] 构建前端产物（TARGET=${TARGET}）..."
if [ "$TARGET" = "local" ]; then
  # 置空这两个变量即可让前端回退到同源推断，不改动 .env.production 本身
  (cd client && VITE_COLYSEUS_URL= VITE_API_BASE= npm run build >/dev/null 2>&1) \
    || { echo "❌ 前端构建失败"; exit 1; }
else
  (cd client && npm run build >/dev/null 2>&1) \
    || { echo "❌ 前端构建失败"; exit 1; }
  echo "   ⚠  已按线上配置构建，产物中的后端地址指向 .env.production"
fi
SIZE=$(du -sh client/dist | cut -f1)
echo "   ✓ client/dist 就绪（${SIZE}）"

# ---- 注意：发布到线上服务器时的坑 ----
# 从 macOS 打包的 tar 会带上本机的 uid(501)/权限位，解到 Linux 上目录会变成
# drwx------ 501:staff，nginx(www-data) 读不到 -> 首页 403、静态资源 404
# （nginx error.log 里是 "Permission denied"）。
# 远端解包后必须补一步：
#   chown -R root:root frontend && chmod -R u=rwX,go=rX frontend
# 本地单端口自托管（TARGET=local）由 node 自己读文件，不受影响。

# ---- 3. 停掉开发态服务，避免端口冲突 ----
echo "→ [3/4] 停止既有服务..."
bash scripts/stop-all.sh >/dev/null 2>&1 || true
launchctl unload ~/Library/LaunchAgents/com.wuhua.prod.plist 2>/dev/null || true
lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1

# ---- 4. 以 launchd 托管启动（掉线自动重启、开机自启） ----
echo "→ [4/4] 启动生产服务..."
mkdir -p "$ROOT/.runtime-logs"
PLIST=~/Library/LaunchAgents/com.wuhua.prod.plist
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.wuhua.prod</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd $ROOT/server && exec npm run start</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$ROOT/server</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>PORT</key>
    <string>$PORT</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$ROOT/.runtime-logs/prod.out.log</string>
  <key>StandardErrorPath</key>
  <string>$ROOT/.runtime-logs/prod.err.log</string>
</dict>
</plist>
PL
launchctl load "$PLIST"

# 等端口就绪
for i in $(seq 1 40); do
  sleep 0.5
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then break; fi
done

if ! curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  echo "❌ 启动失败，最后 20 行日志："
  tail -20 "$ROOT/.runtime-logs/prod.err.log" 2>/dev/null
  exit 1
fi

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "127.0.0.1")
echo ""
echo "═══════════════════════════════════════════════"
echo "  ✅ 部署完成（单端口 ${PORT}）"
echo "  ─────────────────────────────────────────"
echo "  本机:   http://127.0.0.1:$PORT/"
echo "  手机:   http://${IP}:${PORT}/          (同一 WiFi)"
echo "  健康:   http://127.0.0.1:$PORT/health"
echo "  监控:   http://127.0.0.1:$PORT/colyseus"
echo "  日志:   .runtime-logs/prod.{out,err}.log"
echo "═══════════════════════════════════════════════"
echo "  停止:   bash scripts/stop-prod.sh"
echo "  回开发: bash scripts/stop-prod.sh && bash scripts/start-all.sh"
