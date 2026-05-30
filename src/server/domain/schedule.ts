// Domínio: Cronograma do aluno (Schedule). Helpers puros — porte 1:1 de
// _shared/domain/schedule.ts.

export type TemplateMilestone = {
  key: string;
  offset: number;
  label: string;
  phase: string;
  phase_color: string;
  is_anchor: boolean;
};

export type CicloTemplate = {
  ciclo_type: 'aurum' | 'seminario';
  duracao_dias: number;
  milestones: TemplateMilestone[];
  rules: {
    min_offset_today_days?: number;
    max_offset_today_days?: number;
    anchor_dow?: number | null;
    recommend_dow?: number[];
  };
};

export type ScheduleMilestone = {
  key: string;
  date: string;
  dow: number;
  label: string;
  phase: string;
  phase_color: string;
  is_anchor: boolean;
  offset: number;
  overridden: boolean;
  is_past?: boolean;
};

export type ScheduleOverrides = Record<string, string>;

export function addDays(base: string, delta: number): string {
  const d = new Date(base + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  return d.toISOString().split('T')[0]!;
}

export function dowOf(date: string): number {
  return new Date(date + 'T12:00:00').getDay();
}

export function todayISO(): string {
  return new Date().toISOString().split('T')[0]!;
}

export function buildSchedule(
  anchorDate: string,
  template: CicloTemplate,
  overrides: ScheduleOverrides = {},
): ScheduleMilestone[] {
  const today = todayISO();
  const milestones: ScheduleMilestone[] = template.milestones.map((m) => {
    const override = overrides[m.key];
    const date = override ?? addDays(anchorDate, m.offset);
    return {
      key: m.key,
      date,
      dow: dowOf(date),
      label: m.label,
      phase: m.phase,
      phase_color: m.phase_color,
      is_anchor: m.is_anchor,
      offset: m.offset,
      overridden: !!override,
      is_past: date < today,
    };
  });
  milestones.sort((a, b) => a.date.localeCompare(b.date));
  return milestones;
}

export function validateAnchorAgainstTemplate(
  anchorDate: string,
  template: CicloTemplate,
  opts: { today?: string; allowPast?: boolean } = {},
): string | null {
  const today = opts.today ?? todayISO();
  const { rules } = template;
  const anchor = new Date(anchorDate + 'T12:00:00');
  if (Number.isNaN(anchor.getTime())) return 'Data inválida.';
  const todayD = new Date(today + 'T12:00:00');
  const diffDays = Math.round((anchor.getTime() - todayD.getTime()) / 86400000);
  if (!opts.allowPast && diffDays < 0) return 'A data escolhida já passou.';
  if (rules.min_offset_today_days != null && diffDays < rules.min_offset_today_days) {
    return `Mínimo ${rules.min_offset_today_days} dias a partir de hoje.`;
  }
  if (rules.max_offset_today_days != null && diffDays > rules.max_offset_today_days) {
    return `Máximo ${rules.max_offset_today_days} dias a partir de hoje.`;
  }
  if (rules.anchor_dow != null && anchor.getDay() !== rules.anchor_dow) {
    const dias = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    return `A data deve cair em ${dias[rules.anchor_dow]}. Você escolheu ${dias[anchor.getDay()]}.`;
  }
  return null;
}
