// Constantes de domínio — porte de handlers/_shared.ts.

export const ERR_ACCESS_DENIED = 'Acesso negado';
export const ERR_WAIT_MODE = 'Aguardando início do ciclo.';

// Projeções explícitas em sip.users.
export const USER_SESSION_COLS =
  'id, name, email, role, ciclo_type, current_ciclo_id, monitor_id, is_socio, socio_of, onboarding_done, approval_status, raiox_score, raiox_max_score, raiox_submitted_at, must_change_password, interesse_ciclo';

export interface XpLevel {
  level: number;
  name: string;
  xp_min: number;
}
export const XP_LEVELS: XpLevel[] = [
  { level: 1, name: 'Iniciante', xp_min: 0 },
  { level: 2, name: 'Aprendiz', xp_min: 200 },
  { level: 3, name: 'Praticante', xp_min: 500 },
  { level: 4, name: 'Avançado', xp_min: 1000 },
  { level: 5, name: 'Expert', xp_min: 1800 },
  { level: 6, name: 'Mestre', xp_min: 3000 },
];

export const SETTINGS_CATALOG = [
  { key: 'msg_aguardando_monitor_titulo', label: 'Tela de espera — Título', default: 'Aguardando seu Monitor', kind: 'text' },
  { key: 'msg_aguardando_monitor_corpo', label: 'Tela de espera — Mensagem', default: 'Você ainda não possui um monitor associado ao seu ciclo.', kind: 'textarea' },
  { key: 'msg_onboarding_titulo', label: 'Onboarding — Título', default: 'Bem-vindo ao SIP!', kind: 'text' },
  { key: 'msg_onboarding_corpo', label: 'Onboarding — Mensagem', default: 'Tudo pronto para iniciar seu ciclo.', kind: 'text' },
  { key: 'msg_cadastro_info', label: 'Cadastro — Aviso da fila', default: 'Após criar sua conta, você ficará em uma fila de espera até que o admin atribua um monitor ao seu ciclo.', kind: 'textarea' },
  { key: 'msg_ciclo_completo', label: 'Ciclo completo — Mensagem', default: 'Você finalizou todas as etapas! Preencha o SuperDebriefing para fechar o ciclo.', kind: 'textarea' },
  { key: 'cpl_meta', label: 'CPL meta (R$)', default: '5.00', kind: 'text' },
  { key: 'ctr_meta', label: 'CTR meta (%)', default: '1.0', kind: 'text' },
  { key: 'taxa_carregamento_meta', label: 'Taxa de carregamento meta (%)', default: '80', kind: 'text' },
  { key: 'banner_global', label: 'Banner global', default: '', kind: 'textarea' },
  { key: 'banner_global_tipo', label: 'Tipo do banner', default: 'info', kind: 'text' },
  { key: 'previsao_aurum', label: 'Meta de vendas — Aurum', default: '', kind: 'text' },
  { key: 'previsao_seminario', label: 'Meta de vendas — Diamante', default: '', kind: 'text' },
  { key: 'launch_gate_aurum', label: 'Trava de lançamento Aurum (on/off) — libera só Etapa 1; sênior só debriefing', default: 'off', kind: 'text' },
] as const;

export const PUBLIC_SETTINGS_KEYS = SETTINGS_CATALOG.map((s) => s.key);
