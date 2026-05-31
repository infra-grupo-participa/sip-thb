import { useCalendar } from './hooks';
import type { Milestone } from './types';

const PHASE_CAL: Record<string, { bg: string; text: string; border: string; label: string }> = {
  green: { bg: '#16a34a', text: '#ffffff', border: '#15803d', label: 'Captação' },
  blue: { bg: '#2563eb', text: '#ffffff', border: '#1d4ed8', label: 'Aquecimento' },
  orange: { bg: '#ea580c', text: '#ffffff', border: '#c2410c', label: 'Lembrete' },
  amber: { bg: '#d97706', text: '#ffffff', border: '#b45309', label: 'Evento' },
  purple: { bg: '#9333ea', text: '#ffffff', border: '#7e22ce', label: 'Pós-evento' },
};

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function formatDateBR(d: string | null) {
  if (!d) return '—';
  return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function MonthGrid({ year, month, dayMap, today }: { year: number; month: number; dayMap: Record<string, Milestone[]>; today: string }) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDow = new Date(year, month, 1).getDay();
  const cells: React.ReactNode[] = [];
  for (let i = 0; i < startDow; i++) cells.push(<div key={'b' + i} className="aspect-square" />);
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const events = dayMap[dateStr] || [];
    const isToday = dateStr === today;
    const hasMilestone = events.length > 0;
    if (!hasMilestone && !isToday) {
      cells.push(
        <div key={dateStr} className="cal-day">
          <span className="cal-day-num">{day}</span>
        </div>,
      );
      continue;
    }
    const primary = events.find((m) => m.is_anchor) || events[events.length - 1];
    const palette = primary ? PHASE_CAL[primary.phase_color] : undefined;
    const isAnchor = events.some((m) => m.is_anchor);
    const isPast = primary?.is_past;
    let textColor = palette ? palette.text : 'var(--text)';
    const style: React.CSSProperties = {};
    if (palette) {
      style.background = palette.bg;
      style.border = `1px solid ${palette.border}`;
    }
    if (isPast && !isAnchor) style.opacity = 0.55;
    let cls = 'cal-day';
    if (isAnchor) cls += ' anchor-day has-event';
    else if (hasMilestone) cls += ' has-event';
    if (isToday) {
      cls += ' is-today';
      style.boxShadow = '0 0 0 2px #2563eb,0 0 6px rgba(37,99,235,0.35)';
      if (!palette) textColor = '#1d4ed8';
    }
    style.color = textColor;
    const tooltip = events
      .map((m) => {
        const off = m.offset === 0 ? '' : m.offset > 0 ? ` (+${m.offset}d)` : ` (${m.offset}d)`;
        return `${m.label}${off}${m.is_anchor ? ' ★' : ''}`;
      })
      .join(' · ');
    cells.push(
      <div key={dateStr} className={cls} style={style} title={tooltip}>
        <span className="cal-day-num" style={{ color: textColor }}>
          {day}
        </span>
        {hasMilestone && <span className="cal-dot" style={{ background: textColor }} />}
      </div>,
    );
  }
  return (
    <div className="hb-card rounded-xl overflow-hidden cal-month-card">
      <div className="cal-month-head">
        <span className="cal-month-name">{MONTHS[month]}</span>
        <span className="cal-month-year">{year}</span>
      </div>
      <div className="cal-grid">
        {WEEKDAYS.map((d) => (
          <div key={d} className="cal-weekday">
            {d.charAt(0)}
          </div>
        ))}
      </div>
      <div className="cal-grid">{cells}</div>
    </div>
  );
}

export default function Calendario() {
  const cal = useCalendar();
  const data = cal.data;
  const isAurum = (data?.ciclo_type ?? '') === 'aurum';
  const milestones = data?.milestones ?? [];

  const dayMap: Record<string, Milestone[]> = {};
  for (const m of milestones) (dayMap[m.date] ??= []).push(m);
  const today = new Date().toISOString().split('T')[0];

  const months: { year: number; month: number }[] = [];
  if (milestones.length) {
    const dates = milestones.map((m) => m.date).sort();
    const first = new Date(dates[0] + 'T12:00:00');
    const last = new Date(dates[dates.length - 1] + 'T12:00:00');
    let y = first.getFullYear();
    let mo = first.getMonth();
    while (y < last.getFullYear() || (y === last.getFullYear() && mo <= last.getMonth())) {
      months.push({ year: y, month: mo });
      mo++;
      if (mo > 11) {
        mo = 0;
        y++;
      }
    }
  }

  const phasesPresent = [...new Set(milestones.map((m) => m.phase_color))];
  const anchorMs = milestones.find((m) => m.is_anchor);

  return (
    <div className="space-y-4">
      <div className="rounded-xl p-5 border" style={{ background: 'var(--bg-card)' }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold">{isAurum ? 'Calendário da Palestra' : 'Calendário do Seminário'}</h2>
            <p className="text-xs mt-0.5">
              {data?.anchor_date ? 'Data definida pelo seu admin' : 'Aguardando o admin definir a data do evento'}
            </p>
          </div>
          {!!data?.date_changes && data.date_changes > 0 && (
            <div className="text-xs px-2 py-1 rounded-full" style={{ background: 'var(--bg-muted)', color: 'var(--text-mute)' }}>
              {data.date_changes} mudança{data.date_changes > 1 ? 's' : ''}
            </div>
          )}
        </div>
        {data?.date_change_requested && (
          <div className="mb-1 flex items-center gap-3 rounded-lg px-4 py-3" style={{ background: 'var(--ciclo-aurum-bg, rgba(245,158,11,.08))', border: '1px solid var(--ciclo-aurum-border, rgba(245,158,11,.25))' }}>
            <span style={{ fontSize: 18 }}>⏳</span>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--ciclo-aurum, #d97706)' }}>Aguardando aprovação do monitor</p>
              <p className="text-xs">Sua solicitação de mudança de data foi enviada.</p>
            </div>
          </div>
        )}
      </div>

      {data?.anchor_date && milestones.length > 0 ? (
        <div className="space-y-4">
          <div className="rounded-xl border p-4" style={{ background: 'var(--bg-card)' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Calendário do Ciclo</h3>
              <p className="text-xs">Evento: {anchorMs ? `${anchorMs.label} — ` : ''}{formatDateBR(data.anchor_date)}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              {phasesPresent.map((pc) => {
                const p = PHASE_CAL[pc];
                if (!p) return null;
                return (
                  <div key={pc} className="flex items-center gap-1.5">
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: p.bg, border: `1px solid ${p.border}`, display: 'inline-block' }} />
                    <span style={{ fontSize: 11, color: 'var(--text)' }}>{p.label}</span>
                  </div>
                );
              })}
              <div className="flex items-center gap-1.5">
                <span style={{ width: 10, height: 10, borderRadius: 3, background: 'transparent', border: '2px solid #2563eb', display: 'inline-block' }} />
                <span style={{ fontSize: 11, color: 'var(--text)', fontWeight: 600 }}>Hoje</span>
              </div>
            </div>
          </div>
          <div className="space-y-4">
            {months.map((m) => (
              <MonthGrid key={`${m.year}-${m.month}`} year={m.year} month={m.month} dayMap={dayMap} today={today} />
            ))}
          </div>
        </div>
      ) : (
        <div className="hb-card rounded-xl p-5 text-sm" style={{ color: 'var(--text-mute)' }}>
          {cal.isLoading ? 'Carregando calendário…' : 'O calendário aparecerá aqui assim que o admin definir a data do seu evento.'}
        </div>
      )}
    </div>
  );
}
