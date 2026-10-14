#!/bin/bash
# 五华天王 — 启动 (用 launchd, 持久化, 不受 shell 退出影响)
PLIST_DIR=~/Library/LaunchAgents

start_one() {
  local label=$1
  local plist=$PLIST_DIR/com.wuhua.$label.plist
  if launchctl list 2>/dev/null | grep -q "com.wuhua.$label"; then
    echo "✓ $label 已在跑 (launchd 托管)"
  else
    echo "→ 启动 $label (launchd 加载)..."
    launchctl load "$plist" 2>&1
  fi
}

start_one colyseus
start_one vite

# 等端口
for i in $(seq 1 30); do
  sleep 0.5
  c=$(lsof -nP -iTCP:2567 -sTCP:LISTEN -t 2>/dev/null)
  v=$(lsof -nP -iTCP:5180 -sTCP:LISTEN -t 2>/dev/null)
  if [ -n "$c" ] && [ -n "$v" ]; then break; fi
done

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "127.0.0.1")
echo ""
echo "═══════════════════════════════════════════════"
echo "  五华天王 已就绪 (launchd 持久化)"
echo "  ─────────────────────────────────────────"
echo "  本机:   http://127.0.0.1:5180/?dev=lobby"
echo "  手机:   http://$IP:5180/?dev=lobby  (同 WiFi)"
echo "  后端:   http://127.0.0.1:2567/health"
echo "  监控:   http://127.0.0.1:2567/colyseus"
echo "  日志:   $ROOT/.runtime-logs/"
echo "═══════════════════════════════════════════════"
echo "  关: bash scripts/stop-all.sh"
