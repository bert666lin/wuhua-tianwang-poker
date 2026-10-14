# 五华天王扑克 - Phase 1 任务清单

> **已废弃：** 该清单基于旧的真人联机和甩牌方案。当前实施基线见 [PHASE1-SPEC.md](./PHASE1-SPEC.md)。

## Phase 1 目标：4人联机核心对局 + 游客登录 + 基础UI（可玩、可分享）

## 任务拆解

### 前端（frontend Agent）
- [x] 初始化 React + Vite + TypeScript 项目
- [ ] 扑克牌CSS/SVG组件（Card.tsx）
- [ ] 手牌区组件（Hand.tsx，排序+选中+出牌）
- [ ] 牌桌布局（Table.tsx，4方位座位+中央出牌区）
- [ ] 顶部状态条（GameStatus.tsx，阶段/主花色/叫分/庄家）
- [ ] 底部操作栏（ActionBar.tsx，出牌/甩牌/扣底确认）
- [ ] 大厅页面（Lobby.tsx，创建/加入房间）
- [ ] Colyseus连接Hook（useColyseus.ts）
- [ ] 牌力工具函数（cardUtils.ts）
- [ ] 游戏配置常量（gameConfig.ts）

### 后端（backend Agent）
- [x] 初始化 Colyseus + TypeScript 项目
- [ ] GameState/PlayerState Schema 定义
- [ ] GameRoom 房间生命周期
- [ ] 洗牌发牌逻辑（deck.ts）
- [ ] 牌力比较系统（compare.ts）
- [ ] 出牌/跟牌/甩牌校验（validate.ts）
- [ ] 分数计算（score.ts）
- [ ] 叫主/叫分定庄流程
- [ ] 庄家扣底流程
- [ ] 出牌对局流程
- [ ] 抠底结算流程
- [ ] 流局处理
- [ ] 服务器入口（index.ts）

### 运维（devops Agent）- 待前后端跑通后
- [ ] Nginx配置：tianwang.geju8.cn
- [ ] Nginx WebSocket 反代配置
- [ ] SSL证书（geju8已有，子域名复用或Let's Encrypt）
- [ ] 部署脚本
- [ ] 健康检查

### 共享
- [x] 共享规则文档（shared/RULES.md）
- [x] 项目设计文档（docs/DESIGN.md）
- [ ] Phase 1 验收测试
