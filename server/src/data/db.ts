/**
 * SQLite 持久层。
 *
 * 为什么用 node:sqlite：
 *   Node 22+ 内置，**零依赖**、零运维（不用像 MySQL/Postgres 那样单独起服务），
 *   单文件数据库直接跟着部署走。本项目是单机部署的棋牌小游戏，
 *   并发量级在千级以内，SQLite 完全够；真到需要分库再换也不迟。
 *
 * 为什么是同步 API（DatabaseSync）：
 *   SQLite 是本地文件，读写在微秒级，异步化只会让调用方到处 await 却拿不到好处。
 *   Colyseus 的房间逻辑本身是单线程事件循环，同步读写反而更容易保证一致性
 *   （不会出现"await 期间房间状态被改了"这种竞态）。
 *
 * WAL 模式：
 *   允许"读不阻塞写、写不阻塞读"。不开的话结算写库时会短暂锁住所有查询，
 *   同时有几桌在结算就会互相等。
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 数据库文件位置。
 *
 * 默认放 server/data/game.db，可用 DB_PATH 覆盖（部署时指向持久化盘）。
 * 特别地 DB_PATH=':memory:' 用于测试：每次全新、进程退出即消失。
 *
 * 必须在函数里惰性读取 process.env，不能写成模块顶层的 const：
 * ESM 的 import 会被提升到最前面执行，测试文件里那句
 * process.env.DB_PATH = ':memory:' 反而跑在本模块求值之后，
 * 顶层 const 只会拿到默认值 —— 于是测试跑的其实是真实库文件，
 * 数据在多次运行之间残留，表现为「手机号已注册」这类莫名失败。
 */
function dbPath(): string {
  return process.env.DB_PATH
    // 必须用 fileURLToPath 而不是 new URL(...).pathname：
    // 后者返回的是百分号编码的路径，项目目录名含中文时会解出
    // "%E6%A2%85%E5%B7%9E..." 这种乱码目录，数据库就落到了错误位置。
    ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/game.db');
}

let db: DatabaseSync | null = null;

/** 拿到数据库连接（首次调用时建表）。 */
export function getDb(): DatabaseSync {
  if (db) return db;

  const DB_PATH = dbPath();
  if (DB_PATH !== ':memory:') {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  }
  db = new DatabaseSync(DB_PATH);

  // WAL 只对真实文件有效，内存库会报错，所以要分开处理
  if (DB_PATH !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
    /* WAL 文件默认要等它涨到 1000 页（约 4MB）才自动 checkpoint 回主库。
     * 线上实测主库只有 100KB，-wal 却涨到 4.1MB —— 也就是说绝大部分数据
     * 其实还压在 WAL 里没落盘，一旦进程被 kill -9 且 -wal 损坏就全丢。
     * 调到 64 页（约 256KB）让它勤快一点：写入量本来就很小，
     * 频繁 checkpoint 的开销可以忽略，换来的是"主库始终是最新的"。 */
    db.exec('PRAGMA wal_autocheckpoint = 64');
    startWalCheckpointTimer(db);
  }
  // 外键约束默认是关的，不开的话 ON DELETE 之类的声明形同虚设
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

/**
 * 定时把 WAL 收回主库。
 *
 * autocheckpoint 只在「写操作发生时」才触发，半夜没人玩的话
 * WAL 会一直挂着不回收。这个定时器兜住那种情况。
 * TRUNCATE 模式会把 -wal 文件真正截断到 0 字节，磁盘占用立刻回落。
 */
let walTimer: NodeJS.Timeout | null = null;
function startWalCheckpointTimer(database: DatabaseSync): void {
  if (walTimer) return;
  walTimer = setInterval(() => {
    try { database.exec('PRAGMA wal_checkpoint(TRUNCATE)'); }
    catch { /* 有别的连接正在读时会失败，下一轮再来即可 */ }
  }, WAL_CHECKPOINT_INTERVAL_MS);
  // 不要因为这个定时器把进程吊着不退出
  walTimer.unref?.();
}
const WAL_CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000;

/** 仅测试用：关掉连接，让下次 getDb 重新建。 */
export function closeDb(): void {
  if (walTimer) { clearInterval(walTimer); walTimer = null; }
  db?.close();
  db = null;
}

/**
 * 建表 / 迁移。
 *
 * 用 user_version 记录已应用到第几版，每次只跑新增的那几步，
 * 所以这个函数可以重复调用（幂等）。加字段一律往后追加新的 case，
 * **不要改动已发布的 case**，否则老库升级会对不上。
 */
function migrate(database: DatabaseSync): void {
  const { user_version: version } = database.prepare('PRAGMA user_version').get() as { user_version: number };

  if (version < 1) {
    database.exec(`
      -- 账号。游客也建正式账号，只是没有手机号，这样游客的金币/战绩一样能存。
      CREATE TABLE IF NOT EXISTS accounts (
        id           TEXT PRIMARY KEY,
        -- 手机号登录用；游客为 NULL。UNIQUE 允许多个 NULL（SQLite 语义）
        phone        TEXT UNIQUE,
        nickname     TEXT NOT NULL,
        -- 'phone' | 'guest'
        auth_method  TEXT NOT NULL DEFAULT 'guest',
        -- 登录令牌：客户端存着它免登录，重置密码/换设备时换一个
        token        TEXT NOT NULL UNIQUE,
        coins        INTEGER NOT NULL DEFAULT 0,
        stars        INTEGER NOT NULL DEFAULT 0,
        -- 累计积分，决定段位
        score        INTEGER NOT NULL DEFAULT 0,
        -- 会员到期时间戳（毫秒）；0 表示非会员
        vip_until    INTEGER NOT NULL DEFAULT 0,
        created_at   INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );

      -- 战绩。原来只存在浏览器里，换设备就没了，现在入库。
      CREATE TABLE IF NOT EXISTS rounds (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        played_at     INTEGER NOT NULL,
        mode_id       TEXT NOT NULL,
        i_am_banker   INTEGER NOT NULL,
        i_won         INTEGER NOT NULL,
        level         INTEGER NOT NULL,
        score_delta   INTEGER NOT NULL,
        call_score    INTEGER NOT NULL,
        dig_success   INTEGER NOT NULL,
        coins_delta   INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_rounds_account ON rounds(account_id, played_at DESC);

      -- 已拥有的商品（牌背/道具）。同一账号同一商品只记一条。
      CREATE TABLE IF NOT EXISTS owned_items (
        account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        item_id     TEXT NOT NULL,
        acquired_at INTEGER NOT NULL,
        PRIMARY KEY (account_id, item_id)
      );

      -- 金币/星币流水。所有增减都留痕，方便排查"我的金币怎么少了"。
      CREATE TABLE IF NOT EXISTS ledger (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        at         INTEGER NOT NULL,
        -- 'coins' | 'stars'
        currency   TEXT NOT NULL,
        delta      INTEGER NOT NULL,
        balance    INTEGER NOT NULL,
        -- 'round' | 'daily' | 'welfare' | 'ad' | 'shop' | 'exchange' | 'vip' | 'admin'
        reason     TEXT NOT NULL,
        memo       TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger(account_id, at DESC);

      -- 领取类行为的冷却记录（每日签到、看广告次数等）。
      -- 用 (account_id, kind, day) 天然防重复领取，不必自己算时间窗。
      CREATE TABLE IF NOT EXISTS claims (
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        -- 'daily' | 'welfare' | 'ad'
        kind       TEXT NOT NULL,
        -- 'YYYY-MM-DD'（welfare 这种按小时冷却的存时间戳字符串）
        day        TEXT NOT NULL,
        count      INTEGER NOT NULL DEFAULT 1,
        last_at    INTEGER NOT NULL,
        PRIMARY KEY (account_id, kind, day)
      );

      -- 连续签到进度（7 天递增奖励要知道昨天签没签）
      CREATE TABLE IF NOT EXISTS signin (
        account_id  TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        last_day    TEXT NOT NULL,
        streak      INTEGER NOT NULL DEFAULT 0
      );
    `);
    database.exec('PRAGMA user_version = 1');
  }

  if (version < 2) {
    // v2：战绩补齐"看得见的细节"。
    // 战绩页原来显示的对手名、对局时长、吃了几墩、最佳牌型全是前端造的假数据，
    // 真实数据只有胜负和级数。这里把这些一并入库，页面就能显示真的。
    database.exec(`
      ALTER TABLE rounds ADD COLUMN banker_win     INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE rounds ADD COLUMN opponent_score INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE rounds ADD COLUMN duration_sec   INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE rounds ADD COLUMN trick_count    INTEGER NOT NULL DEFAULT 0;
      -- 同桌其他人：JSON 数组 [{name, rankName}]，只为战绩页展示，不做关联查询
      ALTER TABLE rounds ADD COLUMN opponents      TEXT NOT NULL DEFAULT '[]';
    `);
    database.exec('PRAGMA user_version = 2');
  }

  if (version < 3) {
    // v3：房卡。
    // 房卡局的目的是「朋友局」：房主花一张卡开房，整桌不输赢金币，
    // 只算级别/战绩。所以它是一种独立于 coins/stars 的第三种资产，
    // 必须入表（记在内存里重启就没了）。
    database.exec(`
      ALTER TABLE accounts ADD COLUMN room_cards INTEGER NOT NULL DEFAULT 0;
      -- 房卡局标记：战绩页要把这种局的金币欄显示成「—」而不是 0，
      -- 否则玩家会以为是 bug（赢了却没给钱）。
      ALTER TABLE rounds ADD COLUMN is_card_room INTEGER NOT NULL DEFAULT 0;
    `);
    database.exec('PRAGMA user_version = 3');
  }

  if (version < 4) {
    /* v4：在线时长统计（后台管理要看「在线多久」）。
     *
     * 为什么不用 accounts.last_seen_at 算：它只是「最后一次出现」的时间点，
     * 算不出累计时长（早上玩 1 小时、晚上再玩 1 小时，它只记得晚上）。
     * 这里按天累加心跳间隔，才能得到真实的当日在线时长。 */
    database.exec(`
      CREATE TABLE IF NOT EXISTS online_log (
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        -- 'YYYY-MM-DD'
        day        TEXT NOT NULL,
        -- 当日累计在线秒数
        seconds    INTEGER NOT NULL DEFAULT 0,
        -- 上一次心跳时间，用来算本次该加多少秒
        last_beat  INTEGER NOT NULL,
        PRIMARY KEY (account_id, day)
      );
      CREATE INDEX IF NOT EXISTS idx_online_day ON online_log(day, seconds DESC);
    `);
    database.exec('PRAGMA user_version = 4');
  }

  if (version < 5) {
    /* v5：玩家反馈与举报。
     *
     * 之前反馈页有 895 行界面但一行都没连服务器：点「提交」只弹个
     * "已提交，感谢支持" 然后把数据直接丢掉，运营侧永远收不到任何反馈。
     * 这张表就是那个缺失的落点，后台管理可以按状态筛选处理。
     *
     * 反馈和举报合并成一张表（用 kind 区分）而不是拆两张：
     * 两者的字段几乎完全重合（谁提的、什么类型、正文、状态、处理备注），
     * 后台也总是放在一个列表里一起看，拆开只会让查询变复杂。 */
    database.exec(`
      CREATE TABLE IF NOT EXISTS tickets (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        -- 'feedback'（反馈/建议/BUG） | 'report'（举报）
        kind        TEXT NOT NULL,
        -- 提交人。账号被删时保留工单，所以用 SET NULL 而不是 CASCADE
        account_id  TEXT REFERENCES accounts(id) ON DELETE SET NULL,
        -- 冗余存一份昵称：账号删了之后后台仍要知道是谁提的
        nickname    TEXT NOT NULL DEFAULT '',
        -- feedback: bug/suggest/complain/other；report: cheat/abuse/passive/other
        category    TEXT NOT NULL DEFAULT 'other',
        title       TEXT NOT NULL DEFAULT '',
        body        TEXT NOT NULL DEFAULT '',
        -- 举报专用：被举报的玩家昵称或房间号
        target      TEXT NOT NULL DEFAULT '',
        -- 联系方式（选填）
        contact     TEXT NOT NULL DEFAULT '',
        -- 玩家勾了「加急」
        urgent      INTEGER NOT NULL DEFAULT 0,
        -- 'open' | 'doing' | 'done'
        status      TEXT NOT NULL DEFAULT 'open',
        -- 后台处理备注
        admin_note  TEXT NOT NULL DEFAULT '',
        -- 客户端环境（型号/系统/分辨率），排查 BUG 用
        client_info TEXT NOT NULL DEFAULT '',
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      -- 后台默认按「未处理优先 + 时间倒序」列，玩家侧按自己的账号查
      CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tickets_account ON tickets(account_id, created_at DESC);
    `);
    database.exec('PRAGMA user_version = 5');
  }

  if (version < 6) {
    /* v6：战绩记到「哪一桌、这桌第几局」。
     *
     * 之前 rounds 只是一条条孤立的单局记录，战绩页只能平铺成一个长列表。
     * 但玩家真实的记忆单位是"一桌"——「昨晚在 328 房打了 12 局，输 5 级」，
     * 而不是「第 47 条记录赢 2 级」。没有房间号就永远拼不出这个视图。
     *
     * room_round_no 存的是"这桌的第几局"（服务端 state.roundsPlayed），
     * 不能靠 played_at 排序反推：同桌两局可能同一秒落库，
     * 而且中途加入的人看到的局号必须和桌上顶栏显示的一致。
     *
     * 老记录默认 room_id = ''，战绩页把它们归到「早期记录」而不是
     * 硬凑成一桌 —— 把不同桌的局混成一桌比不分组更糟。 */
    database.exec(`
      ALTER TABLE rounds ADD COLUMN room_id       TEXT NOT NULL DEFAULT '';
      ALTER TABLE rounds ADD COLUMN room_round_no INTEGER NOT NULL DEFAULT 0;
      -- 战绩页要按「我 + 某一桌」取整桌记录
      CREATE INDEX IF NOT EXISTS idx_rounds_room ON rounds(account_id, room_id, room_round_no);
    `);
    database.exec('PRAGMA user_version = 6');
  }
}
