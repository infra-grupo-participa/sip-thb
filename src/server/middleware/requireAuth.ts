// Bearer → req.user (doc 08 §3A.4).
import type { Request, Response, NextFunction } from 'express';
import { verifyJwt, type SipClaims } from '../auth/jwt.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SipClaims;
      effectiveUserId?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token não fornecido ou inválido' });
    return;
  }
  const claims = verifyJwt(header.slice('Bearer '.length));
  if (!claims) {
    res.status(401).json({ error: 'Token não fornecido ou inválido' });
    return;
  }
  req.user = claims;
  next();
}
