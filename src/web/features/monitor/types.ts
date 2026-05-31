// Tipos da área do Monitor — inferidos das respostas usadas no legado monitor.html.

export type CicloType = 'aurum' | 'seminario' | null;

export interface MonitorStudent {
  id: string;
  name: string;
  email: string;
  ciclo_type: CicloType;
  progress_percent: number;
  completed_tasks?: number | null;
  total_tasks?: number | null;
  current_stage?: string | number | null;
  date_change_requested?: boolean;
}

export interface OnboardingPerfil {
  [key: string]: string | undefined;
}

export interface FullStudent {
  id: string;
  name: string;
  email: string;
  ciclo_type: CicloType;
  completed_tasks?: number | null;
  total_tasks?: number | null;
  onboarding_perfil?: OnboardingPerfil | null;
}

export interface ChecklistTask {
  title: string;
  completed: boolean;
  completed_at?: string | null;
}

export interface ChecklistStage {
  title: string;
  completed_count: number;
  total_count: number;
  categories: Record<string, ChecklistTask[]>;
}

export interface Checklist {
  stages: ChecklistStage[];
}

export interface StudentPost {
  platform: string;
  format: string;
  date: string;
  link?: string | null;
}

export interface TrafficRow {
  date: string;
  spent?: number | null;
  leads_builderall: number;
  cpl?: number | null;
  ctr?: number | null;
}

export interface TrafficTotals {
  spent?: number | null;
  leads_builderall?: number | null;
  cpl?: number | null;
  ctr?: number | null;
}

export interface TrafficBlock {
  rows: TrafficRow[];
  totals: TrafficTotals;
}

export interface DebriefingPayload {
  [key: string]: unknown;
}

export interface DebriefingBlock {
  payload?: DebriefingPayload | null;
  [key: string]: unknown;
}

export interface StudentFull {
  student: FullStudent;
  checklist: Checklist;
  posts?: StudentPost[];
  traffic?: TrafficBlock | null;
  debriefing?: DebriefingBlock | null;
}

export type TicketStatus = 'aberto' | 'em_atendimento' | 'finalizado';

export interface MonitorReport {
  id: string;
  user_name?: string | null;
  kind?: string | null;
  status?: TicketStatus | null;
  message?: string | null;
  created_at: string;
}

// Helpers de ciclo (porte de sipIsAurum/sipIsSeminario/sipCicloChip/sipCicloLabel).
export function isAurum(s: { ciclo_type: CicloType }): boolean {
  return s.ciclo_type === 'aurum';
}
export function isSeminario(s: { ciclo_type: CicloType }): boolean {
  return s.ciclo_type === 'seminario';
}
export function cicloLabel(c: CicloType): string {
  if (c === 'aurum') return 'Aurum';
  if (c === 'seminario') return 'Diamante';
  return 'Sem ciclo';
}
export function cicloChip(c: CicloType): { cls: string; label: string } {
  if (c === 'aurum') return { cls: 'is-brand', label: 'Aurum' };
  if (c === 'seminario') return { cls: 'is-purple', label: 'Diamante' };
  return { cls: '', label: 'Sem ciclo' };
}
