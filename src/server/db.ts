// Cliente Supabase único (service_role, schema `sip`) — doc 08 §3A.1.
//
// .schema('sip') NUNCA é omitido: é o mesmo schema do banco de produção.
// service_role BYPASSA RLS — por isso o Express é o gateway ÚNICO do banco
// (mesma mitigação do as-is). Nunca expor essa key ao frontend.
//
// Criação preguiçosa (lazy): se as vars de banco não estiverem setadas em dev,
// o boot ainda sobe (servindo SPA + health); só falha de forma clara se alguém
// tentar usar o banco. Em produção, env.ts já exige as vars no boot.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env, hasDb } from './env.js';
import { AppError } from './http.js';

let _db: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!hasDb) {
    // AppError 503 → o errorHandler devolve esta mensagem (em vez de "Erro
    // interno" genérico), deixando claro no /login o que falta configurar.
    throw new AppError(
      503,
      'Banco de dados não configurado no servidor. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no painel e reinicie.',
    );
  }
  if (!_db) {
    _db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _db;
}

/** Atalho para o schema dedicado do produto. Uso: `sip().from('users')...`. */
export const sip = () => db().schema('sip');
