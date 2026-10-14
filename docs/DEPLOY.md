# 部署说明

## 两种部署，别搞混

| 脚本 | 作用 | 影响范围 |
| --- | --- | --- |
| `scripts/deploy.sh` | 本机自托管（launchd + 单端口 2567） | 只有这台 Mac |
| `scripts/deploy-online.sh` | 发布到线上服务器 | **真实用户** |

## 发布到线上

```bash
bash scripts/deploy-online.sh
```

流程：发版前检查 → 构建前后端 → 打包上传 → 远端原子切换 → 重启后端 →
轮转备份 → 公网验收。任一步失败即中止，不会留下半新半旧的状态。

跳过测试（急救时用）：`SKIP_TESTS=1 bash scripts/deploy-online.sh`

发布脚本会校验 `/api/version` 返回的 commit 与本地提交一致，防止“线上不是刚提交的这版”。

SSH 使用 `deploy/known_hosts` 固定服务器指纹。服务器换机或密钥轮换时，需要重新生成该文件。

## 备份保留策略

每次发布把被替换掉的旧版本存进 `_backups/<时间戳>/`，**只保留最近 3 份**，
更早的自动删除。改保留份数：`RETAIN=5 bash scripts/deploy-online.sh`

同时 `frontend.prev` / `server/dist.prev` 始终指向上一版，作为一键回滚入口。

> 背景：早期是手工敲命令部署的，备份按 6 种不同命名堆了 60+ 份、占 133MB
> （其中一份还误把 `node_modules` 一起备份进去，单个目录 87MB）。
> 已一次性清理，脚本里也保留了对这些旧命名的清理规则。

## 回滚

```bash
bash scripts/rollback-online.sh          # 回到上一版
bash scripts/rollback-online.sh --list   # 看有哪些历史版本
bash scripts/rollback-online.sh 20260830-131607   # 回到指定版本
```

## 线上环境

- 域名 `https://tianwang.geju8.cn`，登录 `ssh -i ~/.ssh/geju8.pem root@tianwang.geju8.cn`
- 前端 nginx 静态托管 `/srv/wuhua-tianwang/frontend`
- 后端 pm2 进程 `wuhua-tianwang`，监听 2567；nginx 把 `/colyseus`(WS) 与 `/api` 反代过去

## 两个坑（脚本已处理，手工操作时要注意）

1. **权限**：macOS 打的 tar 带 uid 501/staff + 700 权限位，解到 Linux 后
   nginx(www-data) 读不到 → 首页 403。必须
   `chown -R root:root` + `chmod -R u=rwX,go=rX`。
2. **AppleDouble**：macOS tar 会往包里塞 `._foo` 副本并附带 xattr，
   远端解包刷一屏警告。打包时用 `COPYFILE_DISABLE=1 tar --no-xattrs`。

前端产物里的后端地址来自 `client/.env.production`，脚本会校验产物中确实
包含线上域名，防止误把本机配置发上线。

## 安全配置

- Nginx 已启用 HSTS、nosniff、SAMEORIGIN、Referrer-Policy 和麦克风权限限制。
- 服务端 CORS 只允许线上域名、本机开发地址和局域网 5180 调试地址。
- 后台登录连续失败 5 次会锁定 10 分钟。
- Colyseus 监控面板（`/colyseus/colyseus/`）需要 HTTP Basic 认证：
  用户名随意，密码 = 服务端的 `ADMIN_PASSWORD`。没配 `ADMIN_PASSWORD` 时面板直接回 404。
  面板本身零认证，如果不加这层守卫，任何人都能看到全部房间的房主昵称、赌注、真人数。
