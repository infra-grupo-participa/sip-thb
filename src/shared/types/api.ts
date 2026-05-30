// Tipos da API SIP — single source of truth dos shapes de resposta.
// Portado de supabase/functions/_shared/types/api.ts (repo as-is).
//
// Convenções:
// - Tudo que vem do banco e pode ser ausente é `T | null`, não `T?`.
// - Campos derivados pelo handler (cálculos, joins) marcados com comentário.
// - `unknown` quando o backend repassa JSON arbitrário (raiox_answers, meta).
//
// NOTA (refactor): os re-exports de TrafficFields/TrafficPlatform serão
// adicionados quando domain/traffic-fields.ts e domain/platform.ts forem
// portados (Fase 2/3 do plano de migração).

/** Role persistido em users.role. */
export type UserRole = 'admin' | 'monitor' | 'student';

/** Status de aprovação do cadastro (admin ou self-registered). */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

/**
 * Shape devolvido por /me/session, /me/profile (parcial) e qualquer handler
 * que use USER_SESSION_COLS. Sem dados sensíveis (hash).
 */
export interface UserSession {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  ciclo_type: 'aurum' | 'seminario' | null;
  current_ciclo_id: string | null;
  monitor_id: string | null;
  is_socio: boolean;
  socio_of: string | null;
  onboarding_done: boolean;
  approval_status: ApprovalStatus;
  raiox_score: number | null;
  raiox_max_score: number | null;
  raiox_submitted_at: string | null; // ISO 8601
  must_change_password: boolean;
}

/**
 * Shape completo do usuário pra uso admin/monitor (ficha do aluno).
 * NÃO inclui password_hash. Fonte: USER_FULL_COLS.
 */
export interface UserFull extends Omit<UserSession, 'must_change_password'> {
  phone: string | null;
  city: string | null;
  self_registered: boolean;

  profissao: string | null;
  tempo_carreira: string | null;
  lancamentos_anteriores: string | null;
  faturamento_atual: number | null;
  instagram_handle: string | null;
  fez_curso_thb_antes: boolean | null;

  created_at: string; // ISO 8601

  raiox_answers: Record<string, unknown> | null;

  approval_decided_at: string | null;
  approval_decided_by: string | null;
  approval_note: string | null;
  interesse_ciclo: string | null;

  turma_aurum: string | null;
  turma_thb: string | null;

  is_platina: boolean | null;

  onboarding_perfil: Record<string, unknown> | null;
  must_change_password: boolean;
  password_changed_at: string | null;
}

// ─── Raio-X shapes ────────────────────────────────────────────────────────────

/** Item retornado por GET /admin/raiox-ranking. */
export interface RaioxRankingItem {
  user_id: string;
  name: string;
  email: string;
  phone: string | null;
  ciclo_type: 'aurum' | 'seminario' | null;
  is_platina: boolean;
  score: number;
  max_score: number;
  /** Percentual com 1 casa decimal (ex: 73.5). */
  percent: number;
  /** Veio de raioxClassify(percent) — 40/70. */
  classificacao: 'critico' | 'atencao' | 'ok';
  submitted_at: string | null;
  tem_monitor: boolean;
  categorias_fracas: Array<{ categoria: string; percent: number }>;
}

export interface RaioxRankingResponse {
  items: RaioxRankingItem[];
  total: number;
}

// ─── Gamification (/me/gamification) ──────────────────────────────────────────

export interface GamificationBadge {
  id: string;
  icon: string;
  name: string;
  description: string;
  earned: boolean;
  secret?: boolean;
}

export interface MeGamification {
  xp: number;
  streak: number;
  level: number;
  level_name: string;
  xp_current_level: number;
  xp_next_level: number;
  xp_progress_percent: number;
  completed_tasks: number;
  total_tasks: number;
  completed_stages: number;
  badges: GamificationBadge[];
}
