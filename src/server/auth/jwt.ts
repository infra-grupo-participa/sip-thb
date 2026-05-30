// JWT HS256 — mesmos claims do as-is (doc 08 §3A.3).
// JWTs emitidos aqui devem ser verificáveis pela sip-api atual (mesmo
// SIP_JWT_SECRET, mesmos claims) — requisito de paridade da Fase 1.
import jwt from 'jsonwebtoken';
import { env, hasJwt } from '../env.js';
import { AppError } from '../http.js';

export interface SipClaims {
  id: string;
  email: string;
  role: 'admin' | 'monitor' | 'student';
  ciclo_type: 'aurum' | 'seminario' | null;
  monitor_id: string | null;
  iat?: number;
  exp?: number;
}

// Emissão idêntica ao as-is: HS256, exp = +24h.
export function makeJwt(payload: Omit<SipClaims, 'iat' | 'exp'>): string {
  if (!hasJwt) {
    throw new AppError(503, 'Servidor sem SIP_JWT_SECRET configurado. Defina a variável de ambiente.');
  }
  return jwt.sign(payload, env.SIP_JWT_SECRET, { algorithm: 'HS256', expiresIn: '24h' });
}

// Assinatura inválida/expirada → null (não lança pro caller).
export function verifyJwt(token: string): SipClaims | null {
  try {
    return jwt.verify(token, env.SIP_JWT_SECRET, { algorithms: ['HS256'] }) as SipClaims;
  } catch {
    return null;
  }
}
