# 五华天王扑克

梅州五华天王扑克的 H5 游戏项目：React 前端、Colyseus 实时对局服务、SQLite 账号与运营数据、安卓 WebView 壳。

## 快速体验

需要 Node.js 24。克隆后在两个终端分别运行：

```bash
cd server && npm ci && npm run dev
```

```bash
cd client && npm ci && npm run dev -- --port 5180
```

打开终端显示的前端地址（默认 `http://localhost:5180`），用游客身份进入。前端和服务端要同时运行；本地数据写入 `server/data/`，不会提交到 Git。

手机号登录尚未接短信验证，仅供本地测试；不要把这个版本直接用于公开运营。前端打包时如需连接自己的线上服务，可复制 `client/.env.production.example` 为 `client/.env.production` 后填写自己的地址。不要把这份配置提交到 Git。

## 开源许可

源代码和文字文档采用 [MIT 许可证](LICENSE)：可以使用、修改和分发，保留原版权与许可声明即可。

美术图像、Logo、应用图标、设计源文件，以及“五华天王”的名称和视觉标识不在 MIT 授权范围内。仓库中的相关素材仅供运行和查看本项目；如果要在自己的产品中复用、修改、再分发或商用，请先取得权利人许可，或替换为自己的素材。第三方依赖仍按各自许可证使用。

自行部署到其他域名时，在服务端设置 `ALLOWED_ORIGINS=https://your-domain.example`；多个地址用逗号分隔。发布自己的产品前，还需替换仓库中的品牌素材、应用图标和下载页地址。

## 目录

- `client/`：React + Vite 前端
- `server/`：Colyseus 游戏服务与 HTTP API
- `android/`：Capacitor 安卓壳
- `deploy/nginx/`：线上 Nginx 配置
- `scripts/`：启动、发布、回滚、安装包发布脚本
- `CONTEXT.md`、`docs/`：产品术语、规则和规格
- `docs/RULES.md`：**现行完整规则**（记分、档次、牌型、甩牌、金币），源码逐条核对而来。
  改规则时必须同步改它，然后重新出 PDF：

  ```bash
  node scripts/build-rules-pdf.mjs   # 生成 docs/梅州五华天王扑克-规则清单.pdf
  node scripts/check-rules-pdf.mjs   # 校验页数/正文完整/关键术语可搜索
  ```

  校验脚本必须跑：Chrome 用 PingFang 系字体打印时会把「生/大/门」等汉字写成
  同形的康熙部首字符，肉眼看不出但 PDF 里搜不到，只看"生成成功"会漏掉。
  （`shared/RULES.md` 是已废弃的旧规则，不要再引用）

设计源文件（PSD 等）不进入 Git，请单独保存在网盘、对象存储或 Git LFS。

## 本地开发

```bash
# 后端
cd server && npm install && npm run dev

# 前端（另开一个终端）
cd client && npm install && npm run dev
```

手机调试语音时先生成本地 HTTPS 证书：

```bash
cd client && npm run cert && npm run dev:https
```

## 质量检查

```bash
cd server && npm test && npm run build
cd client && npm run verify && npm run build
```

## 线上发布与回滚

**发布分支是 `main`。** 历史上线上一度跑在 `codex/android-apk` 上、`main` 落后
19 个提交，排障和回滚时极易看错代码；现已快进合并回 `main`，裸仓库的默认分支
（HEAD）也改成了 `main`（原先指向不存在的 `master`，新克隆会一个文件都签不出）。
后续请统一在 `main` 上发版，别再另起长期分支。

发布前必须提交代码；发布脚本会拒绝脏工作区：

```bash
bash scripts/deploy-online.sh
```

发布后会检查首页、静态资源、下载页、健康检查、版本接口、房间列表和游客登录。

查看线上版本：

```bash
curl https://tianwang.geju8.cn/api/version
```

回滚：

```bash
bash scripts/rollback-online.sh
bash scripts/rollback-online.sh --list
```

## 安卓包

```bash
npm run android:build
bash scripts/publish-apk.sh
```

安卓壳跑在 **Capacitor 8**（2026-09-01 从 7 升上来）。打包机需要：

- **JDK 21**（Gradle 8.14 + AGP 8.13 的要求；系统默认的 JDK 8 不行）
- **Android SDK 36**（Capacitor 8 硬要求 compileSdk/targetSdk 36）

本机打包示例：

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
cd android && ./gradlew assembleRelease
```

⚠️ **minSdk 从 23 提到了 24**，即不再支持 Android 6.0（API 23）机型。这是
Capacitor 8 内核写死的下限，不是可选项。

版本号一致性由 `client/src/utils/androidShell.test.ts` 看着（跟普通单测一起跑，
不需要装 Android SDK）：compileSdk/targetSdk/minSdk、AGP、Gradle wrapper、
Capacitor 各包大版本、以及阿里云镜像有没有被官方模板覆盖掉，漏改一处就会红。

## 当前测试口径

手机号登录仍处于测试阶段：尚未接短信验证码，也尚未做登录频控。正式对外前必须补齐验证码与频控。
