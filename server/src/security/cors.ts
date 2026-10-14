import type { NextFunction, Request, Response } from 'express';

/** CORS 白名单：线上同源，开发允许本机和局域网 5180。 */
const DEFAULT_ALLOWED_ORIGINS = ['https://tianwang.geju8.cn'];
const PRIVATE_IPV4_PREFIXES = [/^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./];

export function isAllowedCorsOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (DEFAULT_ALLOWED_ORIGINS.includes(origin)) return true;
  if ((process.env.ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).includes(origin)) return true;

  try {
    const url = new URL(origin);
    const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const isPrivateNetwork = PRIVATE_IPV4_PREFIXES.some((re) => re.test(url.hostname));
    return url.protocol === 'http:' && url.port === '5180' && (isLocalHost || isPrivateNetwork);
  } catch {
    return false;
  }
}

/** 自定义 CORS：cors@2 的函数 origin 会被当真值而放开所有来源，必须自己写。 */
export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');

  if (origin && isAllowedCorsOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE');
      res.setHeader(
        'Access-Control-Allow-Headers',
        req.headers['access-control-request-headers'] || 'Content-Type, Authorization',
      );
      res.status(204).end();
      return;
    }
  }

  next();
}
