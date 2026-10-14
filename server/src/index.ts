/**
 * Colyseus服务器入口
 * 
 * 天王扑克H5游戏服务器
 * 端口：2567（Colyseus默认端口）
 */

import { Server, matchMaker } from '@colyseus/core';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { monitor } from '@colyseus/monitor';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from './rooms/GameRoom.js';
import { LobbyRoom } from './rooms/LobbyRoom.js';
import { isJoinableRoom } from './rooms/roomList.js';
import { registerApi } from './data/api.js';
import { corsMiddleware, isAllowedCorsOrigin } from './security/cors.js';
import { monitorAuth } from './security/monitorAuth.js';
import { versionInfo } from './version.js';

// 生产部署：由本进程直接托管前端构建产物，做到单端口对外，
// 手机等外部设备只需访问一个地址，不用再单独跑 vite。
// 用 SERVE_CLIENT=0 可关掉（本地开发时前端走 vite dev server 的 HMR）。
const thisDir = path.dirname(fileURLToPath(import.meta.url));
// tsx 直跑时在 src/，tsc 编译后在 dist/，两种情况都要能找到 client/dist
const clientDist = [
  path.resolve(thisDir, '../../client/dist'),
  path.resolve(thisDir, '../../../client/dist'),
].find(candidate => fs.existsSync(path.join(candidate, 'index.html')));
const serveClient = process.env.SERVE_CLIENT !== '0' && !!clientDist;

// Colyseus 自己会给所有路由加 CORS。必须覆盖它，否则这里会退回“反射任意 Origin”。
// 不允许的来源统一回生产域名：浏览器会因 Origin 不匹配而拦截，不会放成 *。
matchMaker.controller.getCorsHeaders = (headers: Headers) => {
  const origin = headers.get('origin') ?? undefined;
  const allowed = origin && isAllowedCorsOrigin(origin) ? origin : 'https://tianwang.geju8.cn';
  return { 'Access-Control-Allow-Origin': allowed };
};

// Colyseus游戏服务器 - 通过express回调集成自定义路由
const gameServer = new Server({
  /**
   * 必须显式给 transport 抬高 maxPayload。
   *
   * @colyseus/ws-transport 的默认 maxPayload 只有 **4KB**，超限时 ws 层会直接以
   * 关闭码 **1009 (Message Too Big)** 掐掉整条连接。而客户端 SDK 只把
   * 1001/1005/1006/4010 当作"可以重连"，1009 不在其中 —— 于是 onDrop 根本不触发，
   * 直接走 onLeave，前端立刻弹「网络已断开，未能重连回牌桌」。
   *
   * 这就是用户反馈「iPhone 一按语音就闪退回大厅，安卓没事」的真正原因：
   *   - 安卓录 webm/opus，16kbps 下 250ms 一片 ≈ 500B，永远撞不到 4KB；
   *   - iOS Safari 只能录 mp4/aac，且**第一片带 ftyp+moov 初始化段**，
   *     一上来就轻松超过 4KB —— 所以是"一按就断"，不是按一会儿才断。
   * 实测（本地真实房间，见提交说明）：500B/3KB 连接稳定；6KB/8KB 必现 1009。
   *
   * 取 32KB：语音单片上限 8KB（VOICE_MAX_CHUNK_BYTES）留 4 倍余量，
   * 同时远小于会被人当放大器刷流量的量级。
   */
  transport: new WebSocketTransport({ maxPayload: 32 * 1024 }),
  express: (app) => {
    // 线上由 nginx 反代，要按 X-Forwarded-For 取真实来源，供登录频控使用。
    app.set('trust proxy', 1);
    app.use(corsMiddleware);
    app.use(express.json());
    
    // 账号 / 商城 / 活动 / 排行榜 接口（/api/*）
    registerApi(app);

    // Colyseus 监控面板。
    // 必须先过 monitorAuth：monitor() 自身零认证，而 nginx 把 /colyseus/ 反代到这里，
    // 不加守卫等于把全部房间信息和管理动作挂在公网上。
    app.use('/colyseus', monitorAuth, monitor());
    
    // 健康检查。/api/health 也挂一份：线上 nginx 把 /api/ 整段原样转给本服务，
    // 部署脚本探活用的就是 https://域名/api/health。
    const healthHandler = (_req: any, res: any) => {
      res.json({
        status: 'ok',
        service: 'wuhua-tianwang-poker-server',
        timestamp: Date.now(),
      });
    };
    app.get('/health', healthHandler);
    app.get('/api/health', healthHandler);

    // 公开只读的构建信息，用于发布后核对“线上到底跑的是哪一版”。
    app.get('/api/version', (_req, res) => {
      res.json({ success: true, ...versionInfo() });
    });
    
    /**
     * 房间列表接口：给大厅「房间列表」用。
     *
     * 只返回**现在真能进去**的房：
     *  - private 房不列（那是私人局，只能凭房号进）
     *  - 已开局的不列（服务端不支持中途加入，会直接 leave(4000)）
     *  - 满员的不列（同上）
     *  - 全是 AI、一个真人都没有的空房不列（那是残留房，进去也没人陪你打）
     * 早先是把 matchMaker 里的房全倒出来，列表里一堆点进去就报错的房间。
     * 带 ?all=1 时不过滤，方便排查。
     */
    const roomsHandler = async (req: any, res: any) => {
      try {
        const showAll = String(req.query.all ?? '') === '1';
        const rooms = await matchMaker.query({ name: 'game' });
        const mapped = rooms.map((room: any) => {
          const meta = room.metadata ?? {};
          const seats = meta.playerCount ?? room.maxClients;
          const phase = meta.phase ?? null;
          return {
            roomId: room.roomId,
            roomName: room.name,
            clients: room.clients,
            maxClients: room.maxClients,
            locked: room.locked,
            private: room.private,
            modeId: meta.modeId ?? null,
            playerCount: seats,
            deckCount: meta.deckCount ?? null,
            phase,
            hostName: meta.hostName ?? '',
            hostScore: meta.hostScore ?? 0,
            humanCount: meta.humanCount ?? null,
            // 房卡局（朋友局）：列表要标出来，玩家选房时最关心「会不会输钱」
            isCardRoom: !!meta.isCardRoom,
          };
        });
        const visible = showAll ? mapped : mapped.filter(isJoinableRoom);
        res.json({ success: true, rooms: visible });
      } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to fetch rooms' });
      }
    };
    // 两个路径都挂：
    //   /api/rooms —— 线上 nginx 只反代 /api/ 和 /colyseus/，前端统一走这个
    //   /rooms     —— 老前端产物和本地单端口调试仍在用，保留兼容
    app.get('/api/rooms', roomsHandler);
    app.get('/rooms', roomsHandler);

    /**
     * 大厅统计：在玩人数（按副数分组）+ 空闲房数。
     *
     * 大厅那几张模式卡原来写死「3,872人在玩」，是纯装饰数字。
     * 这里给真实值：人少就显示人少，别骗玩家以为随时能匹配到人。
     */
    app.get('/api/stats', async (_req, res) => {
      try {
        const rooms = await matchMaker.query({ name: 'game' });
        let online = 0, waitingRooms = 0;
        const byDeck: Record<string, number> = { '2': 0, '3': 0 };
        for (const room of rooms as any[]) {
          const meta = room.metadata ?? {};
          const humans = typeof meta.humanCount === 'number' ? meta.humanCount : room.clients;
          online += humans;
          const deck = String(meta.deckCount ?? '');
          if (deck in byDeck) byDeck[deck] += humans;
          if ((meta.phase ?? 'waiting') === 'waiting' && room.clients < (meta.playerCount ?? room.maxClients)) {
            waitingRooms++;
          }
        }
        res.json({ success: true, online, waitingRooms, byDeck });
      } catch {
        res.status(500).json({ success: false, error: 'Failed to fetch stats' });
      }
    });
    
    // 前端静态产物 + SPA 兜底（必须放在自定义 API 路由之后）
    if (serveClient && clientDist) {
      // 带 hash 的资源可长期缓存；index.html 必须不缓存，否则发版后仍加载旧壳
      app.use(express.static(clientDist, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
          else if (filePath.includes('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }));
      // SPA 兜底：非 API/WS 路径统一回 index.html，交给前端路由。
      // 用 app.use 而不是 app.get，这样 HEAD 请求也能正确响应
      // （很多探活/负载均衡只发 HEAD，用 app.get 会让它们收到 404）。
      // 注意必须排除 api：否则拼错的接口路径会静默回一个 index.html，
      // 前端拿到 text/html 去 JSON.parse，报的错跟真实原因（路径不对）毫无关系。
      const spaFallback = /^\/(?!colyseus|health|api|rooms|matchmake)/;
      app.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        if (!spaFallback.test(req.path)) return next();
        // index.html 绝不能缓存，否则发版后客户端仍加载旧的资源引用
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(path.join(clientDist, 'index.html'));
      });
      console.log(`[Server] 已托管前端产物: ${clientDist}`);
    } else {
      console.log('[Server] 未托管前端产物（client/dist 不存在或 SERVE_CLIENT=0）');
    }

    console.log('[Server] Express路由已注册');
  },
});

// 注册房间类型
gameServer.define('lobby', LobbyRoom);
gameServer.define('game', GameRoom);

const port = Number(process.env.PORT || 2567);

gameServer.listen(port, '0.0.0.0').then(() => {
  console.log(`🎉 天王扑克服务器已启动！`);
  console.log(`🎮 游戏服务端口: ${port}`);
  if (serveClient) console.log(`🕹  游戏入口: http://localhost:${port}/`);
  console.log(`📊 监控面板: http://localhost:${port}/colyseus`);
  console.log(`🏥 健康检查: http://localhost:${port}/health`);
});
