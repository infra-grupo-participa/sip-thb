import { useQuery } from '@tanstack/react-query';
import { sipApi } from '../../lib/api';
import { type MonitorStudent, cicloChip } from './types';

interface Props {
  onSelect: (student: MonitorStudent) => void;
}

export default function Summary({ onSelect }: Props) {
  const { data } = useQuery({
    queryKey: ['monitor', 'students'],
    queryFn: () => sipApi<MonitorStudent[]>('/monitor/students', { throwOnError: true }),
    refetchInterval: 30_000,
  });

  const all = Array.isArray(data) ? data : [];
  const total = all.length;
  const done = all.filter((s) => s.progress_percent === 100).length;
  const zero = all.filter((s) => s.progress_percent === 0).length;
  const inProgress = total - done - zero;
  const avg = total > 0 ? Math.round(all.reduce((sum, x) => sum + (x.progress_percent || 0), 0) / total) : 0;

  const top = [...all].sort((a, b) => b.progress_percent - a.progress_percent).slice(0, 5);
  const attention = [...all]
    .filter((s) => s.progress_percent < 30)
    .sort((a, b) => a.progress_percent - b.progress_percent)
    .slice(0, 5);

  // Distribuição por etapa
  const stageMap: Record<string, number> = {};
  all.forEach((s) => {
    const k = s.current_stage != null ? String(s.current_stage) : '—';
    stageMap[k] = (stageMap[k] ?? 0) + 1;
  });
  const stages = Object.entries(stageMap).sort((a, b) => Number(a[0]) - Number(b[0]));
  const maxStage = Math.max(1, ...Object.values(stageMap));

  return (
    <div>
      <header className="page-head">
        <h1>Resumo do time</h1>
        <p>Visão consolidada de progresso e atenção</p>
      </header>

      <section className="kpi-row">
        <div className="kpi-tile">
          <p className="kpi-label">Progresso médio</p>
          <p className="kpi-value" style={{ color: 'var(--green)' }}>
            {avg}%
          </p>
          <div className="kpi-bar">
            <div style={{ width: `${avg}%` }} />
          </div>
          <p className="kpi-hint">do time inteiro</p>
        </div>
        <div className="kpi-tile">
          <p className="kpi-label">Concluíram</p>
          <p className="kpi-value">{done}</p>
          <p className="kpi-hint">100% das tarefas</p>
        </div>
        <div className="kpi-tile">
          <p className="kpi-label">Em andamento</p>
          <p className="kpi-value" style={{ color: 'var(--brand)' }}>
            {inProgress}
          </p>
          <p className="kpi-hint">entre 1% e 99%</p>
        </div>
        <div className="kpi-tile">
          <p className="kpi-label">Não iniciaram</p>
          <p className="kpi-value" style={{ color: 'var(--text-mute)' }}>
            {zero}
          </p>
          <p className="kpi-hint">0% de progresso</p>
        </div>
      </section>

      <div className="overview-grid">
        <section className="info-card">
          <div className="info-card-head">
            <h2>Top performers</h2>
            <p>Alunos com maior progresso</p>
          </div>
          <div className="students-list" style={{ border: 'none' }}>
            <MiniList list={top} emptyMsg="Sem dados ainda" onSelect={onSelect} />
          </div>
        </section>

        <section className="info-card">
          <div className="info-card-head">
            <h2>Precisam de atenção</h2>
            <p>Alunos parados ou ainda em 0%</p>
          </div>
          <div className="students-list" style={{ border: 'none' }}>
            <MiniList list={attention} emptyMsg="Todos com bom progresso" onSelect={onSelect} />
          </div>
        </section>
      </div>

      <section className="info-card">
        <div className="info-card-head">
          <h2>Distribuição por etapa</h2>
          <p>Quantos alunos estão em cada etapa do ciclo</p>
        </div>
        <div className="summary-stages">
          {stages.length === 0 ? (
            <p style={{ color: 'var(--text-mute)', fontSize: 13 }}>—</p>
          ) : (
            stages.map(([stage, count]) => {
              const pct = (count / maxStage) * 100;
              return (
                <div className="stage-bar-row" key={stage}>
                  <span className="stage-bar-label">Etapa {stage}</span>
                  <div className="stage-bar-track">
                    <div className="stage-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="stage-bar-count">{count}</span>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

function MiniList({
  list,
  emptyMsg,
  onSelect,
}: {
  list: MonitorStudent[];
  emptyMsg: string;
  onSelect: (s: MonitorStudent) => void;
}) {
  if (list.length === 0) {
    return (
      <div className="empty-state">
        <p className="sub">{emptyMsg}</p>
      </div>
    );
  }
  return (
    <>
      {list.map((s) => {
        const chip = cicloChip(s.ciclo_type);
        const pct = s.progress_percent ?? 0;
        const fillCls = pct === 100 ? 'is-green' : pct > 50 ? 'is-brand' : 'is-blue';
        return (
          <div className="student-row" key={s.id} onClick={() => onSelect(s)}>
            <div className="student-row-avatar">{(s.name?.charAt(0) ?? '?').toUpperCase()}</div>
            <div className="student-row-main">
              <div className="student-row-line1">
                <span className="student-row-name">{s.name}</span>
                <span className={`chip ${chip.cls} chip-sm`}>{chip.label}</span>
              </div>
            </div>
            <div className="student-row-progress">
              <span className={`student-row-pct${pct === 100 ? ' is-green' : ''}`}>{pct}%</span>
              <div className="student-row-bar">
                <div className={fillCls} style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
