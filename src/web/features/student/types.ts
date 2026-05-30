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
  badges: Array<{ id: string; icon: string; name: string; description: string; earned: boolean; secret?: boolean }>;
}
