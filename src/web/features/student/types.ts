// Shapes consumidos pelo dashboard do aluno (espelham as respostas do server).
export interface TaskItem {
  id: string;
  title: string;
  order_index: number;
  completed: boolean;
  completed_at: string | null;
  tutorial_url: string | null;
  why_text: string | null;
  mission: string | null;
  requires_link: boolean;
  link_label: string | null;
  owner: string;
  prazo_label: string | null;
  is_handoff: boolean;
  interactive: boolean;
}

export interface StageItem {
  id: string;
  stage_number: number;
  title: string;
  description: string | null;
  unlocked: boolean;
  completed: boolean;
  completed_count: number;
  total_count: number;
  categories: Record<string, TaskItem[]>;
}

export interface ProgressResponse {
  stages?: StageItem[];
  total?: number;
  completed?: number;
  // estados alternativos
  waiting?: boolean;
  wait_mode?: boolean;
  reason?: string;
  data_inicio?: string | null;
  pending_approval?: boolean;
  rejected?: boolean;
}

export interface Badge {
  id: string;
  icon: string;
  name: string;
  description: string;
  earned: boolean;
  secret?: boolean;
}

export interface Gamification {
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
  badges: Badge[];
}

export interface CicloInfo {
  nome: string;
  cor_destaque: string | null;
  icone: string | null;
  fase_atual: string;
  data_inicio: string | null;
  data_fim: string | null;
  dias_restantes: number | null;
  progresso_temporal: number | null;
}
export interface CicloResponse {
  ciclo: CicloInfo | null;
}

export interface HistoryItem {
  ciclo_nome: string;
  data_inicio: string | null;
  data_fim: string | null;
  progress_percent: number;
  completed_tasks: number;
  total_tasks: number;
  total_posts: number;
  total_leads: number;
  sdb_submitted: boolean;
  sdb_nota: number | null;
  sdb_vendas: number | null;
  sdb_roi: number | null;
}

export interface Post {
  id: string;
  date: string;
  platform: string;
  format: string;
  link: string | null;
  manual_reach: number | null;
}

export interface PostsPage {
  items: Post[];
  total?: number;
}

export interface TrafficRow {
  id: string;
  date: string;
  platform: string | null;
  spent: number;
  impressions?: number;
  clicks?: number;
  page_views?: number;
  leads_builderall: number;
  leads_meta?: number;
  cpl: number | null;
  ctr: number | null;
  cpm?: number | null;
}
export interface TrafficResponse {
  rows: TrafficRow[];
  totals: {
    spent?: number;
    leads_builderall?: number;
    cpl?: number | null;
    impressions?: number;
    clicks?: number;
  } | null;
}

export interface Milestone {
  date: string;
  label: string;
  offset: number;
  phase_color: string;
  is_anchor: boolean;
  is_past: boolean;
}
export interface CalendarResponse {
  ciclo_type?: string | null;
  anchor_date: string | null;
  date_changes?: number;
  date_change_requested?: boolean;
  milestones?: Milestone[];
}

export interface ProfileResponse {
  name: string;
  email: string;
  phone: string | null;
  city: string | null;
  profissao: string | null;
  instagram_handle: string | null;
  facebook_handle: string | null;
  youtube_handle: string | null;
  turma_thb: string | null;
  turma_aurum: string | null;
  is_platina?: boolean;
  ciclo_type: string | null;
  monitor_name: string | null;
  raiox_score: number | null;
  raiox_max_score: number | null;
  nivel: string | null;
  error?: string;
}

// Espelha a tabela `reports` do legado (handlers/student.ts). A conversa
// admin -> aluno fica em admin_response/responded_at; a leitura pelo aluno é
// marcada via read_at (PUT /me/reports/:id/read).
export interface Report {
  id: string;
  kind: string;
  status: string;
  message: string;
  created_at: string;
  task_title?: string | null;
  admin_response?: string | null;
  responded_at?: string | null;
  read_at?: string | null;
}

export interface InviteResponse {
  socio: { name: string; email: string } | null;
  pending_invite: { token: string; expires_at: string } | null;
}

export interface DebriefingResponse {
  created_at?: string | null;
  [key: string]: unknown;
}

// GET /superdebriefing — contrato do legado (handlers/student.ts): registro do
// ciclo atual (`existing`, com o formulário completo em payload) + valores
// pré-preenchidos derivados de tráfego/postagens da semana (`prefilled`).
export interface SuperDebriefingResponse {
  existing:
    | (Record<string, unknown> & {
        id?: string;
        payload?: Record<string, unknown> | null;
        submitted_at?: string | null;
      })
    | null;
  prefilled: Record<string, unknown>;
}
export interface DebriefingStatus {
  show_debriefing?: boolean;
}
