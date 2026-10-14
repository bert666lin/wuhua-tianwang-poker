#!/bin/bash
# ============================================================
# 生成本地开发用的 HTTPS 自签证书
# ------------------------------------------------------------
# 为什么需要：浏览器只在「HTTPS 或 localhost」下才允许 getUserMedia
# （麦克风）。牌桌的「按住说话」在手机上是通过局域网 IP 访问的
# （http://192.168.x.x:5180），属于不安全来源，会直接拿不到麦克风。
#
# 证书里必须把「localhost / 127.0.0.1 / 本机局域网 IP」都写进
# SAN（Subject Alternative Name）。只写 CN 的老式证书现代浏览器
# 一律不认，必须用 SAN。
# ============================================================
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/client/.cert"
mkdir -p "$OUT"

# 取本机局域网 IP（手机要用它访问）。en0 是 Wi-Fi，en1 兜底有线/雷雳网卡。
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")

SAN="DNS:localhost,IP:127.0.0.1,IP:::1"
if [ -n "$IP" ]; then
  SAN="$SAN,IP:$IP"
fi

echo "→ 生成开发证书（有效期 825 天）"
echo "   覆盖地址: localhost / 127.0.0.1${IP:+ / $IP}"

# -nodes: 私钥不加密，否则每次启动 vite 都要输密码
# 825 天是 Apple 平台对自签证书信任的上限，超过会被直接拒绝
openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \
  -keyout "$OUT/dev-key.pem" \
  -out "$OUT/dev-cert.pem" \
  -subj "/CN=wuhua-tianwang-dev" \
  -addext "subjectAltName=$SAN" \
  -addext "basicConstraints=CA:FALSE" \
  -addext "keyUsage=digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth" \
  2>/dev/null

chmod 600 "$OUT/dev-key.pem"

echo ""
echo "✓ 证书已生成: client/.cert/"
echo ""
echo "启动 HTTPS 开发环境:"
echo "  cd client && npm run dev:https"
echo ""
echo "本机访问:  https://127.0.0.1:5180/"
if [ -n "$IP" ]; then
echo "手机访问:  https://$IP:5180/     (同一 WiFi)"
fi
echo ""
echo "自签证书首次访问会报「不安全」，需要手动放行:"
echo "  iOS Safari : 点「详细信息」→「访问此网站」"
echo "  Android    : 点「高级」→「继续前往」"
echo "  桌面 Chrome: 点「高级」→「继续前往」"
