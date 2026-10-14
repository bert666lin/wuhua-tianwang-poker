#!/bin/bash
# 五华天王 — 停止 (从 launchd 卸载, 彻底关)
PLIST_DIR=~/Library/LaunchAgents

stop_one() {
  local label=$1
  if launchctl list 2>/dev/null | grep -q "com.wuhua.$label"; then
    echo "→ 停止 $label..."
    launchctl unload "$PLIST_DIR/com.wuhua.$label.plist" 2>&1
    pkill -9 -f "$label" 2>/dev/null
    echo "✓ $label 已停止"
  else
    echo "○ $label 未运行"
  fi
}

stop_one colyseus
stop_one vite

# 兜底清理
pkill -9 -f vite 2>/dev/null
pkill -9 -f "tsx.*src/index" 2>/dev/null
sleep 1
lsof -nP -iTCP:2567 -sTCP:LISTEN -t 2>/dev/null | xargs kill -9 2>/dev/null
lsof -nP -iTCP:5180 -sTCP:LISTEN -t 2>/dev/null | xargs kill -9 2>/dev/null
echo "✓ 全部清理"
