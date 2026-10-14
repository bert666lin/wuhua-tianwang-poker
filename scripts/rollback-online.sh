#!/bin/bash
# 五华天王 — 线上回滚
#
#   bash scripts/rollback-online.sh          回到上一版（frontend.prev / dist.prev）
#   bash scripts/rollback-online.sh --list   列出可回滚的历史版本
#   bash scripts/rollback-online.sh 20260830-131607   回到指定版本
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SSH_HOST="${SSH_HOST:-root@tianwang.geju8.cn}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/geju8.pem}"
REMOTE_DIR="${REMOTE_DIR:-/srv/wuhua-tianwang}"
PM2_NAME="${PM2_NAME:-wuhua-tianwang}"
SITE_URL="${SITE_URL:-https://tianwang.geju8.cn}"
TARGET_VER="${1:-prev}"

SSH_OPTS=(-i "$SSH_KEY" -o UserKnownHostsFile="$ROOT/deploy/known_hosts" -o StrictHostKeyChecking=yes -o ConnectTimeout=15)
SSH="ssh ${SSH_OPTS[*]} $SSH_HOST"

if [ "$TARGET_VER" = "--list" ]; then
  echo "可回滚的历史版本（$REMOTE_DIR/_backups）："
  $SSH "cd '$REMOTE_DIR/_backups' 2>/dev/null && ls -1 | sort -r || echo '（暂无）'"
  echo ""
  echo "上一版快捷入口：frontend.prev / server/dist.prev"
  exit 0
fi

echo "→ 回滚到：$TARGET_VER"
$SSH "REMOTE_DIR='$REMOTE_DIR' PM2_NAME='$PM2_NAME' TARGET_VER='$TARGET_VER' bash -s" <<'REMOTE'
set -euo pipefail
cd "$REMOTE_DIR"

if [ "$TARGET_VER" = "prev" ]; then
  FE_SRC="frontend.prev"; BE_SRC="server/dist.prev"
else
  FE_SRC="_backups/$TARGET_VER/frontend"; BE_SRC="_backups/$TARGET_VER/server-dist"
fi

[ -d "$FE_SRC" ] || { echo "❌ 找不到 $FE_SRC"; exit 1; }
[ -d "$BE_SRC" ] || { echo "❌ 找不到 $BE_SRC"; exit 1; }

rm -rf frontend.rb server/dist.rb
cp -a "$FE_SRC" frontend.rb
cp -a "$BE_SRC" server/dist.rb
chown -R root:root frontend.rb server/dist.rb
chmod -R u=rwX,go=rX frontend.rb server/dist.rb

rm -rf frontend.old server/dist.old
if [ -d frontend ]; then mv frontend frontend.old; fi
if [ -d server/dist ]; then mv server/dist server/dist.old; fi
mv frontend.rb frontend
mv server/dist.rb server/dist
rm -rf frontend.old server/dist.old

pm2 restart "$PM2_NAME" --update-env >/dev/null
nginx -t >/dev/null 2>&1 && systemctl reload nginx

ok=0
for i in $(seq 1 30); do
  sleep 0.5
  curl -fsS http://localhost:2567/health >/dev/null 2>&1 && { ok=1; break; }
done
[ "$ok" = 1 ] || { echo "❌ 后端未就绪，请检查 pm2 logs $PM2_NAME"; exit 1; }
echo "   ✓ 已回滚，主包 $(ls frontend/assets/ | grep '^index-.*js$' | head -1)"
REMOTE

code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE_URL/")
curl -fsS "$SITE_URL/api/health" | grep -q '"status":"ok"' && api=ok || api=FAIL
echo ""
echo "✅ 回滚完成   首页 $code   接口 $api   $SITE_URL"
