/**
 * Colyseus 监控面板（/colyseus）的访问控制。
 *
 * 为什么必须加：@colyseus/monitor 挂上去就是**完全公开**的。
 * 线上 nginx 又把 /colyseus/ 整段反代给了本进程，于是任何人访问
 * https://域名/colyseus/colyseus/api 就能拿到所有房间的 metadata
 * （房主昵称、分数、真人数、赌注、房号），甚至能调 kick/dispose 之类的动作。
 *
 * 认证复用后台那把 ADMIN_PASSWORD，不再引入第二套凭据：
 *   - 面板是浏览器直接打开的，前端页面不会帮你带 Bearer 头，
 *     所以这里用 HTTP Basic（浏览器会自己弹框），用户名随便填，密码 = ADMIN_PASSWORD。
 *   - 没配 ADMIN_PASSWORD 时**直接 404**（不是 401）：既然后台整体关闭，
 *     就不该对外暴露「这里有个面板」这个信息。
 */
import type { NextFunction, Request, Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';

function expectedPassword(): string {
  return process.env.ADMIN_PASSWORD ?? '';
}

/** 定长比较，避免用 === 比密码时因提前返回而泄露长度/前缀信息。 */
function samePassword(input: string, expect: string): boolean {
  const a = createHash('sha256').update(input).digest();
  const b = createHash('sha256').update(expect).digest();
  return timingSafeEqual(a, b);
}

/** 从 `Authorization: Basic base64(user:pass)` 里取出密码部分。 */
export function basicAuthPassword(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, encoded] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'basic' || !encoded) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return null;
  }
  const sep = decoded.indexOf(':');
  // 冒号后面全都是密码：密码里带冒号也不能被截断。
  return sep < 0 ? '' : decoded.slice(sep + 1);
}

export function monitorAuth(req: Request, res: Response, next: NextFunction): void {
  const expect = expectedPassword();
  if (!expect) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const supplied = basicAuthPassword(req.header('authorization') ?? undefined);
  if (supplied !== null && samePassword(supplied, expect)) {
    next();
    return;
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="wuhua-tianwang monitor", charset="UTF-8"');
  res.status(401).json({ error: 'Unauthorized' });
}
