// Helpers de resposta + AppError (doc 08 §3A.1).
//
// Regra crítica preservada: @supabase/supabase-js NÃO lança em erro de write —
// retorna { data, error }. Todo write deve checar `error` explicitamente.
// `orThrow` padroniza isso, transformando { error } num AppError 500.
import type { Response } from 'express';

export function sendJson(res: Response, data: unknown, status = 200): Response {
  return res.status(status).json(data);
}

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function orThrow<T>(r: { data: T; error: unknown }): T {
  if (r.error) {
    throw new AppError(500, (r.error as { message?: string }).message ?? 'db error');
  }
  return r.data;
}
