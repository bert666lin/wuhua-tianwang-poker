#!/bin/bash
# 五华天王 — 停止生产服务
PLIST=~/Library/LaunchAgents/com.wuhua.prod.plist
PORT="${PORT:-2567}"
if launchctl list 2>/dev/null | grep -q "com.wuhua.prod"; then
  echo "→ 停止生产服务..."
  launchctl unload "$PLIST" 2>/dev/null
else
  echo "○ 生产服务未运行"
fi
sleep 1
lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null | xargs kill -9 2>/dev/null
echo "✓ 已停止"
