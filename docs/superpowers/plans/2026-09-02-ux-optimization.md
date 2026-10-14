# 全链路体验优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化大厅、牌桌、匹配、结算和管理后台的高频操作体验，并补齐关键流程回归保护。

**Architecture:** 保留现有页面与服务端协议，把纯展示决策提取为可单测的小函数，再由现有 React 页面消费。样式在既有 CSS 模块内渐进调整，自动化覆盖静态视觉与关键按钮状态。

**Tech Stack:** React 19、TypeScript、Vite、Node test、Playwright CLI、Colyseus、SQLite

**Spec:** `docs/superpowers/plans/2026-09-02-ux-optimization-design.md`

## Global Constraints

- 保持紫金视觉风格和现有核心牌规。
- 玩家端整体以 844×390、667×375 手机横屏为主验收；牌桌竖屏只展示旋转引导，后台保留竖屏适配。
- 不引入新 UI 框架，不改变房间协议，不伪装 AI。
- 禁用按钮必须有状态原因。
- 发版前备份并在发版后做公网验收。

---

### Task 1: 牌桌比分栏瘦身

**Files:**
- Modify: `client/src/components/TableV4.tsx`
- Modify: `client/src/styles/table-v4.css`
- Test: `client/src/components/tableV4Layout.test.ts`

**Interfaces:**
- Consumes: `mainSuit`、`bankerScore`、`catchScore`
- Produces: 宽屏完整标签与手机横屏短标签；数据和点击行为不变

- [ ] **Step 1: 写失败测试**，断言比分标签同时提供完整与紧凑文案，并只在手机横屏隐藏完整文案。
- [ ] **Step 2: 运行** `cd client && node --import tsx --test src/components/tableV4Layout.test.ts`，确认新断言失败。
- [ ] **Step 3: 实现“庄家杀分/庄分、闲家抓分/闲分”双标签与横屏紧凑样式**，保证数值颜色与含义不变。
- [ ] **Step 4: 重跑定向测试并截图** `?dev=mockv4` 的 844×390 视口。
- [ ] **Step 5: 提交** `feat: simplify table phase navigation`。

### Task 2: 大厅主次操作重排

**Files:**
- Modify: `client/src/pages/LobbyHome.tsx`
- Modify: `client/src/styles/lobby-v6.css`
- Modify: `client/src/styles/lobby-responsive.css`
- Test: `client/src/pages/lobbyConfig.test.ts`

**Interfaces:**
- Consumes: `modeId`、`stats`、`loading`、`offline`
- Produces: 保持 `LobbyHomeProps` 不变的主操作层级

- [ ] **Step 1: 写失败测试**，断言快速开始保留模式名且是唯一 `.lobby-primary-action`，好友房入口归为同组。
- [ ] **Step 2: 运行** `cd client && node --import tsx --test src/pages/lobbyConfig.test.ts`，确认失败。
- [ ] **Step 3: 调整大厅结构与样式**，降低比赛场和低频圆钮对比度，突出快速开始、经典、建房和加入房间。
- [ ] **Step 4: 重跑测试并生成三视口大厅截图**，检查 390×844 首屏不遮挡。
- [ ] **Step 5: 提交** `feat: clarify lobby action hierarchy`。

### Task 3: 匹配等待反馈

**Files:**
- Create: `client/src/pages/matchmakingView.ts`
- Modify: `client/src/pages/Matchmaking.tsx`
- Modify: `client/src/styles/matchmaking.css`
- Create: `client/src/pages/matchmakingView.test.ts`

**Interfaces:**
- Produces: `getMatchWaitHint(elapsed: number, foundCount: number, totalOpponents: number): { text: string; canStartWithAi: boolean }`

- [ ] **Step 1: 写失败测试**，覆盖开始、等待中和全部就位状态，确保如实标注电脑对手并可跳过动画直接开局。
- [ ] **Step 2: 运行** `cd client && node --import tsx --test src/pages/matchmakingView.test.ts`，确认模块缺失。
- [ ] **Step 3: 实现纯函数并接入匹配页**，明确“电脑对手”且从开始即可直接开局；继续使用 `startedRef` 防止重复建房。
- [ ] **Step 4: 重跑测试并截图匹配页**，检查取消、直接开局和自动进入文案。
- [ ] **Step 5: 提交** `feat: improve matchmaking feedback`。

### Task 4: 结算首屏层级

**Files:**
- Modify: `client/src/components/Settlement.tsx`
- Modify: `client/src/styles/settlement.css`
- Test: `client/src/utils/settlementView.test.ts`

**Interfaces:**
- Consumes: 现有 `SettlementProps` 与 `describeOutcome`
- Produces: 不改变结算事件的首屏摘要与固定主操作

- [ ] **Step 1: 写失败测试**，断言结果摘要包含级别、金币和下一局状态，牌面明细位于可滚动详情区。
- [ ] **Step 2: 运行** `cd client && node --import tsx --test src/utils/settlementView.test.ts`，确认失败。
- [ ] **Step 3: 重排 JSX 和 CSS**，让主结果及下一局留在首屏，保留分享、截图、房间结算与大厅流程。
- [ ] **Step 4: 重跑测试并截图** `?dev=settle` 的手机竖屏和横屏。
- [ ] **Step 5: 提交** `feat: prioritize settlement next action`。

### Task 5: 后台身份筛选与分页

**Files:**
- Modify: `server/src/data/admin.ts`
- Modify: `server/src/data/api.ts`
- Modify: `client/src/utils/adminApi.ts`
- Modify: `client/src/pages/Admin.tsx`
- Modify: `client/src/styles/admin.css`
- Modify: `client/src/pages/adminIdentityWiring.test.ts`
- Test: `server/src/data/admin.test.ts`

**Interfaces:**
- Produces: `GET /api/admin/players?q=&identity=&offset=&limit=` 返回 `{ players, total, offset, limit }`
- Identity values: `all | registered | guest`

- [ ] **Step 1: 写客户端和服务端失败测试**，覆盖身份筛选、总数、翻页以及 ID/用户名搜索。
- [ ] **Step 2: 运行两端定向测试**，确认新参数和返回字段尚不存在。
- [ ] **Step 3: 服务端加入参数校验、计数查询和分页查询**，不把 AI 写入账户表。
- [ ] **Step 4: 客户端加入身份筛选、结果数量、上一页/下一页和游客/注册标签**。
- [ ] **Step 5: 重跑定向测试与后台截图，提交** `feat: add admin identity filters and pagination`。

### Task 6: 视觉与关键流程回归

**Files:**
- Modify: `client/scripts/visual-regression.mjs`
- Modify: `client/scripts/README.md`
- Create: `client/scripts/critical-flow-smoke.mjs`
- Modify: `client/package.json`

**Interfaces:**
- Produces: `npm run visual:check` 与 `npm run smoke:critical`

- [ ] **Step 1: 为脚本路由集合写结构断言**，要求包含大厅、牌桌、结算、匹配和后台。
- [ ] **Step 2: 扩展视觉脚本并实现 Playwright 关键流程**，检查快速开始、牌桌主操作、收起结算后下一局可用。
- [ ] **Step 3: 运行** `npm run visual:check` 和 `npm run smoke:critical`，保存失败截图和清晰错误信息。
- [ ] **Step 4: 运行完整客户端、服务端测试与构建**，处理所有回归。
- [ ] **Step 5: 提交** `test: cover critical game experience flow`。

### Task 7: 发版与线上验收

**Files:**
- Modify only if needed: `README.md`, `docs/DEPLOY.md`

**Interfaces:**
- Consumes: 所有已通过测试的提交和 `scripts/deploy-online.sh`
- Produces: 可回滚线上版本与验收记录

- [ ] **Step 1: 确认工作区干净、备份标签和远端手工备份存在**。
- [ ] **Step 2: 运行** `bash scripts/deploy-online.sh`，不得跳过测试。
- [ ] **Step 3: 校验公网首页、主包、下载页、健康、版本、房间和游客登录接口**。
- [ ] **Step 4: 对线上版本运行多视口视觉检查和关键流程冒烟测试**。
- [ ] **Step 5: 记录线上提交、主包名、备份位置和回滚命令**。
