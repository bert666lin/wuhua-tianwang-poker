#!/bin/bash
# 五华天王 — 把安卓安装包发布到 https://tianwang.geju8.cn/download/
#
# 为什么单独一个脚本，而不是塞进 deploy-online.sh：
#   deploy-online.sh 每次都整体替换远端 frontend/ 目录，APK 放在里面会被下一次
#   前端发布冲掉。所以 APK 存在 frontend/ 之外的持久目录 downloads/，
#   由 nginx 用 alias 单独挂到 /download/wuhuatianwang.apk。
#   前端页面（/download/ 那张下载页）随前端正常发布，两者互不影响。
#
# 用法：
#   bash scripts/publish-apk.sh                     # 传 releases/wuhuatianwang-android.apk
#   bash scripts/publish-apk.sh path/to/other.apk   # 传指定文件
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APK="${1:-releases/wuhuatianwang-android.apk}"
SSH_HOST="${SSH_HOST:-root@tianwang.geju8.cn}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/geju8.pem}"
REMOTE_DIR="${REMOTE_DIR:-/srv/wuhua-tianwang}"
SITE_URL="${SITE_URL:-https://tianwang.geju8.cn}"
SSH_OPTS=(-i "$SSH_KEY" -o UserKnownHostsFile="$ROOT/deploy/known_hosts" -o StrictHostKeyChecking=yes -o ConnectTimeout=15)
SSH="ssh ${SSH_OPTS[*]} $SSH_HOST"

[ -f "$APK" ] || { echo "❌ 找不到安装包：$APK"; exit 1; }

# ---- 0. 找齐 Android build-tools 里的工具 ----
# apksigner / aapt2 默认不在 PATH 上（它们躺在 SDK 的 build-tools/<版本>/ 里）。
# 原先只用 `command -v apksigner` 判断，找不到就跳过签名校验 —— 那等于把
# "别发未签名包"这道闸门直接放开了，而这正是最不能省的一步：
# 未签名或签名换了的包，老用户装不上（提示"应用未安装"），只能卸载重装，
# 卸载就丢本地登录态。所以这里主动去 SDK 里翻，翻不到才降级。
find_sdk_tool() {
  local tool="$1" sdk
  command -v "$tool" >/dev/null 2>&1 && { command -v "$tool"; return 0; }
  for sdk in "${ANDROID_SDK_ROOT:-}" "${ANDROID_HOME:-}" \
             "/opt/homebrew/share/android-commandlinetools" \
             "$HOME/Library/Android/sdk"; do
    [ -n "$sdk" ] && [ -d "$sdk/build-tools" ] || continue
    # 取版本号最大的那个 build-tools
    local found
    found=$(ls -1 "$sdk/build-tools" 2>/dev/null | sort -V | tail -1)
    [ -n "$found" ] && [ -x "$sdk/build-tools/$found/$tool" ] \
      && { echo "$sdk/build-tools/$found/$tool"; return 0; }
  done
  return 1
}

# apksigner 是个 shell 包装，内部要调 java；系统默认可能是 JDK 8，得指到 21
if [ -z "${JAVA_HOME:-}" ] || ! "${JAVA_HOME}/bin/java" -version 2>&1 | grep -qE '"(1[7-9]|2[0-9])'; then
  for jh in /opt/homebrew/opt/openjdk@21 /opt/homebrew/opt/openjdk@17; do
    [ -x "$jh/bin/java" ] && { export JAVA_HOME="$jh"; break; }
  done
fi

APKSIGNER="$(find_sdk_tool apksigner || true)"
AAPT2="$(find_sdk_tool aapt2 || true)"

# ---- 1. 本地校验：别把没签名/坏掉的包发出去 ----
echo "→ [1/4] 校验安装包..."
if [ -n "$APKSIGNER" ]; then
  "$APKSIGNER" verify "$APK" >/dev/null 2>&1 \
    || { echo "❌ 签名校验失败，未签名的包装不上手机"; exit 1; }
  # 同时核对签名证书：换了证书老用户就装不上（必须卸载重装，会丢登录态）
  # 注意：不能写成 `apksigner ... | awk '/.../{print; exit}'` —— awk 提前 exit
  # 会让 apksigner 收到 SIGPIPE，配合本脚本的 `set -o pipefail` 会把整条流水线
  # 判为失败（退出码 141），脚本就在这里静默中断了。先把输出落到变量再解析。
  CERTS_OUT="$("$APKSIGNER" verify --print-certs "$APK" 2>/dev/null || true)"
  CERT="$(printf '%s\n' "$CERTS_OUT" | grep -m1 'SHA-256 digest' | awk '{print $NF}')"
  EXPECT_CERT="${EXPECT_CERT:-33ab7b90b87268a09c6d74ee1f54b6540e0ebf4cac6525b55cd699af65ca5d3b}"
  if [ -n "$CERT" ] && [ "$CERT" != "$EXPECT_CERT" ]; then
    echo "❌ 签名证书变了！老用户将无法覆盖更新（提示"应用未安装"）"
    echo "   期望 $EXPECT_CERT"
    echo "   实际 $CERT"
    echo "   确认要换证书就设 EXPECT_CERT=<新指纹> 再跑。"
    exit 1
  fi
  echo "   ✓ 签名有效，证书与线上一致"
else
  # 实在找不到就退回 zip 完整性检查，但要说清风险，不能一句"跳过"了事
  unzip -tq "$APK" >/dev/null 2>&1 || { echo "❌ 包已损坏"; exit 1; }
  echo "   ⚠️ 没找到 apksigner，**没能验签名**（只确认了包结构完整）"
  echo "      装 Android build-tools 后重跑才能真正拦住未签名/换证书的包。"
fi

# 版本号优先从 aapt2 读；读不到就用文件时间当版本，页面上仍能显示更新日期
VER=""
BADGING=""
if [ -n "$AAPT2" ]; then
  BADGING="$("$AAPT2" dump badging "$APK" 2>/dev/null || true)"
elif command -v aapt >/dev/null 2>&1; then
  BADGING="$(aapt dump badging "$APK" 2>/dev/null || true)"
fi
VER_CODE=""
if [ -n "$BADGING" ]; then
  # 同样先落变量再解析，避免 awk 提前 exit 触发 SIGPIPE（见上面的说明）
  VER=$(printf '%s\n' "$BADGING" \
        | awk -F"'" '/^package:/{for(i=1;i<=NF;i++) if($i ~ /versionName=/) {print $(i+1); exit}}')
  # versionCode 才是 Android 判断"是不是新版本"的唯一依据，必须单独读出来核对
  VER_CODE=$(printf '%s\n' "$BADGING" \
        | awk -F"'" '/^package:/{for(i=1;i<=NF;i++) if($i ~ /versionCode=/) {print $(i+1); exit}}')
  # 顺手把 SDK 区间打出来：minSdk 变化直接决定哪些老机型会被挡在门外
  MIN_SDK=$(printf '%s\n' "$BADGING" | grep -m1 "^minSdkVersion" | tr -dc '0-9')
  TGT_SDK=$(printf '%s\n' "$BADGING" | grep -m1 "^targetSdkVersion" | tr -dc '0-9')
  [ -n "$MIN_SDK" ] && echo "   · minSdk ${MIN_SDK} / targetSdk ${TGT_SDK}（minSdk 越高，能装的老机型越少）"
fi

# ---- 1.5 versionCode 必须比线上那一版大 ----
#
# 这是整个「versionCode 随发版自增」修复的最后一环。
# build.gradle 保证了"打包时算出来的值是递增的"，但它管不到这一步：
# 手工传了一个旧 APK、或者 releases/ 里躺着上次的包忘了重新构建，
# 发上去 versionCode 没变大 —— 用户点更新照样装不上（提示「应用未安装」），
# 而下载页会显示新日期，看起来一切正常。这种"静默发了个装不上的包"
# 最难发现，所以必须在发布前挡住。
if [ -z "$VER_CODE" ]; then
  # 读不到就只警告不拦：aapt2 缺失属于环境问题，不该堵死发版
  echo "   ⚠️ 没能读出 versionCode（缺 aapt2），**跳过了版本递增校验**"
  echo "      装 Android build-tools 后重跑，才能拦住「发了个装不上的包」。"
else
  echo "   · versionCode ${VER_CODE}"
  # 线上那一版的 versionCode：优先读 apk-info.json（我们自己写的，最可靠）
  ONLINE_CODE=$(curl -fsS --max-time 15 "$SITE_URL/download/apk-info.json" 2>/dev/null \
                | tr -d ' "' | awk -F: '/versionCode:/{print $2}' | tr -dc '0-9' || true)
  if [ -z "$ONLINE_CODE" ]; then
    # 老的 apk-info.json 里没这个字段（本次改动之前发布的），退回用 versionName 反推
    ONLINE_NAME=$(curl -fsS --max-time 15 "$SITE_URL/download/apk-info.json" 2>/dev/null \
                  | tr -d ' "' | awk -F: '/version:/{print $2}' | tr -d ',' || true)
    ONLINE_CODE=$(printf '%s' "${ONLINE_NAME:-}" | awk -F. '{print $NF}' | tr -dc '0-9' || true)
    [ -n "$ONLINE_CODE" ] && echo "   · 线上 apk-info.json 没有 versionCode 字段，按版本名 ${ONLINE_NAME} 反推为 ${ONLINE_CODE}"
  fi
  if [ -z "$ONLINE_CODE" ]; then
    echo "   ⚠️ 读不到线上版本号（首次发布？），跳过递增校验"
  elif [ "$VER_CODE" -gt "$ONLINE_CODE" ]; then
    echo "   ✓ versionCode 递增：线上 ${ONLINE_CODE} → 本次 ${VER_CODE}"
  else
    echo "   ❌ versionCode 没有变大：线上 ${ONLINE_CODE}，本次 ${VER_CODE}"
    echo "      发上去用户装不上（Android 只看 versionCode，值不变就拒装，"
    echo "      提示「应用未安装」，只能卸载重装 —— 卸载就丢登录态）。"
    echo "      解决：先提交本次改动再重新构建 APK（versionCode 取自 git 提交数），"
    echo "            或用 TIANWANG_VERSION_CODE=<更大的整数> 重新构建。"
    exit 1
  fi
fi
SIZE_TEXT="$(du -h "$APK" | cut -f1 | tr -d ' ')"
UPDATED="$(date +%Y-%m-%d)"
SHA="$(shasum -a 256 "$APK" | cut -c1-16)"
echo "   · 版本 ${VER:-未知} / 大小 $SIZE_TEXT / sha256 ${SHA}…"

# versionCode 要写进 apk-info.json：下一次发布靠它判断"有没有变大"。
# 不写的话每次都只能从 versionName 反推，而 versionName 是可以随手改的。
cat > /tmp/apk-info.json <<JSON
{
  "version": "${VER}",
  "versionCode": ${VER_CODE:-0},
  "sizeText": "${SIZE_TEXT}",
  "updated": "${UPDATED}",
  "sha256Short": "${SHA}"
}
JSON

# ---- 2. 上传 ----
echo "→ [2/4] 上传到 $SSH_HOST ..."
$SSH "mkdir -p '$REMOTE_DIR/downloads'"
scp -q "${SSH_OPTS[@]}" "$APK" "$SSH_HOST:$REMOTE_DIR/downloads/wuhuatianwang.apk.new"
scp -q "${SSH_OPTS[@]}" /tmp/apk-info.json "$SSH_HOST:$REMOTE_DIR/downloads/apk-info.json.new"
rm -f /tmp/apk-info.json
echo "   ✓ 已送达"

# ---- 3. 远端原子切换 + 留一份上一版 ----
echo "→ [3/4] 远端切换..."
$SSH "REMOTE_DIR='$REMOTE_DIR' bash -s" <<'REMOTE'
set -euo pipefail
cd "$REMOTE_DIR/downloads"
[ -s wuhuatianwang.apk.new ] || { echo "❌ 上传的包是空的"; exit 1; }
# 旧包留一份，万一新包有问题可以立刻 mv 回来
if [ -f wuhuatianwang.apk ]; then cp -a wuhuatianwang.apk wuhuatianwang.apk.prev; fi
mv wuhuatianwang.apk.new wuhuatianwang.apk
mv apk-info.json.new apk-info.json
# nginx 以 www-data 身份读，属主/权限必须放开（macOS 打包上来常是 700）
chown root:root wuhuatianwang.apk apk-info.json
chmod 644 wuhuatianwang.apk apk-info.json
ls -lh wuhuatianwang.apk | awk '{print "   · 远端 "$5" "$9}'
REMOTE
echo "   ✓ 已切换"

# ---- 4. 公网验收：三件事都必须真的通 ----
echo "→ [4/4] 公网验收..."
code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE_URL/download/")
[ "$code" = 200 ] && echo "   ✓ /download/ → 200" || { echo "   ❌ /download/ → $code"; exit 1; }

# 用 HEAD 看 apk：要 200，且 Content-Type 必须是安卓包类型，否则手机会当文本打开
hdr=$(curl -sI "$SITE_URL/download/wuhuatianwang.apk")
echo "$hdr" | head -1 | grep -q "200" \
  && echo "   ✓ apk → 200" || { echo "   ❌ apk 不可下载："; echo "$hdr" | head -3; exit 1; }
echo "$hdr" | grep -qi "content-type: application/vnd.android.package-archive" \
  && echo "   ✓ Content-Type 正确" \
  || { echo "   ❌ Content-Type 不对，安卓可能不弹下载："; echo "$hdr" | grep -i content-type; exit 1; }

# 大小要和本地一致，防止传了一半就切换
LOCAL_BYTES=$(wc -c < "$APK" | tr -d ' ')
REMOTE_BYTES=$(echo "$hdr" | awk 'tolower($1)=="content-length:"{gsub(/\r/,"",$2); print $2}')
[ "$LOCAL_BYTES" = "$REMOTE_BYTES" ] \
  && echo "   ✓ 大小一致（$LOCAL_BYTES 字节）" \
  || { echo "   ❌ 大小不一致：本地 $LOCAL_BYTES / 线上 ${REMOTE_BYTES:-空}"; exit 1; }

curl -fsS "$SITE_URL/download/apk-info.json" | grep -q '"sizeText"' \
  && echo "   ✓ apk-info.json → ok" || { echo "   ❌ apk-info.json 异常"; exit 1; }

echo ""
echo "═══════════════════════════════════════════════"
echo "  ✅ 安装包已发布"
echo "  下载页  ${SITE_URL}/download"
echo "  安装包  ${SITE_URL}/download/wuhuatianwang.apk"
echo "  版本 ${VER:-未知}（versionCode ${VER_CODE:-未知}）· ${SIZE_TEXT} · ${UPDATED}"
echo "═══════════════════════════════════════════════"
