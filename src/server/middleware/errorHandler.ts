// Error handler global — 500 padronizado (doc 08 §3A.8).
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../http.js';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const status = err instanceof AppError ? err.status : 500;
  console.error('[sip-api global catch]', { path: req.path, method: req.method, err });
  res.status(status).json({
    error: status === 500 ? 'Erro interno' : (err as Error).message,
  });
}
