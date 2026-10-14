#!/bin/bash
# 五华天王 — 发布到线上服务器（tianwang.geju8.cn）
#
# 与 deploy.sh 的区别：
#   deploy.sh        = 本机自托管（launchd + 单端口 2567），只影响这台 Mac
#   deploy-online.sh = 发布到线上服务器（nginx 托管前端 + pm2 跑后端），影响真实用户
#
# 备份保留策略：
#   每次发布把「被替换掉的旧版本」存进 _backups/<时间戳>/，
#   只保留最近 RETAIN 份（默认 3），更早的自动删除。
#   历史上手工部署留下的杂乱备份（frontend.backup-*、wuhua-*.tar.gz 等）
#   也会在这一步一并清掉，避免磁盘无限增长。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# 发版必须从已提交的代码出包：本地改了没提交的东西，线上排障时找不到对应提交。
if [ -n "$(git status --porcelain)" ]; then
  echo "❌ 工作区不干净，先提交或清理后再发版："
  git status --short
  exit 1
fi
GIT_COMMIT="$(git rev-parse --short HEAD)"

SSH_HOST="${SSH_HOST:-root@tianwang.geju8.cn}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/geju8.pem}"
REMOTE_DIR="${REMOTE_DIR:-/srv/wuhua-tianwang}"
PM2_NAME="${PM2_NAME:-wuhua-tianwang}"
SITE_URL="${SITE_URL:-https://tianwang.geju8.cn}"
RETAIN="${RETAIN:-3}"          # 保留几份历史备份
SKIP_TESTS="${SKIP_TESTS:-0}"
TS="$(date +%Y%m%d-%H%M%S)"

SSH_OPTS=(-i "$SSH_KEY" -o UserKnownHostsFile="$ROOT/deploy/known_hosts" -o StrictHostKeyChecking=yes -o ConnectTimeout=15)
SSH="ssh ${SSH_OPTS[*]} $SSH_HOST"

echo "═══════════════════════════════════════════════"
echo "  五华天王 线上发布"
echo "  目标 ${SSH_HOST}:${REMOTE_DIR}"
echo "  版本 ${TS}   备份保留 ${RETAIN} 份"
echo "═══════════════════════════════════════════════"

# ---- 1. 质量闸门 ----
if [ "$SKIP_TESTS" = "1" ]; then
  echo "⚠  已跳过测试（SKIP_TESTS=1）"
else
  echo "→ [1/7] 发版前检查..."
  (cd server && npm test >/dev/null 2>&1 && npx tsc --noEmit) \
    || { echo "❌ 服务端检查未通过，已中止"; exit 1; }
  (cd client && npm run verify >/dev/null 2>&1) \
    || { echo "❌ 客户端检查未通过，已中止"; exit 1; }
  echo "   ✓ 通过"
fi

# ---- 2. 构建 ----
# 必须用 TARGET=online：产物里的后端地址取自 client/.env.production
# （wss://tianwang.geju8.cn/colyseus），否则线上页面会连错后端。
echo "→ [2/7] 构建前端（线上配置）..."
(cd client && npm run build >/dev/null 2>&1) || { echo "❌ 前端构建失败"; exit 1; }
grep -rq "tianwang.geju8.cn" client/dist/assets/ \
  || { echo "❌ 产物里没有线上后端地址，疑似 .env.production 未生效"; exit 1; }
MAIN_JS="$(basename "$(ls client/dist/assets/index-*.js | head -1)")"
[ -n "$MAIN_JS" ] || { echo "❌ 找不到前端主包"; exit 1; }
echo "   ✓ client/dist $(du -sh client/dist | cut -f1) / $MAIN_JS"

echo "→ [3/7] 构建后端..."
(cd server && npm run build >/dev/null 2>&1) || { echo "❌ 后端构建失败"; exit 1; }
[ -f server/dist/index.js ] || { echo "❌ server/dist/index.js 不存在"; exit 1; }
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat > server/dist/version.json <<VERSION_JSON
{
  "commit": "$GIT_COMMIT",
  "buildTime": "$BUILD_TIME",
  "frontendBundle": "$MAIN_JS"
}
VERSION_JSON
[ -f server/dist/version.json ] || { echo "❌ 版本信息生成失败"; exit 1; }
echo "   ✓ server/dist $(du -sh server/dist | cut -f1) / $GIT_COMMIT"

# ---- 2.5 nginx 配置同步 ----
# 反代规则（尤其 /api/ 的 proxy_pass 不带斜杠）现在纳入版本管理：
# 之前配置只存在服务器上，改错了本地看不出来，/api/* 全 404 排查了很久。
# 只有内容变化时才 reload，避免每次发布都动 nginx。
echo "→ [3.5/7] 同步 nginx 配置..."
NGINX_SRC="deploy/nginx/tianwang-geju8.conf"
if [ -f "$NGINX_SRC" ]; then
  scp -q "${SSH_OPTS[@]}" "$NGINX_SRC" "$SSH_HOST:/tmp/tianwang-nginx.conf"
  $SSH bash -s <<'REMOTE_NGINX'
set -euo pipefail
TARGET=/etc/nginx/sites-enabled/tianwang-geju8.conf
if cmp -s /tmp/tianwang-nginx.conf "$TARGET"; then
  echo "   ✓ nginx 配置无变化"
else
  cp -a "$TARGET" "${TARGET}.bak-$(date +%Y%m%d-%H%M%S)"
  cp /tmp/tianwang-nginx.conf "$TARGET"
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx
    echo "   ✓ nginx 配置已更新并 reload"
  else
    # 配置写坏了要立刻还原，不能让站点整体 502
    LAST=$(ls -1t "${TARGET}".bak-* | head -1)
    cp "$LAST" "$TARGET"
    nginx -t >/dev/null 2>&1 && systemctl reload nginx
    echo "   ❌ nginx 配置校验失败，已回滚到 $LAST"
    exit 1
  fi
fi
# nginx 配置备份也只留最近 3 份
ls -1t /etc/nginx/sites-enabled/tianwang-geju8.conf.bak-* 2>/dev/null | tail -n +4 | xargs -r rm -f
rm -f /tmp/tianwang-nginx.conf
REMOTE_NGINX
else
  echo "   · 跳过（$NGINX_SRC 不存在）"
fi

# ---- 3. 打包上传 ----
echo "→ [4/7] 上传..."
FE="/tmp/fe-$TS.tar.gz"; BE="/tmp/be-$TS.tar.gz"
# COPYFILE_DISABLE=1 阻止 macOS 往包里塞 AppleDouble（._foo）副本文件，
# --no-xattrs 去掉扩展属性，否则远端解包会刷一屏 LIBARCHIVE.xattr 警告。
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$FE" -C client/dist .
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$BE" -C server dist
scp -q "${SSH_OPTS[@]}" "$FE" "$BE" "$SSH_HOST:/tmp/"
rm -f "$FE" "$BE"
echo "   ✓ 已送达"

# ---- 4. 远端切换 + 备份轮转 ----
echo "→ [5/7] 远端切换..."
$SSH "TS='$TS' REMOTE_DIR='$REMOTE_DIR' PM2_NAME='$PM2_NAME' RETAIN='$RETAIN' bash -s" <<'REMOTE'
set -euo pipefail
cd "$REMOTE_DIR"

# 解包到 .new。macOS 打的 tar 会带 uid 501/staff 和 700 权限位，
# nginx(www-data) 读不到会 403，所以解完必须重置属主与权限。
rm -rf frontend.new server/dist.new
mkdir -p frontend.new server/dist.new
tar xzf "/tmp/fe-$TS.tar.gz" -C frontend.new
tar xzf "/tmp/be-$TS.tar.gz" -C server/dist.new --strip-components=1
find frontend.new server/dist.new -name '._*' -delete
chown -R root:root frontend.new server/dist.new
chmod -R u=rwX,go=rX frontend.new server/dist.new

[ -f frontend.new/index.html ]     || { echo "❌ 前端包内容异常"; exit 1; }
[ -f server/dist.new/index.js ]    || { echo "❌ 后端包内容异常"; exit 1; }

# 归档旧版本到 _backups/<TS>/，同时保留 .prev 作为「一键回滚」入口
mkdir -p "_backups/$TS"
if [ -d frontend ]; then
  cp -a frontend "_backups/$TS/frontend"
  rm -rf frontend.prev && cp -a frontend frontend.prev
fi
if [ -d server/dist ]; then
  cp -a server/dist "_backups/$TS/server-dist"
  rm -rf server/dist.prev && cp -a server/dist server/dist.prev
fi

# 原子切换（mv 是同分区内改名，切换窗口极短）
# 注意：这里不能写 `[ -d x ] && mv ...`——在 set -e 下路径不存在会让整个脚本退出
rm -rf frontend.old server/dist.old
if [ -d frontend ]; then mv frontend frontend.old; fi
if [ -d server/dist ]; then mv server/dist server/dist.old; fi
mv frontend.new frontend
mv server/dist.new server/dist
rm -rf frontend.old server/dist.old

pm2 restart "$PM2_NAME" --update-env >/dev/null
nginx -t >/dev/null 2>&1 && systemctl reload nginx

# 后端就绪等待
ok=0
for i in $(seq 1 30); do
  sleep 0.5
  curl -fsS http://localhost:2567/health >/dev/null 2>&1 && { ok=1; break; }
done
[ "$ok" = 1 ] || { echo "❌ 后端未就绪，请检查 pm2 logs $PM2_NAME"; exit 1; }

# ---- 备份轮转：只留最近 RETAIN 份 ----
cd "$REMOTE_DIR/_backups"
TOTAL=$(ls -1 | wc -l)
ls -1 | sort | head -n -"$RETAIN" | while read -r old; do
  rm -rf -- "$old"; echo "   · 清除旧备份 $old"
done
echo "   · 备份 ${TOTAL} 份 → 保留 $(ls -1 | wc -l) 份"

# ---- 清理历史手工部署残留（一次性收敛，之后不会再产生）----
cd "$REMOTE_DIR"
for junk in frontend.backup-* frontend.old-swap frontend_old frontend-*.tar.gz \
            wuhua-*.tar.gz server-*.tar.gz backups releases \
            server/dist.backup-* server/dist.old-swap server/dist.tmp-*; do
  if [ -e "$junk" ]; then rm -rf -- "$junk"; echo "   · 清除残留 $junk"; fi
done
rm -f /tmp/fe-*.tar.gz /tmp/be-*.tar.gz
echo "   · 磁盘 $(df -h / | awk 'NR==2{print $4" 可用 ("$5" 已用)"}')"
REMOTE
echo "   ✓ 已切换"

# ---- 5. 公网侧验收 ----
echo "→ [6/7] 公网验收..."
for probe in "/:200" "/assets/$MAIN_JS:200" "/download/:200"; do
  p="${probe%:*}"; want="${probe##*:}"
  got=$(curl -s -o /dev/null -w '%{http_code}' "$SITE_URL$p")
  [ "$got" = "$want" ] && echo "   ✓ $p → $got" \
    || { echo "   ❌ $p → $got（期望 $want）"; exit 1; }
done
curl -fsS "$SITE_URL/api/health" | grep -q '"status":"ok"' \
  && echo "   ✓ /api/health → ok" || { echo "   ❌ 后端接口异常"; exit 1; }
VERSION_JSON="$(curl -fsS "$SITE_URL/api/version")"
echo "$VERSION_JSON" | grep -q "\"commit\":\"$GIT_COMMIT\"" \
  && echo "   ✓ /api/version -> $GIT_COMMIT" \
  || { echo "❌ 线上版本与本地提交不一致：$VERSION_JSON"; exit 1; }
# 房间列表 + 游客登录必须真的通：这两条一挂，玩家进来就是白屏/0 金币，
# 而首页和主包仍是 200，光看上面两条查不出来。
curl -fsS "$SITE_URL/api/rooms" | grep -q '"success":true' \
  && echo "   ✓ /api/rooms → ok" || { echo "   ❌ 房间列表接口异常"; exit 1; }
curl -fsS -X POST -H 'content-type: application/json' -d '{}' "$SITE_URL/api/auth/guest" | grep -q '"token"' \
  && echo "   ✓ /api/auth/guest → ok" || { echo "   ❌ 账号接口异常"; exit 1; }

echo "→ [7/7] 完成"
echo ""
echo "═══════════════════════════════════════════════"
echo "  ✅ 已上线   ${SITE_URL}"
echo "  ─────────────────────────────────────────"
echo "  版本   ${TS}（主包 ${MAIN_JS}）"
echo "  下载页 ${SITE_URL}/download（换安装包：bash scripts/publish-apk.sh）"
echo "  回滚   bash scripts/rollback-online.sh"
echo "═══════════════════════════════════════════════"
