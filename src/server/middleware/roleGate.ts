// Gate de prefixo por role (doc 08 §3A.5): /admin → admin; /monitor → monitor|admin.
// Montar com app.use('/api/admin', adminGate) ANTES dos routers respectivos.
import type { Request, Response, NextFunction } from 'express';

export function adminGate(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Acesso restrito' });
    return;
  }
  next();
}

export function monitorGate(req: Request, res: Response, next: NextFunction): void {
  const r = req.user?.role;
  if (r !== 'monitor' && r !== 'admin') {
    res.status(403).json({ error: 'Acesso restrito' });
    return;
  }
  next();
}
